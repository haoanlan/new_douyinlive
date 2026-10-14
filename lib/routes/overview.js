const { comboDedupGifts } = require('../gift-utils.js');

let cache = null;
let cacheTime = 0;
let refreshing = false;
const CACHE_TTL = 300000;

/**
 * 计算总览聚合数据。
 *
 * 性能背景（实测）：原实现每次都把整张 gifts 明细表读进内存做连击去重
 * （417,460 行 → 4.54 秒 / 堆 +322MB），再在 JS 里算榜，合计约 5.5 秒的**同步**计算。
 * 而监控 worker 与 HTTP 同进程 —— 这 5.5 秒里事件循环被占住，直播间消息处理停摆，
 * 有丢弹幕/礼物的风险。
 *
 * 现在改成读"按场次汇总表"（db-sqlite.js 的 session_user_gift_totals /
 * session_user_danmaku_totals / session_gift_type_totals，都**不截断**）：
 *   · 已结束场次：直接 SUM 累计值
 *   · 正在直播的场次（通常只有 1~2 个）：实时小范围去重后补上 —— 只查这几场的明细，毫秒级
 * 口径与场次列表/画像/详情一致（连击去重按场次分组，见 lib/gift-utils.js）。
 */
function computeOverview(d) {
  const t0 = Date.now();
  // ===== 汇总卡片 =====
  const ended = d.prepare(`
    SELECT
      COUNT(*) as total_sessions,
      COALESCE(SUM(agg_gifts),0) as gifts,
      COALESCE(SUM(agg_diamonds),0) as diamonds,
      COALESCE(SUM(agg_danmaku),0) as danmaku,
      COALESCE(SUM(stats_like),0) as likes
    FROM sessions WHERE end_time IS NOT NULL
  `).get();
  const offline = d.prepare('SELECT COUNT(*) c FROM sessions WHERE end_time IS NOT NULL AND archived = 1').get().c;

  // ===== 直播中场次：实时补算（通常只有 1~2 场，明细也就几万行，毫秒级）=====
  // 必须把它们的礼物/弹幕也算进**榜单**，不只是汇总数字 ——
  // 否则直播期间的"热门礼物/送礼榜"会少掉正在涨的那部分（实测抖音1号差 2 万钻石）。
  const liveSessions = d.prepare('SELECT id, COALESCE(stats_like,0) likes FROM sessions WHERE end_time IS NULL ORDER BY id').all();
  let liveGifts = 0,
    liveDiamonds = 0,
    liveDanmaku = 0,
    liveLikes = 0;
  const liveUserIds = new Set();

  /*
   * 榜单累加器。
   * 昵称按"该用户自己贡献最大的那条记录"来定，而不是 SQL 的 MAX()：
   * 同一个 sec_uid 在不同场次可能显示不同昵称（尤其神秘人N阶），
   * 用 MAX() 会挑到字母序最大那个、和实际身份对不上。
   */
  const giftTypes = new Map(); // gift_name -> {count, diamonds}
  const userGifts = new Map(); // uid/nick -> {sec_uid, nickname, avatar, diamonds, count, best}
  const userDanmaku = new Map(); // uid/nick -> {sec_uid, nickname, avatar, count, best}

  const addGiftType = (name, count, diamonds) => {
    if (!name) return;
    const e = giftTypes.get(name) || { count: 0, diamonds: 0 };
    e.count += count;
    e.diamonds += diamonds;
    giftTypes.set(name, e);
  };
  const addUserGift = (secUid, nickname, avatar, diamonds, count) => {
    const k = secUid || nickname;
    if (!k) return;
    const e = userGifts.get(k) || { sec_uid: secUid || '', nickname: '', avatar: '', diamonds: 0, count: 0, best: -1 };
    e.diamonds += diamonds;
    e.count += count;
    // 昵称/头像取"贡献最大的那条"；非匿名昵称优先
    const anonymous = !nickname || nickname.startsWith('神秘人');
    const better = diamonds > e.best || (e.best < 0 && !anonymous) || (!anonymous && (!e.nickname || e.nickname.startsWith('神秘人')));
    if (better && nickname) {
      e.nickname = nickname;
      if (avatar) e.avatar = avatar;
      e.best = Math.max(e.best, diamonds);
    } else if (!e.nickname && nickname) {
      e.nickname = nickname;
    }
    if (!e.avatar && avatar) e.avatar = avatar;
    userGifts.set(k, e);
  };
  const addUserDanmaku = (secUid, nickname, avatar, count) => {
    const k = secUid || nickname;
    if (!k) return;
    const e = userDanmaku.get(k) || { sec_uid: secUid || '', nickname: '', avatar: '', count: 0, best: -1 };
    e.count += count;
    const anonymous = !nickname || nickname.startsWith('神秘人');
    if ((count > e.best || (e.best < 0 && !anonymous)) && nickname) {
      e.nickname = nickname;
      if (avatar) e.avatar = avatar;
      e.best = Math.max(e.best, count);
    } else if (!e.nickname && nickname) {
      e.nickname = nickname;
    }
    if (!e.avatar && avatar) e.avatar = avatar;
    userDanmaku.set(k, e);
  };

  // 已结束场次：读汇总表（小表，实测毫秒级）
  for (const r of d.prepare('SELECT gift_name, gift_count, diamonds FROM session_gift_type_totals').all()) {
    addGiftType(r.gift_name, r.gift_count || 0, r.diamonds || 0);
  }
  for (const r of d.prepare('SELECT user_sec_uid, nickname, avatar_url, total_diamonds, gift_count FROM session_user_gift_totals').all()) {
    addUserGift(r.user_sec_uid, r.nickname, r.avatar_url, r.total_diamonds || 0, r.gift_count || 0);
    if (r.user_sec_uid) liveUserIds.add(r.user_sec_uid);
  }
  for (const r of d.prepare('SELECT user_sec_uid, nickname, avatar, msg_count FROM session_user_danmaku_totals').all()) {
    addUserDanmaku(r.user_sec_uid, r.nickname, r.avatar, r.msg_count || 0);
  }

  // 直播中场次：实时去重后并入同一套累加器
  for (const ls of liveSessions) {
    liveLikes += ls.likes || 0;
    const rawGifts = d.prepare('SELECT * FROM gifts WHERE session_id = ? ORDER BY id').all(ls.id);
    const deduped = comboDedupGifts(rawGifts);
    for (const g of deduped) {
      const c = g.repeat_count || 1;
      const dia = g.total_diamonds || 0;
      liveGifts += c;
      liveDiamonds += dia;
      addGiftType(g.gift_name, c, dia);
      addUserGift(g.user_sec_uid, g.nickname, g.avatar_url || g.avatar, dia, c);
      if (g.user_sec_uid) liveUserIds.add(g.user_sec_uid);
    }
    const dmRows = d
      .prepare(
        `SELECT COALESCE(user_sec_uid,'') user_sec_uid, COALESCE(nickname,'') nickname,
                MAX(avatar) avatar, COUNT(*) msg_count
         FROM danmaku WHERE session_id = ? GROUP BY user_sec_uid, nickname`
      )
      .all(ls.id);
    for (const r of dmRows) {
      liveDanmaku += r.msg_count || 0;
      addUserDanmaku(r.user_sec_uid, r.nickname, r.avatar, r.msg_count || 0);
    }
  }

  const summary = {
    total_sessions: ended.total_sessions,
    offline_count: offline,
    // 点赞是"全表"口径（含直播中正在涨的），别只算已结束场次
    total_likes: ended.likes + liveLikes,
    total_danmaku: ended.danmaku + liveDanmaku,
    unique_users: liveUserIds.size,
    peak_online: d.prepare('SELECT COALESCE(MAX(online_peak),0) c FROM sessions').get().c,
    total_gifts: ended.gifts + liveGifts,
    total_diamonds: ended.diamonds + liveDiamonds
  };

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

  // 热门礼物 Top8（累加器里已含直播中场次）；图标单独查
  const topGifts = [...giftTypes.entries()]
    .map(([name, v]) => ({ name, count: v.count, diamonds: v.diamonds }))
    .sort((a, b) => b.diamonds - a.diamonds)
    .slice(0, 8);
  for (const g of topGifts) {
    // 顺序与画像页统一：礼物行自带的 icon 优先（且必须非空 ——
    // 同一礼物名有部分行的 icon 是空串，`icon IS NOT NULL` 拦不住），名称表兜底
    const gl = d.prepare("SELECT icon FROM gifts WHERE gift_name = ? AND icon IS NOT NULL AND icon != '' LIMIT 1").get(g.name);
    const gi = d.prepare('SELECT icon_url FROM gift_icons WHERE name = ?').get(g.name);
    g.icon = gl?.icon || gi?.icon_url || '';
  }

  // 用户送礼榜 Top5
  const topUsers = [...userGifts.values()].sort((a, b) => b.diamonds - a.diamonds).slice(0, 5);
  for (const u of topUsers) {
    if (!u.avatar) {
      const row = u.sec_uid
        ? d.prepare("SELECT avatar FROM gifts WHERE user_sec_uid = ? AND avatar IS NOT NULL AND avatar != '' LIMIT 1").get(u.sec_uid)
        : d.prepare("SELECT avatar FROM gifts WHERE nickname = ? AND avatar IS NOT NULL AND avatar != '' LIMIT 1").get(u.nickname);
      u.avatar = row?.avatar || '';
    }
  }

  // 弹幕活跃 Top5
  const topDanmaku = [...userDanmaku.values()]
    .sort((a, b) => b.count - a.count)
    .slice(0, 5)
    .map((u) => ({ nickname: u.nickname, count: u.count, avatar: u.avatar || '' }));

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

  console.log(`[overview] 聚合完成 ${Date.now() - t0}ms（已结束场次读汇总表 + 直播中 ${liveSessions.length} 场实时补算）`);

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
