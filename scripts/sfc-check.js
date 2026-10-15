/**
 * SFC 模板编译检查 —— 扫描 frontend/src 下所有 .vue，用 @vue/compiler-sfc 解析模板。
 *
 * 为什么需要它（2026-10 补）：
 *   改弹窗结构时删掉了一层容器 div，但没删对应的 </div>，模板标签不配平。
 *   结果：`vue-tsc --noEmit` **报 0 错误**（类型检查不解析模板结构），
 *   而 Vite 编译直接失败 —— 页面被 vite-error-overlay 盖住，报 "Element is missing end tag"。
 *   也就是说：类型检查通过 ≠ 页面能跑。这个脚本补上这一环，比跑一遍完整 build 快得多。
 *
 * 用法：node scripts/sfc-check.js  （非 0 退出 = 有模板错误）
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const FRONTEND = path.join(ROOT, 'frontend');
const SRC = path.join(FRONTEND, 'src');

// 依赖装在 frontend/node_modules，按显式路径加载（本脚本在根目录、是 CJS）
function loadDep(name) {
  const candidates = [
    path.join(FRONTEND, 'node_modules', name),
    path.join(ROOT, 'node_modules', name)
  ];
  for (const c of candidates) {
    try {
      return require(c);
    } catch {
      /* 继续尝试下一个 */
    }
  }
  console.log(`⚠ 找不到依赖 ${name}（先 cd frontend && npm install）`);
  return null;
}

const sfc = loadDep('@vue/compiler-sfc');
const dom = loadDep('@vue/compiler-dom');
if (!sfc || !dom) process.exit(2);

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (e.name.endsWith('.vue')) out.push(p);
  }
  return out;
}

const files = walk(SRC);
let failed = 0;
const details = [];

for (const file of files) {
  const rel = path.relative(ROOT, file).replace(/\\/g, '/');
  const src = fs.readFileSync(file, 'utf8');
  const errs = [];

  let descriptor;
  try {
    const parsed = sfc.parse(src, { filename: file });
    descriptor = parsed.descriptor;
    errs.push(...(parsed.errors || []));
  } catch (e) {
    errs.push({ message: 'SFC 解析异常: ' + e.message });
  }

  if (descriptor && descriptor.template) {
    const offset = descriptor.template.loc.start.line - 1;
    try {
      dom.compile(descriptor.template.content, {
        onError: (e) => errs.push({ message: e.message, line: e.loc ? e.loc.start.line + offset : null })
      });
    } catch (e) {
      errs.push({ message: '模板编译异常: ' + e.message });
    }
  }

  if (errs.length) {
    failed++;
    details.push({ rel, errs, src });
  }
}

console.log(`检查 ${files.length} 个 .vue 文件：通过 ${files.length - failed} 个，失败 ${failed} 个`);
for (const d of details) {
  console.log(`\n✗ ${d.rel}`);
  for (const e of d.errs) {
    const line = e.line || (e.loc && e.loc.start && e.loc.start.line) || null;
    console.log(`    ${e.message}${line ? `（第 ${line} 行）` : ''}`);
    if (line) {
      const lines = d.src.split(/\r?\n/);
      for (let i = Math.max(0, line - 2); i < Math.min(lines.length, line + 1); i++) {
        console.log(`      ${String(i + 1).padStart(5)}${i + 1 === line ? ' »' : '  '} ${lines[i].slice(0, 110)}`);
      }
    }
  }
}

console.log(failed ? `\n===== 模板检查：${failed} 个文件有错误 =====` : '\n===== 模板检查：全部通过 =====');
process.exit(failed ? 1 : 0);
