/**
 * 打印 /api/service/status 的状态快照，便于确认判定口径。
 * 用法: node scripts/service-status.js
 */
const FRONT = process.env.CHECK_FRONT || 'http://127.0.0.1:5173';

async function main() {
  const login = await fetch(`${FRONT}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userName: 'admin', password: '123456' })
  });
  const { token } = await login.json();
  const res = await fetch(`${FRONT}/api/service/status`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  const j = await res.json();
  console.log(`HTTP ${res.status}`);
  console.log('proxy   :', JSON.stringify(j.proxy));
  console.log('daemon  :', JSON.stringify({ ...j.daemon, data: j.daemon?.data ? '(有数据)' : null }));
  console.log('ws      :', JSON.stringify(j.ws));
  console.log('checks  :', JSON.stringify(j.checks));
  console.log('房间配置:', j.configuredRooms);
  console.log('issues  :');
  (j.issues || []).forEach((i) => console.log(`  [${i.level}] ${i.text}`));
  console.log('logs    :', (j.logLines || []).length, '行');
}

main().catch((e) => { console.error('失败:', e.message); process.exitCode = 1; });
