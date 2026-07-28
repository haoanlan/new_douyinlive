const path = require('path');
const fs = require('fs');

module.exports = async function(pathname, query, req, res, ctx) {
  const { dbInstance, sendJSON, sendError, bodyParse, comboDedupGifts, DATA_DIR, reportImg } = ctx;

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
  if (/^\/api\/sessions\/\d+$/.test(pathname)) {
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
    // Initialize stats for all sessions
    const allSessions = dbInstance.prepare(
      'SELECT id FROM sessions WHERE streamer_id = ?'
    ).all(streamer.id);
    for (const s of allSessions) {
      sessionStats[s.id] = { total_diamonds: 0, gift_count: 0, user_set: new Set() };
    }
    for (const g of dedupedGifts) {
      const sid = g.session_id;
      if (!sessionStats[sid]) sessionStats[sid] = { total_diamonds: 0, gift_count: 0, user_set: new Set() };
      sessionStats[sid].total_diamonds += g.total_diamonds || 0;
      sessionStats[sid].gift_count += g.repeat_count || 1;
      if (g.user_sec_uid) sessionStats[sid].user_set.add(g.user_sec_uid);
    }
    const sessionDanmaku = dbInstance.prepare(
      "SELECT session_id, user_sec_uid FROM danmaku WHERE session_id IN (SELECT id FROM sessions WHERE streamer_id = ?) AND user_sec_uid IS NOT NULL AND user_sec_uid != ''"
    ).all(streamer.id);
    const danmakuMap = {};
    for (const d of sessionDanmaku) {
      danmakuMap[d.session_id] = (danmakuMap[d.session_id] || 0) + 1;
      if (sessionStats[d.session_id] && d.user_sec_uid) {
        sessionStats[d.session_id].user_set.add(d.user_sec_uid);
      }
    }

    const rows = dbInstance.prepare(
      'SELECT s.* FROM sessions s WHERE s.streamer_id = ? ORDER BY s.start_time DESC'
    ).all(streamer.id);
    return sendJSON(res, rows.map(r => {
      const st = sessionStats[r.id] || { total_diamonds: 0, gift_count: 0, user_set: new Set() };
      return {
        id: r.id,
        title: `场次 #${r.id}`,
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

  return false;
};
