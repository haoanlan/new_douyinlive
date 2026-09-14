/**
 * 审计 sessions.start_time 的格式，找出会让前端显示 "Invalid Date" 的记录。
 * 正常格式示例：2026-08-31 22:38:26
 * 用法: node scripts/audit-session-times.js
 */
const path = require('path');
const Database = require('better-sqlite3');

const db = new Database(path.join(__dirname, '..', 'db', 'douyin.db'), { readonly: true });
const NORMAL = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/;

const rows = db.prepare('SELECT id, streamer_id, start_time, end_time FROM sessions ORDER BY id').all();
const bad = rows.filter((r) => !NORMAL.test(String(r.start_time || '')));
console.log(`总场次 ${rows.length}，格式异常 ${bad.length}`);
bad.forEach((r) => console.log(`  id=${r.id} streamer=${r.streamer_id} start_time=${JSON.stringify(r.start_time)} end_time=${JSON.stringify(r.end_time)}`));

// 这些格式到底能不能被 Date 解析
const samples = [...new Set(bad.map((r) => String(r.start_time)))].slice(0, 5);
console.log('\n前端解析结果:');
samples.forEach((s) => {
  const d = new Date(s);
  console.log(`  ${JSON.stringify(s)} -> ${isNaN(d.getTime()) ? 'Invalid Date' : d.toLocaleString('zh-CN')}`);
});

db.close();
