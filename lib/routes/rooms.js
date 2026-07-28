const path = require('path');
const fs = require('fs');

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
    const config = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'runtime-config.json'), 'utf-8'));
    const configRooms = config.rooms || [];
    // 获取 daemon 实时状态
    let daemonRooms = {};
    try {
      const net = require('net');
      const statusResult = await new Promise((resolve, reject) => {
        const socketPath = path.join(DATA_DIR, 'monitor.sock');
        if (!fs.existsSync(socketPath)) return resolve({ rooms: {} });
        const client = net.createConnection(socketPath, () => {
          client.end(JSON.stringify({ cmd: 'status' }));
        });
        let buf = '';
        client.on('data', (chunk) => { buf += chunk.toString(); });
        client.on('end', () => { try { resolve(JSON.parse(buf)); } catch { resolve({ rooms: {} }); } });
        client.on('error', () => resolve({ rooms: {} }));
        setTimeout(() => { try { client.destroy(); } catch {} resolve({ rooms: {} }); }, 2000);
      });
      daemonRooms = statusResult?.data?.rooms || {};
    } catch {}

    const rows = dbInstance.prepare(`
      SELECT s.id, s.name, s.room_id, s.avatar,
        (SELECT COUNT(*) FROM sessions WHERE streamer_id = s.id) as session_count,
        (SELECT COALESCE(SUM(stats_like), 0) FROM sessions WHERE streamer_id = s.id) as total_likes
      FROM streamers s ORDER BY s.name
    `).all();

    const result = rows.map(r => {
      const cfg = configRooms.find(c => c.id === r.room_id);
      const daemon = daemonRooms[r.room_id];
      return {
        id: r.id,
        room_id: r.room_id,
        name: r.name,
        avatar: r.avatar,
        session_count: r.session_count,
        total_likes: r.total_likes || 0,
        enabled: cfg ? cfg.enabled !== false : false,
        connected: daemon?.connected || false,
        recording: daemon?.recording || false
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
    // 通过控制 socket 发送 pause 命令
    const net = require('net');
    const result = await new Promise((resolve, reject) => {
      const socketPath = path.join(DATA_DIR, 'monitor.sock');
      if (!fs.existsSync(socketPath)) return resolve({ ok: false, error: '监控进程未运行' });
      const client = net.createConnection(socketPath, () => {
        client.write(JSON.stringify({ cmd: 'pause', roomId: room_id }));
      });
      let buf = '';
      client.on('data', (chunk) => { buf += chunk.toString(); });
      client.on('end', () => { try { client.destroy(); } catch {} try { resolve(JSON.parse(buf)); } catch { resolve({ ok: false, error: '解析响应失败' }); } });
      client.on('error', (e) => resolve({ ok: false, error: e.message }));
      setTimeout(() => { try { client.destroy(); } catch {} resolve({ ok: false, error: '超时' }); }, 3000);
    });
    return sendJSON(res, result, result.ok ? 200 : 500);
  }

  // --- 恢复房间 ---
  if (pathname === '/api/rooms/resume' && req.method === 'POST') {
    const body = await bodyParse(req);
    const { room_id } = body;
    if (!room_id) return sendError(res, '缺少 room_id', 400);
    const net = require('net');
    const result = await new Promise((resolve, reject) => {
      const socketPath = path.join(DATA_DIR, 'monitor.sock');
      if (!fs.existsSync(socketPath)) return resolve({ ok: false, error: '监控进程未运行' });
      const client = net.createConnection(socketPath, () => {
        client.write(JSON.stringify({ cmd: 'resume', roomId: room_id }));
      });
      let buf = '';
      client.on('data', (chunk) => { buf += chunk.toString(); });
      client.on('end', () => { try { client.destroy(); } catch {} try { resolve(JSON.parse(buf)); } catch { resolve({ ok: false, error: '解析响应失败' }); } });
      client.on('error', (e) => resolve({ ok: false, error: e.message }));
      setTimeout(() => { try { client.destroy(); } catch {} resolve({ ok: false, error: '超时' }); }, 3000);
    });
    return sendJSON(res, result, result.ok ? 200 : 500);
  }

  // --- 添加房间 ---
  if (pathname === '/api/rooms/add' && req.method === 'POST') {
    const body = await bodyParse(req);
    const { room_id, name } = body;
    if (!room_id) return sendError(res, '缺少 room_id', 400);
    if (!/^[A-Za-z0-9]{5,30}$/.test(room_id)) return sendError(res, 'room_id 格式无效（5-30位字母数字）', 400);
    const net = require('net');
    const result = await new Promise((resolve, reject) => {
      const socketPath = path.join(DATA_DIR, 'monitor.sock');
      if (!fs.existsSync(socketPath)) return resolve({ ok: false, error: '监控进程未运行' });
      const client = net.createConnection(socketPath, () => {
        client.write(JSON.stringify({ cmd: 'add', roomId: room_id }));
      });
      let buf = '';
      client.on('data', (chunk) => { buf += chunk.toString(); });
      client.on('end', () => { try { client.destroy(); } catch {} try { resolve(JSON.parse(buf)); } catch { resolve({ ok: false, error: '解析响应失败' }); } });
      client.on('error', (e) => resolve({ ok: false, error: e.message }));
      setTimeout(() => { try { client.destroy(); } catch {} resolve({ ok: false, error: '超时' }); }, 15000);
    });
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
    return sendJSON(res, result, result.ok ? 200 : 500);
  }

  // --- 删除房间 ---
  if (pathname === '/api/rooms/remove' && req.method === 'POST') {
    const body = await bodyParse(req);
    const { room_id, delete_data } = body;
    if (!room_id) return sendError(res, '缺少 room_id', 400);
    const net = require('net');
    const result = await new Promise((resolve, reject) => {
      const socketPath = path.join(DATA_DIR, 'monitor.sock');
      if (!fs.existsSync(socketPath)) return resolve({ ok: false, error: '监控进程未运行' });
      const client = net.createConnection(socketPath, () => {
        client.write(JSON.stringify({ cmd: 'remove', roomId: room_id }));
      });
      let buf = '';
      client.on('data', (chunk) => { buf += chunk.toString(); });
      client.on('end', () => { try { client.destroy(); } catch {} try { resolve(JSON.parse(buf)); } catch { resolve({ ok: false, error: '解析响应失败' }); } });
      client.on('error', (e) => resolve({ ok: false, error: e.message }));
      setTimeout(() => { try { client.destroy(); } catch {} resolve({ ok: false, error: '超时' }); }, 3000);
    });
    // 如果 monitor 移除成功，根据 delete_data 决定是否清理数据库
    if (result.ok) {
      try {
        if (delete_data) {
          // 彻底删除：删 sessions（级联删 danmaku/gifts/members/online_records）+ 删 streamer
          const streamer = dbInstance.prepare('SELECT id FROM streamers WHERE room_id = ?').get(room_id);
          if (streamer) {
            dbInstance.prepare('DELETE FROM sessions WHERE streamer_id = ?').run(streamer.id);
            dbInstance.prepare('DELETE FROM streamers WHERE id = ?').run(streamer.id);
          }
        }
      } catch (e) { console.error('[remove] DB cleanup error:', e.message); }
    }
    return sendJSON(res, result, result.ok ? 200 : 500);
  }

  return false;
};
