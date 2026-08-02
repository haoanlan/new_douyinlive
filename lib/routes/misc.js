const path = require('path');
const fs = require('fs');

module.exports = async function(pathname, query, req, res, ctx) {
  const { dbInstance, sendJSON, sendError, sendCSV, bodyParse, comboDedupGifts, DATA_DIR, reportImg } = ctx;

  // --- 趋势数据 ---
  if (pathname === '/api/trends') {
    const range = query.range || '7d'; // 7d, 30d, 90d, all
    const groupBy = query.group || 'day'; // day, week, month

    // 白名单校验，防止 SQL 注入
    const validRanges = ['7d', '30d', '90d', 'all'];
    const validGroups = ['day', 'week', 'month'];
    if (!validRanges.includes(range)) { res.writeHead(400); res.end(JSON.stringify({ error: 'Invalid range' })); return; }
    if (!validGroups.includes(groupBy)) { res.writeHead(400); res.end(JSON.stringify({ error: 'Invalid group' })); return; }

    let dateExpr, groupExpr;
    if (groupBy === 'day') {
      dateExpr = "date(create_time/1000, 'unixepoch', 'localtime')";
      groupExpr = dateExpr;
    } else if (groupBy === 'week') {
      dateExpr = "date(create_time/1000, 'unixepoch', 'localtime', 'weekday 0', '-6 days')";
      groupExpr = dateExpr;
    } else {
      dateExpr = "strftime('%Y-%m', create_time/1000, 'unixepoch', 'localtime')";
      groupExpr = dateExpr;
    }

    let where = '';
    if (range === '7d') where = "WHERE CAST(create_time/1000 AS INTEGER) >= CAST(strftime('%s', 'now', '-7 days') AS INTEGER)";
    else if (range === '30d') where = "WHERE CAST(create_time/1000 AS INTEGER) >= CAST(strftime('%s', 'now', '-30 days') AS INTEGER)";
    else if (range === '90d') where = "WHERE CAST(create_time/1000 AS INTEGER) >= CAST(strftime('%s', 'now', '-90 days') AS INTEGER)";

    // 礼物趋势（需要去重）
    let whereSql = '';
    if (range === '7d') whereSql = "WHERE CAST(create_time/1000 AS INTEGER) >= CAST(strftime('%s', 'now', '-7 days') AS INTEGER)";
    else if (range === '30d') whereSql = "WHERE CAST(create_time/1000 AS INTEGER) >= CAST(strftime('%s', 'now', '-30 days') AS INTEGER)";
    else if (range === '90d') whereSql = "WHERE CAST(create_time/1000 AS INTEGER) >= CAST(strftime('%s', 'now', '-90 days') AS INTEGER)";

    const rawGifts = dbInstance.prepare(
      `SELECT id, nickname, user_display_id, gift_name, user_sec_uid, to_user_sec_uid, to_user_display_id, to_nickname, repeat_count, total_diamonds, combo_count, repeat_end, create_time FROM gifts ${whereSql} ORDER BY id`
    ).all();
    const dedupedGifts = comboDedupGifts(rawGifts);
    // 按日期分组
    const trendMap = {};
    for (const g of dedupedGifts) {
      let dateStr;
      const ts = g.create_time;
      if (typeof ts === 'number') {
        const d = new Date(ts > 1e12 ? ts : ts * 1000);
        if (groupBy === 'day') dateStr = d.toLocaleDateString('zh-CN');
        else if (groupBy === 'week') { const wd = d.getDay(); const diff = wd === 0 ? 6 : wd - 1; d.setDate(d.getDate() - diff); dateStr = d.toLocaleDateString('zh-CN'); }
        else dateStr = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
      } else {
        dateStr = String(ts).slice(0, 10);
      }
      if (!trendMap[dateStr]) trendMap[dateStr] = { date: dateStr, total_diamonds: 0, gift_count: 0, senders: new Set() };
      trendMap[dateStr].total_diamonds += g.total_diamonds || 0;
      trendMap[dateStr].gift_count += g.repeat_count || 1;
      if (g.nickname) trendMap[dateStr].senders.add(g.nickname);
    }
    const giftTrend = Object.values(trendMap).map(t => ({
      date: t.date, total_diamonds: t.total_diamonds, gift_count: t.gift_count, sender_count: t.senders.size
    })).sort((a, b) => a.date.localeCompare(b.date));

    // 弹幕趋势
    const danmakuTrend = dbInstance.prepare(`
      SELECT ${groupExpr} as date,
        COUNT(*) as danmaku_count,
        COUNT(DISTINCT nickname) as sender_count
      FROM danmaku ${where} GROUP BY ${groupExpr} ORDER BY date
    `).all();

    // 在线人数趋势（sessions 表用 start_time，是 TEXT 类型）
    let sessionDateExpr;
    if (groupBy === 'day') {
      sessionDateExpr = "date(start_time)";
    } else if (groupBy === 'week') {
      sessionDateExpr = "date(start_time, 'weekday 0', '-6 days')";
    } else {
      sessionDateExpr = "strftime('%Y-%m', start_time)";
    }

    const onlineTrend = dbInstance.prepare(`
      SELECT s2.date, MAX(or2.count) as peak_online
      FROM (
        SELECT ${sessionDateExpr} as date, id as session_id
        FROM sessions WHERE start_time IS NOT NULL
      ) s2
      LEFT JOIN online_records or2 ON s2.session_id = or2.session_id
      GROUP BY s2.date ORDER BY s2.date
    `).all();

    return sendJSON(res, { giftTrend, danmakuTrend, onlineTrend });
  }

  // --- 弹幕搜索 ---
  if (pathname === '/api/danmaku/search') {
    const keyword = query.q;
    if (!keyword) return sendError(res, '缺少搜索关键词', 400);
    const page = parseInt(query.page) || 1;
    const limit = parseInt(query.limit) || 50;
    const offset = (page - 1) * limit;

    const rows = dbInstance.prepare(`
      SELECT d.*, s.start_time as session_time, st.name as streamer_name
      FROM danmaku d
      LEFT JOIN sessions s ON d.session_id = s.id
      LEFT JOIN streamers st ON s.streamer_id = st.id
      WHERE d.content LIKE ? ORDER BY d.create_time DESC LIMIT ? OFFSET ?
    `).all(`%${keyword}%`, limit, offset);

    const total = dbInstance.prepare(`
      SELECT COUNT(*) as c FROM danmaku WHERE content LIKE ?
    `).get(`%${keyword}%`).c;

    return sendJSON(res, { data: rows, total, page, limit });
  }

  // --- 实时监控状态 ---
  if (pathname === '/api/status') {
    // 从 monitor 的 control socket 获取状态
    const net = require('net');
    const statusData = await new Promise((resolve) => {
      const sock = net.createConnection(path.join(DATA_DIR, 'monitor.sock'));
      let buf = '';
      sock.on('data', chunk => { buf += chunk.toString(); });
      sock.on('end', () => {
        try { resolve(JSON.parse(buf)); } catch { resolve({ ok: false, error: '解析失败' }); }
      });
      sock.on('error', () => resolve({ ok: false, error: '守护进程未运行' }));
      sock.setTimeout(3000, () => { sock.destroy(); resolve({ ok: false, error: '超时' }); });
      sock.write(JSON.stringify({ cmd: 'status' }));
    });
    return sendJSON(res, statusData);
  }

  // --- 导出 CSV：礼物 ---
  if (pathname === '/api/export/gifts') {
    let sessionIds = query.session_id;
    if (!Array.isArray(sessionIds)) sessionIds = sessionIds ? [sessionIds] : [];
    let sql = 'SELECT * FROM gifts';
    const params = [];
    if (sessionIds.length > 0) {
      sql += ` WHERE session_id IN (${sessionIds.map(() => '?').join(',')})`;
      params.push(...sessionIds.map(Number));
    }
    sql += ' ORDER BY create_time DESC';
    const rows = dbInstance.prepare(sql).all(...params);
    const headers = ['id', 'session_id', 'nickname', 'gift_name', 'diamond_count', 'repeat_count',
      'total_diamonds', 'to_nickname', 'create_time', 'user_sec_uid', 'trace_id'];
    const csvRows = rows.map(r => headers.map(h => r[h]));
    return sendCSV(res, `礼物记录_${new Date().toISOString().slice(0,10)}.csv`, csvRows, headers);
  }

  // --- 导出 CSV：弹幕 ---
  if (pathname === '/api/export/danmaku') {
    let sessionIds = query.session_id;
    if (!Array.isArray(sessionIds)) sessionIds = sessionIds ? [sessionIds] : [];
    let sql = 'SELECT * FROM danmaku';
    const params = [];
    if (sessionIds.length > 0) {
      sql += ` WHERE session_id IN (${sessionIds.map(() => '?').join(',')})`;
      params.push(...sessionIds.map(Number));
    }
    sql += ' ORDER BY create_time DESC';
    const rows = dbInstance.prepare(sql).all(...params);
    const headers = ['id', 'session_id', 'nickname', 'content', 'create_time', 'user_sec_uid'];
    const csvRows = rows.map(r => headers.map(h => r[h]));
    return sendCSV(res, `弹幕记录_${new Date().toISOString().slice(0,10)}.csv`, csvRows, headers);
  }

  // --- 导出 CSV：场次汇总 ---
  if (pathname === '/api/export/sessions') {
    const rows = dbInstance.prepare(`
      SELECT s.id, st.name as streamer_name, s.room_title, s.start_time, s.end_time,
        s.duration_seconds, s.stats_danmaku, s.stats_gift, s.stats_like,
        s.stats_member, s.stats_follow, s.online_peak
      FROM sessions s LEFT JOIN streamers st ON s.streamer_id = st.id
      ORDER BY s.start_time DESC
    `).all();
    const headers = ['id', 'streamer_name', 'room_title', 'start_time', 'end_time',
      'duration_seconds', 'stats_danmaku', 'stats_gift', 'stats_like',
      'stats_member', 'stats_follow', 'online_peak'];
    const csvRows = rows.map(r => headers.map(h => r[h]));
    return sendCSV(res, `场次汇总_${new Date().toISOString().slice(0,10)}.csv`, csvRows, headers);
  }

  // --- 生成图片报告 ---
  if (pathname === '/api/report/generate' && req.method === 'POST') {
    const body = await bodyParse(req);
    const sessionId = body.session_id;
    if (!sessionId) return sendError(res, '缺少 session_id', 400);

    const data = await reportImg.loadFromDb(sessionId);
    if (!data) return sendError(res, '无法加载场次数据', 404);

    const pngPath = await reportImg.generateImage(data);
    return sendJSON(res, { ok: true, path: pngPath });
  }

  // --- 获取报告图片 ---
  if (pathname === '/api/report/image') {
    const reportPath = path.join(DATA_DIR, 'reports', 'report_image.jpg');
    if (!fs.existsSync(reportPath)) return sendError(res, '报告图片不存在', 404);
    res.writeHead(200, { 'Content-Type': 'image/jpeg', 'Access-Control-Allow-Origin': '*' });
    fs.createReadStream(reportPath).pipe(res);
    return;
  }

  // --- 总览统计 ---
  if (pathname === '/api/summary') {
    // 已结束场次：直接用预聚合数据（<1ms）
    const completed = dbInstance.prepare(`
      SELECT
        COUNT(*) as total_sessions,
        COALESCE(SUM(agg_gifts), 0) as total_gifts,
        COALESCE(SUM(agg_diamonds), 0) as total_diamonds,
        COALESCE(SUM(agg_danmaku), 0) as total_danmaku,
        COALESCE(SUM(stats_like), 0) as total_likes
      FROM sessions WHERE (agg_gifts > 0 OR agg_danmaku > 0) AND end_time IS NOT NULL
    `).get();
    // unique_users 跨场次去重，不能 SUM，用 SQL COUNT DISTINCT（有索引，快）
    const usersRow = dbInstance.prepare('SELECT COUNT(DISTINCT user_sec_uid) as cnt FROM gifts').get();
    const danmakuUsersRow = dbInstance.prepare('SELECT COUNT(DISTINCT user_sec_uid) as cnt FROM danmaku WHERE user_sec_uid IS NOT NULL').get();
    // 合并礼物+弹幕的独立用户
    const allUsers = dbInstance.prepare(`
      SELECT COUNT(DISTINCT user_sec_uid) as cnt FROM (
        SELECT user_sec_uid FROM gifts WHERE user_sec_uid IS NOT NULL
        UNION
        SELECT user_sec_uid FROM danmaku WHERE user_sec_uid IS NOT NULL
      )
    `).get();
    // 直播中场次：实时计算（只查单场，几千条）
    const liveSessions = dbInstance.prepare('SELECT id FROM sessions WHERE end_time IS NULL AND archived = 0').all();
    let liveGifts = 0, liveDiamonds = 0, liveDanmaku = 0;
    for (const ls of liveSessions) {
      const rawGifts = dbInstance.prepare('SELECT * FROM gifts WHERE session_id = ? ORDER BY id').all(ls.id);
      const deduped = comboDedupGifts(rawGifts);
      liveGifts += deduped.reduce((s, g) => s + (g.repeat_count || 1), 0);
      liveDiamonds += deduped.reduce((s, g) => s + (g.total_diamonds || 0), 0);
      const dm = dbInstance.prepare('SELECT COUNT(*) as cnt FROM danmaku WHERE session_id = ?').get(ls.id);
      liveDanmaku += dm.cnt;
    }
    const liveCount = liveSessions.length;
    const offlineCount = dbInstance.prepare("SELECT COUNT(*) as cnt FROM sessions WHERE end_time IS NOT NULL AND archived = 1").get().cnt;
    return sendJSON(res, {
      total_sessions: completed.total_sessions + liveCount,
      total_gifts: completed.total_gifts + liveGifts,
      total_diamonds: completed.total_diamonds + liveDiamonds,
      total_danmaku: completed.total_danmaku + liveDanmaku,
      unique_users: allUsers.cnt,
      live_count: liveCount,
      offline_count: offlineCount,
      total_likes: completed.total_likes
    });
  }

  return false;
};
