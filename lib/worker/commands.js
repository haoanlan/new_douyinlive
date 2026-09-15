/**
 * 控制命令：add / remove / pause / resume / status / start / stop（同进程直接调用）
 *
 * 由 monitor.js 拆分而来（逐字搬运，未改动逻辑）。
 */
const net = require('net');
const fs = require('fs');
const api = require('../douyin-api.js');
const ctx = require('./context');
const { loadConfig, saveConfig } = require('./config');
const { createRoomState, loadRoomName } = require('./room-state');
const { dbFlush, finalizeSession, generateAndSendReport } = require('./session');
const { ensureBinaryRunning } = require('./proxy-process');
const { startConnection } = require('./connection');
const { rooms, CONTROL_SOCKET } = ctx;

function startControlSocket() {
  // 清理旧 socket
  try { fs.unlinkSync(CONTROL_SOCKET); } catch(e) {}

  const server = net.createServer((conn) => {
    let buf = '';
    let processed = false;
    conn.on('data', (chunk) => {
      buf += chunk.toString();
      // 收到数据后立即处理并回复（不等 end 事件）
      if (!processed) {
        processed = true;
        try {
          const cmd = JSON.parse(buf);
          handleControlCommand(cmd).then(resp => {
            if (!conn.destroyed) {
              conn.end(JSON.stringify(resp));
            }
          }).catch(e => {
            if (!conn.destroyed) {
              conn.end(JSON.stringify({ ok: false, error: e.message }));
            }
          });
        } catch (e) {
          if (!conn.destroyed) {
            conn.end(JSON.stringify({ ok: false, error: '无效JSON: ' + e.message }));
          }
        }
      }
    });
    conn.on('error', () => {});  // 忽略客户端断开错误
  });

  server.listen(CONTROL_SOCKET, () => {
    console.log(`[control] 监听 ${CONTROL_SOCKET}`);
  });

  server.on('error', (err) => {
    console.error('[control] socket 错误:', err.message);
  });

  return server;
}

async function handleControlCommand(req) {
  const { cmd, roomId } = req;
  const config = loadConfig();

  switch (cmd) {
    case 'status': {
      return { ok: true, data: lc().daemonStatus() };
    }

    case 'lookup': {
      // 通过 API 查询主播名（给 dashboard 用）
      if (!roomId) return { ok: false, error: '缺少 roomId' };
      try {
        const liveInfo = await api.getLiveInfo(roomId);
        if (liveInfo && liveInfo.sec_uid) {
          const userInfo = await api.getUserInfo(liveInfo.sec_uid);
          if (userInfo && userInfo.nickname) {
            return {
              ok: true,
              nickname: userInfo.nickname,
              avatar: userInfo.avatar_thumb?.url_list?.[0] || '',
              sec_uid: liveInfo.sec_uid,
              room_id: roomId,
              is_live: liveInfo.room_status === '2',
              title: liveInfo.room_title || ''
            };
          }
        }
        return { ok: false, error: '未找到主播信息' };
      } catch(e) {
        return { ok: false, error: '查询失败: ' + e.message };
      }
    }

    case 'add': {
      if (!roomId) return { ok: false, error: '缺少 roomId' };
      if (!/^[A-Za-z0-9]{5,30}$/.test(roomId)) return { ok: false, error: `roomId 格式无效: ${roomId}（应为5-30位字母数字）` };
      if (rooms.has(roomId)) return { ok: false, error: `房间 ${roomId} 已在监控` };
      // 写入配置
      if (!config.rooms) config.rooms = [];
      if (!config.rooms.find(r => r.id === roomId)) {
        config.rooms.push({ id: roomId, name: '', enabled: true });
        saveConfig(config);
      }
      // 启动连接
      await ensureBinaryRunning().catch(e => console.error(`[daemon] ensureBinary 异常:`, e.message));
      startConnection(roomId, config);
      // 加载主播名（DB → API），确保飞书通知不用房间号
      const room = rooms.get(roomId);
      if (room) {
        await loadRoomName(room).catch(() => {});
        console.log(`[daemon] ${room.displayName} (${roomId}) 已加载`);
      }
      return { ok: true, message: `已添加房间 ${roomId}` };
    }

    case 'remove': {
      if (!roomId) return { ok: false, error: '缺少 roomId' };
      const room = rooms.get(roomId);
      if (!room) {
        // 房间不在 rooms Map（可能是 disabled 未启动），仍从配置移除
        if (config.rooms) {
          config.rooms = config.rooms.filter(r => r.id !== roomId);
          saveConfig(config);
        }
        return { ok: true, message: `已移除房间 ${roomId}（未在监控中）` };
      }
      // 停止录制
      if (room.isRecording && room.session) {
        room.isRecording = false;
        await dbFlush(room);
        finalizeSession(room);
        generateAndSendReport(room);
      }
      // 关闭连接（先打"已移除"标记：close 事件据此禁止重连，否则房间会复活）
      room.removed = true;
      if (room.ws) try { room.ws.close(); } catch(e) {}
      if (room.liveStopTimer) clearTimeout(room.liveStopTimer);
      rooms.delete(roomId);
      // 从配置中移除
      if (config.rooms) {
        config.rooms = config.rooms.filter(r => r.id !== roomId);
        saveConfig(config);
      }
      return { ok: true, message: `已移除房间 ${roomId}` };
    }

    case 'pause': {
      if (!roomId) return { ok: false, error: '缺少 roomId' };
      const room = rooms.get(roomId);
      if (!room) return { ok: false, error: `房间 ${roomId} 不在监控中` };
      // 如果正在录制，先结束录制、出报告
      if (room.isRecording && room.session) {
        room.isRecording = false;
        await dbFlush(room);
        finalizeSession(room);
        generateAndSendReport(room);
      }
      // 关闭 WS 连接但保留 room 状态
      if (room.ws) try { room.ws.close(); } catch(e) {}
      room.ws = null;
      // 标记为暂停
      if (config.rooms) {
        const r = config.rooms.find(r => r.id === roomId);
        if (r) { r.enabled = false; saveConfig(config); }
      }
      return { ok: true, message: `已暂停房间 ${roomId}` };
    }

    case 'resume': {
      if (!roomId) return { ok: false, error: '缺少 roomId' };
      let room = rooms.get(roomId);
      if (!room) {
        room = createRoomState(roomId);
        rooms.set(roomId, room);
      }
      // 恢复前先作废"上一次连接"拿到的直播状态。
      // 这里复用同一个 room 对象，若不清理，lastStatusCode 还留着暂停前的值
      // （通常是 ROOM_OFFLINE），界面会立刻显示"监控中"，让人以为已经在录了。
      // 清空后界面显示"连接中"，直到抓取代理重新确认开播为止。
      room.lastStatusCode = null;
      room.lastTitle = null;
      // 更新配置
      if (!config.rooms) config.rooms = [];
      const exist = config.rooms.find(r => r.id === roomId);
      if (exist) exist.enabled = true;
      else config.rooms.push({ id: roomId, name: '', enabled: true });
      saveConfig(config);
      // 重新连接
      if (room.ws) try { room.ws.close(); } catch(e) {}
      await ensureBinaryRunning().catch(e => console.error(`[daemon] ensureBinary 异常:`, e.message));
      startConnection(roomId, config);
      return { ok: true, message: `已恢复房间 ${roomId}（正在等待代理确认开播）` };
    }

    case 'stop': {
      // 供仪表盘"停止"按钮调用：优雅关停（比 SIGTERM 干净，Windows 下尤其重要）
      if (ctx.isStandalone) {
        setTimeout(() => {
          lc().stopDaemon()
            .catch(e => console.error('[daemon] 停止异常:', e.message))
            .finally(() => process.exit(0));
        }, 300);
        return { ok: true, message: '守护进程正在停止' };
      }
      // 嵌入模式：只停 worker，仪表盘进程继续对外服务
      setTimeout(() => {
        lc().stopWorker({ closeDb: false })
          .catch(e => console.error('[daemon] 停止 worker 异常:', e.message));
      }, 300);
      return { ok: true, message: '监控 worker 正在停止（仪表盘继续运行）' };
    }

    case 'start': {
      // 嵌入模式下由仪表盘自己拉起 worker（不会再 spawn 第二个进程）
      if (ctx.workerRunning) return { ok: true, message: '监控 worker 已在运行' };
      lc().startDaemon({ embedded: !ctx.isStandalone })
        .catch(e => console.error('[daemon] 启动 worker 异常:', e.message));
      return { ok: true, message: '监控 worker 正在启动' };
    }

    default:
      return { ok: false, error: `未知命令: ${cmd}` };
  }
}

/** 通过 Unix socket 发送控制命令到守护进程 */
function sendCommand(req, timeout = 3000) {
  return new Promise((resolve, reject) => {
    if (!fs.existsSync(CONTROL_SOCKET)) {
      return reject(new Error('socket 文件不存在'));
    }
    const client = net.createConnection(CONTROL_SOCKET, () => {
      client.end(JSON.stringify(req));
    });
    let buf = '';
    client.on('data', (chunk) => { buf += chunk.toString(); });
    client.on('end', () => {
      try { resolve(JSON.parse(buf)); }
      catch (e) { reject(new Error('解析响应失败')); }
    });
    client.on('error', reject);
    setTimeout(() => { client.destroy(); reject(new Error('超时')); }, timeout);
  });
}


/**
 * 延迟获取 lifecycle 模块。
 *
 * lifecycle.startDaemon 需要 startControlSocket（本模块提供），本模块又需要
 * lifecycle 的 startDaemon/stopWorker/daemonStatus —— 顶层互相 require 会形成
 * 循环依赖，导致其中一个拿到未完成的 exports。所以这里改为调用时再 require。
 */
let _lifecycle = null;
function lc() {
  if (!_lifecycle) _lifecycle = require('./lifecycle');
  return _lifecycle;
}

module.exports = {
  handleControlCommand,
  startControlSocket,
  sendCommand,
};
