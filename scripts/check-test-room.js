/**
 * 检查测试遗留数据：room_id = 48465460802 的房间与场次。
 * 用法: node scripts/check-test-room.js
 */
const path = require('path');
const Database = require('better-sqlite3');

const db = new Database(path.join(__dirname, '..', 'db', 'douyin.db'), { readonly: true });
const ROOM = '48465460802';

const st = db.prepare('SELECT id, name, room_id FROM streamers WHERE room_id = ?').all(ROOM);
console.log('streamers:', JSON.stringify(st));

for (const s of st) {
  const sessions = db.prepare(
    'SELECT id, room_title, start_time, end_time, agg_gifts, agg_diamonds FROM sessions WHERE streamer_id = ?'
  ).all(s.id);
  console.log(`streamer ${s.id} 的场次 (${sessions.length}):`);
  sessions.forEach((x) => console.log('  ', JSON.stringify(x)));
}

console.log('\n最近 8 条场次（全库）:');
db.prepare('SELECT id, streamer_id, room_id, start_time, end_time FROM sessions ORDER BY id DESC LIMIT 8')
  .all()
  .forEach((x) => console.log('  ', JSON.stringify(x)));

db.close();
