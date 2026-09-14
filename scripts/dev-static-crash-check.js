/**
 * 崩溃回归检查：确认后端静态文件服务在 dist 不存在时不再打挂进程。
 * 用法: node scripts/dev-static-crash-check.js   （默认检查 9871）
 */
const BASE = process.env.CHECK_BASE || 'http://127.0.0.1:9871';

async function main() {
  const targets = ['/', '/index.html', '/some/spa/route', '/api/overview'];
  for (const t of targets) {
    try {
      const res = await fetch(`${BASE}${t}`, { redirect: 'manual' });
      const body = await res.text();
      console.log(`GET ${t} -> HTTP ${res.status} (${body.length} bytes) ${body.slice(0, 80).replace(/\s+/g, ' ')}`);
    } catch (e) {
      console.log(`GET ${t} -> ERR ${e.message}`);
    }
  }

  // 进程存活确认
  try {
    const res = await fetch(`${BASE}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userName: 'admin', password: '123456' })
    });
    console.log(`\n进程存活检查: POST /api/auth/login -> HTTP ${res.status}`);
    process.exitCode = res.status === 200 ? 0 : 1;
  } catch (e) {
    console.log(`\n进程已挂: ${e.message}`);
    process.exitCode = 1;
  }
}

main();
