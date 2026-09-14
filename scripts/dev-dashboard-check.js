/**
 * 本地开发自检：完整走一遍登录 + 各页面主接口，确认前端页面对应的后端数据可用。
 * 用法: node scripts/dev-dashboard-check.js   （默认经 Vite 代理 5173）
 */
const BASE = process.env.CHECK_FRONT || 'http://127.0.0.1:5173';

async function call(method, path, { token, body } = {}) {
  const headers = {};
  if (body) headers['Content-Type'] = 'application/json';
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined
  });
  const text = await res.text();
  return { status: res.status, text };
}

async function main() {
  const login = await call('POST', '/api/auth/login', { body: { userName: 'admin', password: '123456' } });
  const { token, roles } = JSON.parse(login.text);
  console.log(`登录: HTTP ${login.status}, roles=${roles}`);

  const checks = [
    ['GET', '/api/overview', '总览页'],
    ['GET', '/api/streamers', '主播/房间'],
    ['GET', '/api/rooms', '房间列表'],
    ['GET', '/api/status', '守护状态'],
    ['GET', '/api/summary', '汇总'],
    ['GET', '/api/sessions?page=1&pageSize=5', '场次列表'],
    ['GET', '/api/gifts/ranking?limit=5', '礼物榜'],
    ['GET', '/api/trends', '趋势'],
    ['GET', '/api/user/list?page=1&size=5', '用户管理']
  ];

  let bad = 0;
  for (const [method, path, label] of checks) {
    const r = await call(method, path, { token });
    const ok = r.status === 200;
    if (!ok) bad++;
    const preview = r.text.slice(0, 110).replace(/\s+/g, ' ');
    console.log(`${ok ? 'OK  ' : 'FAIL'} ${r.status} ${path}  [${label}]  ${preview}`);
  }
  console.log(bad === 0 ? '\n前端页面所需接口全部可用' : `\n${bad} 个接口异常`);
  process.exitCode = bad === 0 ? 0 : 1;
}

main().catch((e) => {
  console.error('自检失败:', e.message);
  process.exitCode = 1;
});
