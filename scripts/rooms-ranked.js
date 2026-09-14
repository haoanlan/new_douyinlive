/**
 * 列出数据库里的房间（按历史场次数排序），用于挑选要监控的房间。
 * 用法: node scripts/rooms-ranked.js
 */
const path = require('path');
const Database = require('better-sqlite3');

const db = new Database(path.join(__dirname, '..', 'db', 'douyin.db'), { readonly: true });
const rows = db
  .prepare(
    `SELECT st.id, st.name, st.room_id,
            (SELECT COUNT(*) FROM sessions WHERE streamer_id = st.id) AS sessions,
            (SELECT MAX(start_time) FROM sessions WHERE streamer_id = st.id) AS last_start
     FROM streamers st
     ORDER BY sessions DESC`
  )
  .all();

console.log(`共 ${rows.length} 个房间（按历史场次数排序）:\n`);
rows.forEach((r, i) => {
  console.log(
    `  ${String(i + 1).padStart(2)}. ${String(r.name).padEnd(28)} ${String(r.room_id).padEnd(14)} 场次=${String(r.sessions).padStart(3)}  最近=${r.last_start ?? '-'}`
  );
});
db.close();
