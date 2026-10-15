/**
 * 生成离线图标子集
 *
 * 背景：前端用 @iconify/vue 的 <Icon>，图标默认走**运行时 CDN**
 * （api.iconify.design / api.simplesvg.com / api.unisvg.com）。
 * 实测这台机器上三个域名**全部连不上**，于是所有图标空白 —— 对一个本地/内网工具是硬伤。
 *
 * 为什么不直接把整包塞进 bundle：@iconify-json/ri 全集约 1.5MB JSON，
 * 而当前主包（gzip 后）也就 460KB 左右，整包会把体积翻倍。
 * 所以这里扫描源码里实际出现的 `prefix:name`，只导出用到的那些。
 *
 * 用法：node scripts/gen-icon-subset.cjs
 *   产物：frontend/src/assets/iconify/offline-icons.json（已提交，构建前会自动重新生成）
 *
 * 注意：动态拼接出来的图标名（如 `ri:${x}-line`）扫不到 ——
 * 这类图标仍会在联网时从 CDN 取；如果确认不再联网，需要改成字面量或补进下面的 EXTRA。
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const FRONTEND = path.join(ROOT, 'frontend');
const SRC = path.join(FRONTEND, 'src');
const OUT = path.join(SRC, 'assets', 'iconify', 'offline-icons.json');

/** 源码里很难扫到、但确实要用的图标（人工补充，按需追加） */
const EXTRA = [];

/**
 * 扫描误报的前缀：正则会命中普通对象键（如 `pagination: 'center'`、`update: 'x'`、`10: 'v'`），
 * 它们既不是图标集、也不该出现在"未安装"告警里。
 */
const IGNORE_PREFIX = new Set([
  '10',
  'pagination',
  'update',
  'text',
  'number',
  'string',
  'boolean',
  'default',
  'small',
  'large',
  'medium',
  'left',
  'right',
  'center',
  'top',
  'bottom'
]);

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (/\.(vue|ts|js|json)$/.test(e.name)) out.push(p);
  }
  return out;
}

// 1) 扫描用到的 prefix:name
const used = new Map(); // prefix -> Set(name)
for (const file of walk(SRC)) {
  const text = fs.readFileSync(file, 'utf8');
  for (const m of text.matchAll(/["'`]([a-z0-9-]+):([a-z0-9][a-z0-9-]*)["'`]/g)) {
    const [, prefix, name] = m;
    if (['http', 'https', 'data', 'ws', 'wss', 'file', 'application', 'text'].includes(prefix)) continue;
    if (!used.has(prefix)) used.set(prefix, new Set());
    used.get(prefix).add(name);
  }
}
for (const item of EXTRA) {
  const [prefix, name] = item.split(':');
  if (!used.has(prefix)) used.set(prefix, new Set());
  used.get(prefix).add(name);
}

// 2) 从 @iconify-json/<prefix> 里挑出子集
const result = {};
const missing = [];
const summary = [];
for (const [prefix, names] of [...used.entries()].sort()) {
  if (IGNORE_PREFIX.has(prefix)) continue;
  const jsonPath = path.join(FRONTEND, 'node_modules', '@iconify-json', prefix, 'icons.json');
  if (!fs.existsSync(jsonPath)) {
    missing.push(`${prefix}（未安装 @iconify-json/${prefix}，用到 ${names.size} 个）`);
    continue;
  }
  const full = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
  const icons = {};
  const aliases = {};
  const notFound = [];

  /*
   * 把一个名字（可能是图标本体，也可能是别名）及其**依赖**一起收进来。
   *
   * 坑：别名必须连它的 parent 一起带上，否则 addCollection 校验不过，
   * **整个集合会被拒绝**（实测：第一版把 full.aliases 整份塞进去，
   * 里面有指向未收录图标的别名 → 注册失败且不报错 → 图标依旧空白）。
   */
  const seen = new Set();
  const addIcon = (name) => {
    if (icons[name] || aliases[name]) return true;
    if (seen.has(name)) return false;
    seen.add(name);
    const body = full.icons?.[name];
    if (body) {
      icons[name] = body;
      return true;
    }
    const alias = full.aliases?.[name];
    if (alias && alias.parent && addIcon(alias.parent)) {
      aliases[name] = alias;
      return true;
    }
    return false;
  };

  for (const name of names) {
    if (!addIcon(name)) notFound.push(name);
  }

  result[prefix] = {
    prefix: full.prefix || prefix,
    icons,
    aliases,
    width: full.width,
    height: full.height
  };
  summary.push(
    `${prefix}: 用 ${names.size} 个 → 导出 ${Object.keys(icons).length} 本体 + ${Object.keys(aliases).length} 别名` +
      (notFound.length ? `（找不到 ${notFound.length}: ${notFound.slice(0, 3).join(',')}）` : '')
  );
}

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, JSON.stringify(result), 'utf8');

const sizeKB = (fs.statSync(OUT).size / 1024).toFixed(0);
console.log('=== 离线图标子集 ===');
for (const s of summary) console.log('  ' + s);
if (missing.length) {
  console.log('\n⚠ 以下图标集未安装（这些图标仍走 CDN）：');
  for (const m of missing) console.log('  ' + m);
}
console.log(`\n写入 ${path.relative(ROOT, OUT).replace(/\\/g, '/')}（${sizeKB}KB）`);
