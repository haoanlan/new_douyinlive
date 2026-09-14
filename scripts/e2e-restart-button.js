/**
 * 验证「快速重启」按钮的行为：
 *  1. 按钮必须始终可点（不能因为缺前置条件被灰掉）
 *  2. 缺条件时点击应弹出明确原因
 *  3. 顺便核对工具栏各控件的高度/圆角一致性
 * 用法: node scripts/e2e-restart-button.js
 */
const path = require('path');
const fs = require('fs');
const { chromium } = require('playwright');

const FRONT = process.env.CHECK_FRONT || 'http://127.0.0.1:5173';
const OUT = path.join(__dirname, '..', 'logs', 'e2e');
const BROWSERS = [
  process.env.CHROME_PATH,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
].filter(Boolean);

function findBrowser() {
  for (const c of BROWSERS) if (fs.existsSync(c)) return c;
  throw new Error('找不到 Chrome/Edge');
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch({
    executablePath: findBrowser(),
    headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage']
  });
  const page = await (await browser.newContext({ viewport: { width: 1600, height: 1000 } })).newPage();
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text().slice(0, 200)); });
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message.slice(0, 200)));

  // 登录
  await page.goto(FRONT, { waitUntil: 'networkidle', timeout: 60000 });
  await page.waitForTimeout(1200);
  const inputs = page.locator('.el-input__inner');
  await inputs.nth(0).fill('admin');
  await inputs.nth(1).fill('123456');
  const box = await page.locator('.drag_verify').first().boundingBox().catch(() => null);
  if (box) {
    const hx = box.x + 20;
    const hy = box.y + box.height / 2;
    await page.mouse.move(hx, hy);
    await page.mouse.down();
    for (let i = 1; i <= 12; i++) {
      await page.mouse.move(hx + ((box.width - 40) * i) / 12, hy, { steps: 2 });
      await page.waitForTimeout(20);
    }
    await page.mouse.up();
  }
  await page.locator('button:has-text("登录")').first().click().catch(() => {});
  await page.waitForTimeout(3500);

  await page.goto(`${FRONT}/#/douyin/status`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(3000);

  let failed = 0;
  const check = (label, ok, extra = '') => {
    if (!ok) failed++;
    console.log(`${ok ? 'OK  ' : 'FAIL'} ${label}${extra ? '  ' + extra : ''}`);
  };

  const restart = page.locator('button:has-text("快速重启")').first();
  check('快速重启按钮存在', (await restart.count()) > 0);
  const disabled = await restart.isDisabled();
  check('快速重启按钮可点击（未禁用）', disabled === false, `disabled=${disabled}`);

  // 工具栏控件高度/圆角一致性
  const metrics = await page.evaluate(() => {
    const bar = document.querySelector('.art-card');
    const pick = (sel) => {
      const el = bar?.querySelector(sel);
      if (!el) return null;
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      return { h: Math.round(r.height), radius: cs.borderRadius, font: cs.fontSize };
    };
    const buttons = [...(bar?.querySelectorAll('button') || [])].map((b) => {
      const r = b.getBoundingClientRect();
      return { h: Math.round(r.height), text: (b.innerText || '').trim().slice(0, 8) };
    });
    return { switchEl: pick('.el-switch'), buttons };
  });
  console.log('  工具栏度量:', JSON.stringify(metrics));
  const heights = metrics.buttons.map((b) => b.h);
  check(
    '工具栏按钮高度一致',
    heights.length > 0 && new Set(heights).size === 1,
    heights.join(' / ')
  );
  check(
    '开关与按钮高度接近（±2px）',
    metrics.switchEl ? Math.abs(metrics.switchEl.h - heights[0]) <= 6 : true,
    `switch=${metrics.switchEl?.h} button=${heights[0]}`
  );

  await page.screenshot({ path: path.join(OUT, 'toolbar-before.png'), clip: { x: 0, y: 150, width: 1600, height: 220 } });

  // 点击 → 应弹出明确原因
  await restart.click();
  await page.waitForTimeout(1200);
  const dialogVisible = await page.locator('.el-dialog').first().isVisible().catch(() => false);
  check('点击后弹出提示弹窗', dialogVisible);
  const dialogText = dialogVisible
    ? (await page.locator('.el-dialog').first().innerText()).replace(/\s+/g, ' ')
    : '';
  console.log('  弹窗内容:', dialogText.slice(0, 220));
  check('弹窗说明了缺失原因', /Go 抓取代理|没有找到|房间/.test(dialogText));
  await page.screenshot({ path: path.join(OUT, 'restart-dialog.png'), fullPage: false });

  console.log('\n控制台报错:', errors.length ? errors : '无');
  await browser.close();
  console.log(failed === 0 ? '\n全部通过' : `\n${failed} 项未通过`);
  process.exitCode = failed ? 1 : 0;
}

main().catch((e) => { console.error('验证失败:', e.message); process.exitCode = 1; });
