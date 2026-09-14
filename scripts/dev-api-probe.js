/**
 * 全量 API 探测：把前端会调用的所有接口打一遍，列出状态码与错误。
 * 用法: node scripts/dev-api-probe.js
 */
const FRONT = process.env.CHECK_FRONT || 'http://127.0.0.1:5173';

async function call(method, path, token, body) {
  const headers = {};
  if (body) headers['Content-Type'] = 'application/json';
  if (token) headers.Authorization = `Bearer ${token}`;
  const t0 = Date.now();
  try {
    const res = await fetch(`${FRONT}${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
    const text = await res.text();
    return { status: res.status, text, ms: Date.now() - t0 };
  } catch (e) {
    return { status: 0, text: `ERR ${e.message}`, ms: Date.now() - t0 };
  }
}

async function main() {
  const login = await call('POST', '/api/auth/login', '', { userName: 'admin', password: '123456' });
  const token = JSON.parse(login.text).token;
  console.log(`登录 HTTP ${login.status} (${login.ms}ms)\n`);

  const paths = [
    ['GET', '/api/overview'],
    ['GET', '/api/summary'],
    ['GET', '/api/rooms'],
    ['GET', '/api/streamers'],
    ['GET', '/api/status'],
    ['GET', '/api/trends?range=7d&group=day'],
    ['GET', '/api/hosts'],
    ['GET', `/api/hosts/1/sessions`],
    ['GET', '/api/sessions?page=1&pageSize=10'],
    ['GET', '/api/sessions?page=1&page_size=10'],
    ['GET', '/api/sessions/room/57644688826'],
    ['GET', '/api/gifts/ranking?limit=10'],
    ['GET', '/api/danmaku/search?limit=5'],
    ['GET', '/api/gifts/by-type'],
    ['GET', '/api/users/search?q=%E6%97%A0%E9%99%90'],
    ['GET', '/api/user/info'],
    ['GET', '/api/user/list?page=1&size=10'],
    ['GET', '/api/role/list?page=1&size=10'],
    ['GET', '/api/v3/system/menus'],
    ['GET', '/api/rooms/lookup?q=48465460802']
  ];

  const bad = [];
  for (const [m, p] of paths) {
    const r = await call(m, p, token);
    const mark = r.status === 200 ? 'OK  ' : 'BAD ';
    if (r.status !== 200) bad.push(`${m} ${p} -> ${r.status} ${r.text.slice(0, 120)}`);
    console.log(`${mark}${String(r.status).padStart(3)} ${String(r.ms).padStart(5)}ms ${p}  ${r.text.slice(0, 90).replace(/\s+/g, ' ')}`);
  }

  // 会话详情类接口（需要真实 session id）
  const sess = await call('GET', '/api/sessions?page=1&pageSize=1', token);
  let sid = null;
  try { sid = JSON.parse(sess.text)?.[0]?.id; } catch { /* ignore */ }
  if (sid) {
    const detailPaths = [
      ['GET', `/api/sessions/${sid}/detail`],
      ['GET', `/api/sessions/${sid}/danmaku?limit=10`],
      ['GET', `/api/sessions/${sid}/report`],
      ['GET', `/api/sessions/${sid}/gifts`],
      ['GET', `/api/sessions/${sid}/trend`]
    ];
    console.log(`\n--- 场次 ${sid} 详情类接口 ---`);
    for (const [m, p] of detailPaths) {
      const r = await call(m, p, token);
      const ok = r.status === 200 || r.status === 404;
      if (!ok) bad.push(`${m} ${p} -> ${r.status} ${r.text.slice(0, 120)}`);
      console.log(`${ok ? 'OK  ' : 'BAD '}${String(r.status).padStart(3)} ${String(r.ms).padStart(6)}ms ${p}  ${r.text.slice(0, 90).replace(/\s+/g, ' ')}`);
    }
  }

  console.log(`\n=== 异常接口 ${bad.length} 个 ===`);
  bad.forEach((b) => console.log('  ' + b));
}

main().catch((e) => { console.error('探测失败:', e.message); process.exitCode = 1; });
