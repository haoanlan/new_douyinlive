/**
 * 数据库体检 / WAL 收尾（重启或换库前先跑这个）
 *
 *   node scripts/db-checkpoint.js
 *
 * 背景（踩过的坑）：
 *   - WAL 模式下，写入先落在 douyin.db-wal。若只替换 douyin.db 而留下旧的
 *     -wal / -shm，SQLite 会拿旧日志去套新库 → "database disk image is malformed"。
 *   - 因此：换库时要连 -wal / -shm 一起处理；重启服务前最好先 checkpoint。
 *
 * 本脚本做三件事（都不改业务数据）：
 *   1. wal_checkpoint(TRUNCATE) —— 把 WAL 干净地并回主库并截断
 *   2. integrity_check         —— 校验库结构
 *   3. 打印各表行数             —— 确认数据规模对得上
 *
 * 建议在**服务已停止**时运行；服务在跑时也能跑，但 busy 可能非 0。
 */
const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

const dbPath = path.join(__dirname, '..', 'db', 'douyin.db');
if (!fs.existsSync(dbPath)) {
  console.error('找不到数据库:', dbPath);
  process.exit(1);
}

const db = new Database(dbPath);
db.pragma('busy_timeout = 15000');

const cp = db.pragma('wal_checkpoint(TRUNCATE)');
console.log('wal_checkpoint(TRUNCATE):', JSON.stringify(cp), cp[0]?.busy ? '⚠️ busy!=0（有其它连接在写）' : 'ok');

const ic = db.pragma('integrity_check(20)');
const bad = ic.filter((r) => r.integrity_check !== 'ok');
console.log('integrity_check:', bad.length ? `${bad.length} 条问题` : 'ok');
for (const b of bad.slice(0, 5)) console.log('   ', b.integrity_check);

if (!bad.length) {
  for (const t of ['sessions', 'gifts', 'danmaku', 'members', 'streamers']) {
    try {
      console.log(`  ${t}: ${db.prepare(`SELECT COUNT(1) AS c FROM ${t}`).get().c}`);
    } catch (e) {
      console.log(`  ${t}: 读取失败 ${e.message}`);
    }
  }
}

for (const f of ['douyin.db', 'douyin.db-wal', 'douyin.db-shm']) {
  const p = path.join(__dirname, '..', 'db', f);
  if (fs.existsSync(p)) {
    console.log(`  ${f}: ${(fs.statSync(p).size / 1048576).toFixed(1)} MB`);
  } else {
    console.log(`  ${f}: (不存在)`);
  }
}

db.close();
