/**
 * 从被 WAL 掩盖的主库文件中恢复真实数据。
 *
 * 背景：db/douyin.db 主库文件内含 140,029 页真实数据，但同级 WAL 里有一条
 * 更“新”的已提交事务把库改成了 38 页空库。只要 WAL 存在，任何连接看到的都是空库；
 * 一旦 checkpoint 回写，主库真数据就被永久覆盖。
 *
 * 做法：只保留主库文件（不复制 -wal/-shm），让 SQLite 按主库头部恢复出真实数据，
 * 再 checkpoint(TRUNCATE) 落盘成一个干净的独立数据库。
 *
 * 用法: node scripts/db-recover.js
 */
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const ROOT = path.join(__dirname, '..');
const LIVE = path.join(ROOT, 'db');
const DB = path.join(LIVE, 'douyin.db');
const BK = path.join(ROOT, 'backup_db_20260911');
const STAGE = path.join(ROOT, 'db', '__recover_stage');

function log(...a) { console.log(...a); }

function counts(p) {
  const d = new Database(p, { readonly: true, fileMustExist: true });
  const tables = d.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map((r) => r.name);
  const out = {};
  for (const t of tables) {
    try { out[t] = d.prepare(`SELECT COUNT(*) c FROM "${t}"`).get().c; } catch { out[t] = -1; }
  }
  const pc = d.pragma('page_count')[0].page_count;
  d.close();
  return { counts: out, pageCount: pc, total: Object.values(out).reduce((a, b) => a + (b > 0 ? b : 0), 0) };
}

// --- 0. 前置检查 ---
if (!fs.existsSync(DB)) { console.error('找不到 db/douyin.db'); process.exit(1); }
fs.mkdirSync(BK, { recursive: true });
const bkDb = path.join(BK, 'douyin.db');
if (!fs.existsSync(bkDb)) {
  console.error('备份不存在，拒绝操作。请先备份到 backup_db_20260911/');
  process.exit(1);
}
log(`备份就绪: ${bkDb} (${(fs.statSync(bkDb).size / 1048576).toFixed(1)} MB)`);

// --- 1. 把被掩盖的原始 WAL 也留档（能解释这次事故，别丢） ---
for (const ext of ['-wal', '-shm']) {
  const src = path.join(LIVE, `douyin.db${ext}`);
  if (fs.existsSync(src)) {
    const dst = path.join(BK, `douyin.db${ext}.masked`);
    fs.copyFileSync(src, dst);
    log(`已留档被掩盖的 WAL: ${path.basename(dst)} (${fs.statSync(dst).size} bytes)`);
  }
}

// --- 2. 暂存主库（不带 WAL），让 SQLite 按主库头部恢复真实数据 ---
fs.rmSync(STAGE, { recursive: true, force: true });
fs.mkdirSync(STAGE, { recursive: true });
const stageDb = path.join(STAGE, 'douyin.db');
fs.copyFileSync(DB, stageDb);
log(`\n主库已暂存(单独文件): ${(fs.statSync(stageDb).size / 1048576).toFixed(1)} MB`);

const before = counts(stageDb);
log(`暂存库可见: page_count=${before.pageCount}, 总行数=${before.total}`);
Object.entries(before.counts).sort((a, b) => b[1] - a[1]).forEach(([k, v]) => log(`  ${k.padEnd(26)} ${v}`));

if (before.total < 1000) {
  console.error('\n暂存库仍是空库，放弃替换（避免误删数据）。');
  process.exit(1);
}

// --- 3. checkpoint 落盘，得到干净独立的数据库 ---
const d = new Database(stageDb);
d.pragma('journal_mode = WAL');
const cp = d.pragma('wal_checkpoint(TRUNCATE)');
d.pragma('journal_mode = DELETE');
d.exec('VACUUM');
d.close();
log(`\ncheckpoint: ${JSON.stringify(cp)}`);
log(`清洗后大小: ${(fs.statSync(stageDb).size / 1048576).toFixed(1)} MB`);

// --- 4. 原子替换：先把当前（空库版）整体挪走，再放入恢复库 ---
const liveBackup = path.join(BK, 'live_empty_state');
fs.mkdirSync(liveBackup, { recursive: true });
for (const ext of ['', '-wal', '-shm']) {
  const f = path.join(LIVE, `douyin.db${ext}`);
  if (fs.existsSync(f)) fs.renameSync(f, path.join(liveBackup, `douyin.db${ext}`));
}
fs.renameSync(stageDb, DB);
fs.rmSync(STAGE, { recursive: true, force: true });
log(`\n已替换 db/douyin.db；被掩盖的空库版本移到 ${path.relative(ROOT, liveBackup)}`);

// --- 5. 复核 ---
const after = counts(DB);
log(`\n恢复后: page_count=${after.pageCount}, 总行数=${after.total}, 文件 ${(fs.statSync(DB).size / 1048576).toFixed(1)} MB`);
Object.entries(after.counts).sort((a, b) => b[1] - a[1]).forEach(([k, v]) => log(`  ${k.padEnd(26)} ${v}`));
