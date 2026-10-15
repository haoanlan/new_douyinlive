const path = require('path');
const fs = require('fs');
const { getGiftIconLookup } = require('../gift-utils.js');

/**
 * 主详情接口里"最新动态"需要的礼物条数。
 * 动态列表只展示时间线（弹幕 + 礼物），不需要全量；全量走 /gift-details。
 */
const GIFT_FEED_LIMIT = 200;

module.exports = async function(pathname, query, req, res, ctx) {
  const { dbInstance, sendJSON, sendError, comboDedupGifts, getAvatarBySecUid, DATA_DIR } = ctx;
  // 礼物图标全库查表（带缓存）：场次内没抓到图标时用它兜底
  const giftIconOf = getGiftIconLookup(dbInstance);

  // --- 场次完整详情 ---
  if (pathname.startsWith('/api/sessions/') && pathname.endsWith('/detail')) {
    const sid = parseInt(pathname.split('/')[3]);
    const session = dbInstance.prepare(`
      SELECT s.*, st.name as streamer_name, st.avatar as streamer_avatar
      FROM sessions s LEFT JOIN streamers st ON s.streamer_id = st.id WHERE s.id = ?
    `).get(sid);
    if (!session) return sendError(res, '场次不存在', 404);

    const isEnded = session.end_time != null;
    let gifts, giftDetails, anchorRanking, danmakuRanking, timeline;

    if (isEnded) {
      // 已结束场次：直接读预聚合表
      gifts = dbInstance.prepare('SELECT nickname, avatar_url, user_sec_uid, total_diamonds, gift_count FROM session_gift_ranking WHERE session_id = ? ORDER BY rank').all(sid);
      /*
       * 礼物明细只取「最新 200 条」——这里**只为喂"最新动态"的时间线**。
       *
       * 原来这里读全量（实测 7024 条）并在 JS 里做一遍汇总/排序，
       * 光这一步就让 /detail 多花约 600ms，而首屏根本用不到全量：
       * 全量明细由 /gift-details 在弹窗打开时按需提供（那条查询按钻石排序）。
       * 所以这里按 create_time 倒序取前 200 条即可。
       */
      giftDetails = dbInstance
        .prepare(
          'SELECT nickname, user_sec_uid, gift_name, to_nickname, total_diamonds, count, avatar_url, gift_icon, create_time FROM session_gift_details WHERE session_id = ? ORDER BY create_time DESC LIMIT ?'
        )
        .all(sid, GIFT_FEED_LIMIT);
      anchorRanking = dbInstance.prepare('SELECT anchor_sec_uid, anchor_name, anchor_avatar, total_diamonds, gift_count, user_count FROM session_anchor_ranking WHERE session_id = ? ORDER BY total_diamonds DESC').all(sid);
      danmakuRanking = dbInstance.prepare('SELECT nickname, avatar, user_sec_uid, msg_count FROM session_danmaku_ranking WHERE session_id = ? ORDER BY rank').all(sid);
      timeline = dbInstance.prepare('SELECT time, gifts, diamonds, danmaku FROM session_timeline WHERE session_id = ? ORDER BY time').all(sid);
      // 补充缺失的主播头像
      for (const a of anchorRanking) {
        if (!a.anchor_avatar && a.anchor_sec_uid) a.anchor_avatar = getAvatarBySecUid(dbInstance, sid, a.anchor_sec_uid);
      }
      const missingAnchors = anchorRanking.filter(a => !a.anchor_avatar && a.anchor_sec_uid);
      if (missingAnchors.length > 0) {
        const { fetchUserBySecUid } = require('../../douyin-user');
        await Promise.all(missingAnchors.map(async a => {
          try {
            const info = await fetchUserBySecUid(a.anchor_sec_uid);
            if (info && info.avatar) {
              a.anchor_avatar = info.avatar;
              dbInstance.prepare('UPDATE gifts SET to_avatar = ? WHERE session_id = ? AND to_user_sec_uid = ? AND to_avatar IS NULL').run(info.avatar, sid, a.anchor_sec_uid);
              dbInstance.prepare('UPDATE session_anchor_ranking SET anchor_avatar = ? WHERE session_id = ? AND anchor_sec_uid = ?').run(info.avatar, sid, a.anchor_sec_uid);
            }
          } catch (e) {}
        }));
      }
    } else {
      // 直播中：实时计算
      const rawGifts = dbInstance.prepare(`
        SELECT id, nickname, avatar as avatar_url, user_sec_uid, user_display_id,
          gift_name, to_nickname, to_user_sec_uid, to_user_display_id,
          diamond_count, repeat_count, total_diamonds,
          combo_count, repeat_end, create_time
        FROM gifts WHERE session_id = ? ORDER BY id
      `).all(sid);
      const dedupedGifts = comboDedupGifts(rawGifts);

      // 礼物排行
      const giftUserMap = {};
      for (const g of dedupedGifts) {
        const uid = g.user_sec_uid || g.nickname;
        if (!giftUserMap[uid]) giftUserMap[uid] = { nickname: g.nickname, avatar_url: g.avatar_url, user_sec_uid: g.user_sec_uid, total_diamonds: 0, gift_count: 0 };
        if (g.nickname && !g.nickname.startsWith('神秘人')) { giftUserMap[uid].nickname = g.nickname; if (g.avatar_url) giftUserMap[uid].avatar_url = g.avatar_url; }
        giftUserMap[uid].total_diamonds += g.total_diamonds || 0;
        giftUserMap[uid].gift_count += g.repeat_count || 1;
      }
      gifts = Object.values(giftUserMap).sort((a, b) => b.total_diamonds - a.total_diamonds).slice(0, 20);

      // 礼物明细
      const giftDetailMap = {};
      for (const g of dedupedGifts) {
        const key = (g.user_sec_uid || g.nickname) + '\x00' + (g.gift_name || '') + '\x00' + (g.to_nickname || '');
        if (!giftDetailMap[key]) giftDetailMap[key] = { nickname: g.nickname, user_sec_uid: g.user_sec_uid, gift_name: g.gift_name, to_nickname: g.to_nickname, total_diamonds: 0, count: 0, avatar_url: g.avatar_url, gift_icon: null, create_time: g.create_time || 0 };
        if (g.nickname && !g.nickname.startsWith('神秘人')) { giftDetailMap[key].nickname = g.nickname; if (g.avatar_url) giftDetailMap[key].avatar_url = g.avatar_url; }
        giftDetailMap[key].total_diamonds += g.total_diamonds || 0;
        giftDetailMap[key].count += g.repeat_count || 1;
        if ((g.create_time || 0) > giftDetailMap[key].create_time) giftDetailMap[key].create_time = g.create_time;
      }
      const details = Object.values(giftDetailMap);
      try {
        const avRows = dbInstance.prepare('SELECT DISTINCT nickname, avatar FROM gifts WHERE session_id = ? AND avatar IS NOT NULL').all(sid);
        const avatarMap = {}; for (const r of avRows) avatarMap[r.nickname] = r.avatar;
        for (const d of details) { if (!d.avatar_url) d.avatar_url = avatarMap[d.nickname] || null; }
      } catch (e) {}
      try {
        /*
         * 图标来源优先级：本场次礼物行自带的 icon → 全库同礼物名的 icon → gift_icons 名称表。
         *
         * 为什么必须加全库这一层：早期录制的场次整场都没抓到图标
         * （实测场次 13 里「钻石跑车」12 行、「定制跑车」13 行、「烈焰跑车」23 行、
         * 「玫瑰星瀚」20 行，icon 全是空串），而 gift_icons 名称表里也没有这些名字，
         * 于是这几类礼物在详情页永远没有图标。图标跟场次无关，全库能查到就该用。
         *
         * 另外：同一礼物名有一部分行的 icon 是空的（「钻石跑车」206/288），
         * DISTINCT 会把空串也带出来，而"谁最后赋值"不确定 —— 空串后到就把好图标覆盖了，
         * 所以只收非空值、且不覆盖已有的非空值。
         */
        const iconRows = dbInstance
          .prepare("SELECT DISTINCT gift_name, icon FROM gifts WHERE session_id = ? AND icon IS NOT NULL AND icon != ''")
          .all(sid);
        const iconMap = {}; for (const r of iconRows) { if (!iconMap[r.gift_name]) iconMap[r.gift_name] = r.icon; }
        const giftIconNames = [...new Set(details.filter(d => !iconMap[d.gift_name]).map(d => d.gift_name))];
        const giftIconMap = {};
        if (giftIconNames.length) {
          for (const name of giftIconNames) {
            const global = giftIconOf(name);
            if (global) { giftIconMap[name] = global; continue; }
            let gi = dbInstance.prepare('SELECT icon_url FROM gift_icons WHERE name = ?').get(name);
            if (!gi) gi = dbInstance.prepare("SELECT icon_url FROM gift_icons WHERE REPLACE(REPLACE(name,'邮轮','游轮'),'游轮','邮轮') = ? OR name LIKE ?").get(name, '%' + name.replace(/[·\\s]/g, '') + '%');
            if (gi) giftIconMap[name] = gi.icon_url;
          }
        }
        for (const d of details) d.gift_icon = iconMap[d.gift_name] || giftIconMap[d.gift_name] || null;
      } catch (e) {}
      giftDetails = Object.values(giftDetailMap).sort((a, b) => b.total_diamonds - a.total_diamonds);

      // 主播排名
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
      anchorRanking = Object.values(anchorMap).map(a => ({ ...a, user_count: a.users.size })).sort((a, b) => b.total_diamonds - a.total_diamonds);
      for (const a of anchorRanking) {
        if (!a.anchor_avatar && a.anchor_sec_uid) a.anchor_avatar = getAvatarBySecUid(dbInstance, sid, a.anchor_sec_uid);
      }
      const { fetchUserBySecUid } = require('../../douyin-user');
      const avatarPromises = anchorRanking.filter(a => !a.anchor_avatar && a.anchor_sec_uid).map(async a => {
        try {
          const info = await fetchUserBySecUid(a.anchor_sec_uid);
          if (info && info.avatar) {
            a.anchor_avatar = info.avatar;
            dbInstance.prepare('UPDATE gifts SET to_avatar = ? WHERE session_id = ? AND to_user_sec_uid = ? AND to_avatar IS NULL').run(info.avatar, sid, a.anchor_sec_uid);
          }
        } catch (e) {}
      });
      await Promise.all(avatarPromises);

      // 弹幕排行
      danmakuRanking = dbInstance.prepare(`SELECT nickname, avatar, user_sec_uid, COUNT(*) as msg_count FROM danmaku WHERE session_id = ? AND nickname IS NOT NULL GROUP BY user_sec_uid ORDER BY msg_count DESC LIMIT 30`).all(sid);

      // 时间线
      const timeLineMap = {};
      for (const g of dedupedGifts) {
        const ts = g.create_time; if (!ts) continue;
        let timeKey;
        if (typeof ts === 'number') {
          const d = new Date(ts > 1e12 ? ts : ts * 1000);
          timeKey = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')} ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}:00`;
        } else { timeKey = String(ts).slice(0, 16) + ':00'; }
        if (!timeLineMap[timeKey]) timeLineMap[timeKey] = { time: timeKey, gifts: 0, diamonds: 0 };
        timeLineMap[timeKey].gifts += g.repeat_count || 1;
        timeLineMap[timeKey].diamonds += g.total_diamonds || 0;
      }
      const danmakuTimeline = dbInstance.prepare(`SELECT strftime('%Y-%m-%d %H:%M:00', create_time, 'unixepoch', 'localtime') as time, COUNT(*) as danmaku FROM danmaku WHERE session_id = ? GROUP BY time ORDER BY time`).all(sid);
      const timeMap = {};
      Object.values(timeLineMap).forEach(t => { timeMap[t.time] = { time: t.time, gifts: t.gifts, diamonds: t.diamonds, danmaku: 0 }; });
      danmakuTimeline.forEach(t => { if (!timeMap[t.time]) timeMap[t.time] = { time: t.time, gifts: 0, diamonds: 0, danmaku: 0 }; timeMap[t.time].danmaku = t.danmaku; });
      timeline = Object.values(timeMap).sort((a, b) => (a.time || '').localeCompare(b.time || ''));
    }

    // 弹幕（用于展示和搜索）- 始终从表读
    const allDanmaku = dbInstance.prepare(`
      SELECT nickname, avatar as avatar_url, content, create_time as timestamp, user_sec_uid
      FROM danmaku WHERE session_id = ? ORDER BY create_time DESC
    `).all(sid);
    const danmaku = allDanmaku;
    const latestDanmaku = allDanmaku.slice(0, 200);

    // 弹幕词频
    const danmakuWords = dbInstance.prepare(`
      SELECT content, COUNT(*) as cnt
      FROM danmaku WHERE session_id = ? AND content IS NOT NULL AND content != ''
      GROUP BY content ORDER BY cnt DESC LIMIT 100
    `).all(sid);

    // summary
    const summary = {};
    if (isEnded && session.agg_gifts != null) {
      summary.total_diamonds = session.agg_diamonds || 0;
      summary.total_gifts = session.agg_gifts || 0;
      summary.total_danmaku = session.agg_danmaku || danmaku.length;
      summary.danmaku_count = session.agg_danmaku || danmaku.length;
      summary.user_count = session.agg_users || 0;
    } else {
      const rawGifts = gifts; // already computed above for live
      summary.total_diamonds = (Array.isArray(rawGifts) ? rawGifts : []).reduce((s, g) => s + (g.total_diamonds || 0), 0);
      summary.total_gifts = (Array.isArray(rawGifts) ? rawGifts : []).reduce((s, g) => s + (g.gift_count || 0), 0);
      summary.total_danmaku = danmaku.length;
      summary.danmaku_count = danmaku.length;
      summary.user_count = new Set((Array.isArray(rawGifts) ? rawGifts : []).map(g => g.user_sec_uid).filter(Boolean).concat(danmaku.map(d => d.user_sec_uid).filter(Boolean))).size;
    }
    summary.timeline = timeline;

    // 检查报告
    const reportPath = path.join(DATA_DIR, 'reports', `report_${sid}.jpg`);
    const hasReport = fs.existsSync(reportPath);

    /*
     * 礼物图标补全（统一在一次收口，直播中/已结束两条路径都覆盖）。
     *
     * 已结束场次直接从预聚合表 session_gift_details 读 gift_icon，那是**录制当时**写进去的；
     * 早期录制的场次整场都没抓到图标（实测场次 13 的「钻石跑车」12 行、「定制跑车」13 行、
     * 「烈焰跑车」23 行、「玫瑰星瀚」20 行 icon 全是空串），而 gift_icons 名称表里
     * 也没有这些名字 —— 于是详情页这几类礼物永远没有图标。
     * 礼物图标跟场次无关，全库能查到就补上。
     */
    let iconFilled = 0;
    for (const d of giftDetails || []) {
      if (d.gift_icon) continue;
      const url = giftIconOf(d.gift_name);
      if (url) {
        d.gift_icon = url;
        iconFilled++;
      }
    }
    if (iconFilled) console.log(`[detail] 场次 ${sid} 从全库补回 ${iconFilled} 条礼物图标`);

    /*
     * 主响应里**不放全量礼物明细**（用户实测：单 giftDetails 一个字段就 3299KB / 7024 条，
     * 整个接口 3.2MB / 1.9 秒，而首屏其实只要排名）。
     * 这里只给「最新 200 条」，供"最新动态"把弹幕与礼物按时间线合并；
     * 全量明细（送礼人员弹窗、团播主播弹窗要按人筛选/汇总）走
     * GET /api/sessions/:id/gift-details 按需拉取。
     */
    const giftFeed = [...(giftDetails || [])]
      .sort((a, b) => (Number(b.create_time) || 0) - (Number(a.create_time) || 0))
      .slice(0, GIFT_FEED_LIMIT);

    return sendJSON(res, {
      session: {
        id: session.id,
        streamer_id: session.streamer_id,
        room_id: session.room_id,
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
      gifts, giftFeed, giftDetailsTotal: isEnded
        ? dbInstance.prepare('SELECT COUNT(*) c FROM session_gift_details WHERE session_id = ?').get(sid).c
        : dbInstance.prepare('SELECT COUNT(*) c FROM gifts WHERE session_id = ?').get(sid).c,
      anchorRanking, danmakuWords, danmakuRanking, danmaku: latestDanmaku, summary, hasReport
    });
  }

  /*
   * --- 场次的全量礼物明细（按需）---
   *
   * 从 /detail 拆出来的原因：这一份就有 3299KB / 7024 条（实测），
   * 而首屏只需要排名；明细是"礼物排行点开某人的送礼明细""团播主播点开某主播的送礼人"
   * 两个弹窗用的，用户点开时再拉即可。
   * 排序与原来一致（按钻石降序），前端拿到就能直接用。
   */
  if (pathname.startsWith('/api/sessions/') && pathname.endsWith('/gift-details')) {
    const sid = parseInt(pathname.split('/')[3]);
    const session = dbInstance.prepare('SELECT id, end_time FROM sessions WHERE id = ?').get(sid);
    if (!session) return sendError(res, '场次不存在', 404);

    let list;
    if (session.end_time != null) {
      // 已结束场次：读预聚合表
      list = dbInstance.prepare(
        `SELECT nickname, user_sec_uid, gift_name, to_nickname, total_diamonds, count as repeat_count,
                avatar_url, gift_icon, create_time
         FROM session_gift_details WHERE session_id = ?`
      ).all(sid).map((r) => ({
        ...r,
        avatar_url: r.avatar_url || getAvatarBySecUid(r.user_sec_uid) || null
      }));
    } else {
      // 直播中：现算（与 /detail 内的口径一致）
      const raw = dbInstance.prepare('SELECT * FROM gifts WHERE session_id = ? ORDER BY id').all(sid);
      const deduped = ctx.comboDedupGifts(raw);
      const map = new Map();
      for (const g of deduped) {
        const key = (g.user_sec_uid || g.nickname) + '\x00' + (g.gift_name || '') + '\x00' + (g.to_nickname || '');
        const cur = map.get(key) || {
          nickname: g.nickname,
          user_sec_uid: g.user_sec_uid,
          gift_name: g.gift_name,
          to_nickname: g.to_nickname,
          total_diamonds: 0,
          repeat_count: 0,
          avatar_url: g.avatar_url || g.avatar || null,
          gift_icon: g.icon || null,
          create_time: g.create_time || 0
        };
        cur.total_diamonds += g.total_diamonds || 0;
        cur.repeat_count += g.repeat_count || 1;
        if ((g.create_time || 0) > cur.create_time) cur.create_time = g.create_time || 0;
        map.set(key, cur);
      }
      list = [...map.values()];
    }

    // 图标兜底与 /detail 一致：场次内没抓到就从全库查表补
    let filled = 0;
    for (const d of list) {
      if (d.gift_icon) continue;
      const url = giftIconOf(d.gift_name);
      if (url) {
        d.gift_icon = url;
        filled++;
      }
    }
    if (filled) console.log(`[gift-details] 场次 ${sid} 从全库补回 ${filled} 条礼物图标`);
    list.sort((a, b) => (b.total_diamonds || 0) - (a.total_diamonds || 0));

    return sendJSON(res, { giftDetails: list, total: list.length });
  }

  return false;
};
