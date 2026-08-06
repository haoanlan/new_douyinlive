/**
 * douyin-live SQLite 数据库模块
 * 兼容 db-mysql.js 接口，零依赖（better-sqlite3 同步 API，包装为 async）
 */

const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const DB_PATH = process.env.DB_SQLITE_PATH || path.join(__dirname, 'db', 'douyin.db');

let db = null;

/** 获取数据库实例 */
function getDb() {
  if (!db) {
    const dir = path.dirname(DB_PATH);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    db = new Database(DB_PATH);
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    // 添加查询索引（忽略已存在的）
    const idxs = [
      'CREATE INDEX IF NOT EXISTS idx_gifts_session ON gifts(session_id)',
      'CREATE INDEX IF NOT EXISTS idx_gifts_session_time ON gifts(session_id, create_time)',
      'CREATE INDEX IF NOT EXISTS idx_gifts_session_nickname ON gifts(session_id, nickname)',
      'CREATE INDEX IF NOT EXISTS idx_gifts_to_nickname ON gifts(session_id, to_nickname)',
      'CREATE INDEX IF NOT EXISTS idx_danmaku_session ON danmaku(session_id)',
      'CREATE INDEX IF NOT EXISTS idx_danmaku_session_time ON danmaku(session_id, create_time)',
      'CREATE INDEX IF NOT EXISTS idx_members_session ON members(session_id)',
      'CREATE INDEX IF NOT EXISTS idx_sessions_streamer ON sessions(streamer_id)',
      'CREATE INDEX IF NOT EXISTS idx_gifts_user_sec_uid ON gifts(user_sec_uid)',
      'CREATE INDEX IF NOT EXISTS idx_danmaku_user_sec_uid ON danmaku(user_sec_uid)',
      'CREATE INDEX IF NOT EXISTS idx_gifts_create_time ON gifts(create_time)',
    ];
    for (const sql of idxs) { try { db.prepare(sql).run(); } catch (e) { /* ignore */ } }
  }
  return db;
}

/** 兼容 getPool().query(sql, params) 接口 */
function getPool() {
  return {
    query: async (sql, params = []) => {
      const d = getDb();
      // 判断是 SELECT 还是 INSERT/UPDATE/DELETE
      const trimmed = sql.trim().toUpperCase();
      if (trimmed.startsWith('SELECT') || trimmed.startsWith('SHOW')) {
        const rows = d.prepare(sql).all(...params);
        return [rows, []];
      } else if (trimmed.startsWith('INSERT')) {
        const info = d.prepare(sql).run(...params);
        return [{ insertId: info.lastInsertRowid, affectedRows: info.changes }, []];
      } else {
        const info = d.prepare(sql).run(...params);
        return [{ affectedRows: info.changes }, []];
      }
    },
    end: async () => {} // no-op for SQLite
  };
}

/** 初始化建表 */
async function init() {
  const d = getDb();
  const sqls = [
    `CREATE TABLE IF NOT EXISTS streamers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      room_id TEXT DEFAULT NULL,
      avatar TEXT DEFAULT NULL,
      created_at TEXT DEFAULT (datetime('now','localtime'))
    )`,

    `CREATE TABLE IF NOT EXISTS sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      streamer_id INTEGER NOT NULL,
      room_title TEXT DEFAULT NULL,
      room_id TEXT DEFAULT NULL,
      start_time TEXT DEFAULT NULL,
      end_time TEXT DEFAULT NULL,
      duration_seconds INTEGER DEFAULT 0,
      stats_danmaku INTEGER DEFAULT 0,
      stats_gift INTEGER DEFAULT 0,
      stats_like INTEGER DEFAULT 0,
      stats_member INTEGER DEFAULT 0,
      stats_follow INTEGER DEFAULT 0,
      stats_social INTEGER DEFAULT 0,
      raw_messages_count INTEGER DEFAULT 0,
      archived INTEGER DEFAULT 0,
      file_path TEXT DEFAULT NULL,
      updated_at TEXT DEFAULT (datetime('now','localtime')),
      FOREIGN KEY (streamer_id) REFERENCES streamers(id)
    )`,

    `CREATE TABLE IF NOT EXISTS danmaku (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id INTEGER NOT NULL,
      msg_id TEXT DEFAULT NULL,
      nickname TEXT DEFAULT NULL,
      avatar TEXT DEFAULT NULL,
      content TEXT DEFAULT NULL,
      user_display_id TEXT DEFAULT NULL,
      user_sec_uid TEXT DEFAULT NULL,
      create_time INTEGER DEFAULT NULL,
      FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
    )`,

    `CREATE TABLE IF NOT EXISTS gifts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id INTEGER NOT NULL,
      msg_id TEXT DEFAULT NULL,
      nickname TEXT DEFAULT NULL,
      avatar TEXT DEFAULT NULL,
      to_nickname TEXT DEFAULT NULL,
      to_avatar TEXT DEFAULT NULL,
      to_user_display_id TEXT DEFAULT NULL,
      to_user_sec_uid TEXT DEFAULT NULL,
      gift_name TEXT DEFAULT NULL,
      diamond_count INTEGER DEFAULT 0,
      repeat_count INTEGER DEFAULT 1,
      total_diamonds INTEGER DEFAULT 0,
      create_time INTEGER DEFAULT NULL,
      user_display_id TEXT DEFAULT NULL,
      user_sec_uid TEXT DEFAULT NULL,
      trace_id TEXT DEFAULT NULL,
      combo_count INTEGER DEFAULT 0,
      repeat_end INTEGER DEFAULT NULL,
      group_count INTEGER DEFAULT 1,
      send_type INTEGER DEFAULT NULL,
      FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
    )`,

    `CREATE TABLE IF NOT EXISTS members (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id INTEGER NOT NULL,
      msg_id TEXT DEFAULT NULL,
      nickname TEXT DEFAULT NULL,
      avatar TEXT DEFAULT NULL,
      user_display_id TEXT DEFAULT NULL,
      user_sec_uid TEXT DEFAULT NULL,
      create_time INTEGER DEFAULT NULL,
      FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
    )`,

    `CREATE TABLE IF NOT EXISTS online_records (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id INTEGER NOT NULL,
      count INTEGER NOT NULL DEFAULT 0,
      recorded_at INTEGER DEFAULT NULL,
      FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
    )`,

    `CREATE INDEX IF NOT EXISTS idx_danmaku_session ON danmaku(session_id)`,
    `CREATE INDEX IF NOT EXISTS idx_danmaku_user ON danmaku(nickname)`,
    `CREATE INDEX IF NOT EXISTS idx_gifts_session ON gifts(session_id)`,
    `CREATE INDEX IF NOT EXISTS idx_gifts_user ON gifts(nickname)`,
    `CREATE INDEX IF NOT EXISTS idx_gifts_session_trace ON gifts(session_id, trace_id)`,
    `CREATE INDEX IF NOT EXISTS idx_members_session ON members(session_id)`,
    `CREATE INDEX IF NOT EXISTS idx_online_session_time ON online_records(session_id, recorded_at)`,
    `CREATE INDEX IF NOT EXISTS idx_gifts_user_sec_uid ON gifts(user_sec_uid)`,
    `CREATE INDEX IF NOT EXISTS idx_danmaku_user_sec_uid ON danmaku(user_sec_uid)`,
    `CREATE INDEX IF NOT EXISTS idx_gifts_create_time ON gifts(create_time)`,
    `CREATE TABLE IF NOT EXISTS session_gift_ranking (
      session_id INTEGER NOT NULL, rank INTEGER NOT NULL,
      nickname TEXT, avatar_url TEXT, user_sec_uid TEXT,
      total_diamonds INTEGER DEFAULT 0, gift_count INTEGER DEFAULT 0,
      PRIMARY KEY (session_id, rank), FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
    )`,
    `CREATE TABLE IF NOT EXISTS session_anchor_ranking (
      session_id INTEGER NOT NULL, anchor_sec_uid TEXT NOT NULL,
      anchor_name TEXT, anchor_avatar TEXT,
      total_diamonds INTEGER DEFAULT 0, gift_count INTEGER DEFAULT 0, user_count INTEGER DEFAULT 0,
      PRIMARY KEY (session_id, anchor_sec_uid), FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
    )`,
    `CREATE TABLE IF NOT EXISTS session_danmaku_ranking (
      session_id INTEGER NOT NULL, rank INTEGER NOT NULL,
      nickname TEXT, avatar TEXT, user_sec_uid TEXT, msg_count INTEGER DEFAULT 0,
      PRIMARY KEY (session_id, rank), FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
    )`,
    `CREATE TABLE IF NOT EXISTS session_gift_details (
      session_id INTEGER NOT NULL, id INTEGER PRIMARY KEY AUTOINCREMENT,
      nickname TEXT, user_sec_uid TEXT, gift_name TEXT, to_nickname TEXT,
      total_diamonds INTEGER DEFAULT 0, count INTEGER DEFAULT 0,
      avatar_url TEXT, gift_icon TEXT, create_time INTEGER DEFAULT 0,
      FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
    )`,
    `CREATE INDEX IF NOT EXISTS idx_session_gift_details_sid ON session_gift_details(session_id)`,
    `CREATE TABLE IF NOT EXISTS session_timeline (
      session_id INTEGER NOT NULL, time TEXT NOT NULL,
      gifts INTEGER DEFAULT 0, diamonds INTEGER DEFAULT 0, danmaku INTEGER DEFAULT 0,
      PRIMARY KEY (session_id, time), FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
    )`
  ];

  for (const sql of sqls) {
    d.exec(sql);
  }
  // 添加 agg 聚合字段（兼容旧库）
  const aggCols = ['agg_gifts', 'agg_diamonds', 'agg_danmaku', 'agg_users'];
  for (const col of aggCols) {
    try { d.exec(`ALTER TABLE sessions ADD COLUMN ${col} INTEGER DEFAULT NULL`); } catch (e) { /* 已存在 */ }
  }
  console.log('[db] SQLite 表结构初始化完成');
  // 回填已结束场次的聚合数据
  try {
    const { comboDedupGifts } = require('./lib/gift-utils.js');
    const pending = d.prepare("SELECT id FROM sessions WHERE end_time IS NOT NULL AND (agg_gifts IS NULL OR agg_gifts = 0)").all();
    if (pending.length > 0) {
      console.log(`[db] 回填 ${pending.length} 个场次的聚合数据...`);
      for (const { id: sid } of pending) {
        const rawGifts = d.prepare('SELECT * FROM gifts WHERE session_id = ? ORDER BY id').all(sid);
        const deduped = comboDedupGifts(rawGifts);
        const agg_gifts = deduped.reduce((s, g) => s + (g.repeat_count || 1), 0);
        const agg_diamonds = deduped.reduce((s, g) => s + (g.total_diamonds || 0), 0);
        const dmRow = d.prepare('SELECT COUNT(*) as cnt FROM danmaku WHERE session_id = ?').get(sid);
        const giftUsers = deduped.map(g => g.user_sec_uid).filter(Boolean);
        const danmakuUsers = d.prepare('SELECT DISTINCT user_sec_uid FROM danmaku WHERE session_id = ? AND user_sec_uid IS NOT NULL').all(sid).map(r => r.user_sec_uid);
        const agg_users = new Set([...giftUsers, ...danmakuUsers]).size;
        d.prepare('UPDATE sessions SET agg_gifts=?, agg_diamonds=?, agg_danmaku=?, agg_users=? WHERE id=?')
          .run(agg_gifts, agg_diamonds, dmRow.cnt, agg_users, sid);
      }
      console.log(`[db] 聚合数据回填完成`);
    }
  } catch (e) {
    console.error('[db] 回填聚合数据失败:', e.message);
  }
}

/** 获取/创建主播 */
async function upsertStreamer(name, roomId, avatar, secUid) {
  const d = getDb();
  // 先按 roomId 查
  if (roomId) {
    const row = d.prepare('SELECT id FROM streamers WHERE room_id = ?').get(roomId);
    if (row) {
      if (name || avatar || secUid) {
        d.prepare('UPDATE streamers SET name = COALESCE(?, name), avatar = COALESCE(?, avatar), sec_uid = COALESCE(?, sec_uid) WHERE id = ?')
          .run(name || null, avatar || null, secUid || null, row.id);
      }
      return row.id;
    }
  }
  // 次按 name 查
  if (name) {
    const row = d.prepare('SELECT id FROM streamers WHERE name = ?').get(name);
    if (row) {
      if (roomId || avatar || secUid) {
        d.prepare('UPDATE streamers SET room_id = COALESCE(?, room_id), avatar = COALESCE(?, avatar), sec_uid = COALESCE(?, sec_uid) WHERE id = ?')
          .run(roomId || null, avatar || null, secUid || null, row.id);
      }
      return row.id;
    }
  }
  // 新建
  const info = d.prepare('INSERT INTO streamers (name, room_id, avatar, sec_uid) VALUES (?, ?, ?, ?)')
    .run(name || roomId || '未知主播', roomId || null, avatar || null, secUid || null);
  return info.lastInsertRowid;
}

/** 创建新 session */
async function createSession(streamerId, roomTitle, roomId) {
  const d = getDb();
  const info = d.prepare(
    'INSERT INTO sessions (streamer_id, room_title, room_id, start_time) VALUES (?, ?, ?, datetime(\'now\',\'localtime\'))'
  ).run(streamerId, roomTitle || null, roomId || null);
  return info.lastInsertRowid;
}

/** 获取当前直播 session */
async function getCurrentSession() {
  const d = getDb();
  return d.prepare('SELECT * FROM sessions WHERE end_time IS NULL ORDER BY start_time DESC LIMIT 1').get() || null;
}

/** 结束 session */
async function endSession(sessionId, durationSeconds, filePath) {
  const d = getDb();
  d.prepare(
    'UPDATE sessions SET end_time = datetime(\'now\',\'localtime\'), duration_seconds = ?, file_path = ?, archived = 1 WHERE id = ?'
  ).run(durationSeconds || 0, filePath || null, sessionId);
  // 场次结束时计算并存储聚合数据
  try {
    const { comboDedupGifts } = require('./lib/gift-utils.js');
    const rawGifts = d.prepare('SELECT * FROM gifts WHERE session_id = ? ORDER BY id').all(sessionId);
    const deduped = comboDedupGifts(rawGifts);
    const agg_gifts = deduped.reduce((s, g) => s + (g.repeat_count || 1), 0);
    const agg_diamonds = deduped.reduce((s, g) => s + (g.total_diamonds || 0), 0);
    const dmRow = d.prepare('SELECT COUNT(*) as cnt FROM danmaku WHERE session_id = ?').get(sessionId);
    const giftUsers = deduped.map(g => g.user_sec_uid).filter(Boolean);
    const danmakuUsers = d.prepare('SELECT DISTINCT user_sec_uid FROM danmaku WHERE session_id = ? AND user_sec_uid IS NOT NULL').all(sessionId).map(r => r.user_sec_uid);
    const agg_users = new Set([...giftUsers, ...danmakuUsers]).size;
    d.prepare('UPDATE sessions SET agg_gifts=?, agg_diamonds=?, agg_danmaku=?, agg_users=? WHERE id=?')
      .run(agg_gifts, agg_diamonds, dmRow.cnt, agg_users, sessionId);
    // 写入预聚合表
    buildPrecomputed(d, sessionId, deduped);
  } catch (e) {
    console.error(`[endSession] 聚合计算失败:`, e.message);
  }
}


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
    const key = (g.user_sec_uid || g.nickname) + '\x00' + (g.gift_name || '') + '\x00' + (g.to_nickname || '');
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
        if (!gi) gi = d.prepare("SELECT icon_url FROM gift_icons WHERE REPLACE(REPLACE(name,'邮轮','游轮'),'游轮','邮轮') = ? OR name LIKE ?").get(name, '%' + name.replace(/[·\s]/g, '') + '%');
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
      timeKey = `${dd.getFullYear()}-${String(dd.getMonth()+1).padStart(2,'0')}-${String(dd.getDate()).padStart(2,'0')} ${String(dd.getHours()).padStart(2,'0')}:${String(dd.getMinutes()).padStart(2,'0')}:00`;
    } else { timeKey = String(ts).slice(0, 16) + ':00'; }
    if (!timeLineMap[timeKey]) timeLineMap[timeKey] = { time: timeKey, gifts: 0, diamonds: 0 };
    timeLineMap[timeKey].gifts += g.repeat_count || 1;
    timeLineMap[timeKey].diamonds += g.total_diamonds || 0;
  }
  const danmakuTimeline = d.prepare(`SELECT strftime('%Y-%m-%d %H:%M:00', create_time, 'unixepoch', 'localtime') as time, COUNT(*) as danmaku FROM danmaku WHERE session_id = ? GROUP BY time ORDER BY time`).all(sessionId);
  for (const t of danmakuTimeline) { if (!timeLineMap[t.time]) timeLineMap[t.time] = { time: t.time, gifts: 0, diamonds: 0 }; timeLineMap[t.time].danmaku = t.danmaku; }
  const insTL = d.prepare('INSERT INTO session_timeline (session_id, time, gifts, diamonds, danmaku) VALUES (?,?,?,?,?)');
  for (const t of Object.values(timeLineMap).sort((a, b) => (a.time || '').localeCompare(b.time || ''))) {
    insTL.run(sessionId, t.time, t.gifts, t.diamonds, t.danmaku || 0);
  }
  console.log(`[endSession] 预聚合写入完成, session=${sessionId}`);
}

/** 更新 session 统计（增量） */
async function updateSessionStats(sessionId, stats) {
  if (!stats) return;
  const d = getDb();
  const sets = [];
  const vals = [];
  for (const [k, v] of Object.entries(stats)) {
    if (['danmaku', 'gift', 'like', 'member', 'follow', 'social'].includes(k) && v != null) {
      sets.push(`stats_${k} = COALESCE(stats_${k}, 0) + ?`);
      vals.push(v);
    }
  }
  if (sets.length === 0) return;
  vals.push(sessionId);
  d.prepare(`UPDATE sessions SET ${sets.join(', ')}, updated_at = datetime('now','localtime') WHERE id = ?`).run(...vals);
}

/** 批量写入弹幕 */
async function insertDanmaku(sessionId, items) {
  if (!items || items.length === 0) return;
  const d = getDb();
  const stmt = d.prepare(
    'INSERT INTO danmaku (session_id, msg_id, nickname, avatar, content, user_display_id, user_sec_uid, create_time) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
  );
  const tx = d.transaction((rows) => {
    for (const item of rows) {
      stmt.run(sessionId, item.msgId || null, item.nickname || null, item.avatar || null,
        item.content || null, item.userDisplayId || null, item.userSecUid || null,
        item.createTime || null);
    }
  });
  tx(items);
}

/** 批量写入礼物 */
async function insertGifts(sessionId, items) {
  if (!items || items.length === 0) return;
  const d = getDb();
  // 确保 icon 列存在
  try { d.exec('ALTER TABLE gifts ADD COLUMN icon TEXT'); } catch(e) {}
  const iconStmt = d.prepare('SELECT icon_url FROM gift_icons WHERE name = ?');
  const iconFuzzyStmt = d.prepare('SELECT icon_url FROM gift_icons WHERE REPLACE(REPLACE(name,\'邮轮\',\'游轮\'),\'游轮\',\'邮轮\') = ? OR name LIKE ?');
  const iconCheck = d.prepare('SELECT 1 FROM gift_icons WHERE name = ?');
  const iconUpsert = d.prepare('INSERT OR IGNORE INTO gift_icons (gift_id, name, icon_url, diamond_count) VALUES (?, ?, ?, ?)');
  const stmt = d.prepare(
    'INSERT INTO gifts (session_id, msg_id, nickname, avatar, to_nickname, to_avatar, to_user_display_id, to_user_sec_uid, gift_name, diamond_count, repeat_count, total_diamonds, user_display_id, user_sec_uid, create_time, trace_id, combo_count, repeat_end, group_count, send_type, icon) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
  );
  const tx = d.transaction((rows) => {
    for (const item of rows) {
      const icon = item.icon || iconStmt.get(item.giftName || '')?.icon_url || iconFuzzyStmt.get(item.giftName || '', '%' + (item.giftName || '').replace(/[·\s]/g, '') + '%')?.icon_url || null;
      // 如果有 icon 但 gift_icons 表没有，自动补充（积累融合礼物 icon 库）
      if (icon && item.giftName && !iconCheck.get(item.giftName)) {
        iconUpsert.run(-(Math.abs(item.giftName.length) + 10000), item.giftName, icon, item.diamondCount || 0);
      }
      stmt.run(sessionId, item.msgId || null, item.nickname || null, item.avatar || null,
        item.toNickname || null, item.toAvatar || null, item.toUserDisplayId || null, item.toUserSecUid || null,
        item.giftName || null, item.diamondCount || 0, item.repeatCount || 1,
        item.totalDiamonds || 0, item.userDisplayId || null, item.userSecUid || null,
        item.createTime || null, item.traceId || null, item.comboCount || 0, item.repeatEnd ?? null,
        item.groupCount || 1, item.sendType || null, icon);
    }
  });
  tx(items);
}

/** 批量写入进场 */
async function insertMembers(sessionId, items) {
  if (!items || items.length === 0) return;
  const d = getDb();
  const stmt = d.prepare(
    'INSERT INTO members (session_id, msg_id, nickname, avatar, user_display_id, user_sec_uid, create_time) VALUES (?, ?, ?, ?, ?, ?, ?)'
  );
  const tx = d.transaction((rows) => {
    for (const item of rows) {
      stmt.run(sessionId, item.msgId || null, item.nickname || null, item.avatar || null,
        item.userDisplayId || null, item.userSecUid || null,
        item.createTime || null);
    }
  });
  tx(items);
}

/** 礼物排行 */
async function getGiftRanking(sessionId, limit = 100) {
  const d = getDb();
  const rows = d.prepare(`
    SELECT nickname, MAX(avatar) as avatar,
      SUM(total_diamonds) as total_diamonds,
      SUM(CASE WHEN rn=1 THEN 1 ELSE 0 END) as gift_count,
      gift_name,
      SUM(CASE WHEN rn=1 THEN total_diamonds ELSE 0 END) as td,
      SUM(CASE WHEN rn=1 THEN 1 ELSE 0 END) as cnt
    FROM (
      SELECT *, ROW_NUMBER() OVER (
        PARTITION BY COALESCE(trace_id, '__no_trace_' || id)
        ORDER BY repeat_end DESC
      ) AS rn
      FROM gifts WHERE session_id = ?
    ) deduped
    WHERE rn = 1
    GROUP BY nickname, gift_name
    ORDER BY total_diamonds DESC
    LIMIT ?
  `).all(sessionId, limit);

  // 按用户聚合
  const userMap = {};
  for (const r of rows) {
    if (!userMap[r.nickname]) {
      userMap[r.nickname] = { nickname: r.nickname, avatar: r.avatar, total_diamonds: 0, gift_count: 0, gifts: [] };
    }
    userMap[r.nickname].total_diamonds += r.total_diamonds;
    userMap[r.nickname].gift_count += r.cnt;
    userMap[r.nickname].gifts.push({ name: r.gift_name, count: r.cnt, diamonds: r.td });
  }
  return Object.values(userMap).sort((a, b) => b.total_diamonds - a.total_diamonds).slice(0, limit);
}

/** 弹幕查询 */
async function getDanmaku(sessionId, { user = '', page = 1, limit = 100 } = {}) {
  const d = getDb();
  let where = 'WHERE session_id = ?';
  const params = [sessionId];
  if (user) {
    where += ' AND nickname LIKE ?';
    params.push(`%${user}%`);
  }
  const { cnt } = d.prepare(`SELECT COUNT(*) as cnt FROM danmaku ${where}`).get(...params);
  const offset = (page - 1) * limit;
  const items = d.prepare(`SELECT * FROM danmaku ${where} ORDER BY id DESC LIMIT ? OFFSET ?`)
    .all(...params, limit, offset);
  return { items, total: cnt, page, limit };
}

/** 词云 */
async function getWordCloud(sessionId, limit = 100) {
  const d = getDb();
  return d.prepare(`
    SELECT content as text, COUNT(*) as count
    FROM danmaku
    WHERE session_id = ? AND content IS NOT NULL AND content != ''
    GROUP BY content
    ORDER BY count DESC
    LIMIT ?
  `).all(sessionId, limit);
}

/** 团员排名 */
async function getMemberRanking(sessionId, page = 1, limit = 100) {
  const d = getDb();
  const offset = (page - 1) * limit;
  const { cnt } = d.prepare(`
    SELECT COUNT(DISTINCT nickname) as cnt FROM (
      SELECT nickname FROM gifts WHERE session_id = ?
      UNION
      SELECT nickname FROM danmaku WHERE session_id = ?
    ) t
  `).get(sessionId, sessionId);

  const items = d.prepare(`
    SELECT nicks.nickname,
      COALESCE(gf.total_diamonds, 0) as total_diamonds,
      COALESCE(dm.danmaku_count, 0) as danmaku_count,
      COALESCE(gf.avatar, dm.avatar) as avatar
    FROM (
      SELECT nickname FROM gifts WHERE session_id = ?
      UNION
      SELECT nickname FROM danmaku WHERE session_id = ?
    ) nicks
    LEFT JOIN (
      SELECT nickname, avatar, SUM(total_diamonds) as total_diamonds
      FROM (
        SELECT nickname, avatar, gift_name,
          SUM(total_diamonds) as total_diamonds,
          ROW_NUMBER() OVER (
            PARTITION BY COALESCE(trace_id, '__no_trace_' || id)
            ORDER BY repeat_end DESC
          ) AS rn
        FROM gifts WHERE session_id = ?
      ) deduped WHERE rn = 1
      GROUP BY nickname, avatar
    ) gf ON nicks.nickname = gf.nickname
    LEFT JOIN (
      SELECT nickname, MAX(avatar) as avatar, COUNT(*) as danmaku_count FROM danmaku WHERE session_id = ? GROUP BY nickname
    ) dm ON nicks.nickname = dm.nickname
    ORDER BY total_diamonds DESC, danmaku_count DESC
    LIMIT ? OFFSET ?
  `).all(sessionId, sessionId, sessionId, sessionId, limit, offset);

  return { items, total: cnt, page, limit };
}

/** 主播列表 */
async function getStreamers() {
  const d = getDb();
  const rows = d.prepare(`
    SELECT s.*,
      (SELECT room_title FROM sessions WHERE streamer_id = s.id AND end_time IS NULL ORDER BY start_time DESC LIMIT 1) as live_title,
      EXISTS(SELECT 1 FROM sessions WHERE streamer_id = s.id AND end_time IS NULL) as live
    FROM streamers s ORDER BY s.name
  `).all();
  return rows.map(r => ({ ...r, live: !!r.live }));
}

/** 主播场次列表 */
async function getSessions(streamerId) {
  const d = getDb();
  return d.prepare('SELECT * FROM sessions WHERE streamer_id = ? ORDER BY start_time DESC').all(streamerId);
}

/** 单场详情 */
async function getSession(sessionId) {
  const d = getDb();
  return d.prepare('SELECT * FROM sessions WHERE id = ?').get(sessionId) || null;
}

async function updateStreamerName(sessionId, name, avatar) {
  const d = getDb();
  const sess = d.prepare('SELECT streamer_id FROM sessions WHERE id = ?').get(sessionId);
  if (!sess) return;
  const sid = sess.streamer_id;
  if (!name) {
    d.prepare('UPDATE streamers SET avatar = COALESCE(?, avatar) WHERE id = ?').run(avatar || null, sid);
    return;
  }
  const existing = d.prepare('SELECT id FROM streamers WHERE name = ? AND id != ?').get(name, sid);
  if (existing) {
    d.prepare('UPDATE sessions SET streamer_id = ? WHERE streamer_id = ?').run(existing.id, sid);
    d.prepare('DELETE FROM streamers WHERE id = ?').run(sid);
    console.log('[db] 主播合并:', name, '#' + existing.id, '(原 #' + sid + ')');
  } else {
    d.prepare('UPDATE streamers SET name = ?, avatar = COALESCE(?, avatar) WHERE id = ?').run(name, avatar || null, sid);
  }
}

async function updateStreamerAvatar(sessionId, avatar) {
  const d = getDb();
  const sess = d.prepare('SELECT streamer_id FROM sessions WHERE id = ?').get(sessionId);
  if (!sess) return;
  d.prepare('UPDATE streamers SET avatar = ? WHERE id = ?').run(avatar, sess.streamer_id);
}

/** 关闭数据库 */
async function close() {
  if (db) {
    db.close();
    db = null;
  }
}

module.exports = {
  init, getPool, getDb,
  upsertStreamer, createSession, getCurrentSession, endSession, updateSessionStats,
  insertDanmaku, insertGifts, insertMembers,
  getGiftRanking, getDanmaku, getWordCloud, getMemberRanking,
  getStreamers, getSessions, getSession, close,
  updateStreamerName, updateStreamerAvatar
};
