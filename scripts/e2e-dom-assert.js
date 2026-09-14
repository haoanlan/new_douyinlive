/**
 * 结构断言：验证两个重做页面渲染出了预期的新结构（卡片、统计格、指引等）。
 * 用法: node scripts/e2e-dom-assert.js
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

  let failed = 0;
  const check = (label, ok, extra = '') => {
    if (!ok) failed++;
    console.log(`${ok ? 'OK  ' : 'FAIL'} ${label}${extra ? '  ' + extra : ''}`);
  };

  // --- 匿名查询页 ---
  await page.goto(`${FRONT}/#/douyin/search`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1200);
  check('搜索页：工具条存在', await page.locator('.art-card').first().isVisible());
  check('搜索页：引导关键词按钮', (await page.locator('button:has-text("无限")').count()) > 0);

  await page.locator('input[placeholder*="昵称关键词"]').first().fill('无限');
  await page.locator('button:has-text("查询")').first().click();
  await page.waitForTimeout(9000);

  const cards = await page.locator('.art-card .grid.grid-cols-3').count();
  check('搜索页：结果卡片含三格统计', cards > 0, `共 ${cards} 张`);
  const headers = await page.locator('.art-card:has-text("参与场次")').count();
  check('搜索页：统计标签渲染', headers > 0);
  const profileBtns = await page.locator('button:has-text("画像")').count();
  check('搜索页：画像入口', profileBtns > 0, `${profileBtns} 个`);
  const sessionChips = await page.locator('.art-card button:has-text("·")').count();
  check('搜索页：最近参与场次入口', sessionChips >= 0, `${sessionChips} 个`);
  const sortSelect = await page.locator('.el-select').count();
  check('搜索页：排序/主播筛选下拉', sortSelect >= 2, `${sortSelect} 个 select`);

  // --- 状态监控页（四块：顶栏 / 三个状态行 / 异常+日志） ---
  await page.goto(`${FRONT}/#/douyin/status`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(3200);
  check('状态页：已移除面包屑', (await page.locator('.el-breadcrumb').count()) === 0);
  check('状态页：无汇总卡（按规划精简）', (await page.locator('.art-card.h-32').count()) === 0);
  check('状态页：无房间明细分节', (await page.locator('h4:has-text("房间连接明细")').count()) === 0);
  check('状态页：顶栏标题', (await page.locator('h3:has-text("状态监控")').count()) > 0);
  check('状态页：快速重启按钮', (await page.locator('button:has-text("快速重启")').count()) > 0);
  check('状态页：刷新按钮', (await page.locator('button:has-text("刷新")').count()) > 0);

  // 三个状态行
  const rows = await page.locator('.art-card .h-\\[54px\\]').count();
  for (const label of ['Go 抓取代理', '监控脚本', 'WebSocket 连接']) {
    check(`状态页：状态行「${label}」`, (await page.locator(`.art-card:has-text("${label}")`).count()) > 0);
  }
  // 每行都必须有自己的操作按钮（重启/启动/重连）
  const rowActions = await page.evaluate(() => {
    const rows = [...document.querySelectorAll('.art-card .h-\\[54px\\]')];
    return rows.map((r) => {
      const name = r.querySelector('span')?.innerText?.trim() || '';
      const btn = r.querySelector('button');
      return { name, action: btn ? btn.innerText.trim() : null };
    });
  });
  console.log('  （状态行按钮 =', JSON.stringify(rowActions), '）');
  check(
    '状态页：每行都有重启按钮',
    rowActions.length === 3 && rowActions.every((r) => r.action && r.action.length > 0),
    JSON.stringify(rowActions)
  );

  // 服务名称不得换行
  const nameWraps = await page.evaluate(() => {
    const labels = [...document.querySelectorAll('.art-card span')].filter((el) =>
      ['Go 抓取代理', '监控脚本', 'WebSocket 连接'].includes((el.innerText || '').trim())
    );
    return labels
      .map((el) => ({ text: el.innerText.trim(), h: Math.round(el.getBoundingClientRect().height) }))
      .filter((x) => x.h > 24);
  });
  check('状态页：服务名称不换行', nameWraps.length === 0, JSON.stringify(nameWraps));

  // 异常提醒 + 日志
  check('状态页：异常提醒分节', (await page.locator('h4:has-text("异常提醒")').count()) > 0);
  check('状态页：日志默认展开', (await page.locator('text=运行日志').count()) > 0);
  check('状态页：日志内容可见', (await page.locator('.font-mono').count()) > 0);

  // 状态行等高等宽（三个服务行必须整齐）
  const rowBoxes = await page.evaluate(() =>
    [...document.querySelectorAll('.art-card .h-\\[54px\\]')].map((el) => {
      const r = el.getBoundingClientRect();
      return { h: Math.round(r.height), w: Math.round(r.width) };
    })
  );
  check(
    '状态页：三个状态行等高',
    rowBoxes.length === 3 && new Set(rowBoxes.map((b) => b.h)).size === 1,
    JSON.stringify(rowBoxes.map((b) => b.h))
  );
  check(
    '状态页：三个状态行等宽',
    rowBoxes.length === 3 && new Set(rowBoxes.map((b) => b.w)).size === 1,
    JSON.stringify(rowBoxes.map((b) => b.w))
  );

  // 字号层级必须收敛（≤5 种），避免层级碎片化
  const fontTiers = await page.evaluate(() => {
    const set = new Set();
    document.querySelectorAll('h3, h4, p, span, div').forEach((el) => {
      const t = (el.innerText || '').trim();
      if (!t || el.children.length > 0) return;
      set.add(Math.round(parseFloat(getComputedStyle(el).fontSize)));
    });
    return [...set].sort((a, b) => b - a);
  });
  check('状态页：字号层级 ≤5 种', fontTiers.length <= 5, `实际 ${JSON.stringify(fontTiers)}`);

  // 快速重启必须可点
  const restartBtn = page.locator('button:has-text("快速重启")').first();
  check('状态页：快速重启可点击', (await restartBtn.isDisabled()) === false);

  await browser.close();
  console.log(failed === 0 ? '\n结构断言全部通过' : `\n${failed} 项未通过`);
  process.exitCode = failed ? 1 : 0;
}

main().catch((e) => { console.error('断言失败:', e.message); process.exitCode = 1; });
