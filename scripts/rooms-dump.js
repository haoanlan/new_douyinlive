/**
 * 打印 /api/rooms 的房间列表（含启用/连接状态），用于核对页面显示。
 * 用法: node scripts/rooms-dump.js
 */
const FRONT = process.env.CHECK_FRONT || 'http://127.0.0.1:5173';

async function main() {
  const login = await fetch(`${FRONT}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userName: 'admin', password: '123456' })
  });
  const { token } = await login.json();
  const res = await fetch(`${FRONT}/api/rooms`, { headers: { Authorization: `Bearer ${token}` } });
  const rows = await res.json();
  console.log(`HTTP ${res.status}，房间数 ${rows.length}`);
  for (const r of rows) {
    console.log(
      `  ${String(r.room_id).padEnd(14)} ${String(r.name || '-').padEnd(24)} enabled=${r.enabled} connected=${r.connected} recording=${r.recording} 场次=${r.session_count} 最近=${r.last_session_time ?? '-'}`
    );
  }
}

main().catch((e) => { console.error('失败:', e.message); process.exitCode = 1; });
