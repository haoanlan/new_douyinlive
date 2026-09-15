/**
 * 每个房间一条 WebSocket 长连接：建连、心跳、指数退避重连
 *
 * 由 monitor.js 拆分而来（逐字搬运，未改动逻辑）。
 */
const { WebSocket } = require('ws');
const db = require('../../db-sqlite.js');
const api = require('../douyin-api.js');
const feishu = require('../../feishu-send.js');
const ctx = require('./context');
const { loadConfig } = require('./config');
const { createRoomState, getDisplayName } = require('./room-state');
const { setStreamerDir, createSession, saveSession, finalizeSession, generateAndSendReport } = require('./session');
const { handleMessage } = require('./message-handler');
const { ensureBinaryRunning } = require('./proxy-process');
const { rooms } = ctx;

// ====== WebSocket 连接（按房间） ======
function startConnection(roomId, config) {
  if (ctx.isShuttingDown) return;

  let room = rooms.get(roomId);
  if (!room) {
    room = createRoomState(roomId);
    rooms.set(roomId, room);
  }

  // 房间无效（ROOM_NOT_FOUND），不连接
  if (room.invalid) {
    console.log(`[${roomId}] 房间无效，跳过连接`);
    return;
  }

  const wsUrl = `ws://127.0.0.1:1088/ws/${roomId}`;
  console.log(`[${getDisplayName(room)}] 连接: ${wsUrl}`);

  // 清理旧连接，防止重叠
  if (room.ws) {
    try { room.ws.removeAllListeners(); room.ws.close(); } catch(e) {}
  }
  room.ws = new WebSocket(wsUrl);

  room.ws.on('open', () => {
    room.reconnectCount = 0;  // 连接成功，重置退避计数
    // 新连接建立后，上一次连接拿到的直播状态已经作废：清空它。
    // 这样 /api/rooms 能如实反映"还没有确认开播"，界面据此显示"连接中"，
    // 而不是拿旧状态（例如暂停前的 ROOM_OFFLINE）误报成"监控中"。
    room.lastStatusCode = null;
    room.lastTitle = null;
    console.log(`[${getDisplayName(room)}] 已连接，等待直播...`);
  });

  room.ws.on('message', (raw) => {
    try {
      const str = raw.toString();
      const data = JSON.parse(str);

      // ====== 系统消息 ======
      if (data.type === 'system') {
        const event = data.event || '';
        if (event === 'live_status') {
          if (data.livename) room.displayName = data.livename;
          const code = data.code || '';
          const isLive = !!data.live;
          const isEnded = !!data.ended;
          // 记在房间对象上，供 /api/rooms 直接读内存（不再依赖解析日志）
          if (code) room.lastStatusCode = code;
          if (data.title) room.lastTitle = data.title;
          console.log(`[${getDisplayName(room)}] [live_status] code=${code} live=${data.live} ended=${data.ended||false} title=${data.title||''}主播=${data.livename||''}`);

          // --- v2.1.0 新增: 基于 code 字段的精确处理 ---

          // ROOM_ENDED: Go代理确认已下播，直接结束session
          if (code === 'ROOM_ENDED' || isEnded) {
            if (room.isRecording) {
              console.log(`[${getDisplayName(room)}] 🟢 确认下播 (code=${code}, ended=${data.ended})`);
              // 清理可能残留的下播定时器
              if (room.liveStopTimer) {
                clearTimeout(room.liveStopTimer);
                room.liveStopTimer = null;
              }
              room.isRecording = false;
              finalizeSession(room);
              console.log(`[${getDisplayName(room)}] session 已保存 (${room.session.stats.danmaku}条弹幕, ${room.session.stats.gift}个礼物)`);
              generateAndSendReport(room);
            }
            if (room.session) room.session._liveStatus = false;
            console.log(`[${getDisplayName(room)}] 直播已结束，等待下次开播 (${data.message || ''})`);
            return;
          }

          // ROOM_NOT_FOUND: 房间不存在，标记无效，停止重连
          if (code === 'ROOM_NOT_FOUND') {
            console.log(`[${getDisplayName(room)}] ❌ 房间不存在 (${roomId})，停止重连`);
            if (room.isRecording) {
              room.isRecording = false;
              finalizeSession(room);
              generateAndSendReport(room);
            }
            // 标记房间无效，后续重连时跳过
            room.invalid = true;
            if (room.ws) {
              try { room.ws.removeAllListeners(); room.ws.close(); } catch(e) {}
              room.ws = null;
            }
            return;
          }

          // ROOM_OFFLINE / ACCOUNT_OFFLINE_NO_ROOM: 未开播，保持连接等待
          if (code === 'ROOM_OFFLINE' || code === 'ACCOUNT_OFFLINE_NO_ROOM') {
            if (room.session) room.session._liveStatus = false;
            if (!room.isRecording) {
              console.log(`[${getDisplayName(room)}] 直播未开播，等待中... (${data.message || ''})`);
            }
            return;
          }

          // --- 兜底: 兼容旧版 Go代理 (v2.0.x) 的 live_status ---

          // 主播回来时，取消可能残留的下播定时器
          if (isLive && room.liveStopTimer) {
            clearTimeout(room.liveStopTimer);
            room.liveStopTimer = null;
            console.log(`[${getDisplayName(room)}] 🟢 主播回来了，取消下播确认`);
          }

          if (isLive && !room.isRecording) {
            // 🔴 开播
            console.log(`[${getDisplayName(room)}] 🔴 检测到开播！`);
            const openId = config.feishu?.open_id || '';
            room.session = createSession(room, roomId);
            room.session.room_title = data.title || '';
            room.session.room_author = data.livename || '';
            if (room.session.room_author) setStreamerDir(room, room.session.room_author);
            room.isRecording = true;
            saveSession(room);
            db.init().then(async () => {
              try {
                const pool = db.getPool();
                await pool.query("UPDATE sessions SET end_time = datetime('now','localtime') WHERE room_id = ? AND end_time IS NULL", [roomId]);
                const name = getDisplayName(room);
                if (openId) {
                  feishu.sendText(openId, '🔴 ' + name + ' 开播啦！\n' + (data.title || ''), 'open_id').catch(() => {});
                }
                const streamerId = await db.upsertStreamer(room.session.room_author || '', roomId, '', '');
                room.dbSessionId = await db.createSession(streamerId, room.session.room_title, roomId);
                room.dbSyncState = { danmaku: 0, gifts: 0, members: 0, online: 0, likes: 0 };
                console.log(`[${getDisplayName(room)}] [db] session #${room.dbSessionId} 已创建`);
                // 执行挂起的更新
                const updates = room.pendingDbUpdates;
                room.pendingDbUpdates = [];
                for (const fn of updates) fn(room.dbSessionId);
              } catch(e) {
                console.error(`[${getDisplayName(room)}] [db] 创建 session 失败:`, e.message);
              }
            });
            console.log(`[${getDisplayName(room)}] 开始录制: ${data.title || ''}`);
          } else if (!isLive && room.isRecording) {
            // 🟢 可能下播（兜底逻辑，新版Go代理会走 ROOM_ENDED 分支）
            // 如果最近还有数据流入（lastDataTime在60秒内），说明主播只是暂时离开，不启动下播定时器
            const dataAge = room.lastDataTime ? (Date.now() - room.lastDataTime) / 1000 : Infinity;
            if (dataAge < 60) {
              console.log(`[${getDisplayName(room)}] 🟡 live=false 但最近${Math.round(dataAge)}秒有数据流入，跳过下播判定`);
            } else if (!room.liveStopTimer) {
              room.liveStopTimer = setTimeout(() => {
                room.liveStopTimer = null;
                if (!room.isRecording) return;
                // 定时器触发时再次检查：如果期间有新数据流入，取消下播
                const lateDataAge = room.lastDataTime ? (Date.now() - room.lastDataTime) / 1000 : Infinity;
                if (lateDataAge < 60) {
                  console.log(`[${getDisplayName(room)}] 🟡 下播确认时发现最近${Math.round(lateDataAge)}秒有数据，取消下播`);
                  return;
                }
                console.log(`[${getDisplayName(room)}] 🟢 确认下播！`);
                room.isRecording = false;
                finalizeSession(room);
                console.log(`[${getDisplayName(room)}] session 已保存 (${room.session.stats.danmaku}条弹幕, ${room.session.stats.gift}个礼物)`);
                generateAndSendReport(room);
              }, 30000);
              console.log(`[${getDisplayName(room)}] 🟡 直播可能已结束，30秒后确认...`);
            }
          }

          if (room.session) room.session._liveStatus = isLive;
          if (!isLive && !room.isRecording) {
            console.log(`[${getDisplayName(room)}] 直播未开播，等待中... (${data.message || ''})`);
          }
        } else {
          console.log(`[${getDisplayName(room)}] [系统] ${data.message || JSON.stringify(data)}`);
        }
        return;
      }

      // ====== 直播数据 ======
      if (room.session && room.isRecording) {
        if (data.livename && !room.session.room_author) {
          room.displayName = data.livename;
          console.log(`[${getDisplayName(room)}] 🏷️ 抓到主播名:`, data.livename);
          room.session.room_author = data.livename;
          setStreamerDir(room, data.livename);
          const doUpdate = (sid) => {
            db.updateStreamerName(sid, data.livename, data.avatarThumb || '').catch(e => console.error(`[session] 更新主播名失败:`, e.message));
          };
          if (room.dbSessionId) doUpdate(room.dbSessionId);
          else room.pendingDbUpdates.push(doUpdate);
        }
        if (data.title && !room.session.room_title) {
          room.session.room_title = data.title;
          if (room.dbSessionId) {
            db.getPool().query('UPDATE sessions SET room_title = ? WHERE id = ? AND (room_title IS NULL OR room_title = "")', [data.title, room.dbSessionId]).catch(e => console.error(`[session] 更新标题失败:`, e.message));
          }
        }
        if (data.avatarThumb && !room.session.room_avatar) {
          room.session.room_avatar = data.avatarThumb;
          if (room.dbSessionId) db.updateStreamerAvatar(room.dbSessionId, data.avatarThumb).catch(e => console.error(`[session] 更新头像失败:`, e.message));
        }
      }

      if (room.session) {
        if (!room.isRecording && room.dbSessionId) {
          room.isRecording = true;
          console.log(`[${getDisplayName(room)}] 检测到新数据，恢复录制`);
        }
        if (room.isRecording) {
          handleMessage(room, data);
          saveSession(room);
        }
      }
    } catch (e) {
      const method = (typeof data === 'object' && data) ? (data._method || data.method || data.event || '?') : '?';
      console.error(`[${getDisplayName(room)}] 消息处理错误 [${method}]:`, e.message);
    }
  });

  room.ws.on('close', (code) => {
    console.log(`[${getDisplayName(room)}] 连接断开 (code=${code})`);
    if (ctx.isShuttingDown) return;
    // 房间已被"删除房间"移除 → 绝不重连。
    // 少了这一条，被删掉的房间会因为下面找不到 roomConfig 而继续重连，
    // 并在 startConnection 里重新创建房间状态 —— 房间就"复活"了。
    if (room.removed) {
      console.log(`[${getDisplayName(room)}] 房间已被删除，停止重连`);
      return;
    }
    if (!rooms.has(roomId)) {
      console.log(`[${getDisplayName(room)}] 房间已不在监控列表中（停止/重启中），停止重连`);
      return;
    }
    // 检查房间是否已被暂停，暂停则不重连
    const currentConfig = loadConfig();
    const roomConfig = currentConfig.rooms?.find(r => r.id === roomId);
    if (roomConfig && roomConfig.enabled === false) {
      console.log(`[${getDisplayName(room)}] 房间已暂停，停止重连`);
      return;
    }
    // 房间不存在（ROOM_NOT_FOUND），不再重连
    if (room.invalid) {
      console.log(`[${getDisplayName(room)}] 房间无效，停止重连`);
      return;
    }
    // code=1000 不再直接结束 session — 团播切换主播时 Go 代理会断开 WS，
    // 但直播还在播。下播由 live_status 事件的 30 秒确认机制来处理。
    if (code === 1000 && room.isRecording) {
      console.log(`[${getDisplayName(room)}] WS正常关闭(code=1000)，保持录制状态，尝试重连...`);
      // 清理可能残留的下播确认 timer，防止重连期间误触发
      if (room.liveStopTimer) {
        clearTimeout(room.liveStopTimer);
        room.liveStopTimer = null;
      }
    }
    // 指数退避：base * 2^count，最大 60 秒
    let delay;
    if (code === 1000 && room.isRecording) {
      delay = 2000;  // 录制中 code=1000 快速重连
    } else {
      const base = (config.reconnect_delay_seconds || 10) * 1000;
      delay = Math.min(base * Math.pow(2, room.reconnectCount), 60000);
      room.reconnectCount = Math.min(room.reconnectCount + 1, 10);  // 上限 10 次
    }
    console.log(`[${getDisplayName(room)}] ${delay/1000}秒后重连 (退避第${room.reconnectCount}次)...`);
    setTimeout(async () => {
      // 排队期间房间可能已被移除/暂停，或正在关停 —— 这里再确认一次，避免复活
      if (room.removed || ctx.isShuttingDown || !rooms.has(roomId)) return;
      await ensureBinaryRunning().catch(e => console.error(`[daemon] ensureBinary 异常:`, e.message));
      startConnection(roomId, config);
    }, delay);
  });

  room.ws.on('error', (err) => {
    console.log(`[${getDisplayName(room)}] WS错误: ${err.message}`);
    ensureBinaryRunning().catch(e => console.error(`[daemon] ensureBinary 异常:`, e.message));
  });
}

module.exports = {
  startConnection,
};
