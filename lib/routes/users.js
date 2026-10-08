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

    /*
     * === 阶段一：一次 GROUP BY 拿到「真实规模」和每个人的指标 ===
     *
     * 原来是 `ORDER BY create_time DESC LIMIT 200` —— 先取最近 200 条命中记录、再按 sec_uid
     * 聚合，于是"能查到谁"完全取决于这 200 条里恰好出现过谁。实测搜「神秘人」：
     *   库里真实命中 16,091 条记录 / 2,266 个 sec_uid，接口却只返回 12 个人。
     * 现在先按 sec_uid 分组算真实人数与每人指标，再按最近活跃取前 limit 个做完整聚合
     * （每个用户都要查全库 + 调抖音接口补资料，所以必须限量）。
     */
    /*
     * LIKE 通配符转义：关键词里出现 % 或 _ 时按**字面**匹配。
     * 不转义时搜 "%" 会被拼成 LIKE '%%%' → 等于匹配全库（1.86M 行分组），
     * 实测把后端堵住 20 秒以上、期间所有查询排队 —— 自查时踩到的。
     */
    const escapedQ = String(q).replace(/[\\%_]/g, (m) => `\\${m}`);
    const like = `%${escapedQ}%`;
    const agg = dbInstance
      .prepare(
        `SELECT CASE WHEN uid = '' THEN '_noname_' || nickname ELSE uid END AS key,
                uid, nickname, MAX(create_time) AS last_t, COUNT(1) AS rows_n,
                SUM(CASE WHEN src = 'danmaku' THEN 1 ELSE 0 END) AS danmaku_n,
                COUNT(DISTINCT session_id) AS session_n,
                SUM(CASE WHEN src = 'gift' THEN diamonds ELSE 0 END) AS diamonds_n,
                MAX(avatar) AS avatar
           FROM (
             SELECT COALESCE(NULLIF(user_sec_uid, ''), '') AS uid, nickname, avatar, session_id, create_time, total_diamonds AS diamonds, 'gift' AS src
               FROM gifts WHERE nickname LIKE ? ESCAPE '\\' ${sessionFilter}
             UNION ALL
             SELECT COALESCE(NULLIF(user_sec_uid, ''), ''), nickname, avatar, session_id, create_time, 0, 'danmaku'
               FROM danmaku WHERE nickname LIKE ? ESCAPE '\\' ${sessionFilter}
             UNION ALL
             SELECT COALESCE(NULLIF(user_sec_uid, ''), ''), nickname, avatar, session_id, create_time, 0, 'member'
               FROM members WHERE nickname LIKE ? ESCAPE '\\' ${sessionFilter}
           )
          GROUP BY key
          ORDER BY (uid = '') ASC, last_t DESC`
      )
      .all(like, ...sessionParams, like, ...sessionParams, like, ...sessionParams);
    if (!agg.length) {
      return sendJSON(res, {
        users: [],
        total_users: 0,
        total_records: 0,
        orphan_records: 0,
        returned: 0,
        returned_users: 0,
        limit: Math.min(Math.max(parseInt(query.limit, 10) || 100, 1), 500)
      });
    }

    const limit = Math.min(Math.max(parseInt(query.limit, 10) || 100, 1), 500);
    const realAgg = agg.filter((r) => r.uid);
    const totalUsers = realAgg.length;
    const totalRecords = realAgg.reduce((s, r) => s + r.rows_n, 0);
    const orphanRecords = agg.filter((r) => !r.uid).reduce((s, r) => s + r.rows_n, 0);

    /*
     * === 阶段二：只给前 limit 个用户建对象 ===
     * 无 sec_uid 的记录排在最前会被 slice 掉的风险：SQL 里已把它们排在最后（uid = '' 升序）。
     */
    const userMap = {};
    for (const r of agg.slice(0, limit)) {
      const u = {
        sec_uid: r.uid,
        matchedName: r.nickname,
        // 阶段一算出来的口径：孤儿条目（无 sec_uid）没有 sessions，只能用它
        matchedLastTime: r.last_t || 0,
        aggDiamonds: r.diamonds_n || 0,
        db_nicknames: new Set(r.nickname ? [r.nickname] : []),
        db_avatar: r.avatar || '',
        session_ids: new Set(),
        latest_time: r.last_t || 0,
        latest_action: null,
        danmaku_count: r.danmaku_n || 0,
        gift_latest: 0,
        danmaku_latest: 0,
        member_latest: 0,
        gift_action: null,
        danmaku_action: null,
        member_action: null
      };
      if (r.uid) {
        // 卡片标题要用"最近一次用这个名字出现"的名字（而不是库里最常用的名字）
        const hit = dbInstance
          .prepare(
            `SELECT nickname FROM (
               SELECT nickname, create_time FROM gifts WHERE user_sec_uid = ? AND nickname LIKE ? ESCAPE '\\' ${sessionFilter}
               UNION ALL
               SELECT nickname, create_time FROM danmaku WHERE user_sec_uid = ? AND nickname LIKE ? ESCAPE '\\' ${sessionFilter}
               UNION ALL
               SELECT nickname, create_time FROM members WHERE user_sec_uid = ? AND nickname LIKE ? ESCAPE '\\' ${sessionFilter}
             ) ORDER BY create_time DESC LIMIT 1`
          )
          .get(
            r.uid, like, ...sessionParams,
            r.uid, like, ...sessionParams,
            r.uid, like, ...sessionParams
          );
        if (hit?.nickname) u.matchedName = hit.nickname;
      } else {
        // 没有用户标识的记录：按这个昵称把它自己的场次捞出来（members 没有 nickname 索引，只查 gifts/danmaku）
        const rows = dbInstance
          .prepare(
            `SELECT session_id FROM gifts WHERE COALESCE(NULLIF(user_sec_uid, ''), '') = '' AND nickname = ? ${sessionFilter}
             UNION ALL
             SELECT session_id FROM danmaku WHERE COALESCE(NULLIF(user_sec_uid, ''), '') = '' AND nickname = ? ${sessionFilter}`
          )
          .all(r.nickname, ...sessionParams, r.nickname, ...sessionParams);
        for (const rr of rows) if (rr.session_id) u.session_ids.add(rr.session_id);
      }
      userMap[r.key] = u;
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
      // 卡片底部要显示"最近三条动作"：hist.rows 已按 create_time DESC，取前 3 条（详情后面统一解析）
      u.recentRows = hist.rows.slice(0, 3);
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
      /*
       * 按 (user_sec_uid, session_id, create_time) **逐条**取内容。
       * 原来用 (session_id, create_time) 二元组批量查、再用"返回行的 user_sec_uid"拼索引键：
       * 同一场次同一毫秒有多人发弹幕时，取到的是别人的行 → 该用户匹配不上，
       * 详情就回退成"发了弹幕"（用户反馈：卡片只显示"发了弹幕"、看不到真实内容）。
       */
      const dStmtByUid = dbInstance.prepare(
        'SELECT content FROM danmaku WHERE user_sec_uid = ? AND session_id = ? AND create_time = ? LIMIT 1'
      );
      const dStmtByNick = dbInstance.prepare(
        'SELECT content FROM danmaku WHERE nickname = ? AND session_id = ? AND create_time = ? LIMIT 1'
      );
      for (const u of Object.values(userMap)) {
        if (!u._pendingDanmakuDetails) continue;
        for (const r of u._pendingDanmakuDetails) {
          const d = u.sec_uid
            ? dStmtByUid.get(u.sec_uid, r.session_id, r.create_time)
            : dStmtByNick.get(r.nickname || '', r.session_id, r.create_time);
          u.danmaku_action = {
            type: 'danmaku',
            time: r.create_time || 0,
            detail: d?.content || '发了弹幕',
            session_id: r.session_id
          };
        }
        delete u._pendingDanmakuDetails;
      }
    }
    /*
     * 「最近三条动作」的详情解析。
     *
     * 卡片底部要展示的是**这个人最近做了哪三件事**（弹幕/送礼/进场混合、按时间倒序），
     * 不是"三种动作各一条" —— 后者会把"最近连发三条弹幕、礼物是五天前"这种真实情况显示错。
     * u.recentRows 已经是按时间倒序的前 3 条，这里给每条补上可读的 detail。
     * 无 sec_uid 的孤儿条目没有 recentRows（前端会显示成三行"无记录"）。
     */
    {
      const dStmtUid = dbInstance.prepare(
        'SELECT content FROM danmaku WHERE user_sec_uid = ? AND session_id = ? AND create_time = ? LIMIT 1'
      );
      const dStmtNick = dbInstance.prepare(
        'SELECT content FROM danmaku WHERE nickname = ? AND session_id = ? AND create_time = ? LIMIT 1'
      );
      const gStmt = dbInstance.prepare(
        'SELECT gift_name, repeat_count, to_nickname FROM gifts WHERE nickname = ? AND session_id = ? AND create_time = ? LIMIT 1'
      );
      for (const u of Object.values(userMap)) {
        const list = [];
        // 连击礼物去重：同一场次、同一时刻、同一礼物、同一收礼人的多行是连击进度
        // （×1/×2/×3 各记一行），只保留连击数最大的那条 ——
        // 否则卡片会显示三条一样的礼物，看起来像送了 6 个（用户反馈）。
        const giftSeen = new Map();
        for (const r of u.recentRows || []) {
          const t = r.create_time || 0;
          if (r.src === 'member') {
            list.push({ type: 'member', detail: '进入直播间', time: t });
          } else if (r.src === 'danmaku') {
            const d = u.sec_uid
              ? dStmtUid.get(u.sec_uid, r.session_id, r.create_time)
              : dStmtNick.get(r.nickname || '', r.session_id, r.create_time);
            list.push({ type: 'danmaku', detail: d?.content || '发了弹幕', time: t });
          } else {
            const g = gStmt.get(r.nickname || '', r.session_id, r.create_time);
            const repeat = Number(g?.repeat_count) || 0;
            // 连击各阶段的时间戳可能差 1~2 秒（实测 03:18:45 与 03:18:47），所以键里不带时间，
            // 改为"同一组礼物 + 30 秒内"就视为同一次连击，只保留连击数最大的那条
            const key = [r.session_id, g?.to_nickname || '', g?.gift_name || ''].join('|');
            const detailOf = (n) =>
              g
                ? `送了${g.to_nickname ? ' ' + g.to_nickname : ''} ${g.gift_name}${n > 1 ? ' ×' + n : ''}`
                : '送了礼物';
            const prev = giftSeen.get(key);
            if (prev != null && Math.abs((list[prev].time || 0) - t) <= 30000) {
              // 同一组连击的后续行：只把连击数更大的那条更新上去，不再新增一行
              if (repeat > (list[prev].repeat || 0)) {
                list[prev] = { type: 'gift', detail: detailOf(repeat), time: t, repeat };
              }
              continue;
            }
            giftSeen.set(key, list.length);
            list.push({ type: 'gift', detail: detailOf(repeat), time: t, repeat });
          }
        }
        u.recent = list;
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
    const sessionIds = [...new Set(Object.values(userMap).flatMap((u) => [...u.session_ids]))];
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
        // 孤儿条目（没有 sec_uid）无法按 sec_uid 算钻石，用阶段一聚合出来的和，
        // 否则恒为 0，前端会把它误判成"仅进场 / 没有弹幕与送礼"（审查 A2）
        total_diamonds: u.sec_uid
          ? sessions.reduce((s, x) => s + (x.diamonds || 0), 0)
          : u.aggDiamonds || 0,
        // 阶段一的排序键（命中记录的最后出现时间）：前端排序应与"取前 limit 个"的依据一致
        matched_last_time: u.matchedLastTime || 0,
        // 最近三条动作（≤3，按时间倒序）：卡片底部就渲染这个
        recent: u.recent || [],
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
    /*
     * 如实告诉前端匹配规模：total_users 是库里真实的匹配人数（不受 200 条上限影响），
     * returned 是本次实际返回的人数（受 limit 限制，因为每人要查全库 + 调抖音接口）。
     */
    return sendJSON(res, {
      users: results,
      total_users: totalUsers,
      total_records: totalRecords,
      orphan_records: orphanRecords,
      // returned 含"无用户标识"的条目；returned_users 只算真实用户，供前端判断是否被截断
      returned: results.length,
      returned_users: results.filter((u) => u.sec_uid).length,
      limit
    });
  }

  // --- 用户画像 ---
  if (pathname.startsWith('/api/users/') && !pathname.endsWith('/search')) {
    const secUid = pathname.split('/')[3];
    if (!secUid) return sendError(res, '缺少用户 sec_uid', 400);

    // 读取该用户所有礼物，去重后聚合
    const rawGifts = dbInstance.prepare(
      'SELECT id, session_id, nickname, avatar, user_sec_uid, user_display_id, gift_name, to_user_sec_uid, to_user_display_id, to_nickname, repeat_count, total_diamonds, combo_count, repeat_end, icon, create_time FROM gifts WHERE user_sec_uid = ? ORDER BY id'
    ).all(secUid);
    // 当前时间范围已有其它用户的礼物数据，不足为凭；这里只判断"要不要用弹幕/进场兜底"
    const hasDanmakuRow = dbInstance
      .prepare('SELECT 1 AS x FROM danmaku WHERE user_sec_uid = ? LIMIT 1')
      .get(secUid);
    const hasMemberRow = dbInstance
      .prepare('SELECT 1 AS x FROM members WHERE user_sec_uid = ? LIMIT 1')
      .get(secUid);
    // 存在性判据不能只看礼物：只发过弹幕 / 只进过场的用户也要能看画像
    // （原来 `if (!rawGifts.length) return 404` 会让这类用户点「画像」显示"用户不存在"）
    if (!rawGifts.length && !hasDanmakuRow && !hasMemberRow) {
      return sendError(res, '用户不存在', 404);
    }
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
    let sessionIds = Object.keys(sessionMap);
    // 没有礼物记录（只发弹幕 / 只进场）的用户：场次从弹幕与进场记录里取，
    // 否则画像除了弹幕数之外全是空的（配合"存在性不再只看礼物"一起改）
    if (!sessionIds.length) {
      sessionIds = dbInstance
        .prepare(
          `SELECT DISTINCT session_id FROM danmaku WHERE user_sec_uid = ? AND session_id IS NOT NULL
           UNION
           SELECT DISTINCT session_id FROM members WHERE user_sec_uid = ? AND session_id IS NOT NULL`
        )
        .all(secUid, secUid)
        .map((r) => r.session_id);
    }
    let activeSessions = [];
    if (sessionIds.length) {
      const placeholders = sessionIds.map(() => '?').join(',');
      const sessRows = dbInstance.prepare(
        // st.avatar：活跃场次要显示直播间头像（原来没查这个字段，前端拿不到图）
        `SELECT s.id, s.start_time, s.end_time, st.name as streamer_name, st.avatar as streamer_avatar FROM sessions s LEFT JOIN streamers st ON s.streamer_id = st.id WHERE s.id IN (${placeholders})`
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
    // 馈赠明细也要补图标（原来只给 topGiftsByCount 查了 gift_icons，明细里图标永远为空）
    for (const g of giftBreakdown) {
      let ic = dbInstance.prepare('SELECT icon_url FROM gift_icons WHERE name = ?').get(g.gift_name);
      if (!ic) {
        ic = dbInstance
          .prepare(
            "SELECT icon_url FROM gift_icons WHERE REPLACE(REPLACE(name,'邮轮','游轮'),'游轮','邮轮') = ? OR name LIKE ?"
          )
          .get(g.gift_name, '%' + String(g.gift_name).replace(/[\s·]/g, '') + '%');
      }
      g.icon_url = giftIconMap[g.gift_name] || ic?.icon_url || null;
    }
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
    // 礼物行自带 icon（实测 410326/411940 行有值）—— 这是图标的首选来源；
    // gift_icons 名称表只作兜底（很多新礼物在里面查不到，名称也对不上）
    const giftIconMap = {};
    for (const g of dedupedGifts) {
      if (g.gift_name && g.icon && !giftIconMap[g.gift_name]) giftIconMap[g.gift_name] = g.icon;
    }
    const iconStmt = dbInstance.prepare("SELECT icon_url FROM gift_icons WHERE name = ?");
    const iconFuzzyStmt = dbInstance.prepare("SELECT icon_url FROM gift_icons WHERE REPLACE(REPLACE(name,'邮轮','游轮'),'游轮','邮轮') = ? OR name LIKE ?");
    for (const g of topGiftsByCount) {
      let ic = iconStmt.get(g.gift_name);
      if (!ic) ic = iconFuzzyStmt.get(g.gift_name, '%' + g.gift_name.replace(/[\s·]/g, '') + '%');
      g.icon_url = giftIconMap[g.gift_name] || ic?.icon_url || null;
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

    // 弹幕采样（最近3条）；带 session_id 才能在"近期行为"里显示是哪个直播间
    const danmakuSamples = dbInstance.prepare(
      'SELECT content, create_time, session_id FROM danmaku WHERE user_sec_uid = ? ORDER BY id DESC LIMIT 3'
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
    let firstSeen = firstGift?.create_time || '';
    let lastSeen = lastGift?.create_time || '';
    if (!firstSeen && !lastSeen) {
      // 没有礼物记录：用弹幕/进场的范围兜底
      const range = dbInstance
        .prepare(
          `SELECT MIN(t) AS first, MAX(t) AS last FROM (
             SELECT create_time AS t FROM danmaku WHERE user_sec_uid = ?
             UNION ALL SELECT create_time AS t FROM members WHERE user_sec_uid = ?
           )`
        )
        .get(secUid, secUid);
      firstSeen = range?.first || '';
      lastSeen = range?.last || '';
    }

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
        streamer: sessionStreamerMap[s.session_id] || ''
      })),
      ...dedupedGifts.slice(-10).map((g) => ({
        type: 'gift',
        content: `${g.gift_name || '礼物'} ×${g.repeat_count || 1}${g.to_nickname ? ' → ' + g.to_nickname : ''}`,
        rawTime: Number(g.create_time) || 0,
        streamer: sessionStreamerMap[g.session_id] || ''
      })),
    ]
      .filter((a) => a.content)
      .sort((a, b) => b.rawTime - a.rawTime)
      .slice(0, 12)
      .map((a) => ({
        type: a.type,
        content: a.content,
        time: tsToText(a.rawTime),
        streamer: a.streamer
      }));

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
