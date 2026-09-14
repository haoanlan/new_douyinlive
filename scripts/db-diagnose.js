/**
 * 诊断：对比 SQLite 主库文件与 WAL 的可见状态，定位“大文件但 0 行”的原因。
 * 用法: node scripts/db-diagnose.js <db文件路径>
 */
const fs = require('fs');
const Database = require('better-sqlite3');

const dbPath = process.argv[2];
if (!dbPath || !fs.existsSync(dbPath)) {
  console.error('用法: node scripts/db-diagnose.js <db文件路径>');
  process.exit(1);
}

function headerInfo(p) {
  const fd = fs.openSync(p, 'r');
  const buf = Buffer.alloc(32);
  fs.readSync(fd, buf, 0, 32, 0);
  fs.closeSync(fd);
  const pageSize = buf.readUInt16BE(16);
  const pageCount = buf.readUInt32BE(28);
  const writeVer = buf[18];
  const readVer = buf[19];
  return { magic: buf.slice(0, 15).toString('ascii'), pageSize, pageCount, writeVer, readVer };
}

function walInfo(p) {
  if (!fs.existsSync(p)) return null;
  const fd = fs.openSync(p, 'r');
  const buf = Buffer.alloc(32);
  fs.readSync(fd, buf, 0, 32, 0);
  fs.closeSync(fd);
  return {
    size: fs.statSync(p).size,
    magic: buf.readUInt32BE(0).toString(16),
    version: buf.readUInt32BE(4),
    pageSize: buf.readUInt32BE(8),
    checkpointSeq: buf.readUInt32BE(12),
    salt1: buf.readUInt32BE(16),
    salt2: buf.readUInt32BE(20),
    checksum: `${buf.readUInt32BE(24).toString(16)}:${buf.readUInt32BE(28).toString(16)}`
  };
}

function report(label, opts) {
  const d = new Database(dbPath, { readonly: true, fileMustExist: true, ...opts });
  const pageCount = d.pragma('page_count')[0].page_count;
  const pageSize = d.pragma('page_size')[0].page_size;
  const freelist = d.pragma('freelist_count')[0].freelist_count;
  let tables = [];
  try {
    tables = d.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map((r) => r.name);
  } catch (e) {
    console.log(`${label}: 读取 schema 失败 ${e.message}`);
    d.close();
    return;
  }
  const counts = {};
  for (const t of tables) {
    try { counts[t] = d.prepare(`SELECT COUNT(*) c FROM "${t}"`).get().c; } catch { counts[t] = -1; }
  }
  const total = Object.values(counts).reduce((a, b) => a + (b > 0 ? b : 0), 0);
  console.log(`\n[${label}]`);
  console.log(`  引擎可见: page_count=${pageCount} page_size=${pageSize} => ${(pageCount * pageSize / 1048576).toFixed(2)} MB, freelist=${freelist}`);
  console.log(`  表数量: ${tables.length}, 全部行数合计: ${total}`);
  const top = Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 8);
  console.log(`  行数明细: ${top.map(([k, v]) => `${k}=${v}`).join(', ')}`);
  d.close();
}

const st = fs.statSync(dbPath);
console.log(`主库文件: ${dbPath}`);
console.log(`  磁盘大小: ${(st.size / 1048576).toFixed(2)} MB, 修改时间: ${st.mtime.toISOString()}`);
console.log(`  头部: ${JSON.stringify(headerInfo(dbPath))}`);
console.log(`  头部声明的库大小: ${(headerInfo(dbPath).pageCount * headerInfo(dbPath).pageSize / 1048576).toFixed(2)} MB`);
const w = walInfo(`${dbPath}-wal`);
console.log(`WAL: ${w ? JSON.stringify(w) : '不存在'}`);

try {
  report('默认打开（含 WAL 回放）', {});
} catch (e) {
  console.log(`默认打开失败: ${e.message}`);
}

// 只读 + immutable：完全忽略 WAL，看主库自身内容
try {
  const d = new Database(dbPath, { readonly: true, fileMustExist: true });
  d.pragma('wal_checkpoint(TRUNCATE)');
  d.close();
} catch { /* 只读连接无法 checkpoint，忽略 */ }

console.log('\n提示: 若上表为 0 行而文件很大，说明主库数据被一次更"新"的事务覆盖（WAL 或残留 journal），需要从备份恢复。');
