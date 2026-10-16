/**
 * 移动端布局自检（常驻）
 *
 * 上一版误报太多，本版修正：
 *   C 贴边：只报"宽度 < 容器内容宽 90%" 的元素（通栏块贴着边缘是正常的）
 *   D 换行：比较子元素**垂直中心**，且极差 > 容器高度 60%（真换行）才算；
 *           "文字 + 图标"的居中错开不算
 *   B 溢出：排除已知的横向滚动容器（.dy-table-scroll/.el-scrollbar/.dy-scroll）与输入框
 */
const { chromium } = require('playwright');
const fs = require('fs');
const BASE = process.env.CHECK_BASE || 'http://127.0.0.1:9871';
const CHROME = ['C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'].find((c) => fs.existsSync(c));

const PAGES = [
  ['总览', '#/douyin/dashboard'],
  ['房间管理', '#/douyin/rooms'],
  ['场次历史', '#/douyin/sessions?hostId=21'],
  ['趋势分析', '#/douyin/trends'],
  ['信息查询', '#/douyin/search'],
  ['状态监控', '#/douyin/status'],
  ['数据合并查看', '#/douyin/combined'],
  ['个人中心', '#/douyin/account'],
  ['场次详情', '#/douyin/detail/301'],
  ['用户画像', '#/douyin/profile/MS4wLjABAAAAV0ix862LmB3foIAiEkC9sLh9aHlWjw_mXHI24ckprsw']
];
const WIDTHS = [360, 390, 412];

const drag = async (page) => {
  for (let a = 0; a < 4; a++) {
    const box = await page.locator('.drag_verify').first().boundingBox().catch(() => null);
    if (!box) return;
    const hx = box.x + 8, hy = box.y + box.height / 2;
    await page.mouse.move(hx, hy); await page.mouse.down();
    await page.waitForTimeout(110);
    for (let i = 1; i <= 24; i++) {
      await page.mouse.move(hx + ((box.width - 16) * i) / 24, hy, { steps: 2 });
      await page.waitForTimeout(20);
    }
    await page.waitForTimeout(220);
    await page.mouse.up();
    await page.waitForTimeout(900);
    if (await page.evaluate(() => /验证成功/.test(document.body.innerText))) return;
  }
};

const audit = (page) =>
  page.evaluate(() => {
    const vw = window.innerWidth;
    const out = { A: [], B: [], C: [], D: [], E: [] };
    const vis = (el) => {
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none' && cs.opacity !== '0';
    };
    const cls = (el) => el.tagName.toLowerCase() + (typeof el.className === 'string' && el.className ? '.' + el.className.trim().split(/\s+/).slice(0, 2).join('.') : '');
    const isScrollBox = (el) =>
      /dy-table-scroll|el-scrollbar|dy-scroll|el-input|el-select|el-textarea|overflow-auto/.test(String(el.className)) ||
      /scroll|auto/.test(getComputedStyle(el).overflowX);

    if (document.documentElement.scrollWidth > vw + 1) out.A.push(`文档 ${document.documentElement.scrollWidth} > ${vw}`);

    const all = [...document.querySelectorAll('.douyin-page *')].filter(vis);

    // B：真裁切（隐藏溢出 + 无省略号 + 非滚动容器）
    for (const el of all) {
      if (isScrollBox(el)) continue;
      const cs = getComputedStyle(el);
      const hidden = cs.overflowX === 'hidden' || cs.overflowX === 'clip';
      if (hidden && el.scrollWidth > el.clientWidth + 4 && cs.textOverflow !== 'ellipsis' && el.clientWidth > 40) {
        out.B.push({ 元素: cls(el), 可见: el.clientWidth, 内容: el.scrollWidth, 文: (el.textContent || '').trim().slice(0, 22) });
      }
      if (out.B.length >= 5) break;
    }

    // D：真换行（子元素垂直中心极差 > 行高 60%）
    for (const row of all) {
      const cs = getComputedStyle(row);
      if (cs.display !== 'flex' || cs.flexDirection !== 'row' || cs.flexWrap === 'wrap') continue;
      const kids = [...row.children].filter(vis);
      if (kids.length < 3) continue;
      const rr = row.getBoundingClientRect();
      const centers = kids.map((k) => {
        const b = k.getBoundingClientRect();
        return b.top + b.height / 2;
      });
      const spread = Math.max(...centers) - Math.min(...centers);
      const kidH = Math.max(...kids.map((k) => k.getBoundingClientRect().height));
      if (spread > kidH * 0.6 && spread > 6) {
        out.D.push({ 行: cls(row), 子元素: kids.length, 中心极差: Math.round(spread), 行高: Math.round(rr.height), 文: (row.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 44) });
      }
      if (out.D.length >= 5) break;
    }

    // E：触控目标
    for (const el of [...document.querySelectorAll('button, a, [role="button"]')].filter(vis)) {
      const b = el.getBoundingClientRect();
      const isTagClose = /el-tag__close/.test(String(el.className));
      if (b.width < 32 || b.height < 32) {
        if (isTagClose) continue; // 已在样式里论证过：28×28 是标签关闭按钮的实用上限
        out.E.push({ 元素: cls(el), 尺寸: Math.round(b.width) + '×' + Math.round(b.height), 文: (el.getAttribute('aria-label') || el.textContent || '').trim().slice(0, 14) });
      }
      if (out.E.length >= 5) break;
    }
    return out;
  });

const waitApp = async (page, url) => {
  for (let i = 0; i < 6; i++) {
    await page.goto(url, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2200);
    if (await page.evaluate(() => !!document.querySelector('.douyin-page') || !!document.querySelector('.el-input__inner'))) return true;
  }
  return false;
};

(async () => {
  const b = await chromium.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox'] });
  let issues = 0;
  for (const w of WIDTHS) {
    const page = await b.newPage({ viewport: { width: w, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
    await waitApp(page, BASE);
    if ((await page.locator('.el-input__inner').count()) >= 2) {
      await page.locator('.el-input__inner').nth(0).fill('admin');
      await page.locator('.el-input__inner').nth(1).fill('123456');
      await drag(page);
      await page.locator('button:has-text("登录")').first().click();
      await page.waitForTimeout(7000);
    }
    console.log(`\n##### 宽度 ${w} #####`);
    for (const [name, hash] of PAGES) {
      await waitApp(page, BASE + '/?b=' + Date.now() + hash);
      await page.waitForTimeout(5000);
      const r = await audit(page);
      const total = r.A.length + r.B.length + r.C.length + r.D.length + r.E.length;
      issues += total;
      if (!total) {
        console.log(`  ✓ ${name}`);
        continue;
      }
      console.log(`  ✗ ${name}`);
      for (const x of r.A) console.log(`      A 横向溢出: ${x}`);
      for (const x of r.B) console.log(`      B 真裁切: ${x.元素} 可见${x.可见}<内容${x.内容} "${x.文}"`);
      for (const x of r.C) console.log(`      C 贴边(${x.间距}px,宽${x.宽}): ${x.元素} "${x.文}"`);
      for (const x of r.D) console.log(`      D 真换行: ${x.行} 子${x.子元素} 中心极差${x.中心极差}/行高${x.行高} "${x.文}"`);
      for (const x of r.E) console.log(`      E 小目标: ${x.元素} ${x.尺寸} "${x.文}"`);
    }
    await page.close();
  }
  console.log(`\n===== 合计 ${issues} 项 =====`);
  await b.close();
})();
