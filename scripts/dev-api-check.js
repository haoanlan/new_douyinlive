/**
 * 本地开发自检脚本：登录后端并抽样几个关键 API。
 * 用法: node scripts/dev-api-check.js
 */
const BASE = process.env.CHECK_BASE || 'http://127.0.0.1:9871';

async function main() {
  const loginRes = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userName: 'admin', password: '123456' })
  });
  const loginText = await loginRes.text();
  console.log(`POST /api/auth/login -> HTTP ${loginRes.status}`);
  console.log(loginText.slice(0, 400));

  let token = '';
  try {
    const parsed = JSON.parse(loginText);
    token = parsed.token || parsed.accessToken || parsed.data?.token || '';
  } catch {
    /* 非 JSON 时不带 token 继续探测 */
  }
  if (!token) {
    console.log('未从登录响应中取到 token，跳过鉴权接口探测');
    return;
  }
  console.log(`token 长度: ${token.length}`);

  const paths = [
    '/api/overview',
    '/api/rooms',
    '/api/session/list?page=1&pageSize=5',
    '/api/gifts/ranking',
    '/api/user/list'
  ];
  for (const p of paths) {
    try {
      const res = await fetch(`${BASE}${p}`, { headers: { Authorization: `Bearer ${token}` } });
      const text = await res.text();
      console.log(`GET ${p} -> HTTP ${res.status} (${text.length} bytes) ${text.slice(0, 160)}`);
    } catch (e) {
      console.log(`GET ${p} -> ERR ${e.message}`);
    }
  }
}

main().catch((e) => {
  console.error('自检失败:', e.message);
  process.exitCode = 1;
});
