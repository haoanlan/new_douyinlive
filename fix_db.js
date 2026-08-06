const fs = require('fs');
let c = fs.readFileSync('db-sqlite.js', 'utf8');

// 1. Add precomputed tables before ];
c = c.replace(
  "    `CREATE INDEX IF NOT EXISTS idx_gifts_create_time ON gifts(create_time)`\n  ];",
  `    \`CREATE INDEX IF NOT EXISTS idx_gifts_create_time ON gifts(create_time)\`,
    \`CREATE TABLE IF NOT EXISTS session_gift_ranking (
      session_id INTEGER NOT NULL, rank INTEGER NOT NULL,
      nickname TEXT, avatar_url TEXT, user_sec_uid TEXT,
      total_diamonds INTEGER DEFAULT 0, gift_count INTEGER DEFAULT 0,
      PRIMARY KEY (session_id, rank), FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
    )\`,
    \`CREATE TABLE IF NOT EXISTS session_anchor_ranking (
      session_id INTEGER NOT NULL, anchor_sec_uid TEXT NOT NULL,
      anchor_name TEXT, anchor_avatar TEXT,
      total_diamonds INTEGER DEFAULT 0, gift_count INTEGER DEFAULT 0, user_count INTEGER DEFAULT 0,
      PRIMARY KEY (session_id, anchor_sec_uid), FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
    )\`,
    \`CREATE TABLE IF NOT EXISTS session_danmaku_ranking (
      session_id INTEGER NOT NULL, rank INTEGER NOT NULL,
      nickname TEXT, avatar TEXT, user_sec_uid TEXT, msg_count INTEGER DEFAULT 0,
      PRIMARY KEY (session_id, rank), FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
    )\`,
    \`CREATE TABLE IF NOT EXISTS session_gift_details (
      session_id INTEGER NOT NULL, id INTEGER PRIMARY KEY AUTOINCREMENT,
      nickname TEXT, user_sec_uid TEXT, gift_name TEXT, to_nickname TEXT,
      total_diamonds INTEGER DEFAULT 0, count INTEGER DEFAULT 0,
      avatar_url TEXT, gift_icon TEXT, create_time INTEGER DEFAULT 0,
      FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
    )\`,
    \`CREATE INDEX IF NOT EXISTS idx_session_gift_details_sid ON session_gift_details(session_id)\`,
    \`CREATE TABLE IF NOT EXISTS session_timeline (
      session_id INTEGER NOT NULL, time TEXT NOT NULL,
      gifts INTEGER DEFAULT 0, diamonds INTEGER DEFAULT 0, danmaku INTEGER DEFAULT 0,
      PRIMARY KEY (session_id, time), FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
    )\`
  ];`
);

// 2. Add buildPrecomputed call before catch in endSession
c = c.replace(
  "    d.prepare('UPDATE sessions SET agg_gifts=?, agg_diamonds=?, agg_danmaku=?, agg_users=? WHERE id=?')\n      .run(agg_gifts, agg_diamonds, dmRow.cnt, agg_users, sessionId);\n  } catch (e) {",
  "    d.prepare('UPDATE sessions SET agg_gifts=?, agg_diamonds=?, agg_danmaku=?, agg_users=? WHERE id=?')\n      .run(agg_gifts, agg_diamonds, dmRow.cnt, agg_users, sessionId);\n    // 写入预聚合表\n    buildPrecomputed(d, sessionId, deduped);\n  } catch (e) {"
);

// 3. Add buildPrecomputed function before updateSessionStats
const buildFn = `
/** 构建预聚合数据并写入表 */
function buildPrecomputed(d, sessionId, dedupedGifts) {
  d.prepare('DELETE FROM session_gift_ranking WHERE session_id = ?').run(sessionId);
  d.prepare('DELETE FROM session_anchor_ranking WHERE session_id = ?').run(sessionId);
  d.prepare('DELETE FROM session_danmaku_ranking WHERE session_id = ?').run(sessionId);
  d.prepare('DELETE FROM session_gift_details WHERE session_id = ?').run(sessionId);
  d.prepare('DELETE FROM session_timeline WHERE session_id = ?').run(sessionId);

  // 礼物排行 top20
  const giftUserMap = {};
  for (const g of dedupedGifts) {
    const uid = g.user_sec_uid || g.nickname;
    if (!giftUserMap[uid]) giftUserMap[uid] = { nickname: g.nickname, avatar_url: g.avatar_url, user_sec_uid: g.user_sec_uid, total_diamonds: 0, gift_count: 0 };
    if (g.nickname && !g.nickname.startsWith('神秘人')) { giftUserMap[uid].nickname = g.nickname; if (g.avatar_url) giftUserMap[uid].avatar_url = g.avatar_url; }
    giftUserMap[uid].total_diamonds += g.total_diamonds || 0;
    giftUserMap[uid].gift_count += g.repeat_count || 1;
  }
  const giftRanking = Object.values(giftUserMap).sort((a, b) => b.total_diamonds - a.total_diamonds).slice(0, 20);
  const insGR = d.prepare('INSERT INTO session_gift_ranking (session_id, rank, nickname, avatar_url, user_sec_uid, total_diamonds, gift_count) VALUES (?,?,?,?,?,?,?)');
  giftRanking.forEach((g, i) => insGR.run(sessionId, i + 1, g.nickname, g.avatar_url, g.user_sec_uid, g.total_diamonds, g.gift_count));

  // 主播排名
  const anchorMap = {};
  for (const g of dedupedGifts) {
    const key = g.to_user_sec_uid || '';
    if (!key) continue;
    if (!anchorMap[key]) anchorMap[key] = { anchor_sec_uid: key, anchor_name: g.to_nickname || '', anchor_avatar: g.to_avatar || null, total_diamonds: 0, gift_count: 0, users: new Set() };
    anchorMap[key].total_diamonds += g.total_diamonds || 0;
    anchorMap[key].gift_count += g.repeat_count || 1;
    if (g.nickname) anchorMap[key].users.add(g.nickname);
    if (g.to_nickname && !anchorMap[key].anchor_name) anchorMap[key].anchor_name = g.to_nickname;
  }
  const insAR = d.prepare('INSERT INTO session_anchor_ranking (session_id, anchor_sec_uid, anchor_name, anchor_avatar, total_diamonds, gift_count, user_count) VALUES (?,?,?,?,?,?,?)');
  for (const a of Object.values(anchorMap)) {
    insAR.run(sessionId, a.anchor_sec_uid, a.anchor_name, a.anchor_avatar, a.total_diamonds, a.gift_count, a.users.size);
  }

  // 弹幕排行 top30
  const danmakuRanking = d.prepare('SELECT nickname, avatar, user_sec_uid, COUNT(*) as msg_count FROM danmaku WHERE session_id = ? AND nickname IS NOT NULL GROUP BY user_sec_uid ORDER BY msg_count DESC LIMIT 30').all(sessionId);
  const insDR = d.prepare('INSERT INTO session_danmaku_ranking (session_id, rank, nickname, avatar, user_sec_uid, msg_count) VALUES (?,?,?,?,?,?)');
  danmakuRanking.forEach((d, i) => insDR.run(sessionId, i + 1, d.nickname, d.avatar, d.user_sec_uid, d.msg_count));

  // 礼物明细
  const giftDetailMap = {};
  for (const g of dedupedGifts) {
    const key = (g.user_sec_uid || g.nickname) + '\\x00' + (g.gift_name || '') + '\\x00' + (g.to_nickname || '');
    if (!giftDetailMap[key]) giftDetailMap[key] = { nickname: g.nickname, user_sec_uid: g.user_sec_uid, gift_name: g.gift_name, to_nickname: g.to_nickname, total_diamonds: 0, count: 0, avatar_url: g.avatar_url, gift_icon: null, create_time: g.create_time || 0 };
    if (g.nickname && !g.nickname.startsWith('神秘人')) { giftDetailMap[key].nickname = g.nickname; if (g.avatar_url) giftDetailMap[key].avatar_url = g.avatar_url; }
    giftDetailMap[key].total_diamonds += g.total_diamonds || 0;
    giftDetailMap[key].count += g.repeat_count || 1;
    if ((g.create_time || 0) > giftDetailMap[key].create_time) giftDetailMap[key].create_time = g.create_time;
  }
  const details = Object.values(giftDetailMap);
  try {
    const avRows = d.prepare('SELECT DISTINCT nickname, avatar FROM gifts WHERE session_id = ? AND avatar IS NOT NULL').all(sessionId);
    const avatarMap = {}; for (const r of avRows) avatarMap[r.nickname] = r.avatar;
    for (const dt of details) { if (!dt.avatar_url) dt.avatar_url = avatarMap[dt.nickname] || null; }
  } catch (e) {}
  try {
    const iconRows = d.prepare('SELECT DISTINCT gift_name, icon FROM gifts WHERE session_id = ? AND icon IS NOT NULL').all(sessionId);
    const iconMap = {}; for (const r of iconRows) iconMap[r.gift_name] = r.icon;
    const giftIconNames = [...new Set(details.filter(dt => !iconMap[dt.gift_name]).map(dt => dt.gift_name))];
    const giftIconMap = {};
    if (giftIconNames.length) {
      for (const name of giftIconNames) {
        let gi = d.prepare('SELECT icon_url FROM gift_icons WHERE name = ?').get(name);
        if (!gi) gi = d.prepare("SELECT icon_url FROM gift_icons WHERE REPLACE(REPLACE(name,'邮轮','游轮'),'游轮','邮轮') = ? OR name LIKE ?").get(name, '%' + name.replace(/[·\\s]/g, '') + '%');
        if (gi) giftIconMap[name] = gi.icon_url;
      }
    }
    for (const dt of details) dt.gift_icon = iconMap[dt.gift_name] || giftIconMap[dt.gift_name] || null;
  } catch (e) {}
  const insGD = d.prepare('INSERT INTO session_gift_details (session_id, nickname, user_sec_uid, gift_name, to_nickname, total_diamonds, count, avatar_url, gift_icon, create_time) VALUES (?,?,?,?,?,?,?,?,?,?)');
  for (const dt of details) insGD.run(sessionId, dt.nickname, dt.user_sec_uid, dt.gift_name, dt.to_nickname, dt.total_diamonds, dt.count, dt.avatar_url, dt.gift_icon, dt.create_time);

  // 时间线
  const timeLineMap = {};
  for (const g of dedupedGifts) {
    const ts = g.create_time; if (!ts) continue;
    let timeKey;
    if (typeof ts === 'number') {
      const dd = new Date(ts > 1e12 ? ts : ts * 1000);
      timeKey = \`\${dd.getFullYear()}-\${String(dd.getMonth()+1).padStart(2,'0')}-\${String(dd.getDate()).padStart(2,'0')} \${String(dd.getHours()).padStart(2,'0')}:\${String(dd.getMinutes()).padStart(2,'0')}:00\`;
    } else { timeKey = String(ts).slice(0, 16) + ':00'; }
    if (!timeLineMap[timeKey]) timeLineMap[timeKey] = { time: timeKey, gifts: 0, diamonds: 0 };
    timeLineMap[timeKey].gifts += g.repeat_count || 1;
    timeLineMap[timeKey].diamonds += g.total_diamonds || 0;
  }
  const danmakuTimeline = d.prepare(\`SELECT strftime('%Y-%m-%d %H:%M:00', create_time, 'unixepoch', 'localtime') as time, COUNT(*) as danmaku FROM danmaku WHERE session_id = ? GROUP BY time ORDER BY time\`).all(sessionId);
  for (const t of danmakuTimeline) { if (!timeLineMap[t.time]) timeLineMap[t.time] = { time: t.time, gifts: 0, diamonds: 0 }; timeLineMap[t.time].danmaku = t.danmaku; }
  const insTL = d.prepare('INSERT INTO session_timeline (session_id, time, gifts, diamonds, danmaku) VALUES (?,?,?,?,?)');
  for (const t of Object.values(timeLineMap).sort((a, b) => (a.time || '').localeCompare(b.time || ''))) {
    insTL.run(sessionId, t.time, t.gifts, t.diamonds, t.danmaku || 0);
  }
  console.log(\`[endSession] 预聚合写入完成, session=\${sessionId}\`);
}

`;
c = c.replace('/** 更新 session 统计（增量） */', buildFn + '/** 更新 session 统计（增量） */');

fs.writeFileSync('db-sqlite.js', c);
console.log('Done');
