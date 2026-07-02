#!/usr/bin/env node
/**
 * 抖音直播监控 - Web 仪表板
 * 端口: 9871
 * 功能: 场次管理、礼物排行、弹幕记录、用户画像、趋势分析、CSV导出、图片报告
 */
const http = require('http');
const path = require('path');
const fs = require('fs');
const url = require('url');
const zlib = require('zlib');
const db = require('./db-sqlite.js');
const reportImg = require('./report-image.js');

const PORT = process.env.DASHBOARD_PORT || 9871;
const DATA_DIR = __dirname;

// ====== 读取抖音Cookie ======
function getCookie() {
  try {
    const yaml = require('fs').readFileSync(require('path').join(__dirname, 'config.yaml'), 'utf-8');
    const m = yaml.match(/cookie:\s*douyin:\s*(?:'([^']+)'|"([^"]+)")/);
    return m ? (m[1] || m[2]) : '';
  } catch { return ''; }
}

// ====== 工具函数 ======
function sendJSON(res, data, status = 200) {
  const json = JSON.stringify(data);
  const accept = res.req?.headers?.['accept-encoding'] || '';
  if (accept.includes('gzip') && json.length > 1024) {
    const compressed = zlib.gzipSync(json);
    res.writeHead(status, {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Encoding': 'gzip',
      'Access-Control-Allow-Origin': '*'
    });
    res.end(compressed);
  } else {
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*' });
    res.end(json);
  }
}

function sendError(res, msg, status = 500) {
  sendJSON(res, { error: msg }, status);
}

function sendCSV(res, filename, rows, headers) {
  res.writeHead(200, {
    'Content-Type': 'text/csv; charset=utf-8',
    'Content-Disposition': `attachment; filename="${encodeURIComponent(filename)}"`,
    'Access-Control-Allow-Origin': '*'
  });
  // BOM for Excel
  res.write('\uFEFF');
  res.write(headers.join(',') + '\n');
  for (const row of rows) {
    res.write(row.map(v => `"${String(v ?? '').replace(/"/g, '""')}"`).join(',') + '\n');
  }
  res.end();
}

function parseQuery(reqUrl) {
  const u = new URL(reqUrl, 'http://localhost');
  const q = {};
  for (const [k, v] of u.searchParams) q[k] = v;
  return { pathname: u.pathname, query: q };
}

function bodyParse(req) {
  return new Promise((resolve) => {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try { resolve(JSON.parse(body)); } catch { resolve({}); }
    });
  });
}

// ====== API 路由 ======
async function handleAPI(req, res) {
  const { pathname, query } = parseQuery(req.url);
  const dbInstance = db.getDb();

  try {
    // --- 流主播列表 ---
    if (pathname === '/api/streamers') {
      const rows = dbInstance.prepare(`
        SELECT s.*, 
          (SELECT COUNT(*) FROM sessions WHERE streamer_id = s.id) as session_count,
          (SELECT SUM(stats_danmaku) FROM sessions WHERE streamer_id = s.id) as total_danmaku,
          (SELECT SUM(stats_gift) FROM sessions WHERE streamer_id = s.id) as total_gifts
        FROM streamers s ORDER BY s.name
      `).all();
      return sendJSON(res, rows);
    }

    // --- 场次列表 ---
    if (pathname === '/api/sessions') {
      const streamerId = query.streamer_id;
      let sql = `SELECT s.*, st.name as streamer_name, st.avatar as streamer_avatar
        FROM sessions s LEFT JOIN streamers st ON s.streamer_id = st.id`;
      const params = [];
      if (streamerId) { sql += ' WHERE s.streamer_id = ?'; params.push(streamerId); }
      sql += ' ORDER BY s.start_time DESC';
      if (query.limit) { sql += ' LIMIT ?'; params.push(parseInt(query.limit)); }
      const rows = dbInstance.prepare(sql).all(...params);
      return sendJSON(res, rows);
    }

    // --- 场次详情 ---
    if (pathname.startsWith('/api/sessions/') && !pathname.includes('/')) {
      const sid = parseInt(pathname.split('/')[3]);
      const session = dbInstance.prepare(`
        SELECT s.*, st.name as streamer_name, st.avatar as streamer_avatar
        FROM sessions s LEFT JOIN streamers st ON s.streamer_id = st.id WHERE s.id = ?
      `).get(sid);
      if (!session) return sendError(res, '场次不存在', 404);
      return sendJSON(res, session);
    }

    // --- 场次礼物 ---
    if (pathname.startsWith('/api/sessions/') && pathname.endsWith('/gifts')) {
      const sid = parseInt(pathname.split('/')[3]);
      const page = parseInt(query.page) || 1;
      const limit = parseInt(query.limit) || 50;
      const offset = (page - 1) * limit;
      const rows = dbInstance.prepare(`
        SELECT * FROM gifts WHERE session_id = ? ORDER BY create_time DESC LIMIT ? OFFSET ?
      `).all(sid, limit, offset);
      const total = dbInstance.prepare('SELECT COUNT(*) as c FROM gifts WHERE session_id = ?').get(sid).c;
      return sendJSON(res, { data: rows, total, page, limit });
    }

    // --- 场次弹幕 ---
    if (pathname.startsWith('/api/sessions/') && pathname.endsWith('/danmaku')) {
      const sid = parseInt(pathname.split('/')[3]);
      const page = parseInt(query.page) || 1;
      const limit = parseInt(query.limit) || 50;
      const offset = (page - 1) * limit;
      const user = query.user;
      let sql = 'SELECT * FROM danmaku WHERE session_id = ?';
      const params = [sid];
      if (user) { sql += ' AND nickname LIKE ?'; params.push(`%${user}%`); }
      sql += ' ORDER BY create_time DESC LIMIT ? OFFSET ?';
      params.push(limit, offset);
      const rows = dbInstance.prepare(sql).all(...params);
      const countSql = user
        ? 'SELECT COUNT(*) as c FROM danmaku WHERE session_id = ? AND nickname LIKE ?'
        : 'SELECT COUNT(*) as c FROM danmaku WHERE session_id = ?';
      const countParams = user ? [sid, `%${user}%`] : [sid];
      const total = dbInstance.prepare(countSql).get(...countParams).c;
      return sendJSON(res, { data: rows, total, page, limit });
    }

    // --- 场次在线人数 ---
    if (pathname.startsWith('/api/sessions/') && pathname.endsWith('/online')) {
      const sid = parseInt(pathname.split('/')[3]);
      const rows = dbInstance.prepare(`
        SELECT count, recorded_at FROM online_records WHERE session_id = ? ORDER BY recorded_at
      `).all(sid);
      return sendJSON(res, rows);
    }

    // --- 礼物排行（全量/按场次） ---
    if (pathname === '/api/gifts/ranking') {
      const sessionId = query.session_id;
      const period = query.period || 'all'; // all, today, week, month
      let sql, params = [];

      if (sessionId) {
        // 按场次去重排行
        sql = `SELECT nickname, avatar, user_sec_uid,
          SUM(diamond_count * repeat_count) as total_diamonds,
          COUNT(*) as gift_count,
          GROUP_CONCAT(DISTINCT gift_name) as gift_types
          FROM gifts WHERE session_id = ?
          GROUP BY nickname
          ORDER BY total_diamonds DESC LIMIT ?`;
        // 简化：直接按 nickname 聚合
        sql = `SELECT nickname, avatar, user_sec_uid,
          SUM(total_diamonds) as total_diamonds,
          COUNT(DISTINCT gift_name) as gift_types_count,
          GROUP_CONCAT(DISTINCT gift_name) as gift_types,
          COUNT(*) as gift_count
          FROM gifts WHERE session_id = ?
          GROUP BY nickname ORDER BY total_diamonds DESC LIMIT ?`;
        params = [sessionId, parseInt(query.limit) || 100];
      } else {
        // 全量排行（按时间段）
        let where = '';
        if (period === 'today') where = "WHERE create_time >= datetime('now','start of day','localtime')";
        else if (period === 'week') where = "WHERE create_time >= datetime('now','weekday 0','-7 days','localtime')";
        else if (period === 'month') where = "WHERE create_time >= datetime('now','start of month','localtime')";

        sql = `SELECT nickname, avatar, user_sec_uid,
          SUM(total_diamonds) as total_diamonds,
          COUNT(DISTINCT gift_name) as gift_types_count,
          GROUP_CONCAT(DISTINCT gift_name) as gift_types,
          COUNT(*) as gift_count
          FROM gifts ${where}
          GROUP BY nickname ORDER BY total_diamonds DESC LIMIT ?`;
        params = [parseInt(query.limit) || 100];
      }
      const rows = dbInstance.prepare(sql).all(...params);
      return sendJSON(res, rows);
    }

    // --- 礼物类型排行 ---
    if (pathname === '/api/gifts/by-type') {
      const sessionId = query.session_id;
      let sql = `SELECT gift_name,
        SUM(diamond_count * repeat_count) as total_diamonds,
        COUNT(*) as send_count,
        COUNT(DISTINCT nickname) as sender_count
        FROM gifts`;
      const params = [];
      if (sessionId) { sql += ' WHERE session_id = ?'; params.push(sessionId); }
      sql += ' GROUP BY gift_name ORDER BY total_diamonds DESC LIMIT ?';
      params.push(parseInt(query.limit) || 50);
      const rows = dbInstance.prepare(sql).all(...params);
      return sendJSON(res, rows);
    }

    // --- 用户搜索（按昵称，含弹幕） ---
    if (pathname === '/api/users/search') {
      const q = query.q;
      if (!q) return sendError(res, '缺少搜索词', 400);
      const rows = dbInstance.prepare(`
        SELECT DISTINCT user_sec_uid, nickname, avatar
        FROM gifts WHERE nickname LIKE ? OR user_sec_uid LIKE ?
        UNION
        SELECT DISTINCT user_sec_uid, nickname, avatar
        FROM danmaku WHERE nickname LIKE ? OR user_sec_uid LIKE ?
        LIMIT 20
      `).all(`%${q}%`, `%${q}%`, `%${q}%`, `%${q}%`);
      return sendJSON(res, rows);
    }

    // --- 匿名查询（昵称→sec_uid→API查真实信息） ---
    if (pathname === '/api/anonymous-lookup') {
      const q = query.q;
      if (!q) return sendError(res, '缺少搜索词', 400);
      // 从 gifts + danmaku + members 中查找匹配的 sec_uid，收集所有昵称
      const allRows = dbInstance.prepare(`
        SELECT user_sec_uid, nickname, avatar, session_id, create_time, 'gift' as src FROM gifts WHERE nickname LIKE ?
        UNION ALL
        SELECT user_sec_uid, nickname, avatar, session_id, create_time, 'danmaku' as src FROM danmaku WHERE nickname LIKE ?
        UNION ALL
        SELECT user_sec_uid, nickname, avatar, session_id, create_time, 'member' as src FROM members WHERE nickname LIKE ?
        LIMIT 200
      `).all(`%${q}%`, `%${q}%`, `%${q}%`);
      if (!allRows.length) return sendJSON(res, { users: [] });

      // 按 sec_uid 去重聚合
      const userMap = {};
      for (const r of allRows) {
        const key = r.user_sec_uid || `_noname_${r.nickname}`;
        if (!userMap[key]) {
          userMap[key] = {
            sec_uid: r.user_sec_uid,
            db_nicknames: new Set(),
            db_avatar: r.avatar,
            session_ids: new Set(),
            latest_time: 0,
            latest_action: null,
          };
        }
        const u = userMap[key];
        if (r.nickname) u.db_nicknames.add(r.nickname);
        if (r.session_id) u.session_ids.add(r.session_id);
        // 追踪最新动作
        const t = r.create_time || 0;
        if (t > u.latest_time) {
          u.latest_time = t;
          let detail = '';
          if (r.src === 'gift') {
            const g = dbInstance.prepare('SELECT gift_name, repeat_count FROM gifts WHERE user_sec_uid = ? AND session_id = ? AND create_time = ? LIMIT 1').get(r.user_sec_uid, r.session_id, r.create_time);
            detail = g ? `送了 ${g.gift_name}${g.repeat_count > 1 ? ' ×' + g.repeat_count : ''}` : '送了礼物';
          } else if (r.src === 'danmaku') {
            const d = dbInstance.prepare('SELECT content FROM danmaku WHERE user_sec_uid = ? AND session_id = ? AND create_time = ? LIMIT 1').get(r.user_sec_uid, r.session_id, r.create_time);
            detail = d ? d.content : '发了弹幕';
          } else {
            detail = '进入直播间';
          }
          u.latest_action = { type: r.src, time: t, detail, session_id: r.session_id };
        }
      }

      // 查询场次名称
      const sessionIds = [...new Set(allRows.map(r => r.session_id).filter(Boolean))];
      const sessionMap = {};
      if (sessionIds.length) {
        const placeholders = sessionIds.map(() => '?').join(',');
        const sessRows = dbInstance.prepare(`
          SELECT s.id, s.start_time, st.name as streamer_name
          FROM sessions s LEFT JOIN streamers st ON s.streamer_id = st.id
          WHERE s.id IN (${placeholders})
        `).all(...sessionIds);
        for (const s of sessRows) sessionMap[s.id] = s;
      }

      // 对每个 sec_uid 调 API 查真实信息（限制并发防限流）
      const { fetchUserBySecUid } = require('./douyin-user');
      const users = Object.values(userMap);
      // 批量查每个用户每个场次的送礼钻石数
      const sessionDiamondMap = {};
      for (const u of users) {
        if (!u.sec_uid || !u.session_ids.size) continue;
        const sids = [...u.session_ids];
        const placeholders = sids.map(() => '?').join(',');
        const giftRows = dbInstance.prepare(`
          SELECT session_id, SUM(diamond_count * repeat_count) as diamonds
          FROM gifts WHERE user_sec_uid = ? AND session_id IN (${placeholders})
          GROUP BY session_id
        `).all(u.sec_uid, ...sids);
        for (const g of giftRows) {
          const key = `${u.sec_uid}_${g.session_id}`;
          sessionDiamondMap[key] = g.diamonds;
        }
      }

      const results = [];
      for (const u of users) {
        let apiInfo = null;
        if (u.sec_uid) {
          try { apiInfo = await fetchUserBySecUid(u.sec_uid); } catch (e) {}
        }
        // 场次列表（附带钻石数）
        const sessions = [...u.session_ids].map(sid => {
          const s = sessionMap[sid];
          const key = `${u.sec_uid}_${sid}`;
          return {
            id: sid,
            streamer_name: s?.streamer_name || '未知',
            start_time: s?.start_time || '',
            diamonds: sessionDiamondMap[key] || 0,
          };
        }).sort((a, b) => (b.start_time || '').localeCompare(a.start_time || ''));

        // 最近动作的场次名
        let latestAction = u.latest_action;
        if (latestAction && sessionMap[latestAction.session_id]) {
          latestAction = { ...latestAction, streamer_name: sessionMap[latestAction.session_id].streamer_name || '未知' };
        }

        results.push({
          sec_uid: u.sec_uid,
          db_nicknames: [...u.db_nicknames],
          db_avatar: u.db_avatar,
          api_nickname: apiInfo?.nickname || null,
          api_avatar: apiInfo?.avatar || null,
          nickname: apiInfo?.nickname || u.db_nicknames.values().next().value,
          avatar: apiInfo?.avatar || u.db_avatar,
          // API 详细信息
          signature: apiInfo?.signature || '',
          follower_count: apiInfo?.follower_count || 0,
          following_count: apiInfo?.following_count || 0,
          total_favorited: apiInfo?.total_favorited || 0,
          aweme_count: apiInfo?.aweme_count || 0,
          is_private: apiInfo?.is_private || false,
          unique_id: apiInfo?.unique_id || '',
          sessions,
          latest_action: latestAction,
        });
      }
      return sendJSON(res, { users: results });
    }

    // --- 用户画像 ---
    if (pathname.startsWith('/api/users/') && !pathname.endsWith('/search')) {
      const secUid = pathname.split('/')[3];
      if (!secUid) return sendError(res, '缺少用户 sec_uid', 400);

      // 基本信息
      const userGifts = dbInstance.prepare(`
        SELECT nickname, avatar,
          SUM(total_diamonds) as total_diamonds,
          COUNT(*) as gift_count,
          COUNT(DISTINCT gift_name) as gift_types_count,
          GROUP_CONCAT(DISTINCT gift_name) as gift_types
        FROM gifts WHERE user_sec_uid = ? GROUP BY user_sec_uid
      `).get(secUid);

      if (!userGifts) return sendError(res, '用户不存在', 404);

      // 活跃场次
      const activeSessions = dbInstance.prepare(`
        SELECT DISTINCT g.session_id, s.start_time, s.end_time, st.name as streamer_name,
          SUM(g.diamond_count * g.repeat_count) as session_diamonds
        FROM gifts g
        LEFT JOIN sessions s ON g.session_id = s.id
        LEFT JOIN streamers st ON s.streamer_id = st.id
        WHERE g.user_sec_uid = ?
        GROUP BY g.session_id ORDER BY s.start_time DESC
      `).all(secUid);

      // 常看时段（按小时统计）
      const hourStats = dbInstance.prepare(`
        SELECT strftime('%H', create_time/1000, 'unixepoch', 'localtime') as hour, COUNT(*) as count
        FROM gifts WHERE user_sec_uid = ? GROUP BY hour ORDER BY hour
      `).all(secUid);

      // 弹幕记录
      const danmakuCount = dbInstance.prepare(`
        SELECT COUNT(*) as c FROM danmaku WHERE user_sec_uid = ?
      `).get(secUid).c;

      // 礼物种类明细
      const giftBreakdown = dbInstance.prepare(`
        SELECT gift_name,
          SUM(diamond_count * repeat_count) as total_diamonds,
          COUNT(*) as count
        FROM gifts WHERE user_sec_uid = ?
        GROUP BY gift_name ORDER BY total_diamonds DESC
      `).all(secUid);

      return sendJSON(res, {
        ...userGifts,
        activeSessions,
        hourStats,
        giftBreakdown,
        danmakuCount,
        totalDiamonds: userGifts.total_diamonds,
        totalGifts: userGifts.gift_count,
        activeSessionCount: activeSessions.length,
        favoriteStreamer: activeSessions[0]?.streamer_name || '-'
      });
    }

    // --- 趋势数据 ---
    if (pathname === '/api/trends') {
      const range = query.range || '7d'; // 7d, 30d, 90d, all
      const groupBy = query.group || 'day'; // day, week, month

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

      // 礼物趋势
      const giftTrend = dbInstance.prepare(`
        SELECT ${groupExpr} as date,
          SUM(diamond_count * repeat_count) as total_diamonds,
          COUNT(*) as gift_count,
          COUNT(DISTINCT nickname) as sender_count
        FROM gifts ${where} GROUP BY ${groupExpr} ORDER BY date
      `).all();

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

    // ====== 新仪表板 API ======

    // --- 总览统计 ---
    if (pathname === '/api/summary') {
      const stats = dbInstance.prepare(`
        SELECT
          (SELECT COUNT(*) FROM sessions) as total_sessions,
          (SELECT COUNT(*) FROM sessions WHERE end_time IS NULL OR archived = 0) as live_count,
          (SELECT COUNT(*) FROM sessions WHERE end_time IS NOT NULL AND archived = 1) as offline_count,
          (SELECT COUNT(*) FROM gifts) as total_gifts,
          (SELECT COALESCE(SUM(diamond_count * repeat_count), 0) FROM gifts) as total_diamonds,
          (SELECT COUNT(*) FROM danmaku) as total_danmaku,
          (SELECT COUNT(DISTINCT user_sec_uid) FROM gifts) as unique_users,
          (SELECT COALESCE(SUM(stats_like), 0) FROM sessions) as total_likes
      `).get();
      return sendJSON(res, stats || { total_sessions:0, live_count:0, offline_count:0, total_gifts:0, total_diamonds:0, total_danmaku:0, unique_users:0 });
    }

    // --- 主播列表 ---
    if (pathname === '/api/hosts') {
      const rows = dbInstance.prepare(`
        SELECT s.*,
          (SELECT COUNT(*) FROM sessions WHERE streamer_id = s.id) as session_count,
          (SELECT end_time FROM sessions WHERE streamer_id = s.id ORDER BY start_time DESC LIMIT 1) as last_end_time,
          (SELECT archived FROM sessions WHERE streamer_id = s.id ORDER BY start_time DESC LIMIT 1) as last_archived
        FROM streamers s ORDER BY s.name
      `).all();
      return sendJSON(res, rows.map(r => ({
        sec_uid: String(r.id),
        nickname: r.name,
        avatar_url: r.avatar,
        session_count: r.session_count,
        is_live: r.last_end_time === null && r.last_archived === 0
      })));
    }

    // --- 主播场次列表 ---
    if (pathname.startsWith('/api/hosts/') && pathname.endsWith('/sessions')) {
      const hostId = pathname.split('/')[3];
      const streamer = dbInstance.prepare('SELECT id FROM streamers WHERE room_id = ? OR id = ?').get(hostId, parseInt(hostId));
      if (!streamer) return sendJSON(res, []);
      const rows = dbInstance.prepare(`
        SELECT s.*,
          (SELECT COUNT(DISTINCT user_sec_uid) FROM gifts WHERE session_id = s.id) as user_count,
          (SELECT COUNT(*) FROM gifts WHERE session_id = s.id) as gift_count,
          (SELECT COALESCE(SUM(diamond_count * repeat_count), 0) FROM gifts WHERE session_id = s.id) as total_diamonds,
          (SELECT COUNT(*) FROM danmaku WHERE session_id = s.id) as danmaku_count
        FROM sessions s WHERE s.streamer_id = ? ORDER BY s.start_time DESC
      `).all(streamer.id);
      return sendJSON(res, rows.map(r => ({
        id: r.id,
        title: r.room_title || `场次 #${r.id}`,
        is_live: r.end_time === null && r.archived === 0,
        started_at: r.start_time,
        ended_at: r.end_time,
        duration_min: r.duration_seconds ? Math.round(r.duration_seconds / 60) : null,
        gift_count: r.gift_count,
        total_diamonds: r.total_diamonds,
        danmaku_count: r.danmaku_count,
        user_count: r.user_count,
        stats_like: r.stats_like || 0
      })));
    }

    // --- 场次完整详情 ---
    if (pathname.startsWith('/api/sessions/') && pathname.endsWith('/detail')) {
      const sid = parseInt(pathname.split('/')[3]);
      const session = dbInstance.prepare(`
        SELECT s.*, st.name as streamer_name, st.avatar as streamer_avatar
        FROM sessions s LEFT JOIN streamers st ON s.streamer_id = st.id WHERE s.id = ?
      `).get(sid);
      if (!session) return sendError(res, '场次不存在', 404);

      // 礼物排行（按用户聚合，top 20）
      const gifts = dbInstance.prepare(`
        SELECT nickname, avatar as avatar_url, user_sec_uid,
          SUM(total_diamonds) as total_diamonds,
          COUNT(*) as gift_count
        FROM gifts WHERE session_id = ?
        GROUP BY nickname ORDER BY total_diamonds DESC LIMIT 20
      `).all(sid);

      // 每个用户的礼物种类明细
      const giftDetails = dbInstance.prepare(`
        SELECT g.nickname, g.gift_name, g.to_nickname,
          SUM(g.total_diamonds) as total_diamonds,
          CAST(SUM(g.total_diamonds) AS REAL) / MAX(g.diamond_count, 1) as count,
          (SELECT avatar FROM gifts WHERE session_id = ? AND nickname = g.nickname AND avatar IS NOT NULL LIMIT 1) as avatar_url,
          (SELECT icon FROM gifts WHERE session_id = ? AND nickname = g.nickname AND gift_name = g.gift_name AND icon IS NOT NULL LIMIT 1) as gift_icon
        FROM gifts g
        WHERE g.session_id = ?
        GROUP BY g.nickname, g.gift_name, g.to_nickname ORDER BY total_diamonds DESC
      `).all(sid, sid, sid);

      // 主播排名（按 to_user_sec_uid 聚合，同主播不同昵称合并）
      const anchorRanking = dbInstance.prepare(`
        SELECT g.anchor_sec_uid, g.anchor_name,
          COALESCE(g.to_avatar, u.avatar, dg.avatar, mg.avatar) as anchor_avatar,
          g.total_diamonds, g.gift_count, g.user_count
        FROM (
          SELECT to_user_sec_uid as anchor_sec_uid,
            (SELECT to_nickname FROM gifts WHERE session_id = ? AND to_user_sec_uid = g2.to_user_sec_uid AND to_nickname IS NOT NULL ORDER BY create_time DESC LIMIT 1) as anchor_name,
            MAX(to_avatar) as to_avatar,
            SUM(total_diamonds) as total_diamonds,
            COUNT(*) as gift_count,
            COUNT(DISTINCT nickname) as user_count
          FROM gifts g2 WHERE session_id = ? AND to_user_sec_uid IS NOT NULL
          GROUP BY to_user_sec_uid ORDER BY total_diamonds DESC
        ) g
        LEFT JOIN (
          SELECT user_sec_uid, avatar FROM gifts WHERE avatar IS NOT NULL GROUP BY user_sec_uid
        ) u ON g.anchor_sec_uid = u.user_sec_uid
        LEFT JOIN (
          SELECT user_sec_uid, avatar FROM danmaku WHERE avatar IS NOT NULL GROUP BY user_sec_uid
        ) dg ON g.anchor_sec_uid = dg.user_sec_uid
        LEFT JOIN (
          SELECT user_sec_uid, avatar FROM members WHERE avatar IS NOT NULL GROUP BY user_sec_uid
        ) mg ON g.anchor_sec_uid = mg.user_sec_uid
        ORDER BY g.total_diamonds DESC
      `).all(sid, sid);
      // 对仍然没有头像的主播，并发调用 API 获取（而非串行）
      const { fetchUserBySecUid } = require('./douyin-user');
      const avatarPromises = anchorRanking
        .filter(a => !a.anchor_avatar && a.anchor_sec_uid)
        .map(async a => {
          try {
            const info = await fetchUserBySecUid(a.anchor_sec_uid);
            if (info && info.avatar) {
              a.anchor_avatar = info.avatar;
              dbInstance.prepare('UPDATE gifts SET to_avatar = ? WHERE session_id = ? AND to_user_sec_uid = ? AND to_avatar IS NULL').run(info.avatar, sid, a.anchor_sec_uid);
            }
          } catch (e) { /* 静默 */ }
        });
      await Promise.all(avatarPromises);

      // 弹幕（最近500条，用于展示和搜索）
      const danmaku = dbInstance.prepare(`
        SELECT nickname, avatar as avatar_url, content, create_time as timestamp
        FROM danmaku WHERE session_id = ?
        ORDER BY create_time DESC
      `).all(sid);

      // 弹幕词频（用于词云）
      const danmakuWords = dbInstance.prepare(`
        SELECT content, COUNT(*) as cnt
        FROM danmaku WHERE session_id = ? AND content IS NOT NULL AND content != ''
        GROUP BY content ORDER BY cnt DESC LIMIT 100
      `).all(sid);

      // 弹幕用户排名（谁发的弹幕最多）
      const danmakuRanking = dbInstance.prepare(`
        SELECT nickname, avatar, user_sec_uid, COUNT(*) as msg_count
        FROM danmaku WHERE session_id = ? AND nickname IS NOT NULL
        GROUP BY nickname ORDER BY msg_count DESC LIMIT 30
      `).all(sid);

      // 时间线（按分钟聚合，create_time 是 unix timestamp）
      const timeline = dbInstance.prepare(`
        SELECT
          strftime('%Y-%m-%d %H:%M:00', create_time, 'unixepoch', 'localtime') as time,
          COUNT(*) as gifts,
          SUM(diamond_count * repeat_count) as diamonds
        FROM gifts WHERE session_id = ?
        GROUP BY time ORDER BY time
      `).all(sid);
      const danmakuTimeline = dbInstance.prepare(`
        SELECT
          strftime('%Y-%m-%d %H:%M:00', create_time, 'unixepoch', 'localtime') as time,
          COUNT(*) as danmaku
        FROM danmaku WHERE session_id = ?
        GROUP BY time ORDER BY time
      `).all(sid);
      // Merge timelines
      const timeMap = {};
      timeline.forEach(t => { timeMap[t.time] = { time: t.time, gifts: t.gifts, diamonds: t.diamonds, danmaku: 0 }; });
      danmakuTimeline.forEach(t => {
        if (!timeMap[t.time]) timeMap[t.time] = { time: t.time, gifts: 0, diamonds: 0, danmaku: 0 };
        timeMap[t.time].danmaku = t.danmaku;
      });

      const summary = {
        total_diamonds: dbInstance.prepare('SELECT COALESCE(SUM(diamond_count * repeat_count), 0) as d FROM gifts WHERE session_id = ?').get(sid).d,
        total_gifts: dbInstance.prepare('SELECT COUNT(*) as c FROM gifts WHERE session_id = ?').get(sid).c,
        total_danmaku: danmaku.length,
        danmaku_count: danmaku.length,
        user_count: new Set(gifts.map(g => g.nickname).concat(danmaku.map(d => d.nickname))).size,
        timeline: Object.values(timeMap).sort((a, b) => a.time.localeCompare(b.time))
      };

      // 检查报告
      const reportPath = path.join(DATA_DIR, 'reports', `report_${sid}.jpg`);
      const hasReport = fs.existsSync(reportPath);

      return sendJSON(res, {
        session: {
          id: session.id,
          title: session.room_title || session.streamer_name,
          is_live: session.end_time === null && session.archived === 0,
          start_time: session.start_time,
          end_time: session.end_time,
          duration_min: session.duration_seconds ? Math.round(session.duration_seconds / 60) : null,
          streamer_name: session.streamer_name,
          streamer_avatar: session.streamer_avatar,
          online_peak: session.online_peak || 0,
          stats_like: session.stats_like || 0
        },
        gifts, giftDetails, anchorRanking, danmakuWords, danmakuRanking, summary, hasReport
      });
    }



        // --- 主播榜前100 ---
    if (pathname.startsWith('/api/sessions/') && pathname.endsWith('/anchor-gifts')) {
      const url = new URL(req.url, `http://${req.headers.host}`);
      const sid = parseInt(pathname.split('/')[3]);
      const anchor = url.searchParams.get('anchor');
      if (!anchor) return sendError(res, '缺少 anchor 参数', 400);
      const gifts = dbInstance.prepare(`
        SELECT nickname, avatar as avatar_url, user_sec_uid,
          SUM(diamond_count * repeat_count) as total_diamonds,
          COUNT(*) as gift_count
        FROM gifts WHERE session_id = ? AND to_nickname = ?
        GROUP BY nickname ORDER BY total_diamonds DESC LIMIT 100
      `).all(sid, anchor);
      return sendJSON(res, { anchor, gifts });
    }

    // --- 删除场次 ---
    if (pathname.startsWith('/api/sessions/') && pathname.endsWith('/delete') && req.method === 'POST') {
      const sid = parseInt(pathname.split('/')[3]);
      const session = dbInstance.prepare('SELECT id FROM sessions WHERE id = ?').get(sid);
      if (!session) return sendError(res, '场次不存在', 404);
      // CASCADE 会自动删除 gifts/danmaku/members/online_records
      dbInstance.prepare('DELETE FROM sessions WHERE id = ?').run(sid);
      // 同时删除报告图片
      const reportPath = path.join(DATA_DIR, 'reports', `report_${sid}.jpg`);
      if (fs.existsSync(reportPath)) fs.unlinkSync(reportPath);
      return sendJSON(res, { ok: true, message: `场次 ${sid} 已删除` });
    }

    // --- 场次报告图片（自动生成） ---
    if (pathname.startsWith('/api/sessions/') && pathname.endsWith('/report')) {
      const sid = parseInt(pathname.split('/')[3]);
      const reportsDir = path.join(DATA_DIR, 'reports');
      if (!fs.existsSync(reportsDir)) fs.mkdirSync(reportsDir, { recursive: true });
      let reportPath = path.join(reportsDir, `report_${sid}.jpg`);
      if (!fs.existsSync(reportPath)) {
        // 自动生成（generateImage 固定输出 report_image.jpg，需重命名）
        try {
          const data = await reportImg.loadFromDb(sid);
          if (!data) return sendError(res, '场次数据不存在', 404);
          const tmpPath = await reportImg.generateImage(data);
          if (tmpPath && fs.existsSync(tmpPath)) {
            fs.copyFileSync(tmpPath, reportPath);
          }
        } catch (e) {
          console.error('报告生成失败:', e.message);
          return sendError(res, '报告生成失败: ' + e.message, 500);
        }
      }
      res.writeHead(200, { 'Content-Type': 'image/jpeg', 'Access-Control-Allow-Origin': '*' });
      fs.createReadStream(reportPath).pipe(res);
      return;
    }

    // ====== 房间管理 API ======

    // --- 查询房间信息 ---
    if (pathname === '/api/rooms/lookup' && req.method === 'GET') {
      const input = (query.room_id || query.q || '').trim();
      if (!input) return sendError(res, '请输入房间号或抖音号', 400);

      try {
        if (/^\d{5,15}$/.test(input)) {
          // 房间号 → 直接调 douyin-api（getLiveInfo + getUserInfo）
          const api = require('./lib/douyin-api.js');
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
      // 排序：直播中 > 监控中 > 已启用 > 已暂停
      result.sort((a, b) => {
        const score = r => r.recording ? 3 : r.connected ? 2 : r.enabled ? 1 : 0;
        return score(b) - score(a) || a.name.localeCompare(b.name);
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
      if (!/^\d{5,15}$/.test(room_id)) return sendError(res, 'room_id 格式无效（5-15位纯数字）', 400);
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

    // 404
    sendError(res, 'API 不存在', 404);
  } catch (e) {
    console.error('[API]', e.message);
    sendError(res, e.message);
  }
}

// ====== 静态文件服务 ======
function serveStatic(req, res) {
  const { pathname } = parseQuery(req.url);
  let filePath;
  if (pathname === '/' || pathname === '/index.html') {
    filePath = path.join(DATA_DIR, 'dashboard.html');
  } else {
    filePath = path.join(DATA_DIR, pathname);
  }

  // 安全检查：防止目录遍历
  if (!filePath.startsWith(DATA_DIR)) {
    res.writeHead(403); res.end('Forbidden'); return;
  }

  if (!fs.existsSync(filePath)) {
    res.writeHead(404); res.end('Not Found'); return;
  }

  const ext = path.extname(filePath).toLowerCase();
  const mimeTypes = {
    '.html': 'text/html', '.css': 'text/css', '.js': 'application/javascript',
    '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg',
    '.svg': 'image/svg+xml', '.ico': 'image/x-icon'
  };
  const contentType = mimeTypes[ext] || 'application/octet-stream';
  const accept = req.headers?.['accept-encoding'] || '';
  // gzip 压缩文本文件（>1KB）
  if (accept.includes('gzip') && (ext === '.html' || ext === '.css' || ext === '.js' || ext === '.json')) {
    const buf = fs.readFileSync(filePath);
    if (buf.length > 1024) {
      const compressed = zlib.gzipSync(buf);
      res.writeHead(200, {
        'Content-Type': contentType,
        'Content-Encoding': 'gzip',
        'Cache-Control': 'no-cache'
      });
      res.end(compressed);
      return;
    }
  }
  res.writeHead(200, { 'Content-Type': contentType, 'Cache-Control': 'no-cache' });
  fs.createReadStream(filePath).pipe(res);
}

// ====== 主服务器 ======
const server = http.createServer(async (req, res) => {
  // CORS 预检
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type'
    });
    return res.end();
  }

  const { pathname } = parseQuery(req.url);

  if (pathname.startsWith('/api/')) {
    await handleAPI(req, res);
  } else {
    serveStatic(req, res);
  }
});

// 启动
async function start() {
  await db.init();
  server.listen(PORT, '0.0.0.0', () => {
    console.log(`[dashboard] 仪表板已启动: http://0.0.0.0:${PORT}`);
  });
}

start().catch(e => {
  console.error('[dashboard] 启动失败:', e.message);
  process.exit(1);
});