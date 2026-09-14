/**
 * 打印 /api/anonymous-lookup 的返回结构，供页面改版参考。
 * 用法: node scripts/api-shape.js [关键词]
 */
const FRONT = process.env.CHECK_FRONT || 'http://127.0.0.1:5173';
const q = process.argv[2] || '无限';

async function main() {
  const login = await fetch(`${FRONT}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userName: 'admin', password: '123456' })
  });
  const { token } = await login.json();
  const res = await fetch(`${FRONT}/api/anonymous-lookup?q=${encodeURIComponent(q)}`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  const json = await res.json();
  console.log('顶层 keys:', Object.keys(json));
  const list = json.users || json;
  console.log('条数:', Array.isArray(list) ? list.length : '(非数组)');
  console.log('\n第一条完整结构:');
  console.log(JSON.stringify(Array.isArray(list) ? list[0] : json, null, 1));
  if (Array.isArray(list) && list.length > 1) {
    console.log('\n第二条(精简):');
    console.log(JSON.stringify(list[1], null, 1).slice(0, 1200));
  }
}

main().catch((e) => { console.error('失败:', e.message); process.exitCode = 1; });
