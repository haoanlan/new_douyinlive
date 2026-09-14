/**
 * 本地开发自检：确认 Vite 开发服务器可访问，且 /api 代理到后端。
 * 用法: node scripts/dev-http-check.js   （可用 CHECK_FRONT 覆盖前端地址）
 */
const FRONT = process.env.CHECK_FRONT || 'http://127.0.0.1:5173';

async function main() {
  const index = await fetch(`${FRONT}/`);
  const html = await index.text();
  console.log(`GET ${FRONT}/ -> HTTP ${index.status}, ${html.length} bytes`);
  console.log(html.slice(0, 300).replace(/\n/g, ' '));

  const mainTs = await fetch(`${FRONT}/src/main.ts`);
  const mainBody = await mainTs.text();
  console.log(`GET /src/main.ts -> HTTP ${mainTs.status}, ${mainBody.length} bytes`);

  const login = await fetch(`${FRONT}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userName: 'admin', password: '123456' })
  });
  const loginText = await login.text();
  console.log(`POST ${FRONT}/api/auth/login (经 Vite 代理) -> HTTP ${login.status}`);
  console.log(loginText.slice(0, 200));
}

main().catch((e) => {
  console.error('自检失败:', e.message);
  process.exitCode = 1;
});
