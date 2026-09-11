const { comboDedupGifts } = require('../gift-utils.js');

let cache = null;
let cacheTime = 0;
let refreshing = false;
const CACHE_TTL = 300000;

/**
 * 计算总览聚合数据（耗时操作，全表扫描 gifts + 连击去重）
 */
function computeOverview(d) {
  // 汇总卡片
  const summary = d.prepare(`
    SELECT
      (SELECT COUNT(*) FROM sessions WHERE end_time IS NOT NULL) as total_sessions,
      (SELECT COUNT(*) FROM sessions WHERE end_time IS NOT NULL AND archived = 1) as offline_count,
      (SELECT COALESCE(SUM(stats_like),0) FROM sessions) as total_likes,
      (SELECT COUNT(*) FROM danmaku) as total_danmaku,
      (SELECT COUNT(DISTINCT user_sec_uid) FROM gifts WHERE user_sec_uid != '') as unique_users,
      (SELECT COALESCE(MAX(online_peak),0) FROM sessions) as peak_online
  `).get();

  // 礼物与钻石：连击去重（不加载 avatar/icon 大字段，只为 Top 结果单独查）
  const rawGifts = d.prepare(`
    SELECT id, nickname, user_display_id, gift_name, user_sec_uid, to_user_sec_uid,
      to_user_display_id, to_nickname, repeat_count, total_diamonds, combo_count, repeat_end
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

  // 热门礼物 Top8（去重后按钻石，图标单独查）
  const giftMap = new Map();
  for (const g of deduped) {
    const k = g.gift_name;
    if (!giftMap.has(k)) giftMap.set(k, { name: k, icon: '', count: 0, diamonds: 0 });
    const e = giftMap.get(k);
    e.count += g.repeat_count || 1;
    e.diamonds += g.total_diamonds || 0;
  }
  const topGifts = [...giftMap.values()].sort((a, b) => b.diamonds - a.diamonds).slice(0, 8);
  for (const g of topGifts) {
    const gi = d.prepare('SELECT icon_url FROM gift_icons WHERE name = ?').get(g.name);
    const gl = gi || d.prepare('SELECT icon FROM gifts WHERE gift_name = ? AND icon IS NOT NULL LIMIT 1').get(g.name);
    g.icon = gi?.icon_url || gl?.icon || '';
  }

  // 用户送礼榜 Top5（去重后，头像单独查）
  const userMap = new Map();
  for (const g of deduped) {
    const k = g.user_sec_uid || g.nickname;
    if (!userMap.has(k)) userMap.set(k, { nickname: g.nickname, avatar: '', sec_uid: g.user_sec_uid || '', diamonds: 0, count: 0 });
    const e = userMap.get(k);
    e.diamonds += g.total_diamonds || 0;
    e.count += g.repeat_count || 1;
    if (g.nickname) e.nickname = g.nickname;
  }
  const topUsers = [...userMap.values()].sort((a, b) => b.diamonds - a.diamonds).slice(0, 5);
  for (const u of topUsers) {
    const row = u.sec_uid
      ? d.prepare("SELECT avatar FROM gifts WHERE user_sec_uid = ? AND avatar IS NOT NULL AND avatar != '' LIMIT 1").get(u.sec_uid)
      : d.prepare("SELECT avatar FROM gifts WHERE nickname = ? AND avatar IS NOT NULL AND avatar != '' LIMIT 1").get(u.nickname);
    u.avatar = row?.avatar || '';
  }

  // 弹幕活跃 Top5
  const topDanmaku = d.prepare(`
    SELECT nickname,
      (SELECT avatar FROM danmaku d2 WHERE d2.nickname = d.nickname AND d2.avatar != '' ORDER BY d2.id DESC LIMIT 1) as avatar,
      COUNT(*) as count
    FROM danmaku d GROUP BY nickname ORDER BY count DESC LIMIT 5
  `).all();

  // 在线峰值场次 Top5
  const peakSessions = d.prepare(`
    SELECT s.id, s.room_title, s.online_peak, s.start_time, st.name as streamer, st.avatar as streamer_avatar
    FROM sessions s LEFT JOIN streamers st ON s.streamer_id = st.id
    WHERE s.online_peak IS NOT NULL AND s.online_peak > 0
    ORDER BY s.online_peak DESC LIMIT 5
  `).all();

  // 最近场次 8 条
  const recentSessions = d.prepare(`
    SELECT s.id, s.room_title, st.name as streamer, st.avatar as streamer_avatar, s.start_time, s.online_peak,
      COALESCE(s.agg_diamonds,0) as diamonds, COALESCE(s.agg_danmaku,0) as danmaku,
      COALESCE(s.agg_users,0) as users
    FROM sessions s LEFT JOIN streamers st ON s.streamer_id = st.id
    ORDER BY s.start_time DESC LIMIT 8
  `).all();

  return {
    summary,
    streamers,
    topGifts,
    topUsers,
    topDanmaku,
    peakSessions,
    recentSessions
  };
}

/**
 * 后台异步刷新缓存（不阻塞请求）
 */
function refreshCache(d) {
  if (refreshing) return;
  refreshing = true;
  setImmediate(() => {
    try {
      cache = computeOverview(d);
      cacheTime = Date.now();
    } catch (e) {
      console.error('[overview] 后台刷新失败:', e.message);
    } finally {
      refreshing = false;
    }
  });
}

module.exports = async function (pathname, query, req, res, ctx) {
  const { dbInstance, sendJSON, sendError } = ctx;

  // --- 总览聚合数据（dashboard 首页） ---
  if (pathname === '/api/overview') {
    const now = Date.now();

    // 有缓存：立即返回（无论是否过期），过期则后台异步刷新
    if (cache) {
      if ((now - cacheTime) >= CACHE_TTL) refreshCache(dbInstance);
      return sendJSON(res, cache);
    }

    // 无缓存（首次启动）：同步计算一次
    cache = computeOverview(dbInstance);
    cacheTime = Date.now();
    return sendJSON(res, cache);
  }

  // --- 缓存预热（供启动时调用） ---
  if (pathname === '/api/overview/warmup') {
    refreshCache(dbInstance);
    return sendJSON(res, { ok: true });
  }

  return false;
};

/**
 * 启动时预热缓存（后台异步，不阻塞服务启动）
 */
module.exports.warmup = function (dbInstance) {
  refreshCache(dbInstance);
};
