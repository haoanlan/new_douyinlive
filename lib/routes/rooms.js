const path = require('path');
const fs = require('fs');
const workerControl = require('../worker-control.js');

module.exports = async function(pathname, query, req, res, ctx) {
  const { dbInstance, sendJSON, sendError, bodyParse, DATA_DIR, getCookie } = ctx;

  // --- 查询房间信息 ---
  if (pathname === '/api/rooms/lookup' && req.method === 'GET') {
    const input = (query.room_id || query.q || '').trim();
    if (!input) return sendError(res, '请输入房间号或抖音号', 400);

    try {
      if (/^[A-Za-z0-9]{5,30}$/.test(input)) {
        // 房间号 → 直接调 douyin-api（getLiveInfo + getUserInfo）
        const api = require('../douyin-api.js');
        const liveInfo = await api.getLiveInfo(input);
        if (liveInfo && liveInfo.sec_uid) {
          const userInfo = await api.getUserInfo(liveInfo.sec_uid);
          if (userInfo && userInfo.nickname) {
            return sendJSON(res, {
              ok: true, room_id: input,
              nickname: userInfo.nickname,
              avatar: userInfo.avatar_thumb?.url_list?.[0] || '',
              room_title: liveInfo.room_title || '',
              is_live: liveInfo.room_status !== '2',
              real_room_id: input
            });
          }
        }
        // 查不到，返回房间号让用户手动填名
        return sendJSON(res, {
          ok: true, room_id: input, nickname: '', avatar: '',
          room_title: '', is_live: false, real_room_id: input
        });
      } else {
        // 抖音号 → 搜索用户页面
        const searchUrl = `https://www.douyin.com/search/${encodeURIComponent(input)}?type=user`;
        const resp = await fetch(searchUrl, {
          headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36', 'Cookie': getCookie(), 'Referer': 'https://www.douyin.com/' }, redirect: 'manual'
        });
        const html = await resp.text();
        const secUid = html.match(/\\\\\\\\?\\\"sec_uid\\\\\\\\?\\\":\\\\\\\\?\\\"([^\\\"\\\\\\\\]+)\\\\\\\\?\\\"/)?.[1];
        const nickname = html.match(/\\\\\\\\?\\\"nickname\\\\\\\\?\\\":\\\\\\\\?\\\"([^\\\"\\\\\\\\]+)\\\\\\\\?\\\"/)?.[1];
        const uniqueId = html.match(/\\\\\\\\?\\\"unique_id\\\\\\\\?\\\":\\\\\\\\?\\\"([^\\\"\\\\\\\\]+)\\\\\\\\?\\\"/)?.[1];
        const roomId = html.match(/\\\\\\\\?\\\"room_id\\\\\\\\?\\\":\\\\\\\\?\\\"(\\\\d+)\\\\\\\\?\\\"/)?.[1];
        const avatar = html.match(/\\\\\\\\?\\\"avatar\\\\\\\\?\\\":\\\\\\\\?\\\"(https?:[^\\\"\\\\\\\\]+)\\\\\\\\?\\\"/)?.[1];

        if (nickname) {
          return sendJSON(res, {
            ok: true, room_id: roomId || '', nickname: nickname || '', avatar: avatar || '',
            unique_id: uniqueId || '', sec_uid: secUid || '', is_live: !!roomId && roomId !== '0'
          });
        }
        return sendError(res, '未找到该用户', 404);
      }
    } catch (e) {
      return sendError(res, `查询失败: ${e.message}`, 500);
    }
  }

        // --- 房间列表（含运行状态）---
  if (pathname === '/api/rooms' && req.method === 'GET') {
    let config = { rooms: [] };
    try {
      config = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'runtime-config.json'), 'utf-8'));
    } catch(e) { /* 文件不存在或损坏时使用默认值 */ }
    const configRooms = config.rooms || [];

    // 房间运行状态：控制通道优先，不可用时用 daemon 日志兜底（见 lib/room-status.js）
    const roomStatus = await require('../room-status').getRoomStates({ dbInstance, dataDir: DATA_DIR });
    const daemonRooms = {};
    for (const r of roomStatus.rooms) {
      if (r.roomId) daemonRooms[r.roomId] = r;
      if (r.name) daemonRooms[r.name] = r;
    }

    const rows = dbInstance.prepare(`
      SELECT s.id, s.name, s.room_id, s.avatar,
        (SELECT COUNT(*) FROM sessions WHERE streamer_id = s.id) as session_count,
        (SELECT COALESCE(SUM(stats_like), 0) FROM sessions WHERE streamer_id = s.id) as total_likes,
        (SELECT MAX(start_time) FROM sessions WHERE streamer_id = s.id) as last_session_time
      FROM streamers s ORDER BY s.name
    `).all();

    const result = rows.map(r => {
      const cfg = configRooms.find(c => c.id === r.room_id);
      // 按房间号匹配；日志兜底时可能只有房间名
      const daemon = daemonRooms[r.room_id] || daemonRooms[r.name];
      return {
        id: r.id,
        room_id: r.room_id,
        name: r.name,
        avatar: r.avatar,
        session_count: r.session_count,
        total_likes: r.total_likes || 0,
        last_session_time: r.last_session_time || null,
        enabled: cfg ? cfg.enabled !== false : false,
        connected: Boolean(daemon?.connected),
        recording: Boolean(daemon?.recording),
        liveStatus: daemon?.liveStatus ?? null,
        roomTitle: daemon?.title || '',
        // 状态来源：socket 实时 / log 兜底（页面可据此提示"略有延迟"）
        statusSource: roomStatus.source,
        statusStale: roomStatus.stale
      };
    });
    // 启用的在前，监控中的在前，其他按名称
    result.sort((a, b) => {
      if (a.enabled !== b.enabled) return a.enabled ? -1 : 1;
      if (a.connected !== b.connected) return a.connected ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
    return sendJSON(res, result);
  }

  // --- 暂停房间 ---
  if (pathname === '/api/rooms/pause' && req.method === 'POST') {
    const body = await bodyParse(req);
    const { room_id } = body;
    if (!room_id) return sendError(res, '缺少 room_id', 400);
    // 同进程直接调用 worker（原来是走 monitor.sock 命名管道）
    const result = await workerControl.sendControlCommand('pause', { roomId: room_id });
    return sendJSON(res, result, workerControl.controlStatus(result));
  }

  // --- 恢复房间 ---
  if (pathname === '/api/rooms/resume' && req.method === 'POST') {
    const body = await bodyParse(req);
    const { room_id } = body;
    if (!room_id) return sendError(res, '缺少 room_id', 400);
    const result = await workerControl.sendControlCommand('resume', { roomId: room_id });
    return sendJSON(res, result, workerControl.controlStatus(result));
  }

  // --- 添加房间 ---
  if (pathname === '/api/rooms/add' && req.method === 'POST') {
    const body = await bodyParse(req);
    const { room_id, name } = body;
    if (!room_id) return sendError(res, '缺少 room_id', 400);
    if (!/^[A-Za-z0-9]{5,30}$/.test(room_id)) return sendError(res, 'room_id 格式无效（5-30位字母数字）', 400);
    const result = await workerControl.sendControlCommand('add', { roomId: room_id });
    // 如果有 name，更新 streamers 表
    if (result.ok && name) {
      try {
        const existing = dbInstance.prepare('SELECT id FROM streamers WHERE room_id = ?').get(room_id);
        if (existing) {
          dbInstance.prepare('UPDATE streamers SET name = ? WHERE room_id = ?').run(name, room_id);
        } else {
          dbInstance.prepare('INSERT INTO streamers (name, room_id) VALUES (?, ?)').run(name, room_id);
        }
      } catch {}
    }
    return sendJSON(res, result, workerControl.controlStatus(result));
  }

  // --- 删除房间 ---
  if (pathname === '/api/rooms/remove' && req.method === 'POST') {
    const body = await bodyParse(req);
    const { room_id, delete_data } = body;
    if (!room_id) return sendError(res, '缺少 room_id', 400);
    const result = await workerControl.sendControlCommand('remove', { roomId: room_id });
    // 如果 monitor 移除成功，根据 delete_data 决定是否清理数据库
    if (result.ok) {
      try {
        if (delete_data) {
          // 彻底删除：删 sessions（级联删 danmaku/gifts/members/online_records）+ 删 streamer
          // 顺序不能反：sessions.streamer_id 外键没有 ON DELETE，必须先在删掉 sessions 才能删 streamer
          const streamer = dbInstance.prepare('SELECT id FROM streamers WHERE room_id = ?').get(room_id);
          if (streamer) {
            dbInstance.transaction(() => {
              dbInstance.prepare('DELETE FROM sessions WHERE streamer_id = ?').run(streamer.id);
              dbInstance.prepare('DELETE FROM streamers WHERE id = ?').run(streamer.id);
            })();
          }
        }
      } catch (e) { console.error('[remove] DB cleanup error:', e.message); }
    }
    return sendJSON(res, result, workerControl.controlStatus(result));
  }

  return false;
};
