/**
 * 数据库概览：表行数 + 时间范围 + online_peak 列状态。
 * 用法: node scripts/db-overview.js [db路径]
 */
const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

const dbPath = process.argv[2] || path.join(__dirname, '..', 'db', 'douyin.db');

function fmt(n) {
  return typeof n === 'number' ? n.toLocaleString('en-US') : n;
}

function main() {
  if (!fs.existsSync(dbPath)) {
    console.log(`数据库不存在: ${dbPath}`);
    process.exitCode = 1;
    return;
  }
  const sizeMB = (fs.statSync(dbPath).size / 1024 / 1024).toFixed(1);
  const d = new Database(dbPath, { readonly: true });
  console.log(`文件: ${dbPath}`);
  console.log(`大小: ${sizeMB} MB`);

  // 关键自检：主库头部声明的页数 vs 引擎实际可见页数。
  // 两者差异巨大通常意味着同级 WAL（或残留 journal）里有一条更新的事务在掩盖主库数据
  // —— 此时任何查询都看不到主库里的真实数据，且一次 checkpoint 就会把主库覆盖掉。
  try {
    const fd = fs.openSync(dbPath, 'r');
    const head = Buffer.alloc(32);
    fs.readSync(fd, head, 0, 32, 0);
    fs.closeSync(fd);
    const declaredPages = head.readUInt32BE(28);
    const declaredPageSize = head.readUInt16BE(16) || 65536;
    const visiblePages = d.pragma('page_count')[0].page_count;
    const visiblePageSize = d.pragma('page_size')[0].page_size;
    const declaredMB = (declaredPages * declaredPageSize / 1048576).toFixed(1);
    const visibleMB = (visiblePages * visiblePageSize / 1048576).toFixed(1);
    console.log(`主库头部声明: ${declaredPages} 页 (${declaredMB} MB)`);
    console.log(`引擎实际可见: ${visiblePages} 页 (${visibleMB} MB)`);
    const ratio = visiblePages / (declaredPages || 1);
    if (ratio < 0.5) {
      console.log('⚠️  可见数据远少于主库声明 —— 疑似被 WAL/journal 掩盖，请勿写入，先跑 scripts/db-diagnose.js');
    }
  } catch (e) {
    console.log(`页数对比失败: ${e.message}`);
  }

  const tables = d.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name"
  ).all().map((r) => r.name);

  console.log(`\n表 (${tables.length} 个):`);
  for (const t of tables) {
    const c = d.prepare(`SELECT COUNT(*) c FROM "${t}"`).get().c;
    console.log(`  ${t.padEnd(26)} ${fmt(c).padStart(12)} 行`);
  }

  const cols = d.prepare('PRAGMA table_info(sessions)').all().map((c) => c.name);
  console.log(`\nsessions.online_peak 存在: ${cols.includes('online_peak')}`);

  const s = d.prepare(
    'SELECT COUNT(*) c, MIN(start_time) mn, MAX(start_time) mx, MAX(online_peak) peak FROM sessions'
  ).get();
  console.log(`场次时间范围: ${s.mn} ~ ${s.mx}, 在线峰值 MAX=${fmt(s.peak)}`);

  const g = d.prepare('SELECT COUNT(*) c, MIN(create_time) mn, MAX(create_time) mx FROM gifts').get();
  const toDate = (v) => (v ? new Date(v > 1e12 ? v : v * 1000).toISOString().slice(0, 19) : '-');
  console.log(`礼物时间范围: ${toDate(g.mn)} ~ ${toDate(g.mx)}`);

  const st = d.prepare('SELECT COUNT(*) c FROM streamers').get().c;
  console.log(`主播数: ${fmt(st)}`);
  d.close();
}

main();
