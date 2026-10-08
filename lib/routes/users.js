module.exports = async function(pathname, query, req, res, ctx) {
  const { dbInstance, sendJSON, sendError, comboDedupGifts } = ctx;

  // --- 用户搜索（按昵称，含弹幕） ---
  if (pathname === '/api/users/search') {
    const q = query.q;
    if (!q) return sendError(res, '缺少搜索词', 400);
    const rows = dbInstance.prepare(`
      SELECT user_sec_uid,
             (SELECT nickname FROM gifts WHERE user_sec_uid = all_users.user_sec_uid ORDER BY id DESC LIMIT 1) as nickname,
             (SELECT avatar FROM gifts WHERE user_sec_uid = all_users.user_sec_uid AND avatar != '' ORDER BY id DESC LIMIT 1) as avatar
      FROM (
        SELECT user_sec_uid FROM gifts WHERE nickname LIKE ?
        UNION
        SELECT user_sec_uid FROM danmaku WHERE nickname LIKE ?
      ) all_users
      GROUP BY user_sec_uid
      LIMIT 20
    `).all(`%${q}%`, `%${q}%`);
    return sendJSON(res, rows);
  }

  // --- 匿名查询（昵称→sec_uid→API查真实信息） ---
/**
 * 抖音自动生成的名字：`dou` + 数字（未登录访客）、「神秘人…」（匿名/隐藏身份）。
 * 这类名字不算真名，卡片标题/头像不用它。判定规则只放后端一处，
 * 前端按返回值里的 generated 字段使用（不再自己写正则）。
 */
const GENERATED_NAME_RE = /^(dou\d+|神秘人)/i;

/**
 * 汇总某个 sec_uid 在库里用过的全部名字（gifts/danmaku/members 合并，按时间倒序）。
 *
 * 为什么要按 sec_uid 汇总：一个人会改名（实测样本 30 个名字），而按名字查询只能
 * 看到"那个名字名下"的记录，所以标题/头像/统计都必须回到 sec_uid 口径。
 *
 * 返回：
 *   rows            —— 供调用方继续算场次/弹幕/最近动作
 *   stats/list      —— 每个名字的出现次数、首次/最后时间、是否为自动生成
 *   newestName/newestAvatar             —— 最近一次出现时用的名字与头像
 *   newestRealName/newestRealAvatar     —— 最近一次"真名"出现时的名字与头像
 */
function collectNameHistory(secUid, limit = 5000) {
  const rows = dbInstance
    .prepare(
      `SELECT nickname, session_id, create_time, avatar, 'gift' AS src FROM gifts WHERE user_sec_uid = ?
       UNION ALL
       SELECT nickname, session_id, create_time, avatar, 'danmaku' FROM danmaku WHERE user_sec_uid = ?
       UNION ALL
       SELECT nickname, session_id, create_time, avatar, 'member' FROM members WHERE user_sec_uid = ?
       ORDER BY create_time DESC
       LIMIT ${Math.max(1, Number(limit) || 5000)}`
    )
    .all(secUid, secUid, secUid);

  const stats = {};
  let firstSeen = 0;
  let newestName = '';
  let newestAvatar = '';
  let newestRealName = '';
  let newestRealAvatar = '';
  for (const r of rows) {
    const t = r.create_time || 0;
    const nick = r.nickname || '';
    if (nick) {
      if (!stats[nick]) {
        stats[nick] = {
          nickname: nick,
          count: 0,
          first: t,
          last: t,
          generated: GENERATED_NAME_RE.test(nick)
        };
      }
      const s = stats[nick];
      s.count += 1;
      if (t > s.last) s.last = t;
      if (t && (!s.first || t < s.first)) s.first = t;
      // rows 已按时间倒序：第一条就是最新的
      if (!newestName) {
        newestName = nick;
        newestAvatar = r.avatar || '';
      }
      if (!s.generated && !newestRealName) {
        newestRealName = nick;
        newestRealAvatar = r.avatar || '';
      }
    }
    if (t && (!firstSeen || t < firstSeen)) firstSeen = t;
  }
  const list = Object.values(stats).sort((a, b) => b.count - a.count);
  return { rows, stats, list, firstSeen, newestName, newestAvatar, newestRealName, newestRealAvatar };
}

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
      ORDER BY create_time DESC
      LIMIT 200
    `).all(`%${q}%`, ...sessionParams, `%${q}%`, ...sessionParams, `%${q}%`, ...sessionParams);
    if (!allRows.length) return sendJSON(res, { users: [] });

    // 按 sec_uid 去重聚合
    const userMap = {};
    // 先建 nickname → sec_uid 映射（从有sec_uid的记录中提取）
    const nickToUid = {};
    for (const r of allRows) {
      if (r.user_sec_uid && r.nickname) nickToUid[r.nickname] = r.user_sec_uid;
    }
    for (const r of allRows) {
      // gift的sec_uid为null时，用nickname从members/danmaku中补全
      const uid = r.user_sec_uid || nickToUid[r.nickname] || '';
      const key = uid || `_noname_${r.nickname}`;
      if (!userMap[key]) {
        userMap[key] = {
          sec_uid: uid,
          db_nicknames: new Set(),
          db_avatar: r.avatar,
          session_ids: new Set(),
          latest_time: 0,
          latest_action: null,
          // 弹幕计数（用于前端列表展示活跃度）
          danmaku_count: 0,
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
      if (r.nickname) {
        u.db_nicknames.add(r.nickname);
        // 记录"命中的名字"：allRows 按 create_time DESC，所以第一条即最近一次命中的名字。
        // 卡片标题用它 —— 搜「神秘人410953」就该显示「神秘人410953」，
        // 而不是库里最常用的那个名字（实测会出现"搜神秘人、标题却是小高冷"）。
        if (!u.matchedName) u.matchedName = r.nickname;
      }
      if (r.session_id) u.session_ids.add(r.session_id);
      if (r.src === 'danmaku') u.danmaku_count += 1;
      // 记录各类最新动作（取每类中时间最大的）
      const t = r.create_time || 0;
      if (r.src === 'gift' && t > u.gift_latest) {
        u.gift_latest = t;
        if (!u._pendingGiftDetails) u._pendingGiftDetails = [];
        u._pendingGiftDetails.push(r);
      } else if (r.src === 'danmaku' && t > u.danmaku_latest) {
        u.danmaku_latest = t;
        if (!u._pendingDanmakuDetails) u._pendingDanmakuDetails = [];
        u._pendingDanmakuDetails.push(r);
      } else if (r.src === 'member' && t > u.member_latest) {
        u.member_latest = t;
        u.member_action = { type: 'member', time: t, detail: '进入直播间', session_id: r.session_id };
      }
    }

    /*
     * === 按 sec_uid 的全库二次聚合（本次修正的核心）===
     *
     * 上面的 userMap 只来自「名字命中」的那 ≤200 行 —— 一个人改过名时，
     * 搜旧名只能看到旧名名下的那几行。实测样本（同一 sec_uid 在库里有 30 个名字）：
     *   全库真实：55 个场次 / 404 条记录 / 119 条弹幕
     *   按名字聚合：场次 2 / 钻石 0 / 弹幕 0（搜新名又是另一组数字）
     * 所以这里按 sec_uid 把该用户的全部记录重新聚合：名字列表、场次、弹幕数、活跃度，
     * 卡片展示的口径从「这个名字」变成「这个人」。
     */
    for (const u of Object.values(userMap)) {
      if (!u.sec_uid) continue;
      // 名字历史 + 最新真名/头像（共用函数，画像接口也用同一套）
      const hist = collectNameHistory(u.sec_uid);
      if (!hist.rows.length) continue;

      u.nickname_stats = hist.stats;
      u.db_nicknames = hist.list.map((s) => s.nickname);
      u.total_rows = hist.rows.length;
      u.first_seen = hist.firstSeen;
      u.newestRealName = hist.newestRealName;
      u.newestRealAvatar = hist.newestRealAvatar;
      u.session_ids = new Set();
      u.danmaku_count = 0;
      // "最近动作"也必须换成全库口径：原来取自命中名字的行，会出现
      // "标题是现用名、最近动作却是旧名在两个月前的那一条"的矛盾。
      // rows 按 create_time DESC，所以每种来源的第一条就是它最新的动作。
      u._pendingGiftDetails = [];
      u._pendingDanmakuDetails = [];
      u.gift_latest = 0;
      u.danmaku_latest = 0;
      u.member_latest = 0;
      for (const r of hist.rows) {
        const t = r.create_time || 0;
        if (r.session_id) u.session_ids.add(r.session_id);
        if (r.src === 'danmaku') u.danmaku_count += 1;
        if (r.src === 'gift' && !u._pendingGiftDetails.length) {
          u.gift_latest = t;
          u._pendingGiftDetails.push(r);
        } else if (r.src === 'danmaku' && !u._pendingDanmakuDetails.length) {
          u.danmaku_latest = t;
          u._pendingDanmakuDetails.push(r);
        } else if (r.src === 'member' && t > u.member_latest) {
          u.member_latest = t;
          u.member_action = { type: 'member', time: t, detail: '进入直播间', session_id: r.session_id };
        }
      }
    }

    // 优先级：弹幕 >= 送礼 > 进场（取时间最大的非进场动作，无则取进场）
    // 批量加载礼物详情（替代逐条查询）
    const pendingGiftRows = [];
    for (const u of Object.values(userMap)) {
      if (u._pendingGiftDetails) pendingGiftRows.push(...u._pendingGiftDetails);
    }
    if (pendingGiftRows.length) {
      const ph = pendingGiftRows.map(() => '(?, ?)').join(',');
      const params = pendingGiftRows.flatMap(r => [r.session_id, r.create_time]);
      // 匿名查询是多用户场景，按 nickname 批量查询
      const giftDetails = [];
      for (const r of pendingGiftRows) {
        const g = dbInstance.prepare('SELECT nickname, session_id, create_time, gift_name, repeat_count, to_nickname FROM gifts WHERE nickname = ? AND session_id = ? AND create_time = ? LIMIT 1').get(r.nickname, r.session_id, r.create_time);
        if (g) giftDetails.push(g);
      }
      const giftIdx = {};
      for (const g of giftDetails) {
        giftIdx[(g.nickname || '') + '\x00' + g.session_id + '\x00' + g.create_time] = g;
      }
      for (const u of Object.values(userMap)) {
        if (!u._pendingGiftDetails) continue;
        for (const r of u._pendingGiftDetails) {
          const g = giftIdx[(r.nickname || '') + '\x00' + r.session_id + '\x00' + r.create_time];
          let detail = g ? `送了${g.to_nickname ? ' ' + g.to_nickname : ''} ${g.gift_name}${g.repeat_count > 1 ? ' ×' + g.repeat_count : ''}` : '送了礼物';
          u.gift_action = { type: 'gift', time: r.create_time || 0, detail, session_id: r.session_id };
        }
        delete u._pendingGiftDetails;
      }
    }
    // 批量加载弹幕详情
    const pendingDanmakuRows = [];
    for (const u of Object.values(userMap)) {
      if (u._pendingDanmakuDetails) pendingDanmakuRows.push(...u._pendingDanmakuDetails);
    }
    if (pendingDanmakuRows.length) {
      const dph = pendingDanmakuRows.map(() => '(?, ?)').join(',');
      const dParams = pendingDanmakuRows.flatMap(r => [r.session_id, r.create_time]);
      const danmakuDetails = dbInstance.prepare(
        `SELECT user_sec_uid, session_id, create_time, content FROM danmaku WHERE (session_id, create_time) IN (${dph})`
      ).all(...dParams);
      const danmakuIdx = {};
      for (const d of danmakuDetails) {
        danmakuIdx[(d.user_sec_uid || '') + '\x00' + d.session_id + '\x00' + d.create_time] = d;
      }
      for (const u of Object.values(userMap)) {
        if (!u._pendingDanmakuDetails) continue;
        for (const r of u._pendingDanmakuDetails) {
          const d = danmakuIdx[(r.user_sec_uid || '') + '\x00' + r.session_id + '\x00' + r.create_time];
          u.danmaku_action = { type: 'danmaku', time: r.create_time || 0, detail: d ? d.content : '发了弹幕', session_id: r.session_id };
        }
        delete u._pendingDanmakuDetails;
      }
    }
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

    // 查询场次名称（含按 sec_uid 聚合出来的完整场次集合）
    const sessionIds = [
      ...new Set([
        ...allRows.map((r) => r.session_id).filter(Boolean),
        ...Object.values(userMap).flatMap((u) => [...u.session_ids])
      ])
    ];
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
    const { fetchUserBySecUid } = require('../../douyin-user');
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

    // 并发获取所有用户 API 信息（最多5个同时请求）
    const apiInfoMap = new Map();
    const secUids = users.filter(u => u.sec_uid).map(u => u.sec_uid);
    const CONCURRENCY = 5;
    for (let i = 0; i < secUids.length; i += CONCURRENCY) {
      const batch = secUids.slice(i, i + CONCURRENCY);
      const results = await Promise.all(
        batch.map(uid => fetchUserBySecUid(uid).catch(() => null))
      );
      batch.forEach((uid, idx) => { if (results[idx]) apiInfoMap.set(uid, results[idx]); });
    }

    const results = [];
    for (const u of users) {
      const apiInfo = apiInfoMap.get(u.sec_uid) || null;
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
        // 完整出现记录（按次数降序）+ 是否为自动生成的名字（douxxx/神秘人），前端按此展示
        nickname_stats: u.nickname_stats
          ? Object.values(u.nickname_stats).sort((a, b) => b.count - a.count)
          : [],
        first_seen: u.first_seen || null,
        total_records: u.total_rows || null,
        db_avatar: u.db_avatar,
        api_nickname: apiInfo?.nickname || null,
        api_avatar: apiInfo?.avatar || null,
        /*
         * 卡片标题/头像 = **库里记录的名字**：
         *   命中搜索的那个名字（最近一次）→ 库里最常用的名字。
         * 真实昵称与头像在用户画像页展示（那里会查抖音接口取最新值）——
         * 用户明确要求：卡片头"该是神秘人就是神秘人"，点进画像才是真实昵称/头像。
         * 接口返回的值仍然保留在 api_nickname / api_avatar 字段里备用。
         */
        nickname: u.matchedName || u.db_nicknames[0],
        avatar: u.db_avatar,
        // 聚合统计（前端查询结果卡片直接展示，避免二次计算）
        total_diamonds: sessions.reduce((s, x) => s + (x.diamonds || 0), 0),
        danmaku_count: u.danmaku_count,
        // API 详细信息
        signature: apiInfo?.signature || '',
        follower_count: apiInfo?.follower_count || 0,
        following_count: apiInfo?.following_count || 0,
        total_favorited: apiInfo?.total_favorited || 0,
        aweme_count: apiInfo?.aweme_count || 0,
        commerce_user_level: apiInfo?.commerce_user_level || 0,
        ip_location: apiInfo?.ip_location || '',
        user_age: apiInfo?.user_age || 0,
        user_gender: apiInfo?.gender || 0,
        is_private: apiInfo?.is_private || false,
        unique_id: apiInfo?.unique_id || '',
        sessions,
        latest_action: latestAction,
        latest_danmaku: u.danmaku_action ? { ...u.danmaku_action, streamer_name: sessionMap[u.danmaku_action.session_id]?.streamer_name || "" } : null,
        latest_gift: u.gift_action ? { ...u.gift_action, streamer_name: sessionMap[u.gift_action.session_id]?.streamer_name || "" } : null,
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
    // 名字历史（库里用过的全部名字）+ 最新真名/头像；昵称头像优先用抖音接口查到的最新值
    const hist = collectNameHistory(secUid);
    let apiInfo = null;
    try {
      const { fetchUserBySecUid } = require('../../douyin-user');
      apiInfo = await fetchUserBySecUid(secUid).catch(() => null);
    } catch {
      /* 接口取不到就只用库里的数据 */
    }
    const nickname =
      apiInfo?.nickname || hist.newestRealName || hist.newestName || dedupedGifts[0]?.nickname || '';
    const avatar =
      apiInfo?.avatar || hist.newestRealAvatar || hist.newestAvatar || dedupedGifts[0]?.avatar || '';
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
    // ====== 用户画像分析 ======

    // 送礼主播偏好（按钻石总额排序）
    // 优先用 to_user_sec_uid + to_nickname，没有的 fallback 到 session 关联直播间
    const sessionStreamerMap = {};
    for (const s of activeSessions) {
      sessionStreamerMap[s.id] = s.streamer_name || '未知';
    }
    const streamerMap = {};
    for (const g of dedupedGifts) {
      let name;
      if (g.to_user_sec_uid) {
        name = g.to_nickname || '未知';
      } else {
        name = sessionStreamerMap[g.session_id] || '未知';
      }
      if (!streamerMap[name]) streamerMap[name] = { name, diamonds: 0, count: 0 };
      streamerMap[name].diamonds += g.total_diamonds || 0;
      streamerMap[name].count += g.repeat_count || 1;
    }
    const topStreamers = Object.values(streamerMap).sort((a, b) => b.diamonds - a.diamonds).slice(0, 5);

    // 送礼频率最高的礼物（按次数）+ 查icon
    const topGiftsByCount = Object.values(giftBreakdownMap).sort((a, b) => b.count - a.count).slice(0, 5);
    const iconStmt = dbInstance.prepare("SELECT icon_url FROM gift_icons WHERE name = ?");
    const iconFuzzyStmt = dbInstance.prepare("SELECT icon_url FROM gift_icons WHERE REPLACE(REPLACE(name,'邮轮','游轮'),'游轮','邮轮') = ? OR name LIKE ?");
    for (const g of topGiftsByCount) {
      let ic = iconStmt.get(g.gift_name);
      if (!ic) ic = iconFuzzyStmt.get(g.gift_name, '%' + g.gift_name.replace(/[\s·]/g, '') + '%');
      g.icon_url = ic?.icon_url || null;
    }

    // 场均消费
    const sessionCount = sessionIds.length || 1;
    const avgPerSession = Math.round(totalDiamonds / sessionCount);

    // 送礼风格判断
    let giftStyle = '随缘观众';
    const maxGiftDiamonds = giftBreakdown[0]?.total_diamonds || 0;
    const bigGiftRatio = maxGiftDiamonds / (totalDiamonds || 1);
    if (totalDiamonds > 50000) giftStyle = '大哥级';
    else if (totalDiamonds > 10000) giftStyle = '重度粉丝';
    else if (totalDiamonds > 2000) giftStyle = '活跃粉丝';
    else if (totalDiamonds > 500) giftStyle = '轻度粉丝';
    if (giftTypes.size <= 3 && giftCount > 5) giftStyle += '（专注型）';
    else if (giftTypes.size > 8) giftStyle += '（多元型）';

    // 活跃时段分析
    let peakHour = '';
    if (hourStats.length) {
      const maxH = hourStats.reduce((a, b) => a.count > b.count ? a : b);
      peakHour = maxH.hour + ':00';
    }

    // 弹幕采样（最近3条）
    const danmakuSamples = dbInstance.prepare(
      'SELECT content, create_time FROM danmaku WHERE user_sec_uid = ? ORDER BY id DESC LIMIT 3'
    ).all(secUid);

    // 弹幕风格分析
    const allDanmaku = dbInstance.prepare(
      'SELECT content FROM danmaku WHERE user_sec_uid = ? ORDER BY id DESC LIMIT 100'
    ).all(secUid);
    let danmakuStyle = '';
    if (allDanmaku.length) {
      const contents = allDanmaku.map(d => d.content || '');
      const avgLen = contents.reduce((s, c) => s + c.length, 0) / contents.length;
      const emojiCount = contents.filter(c => /[\u{1F300}-\u{1F9FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/u.test(c)).length;
      const emojiRatio = emojiCount / contents.length;
      const shortMsgs = contents.filter(c => c.length <= 4).length;
      const shortRatio = shortMsgs / contents.length;

      const traits = [];
      if (emojiRatio > 0.3) traits.push('表情丰富');
      else if (emojiRatio < 0.05) traits.push('纯文字型');
      if (shortRatio > 0.5) traits.push('言简意赅');
      else if (avgLen > 15) traits.push('话痨型');
      if (contents.some(c => /[？?！!~～]/.test(c))) traits.push('热情互动');
      danmakuStyle = traits.length ? traits.join('·') : '安静型';
    }

    // 首次/末次活跃
    const firstGift = dedupedGifts[0];
    const lastGift = dedupedGifts[dedupedGifts.length - 1];
    const firstSeen = firstGift?.create_time || '';
    const lastSeen = lastGift?.create_time || '';

    // 近期行为：弹幕 + 送礼合并按时间倒序（前端时间线要用）。
    // 之前只返回 danmakuSamples 且字段名与前端不一致，导致时间线永远空白。
    const tsToText = (ts) => {
      const n = typeof ts === 'number' ? ts : Number(ts);
      if (!Number.isFinite(n) || n <= 0) return String(ts || '');
      const d = new Date(n > 1e12 ? n : n * 1000);
      if (Number.isNaN(d.getTime())) return String(ts || '');
      const p = (x) => String(x).padStart(2, '0');
      return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
    };
    const recentActions = [
      ...danmakuSamples.map((s) => ({
        type: 'danmaku',
        content: s.content || '',
        rawTime: Number(s.create_time) || 0,
      })),
      ...dedupedGifts.slice(-10).map((g) => ({
        type: 'gift',
        content: `${g.gift_name || '礼物'} ×${g.repeat_count || 1}${g.to_nickname ? ' → ' + g.to_nickname : ''}`,
        rawTime: Number(g.create_time) || 0,
      })),
    ]
      .filter((a) => a.content)
      .sort((a, b) => b.rawTime - a.rawTime)
      .slice(0, 12)
      .map((a) => ({ type: a.type, content: a.content, time: tsToText(a.rawTime) }));

    return sendJSON(res, {
      nickname, avatar, total_diamonds: totalDiamonds, gift_count: giftCount,
      // 库里用过的全部名字（含 douxxx/神秘人 这类自动生成的），供画像页展示
      nicknames: hist.list,
      gift_types_count: giftTypes.size, gift_types: [...giftTypes].join(','),
      activeSessions, hourStats, giftBreakdown, danmakuCount,
      totalDiamonds, totalGifts: giftCount,
      activeSessionCount: activeSessions.length,
      favoriteStreamer: activeSessions[0]?.streamer_name || '-',
      // 分析数据
      topStreamers, topGiftsByCount, avgPerSession, giftStyle,
      peakHour, danmakuSamples, danmakuStyle, firstSeen, lastSeen,
      // 前端时间线需要的合并行为
      recent_actions: recentActions
    });
  }

  return false;
};
