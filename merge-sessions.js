const db = require('./db-sqlite.js');
const fs = require('fs');
const { comboDedupGifts } = require('./lib/gift-utils.js');

async function main() {
  const sessionIds = [31, 32, 33];
  const pool = db.getPool();

  const [sessions] = await pool.query(
    'SELECT * FROM sessions WHERE id IN (?) ORDER BY id', [sessionIds]
  );
  if (!sessions.length) { console.log('No sessions found'); return; }

  const base = sessions[0];
  const startTime = new Date(base.start_time);
  const endTime = sessions[sessions.length - 1].end_time ? new Date(sessions[sessions.length - 1].end_time) : null;

  let allDanmaku = [], allGifts = [], allMembers = [], allOnline = [];
  let totalStatsLike = 0, totalStatsFollow = 0, totalStatsSocial = 0;
  let onlinePeak = 0, totalGiftDiamonds = 0, totalDurationSec = 0;

  for (const s of sessions) {
    const [danmaku] = await pool.query(
      'SELECT nickname, avatar, content, create_time FROM danmaku WHERE session_id = ? ORDER BY create_time', [s.id]);
    const [gifts] = await pool.query(
      'SELECT id, nickname, avatar, to_nickname, to_avatar, to_user_display_id, to_user_sec_uid, gift_name, diamond_count, total_diamonds, repeat_count, create_time, user_display_id, user_sec_uid, trace_id, repeat_end, combo_count, send_type FROM gifts WHERE session_id = ? ORDER BY id', [s.id]);
    const [members] = await pool.query(
      'SELECT nickname, avatar, user_sec_uid, create_time FROM members WHERE session_id = ? ORDER BY create_time', [s.id]);
    const [online] = await pool.query(
      'SELECT count, recorded_at FROM online_records WHERE session_id = ? ORDER BY recorded_at', [s.id]);

    totalStatsLike += (s.stats_like || 0);
    totalStatsFollow += (s.stats_follow || 0);
    totalStatsSocial += (s.stats_social || 0);

    allDanmaku = allDanmaku.concat(danmaku);
    allGifts = allGifts.concat(gifts);
    allMembers = allMembers.concat(members);
    allOnline = allOnline.concat(online);

    // 累加实际直播时长（每场各自持续时间，不含休息间隔）
    totalDurationSec += s.duration_seconds || 0;
    // 从在线记录表取真实峰值（sessions.online_peak 字段可能不准）
    for (const g of gifts) totalGiftDiamonds += (g.total_diamonds || 0);
  }

  // 从 online_records 计算真实峰值
  onlinePeak = allOnline.length > 0 ? Math.max(...allOnline.map(o => o.count)) : 0;

  // Build avatar cache
  const avatarCache = {};
  for (const g of allGifts) {
    if (g.nickname && g.avatar) avatarCache[g.nickname] = g.avatar;
  }
  for (const g of allGifts) {
    if (g.to_nickname && g.to_avatar) avatarCache[g.to_nickname] = g.to_avatar;
  }

  // Store raw gifts with all fields so comboDedupGifts works correctly
  const gRaw = allGifts.map(g => ({
    id: g.id, nickname: g.nickname, avatar: g.avatar || '', gift_name: g.gift_name || '',
    to_nickname: g.to_nickname || '', to_avatar: g.to_avatar || '',
    to_user_display_id: g.to_user_display_id || '', to_user_sec_uid: g.to_user_sec_uid || '',
    user_display_id: g.user_display_id || '', user_sec_uid: g.user_sec_uid || '',
    diamonds: g.diamond_count || 0, total_diamonds: g.total_diamonds || 0,
    count: g.repeat_count || 1, combo_count: g.combo_count || 1,
    repeat_end: g.repeat_end, send_type: g.send_type,
    create_time: g.create_time instanceof Date ? g.create_time.toISOString() : g.create_time,
    describe: ''
  }));

  // Danmaku with time as ISO string
  const dMapped = allDanmaku.map(d => ({
    nickname: d.nickname, avatar: d.avatar || '', content: d.content,
    create_time: d.create_time instanceof Date ? d.create_time.toISOString() : d.create_time
  }));
  const mMapped = allMembers.map(m => ({
    nickname: m.nickname, avatar: m.avatar || '', user_sec_uid: m.user_sec_uid || '',
    create_time: m.create_time instanceof Date ? m.create_time.toISOString() : m.create_time
  }));

  const data = {
    id: sessions.length === 1 ? base.id : `${sessionIds[0]}-${sessionIds[sessionIds.length-1]}`,
    streamer_id: base.streamer_id,
    start_time: startTime.toISOString(),
    end_time: endTime ? endTime.toISOString() : null,
    room_title: base.room_title,
    room_id: base.room_id,
        room_author: base.room_author || base.room_id || '未知',
    room_avatar: base.streamer_avatar || '',
    duration_seconds: totalDurationSec,
    online_peak: onlinePeak,
    stats: {
      danmaku: dMapped.length,
      gift: gRaw.length,
      like: totalStatsLike,
      member: mMapped.length,
      follow: totalStatsFollow,
      social: totalStatsSocial,
      online: onlinePeak
    },
    gifts: gRaw,
    danmaku: dMapped,
    members: mMapped,
    online: allOnline.map(o => ({ count: o.count, time: o.recorded_at })),
    rawMessages: [],
    _avatarCache: avatarCache,
    gift_diamonds: totalGiftDiamonds,
    gift_count: allGifts.length
  };

  const outPath = '/tmp/merged_sessions_' + sessionIds.join('_') + '.json';
  // Add the dedup result count for reference
  const dedupedCount = comboDedupGifts(gRaw).length;
  fs.writeFileSync(outPath, JSON.stringify(data, null, 2));
  console.log(`Written! Gifts: ${gRaw.length} (deduped: ${dedupedCount})`);
  console.log(`Danmaku:${dMapped.length} Members:${mMapped.length}`);
  console.log(`Like:${totalStatsLike} Follow:${totalStatsFollow} Peak:${onlinePeak} Diamonds:${totalGiftDiamonds}`);

  // SQLite: no need to close pool
}

main().catch(e => console.error(e));
