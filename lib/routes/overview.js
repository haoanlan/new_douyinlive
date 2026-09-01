const { comboDedupGifts } = require('../gift-utils.js');

module.exports = async function (pathname, query, req, res, ctx) {
  const { dbInstance, sendJSON, sendError } = ctx;

  // --- 总览聚合数据（dashboard 首页） ---
  if (pathname === '/api/overview') {
    const d = dbInstance;

    // 汇总卡片
    const summary = d.prepare(`
      SELECT
        (SELECT COUNT(*) FROM sessions WHERE end_time IS NOT NULL) as total_sessions,
        (SELECT COALESCE(SUM(stats_like),0) FROM sessions) as total_likes,
        (SELECT COUNT(*) FROM danmaku) as total_danmaku,
        (SELECT COUNT(DISTINCT user_sec_uid) FROM gifts WHERE user_sec_uid != '') as unique_users,
        (SELECT COALESCE(MAX(online_peak),0) FROM sessions) as peak_online
    `).get();

    // 礼物与钻石：连击去重
    const rawGifts = d.prepare(`
      SELECT id, nickname, user_display_id, gift_name, user_sec_uid, to_user_sec_uid,
        to_user_display_id, to_nickname, repeat_count, total_diamonds, combo_count, repeat_end, create_time
      FROM gifts ORDER BY id
    `).all();
    const deduped = comboDedupGifts(rawGifts);
    summary.total_gifts = deduped.reduce((s, g) => s + (g.repeat_count || 1), 0);
    summary.total_diamonds = deduped.reduce((s, g) => s + (g.total_diamonds || 0), 0);

    // 主播贡献排行（按钻石）
    const streamers = d.prepare(`
      SELECT st.id, st.name, st.avatar,
        COUNT(s.id) as sessions,
        COALESCE(SUM(s.agg_diamonds),0) as diamonds,
        COALESCE(SUM(s.agg_danmaku),0) as danmaku,
        COALESCE(MAX(s.online_peak),0) as peak_online
      FROM streamers st LEFT JOIN sessions s ON s.streamer_id = st.id
      GROUP BY st.id ORDER BY diamonds DESC
    `).all();

    // 热门礼物 Top8（去重后按钻石）
    const giftMap = new Map();
    for (const g of deduped) {
      const k = g.gift_name;
      if (!giftMap.has(k)) giftMap.set(k, { name: k, count: 0, diamonds: 0 });
      const e = giftMap.get(k);
      e.count += g.repeat_count || 1;
      e.diamonds += g.total_diamonds || 0;
    }
    const topGifts = [...giftMap.values()].sort((a, b) => b.diamonds - a.diamonds).slice(0, 8);

    // 用户送礼榜 Top5（去重后）
    const userMap = new Map();
    for (const g of deduped) {
      const k = g.user_sec_uid || g.nickname;
      if (!userMap.has(k)) userMap.set(k, { nickname: g.nickname, sec_uid: g.user_sec_uid || '', diamonds: 0, count: 0 });
      const e = userMap.get(k);
      e.diamonds += g.total_diamonds || 0;
      e.count += g.repeat_count || 1;
      if (g.nickname) e.nickname = g.nickname;
    }
    const topUsers = [...userMap.values()].sort((a, b) => b.diamonds - a.diamonds).slice(0, 5);

    // 弹幕活跃 Top5
    const topDanmaku = d.prepare(`
      SELECT nickname, COUNT(*) as count FROM danmaku GROUP BY nickname ORDER BY count DESC LIMIT 5
    `).all();

    // 在线峰值场次 Top5
    const peakSessions = d.prepare(`
      SELECT s.id, s.room_title, s.online_peak, s.start_time, st.name as streamer
      FROM sessions s LEFT JOIN streamers st ON s.streamer_id = st.id
      WHERE s.online_peak IS NOT NULL AND s.online_peak > 0
      ORDER BY s.online_peak DESC LIMIT 5
    `).all();

    // 最近场次 8 条
    const recentSessions = d.prepare(`
      SELECT s.id, s.room_title, st.name as streamer, s.start_time, s.online_peak,
        COALESCE(s.agg_diamonds,0) as diamonds, COALESCE(s.agg_danmaku,0) as danmaku,
        COALESCE(s.agg_users,0) as users
      FROM sessions s LEFT JOIN streamers st ON s.streamer_id = st.id
      ORDER BY s.start_time DESC LIMIT 8
    `).all();

    return sendJSON(res, {
      summary,
      streamers,
      topGifts,
      topUsers,
      topDanmaku,
      peakSessions,
      recentSessions
    });
  }

  return false;
};
