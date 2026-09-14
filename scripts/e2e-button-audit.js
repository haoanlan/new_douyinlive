/**
 * 列出页面按钮与卡片的实际尺寸，便于排查"一大一小"。
 * 用法: node scripts/e2e-button-audit.js
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
  const page = await (await browser.newContext({ viewport: { width: 1600, height: 1000 } })).newPage();

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

  const info = await page.evaluate(() =>
    [...document.querySelectorAll('button')]
      .filter((b) => b.offsetParent !== null)
      .map((b) => {
        const r = b.getBoundingClientRect();
        const cs = getComputedStyle(b);
        const card = b.closest('.art-card');
        const cardTitle = card?.querySelector('h4, .title')?.innerText?.trim().slice(0, 10) || '(顶部条)';
        return {
          text: (b.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 12),
          h: Math.round(r.height),
          w: Math.round(r.width),
          radius: cs.borderRadius,
          padding: cs.padding,
          card: cardTitle
        };
      })
  );
  console.log('可见按钮:');
  info.forEach((b) => console.log(`  ${String(b.h).padStart(3)}px × ${String(b.w).padStart(4)}px  r=${b.radius}  [${b.card}] ${b.text}`));

  const cards = await page.evaluate(() =>
    [...document.querySelectorAll('.art-card')].map((c) => {
      const r = c.getBoundingClientRect();
      return { h: Math.round(r.height), w: Math.round(r.width), title: c.querySelector('h4')?.innerText?.trim().slice(0, 10) || '-' };
    })
  );
  console.log('\n卡片:');
  cards.forEach((c) => console.log(`  ${String(c.h).padStart(4)}px × ${String(c.w).padStart(4)}px  ${c.title}`));

  await browser.close();
}

main().catch((e) => { console.error('失败:', e.message); process.exitCode = 1; });
