/**
 * 直接验证共享的房间状态模块（不经 HTTP，便于定位问题）。
 * 用法: node scripts/check-room-status.js
 */
const path = require('path');

const ROOT = path.join(__dirname, '..');
process.env.DB_SQLITE_PATH = process.env.DB_SQLITE_PATH || path.join(ROOT, 'db', 'douyin.db');

const db = require('../db-sqlite.js');
const roomStatus = require('../lib/room-status.js');

(async () => {
  await db.init();
  const r = await roomStatus.getRoomStates({ dbInstance: db.getDb(), dataDir: ROOT });
  console.log(`source=${r.source}  stale=${r.stale}  ageMs=${r.ageMs}  rooms=${r.rooms.length}\n`);
  for (const x of r.rooms) {
    console.log(
      `  ${String(x.name || '-').padEnd(24)} ${String(x.roomId || '-').padEnd(14)} connected=${String(x.connected).padEnd(5)} recording=${String(x.recording).padEnd(5)} live=${String(x.liveStatus).padEnd(5)} title=${x.title || '-'}`
    );
  }
  process.exit(0);
})().catch((e) => {
  console.error('失败:', e.message);
  process.exit(1);
});
