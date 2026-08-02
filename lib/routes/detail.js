const path = require('path');
const fs = require('fs');

module.exports = async function(pathname, query, req, res, ctx) {
  const { dbInstance, sendJSON, sendError, comboDedupGifts, getAvatarBySecUid, DATA_DIR } = ctx;

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
      if (g.nickname && !g.nickname.startsWith('神秘人')) {
        giftUserMap[uid].nickname = g.nickname;
        if (g.avatar_url) giftUserMap[uid].avatar_url = g.avatar_url;
      }
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
          total_diamonds: 0, count: 0, avatar_url: g.avatar_url, gift_icon: null, create_time: g.create_time || 0
        };
      }
      if (g.nickname && !g.nickname.startsWith('神秘人')) {
        giftDetailMap[key].nickname = g.nickname;
        if (g.avatar_url) giftDetailMap[key].avatar_url = g.avatar_url;
      }
      giftDetailMap[key].total_diamonds += g.total_diamonds || 0;
      giftDetailMap[key].count += g.repeat_count || 1;
      // 保留最新时间
      if ((g.create_time || 0) > giftDetailMap[key].create_time) giftDetailMap[key].create_time = g.create_time;
    }
    // 补充 avatar 和 icon
    const details = Object.values(giftDetailMap);
    // 批量加载 avatar：一次查出本场次所有有 avatar 的昵称
    const avatarMap = {};
    try {
      const avRows = dbInstance.prepare('SELECT DISTINCT nickname, avatar FROM gifts WHERE session_id = ? AND avatar IS NOT NULL').all(sid);
      for (const row of avRows) avatarMap[row.nickname] = row.avatar;
    } catch (e) { /* ignore */ }
    // 批量补充 avatar
    for (const d of details) {
      if (!d.avatar_url) {
        d.avatar_url = avatarMap[d.nickname] || null;
      }
    }
    // 批量加载礼物图标：一次查出本场次所有有 icon 的礼物
    const iconMap = {};
    try {
      const iconRows = dbInstance.prepare('SELECT DISTINCT gift_name, icon FROM gifts WHERE session_id = ? AND icon IS NOT NULL').all(sid);
      for (const row of iconRows) iconMap[row.gift_name] = row.icon;
    } catch (e) { /* 表可能没有 icon 列 */ }
    // 批量查 gift_icons 表
    const giftIconNames = [...new Set(details.filter(d => !iconMap[d.gift_name]).map(d => d.gift_name))];
    const giftIconMap = {};
    if (giftIconNames.length) {
      for (const name of giftIconNames) {
        let gi = dbInstance.prepare('SELECT icon_url FROM gift_icons WHERE name = ?').get(name);
        if (!gi) {
          gi = dbInstance.prepare('SELECT icon_url FROM gift_icons WHERE REPLACE(REPLACE(name,\'邮轮\',\'游轮\'),\'游轮\',\'邮轮\') = ? OR name LIKE ?').get(name, '%' + name.replace(/[·\s]/g, '') + '%');
        }
        if (gi) giftIconMap[name] = gi.icon_url;
      }
    }
    // 合并图标到 giftDetailMap
    for (const d of details) {
      d.gift_icon = iconMap[d.gift_name] || giftIconMap[d.gift_name] || null;
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
    
    // Note: No fallback for个播 — if no to_user_sec_uid in gifts, anchorRanking stays empty
    // Frontend only shows anchor tab when anchorRanking.length > 1 (团播 detection)
    // 补充头像
    for (const a of anchorRanking) {
      if (!a.anchor_avatar && a.anchor_sec_uid) {
        a.anchor_avatar = getAvatarBySecUid(dbInstance, sid, a.anchor_sec_uid);
      }
    }
    // 对仍然没有头像的主播，并发调用 API 获取（而非串行）
    const { fetchUserBySecUid } = require('../../douyin-user');
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

    // 弹幕（用于展示和搜索）
    const allDanmaku = dbInstance.prepare(`
      SELECT nickname, avatar as avatar_url, content, create_time as timestamp, user_sec_uid
      FROM danmaku WHERE session_id = ?
      ORDER BY create_time DESC
    `).all(sid);
    const danmaku = allDanmaku;
    const latestDanmaku = allDanmaku.slice(0, 200);

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

    const summary = {};
    // 已结束场次：用预聚合数据
    if (session.end_time && session.agg_gifts != null) {
      summary.total_diamonds = session.agg_diamonds || 0;
      summary.total_gifts = session.agg_gifts || 0;
      summary.total_danmaku = session.agg_danmaku || danmaku.length;
      summary.danmaku_count = session.agg_danmaku || danmaku.length;
      summary.user_count = session.agg_users || new Set(dedupedGifts.map(g => g.user_sec_uid).filter(Boolean).concat(danmaku.map(d => d.user_sec_uid).filter(Boolean))).size;
    } else {
      // 直播中：实时计算
      summary.total_diamonds = dedupedGifts.reduce((s, g) => s + (g.total_diamonds || 0), 0);
      summary.total_gifts = dedupedGifts.reduce((s, g) => s + (g.repeat_count || 1), 0);
      summary.total_danmaku = danmaku.length;
      summary.danmaku_count = danmaku.length;
      summary.user_count = new Set(dedupedGifts.map(g => g.user_sec_uid).filter(Boolean).concat(danmaku.map(d => d.user_sec_uid).filter(Boolean))).size;
    }
    summary.timeline = Object.values(timeMap).sort((a, b) => (a.time || '').localeCompare(b.time || ''));

    // 检查报告
    const reportPath = path.join(DATA_DIR, 'reports', `report_${sid}.jpg`);
    const hasReport = fs.existsSync(reportPath);

    return sendJSON(res, {
      session: {
        id: session.id,
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
      gifts, giftDetails, anchorRanking, danmakuWords, danmakuRanking, danmaku: latestDanmaku, summary, hasReport
    });
  }

  return false;
};
