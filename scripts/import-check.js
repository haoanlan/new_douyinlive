#!/usr/bin/env node
/**
 * 静态 import 检查：**不依赖 Vite**，直接扫源码里所有 import/export-from 的目标是否存在。
 *
 * 为什么需要它（踩过的坑）：
 *   清理模板页时删掉了 hooks/core/useTable.ts，唯一使用者是同样被删的模板页 ——
 *   静态看确实没人用了，但 **hooks/index.ts 这个桶文件里还 re-export 着它**，
 *   而当时查引用只匹配 '@/xxx' 形式，桶文件里写的是相对路径 './core/useTable'，
 *   于是漏掉了。更坑的是当时 `vite-module-check.js` 还报"全部 200"：
 *   Vite dev server 有 transform 缓存，那个模块在删除前已经被编译过，
 *   直到**重启 Vite（缓存清空）**才报 `Failed to resolve import`。
 *   这个脚本没有缓存，跑一次就能当场暴露。
 *
 * 用法：node scripts/import-check.js
 * 退出码：0 = 全部可解析；1 = 有断链
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SRC_DIRS = [path.join(ROOT, 'frontend', 'src')];
const EXT = ['.ts', '.tsx', '.vue', '.js', '.mjs', '.json'];

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (/\.(ts|tsx|vue|js)$/.test(e.name)) out.push(p.replace(/\\/g, '/'));
  }
  return out;
}

/** 解析一个 import 说明符；返回 false 表示"解析不到" */
function resolvable(fromFile, spec, srcDir) {
  if (!spec) return true;
  if (!spec.startsWith('.') && !spec.startsWith('@/')) return true; // 三方包/别名交给构建器

  let base;
  if (spec.startsWith('.')) base = path.posix.normalize(path.posix.join(path.posix.dirname(fromFile), spec));
  else base = `${srcDir.replace(/\\/g, '/')}/${spec.slice(2)}`;

  const cands = [base, `${base}/index.ts`, `${base}/index.vue`];
  for (const ext of EXT) {
    cands.push(`${base}${ext}`);
    cands.push(`${base}/index${ext}`);
  }
  return cands.some((c) => fs.existsSync(c));
}

/** 去掉注释，避免把"注释里举例的 import"当成真 import（自己在别处踩过） */
function stripComments(code) {
  return code
    .replace(/\/\*[\s\S]*?\*\//g, '') // 块注释
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1'); // 行注释（避免误伤 https://）
}

let total = 0;
let broken = 0;
for (const srcDir of SRC_DIRS) {
  const files = walk(srcDir);
  total += files.length;
  for (const f of files) {
    const code = stripComments(fs.readFileSync(f, 'utf8'));
    const specs = [
      ...code.matchAll(/\bfrom\s+['"]([^'"]+)['"]/g),
      ...code.matchAll(/\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g),
      ...code.matchAll(/\bexport\s+\*\s+from\s+['"]([^'"]+)['"]/g)
    ].map((m) => m[1]);
    for (const s of specs) {
      if (!resolvable(f, s, srcDir)) {
        broken++;
        console.log(`  ✗ ${path.relative(ROOT, f).replace(/\\/g, '/')} → ${s}`);
      }
    }
  }
}

console.log(
  broken
    ? `\n import 检查失败：${broken} 处指向不存在的文件（共扫 ${total} 个文件）`
    : ` import 检查通过：${total} 个文件的 import 目标全部存在`
);
process.exit(broken ? 1 : 0);
