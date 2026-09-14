/**
 * 取 Vite 编译错误的详细内容（用于排查 SFC 编译失败）。
 * 用法: node scripts/vite-module-error.js /src/views/douyin/status/index.vue
 */
const FRONT = process.env.CHECK_FRONT || 'http://127.0.0.1:5173';
const target = process.argv[2] || '/src/views/douyin/status/index.vue';

fetch(FRONT + target)
  .then((r) => r.text().then((t) => ({ status: r.status, text: t })))
  .then(({ status, text }) => {
    console.log(`HTTP ${status}, ${text.length} bytes`);
    console.log('--- 前 2000 字 ---');
    console.log(text.slice(0, 2000));
  })
  .catch((e) => console.error('失败:', e.message));
