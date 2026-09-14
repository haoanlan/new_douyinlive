/**
 * 精确测量工具栏各控件的几何与间距（实时 DOM，非截图估算）。
 * 用法: node scripts/e2e-toolbar-metrics.js
 */
const path = require('path');
const fs = require('fs');
const { chromium } = require('playwright');

const FRONT = process.env.CHECK_FRONT || 'http://127.0.0.1:5173';
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
  const browser = await chromium.launch({
    executablePath: findBrowser(),
    headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage']
  });
  const page = await (await browser.newContext({ viewport: { width: 1600, height: 900 } })).newPage();

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

  const data = await page.evaluate(() => {
    // 工具条 = 带 dy-toolbar 类的那张 art-card（比按文案找更稳）
    const bar = document.querySelector('.art-card.dy-toolbar');
    if (!bar) return null;
    const barRect = bar.getBoundingClientRect();
    const right = bar.querySelector('.dy-toolbar-actions');
    if (!right) return null;
    const controls = [...right.children].map((el) => {
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      const btn = el.tagName === 'BUTTON' ? el : el.querySelector('button');
      const bcs = btn ? getComputedStyle(btn) : null;
      return {
        tag: el.tagName.toLowerCase(),
        cls: el.className.toString().slice(0, 40),
        text: (el.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 10),
        x: Math.round(r.x),
        w: Math.round(r.width),
        h: Math.round(r.height),
        top: Math.round(r.top),
        bottom: Math.round(r.bottom),
        centerY: Math.round(r.top + r.height / 2),
        gapAfter: null,
        btnPadding: bcs ? `${bcs.paddingTop} ${bcs.paddingLeft}` : null,
        btnRadius: bcs ? bcs.borderRadius : null,
        btnFontSize: bcs ? bcs.fontSize : null
      };
    });
    for (let i = 0; i < controls.length - 1; i++) {
      controls[i].gapAfter = controls[i + 1].x - (controls[i].x + controls[i].w);
    }
    return {
      barHeight: Math.round(barRect.height),
      barPaddingY: getComputedStyle(bar).paddingTop,
      controls
    };
  });

  if (!data) { console.log('没找到工具条'); await browser.close(); return; }

  console.log(`工具条高度 ${data.barHeight}px（上下内边距 ${data.barPaddingY}）\n`);
  console.log('控件（从左到右）:');
  data.controls.forEach((c, i) => {
    console.log(
      `  ${i + 1}. ${c.tag.padEnd(7)} x=${String(c.x).padStart(4)} 宽=${String(c.w).padStart(3)} 高=${String(c.h).padStart(3)} top=${String(c.top).padStart(3)} bottom=${String(c.bottom).padStart(3)} 中心Y=${c.centerY}  "${c.text}"`
    );
    if (c.btnPadding) console.log(`      按钮 padding=${c.btnPadding} radius=${c.btnRadius} font=${c.btnFontSize}`);
    if (c.gapAfter !== null) console.log(`      → 与下一个控件间距 ${c.gapAfter}px`);
  });

  const heights = [...new Set(data.controls.map((c) => c.h))];
  const centers = [...new Set(data.controls.map((c) => c.centerY))];
  const gaps = data.controls.map((c) => c.gapAfter).filter((g) => g !== null);
  console.log(`\n高度集合: ${JSON.stringify(heights)}`);
  console.log(`垂直中心集合: ${JSON.stringify(centers)}  ${centers.length === 1 ? '(完全对齐)' : '(未对齐)'}`);
  console.log(`水平间距: ${JSON.stringify(gaps)}  ${new Set(gaps).size === 1 ? '(统一)' : '(不统一)'}`);

  await browser.close();
}

main().catch((e) => { console.error('失败:', e.message); process.exitCode = 1; });
