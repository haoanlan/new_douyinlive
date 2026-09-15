const path = require('path');
const fs = require('fs');
const workerControl = require('../worker-control.js');

module.exports = async function(pathname, query, req, res, ctx) {
  const { dbInstance, sendJSON, sendError, bodyParse, DATA_DIR, getCookie } = ctx;

  // --- 查询房间信息（供「添加房间」先预览确认）---
  //
  // 数据来源优先级（实测：匿名环境下只有代理可用）：
  //   1) Go 抓取代理 —— 匿名即可用，不需要 cookie。但 /anchor 只在**开播中**才返回
  //   2) 本地 streamers 表 —— 之前监控过、已解析出主播名的房间
  //   3) lib/douyin-api.js —— 需要 cookie，未配置时基本查不到（保留作为兜底）
  if (pathname === '/api/rooms/lookup' && req.method === 'GET') {
    const input = (query.room_id || query.q || '').trim();
    if (!input) return sendError(res, '请输入房间号或抖音号', 400);

    const proxyBase = `http://127.0.0.1:${require('../proxy-binary').PORT}`;
    const proxyJson = async (p, opts = {}, timeout = 12000) => {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), timeout);
      try {
        const r = await fetch(`${proxyBase}${p}`, {
          method: opts.method || 'GET',
          headers: opts.body ? { 'Content-Type': 'application/json' } : undefined,
          body: opts.body ? JSON.stringify(opts.body) : undefined,
          signal: ctrl.signal,
        });
        if (!r.ok) return null;
        return await r.json();
      } catch { return null; } finally { clearTimeout(timer); }
    };

    // 代理对上游是被限流的：实测同一个房间连续请求 /anchor 会 200/503 交替出现
    // （约一半失败），status:batch 也会间歇性返回 unknown。所以必须重试。
    const proxyRetry = async (p, opts = {}, { retries = 4, delayMs = 300 } = {}) => {
      let last = null;
      for (let i = 0; i <= retries; i++) {
        const r = await proxyJson(p, opts);
        if (r && r.ok && r.data) {
          last = r.data;
          // status:batch 返回的 "unknown" 表示上游没确认（不是有效结果）→ 重试。
          // 注意这个判断必须在提前 return 之前，否则永远走不到。
          const itemStatus = r.data?.items?.[0]?.status;
          if (!itemStatus || itemStatus !== 'unknown') return r.data;
        }
        if (i < retries) await new Promise((res) => setTimeout(res, delayMs));
      }
      return last;   // 全部重试完仍是 unknown 时返回最后一次（至少能拿到 title）
    };

    try {
      if (/^[A-Za-z0-9]{5,30}$/.test(input)) {
        let configRooms = [];
        try {
          configRooms = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'runtime-config.json'), 'utf-8')).rooms || [];
        } catch { /* ignore */ }

        let hasRoom = false, isLive = false, roomStatus = 'unknown';
        let roomTitle = '', nickname = '', avatar = '', nameSource = 'none';

        // 1) 先问 /anchor：直播中时一次就能拿到 状态 + 主播昵称 + 头像
        const anchorData = await proxyRetry(`/api/v1/rooms/${encodeURIComponent(input)}/anchor`);
        if (anchorData) {
          hasRoom = anchorData.has_room === true;
          isLive = anchorData.status === 'online';
          roomStatus = anchorData.status || 'unknown';
          const a = anchorData.anchor;
          if (a?.nickname) { nickname = a.nickname; avatar = a.avatar_thumb || ''; nameSource = 'proxy'; }
        }

        // 2) /anchor 未开播时不可用 → 用 status:batch 至少拿到状态与直播间标题
        if (roomStatus === 'unknown' || !roomTitle) {
          const batch = await proxyRetry('/api/v1/rooms/status:batch', { method: 'POST', body: { live_ids: [input] } });
          const item = batch?.items?.[0];
          if (item) {
            if (item.status && item.status !== 'unknown') {
              hasRoom = item.has_room === true;
              isLive = item.is_live === true;
              roomStatus = item.status;
            }
            roomTitle = item.title || roomTitle;
          }
        }

        // 3) 代理拿不到（未开播）→ 查本地库（之前监控过就有名字）
        if (!nickname) {
          try {
            const row = dbInstance.prepare(
              "SELECT name, avatar FROM streamers WHERE room_id = ? AND name IS NOT NULL AND name != '' ORDER BY id DESC LIMIT 1"
            ).get(input);
            if (row?.name) { nickname = row.name; avatar = row.avatar || ''; nameSource = 'db'; }
          } catch { /* ignore */ }
        }

        // 4) 仍没有 → 兜底走 douyin-api（需要 cookie，未配置时查不到）
        if (!nickname) {
          try {
            const api = require('../douyin-api.js');
            const liveInfo = await api.getLiveInfo(input);
            if (liveInfo?.sec_uid) {
              const ui = await api.getUserInfo(liveInfo.sec_uid);
              if (ui?.nickname) {
                nickname = ui.nickname;
                avatar = ui.avatar_thumb?.url_list?.[0] || '';
                nameSource = 'douyin-api';
                if (!roomTitle) roomTitle = liveInfo.room_title || '';
              }
            }
          } catch { /* 未配置 cookie 时忽略 */ }
        }

        return sendJSON(res, {
          ok: true,
          room_id: input,
          real_room_id: input,
          nickname,
          avatar,
          room_title: roomTitle,
          is_live: isLive,
          room_status: roomStatus,
          has_room: hasRoom,
          already_monitored: configRooms.some((c) => c && c.id === input),
          name_source: nameSource,
        });
      } else {
        // 抖音号 → 搜索用户页面（保持原有行为）
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
            unique_id: uniqueId || '', sec_uid: secUid || '', is_live: !!roomId && roomId !== '0',
            room_status: roomId && roomId !== '0' ? 'online' : 'offline',
            has_room: !!roomId, name_source: 'search',
          });
        }
        return sendError(res, '未找到该用户（抖音号查询需要配置 cookie）', 404);
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
        // 代理对本次连接的直播状态判定码：ROOM_ONLINE / ROOM_OFFLINE / ROOM_ENDED /
        // ROOM_STATUS_UNKNOWN（或 null=刚连上还没结论）。前端据此区分
        // "已连接但代理尚未确认开播"（连接中）与"已确认未开播"（监控中）。
        statusCode: daemon?.statusCode ?? null,
        roomTitle: daemon?.title || '',
        // 状态来源：socket 实时 / log 兜底（页面可据此提示"略有延迟"）
        statusSource: roomStatus.source,
        statusStale: roomStatus.stale
      };
    });
    // 配置里已添加、但 streamers 表还没有记录的房间也要列出来。
    // 否则「添加房间」后列表里看不到它（尤其是不填主播名时），必须等 worker
    // 解析出主播名、或主播开播建档后才会出现 → 用户会以为没加上，得手动刷新。
    const listed = new Set(result.map((r) => r.room_id));
    for (const c of configRooms) {
      if (!c || !c.id || listed.has(c.id)) continue;
      const daemon = daemonRooms[c.id] || daemonRooms[c.name];
      const enabled = c.enabled !== false;
      result.push({
        id: null,                    // 还没有 streamers 记录
        room_id: c.id,
        name: c.name || c.id,
        avatar: '',
        session_count: 0,
        total_likes: 0,
        last_session_time: null,
        enabled,
        connected: Boolean(daemon?.connected),
        recording: Boolean(daemon?.recording),
        liveStatus: daemon?.liveStatus ?? null,
        // 代理对本次连接的直播状态判定码：ROOM_ONLINE / ROOM_OFFLINE / ROOM_ENDED /
        // ROOM_STATUS_UNKNOWN（或 null=刚连上还没结论）。前端据此区分
        // "已连接但代理尚未确认开播"（连接中）与"已确认未开播"（监控中）。
        statusCode: daemon?.statusCode ?? null,
        roomTitle: daemon?.title || '',
        statusSource: roomStatus.source,
        statusStale: roomStatus.stale,
        // 主播资料尚未解析出来（页面可据此提示"资料获取中"）
        pending: true
      });
    }

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
