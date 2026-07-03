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
const https = require('https');

// ====== Webcast 用户详情 API ======
async function fetchWebcastUserProfile(targetUid, anchorUid) {
  return new Promise((resolve) => {
    const configPath = path.join(__dirname, 'config.yaml');
    let cookie = '';
    try {
      const txt = fs.readFileSync(configPath, 'utf8');
      const m = txt.match(/^douyin:\s*'(.+?)'/m);
      if (m) cookie = m[1];
    } catch (e) {}
    const apiUrl = `https://live.douyin.com/webcast/user/profile/?aid=6383&device_platform=web&sec_target_uid=${targetUid}&sec_anchor_id=${anchorUid}`;
    const opts = {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Referer': 'https://live.douyin.com/',
        'Cookie': cookie,
      }
    };
    const req = https.get(apiUrl, opts, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try {
          const j = JSON.parse(data);
          resolve(j.data?.user_profile || null);
        } catch (e) { resolve(null); }
      });
    });
    req.on('error', () => resolve(null));
    req.setTimeout(10000, () => { req.destroy(); resolve(null); });
  });
}

// ====== 连击去重（复用 report-image.js 逻辑）======
function comboDedupGifts(gifts) {
  const rawGroups = {};
  for (const g of gifts) {
    const uid = g.user_display_id || g.nickname;
    const toKey = g.to_user_sec_uid || g.to_user_display_id || g.to_nickname || '';
    const key = uid + '\x00' + (g.gift_name || '') + '\x00' + toKey;
    if (!rawGroups[key]) rawGroups[key] = [];
    rawGroups[key].push(g);
  }
  const deduped = [];
  for (const [, items] of Object.entries(rawGroups)) {
    if (items.length === 1) { deduped.push(items[0]); continue; }
    items.sort((a, b) => (a.id || 0) - (b.id || 0));
    let seq = [items[0]];
    const sequences = [];
    for (let i = 1; i < items.length; i++) {
      const prev = seq[seq.length - 1];
      const curr = items[i];
      const pc = parseInt(String(prev.combo_count || 1), 10);
      const cc = parseInt(String(curr.combo_count || 1), 10);
      if (cc > pc || (cc === pc && curr.repeat_end === 1) || (cc < pc && cc > 1)) {
        seq.push(curr);
      } else {
        sequences.push(seq);
        seq = [curr];
      }
    }
    sequences.push(seq);
    for (const s of sequences) {
      if (s.length === 1) {
        deduped.push(s[0]);
      } else {
        s.sort((a, b) => {
          const ac = parseInt(String(a.combo_count || 1), 10);
          const bc = parseInt(String(b.combo_count || 1), 10);
          if (bc !== ac) return bc - ac;
          return (b.repeat_end === 1 ? 1 : 0) - (a.repeat_end === 1 ? 1 : 0);
        });
        deduped.push(s[0]);
      }
    }
  }
  return deduped;
}

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
          (SELECT COUNT(*) FROM gifts g JOIN sessions se ON g.session_id=se.id WHERE se.streamer_id = s.id) as total_gifts,
          (SELECT COUNT(*) FROM danmaku d JOIN sessions se ON d.session_id=se.id WHERE se.streamer_id = s.id) as total_danmaku
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

      if (sessionId) {
        // 按场次：先去重再聚合
        const rawGifts = dbInstance.prepare(
          'SELECT id, nickname, avatar, user_sec_uid, user_display_id, gift_name, to_user_sec_uid, to_user_display_id, to_nickname, repeat_count, total_diamonds, combo_count, repeat_end FROM gifts WHERE session_id = ? ORDER BY id'
        ).all(sessionId);
        const dedupedGifts = comboDedupGifts(rawGifts);
        const userMap = {};
        for (const g of dedupedGifts) {
          const nick = g.nickname;
          if (!userMap[nick]) userMap[nick] = { nickname: nick, avatar: g.avatar, user_sec_uid: g.user_sec_uid, total_diamonds: 0, gift_count: 0, gift_types: new Set() };
          userMap[nick].total_diamonds += g.total_diamonds || 0;
          userMap[nick].gift_count += g.repeat_count || 1;
          if (g.gift_name) userMap[nick].gift_types.add(g.gift_name);
        }
        const rows = Object.values(userMap).map(u => ({
          ...u, gift_types_count: u.gift_types.size, gift_types: [...u.gift_types].join(',')
        })).sort((a, b) => b.total_diamonds - a.total_diamonds).slice(0, parseInt(query.limit) || 100);
        return sendJSON(res, rows);
      } else {
        // 全量排行：按时间段过滤后去重
        let where = '';
        if (period === 'today') where = "WHERE create_time >= datetime('now','start of day','localtime')";
        else if (period === 'week') where = "WHERE create_time >= datetime('now','weekday 0','-7 days','localtime')";
        else if (period === 'month') where = "WHERE create_time >= datetime('now','start of month','localtime')";

        const rawGifts = dbInstance.prepare(
          `SELECT id, nickname, avatar, user_sec_uid, user_display_id, gift_name, to_user_sec_uid, to_user_display_id, to_nickname, repeat_count, total_diamonds, combo_count, repeat_end FROM gifts ${where} ORDER BY id`
        ).all();
        const dedupedGifts = comboDedupGifts(rawGifts);
        const userMap = {};
        for (const g of dedupedGifts) {
          const uid = g.user_sec_uid || g.nickname;
          if (!userMap[uid]) userMap[uid] = { nickname: g.nickname, avatar: g.avatar, user_sec_uid: g.user_sec_uid, total_diamonds: 0, gift_count: 0, gift_types: new Set() };
          userMap[uid].total_diamonds += g.total_diamonds || 0;
          userMap[uid].gift_count += g.repeat_count || 1;
          if (g.gift_name) userMap[uid].gift_types.add(g.gift_name);
        }
        const rows = Object.values(userMap).map(u => ({
          ...u, gift_types_count: u.gift_types.size, gift_types: [...u.gift_types].join(',')
        })).sort((a, b) => b.total_diamonds - a.total_diamonds).slice(0, parseInt(query.limit) || 100);
        return sendJSON(res, rows);
      }
    }

    // --- 礼物类型排行 ---
    if (pathname === '/api/gifts/by-type') {
      const sessionId = query.session_id;
      let where = sessionId ? `WHERE session_id = ${parseInt(sessionId)}` : '';
      const rawGifts = dbInstance.prepare(
        `SELECT id, nickname, user_sec_uid, user_display_id, gift_name, to_user_sec_uid, to_user_display_id, to_nickname, repeat_count, total_diamonds, combo_count, repeat_end FROM gifts ${where} ORDER BY id`
      ).all();
      const dedupedGifts = comboDedupGifts(rawGifts);
      const giftMap = {};
      for (const g of dedupedGifts) {
        const name = g.gift_name || '未知';
        if (!giftMap[name]) giftMap[name] = { gift_name: name, total_diamonds: 0, send_count: 0, senders: new Set() };
        giftMap[name].total_diamonds += g.total_diamonds || 0;
        giftMap[name].send_count += g.repeat_count || 1;
        if (g.nickname) giftMap[name].senders.add(g.nickname);
      }
      const rows = Object.values(giftMap).map(g => ({
        ...g, sender_count: g.senders.size
      })).sort((a, b) => b.total_diamonds - a.total_diamonds).slice(0, parseInt(query.limit) || 50);
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
      const filterStreamer = query.streamer_id ? parseInt(query.streamer_id) : null;
      const filterSession = query.session_id ? parseInt(query.session_id) : null;

      // 先查符合条件的session_id列表
      let sessionFilter = '';
      let sessionParams = [];
      if (filterSession) {
        sessionFilter = 'AND session_id = ?';
        sessionParams = [filterSession];
      } else if (filterStreamer) {
        sessionFilter = 'AND session_id IN (SELECT id FROM sessions WHERE streamer_id = ?)';
        sessionParams = [filterStreamer];
      }

      // 从 gifts + danmaku + members 中查找匹配的 sec_uid
      const allRows = dbInstance.prepare(`
        SELECT user_sec_uid, nickname, avatar, session_id, create_time, 'gift' as src FROM gifts WHERE nickname LIKE ? ${sessionFilter}
        UNION ALL
        SELECT user_sec_uid, nickname, avatar, session_id, create_time, 'danmaku' as src FROM danmaku WHERE nickname LIKE ? ${sessionFilter}
        UNION ALL
        SELECT user_sec_uid, nickname, avatar, session_id, create_time, 'member' as src FROM members WHERE nickname LIKE ? ${sessionFilter}
        LIMIT 200
      `).all(`%${q}%`, ...sessionParams, `%${q}%`, ...sessionParams, `%${q}%`, ...sessionParams);
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
            // 缓存各类最新动作的时间
            gift_latest: 0,
            danmaku_latest: 0,
            member_latest: 0,
            gift_action: null,
            danmaku_action: null,
            member_action: null,
          };
        }
        const u = userMap[key];
        if (r.nickname) u.db_nicknames.add(r.nickname);
        if (r.session_id) u.session_ids.add(r.session_id);
        // 记录各类最新动作（取每类中时间最大的）
        const t = r.create_time || 0;
        if (r.src === 'gift' && t > u.gift_latest) {
          u.gift_latest = t;
          const g = dbInstance.prepare('SELECT gift_name, repeat_count, to_nickname FROM gifts WHERE user_sec_uid = ? AND session_id = ? AND create_time = ? LIMIT 1').get(r.user_sec_uid, r.session_id, r.create_time);
          let detail = g ? `送了${g.to_nickname ? ' ' + g.to_nickname : ''} ${g.gift_name}${g.repeat_count > 1 ? ' ×' + g.repeat_count : ''}` : '送了礼物';
          u.gift_action = { type: 'gift', time: t, detail, session_id: r.session_id };
        } else if (r.src === 'danmaku' && t > u.danmaku_latest) {
          u.danmaku_latest = t;
          const d = dbInstance.prepare('SELECT content FROM danmaku WHERE user_sec_uid = ? AND session_id = ? AND create_time = ? LIMIT 1').get(r.user_sec_uid, r.session_id, r.create_time);
          u.danmaku_action = { type: 'danmaku', time: t, detail: d ? d.content : '发了弹幕', session_id: r.session_id };
        } else if (r.src === 'member' && t > u.member_latest) {
          u.member_latest = t;
          u.member_action = { type: 'member', time: t, detail: '进入直播间', session_id: r.session_id };
        }
      }
      // 优先级：弹幕 >= 送礼 > 进场（取时间最大的非进场动作，无则取进场）
      for (const u of Object.values(userMap)) {
        if (u.danmaku_action && u.gift_action) {
          u.latest_action = u.danmaku_action.time >= u.gift_action.time ? u.danmaku_action : u.gift_action;
        } else if (u.danmaku_action) {
          u.latest_action = u.danmaku_action;
        } else if (u.gift_action) {
          u.latest_action = u.gift_action;
        } else {
          u.latest_action = u.member_action;
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
      // 批量查每个用户每个场次的送礼钻石数（需要去重）
      const sessionDiamondMap = {};
      for (const u of users) {
        if (!u.sec_uid || !u.session_ids.size) continue;
        const sids = [...u.session_ids];
        const placeholders = sids.map(() => '?').join(',');
        const rawGifts = dbInstance.prepare(
          `SELECT id, session_id, user_display_id, gift_name, to_user_sec_uid, to_user_display_id, to_nickname, repeat_count, total_diamonds, combo_count, repeat_end FROM gifts WHERE user_sec_uid = ? AND session_id IN (${placeholders}) ORDER BY id`
        ).all(u.sec_uid, ...sids);
        const dedupedGifts = comboDedupGifts(rawGifts);
        for (const g of dedupedGifts) {
          const key = `${u.sec_uid}_${g.session_id}`;
          sessionDiamondMap[key] = (sessionDiamondMap[key] || 0) + (g.total_diamonds || 0);
        }
      }

      const results = [];
      for (const u of users) {
        let apiInfo = null;
        let webcastInfo = null;
        if (u.sec_uid) {
          try { apiInfo = await fetchUserBySecUid(u.sec_uid); } catch (e) {}
          // 用 webcast API 补充粉丝团等级等信息
          if (u.sec_uid) {
            const anchorRow = dbInstance.prepare('SELECT to_user_sec_uid FROM gifts WHERE user_sec_uid = ? AND to_user_sec_uid IS NOT NULL AND to_user_sec_uid != "" LIMIT 1').get(u.sec_uid);
            if (anchorRow?.to_user_sec_uid) {
              try { webcastInfo = await fetchWebcastUserProfile(u.sec_uid, anchorRow.to_user_sec_uid); } catch (e) {}
            }
          }
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
          commerce_user_level: apiInfo?.commerce_user_level || 0,
          ip_location: apiInfo?.ip_location || '',
          // Webcast API 补充信息
          fans_club_level: webcastInfo?.fans_club?.data?.level || 0,
          fans_club_total: webcastInfo?.fans_club?.total_fans_count || 0,
          user_age: webcastInfo?.base_info?.age || apiInfo?.user_age || 0,
          user_gender: webcastInfo?.base_info?.gender || apiInfo?.gender || 0,
          is_private: apiInfo?.is_private || webcastInfo?.base_info?.secret === 1 || false,
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

      // 读取该用户所有礼物，去重后聚合
      const rawGifts = dbInstance.prepare(
        'SELECT id, session_id, nickname, avatar, user_sec_uid, user_display_id, gift_name, to_user_sec_uid, to_user_display_id, to_nickname, repeat_count, total_diamonds, combo_count, repeat_end, create_time FROM gifts WHERE user_sec_uid = ? ORDER BY id'
      ).all(secUid);
      if (!rawGifts.length) return sendError(res, '用户不存在', 404);
      const dedupedGifts = comboDedupGifts(rawGifts);

      // 基本信息
      const nickname = dedupedGifts[0]?.nickname || '';
      const avatar = dedupedGifts[0]?.avatar || '';
      const totalDiamonds = dedupedGifts.reduce((s, g) => s + (g.total_diamonds || 0), 0);
      const giftCount = dedupedGifts.reduce((s, g) => s + (g.repeat_count || 1), 0);
      const giftTypes = new Set(dedupedGifts.map(g => g.gift_name).filter(Boolean));

      // 活跃场次
      const sessionMap = {};
      for (const g of dedupedGifts) {
        const sid = g.session_id;
        if (!sessionMap[sid]) sessionMap[sid] = { session_id: sid, diamonds: 0 };
        sessionMap[sid].diamonds += g.total_diamonds || 0;
      }
      const sessionIds = Object.keys(sessionMap);
      let activeSessions = [];
      if (sessionIds.length) {
        const placeholders = sessionIds.map(() => '?').join(',');
        const sessRows = dbInstance.prepare(
          `SELECT s.id, s.start_time, s.end_time, st.name as streamer_name FROM sessions s LEFT JOIN streamers st ON s.streamer_id = st.id WHERE s.id IN (${placeholders})`
        ).all(...sessionIds);
        activeSessions = sessRows.map(s => ({
          ...s, session_diamonds: sessionMap[s.id]?.diamonds || 0
        })).sort((a, b) => (b.start_time || '').localeCompare(a.start_time || ''));
      }

      // 常看时段（按小时统计）
      const hourStats = dbInstance.prepare(
        "SELECT strftime('%H', create_time/1000, 'unixepoch', 'localtime') as hour, COUNT(*) as count FROM gifts WHERE user_sec_uid = ? GROUP BY hour ORDER BY hour"
      ).all(secUid);

      // 弹幕记录
      const danmakuCount = dbInstance.prepare('SELECT COUNT(*) as c FROM danmaku WHERE user_sec_uid = ?').get(secUid).c;

      // 礼物种类明细
      const giftBreakdownMap = {};
      for (const g of dedupedGifts) {
        const name = g.gift_name || '未知';
        if (!giftBreakdownMap[name]) giftBreakdownMap[name] = { gift_name: name, total_diamonds: 0, count: 0 };
        giftBreakdownMap[name].total_diamonds += g.total_diamonds || 0;
        giftBreakdownMap[name].count += g.repeat_count || 1;
      }
      const giftBreakdown = Object.values(giftBreakdownMap).sort((a, b) => b.total_diamonds - a.total_diamonds);

      return sendJSON(res, {
        nickname, avatar, total_diamonds: totalDiamonds, gift_count: giftCount,
        gift_types_count: giftTypes.size, gift_types: [...giftTypes].join(','),
        activeSessions, hourStats, giftBreakdown, danmakuCount,
        totalDiamonds, totalGifts: giftCount,
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

    // ====== 新仪表板 API ======

    // --- 总览统计 ---
    if (pathname === '/api/summary') {
      const stats = dbInstance.prepare(`
        SELECT
          (SELECT COUNT(*) FROM sessions) as total_sessions,
          (SELECT COUNT(*) FROM sessions WHERE end_time IS NULL OR archived = 0) as live_count,
          (SELECT COUNT(*) FROM sessions WHERE end_time IS NOT NULL AND archived = 1) as offline_count,
          (SELECT COUNT(*) FROM danmaku) as total_danmaku,
          (SELECT COUNT(DISTINCT user_sec_uid) FROM gifts) as unique_users,
          (SELECT COALESCE(SUM(stats_like), 0) FROM sessions) as total_likes
      `).get();
      // 礼物和钻石需要先去重再聚合（total_diamonds是累积值）
      const rawGifts = dbInstance.prepare(
        'SELECT id, nickname, user_display_id, gift_name, user_sec_uid, to_user_sec_uid, to_user_display_id, to_nickname, repeat_count, total_diamonds, combo_count, repeat_end FROM gifts ORDER BY id'
      ).all();
      const dedupedGifts = comboDedupGifts(rawGifts);
      stats.total_gifts = dedupedGifts.reduce((s, g) => s + (g.repeat_count || 1), 0);
      stats.total_diamonds = dedupedGifts.reduce((s, g) => s + (g.total_diamonds || 0), 0);
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
      // 读取该主播所有场次的礼物，去重后按场次聚合
      const rawGifts = dbInstance.prepare(
        'SELECT id, session_id, nickname, user_sec_uid, user_display_id, gift_name, to_user_sec_uid, to_user_display_id, to_nickname, repeat_count, total_diamonds, combo_count, repeat_end FROM gifts WHERE session_id IN (SELECT id FROM sessions WHERE streamer_id = ?) ORDER BY id'
      ).all(streamer.id);
      const dedupedGifts = comboDedupGifts(rawGifts);
      const sessionStats = {};
      for (const g of dedupedGifts) {
        const sid = g.session_id;
        if (!sessionStats[sid]) sessionStats[sid] = { total_diamonds: 0, gift_count: 0, user_set: new Set() };
        sessionStats[sid].total_diamonds += g.total_diamonds || 0;
        sessionStats[sid].gift_count += g.repeat_count || 1;
        if (g.user_sec_uid) sessionStats[sid].user_set.add(g.user_sec_uid);
      }
      const sessionDanmaku = dbInstance.prepare(
        'SELECT session_id, COUNT(*) as danmaku_count FROM danmaku WHERE session_id IN (SELECT id FROM sessions WHERE streamer_id = ?) GROUP BY session_id'
      ).all(streamer.id);
      const danmakuMap = {};
      for (const d of sessionDanmaku) danmakuMap[d.session_id] = d.danmaku_count;

      const rows = dbInstance.prepare(
        'SELECT s.* FROM sessions s WHERE s.streamer_id = ? ORDER BY s.start_time DESC'
      ).all(streamer.id);
      return sendJSON(res, rows.map(r => {
        const st = sessionStats[r.id] || { total_diamonds: 0, gift_count: 0, user_set: new Set() };
        return {
          id: r.id,
          title: r.room_title || `场次 #${r.id}`,
          is_live: r.end_time === null && r.archived === 0,
          started_at: r.start_time,
          ended_at: r.end_time,
          duration_min: r.duration_seconds ? Math.round(r.duration_seconds / 60) : null,
          gift_count: st.gift_count,
          total_diamonds: st.total_diamonds,
          danmaku_count: danmakuMap[r.id] || 0,
          user_count: st.user_set.size,
          stats_like: r.stats_like || 0
        };
      }));
    }

    // --- 场次完整详情 ---
    if (pathname.startsWith('/api/sessions/') && pathname.endsWith('/detail')) {
      const sid = parseInt(pathname.split('/')[3]);
      const session = dbInstance.prepare(`
        SELECT s.*, st.name as streamer_name, st.avatar as streamer_avatar
        FROM sessions s LEFT JOIN streamers st ON s.streamer_id = st.id WHERE s.id = ?
      `).get(sid);
      if (!session) return sendError(res, '场次不存在', 404);

      // 礼物排行（先去重再聚合）
      const rawGifts = dbInstance.prepare(`
        SELECT id, nickname, avatar as avatar_url, user_sec_uid, user_display_id,
          gift_name, to_nickname, to_user_sec_uid, to_user_display_id,
          diamond_count, repeat_count, total_diamonds,
          combo_count, repeat_end, create_time
        FROM gifts WHERE session_id = ? ORDER BY id
      `).all(sid);
      const dedupedGifts = comboDedupGifts(rawGifts);

      // 按用户聚合排行
      const giftUserMap = {};
      for (const g of dedupedGifts) {
        const uid = g.user_sec_uid || g.nickname;
        if (!giftUserMap[uid]) giftUserMap[uid] = { nickname: g.nickname, avatar_url: g.avatar_url, user_sec_uid: g.user_sec_uid, total_diamonds: 0, gift_count: 0 };
        giftUserMap[uid].total_diamonds += g.total_diamonds || 0;
        giftUserMap[uid].gift_count += g.repeat_count || 1;
      }
      const gifts = Object.values(giftUserMap).sort((a, b) => b.total_diamonds - a.total_diamonds).slice(0, 20);

      // 每个用户的礼物种类明细
      const giftDetailMap = {};
      for (const g of dedupedGifts) {
        const key = (g.user_sec_uid || g.nickname) + '\x00' + (g.gift_name || '') + '\x00' + (g.to_nickname || '');
        if (!giftDetailMap[key]) {
          giftDetailMap[key] = {
            nickname: g.nickname, user_sec_uid: g.user_sec_uid, gift_name: g.gift_name, to_nickname: g.to_nickname,
            total_diamonds: 0, count: 0, avatar_url: g.avatar_url, gift_icon: null
          };
        }
        giftDetailMap[key].total_diamonds += g.total_diamonds || 0;
        giftDetailMap[key].count += g.repeat_count || 1;
      }
      // 补充 avatar 和 icon
      for (const d of Object.values(giftDetailMap)) {
        if (!d.avatar_url) {
          const av = dbInstance.prepare('SELECT avatar FROM gifts WHERE session_id = ? AND nickname = ? AND avatar IS NOT NULL LIMIT 1').get(sid, d.nickname);
          d.avatar_url = av?.avatar || null;
        }
        if (!d.gift_icon) {
          const ic = dbInstance.prepare('SELECT icon FROM gifts WHERE session_id = ? AND nickname = ? AND gift_name = ? AND icon IS NOT NULL LIMIT 1').get(sid, d.nickname, d.gift_name);
          d.gift_icon = ic?.icon || null;
        }
        // 二次 fallback: 从 gift_icons 表查（覆盖融合礼物积累的 icon）
        if (!d.gift_icon) {
          let gi = dbInstance.prepare('SELECT icon_url FROM gift_icons WHERE name = ?').get(d.gift_name);
          // 模糊匹配：处理 游轮/邮轮 等协议名与API名不一致的情况
          if (!gi) {
            gi = dbInstance.prepare('SELECT icon_url FROM gift_icons WHERE REPLACE(REPLACE(name,\'邮轮\',\'游轮\'),\'游轮\',\'邮轮\') = ? OR name LIKE ?').get(d.gift_name, '%' + d.gift_name.replace(/[·\s]/g, '') + '%');
          }
          d.gift_icon = gi?.icon_url || null;
        }
      }
      const giftDetails = Object.values(giftDetailMap).sort((a, b) => b.total_diamonds - a.total_diamonds);

      // 主播排名（用已去重的dedupedGifts聚合）
      const anchorMap = {};
      for (const g of dedupedGifts) {
        const anchorKey = g.to_user_sec_uid || '';
        if (!anchorKey) continue;
        if (!anchorMap[anchorKey]) anchorMap[anchorKey] = { anchor_sec_uid: anchorKey, anchor_name: g.to_nickname || '', anchor_avatar: g.to_avatar || null, total_diamonds: 0, gift_count: 0, users: new Set() };
        anchorMap[anchorKey].total_diamonds += g.total_diamonds || 0;
        anchorMap[anchorKey].gift_count += g.repeat_count || 1;
        if (g.nickname) anchorMap[anchorKey].users.add(g.nickname);
        if (g.to_nickname && !anchorMap[anchorKey].anchor_name) anchorMap[anchorKey].anchor_name = g.to_nickname;
      }
      const anchorRanking = Object.values(anchorMap).map(a => ({
        ...a, user_count: a.users.size
      })).sort((a, b) => b.total_diamonds - a.total_diamonds);
      // 补充头像
      for (const a of anchorRanking) {
        if (!a.anchor_avatar && a.anchor_sec_uid) {
          const av = dbInstance.prepare('SELECT avatar FROM gifts WHERE session_id = ? AND user_sec_uid = ? AND avatar IS NOT NULL LIMIT 1').get(sid, a.anchor_sec_uid);
          if (av) a.anchor_avatar = av.avatar;
        }
        if (!a.anchor_avatar && a.anchor_sec_uid) {
          const av = dbInstance.prepare('SELECT avatar FROM danmaku WHERE session_id = ? AND user_sec_uid = ? AND avatar IS NOT NULL LIMIT 1').get(sid, a.anchor_sec_uid);
          if (av) a.anchor_avatar = av.avatar;
        }
        if (!a.anchor_avatar && a.anchor_sec_uid) {
          const av = dbInstance.prepare('SELECT avatar FROM members WHERE user_sec_uid = ? AND avatar IS NOT NULL LIMIT 1').get(a.anchor_sec_uid);
          if (av) a.anchor_avatar = av.avatar;
        }
      }
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
        GROUP BY user_sec_uid ORDER BY msg_count DESC LIMIT 30
      `).all(sid);

      // 时间线（用已去重的dedupedGifts按分钟聚合）
      const timeLineMap = {};
      for (const g of dedupedGifts) {
        const ts = g.create_time;
        if (!ts) continue;
        let timeKey;
        if (typeof ts === 'number') {
          const d = new Date(ts > 1e12 ? ts : ts * 1000);
          timeKey = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')} ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}:00`;
        } else {
          timeKey = String(ts).slice(0, 16) + ':00';
        }
        if (!timeLineMap[timeKey]) timeLineMap[timeKey] = { time: timeKey, gifts: 0, diamonds: 0 };
        timeLineMap[timeKey].gifts += g.repeat_count || 1;
        timeLineMap[timeKey].diamonds += g.total_diamonds || 0;
      }
      const timeline = Object.values(timeLineMap).sort((a, b) => (a.time || '').localeCompare(b.time || ''));
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
        total_diamonds: dedupedGifts.reduce((s, g) => s + (g.total_diamonds || 0), 0),
        total_gifts: dedupedGifts.reduce((s, g) => s + (g.repeat_count || 1), 0),
        total_danmaku: danmaku.length,
        danmaku_count: danmaku.length,
        user_count: new Set(dedupedGifts.map(g => g.nickname).concat(danmaku.map(d => d.nickname))).size,
        timeline: Object.values(timeMap).sort((a, b) => (a.time || '').localeCompare(b.time || ''))
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



    // --- 主播礼物详情（用已去重的dedupedGifts） ---
    if (pathname.startsWith('/api/sessions/') && pathname.endsWith('/anchor-gifts')) {
      const url = new URL(req.url, `http://${req.headers.host}`);
      const sid = parseInt(pathname.split('/')[3]);
      const anchor = url.searchParams.get('anchor');
      if (!anchor) return sendError(res, '缺少 anchor 参数', 400);
      // 读取该场次的礼物，去重后按用户聚合
      const rawGifts = dbInstance.prepare(
        'SELECT id, nickname, avatar as avatar_url, user_sec_uid, user_display_id, gift_name, to_user_sec_uid, to_user_display_id, to_nickname, repeat_count, total_diamonds, combo_count, repeat_end FROM gifts WHERE session_id = ? AND to_nickname = ? ORDER BY id'
      ).all(sid, anchor);
      const dedupedAnchorGifts = comboDedupGifts(rawGifts);
      const userMap = {};
      for (const g of dedupedAnchorGifts) {
        const uid = g.user_sec_uid || g.nickname;
        if (!userMap[uid]) userMap[uid] = { nickname: g.nickname, avatar_url: g.avatar_url, user_sec_uid: g.user_sec_uid, total_diamonds: 0, gift_count: 0 };
        userMap[uid].total_diamonds += g.total_diamonds || 0;
        userMap[uid].gift_count += g.repeat_count || 1;
      }
      const gifts = Object.values(userMap).sort((a, b) => b.total_diamonds - a.total_diamonds).slice(0, 100);
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