/**
 * 排版 / 布局 / 动效 / 跳转 的运行时体检（DOM 量化，不出图，省 token）。
 *
 * 用法：node scripts/ui-audit-layout.js [--json]
 *   前置：三个服务在跑（1088 / 9871 / 5173）；需要放宽沙箱（Chrome 走 named pipe）。
 *
 * 覆盖：
 *  A. 每页：横向溢出与越界元素、点按目标尺寸、字号档位、无尺寸图片、
 *     加载过程中的 body 高度跳动（CLS 代理指标）、正在运行的动画、
 *     控制台报错、document.title、滚动容器识别
 *  B. 路由切换：keepAlive 页之间的过渡是否存在（动画数量/名称）
 *  C. keep-alive：筛选词、滚动位置在「离开→返回」后是否保留
 *  D. 浏览器后退：hash/滚动是否恢复
 *  E. 路由切换后的焦点归属（document.activeElement）
 *  F. prefers-reduced-motion: reduce 下动画是否归零
 */
const { chromium } = require('playwright');
const { resolveChromium } = require('../lib/browser-path');

const FRONT = process.env.CHECK_FRONT || 'http://127.0.0.1:5173';
const API = process.env.CHECK_API || 'http://127.0.0.1:9871';
const VIEWPORT = { width: 1500, height: 950 };

const ROUTES = [
  ['douyin/dashboard', '概览'],
  ['douyin/rooms', '房间管理'],
  ['douyin/sessions', '场次历史'],
  ['douyin/trends', '趋势分析'],
  ['douyin/search', '信息查询'],
  ['douyin/status', '状态监控']
];

/* ---------------- 工具 ---------------- */

async function apiLogin() {
  const res = await fetch(`${API}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ userName: 'admin', password: '123456' })
  });
  if (!res.ok) throw new Error(`登录失败 ${res.status}`);
  return (await res.json()).token;
}

async function apiGet(token, path) {
  const res = await fetch(`${API}${path}`, { headers: { authorization: `Bearer ${token}` } });
  if (!res.ok) return null;
  return res.json();
}

function firstId(payload, keys) {
  const list = Array.isArray(payload) ? payload : (payload && (payload.list || payload.data || payload.items)) || [];
  for (const row of list) {
    for (const k of keys) if (row && row[k] != null && row[k] !== '') return row[k];
  }
  return null;
}

async function uiLogin(page) {
  await page.goto(FRONT, { waitUntil: 'networkidle', timeout: 60000 });
  await page.waitForTimeout(1000);
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
    await page.waitForTimeout(300);
  }
  await page.locator('button:has-text("登录")').first().click().catch(() => {});
  for (let i = 0; i < 60; i++) {
    if (await page.evaluate(() => !!document.querySelector('.douyin-page'))) return true;
    await page.waitForTimeout(200);
  }
  return false;
}

async function gotoHash(page, route) {
  await page.evaluate((r) => {
    location.hash = `#/${r}`;
  }, route);
  await page.waitForTimeout(120);
}

async function settle(page) {
  for (let i = 0; i < 60; i++) {
    if (await page.evaluate(() => !!document.querySelector('.douyin-page'))) break;
    await page.waitForTimeout(150);
  }
  for (let i = 0; i < 50; i++) {
    const busy = await page.evaluate(() => {
      const m = document.querySelector('.el-loading-mask');
      if (!m) return false;
      const cs = getComputedStyle(m);
      return cs.display !== 'none' && cs.visibility !== 'hidden' && parseFloat(cs.opacity) > 0.05;
    });
    if (!busy) break;
    await page.waitForTimeout(150);
  }
  for (let i = 0; i < 40; i++) {
    const n = await page.evaluate(() => document.getAnimations().filter((a) => a.playState === 'running').length);
    if (n === 0) break;
    await page.waitForTimeout(120);
  }
  await page.mouse.move(3, 3);
  await page.waitForTimeout(250);
}

/* ---------------- 页面探针 ---------------- */

const PROBE = () => {
  const vis = (el) => {
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden' || parseFloat(cs.opacity) < 0.05) return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  };
  const desc = (el) => {
    const cls = String(el.className || '').split(/\s+/).filter(Boolean).slice(0, 3).join('.');
    return `${el.tagName.toLowerCase()}${cls ? '.' + cls : ''}`;
  };
  const vw = window.innerWidth;
  const doc = document.documentElement;

  // 1) 横向溢出
  const offenders = [];
  for (const el of document.querySelectorAll('body *')) {
    if (!vis(el)) continue;
    const cs = getComputedStyle(el);
    if (cs.position === 'fixed') continue;
    const r = el.getBoundingClientRect();
    if (r.right > vw + 1 || r.left < -1) {
      if (el.closest('.overflow-auto, [class*="overflow-x"]')) continue;
      offenders.push({
        el: desc(el),
        left: Math.round(r.left),
        right: Math.round(r.right),
        w: Math.round(r.width),
        text: (el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 28)
      });
    }
    if (offenders.length >= 8) break;
  }

  // 2) 点按目标（WCAG 2.5.8：≥24×24）
  const tiny = [];
  for (const el of document.querySelectorAll('button, a, [role="button"], .el-check-tag, .el-switch, .el-radio-button__inner')) {
    if (!vis(el)) continue;
    const r = el.getBoundingClientRect();
    if (r.width < 24 || r.height < 24) {
      tiny.push({
        el: desc(el),
        w: Math.round(r.width),
        h: Math.round(r.height),
        aria: el.getAttribute('aria-label') || '',
        text: (el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 20)
      });
    }
    if (tiny.length >= 10) break;
  }

  // 3) 字号档位
  const fonts = {};
  for (const el of document.querySelectorAll('.douyin-page *')) {
    if (!vis(el)) continue;
    if (!(el.textContent || '').trim()) continue;
    const fs = getComputedStyle(el).fontSize;
    fonts[fs] = (fonts[fs] || 0) + 1;
  }

  // 4) 无尺寸图片
  const imgs = [...document.images].filter((im) => {
    const hasAttr = im.getAttribute('width') || im.getAttribute('height') || im.style.aspectRatio;
    return !hasAttr && im.naturalWidth > 0;
  });

  // 5) 滚动容器
  const scrollers = [];
  for (const el of document.querySelectorAll('.douyin-page *')) {
    const cs = getComputedStyle(el);
    if ((cs.overflowY === 'auto' || cs.overflowY === 'scroll') && el.scrollHeight > el.clientHeight + 4) {
      scrollers.push({ el: desc(el), clientH: el.clientHeight, scrollH: el.scrollHeight });
    }
    if (scrollers.length >= 5) break;
  }

  // 6) 运行中的动画
  const anims = document
    .getAnimations()
    .filter((a) => a.playState === 'running')
    .map((a) => {
      const t = a.effect && a.effect.getTiming ? a.effect.getTiming() : {};
      return { name: a.animationName || (a.transitionProperty ? `transition:${a.transitionProperty}` : 'anim'), ms: Math.round(t.duration || 0) };
    });

  return {
    hash: location.hash,
    title: document.title,
    docScrollW: doc.scrollWidth,
    innerW: vw,
    bodyH: document.body.scrollHeight,
    offenders,
    tiny,
    fonts,
    imgsNoSize: imgs.length,
    imgSample: imgs.slice(0, 2).map((i) => (i.currentSrc || i.src || '').slice(-40)),
    scrollers,
    anims,
    skeleton: !!document.querySelector('.el-skeleton, .el-skeleton__item'),
    emptyState: !!document.querySelector('.el-empty, .dy-empty'),
    errState: !!document.querySelector('.dy-query-error, .el-alert--error')
  };
};

/* ---------------- 主流程 ---------------- */

async function main() {
  const asJson = process.argv.includes('--json');
  const token = await apiLogin();
  const sessions = await apiGet(token, '/api/sessions');
  const streamers = await apiGet(token, '/api/streamers');
  const sid = firstId(sessions, ['id', 'session_id', 'sessionId']);
  const secUid = firstId(streamers, ['sec_uid', 'secUid']);
  if (!sid || !secUid) throw new Error(`缺少样例参数 sessionId=${sid} secUid=${secUid}`);
  const routes = [...ROUTES, [`douyin/detail/${sid}`, '场次详情'], [`douyin/profile/${secUid}`, '用户画像']];

  const exe = resolveChromium();
  const browser = await chromium.launch({
    executablePath: exe || undefined,
    headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage']
  });
  const out = { params: { sid, secUid, chrome: exe }, pages: [], nav: {}, keepAlive: {}, back: {}, reduced: {} };

  /* --- A. 逐页体检 --- */
  const ctx = await browser.newContext({ viewport: VIEWPORT });
  const page = await ctx.newPage();
  const consoleErrors = [];
  page.on('console', (m) => {
    if (m.type() === 'error') consoleErrors.push(m.text().slice(0, 160));
  });
  page.on('pageerror', (e) => consoleErrors.push('pageerror: ' + e.message.slice(0, 160)));
  await page.addInitScript(() => {
    window.__cls = 0;
    try {
      new PerformanceObserver((l) => {
        for (const e of l.getEntries()) if (!e.hadRecentInput) window.__cls += e.value;
      }).observe({ type: 'layout-shift', buffered: true });
    } catch {
      /* ignore */
    }
  });
  if (!(await uiLogin(page))) throw new Error('UI 登录失败');

  for (const [route, label] of routes) {
    consoleErrors.length = 0;
    const heights = [];
    await gotoHash(page, route);
    for (const t of [250, 700, 1500]) {
      await page.waitForTimeout(t === 250 ? 250 : 450);
      heights.push(await page.evaluate(() => document.body.scrollHeight));
    }
    await settle(page);
    const probe = await page.evaluate(PROBE);
    const cls = await page.evaluate(() => Math.round((window.__cls || 0) * 1000) / 1000);
    out.pages.push({
      route,
      label,
      ...probe,
      heights,
      loadJumpPx: Math.max(...heights) - Math.min(...heights),
      cls,
      consoleErrors: [...new Set(consoleErrors)].slice(0, 4)
    });
  }

  /* --- B. 路由切换动效（keepAlive 页之间） --- */
  await gotoHash(page, 'douyin/dashboard');
  await settle(page);
  const navProbe = async (from, to) => {
    await page.evaluate((r) => {
      location.hash = `#/${r}`;
    }, to);
    const frames = [];
    for (let i = 0; i < 6; i++) {
      await page.waitForTimeout(60);
      frames.push(
        await page.evaluate(() => {
          const views = [...document.querySelectorAll('.art-page-view')];
          return {
            views: views.length,
            anims: document.getAnimations().filter((a) => a.playState === 'running').map((a) => {
              const t = a.effect && a.effect.getTiming ? a.effect.getTiming() : {};
              return `${a.animationName || (a.transitionProperty ? 'tr:' + a.transitionProperty : '?')}@${Math.round(t.duration || 0)}`;
            }),
            opacity: views.map((v) => getComputedStyle(v).opacity)
          };
        })
      );
    }
    return { from, to, frames };
  };
  out.nav.keepAlivePair = await navProbe('douyin/dashboard', 'douyin/rooms'); // 两页都 keepAlive
  await settle(page);
  out.nav.toNonKeepAlive = await navProbe('douyin/rooms', 'douyin/search'); // 目标非 keepAlive
  await settle(page);
  out.nav.betweenNonKeepAlive = await navProbe('douyin/search', 'douyin/detail/' + sid);
  await settle(page);

  /* --- C. keep-alive：筛选词与滚动位置 --- */
  await gotoHash(page, 'douyin/rooms');
  await settle(page);
  const filterSel = 'input[placeholder*="筛选"], input[placeholder*="搜索"]';
  const hasFilter = await page.locator(filterSel).count();
  if (hasFilter) {
    await page.locator(filterSel).first().fill('林语');
    await page.waitForTimeout(400);
  }
  const beforeCards = await page.evaluate(() => document.querySelectorAll('.douyin-page [class*="card"]').length);
  await page.evaluate(() => {
    const sc = [...document.querySelectorAll('.douyin-page *')].find((e) => e.scrollHeight > e.clientHeight + 50 && /auto|scroll/.test(getComputedStyle(e).overflowY));
    const target = sc || document.scrollingElement;
    target.scrollTop = 250;
    window.__scrolledTo = target.scrollTop;
  });
  await gotoHash(page, 'douyin/trends');
  await settle(page);
  await gotoHash(page, 'douyin/rooms');
  await settle(page);
  out.keepAlive = {
    filterInputFound: hasFilter > 0,
    filterKept: hasFilter ? await page.locator(filterSel).first().inputValue().catch(() => 'ERR') : null,
    cardsBefore: beforeCards,
    cardsAfter: await page.evaluate(() => document.querySelectorAll('.douyin-page [class*="card"]').length),
    scrollKept: await page.evaluate(() => {
      const sc = [...document.querySelectorAll('.douyin-page *')].find((e) => e.scrollHeight > e.clientHeight + 50 && /auto|scroll/.test(getComputedStyle(e).overflowY));
      return (sc || document.scrollingElement).scrollTop;
    }),
    scrollRequested: 250
  };

  /* --- D. 浏览器后退 --- */
  await gotoHash(page, 'douyin/trends');
  await settle(page);
  await gotoHash(page, 'douyin/status');
  await settle(page);
  await page.goBack();
  await page.waitForTimeout(900);
  const backProbe = await page.evaluate(() => ({
    hash: location.hash,
    title: document.title,
    docScrollTop: document.scrollingElement.scrollTop,
    activeEl: document.activeElement ? document.activeElement.tagName + '.' + String(document.activeElement.className || '').split(' ')[0] : null
  }));
  out.back = backProbe;

  /* --- E. 焦点归属（路由切换后） --- */
  out.nav.focusAfterNav = await page.evaluate(() => {
    const a = document.activeElement;
    return a ? `${a.tagName}.${String(a.className || '').split(' ')[0] || ''}` : null;
  });

  /* --- F. prefers-reduced-motion --- */
  const rmCtx = await browser.newContext({ viewport: VIEWPORT, reducedMotion: 'reduce' });
  const rmPage = await rmCtx.newPage();
  await uiLogin(rmPage);
  await gotoHash(rmPage, 'douyin/dashboard');
  await settle(rmPage);
  await rmPage.evaluate(() => {
    location.hash = '#/douyin/search';
  });
  const rmFrames = [];
  for (let i = 0; i < 5; i++) {
    await rmPage.waitForTimeout(60);
    rmFrames.push(
      await rmPage.evaluate(() => document.getAnimations().filter((a) => a.playState === 'running').length)
    );
  }
  await settle(rmPage);
  out.reduced = {
    frames: rmFrames,
    animationNamesStillRunning: await rmPage.evaluate(() =>
      document.getAnimations().filter((a) => a.playState === 'running').map((a) => a.animationName || a.transitionProperty || '?')
    ),
    hoverLiftStillActive: await rmPage.evaluate(() => {
      const card = document.querySelector('.douyin-page .art-card');
      if (!card) return null;
      return getComputedStyle(card).transitionProperty + ' / ' + getComputedStyle(card).transitionDuration;
    })
  };

  await browser.close();

  if (asJson) {
    console.log(JSON.stringify(out, null, 2));
    return;
  }
  printReport(out);
}

function printReport(o) {
  const L = (...a) => console.log(...a);
  L(`\n=== 参数 === sessionId=${o.params.sid} secUid=${String(o.params.secUid).slice(0, 12)}… chrome=${o.params.chrome || 'playwright 自带'}`);
  L('\n=== A. 逐页体检 ===');
  for (const p of o.pages) {
    L(`\n--- ${p.label} (${p.route}) ---`);
    L(`  title="${p.title}" hash=${p.hash}`);
    L(`  宽度: innerW=${p.innerW} docScrollW=${p.docScrollW} ${p.docScrollW > p.innerW ? '❌ 横向溢出' : '✅ 无横向溢出'}`);
    L(`  越界元素 ${p.offenders.length}: ${p.offenders.map((x) => `${x.el}[${x.left},${x.right}]«${x.text}»`).join(' | ') || '无'}`);
    L(`  body 高度序列 ${JSON.stringify(p.heights)} → 加载跳动 ${p.loadJumpPx}px；CLS=${p.cls}`);
    L(`  点按目标 <24px ${p.tiny.length}: ${p.tiny.map((t) => `${t.el} ${t.w}x${t.h}${t.aria ? '(aria)' : ''}«${t.text}»`).join(' | ') || '无'}`);
    L(`  字号档位: ${Object.entries(p.fonts).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}×${v}`).join(', ')}`);
    L(`  无尺寸图片 ${p.imgsNoSize} ${p.imgSample.join(',')}`);
    L(`  滚动容器 ${p.scrollers.length}: ${p.scrollers.map((s) => `${s.el} ${s.clientH}/${s.scrollH}`).join(' | ') || '无'}`);
    L(`  骨架=${p.skeleton} 空态=${p.emptyState} 错误态=${p.errState} 运行中动画=${p.anims.length} ${p.anims.map((a) => a.name + '@' + a.ms).join(',')}`);
    if (p.consoleErrors.length) L(`  ❌ 控制台: ${p.consoleErrors.join(' || ')}`);
  }
  L('\n=== B. 路由切换动效 ===');
  for (const [k, v] of Object.entries(o.nav)) {
    if (!v || !v.frames) {
      L(`  ${k}: ${JSON.stringify(v)}`);
      continue;
    }
    L(`  ${k}: ${v.from} → ${v.to}`);
    v.frames.forEach((f, i) => L(`    +${(i + 1) * 60}ms views=${f.views} opacity=[${f.opacity.join(',')}] anims=[${f.anims.join(',')}]`));
  }
  L('\n=== C. keep-alive 状态保留 ===');
  L('  ' + JSON.stringify(o.keepAlive));
  L('\n=== D. 浏览器后退 ===');
  L('  ' + JSON.stringify(o.back));
  L('\n=== F. prefers-reduced-motion ===');
  L('  ' + JSON.stringify(o.reduced));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
