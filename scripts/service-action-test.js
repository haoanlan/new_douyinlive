/**
 * 验证一键启停链路：读取状态 → 执行 action → 再读状态。
 * 用法: node scripts/service-action-test.js <action>
 *   action 可选 start | stop | restart | start-proxy
 */
const FRONT = process.env.CHECK_FRONT || 'http://127.0.0.1:5173';
const action = process.argv[2] || 'stop';

async function call(token, pathname, init = {}) {
  const res = await fetch(`${FRONT}${pathname}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(init.headers || {})
    }
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* ignore */ }
  return { status: res.status, json, text };
}

async function snapshot(token, label) {
  const r = await call(token, '/api/service/status');
  const j = r.json || {};
  console.log(`[${label}] proxy.reachable=${j.proxy?.reachable} binary=${j.checks?.binary} daemon.running=${j.daemon?.running} pid=${j.daemon?.pid} rooms=${j.configuredRooms} issues=${(j.issues || []).length}`);
  return j;
}

async function main() {
  const login = await call('', '/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ userName: 'admin', password: '123456' })
  });
  const token = login.json.token;

  await snapshot(token, '执行前');
  console.log(`\n>>> 执行 action: ${action}`);
  const r = await call(token, '/api/service/action', {
    method: 'POST',
    body: JSON.stringify({ action })
  });
  console.log(`HTTP ${r.status}`, JSON.stringify(r.json, null, 1).slice(0, 700));

  await new Promise((res) => setTimeout(res, 3000));
  const after = await snapshot(token, '执行后');
  console.log('\n日志尾部:');
  (after.logLines || []).slice(-6).forEach((l) => console.log(`  [${l.src}] ${l.text.slice(0, 160)}`));
}

main().catch((e) => { console.error('失败:', e.message); process.exitCode = 1; });
