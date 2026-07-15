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
    `CREATE INDEX IF NOT EXISTS idx_online_session_time ON online_records(session_id, recorded_at)`
  ];

  for (const sql of sqls) {
    d.exec(sql);
  }
  console.log('[db] SQLite 表结构初始化完成');
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
  const sessionId = info.lastInsertRowid;
  // 写入"场次 #id"格式
  const formatted = `场次 #${sessionId}`;
  d.prepare('UPDATE sessions SET room_title = ? WHERE id = ?').run(formatted, sessionId);
  return sessionId;
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
