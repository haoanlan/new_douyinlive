#!/usr/bin/env node
/**
 * 移动端巡检（窄屏布局体检）
 *
 * 为什么要有这个脚本：窄屏问题是"量出来的"，不是看出来的。
 * 已经踩过的坑：
 *   1) 卡片比顶部工作标签栏内缩 12px —— 页面横向 padding 被撑开，
 *      而项目里本就有 `.douyin-page.p-4 { padding-left/right: 0 }` 用来对齐标签栏；
 *   2) 场次卡片行的标题区被两个操作按钮挤到 70px，长标题只剩一个字；
 *   3) 顶栏图标 34px、小按钮 24px 高，手指点不准；
 *   4) 模板的引导气泡/设置浮件盖住内容。
 *
 * 检查项（每页 × 每种设备）：
 *   - 页面级横向溢出（文档宽 > 视口）
 *   - 被挤压文本：可见宽 < 60px 却需要 1.6 倍以上空间（"只剩一个字"的量化口径）
 *   - 左右边对齐：顶部标签栏 pill / 页面容器 / 卡片 三者的 left、right 是否一致
 *   - 触控目标：可点元素 < 32×28 的个数
 *   - 控制台错误
 *
 * 用法：node scripts/mobile-check.js [--quiet]
 * 退出码：0 = 全部通过；1 = 有失败项
 */
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const FRONT = process.env.MOBILE_CHECK_URL || 'http://127.0.0.1:5173';
const QUIET = process.argv.includes('--quiet');
const SHOT_DIR = path.join(ROOT, 'team', 'shots');
const CHROME = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe'
].find((c) => fs.existsSync(c));

const DEVICES = [
  { name: '手机', width: 390, height: 844, mobile: true },
  { name: '平板', width: 768, height: 1024, mobile: true }
];

const drag = async (page) => {
  for (let attempt = 0; attempt < 4; attempt++) {
    const box = await page.locator('.drag_verify').first().boundingBox().catch(() => null);
    if (!box) return;
    const hx = box.x + 10;
    const hy = box.y + box.height / 2;
    await page.mouse.move(hx, hy);
    await page.mouse.down();
    await page.waitForTimeout(120);
    for (let i = 1; i <= 24; i++) {
      await page.mouse.move(hx + ((box.width - 20) * i) / 24, hy + (i % 3 === 0 ? 1 : 0), { steps: 3 });
      await page.waitForTimeout(25);
    }
    await page.waitForTimeout(300);
    await page.mouse.up();
    await page.waitForTimeout(900);
    if (await page.evaluate(() => /验证成功/.test(document.body.innerText))) return;
  }
};

/** 单页体检 */
const diagnose = (page) =>
  page.evaluate(() => {
    const doc = document.documentElement;
    const page0 = document.querySelector('.douyin-page');
    const pageRect = page0 ? page0.getBoundingClientRect() : null;

    // 被挤压的文本
    const cramped = [];
    for (const el of document.querySelectorAll('.douyin-page *')) {
      if (el.children.length) continue;
      const text = (el.textContent || '').trim();
      if (text.length < 2) continue;
      const cs = getComputedStyle(el);
      if (cs.overflowX !== 'hidden' && cs.textOverflow !== 'ellipsis') continue;
      const r = el.getBoundingClientRect();
      if (r.width <= 0 || r.width > 60) continue;
      if (el.scrollWidth > r.width * 1.6 && el.scrollWidth > 30) {
        cramped.push(`${String(el.className).split(' ')[0]} ${Math.round(r.width)}px/需${el.scrollWidth}px "${text.slice(0, 12)}"`);
      }
    }

    // 触控目标
    //
    // 口径分两层，避免为了凑数字把界面撑变形：
    //   - 硬失败：< 24×24（WCAG 2.5.8 Target Size (Minimum) AA 的下限）
    //   - 告警：  < 32×28（我们自己的目标值：主要控件 32–44px）
    // 内嵌在文字行里的小图标触发器（例如"查询结果说明"）做到 28×28 就到实用上限，
    // 再大就会把行高撑开；它属于次要入口，只告警。
    const smallTaps = [];
    const warnTaps = [];
    for (const el of document.querySelectorAll('.douyin-page button, .douyin-page a, .douyin-page [class*="c-p"]')) {
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      if (r.width < 2 || r.height < 2 || cs.display === 'none' || cs.visibility === 'hidden') continue;
      const label = `${el.tagName.toLowerCase()}.${String(el.className).split(' ')[0]} ${Math.round(r.width)}×${Math.round(r.height)}`;
      if (r.width < 24 || r.height < 24) smallTaps.push(label);
      else if (r.width < 32 || r.height < 28) warnTaps.push(label);
    }

    // 对齐：标签栏容器 / 卡片最外缘 / 页面容器
    //
    // 注意两个坑（第一版都误报过）：
    //   1) 不能用 #scroll-li-0 的左边界 —— 标签栏会 translateX 滚到当前标签，
    //      第一个 pill 常常被滚到屏幕左侧之外（实测 left=-327），那是设计行为；
    //      要量的是标签栏的**容器**（ul 的父级，overflow:hidden 那层）。
    //   2) 不能拿"第一张卡"的 right 和页面 right 比 —— 汇总卡是 el-col 多列网格，
    //      第一张卡的右边界天然在行中间。要比的是该层卡片的**最外缘**（min left / max right）。
    const li = document.querySelector('#scroll-li-0');
    const tabWrap = li?.closest('ul')?.parentElement ?? null;
    const rOf = (el) => (el ? el.getBoundingClientRect() : null);
    const tabR = rOf(tabWrap);

    const blocks = [];
    for (const el of document.querySelectorAll('.douyin-page .art-card, .douyin-page .dy-toolbar')) {
      const r = el.getBoundingClientRect();
      if (r.width < 40 || r.height < 20) continue;
      // 只看顶层块，避免把卡片内部的子卡也统计进来
      if (el.parentElement?.closest('.art-card')) continue;
      blocks.push({ left: r.left, right: r.right });
    }

    const alignIssues = [];
    if (tabR && pageRect && Math.abs(tabR.left - pageRect.left) > 2) {
      alignIssues.push(`标签栏 left=${Math.round(tabR.left)} vs 页面 left=${Math.round(pageRect.left)}`);
    }
    if (blocks.length && pageRect) {
      const minL = Math.min(...blocks.map((b) => b.left));
      const maxR = Math.max(...blocks.map((b) => b.right));
      if (Math.abs(minL - pageRect.left) > 2) {
        alignIssues.push(`卡片左缘=${Math.round(minL)} vs 页面 left=${Math.round(pageRect.left)}`);
      }
      if (Math.abs(maxR - pageRect.right) > 2) {
        alignIssues.push(`卡片右缘=${Math.round(maxR)} vs 页面 right=${Math.round(pageRect.right)}`);
      }
    }

    return {
      docWidth: doc.scrollWidth,
      viewport: window.innerWidth,
      screens: Math.round((doc.scrollHeight / window.innerHeight) * 10) / 10,
      cramped: cramped.slice(0, 4),
      crampedCount: cramped.length,
      smallTaps: [...new Set(smallTaps)].slice(0, 4),
      smallTapCount: smallTaps.length,
      warnTaps: [...new Set(warnTaps)].slice(0, 4),
      warnTapCount: warnTaps.length,
      alignIssues
    };
  });

(async () => {
  const Database = require('better-sqlite3');
  const db = new Database(path.join(ROOT, 'db', 'douyin.db'), { readonly: true });
  const host = db
    .prepare('SELECT streamer_id FROM sessions GROUP BY streamer_id ORDER BY COUNT(*) DESC LIMIT 1')
    .get();
  const sid = db.prepare('SELECT id FROM sessions ORDER BY id DESC LIMIT 1').get()?.id;
  const sec = db
    .prepare("SELECT user_sec_uid FROM danmaku WHERE user_sec_uid != '' ORDER BY create_time DESC LIMIT 1")
    .get()?.user_sec_uid;

  const routes = [
    ['总览', '#/douyin/dashboard'],
    ['房间管理', '#/douyin/rooms'],
    ['场次列表', `#/douyin/sessions?hostId=${host?.streamer_id ?? ''}`],
    ['趋势分析', '#/douyin/trends'],
    ['信息查询', '#/douyin/search'],
    ['状态监控', '#/douyin/status'],
    ['个人中心', '#/douyin/account'],
    ['用户管理', '#/account/users'],
    ['场次详情', `#/douyin/detail/${sid}`],
    ['用户画像', `#/douyin/profile/${sec}`]
  ];

  const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox'] });
  let failures = 0;

  for (const dev of DEVICES) {
    const ctx = await browser.newContext({
      viewport: { width: dev.width, height: dev.height },
      isMobile: dev.mobile,
      hasTouch: dev.mobile,
      deviceScaleFactor: 1
    });
    const page = await ctx.newPage();
    const errs = [];
    page.on('pageerror', (e) => errs.push(e.message.slice(0, 100)));

    await page.goto(FRONT, { waitUntil: 'networkidle', timeout: 60000 });
    await page.waitForTimeout(2500);
    const inputs = page.locator('.el-input__inner');
    if ((await inputs.count()) >= 2) {
      await inputs.nth(0).fill('admin');
      await inputs.nth(1).fill('123456');
      await drag(page);
      await page.locator('button:has-text("登录")').first().click();
      await page.waitForTimeout(5000);
    }

    if (!QUIET) console.log(`\n===== ${dev.name} ${dev.width}×${dev.height} =====`);
    for (const [name, hash] of routes) {
      errs.length = 0;
      await page.goto(`${FRONT}/${hash}`, { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(6000);
      const d = await diagnose(page);
      const bad =
        d.docWidth > d.viewport + 2 || d.crampedCount > 0 || d.smallTapCount > 0 || d.alignIssues.length > 0 || errs.length > 0;
      if (bad) failures++;
      // 有告警也打印出来（否则 24–31px 的触控目标会静默消失）
      if (!QUIET || bad || d.warnTapCount > 0) {
        console.log(
          `  ${bad ? 'FAIL' : 'PASS'} ${name.padEnd(8)} ${String(d.screens).padStart(4)}屏 溢出=${Math.max(0, d.docWidth - d.viewport)} ` +
            `被挤=${d.crampedCount} 小点击区=${d.smallTapCount} 触控告警=${d.warnTapCount} 对齐问题=${d.alignIssues.length} 错误=${errs.length}`
        );
        for (const c of d.cramped) console.log(`        被挤: ${c}`);
        for (const s of d.smallTaps) console.log(`        小点击区(FAIL): ${s}`);
        for (const s of d.warnTaps) console.log(`        触控告警(24–31px): ${s}`);
        for (const a of d.alignIssues) console.log(`        对齐: ${a}`);
        for (const e of errs.slice(0, 2)) console.log(`        错误: ${e}`);
        if (bad && fs.existsSync(SHOT_DIR)) {
          await page.screenshot({ path: path.join(SHOT_DIR, `mobile-check-${dev.name}-${name}.png`) });
        }
      }
    }
    await ctx.close();
  }

  await browser.close();
  console.log(failures ? `\n移动端巡检：${failures} 项未通过` : '\n移动端巡检：全部通过');
  process.exit(failures ? 1 : 0);
})();
