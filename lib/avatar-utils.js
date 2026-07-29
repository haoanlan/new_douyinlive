/**
 * 头像查询工具 — 从 gifts/danmaku/members 表 fallback 查找用户头像
 * 消除 web-dashboard.js 中重复的头像查询逻辑
 */

/**
 * 按 sec_uid 查找头像，依次从 gifts → danmaku → members 表 fallback
 * @param {object} dbInstance - better-sqlite3 Database 实例
 * @param {number|null} sessionId - 场次 ID（members 表查询不需要）
 * @param {string} secUid - 用户 sec_uid
 * @returns {string|null} 头像 URL 或 null
 */
function getAvatarBySecUid(dbInstance, sessionId, secUid) {
  if (!secUid) return null;
  if (sessionId != null) {
    const g = dbInstance
      .prepare('SELECT avatar FROM gifts WHERE session_id = ? AND user_sec_uid = ? AND avatar IS NOT NULL LIMIT 1')
      .get(sessionId, secUid);
    if (g && g.avatar) return g.avatar;

    const d = dbInstance
      .prepare('SELECT avatar FROM danmaku WHERE session_id = ? AND user_sec_uid = ? AND avatar IS NOT NULL LIMIT 1')
      .get(sessionId, secUid);
    if (d && d.avatar) return d.avatar;
  }
  const m = dbInstance
    .prepare('SELECT avatar FROM members WHERE user_sec_uid = ? AND avatar IS NOT NULL LIMIT 1')
    .get(secUid);
  return (m && m.avatar) || null;
}

/**
 * 按 nickname + sessionId 从 gifts 表查找头像
 * @param {object} dbInstance - better-sqlite3 Database 实例
 * @param {number} sessionId - 场次 ID
 * @param {string} nickname - 用户昵称
 * @returns {string|null} 头像 URL 或 null
 */
function getAvatarByNickname(dbInstance, sessionId, nickname) {
  if (!nickname) return null;
  const r = dbInstance
    .prepare('SELECT avatar FROM gifts WHERE session_id = ? AND nickname = ? AND avatar IS NOT NULL LIMIT 1')
    .get(sessionId, nickname);
  return (r && r.avatar) || null;
}

module.exports = { getAvatarBySecUid, getAvatarByNickname };
