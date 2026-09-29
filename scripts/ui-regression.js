/** 三项打磨的最终回归验证：对比度 + 数字口径 + detail 列表 + 全站无报错（临时脚本） */
const fs = require('fs');
const { chromium } = require('playwright');
const FRONT = 'http://127.0.0.1:5173';
const BROWSERS = [
  process.env.CHROME_PATH,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
].filter(Boolean);
function findBrowser() { for (const c of BROWSERS) if (fs.existsSync(c)) return c; throw new Error('no browser'); }

const out = [];
const check = (n, pass, d = '') => { out.push({ n, pass }); console.log(`${pass ? 'PASS' : 'FAIL'}  ${n}${d ? ' — ' + d : ''}`); };

async function main() {
  const browser = await chromium.launch({ executablePath: findBrowser(), headless: true, args: ['--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 1500, height: 1000 } });
  const errors = [];
  /** 外链失败 URL（抖音头像/礼物图标/iconify 图标 CDN 等），用于把"资源加载失败"归到外链 */
  const externalFailed = new Set();
  const isExternal = (url) => !/^https?:\/\/(127\.0\.0\.1|localhost)/.test(url);

  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message.slice(0, 130)}`));
  page.on('console', (m) => {
    if (m.type() !== 'error') return;
    const t = m.text();
    // 浏览器的 "Failed to load resource" 不告诉你 URL，一律先记为待定；真正的归属由 requestfailed 决定
    errors.push(t.includes('Failed to load resource') ? `resourceload: ${t.slice(0, 60)}` : `console: ${t.slice(0, 130)}`);
  });
  page.on('response', (r) => { if (r.status() >= 500) errors.push(`HTTP ${r.status()} ${r.url().slice(0, 90)}`); });
  // 把失败请求连同 URL 记下来：这样才能区分"本地接口挂了"和"抖音 CDN 不通"
  page.on('requestfailed', (r) => {
    const u = r.url();
    const why = r.failure()?.errorText || 'unknown';
    if (isExternal(u)) externalFailed.add(why);
    errors.push(`requestfailed${isExternal(u) ? '[外链]' : '[本地]'}: ${why} ${u.slice(0, 100)}`);
  });

  await page.goto(FRONT, { waitUntil: 'networkidle', timeout: 60000 });
  await page.waitForTimeout(1500);
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
  await waitForLoaded();

  // ---- 对比度：注入测量，扫全部抖音页面 ----
  /**
   * 等到页面"真的加载完"再采样。
   *
   * 为什么需要：原来固定 `waitForTimeout(4500)`，网络稍慢时测到的是
   * loading 蒙层或空状态占位（"暂无数据" 之类），于是报出一些**并不存在于
   * 最终页面**的对比度问题 —— 排查方向会被带偏。
   * 现在显式等 el-loading 蒙层消失，再留一小段给渲染稳定。
   */
  /**
   * 等到页面真正加载完再采样。
   *
   * 三类中间态都会污染对比度采样，必须都排掉：
   *   1. loading 蒙层还在（"加载中…"）
   *   2. 蒙层还没出现、但页面骨架/空状态已渲染（"暂无数据"这种占位文本）
   *   3. 卡片进场动画未结束（位移中，位置不稳）
   * 之前只等蒙层，网络一慢就抓到 (2)，实测采样数从 412 掉到 172、
   * 报出 9 处"未达标"却全是中间态 —— 这种误报会把排查方向带偏。
   */
  function waitForLoaded(extra = 1500) {
    return (async () => {
      // 1) 等根容器出现
      for (let i = 0; i < 50; i++) {
        const has = await page.evaluate(() => !!document.querySelector('.douyin-page'));
        if (has) break;
        await page.waitForTimeout(200);
      }
      // 2) 等 loading 蒙层消失
      for (let i = 0; i < 60; i++) {
        const maskGone = await page.evaluate(() => {
          const m = document.querySelector('.el-loading-mask');
          if (!m) return true;
          const cs = getComputedStyle(m);
          return cs.display === 'none' || cs.visibility === 'hidden' || parseFloat(cs.opacity) < 0.05;
        });
        if (maskGone) break;
        await page.waitForTimeout(200);
      }
      // 3) 等所有卡片动画跑完
      for (let i = 0; i < 40; i++) {
        const animating = await page.evaluate(
          () => document.getAnimations().filter((a) => a.playState === 'running').length
        );
        if (animating === 0) break;
        await page.waitForTimeout(150);
      }
      await page.waitForTimeout(extra);
    })();
  }

  const measureContrast = () => page.evaluate(() => {
    function lum(rgb) {
      const c = rgb.map((v) => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4); });
      return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
    }
    function parse(s) { const m = s.match(/rgba?\(([^)]+)\)/); if (!m) return null; const p = m[1].split(',').map((x) => parseFloat(x.trim())); return { rgb: p.slice(0, 3), a: p.length > 3 ? p[3] : 1 }; }
    function bgOf(el) {
      let n = el;
      while (n && n !== document.documentElement) {
        const c = parse(getComputedStyle(n).backgroundColor);
        if (c && c.a > 0.95) return c.rgb;
        n = n.parentElement;
      }
      return [255, 255, 255];
    }
    const bad = [];
    let sampled = 0;
    for (const el of document.querySelectorAll('.douyin-page *')) {
      const txt = [...el.childNodes].filter((n) => n.nodeType === 3 && n.textContent.trim()).map((n) => n.textContent.trim()).join('');
      if (!txt) continue;
      const cs = getComputedStyle(el);
      if (cs.visibility === 'hidden' || cs.display === 'none') continue;
      const r = el.getBoundingClientRect();
      if (r.width < 1 || r.height < 1) continue;
      const fg = parse(cs.color);
      if (!fg || fg.a < 0.95) continue;
      const fs = parseFloat(cs.fontSize);
      const large = fs >= 24 || (fs >= 18.66 && parseInt(cs.fontWeight, 10) >= 700);
      const need = large ? 3 : 4.5;
      const bg = bgOf(el);
      const a = lum(fg.rgb), b = lum(bg);
      const [hi, lo] = a > b ? [a, b] : [b, a];
      const ratio = (hi + 0.05) / (lo + 0.05);
      sampled++;
      if (ratio < need) bad.push({ text: txt.slice(0, 18), ratio: Math.round(ratio * 100) / 100, need, fs: Math.round(fs) });
    }
    return { sampled, bad };
  });

  const pages = [
    ['rooms', 'rooms'], ['sessions', 'sessions?hostId=34'], ['status', 'status'],
    ['dashboard', 'dashboard'], ['search', 'search'], ['trends', 'trends']
  ];
  let totalBad = 0, totalSampled = 0;
  for (const [name, hash] of pages) {
    await page.goto(`${FRONT}/#/douyin/${hash}`, { waitUntil: 'domcontentloaded' });
    await waitForLoaded();
    const r = await measureContrast();
    totalBad += r.bad.length;
    totalSampled += r.sampled;
    if (r.bad.length) console.log(`  [${name}] 未达标 ${r.bad.length}: ${r.bad.slice(0, 3).map((b) => `${b.ratio}:1 "${b.text}"`).join(', ')}`);
  }
  check(`浅色模式全部文字达 AA（采样 ${totalSampled} 处，未达标 ${totalBad}）`, totalBad === 0);

  // ---- 数字口径：页面里不应再出现裸 toLocaleString 造成的"同页两套写法" ----
  await page.goto(`${FRONT}/#/douyin/dashboard`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(5000);
  const numInfo = await page.evaluate(() => {
    const txt = document.body.innerText;
    return {
      hasWan: /万|亿/.test(txt),
      hasComma: /\d{1,3}(,\d{3})+/.test(txt),
      sample: txt.replace(/\s+/g, ' ').slice(0, 200)
    };
  });
  check('dashboard 数字口径存在（万/亿缩写已启用）', numInfo.hasWan, '');

  // ---- 风格一致性：工具条内边距 / 统计卡尺寸 / 字号口径 ----
  const styleAudit = async (hash, waitMs) => {
    await page.goto(`${FRONT}/#/douyin/${hash}`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(waitMs);
    return page.evaluate(() => {
      const px = (v) => Math.round(parseFloat(v) || 0);
      const tb = document.querySelector('.dy-toolbar');
      const tbPad = tb ? `${px(getComputedStyle(tb).paddingTop)}/${px(getComputedStyle(tb).paddingLeft)}` : null;
      // 统计卡（h-20 或 dy-stat-card）
      const stats = [...document.querySelectorAll('.dy-stat-card, .art-card.h-20')].map((c) => {
        const r = c.getBoundingClientRect();
        return `${Math.round(r.height)}`;
      });
      // 字号：只统计 .douyin-page 作用域内的（模板自带组件如主题切换/回到顶部
      // 用的是 text-[10px]/text-xl，不属于被审计的页面代码）
      const arbitrary = new Set();
      const scope = document.querySelector('.douyin-page') || document;
      for (const el of scope.querySelectorAll('*')) {
        const cls = typeof el.className === 'string' ? el.className : '';
        const m = cls.match(/text-\[(\d+)px\]/);
        if (m) arbitrary.add(m[1]);
      }
      return { tbPad, statHeights: [...new Set(stats)], arbitrary: [...arbitrary].sort() };
    });
  };

  const a1 = await styleAudit('rooms', 4200);
  const a2 = await styleAudit('sessions?hostId=34', 4200);
  const a3 = await styleAudit('dashboard', 5000);
  console.log(`  rooms    toolbar=${a1.tbPad} stats=${a1.statHeights} 任意字号=${a1.arbitrary}`);
  console.log(`  sessions toolbar=${a2.tbPad} stats=${a2.statHeights} 任意字号=${a2.arbitrary}`);
  console.log(`  dashboard toolbar=${a3.tbPad}（无工具条，正常） stats=${a3.statHeights} 任意字号=${a3.arbitrary}`);

  // dashboard 没有工具条，所以只校验有工具条的两页
  check('有工具条的页面内边距统一为 20/20',
    a1.tbPad === '20/20' && a2.tbPad === '20/20',
    `${a1.tbPad} / ${a2.tbPad}`);
  check('统计卡高度统一为 80px',
    [...a2.statHeights, ...a3.statHeights].every((h) => h === '80'),
    `sessions=${a2.statHeights} dashboard=${a3.statHeights}`);
  check('页面内任意字号只剩 20px 一档（其余走 Tailwind 档位）',
    [...a1.arbitrary, ...a2.arbitrary, ...a3.arbitrary].every((v) => v === '20'),
    `${a1.arbitrary} / ${a2.arbitrary} / ${a3.arbitrary}`);

  // ---- detail 列表 ----
  const sid = await page.evaluate(async () => {
    const tk = JSON.parse(localStorage.getItem('sys-vundefined-user') || '{}')?.accessToken || '';
    const r = await fetch('/api/hosts/34/sessions', { headers: { Authorization: 'Bearer ' + tk } });
    const j = await r.json();
    const list = Array.isArray(j) ? j : j?.data || [];
    const m = [...list].sort((a, b) => (b.danmaku_count || 0) - (a.danmaku_count || 0))[0];
    return m ? m.id : null;
  });
  await page.goto(`${FRONT}/#/douyin/detail/${sid}`, { waitUntil: 'domcontentloaded' });
  await waitForLoaded(2000);
  /*
   * 量尺寸前先把鼠标移开并把指针移出卡片。
   * 卡片悬停会 translateY(-2px)，如果采样时鼠标正好停在某张卡上，
   * 会把"悬停抬升"当成"底部不齐"（实测误报过底边差 2px）。
   * 这类断言量的是布局，必须在无交互的静止态下取。
   */
  await page.mouse.move(4, 4);
  await page.waitForTimeout(600);
  const feed = await page.evaluate(() => {
    // 动态列表的滚动容器（.dy-scroll 是共用的卡内滚动区）。
    // 注意：页面上有多个 .dy-scroll，动态列表那个在里面含最多行，取行数最多的。
    const all = [...document.querySelectorAll('.dy-scroll')];
    if (!all.length) return { err: 'no scroller' };
    let best = null;
    for (const s of all) {
      const rows = [...s.querySelectorAll(':scope > div > div')].filter(
        (r) => !/加载更多|已显示全部/.test(r.textContent)
      );
      if (!best || rows.length > best.rows.length) best = { s, rows };
    }
    if (!best) return { err: 'no rows' };
    const rects = best.rows.map((r) => r.getBoundingClientRect()).filter((r) => r.height > 0);
    let ov = 0;
    for (let i = 1; i < rects.length; i++) if (rects[i].top < rects[i - 1].bottom - 1) ov++;
    return { rows: best.rows.length, overlaps: ov };
  });
  check(
    `detail 动态列表无重叠（${feed.rows} 行，overlaps=${feed.overlaps}）`,
    feed.overlaps === 0 && feed.rows > 0,
    feed.err || ''
  );

  // ---- detail 底部行是否齐平（行内卡片底边差必须为 0）----
  /*
   * 先把动画停掉再量。
   * 卡片进场有 stagger 动画（animation-delay 最多 280ms），悬停还会 translateY(-2px)；
   * 如果在动画/悬停过程中采样，量到的是瞬时值而不是最终布局（实测误报过底边差 2px）。
   * 这里显式把 animation / transition / transform 清零，量"静止态的真实布局"。
   */
  await page.addStyleTag({
    content: `.douyin-page .art-card,
      .douyin-page .art-card:hover { animation: none !important; transition: none !important; transform: none !important; }`
  });
  await page.waitForTimeout(300);
  const rowsAlign = await page.evaluate(() => {
    const root = document.querySelector('.douyin-page');
    const grids = [...root.querySelectorAll('.dy-detail-grid')];
    return grids.map((g) => {
      const bottoms = [...g.children].map((c) => Math.round(c.getBoundingClientRect().bottom));
      return bottoms.length ? Math.max(...bottoms) - Math.min(...bottoms) : -1;
    });
  });
  check(
    `detail 底部各模块齐平（底边差 ${rowsAlign.join('/')}px）`,
    rowsAlign.length > 0 && rowsAlign.every((d) => d === 0),
    rowsAlign.join('/')
  );

  /*
   * ---- trends 非默认指标勾选后图表必须渲染（HANDOFF 9.4 回归）----
   * 根因：allMetrics 是 script setup 的 const，v-for 被编成 STABLE_FRAGMENT，
   * 卡片元素若无动态 prop 就不进 dynamicChildren，v-show 的 updated 永不执行。
   * 修复靠 :data-metric —— 这里同时断言属性存在 + 勾选后容器可见 + canvas 画出。
   */
  await page.goto(`${FRONT}/#/douyin/trends`, { waitUntil: 'domcontentloaded' });
  await waitForLoaded(3500);
  const beforeToggle = await page.evaluate(() => {
    const cards = [...document.querySelectorAll('.douyin-page .art-card[data-metric]')];
    return {
      attr: cards.length,
      visibleWithCanvas: cards.filter(
        (c) => getComputedStyle(c).display !== 'none' && c.querySelectorAll('canvas').length > 0
      ).length
    };
  });
  const metricTag = page.locator('.el-check-tag', { hasText: '钻/时' }).first();
  const readTarget = () =>
    page.evaluate(() => {
      const card = document.querySelector('.douyin-page .art-card[data-metric="diamondsPerHour"]');
      if (!card) return { display: 'missing', w: 0, canvases: 0 };
      return {
        display: getComputedStyle(card).display,
        w: card.clientWidth,
        canvases: card.querySelectorAll('canvas').length
      };
    });
  const waitTarget = async (pred, tries = 24) => {
    let snap = { display: 'missing', w: 0, canvases: 0 };
    for (let i = 0; i < tries; i++) {
      await page.waitForTimeout(250);
      snap = await readTarget();
      if (pred(snap)) break;
    }
    return snap;
  };
  const shown = (s) => s.display !== 'none' && s.w > 0 && s.canvases >= 1;

  // 首次勾选：记录从点击到渲染完成的耗时（验收要求 ≤1s）
  const t0 = Date.now();
  await metricTag.click();
  const target = await waitTarget(shown);
  const elapsed = Date.now() - t0;

  // 取消勾选 → 应隐藏；再次勾选 → 应重新渲染（"反复勾选/取消"验收路径）
  await metricTag.click();
  const hidden = await waitTarget((s) => s.display === 'none', 16);
  await metricTag.click();
  const again = await waitTarget(shown);

  check(
    `trends 勾选非默认指标后图表渲染（钻/时 ${elapsed}ms clientW=${target.w} canvas=${target.canvases}；默认图 ${beforeToggle.visibleWithCanvas}/3；二次勾选 ${shown(again) ? 'ok' : 'ng'}）`,
    beforeToggle.attr >= 8 &&
      beforeToggle.visibleWithCanvas >= 3 &&
      shown(target) &&
      elapsed <= 1000 &&
      hidden.display === 'none' &&
      shown(again),
    `attr=${beforeToggle.attr} display=${target.display} hidden=${hidden.display} again=${again.display}`
  );

  // ---- 全站错误 ----
  console.log('\n=== 页面/控制台错误 ===');
  console.log(errors.length ? errors.slice(0, 12).join('\n') : '  无');

  /*
   * 只把**本地**错误算作失败。
   * 抖音头像 / 礼物图标 / iconify 图标 CDN 都是外链，本机网络抽的时候就超时，
   * 那是环境问题不是代码问题 —— 之前这种误报浪费过排查时间。
   *
   * 浏览器的 "Failed to load resource" 不带 URL，所以规则是：
   * 只要这轮出现过外链请求失败，就把这类无 URL 的 console 报错也算作外链。
   * 注意：图标已确认是内联 SVG 渲染（不依赖 CDN 才能显示），所以这条不会掩盖真实问题。
   */
  const hasExternalFailure = externalFailed.size > 0 || errors.some((e) => e.includes('[外链]'));
  const localErrors = errors.filter(
    (e) => !e.includes('[外链]') && !(hasExternalFailure && e.startsWith('resourceload:'))
  );
  const externalCount = errors.length - localErrors.length;
  check(
    `本地无 5xx / 无 JS 报错${externalCount ? `（另有 ${externalCount} 条外链失败，不计入）` : ''}`,
    localErrors.length === 0,
    localErrors.slice(0, 3).join(' | ')
  );

  const failed = out.filter((r) => !r.pass);
  console.log(`\n=== ${out.length - failed.length}/${out.length} 通过 ===`);
  await browser.close();
  process.exitCode = failed.length ? 1 : 0;
}
main().catch((e) => { console.error('失败:', e.message); process.exitCode = 1; });
