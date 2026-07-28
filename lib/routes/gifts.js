module.exports = async function(pathname, query, req, res, ctx) {
  const { dbInstance, sendJSON, comboDedupGifts } = ctx;

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

  return false;
};
