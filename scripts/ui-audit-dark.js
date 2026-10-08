/**
 * 暗色模式专项体检（对比度 + 写死浅色值）。
 *
 * 用法：node scripts/ui-audit-dark.js
 * 前置：1088 / 9871 / 5173 在跑；需要 danger-full-access（Chrome named pipe）。
 *
 * 为什么单独一个脚本：模板的暗色是 `<html class="dark">`，而 `systemThemeMode`
 * 若为 'auto' 会被系统偏好覆盖（无头环境＝light）—— 直接改 localStorage 里的
 * `systemThemeType` 是没用的，必须两个字段一起写死成 dark，否则测出来还是浅色。
 *
 * 覆盖：
 *  1. 全页文字对比度（含 oklch 归一化与 alpha 合成，AA 阈值：普通 4.5、大字号 3.0）
 *  2. 焦点隔离环颜色（键盘可达的可见性）
 *  3. el-progress 轨道、名次徽章等写死浅色值
 *  4. 列出暗色下仍未达标的元素（类名 + 文案 + 字号 + 实测比值）
 */
const { chromium } = require('playwright');
const { resolveChromium } = require('../lib/browser-path');

const FRONT = process.env.CHECK_FRONT || 'http://127.0.0.1:5173';
const API = process.env.CHECK_API || 'http://127.0.0.1:9871';
const PAGES = [
  ['douyin/dashboard', '概览'],
  ['douyin/rooms', '房间管理'],
  ['douyin/sessions', '场次历史'],
  ['douyin/trends', '趋势分析'],
  ['douyin/search', '信息查询'],
  ['douyin/status', '状态监控']
];

const CONTRAST = `
function oklchToRgb(L, C, hDeg) {
  const h = (hDeg * Math.PI) / 180;
  const a = C * Math.cos(h), b = C * Math.sin(h);
  const l_ = L + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = L - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = L - 0.0894841775 * a - 1.291485548 * b;
  const l = l_ ** 3, m = m_ ** 3, s = s_ ** 3;
  const r = 4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s;
  const g = -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s;
  const bl = -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s;
  const f = (v) => {
    const c = v <= 0.0031308 ? 12.92 * v : 1.055 * Math.pow(Math.max(v, 0), 1 / 2.4) - 0.055;
    return Math.min(255, Math.max(0, Math.round(c * 255)));
  };
  return { r: f(r), g: f(g), b: f(bl), a: 1 };
}
function toRgb(c) {
  const s = String(c).trim();
  if (s.startsWith('oklch(')) {
    const m = s.match(/[\\d.]+/g).map(Number);
    return oklchToRgb(m[0], m[1], m[2]);
  }
  if (s.startsWith('rgb') || s.startsWith('rgba')) {
    const m = s.match(/[\\d.]+/g).map(Number);
    return { r: m[0], g: m[1], b: m[2], a: m.length > 3 ? m[3] : 1 };
  }
  if (s.startsWith('#')) {
    const h = s.length === 4 ? s.replace(/#(.)(.)(.)/, '#$1$1$2$2$3$3') : s;
    return { r: parseInt(h.slice(1, 3), 16), g: parseInt(h.slice(3, 5), 16), b: parseInt(h.slice(5, 7), 16), a: 1 };
  }
  // 兜底：交给浏览器归一化（注意 Chrome 会把 oklch 原样回读，所以上面必须显式处理）
  const cv = document.createElement('canvas').getContext('2d');
  cv.fillStyle = '#000';
  cv.fillStyle = s;
  const v = cv.fillStyle;
  if (v.startsWith('#')) {
    const h = v.length === 4 ? v.replace(/#(.)(.)(.)/, '#$1$1$2$2$3$3') : v;
    return { r: parseInt(h.slice(1, 3), 16), g: parseInt(h.slice(3, 5), 16), b: parseInt(h.slice(5, 7), 16), a: 1 };
  }
  const m = v.match(/[\\d.]+/g).map(Number);
  return { r: m[0], g: m[1], b: m[2], a: m.length > 3 ? m[3] : 1 };
}
function over(fg, bg) {
  return { r: fg.r * fg.a + bg.r * (1 - fg.a), g: fg.g * fg.a + bg.g * (1 - fg.a), b: fg.b * fg.a + bg.b * (1 - fg.a), a: 1 };
}
function effBg(el) {
  const chain = [];
  let n = el;
  while (n) { chain.unshift(n); n = n.parentElement; }
  let bg = { r: 255, g: 255, b: 255, a: 1 };
  for (const node of chain) {
    const c = toRgb(getComputedStyle(node).backgroundColor);
    if (c.a > 0) bg = over(c, bg);
  }
  return bg;
}
function lum(c) {
  const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
  return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b);
}
function ratio(fg, bg) {
  const a = lum(fg), b = lum(bg);
  const hi = Math.max(a, b), lo = Math.min(a, b);
  return Math.round(((hi + 0.05) / (lo + 0.05)) * 100) / 100;
}
`;

const SWEEP = `(() => {
  ${CONTRAST}
  const out = [];
  const vis = (el) => {
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden' || parseFloat(cs.opacity) < 0.05) return false;
    const r = el.getBoundingClientRect();
    return r.width > 1 && r.height > 1;
  };
  for (const el of document.querySelectorAll('.douyin-page *')) {
    if (el.children.length) continue;
    const text = (el.textContent || '').trim();
    if (!text || text.length > 60) continue;
    if (!vis(el)) continue;
    const cs = getComputedStyle(el);
    const fg = toRgb(cs.color);
    if (fg.a === 0) continue;
    const bg = effBg(el);
    const fgBoxed = over(fg, bg);
    const fs = parseFloat(cs.fontSize);
    const bold = parseInt(cs.fontWeight, 10) >= 700;
    const need = fs >= 24 || (bold && fs >= 18.66) ? 3 : 4.5;
    const r = ratio(fgBoxed, bg);
    if (r + 0.005 < need) {
      out.push({
        cls: String(el.className || '').split(' ').slice(0, 2).join('.'),
        tag: el.tagName.toLowerCase(),
        text: text.slice(0, 22),
        fs,
        bold,
        need,
        ratio: r,
        color: cs.color,
        bg: 'rgb(' + Math.round(bg.r) + ',' + Math.round(bg.g) + ',' + Math.round(bg.b) + ')'
      });
    }
  }
  return out;
})()`;

async function login(page) {
  await page.goto(FRONT, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(2500);
  const inputs = page.locator('.el-input__inner');
  await inputs.nth(0).fill('admin');
  await inputs.nth(1).fill('123456');
  for (let attempt = 0; attempt < 3; attempt++) {
    const box = await page.locator('.drag_verify').first().boundingBox().catch(() => null);
    if (!box) break;
    const hx = box.x + 12, hy = box.y + box.height / 2;
    await page.mouse.move(hx, hy); await page.mouse.down();
    await page.waitForTimeout(120);
    for (let i = 1; i <= 30; i++) {
      await page.mouse.move(hx + ((box.width - 24) * i) / 30, hy + (i % 3 === 0 ? 1 : 0), { steps: 3 });
      await page.waitForTimeout(25);
    }
    await page.waitForTimeout(300);
    await page.mouse.up();
    await page.waitForTimeout(1200);
    if (await page.evaluate(() => /验证成功/.test(document.body.innerText))) break;
  }
  await page.locator('button:has-text("登录")').first().click().catch(() => {});
  for (let i = 0; i < 50; i++) {
    if (await page.evaluate(() => !!document.querySelector('.douyin-page'))) return true;
    await page.waitForTimeout(300);
  }
  return false;
}

function setDark() {
  /*
   * 两条路都铺上：
   *  1) systemThemeMode='dark' 直接指定；
   *  2) systemThemeMode='auto' + 浏览器 colorScheme=dark（initializeTheme 会读
   *     usePreferredDark()）—— 实测只改 localStorage 时 html class 没变，
   *     这条路更接近真实用户"跟随系统"的场景，也更可靠。
   */
  const raw = localStorage.getItem('setting');
  const obj = raw ? JSON.parse(raw) : {};
  obj.systemThemeType = 'dark';
  obj.systemThemeMode = 'auto';
  localStorage.setItem('setting', JSON.stringify(obj));
}

async function main() {
  const token = (await (await fetch(`${API}/api/auth/login`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ userName: 'admin', password: '123456' })
  })).json()).token;
  const sessions = await (await fetch(`${API}/api/sessions`, { headers: { authorization: `Bearer ${token}` } })).json();
  const sid = (Array.isArray(sessions) ? sessions : sessions.list)[0].id;

  const exe = resolveChromium();
  const browser = await chromium.launch({ executablePath: exe || undefined, headless: true, args: ['--no-sandbox'] });
  const page = await (await browser.newContext({ viewport: { width: 1500, height: 950 }, colorScheme: 'dark' })).newPage();
  if (!(await login(page))) throw new Error('登录失败');
  await page.evaluate(setDark);
  await page.reload({ waitUntil: 'domcontentloaded' });
  for (let i = 0; i < 60; i++) {
    if (await page.evaluate(() => !!document.querySelector('.douyin-page'))) break;
    await page.waitForTimeout(200);
  }
  await page.waitForTimeout(2500);
  const theme = await page.evaluate(() => ({
    htmlClass: document.documentElement.className,
    prefersDark: window.matchMedia('(prefers-color-scheme: dark)').matches,
    bodyBg: getComputedStyle(document.body).backgroundColor,
    cardBg: getComputedStyle(document.querySelector('.art-card') || document.body).backgroundColor,
    stored: JSON.parse(localStorage.getItem('setting') || '{}').systemThemeMode
  }));
  console.log('主题状态:', JSON.stringify(theme));
  if (!String(theme.htmlClass).includes('dark')) {
    const dump = await page.evaluate(() => ({
      headerBtns: [...document.querySelectorAll('#app-header button, #app-header [class*="cursor"]')]
        .map((b) => (b.getAttribute('aria-label') || b.className || '').toString().slice(0, 60))
        .slice(0, 12)
    }));
    console.log('❌ 仍未切到暗色，头部候选按钮:', JSON.stringify(dump, null, 2));
    await browser.close();
    return;
  }

  const pages = [...PAGES, [`douyin/detail/${sid}`, '场次详情']];
  let total = 0;
  const allFail = [];
  for (const [route, label] of pages) {
    await page.evaluate((r) => { location.hash = `#/${r}`; }, route);
    await page.waitForTimeout(1500);
    for (let i = 0; i < 40; i++) {
      const busy = await page.evaluate(() => {
        const m = document.querySelector('.el-loading-mask');
        return m ? parseFloat(getComputedStyle(m).opacity) > 0.05 : false;
      });
      if (!busy) break;
      await page.waitForTimeout(200);
    }
    await page.mouse.move(3, 3);
    await page.waitForTimeout(300);
    const fails = await page.evaluate(SWEEP);
    const sampled = await page.evaluate(() => document.querySelectorAll('.douyin-page *').length);
    total += sampled;
    console.log(`\n--- ${label} (${route}) 未达标 ${fails.length} 处 ---`);
    for (const f of fails.slice(0, 8)) {
      console.log(`  ${f.ratio}:1 (需 ${f.need}) ${f.fs}px${f.bold ? ' bold' : ''} ${f.tag}.${f.cls} «${f.text}» ${f.color} on ${f.bg}`);
    }
    allFail.push(...fails.map((f) => ({ ...f, page: label })));
  }

  // 写死浅色的几处专项
  await page.evaluate(() => { location.hash = '#/douyin/status'; });
  await page.waitForTimeout(1800);
  const hard = await page.evaluate(`(() => {
    ${CONTRAST}
    const track = document.querySelector('.douyin-page .el-progress-bar__outer');
    const chip = document.querySelector('.douyin-page .mon-chip');
    const kv = document.querySelector('.douyin-page .mon-kv__label');
    const info = {};
    if (track) info.progressTrack = { bg: getComputedStyle(track).backgroundColor, cardBg: getComputedStyle(track.closest('.art-card') || document.body).backgroundColor };
    if (chip) info.monChip = { color: getComputedStyle(chip).color, bg: getComputedStyle(chip).backgroundColor, ratio: ratio(over(toRgb(getComputedStyle(chip).color), effBg(chip)), effBg(chip)) };
    if (kv) info.kvLabel = { color: getComputedStyle(kv).color, ratio: ratio(over(toRgb(getComputedStyle(kv).color), effBg(kv)), effBg(kv)) };
    const vt = getComputedStyle(document.documentElement);
    info.vars = {
      dyTextPrimary: vt.getPropertyValue('--dy-text-primary').trim(),
      dyTextSecondary: vt.getPropertyValue('--dy-text-secondary').trim(),
      dyTextMuted: vt.getPropertyValue('--dy-text-muted').trim(),
      defaultBox: vt.getPropertyValue('--default-box-color').trim()
    };
    return info;
  })()`);
  console.log('\n=== 写死浅色专项（status 页） ===');
  console.log(JSON.stringify(hard, null, 2));

  // 焦点环：聚焦第一张可点卡片
  await page.evaluate(() => { location.hash = '#/douyin/rooms'; });
  await page.waitForTimeout(1800);
  const ring = await page.evaluate(() => {
    const el = document.querySelector('.room-card') || document.querySelector('.douyin-page [role="button"]');
    if (!el) return null;
    el.setAttribute('tabindex', '0');
    el.focus();
    const cs = getComputedStyle(el);
    return { boxShadow: cs.boxShadow, outline: cs.outlineColor + ' ' + cs.outlineWidth, cls: String(el.className).slice(0, 40) };
  });
  console.log('\n=== 焦点环（暗色） ===');
  console.log(JSON.stringify(ring));

  // 名次徽章
  await page.evaluate(() => { location.hash = '#/douyin/dashboard'; });
  await page.waitForTimeout(2500);
  const badges = await page.evaluate(`(() => {
    ${CONTRAST}
    const rows = [];
    for (const el of document.querySelectorAll('.douyin-page .w-6.h-6')) {
      const cs = getComputedStyle(el);
      const bg = effBg(el);
      rows.push({ cls: String(el.className).split(' ').slice(0, 3).join('.'), cls3: el.className, color: cs.color, bg: 'rgb(' + Math.round(bg.r) + ',' + Math.round(bg.g) + ',' + Math.round(bg.b) + ')', ratio: ratio(over(toRgb(cs.color), bg), bg) });
      if (rows.length >= 3) break;
    }
    return rows;
  })()`);
  console.log('\n=== 名次徽章（暗色） ===');
  console.log(JSON.stringify(badges, null, 2));

  console.log(`\n=== 汇总：采样 ${total} 个节点，暗色下未达标 ${allFail.length} 处 ===`);
  const byCls = {};
  for (const f of allFail) {
    const k = `${f.page} ${f.tag}.${f.cls}`;
    byCls[k] = byCls[k] || { n: 0, min: 99, need: f.need, sample: f.text };
    byCls[k].n++;
    byCls[k].min = Math.min(byCls[k].min, f.ratio);
  }
  for (const [k, v] of Object.entries(byCls).slice(0, 25)) console.log(`  ${k} ×${v.n} 最低 ${v.min}:1（需 ${v.need}）«${v.sample}»`);
  await browser.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
