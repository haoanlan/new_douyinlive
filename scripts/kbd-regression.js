/**
 * P1-8 键盘可达回归：等目标渲染完，经键盘路径聚焦（:focus-visible 必然命中），
 * getComputedStyle 断言焦点环真实可见（等 transition 结束、校验颜色与扩散），
 * 并验证房间卡 Enter 激活。
 * 用法：node scripts/kbd-regression.js
 */
const fs = require('fs');
const { chromium } = require('playwright');
const FRONT = 'http://127.0.0.1:5173';
const BROWSERS = [
  process.env.CHROME_PATH,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
].filter(Boolean);
function findBrowser() { for (const c of BROWSERS) if (fs.existsSync(c)) return c; throw new Error('no browser'); }

const results = [];
const check = (n, pass, d = '') => {
  results.push({ n, pass });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${n}${d ? ' — ' + d : ''}`);
};

async function login(page) {
  await page.goto(FRONT, { waitUntil: 'networkidle', timeout: 60000 });
  await page.waitForTimeout(1200);
  const inputs = page.locator('.el-input__inner');
  await inputs.nth(0).fill('admin');
  await inputs.nth(1).fill('123456');
  const box = await page.locator('.drag_verify').first().boundingBox().catch(() => null);
  if (box) {
    const hx = box.x + 20, hy = box.y + box.height / 2;
    await page.mouse.move(hx, hy); await page.mouse.down();
    for (let i = 1; i <= 12; i++) { await page.mouse.move(hx + ((box.width - 40) * i) / 12, hy, { steps: 2 }); await page.waitForTimeout(20); }
    await page.mouse.up(); await page.waitForTimeout(300);
  }
  await page.locator('button:has-text("登录")').first().click().catch(() => {});
  for (let i = 0; i < 50; i++) {
    if (await page.evaluate(() => !!document.querySelector('.douyin-page'))) break;
    await page.waitForTimeout(200);
  }
}

/**
 * 经**键盘路径**聚焦目标并读焦点环：
 * 先 programmatic focus，若 :focus-visible 未命中，则聚焦它后面的可聚焦元素、
 * Shift+Tab 退回（真实键盘进入，:focus-visible 必然命中）。
 */
async function probeFocusRing(page, sel) {
  const loc = page.locator(sel).first();
  await loc.waitFor({ state: 'visible', timeout: 20000 });
  await loc.focus();
  let snap = await loc.evaluate((el) => {
    const cs = getComputedStyle(el);
    return {
      fv: el.matches(':focus-visible'),
      outlineStyle: cs.outlineStyle,
      outlineWidth: cs.outlineWidth,
      boxShadow: cs.boxShadow
    };
  });
  if (!snap.fv) {
    // 键盘重入：聚焦下一个可聚焦元素，再 Shift+Tab 回来
    await loc.evaluate((el) => {
      const all = [...document.querySelectorAll('a[href],button:not([disabled]),input:not([disabled]),select,textarea,[tabindex="0"]')];
      const i = all.indexOf(el);
      const next = all[i + 1];
      if (next) next.focus();
      else if (all[i - 1]) all[i - 1].focus();
    });
    await page.keyboard.press('Shift+Tab');
  }
  // box-shadow 有 transition：等过渡跑完再取值，否则量到的是起始帧（透明0扩散）
  await page.waitForTimeout(450);
  snap = await loc.evaluate((el) => {
    const cs = getComputedStyle(el);
    return {
      fv: el.matches(':focus-visible'),
      outlineStyle: cs.outlineStyle,
      outlineWidth: cs.outlineWidth,
      boxShadow: cs.boxShadow
    };
  });
  // 有效焦点环：outline 可见，或 box-shadow 含真实颜色且 blur/spread > 0
  const m = [
    ...snap.boxShadow.matchAll(
      /(rgba?\([^)]+\))\s+(-?[\d.]+)px\s+(-?[\d.]+)px\s+(-?[\d.]+)px\s+(-?[\d.]+)px/g
    )
  ];
  const hasVisibleShadow = m.some((x) => {
    const fullyTransparent = /,\s*0\)$/.test(x[1]);
    const spread = parseFloat(x[5]);
    const blur = parseFloat(x[4]);
    return !fullyTransparent && (spread > 0 || blur > 0);
  });
  const visibleRing =
    (snap.outlineStyle !== 'none' && parseFloat(snap.outlineWidth) > 0) || hasVisibleShadow;
  return { ...snap, visibleRing };
}

async function main() {
  const browser = await chromium.launch({ executablePath: findBrowser(), headless: true, args: ['--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 1500, height: 1000 } });
  await login(page);

  // ---- rooms：房间卡 ----
  await page.goto(`${FRONT}/#/douyin/rooms`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.room-card', { timeout: 20000 });
  await page.waitForTimeout(1500);
  let ring = await probeFocusRing(page, '.room-card');
  check(
    'rooms 房间卡键盘聚焦 + 焦点环可见',
    ring.fv && ring.visibleRing,
    `fv=${ring.fv} outline=${ring.outlineStyle}/${ring.outlineWidth} shadow=${ring.boxShadow.slice(0, 80)}`
  );

  // Enter 激活
  const card = page.locator('.room-card').first();
  await card.focus();
  await page.keyboard.press('Enter');
  await page.waitForTimeout(900);
  check('rooms 房间卡 Enter 激活跳场次页', /sessions/.test(page.url()), page.url().slice(-70));

  // ---- icon-only 按钮 ----
  await page.goto(`${FRONT}/#/douyin/rooms`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.room-card', { timeout: 20000 });
  await page.waitForTimeout(1000);
  ring = await probeFocusRing(page, '.room-card button[aria-label]');
  check(
    'icon-only 按钮键盘聚焦 + 焦点环可见',
    ring.fv && ring.visibleRing,
    `fv=${ring.fv} outline=${ring.outlineStyle}/${ring.outlineWidth} shadow=${ring.boxShadow.slice(0, 80)}`
  );

  // ---- sessions：场次行 ----
  await page.goto(`${FRONT}/#/douyin/sessions?hostId=34`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.session-row', { timeout: 20000 });
  await page.waitForTimeout(1500);
  ring = await probeFocusRing(page, '.session-row');
  check(
    'sessions 场次行键盘聚焦 + 焦点环可见',
    ring.fv && ring.visibleRing,
    `fv=${ring.fv} outline=${ring.outlineStyle}/${ring.outlineWidth} shadow=${ring.boxShadow.slice(0, 80)}`
  );

  // ---- detail：榜单行 ----
  const sid = await page.evaluate(async () => {
    const tk = JSON.parse(localStorage.getItem('sys-vundefined-user') || '{}')?.accessToken || '';
    const r = await fetch('/api/hosts/34/sessions', { headers: { Authorization: 'Bearer ' + tk } });
    const j = await r.json();
    const list = Array.isArray(j) ? j : j?.data || [];
    const m = [...list].sort((a, b) => (b.danmaku_count || 0) - (a.danmaku_count || 0))[0];
    return m ? m.id : null;
  });
  await page.goto(`${FRONT}/#/douyin/detail/${sid}`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.dy-detail-row', { timeout: 25000 });
  await page.waitForTimeout(1500);
  ring = await probeFocusRing(page, '.dy-detail-row');
  check(
    'detail 榜单行键盘聚焦 + 焦点环可见',
    ring.fv && ring.visibleRing,
    `fv=${ring.fv} outline=${ring.outlineStyle}/${ring.outlineWidth} shadow=${ring.boxShadow.slice(0, 80)}`
  );

  const failed = results.filter((r) => !r.pass);
  console.log(`\n=== ${results.length - failed.length}/${results.length} 通过 ===`);
  await browser.close();
  process.exitCode = failed.length ? 1 : 0;
}
main().catch((e) => { console.error(e); process.exit(1); });
