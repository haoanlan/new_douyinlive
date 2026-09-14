/**
 * 本地开发自检：按模块逐个请求关键源文件，确认 Vite 能编译（无 500）。
 * 用法: node scripts/dev-module-check.js
 */
const FRONT = process.env.CHECK_FRONT || 'http://127.0.0.1:5173';

const targets = [
  '/src/main.ts',
  '/src/App.vue',
  '/src/router/index.ts',
  '/src/store/modules/user.ts',
  '/src/api/douyin-http.ts',
  '/src/api/douyin.ts',
  '/src/views/auth/login/index.vue',
  '/src/views/douyin/dashboard/index.vue',
  '/src/assets/styles/core/tailwind.css'
];

async function main() {
  let failed = 0;
  for (const t of targets) {
    try {
      const res = await fetch(`${FRONT}${t}`);
      const body = await res.text();
      const bad = res.status !== 200 || /Internal server error|Failed to resolve import|Pre-transform error/i.test(body);
      if (bad) failed++;
      console.log(`${bad ? 'FAIL' : 'OK  '} ${res.status} ${t} (${body.length} bytes)`);
      if (bad) console.log('     ' + body.slice(0, 300).replace(/\s+/g, ' '));
    } catch (e) {
      failed++;
      console.log(`FAIL ERR  ${t} :: ${e.message}`);
    }
  }
  console.log(failed === 0 ? '\n全部模块编译通过' : `\n${failed} 个模块有问题`);
  process.exitCode = failed === 0 ? 0 : 1;
}

main();
