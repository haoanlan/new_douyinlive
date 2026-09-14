/**
 * 恢复后核对：schema / 账号 / 数据抽样。
 * 用法: node scripts/db-verify.js
 */
const path = require('path');
const Database = require('better-sqlite3');

const dbPath = process.argv[2] || path.join(__dirname, '..', 'db', 'douyin.db');
const d = new Database(dbPath);

const cols = d.prepare('PRAGMA table_info(sessions)').all().map((c) => c.name);
console.log('sessions 列:', cols.join(','));
console.log('online_peak 是否在 schema:', cols.includes('online_peak'));
if (!cols.includes('online_peak')) {
  d.exec('ALTER TABLE sessions ADD COLUMN online_peak INTEGER DEFAULT 0');
  console.log('-> 已补列 online_peak');
}

const users = d.prepare('SELECT id, username, role, enabled FROM dashboard_users').all();
console.log(`\ndashboard_users (${users.length}):`, JSON.stringify(users));

const s = d.prepare('SELECT COUNT(*) c, MIN(start_time) mn, MAX(start_time) mx FROM sessions').get();
console.log('\nsessions:', JSON.stringify(s));

const st = d.prepare('SELECT id, name, room_id FROM streamers').all();
console.log(`\nstreamers (${st.length}):`, JSON.stringify(st, null, 1));

const dm = d.prepare('SELECT nickname, content, create_time FROM danmaku ORDER BY id DESC LIMIT 3').all();
console.log('\n弹幕样本:', JSON.stringify(dm, null, 1));

const g = d.prepare('SELECT nickname, gift_name, repeat_count, total_diamonds FROM gifts ORDER BY id DESC LIMIT 3').all();
console.log('\n礼物样本:', JSON.stringify(g, null, 1));

const top = d.prepare(
  "SELECT gift_name, COUNT(*) c, SUM(total_diamonds) diamonds FROM gifts GROUP BY gift_name ORDER BY diamonds DESC LIMIT 5"
).all();
console.log('\n礼物 Top5:', JSON.stringify(top));

d.close();
