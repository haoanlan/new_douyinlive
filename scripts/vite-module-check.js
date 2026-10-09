/**
 * 前端模块编译体检 —— 提交前跑一次。
 *
 * 为什么需要它：Vite 是**按需编译**的，`node --check` 只能查 .js，
 * 而 .vue 里的 `<script setup>` 语法错误只会在浏览器真正请求那个模块时才暴露。
 * 我踩过一次：在块注释里写了一个"匹配开头方括号段"的字面量正则，
 * 正则里 `\s*` 后面紧跟 `/` 和 `,`，那三个字符 `*` `/` `,` 里的前两个刚好把块注释闭合了
 * → 整个 search 页编译 500 → 页面白屏，而我当时只跑了其它页面的回归，没发现。
 * （写这个脚本时我又踩了第二次，所以规则是：块注释里不要写带 `*` 和 `/` 相邻的正则。）
 *
 * 用法：node scripts/vite-module-check.js [baseUrl]
 * 退出码 0 = 全部 200；1 = 有模块编译失败（打印 Vite 返回的错误摘要）。
 */
const fs = require('fs');
const path = require('path');

const BASE = process.argv[2] || 'http://127.0.0.1:5173';
const SRC = path.join(__dirname, '..', 'frontend', 'src');

/** 递归收集待检查的源文件（.vue / .ts / .tsx），跳过类型声明与测试 */
function collect(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (['node_modules', 'dist', '__tests__'].includes(e.name)) continue;
      collect(p, out);
    } else if (/\.(vue|tsx?)$/.test(e.name) && !/\.d\.ts$/.test(e.name)) {
      out.push(p);
    }
  }
  return out;
}

async function main() {
  const files = collect(SRC);
  const bad = [];
  let ok = 0;
  for (const f of files) {
    const rel = path.relative(SRC, f).split(path.sep).join('/');
    const url = `${BASE}/src/${rel}`;
    let res;
    try {
      res = await fetch(url);
    } catch (e) {
      console.error(`无法连接 dev server（${BASE}）：${e.message}`);
      process.exit(2);
    }
    if (res.status === 200) {
      ok++;
      continue;
    }
    const body = await res.text();
    // Vite 把编译错误塞在返回的 JS 里，抓 message 字段做摘要
    let brief = body.slice(0, 300);
    const m = body.match(/"message":"([^"]{0,400})/);
    if (m) brief = m[1].replace(/\\n/g, ' ').slice(0, 400);
    bad.push({ rel, status: res.status, brief });
  }
  console.log(`检查 ${files.length} 个源文件：200 ${ok} 个，失败 ${bad.length} 个`);
  for (const b of bad) console.log(`\nFAIL  ${b.rel}（HTTP ${b.status}）\n      ${b.brief}`);
  process.exit(bad.length ? 1 : 0);
}

main();
