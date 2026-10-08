/**
 * 排版/动效/跳转体检 —— 第二轮聚焦探针（配合 scripts/ui-audit-layout.js）
 *
 * 用法：node scripts/ui-audit-probe.js
 * 覆盖：
 *  P1 用户画像页为何近乎空白（抓请求与 404、正文、空态文案）
 *  P2 真实滚动容器下的「离开→返回」滚动位置保留
 *  P3 窄屏（1280 / 1024）横向溢出与点按目标
 *  P4 font-size:0 的元素是谁（趋势页 12 个）
 *  P5 keep-alive 页的裸 setInterval 是否在切走后继续轮询
 *  P6 暗色主题下关键元素实测对比度
 */
const { chromium } = require('playwright');
const { resolveChromium } = require('../lib/browser-path');

const FRONT = process.env.CHECK_FRONT || 'http://127.0.0.1:5173';
const API = process.env.CHECK_API || 'http://127.0.0.1:9871';
const ROUTES = [
  ['douyin/dashboard', '概览'],
  ['douyin/rooms', '房间管理'],
  ['douyin/sessions', '场次历史'],
  ['douyin/trends', '趋势分析'],
  ['douyin/search', '信息查询'],
  ['douyin/status', '状态监控']
];

async function tokenOf() {
  const r = await fetch(`${API}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ userName: 'admin', password: '123456' })
  });
  return (await r.json()).token;
}
async function apiGet(token, p) {
  const r = await fetch(`${API}${p}`, { headers: { authorization: `Bearer ${token}` } });
  return r.ok ? r.json() : null;
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
  await page.waitForTimeout(150);
  for (let i = 0; i < 40; i++) {
    if (await page.evaluate(() => !!document.querySelector('.douyin-page'))) break;
    await page.waitForTimeout(150);
  }
  for (let i = 0; i < 40; i++) {
    const n = await page.evaluate(() => document.getAnimations().filter((a) => a.playState === 'running').length);
    if (n === 0) break;
    await page.waitForTimeout(120);
  }
  await page.mouse.move(3, 3);
  await page.waitForTimeout(300);
}

const CONTRAST_FN = `
function lum(c){const m=c.match(/[\\d.]+/g).map(Number);const [r,g,b]=m.map(v=>{v/=255;return v<=0.03928?v/12.92:Math.pow((v+0.055)/1.055,2.4)});return 0.2126*r+0.7152*g+0.0722*b}
function bgOf(el){let n=el;while(n&&n!==document.documentElement){const c=getComputedStyle(n).backgroundColor;if(c&&c!=='rgba(0, 0, 0, 0)'&&c!=='transparent')return c;n=n.parentElement}return getComputedStyle(document.body).backgroundColor||'rgb(255,255,255)'}
function ratio(el){const fg=getComputedStyle(el).color;const bg=bgOf(el);const a=lum(fg),b=lum(bg);const hi=Math.max(a,b),lo=Math.min(a,b);return Math.round(((hi+0.05)/(lo+0.05))*100)/100}
`;

async function main() {
  const token = await tokenOf();
  const sessions = await apiGet(token, '/api/sessions');
  const streamers = await apiGet(token, '/api/streamers');
  const list = Array.isArray(streamers) ? streamers : streamers.list || [];
  const sid = (Array.isArray(sessions) ? sessions : sessions.list || [])[0]?.id;
  // 取「有场次数据」的主播做画像页样本，否则会误判成页面 bug（无数据的主播本就该空）
  const host = list.find((s) => (s.session_count || 0) > 0) || list[0];
  const secUid = host?.sec_uid;
  console.log(`[样本] 画像页用主播 id=${host?.id} name=${host?.name} sessions=${host?.session_count}`);
  const exe = resolveChromium();
  const browser = await chromium.launch({ executablePath: exe || undefined, headless: true, args: ['--no-sandbox'] });
  const out = { profile: {}, scroll: {}, narrow: {}, zeroFont: {}, polling: {}, dark: {} };

  const ctx = await browser.newContext({ viewport: { width: 1500, height: 950 } });
  const page = await ctx.newPage();
  const reqLog = [];
  page.on('response', (r) => {
    const u = r.url();
    if (u.includes('/api/')) reqLog.push({ t: Date.now(), url: u.replace(API, '').replace(FRONT, ''), status: r.status() });
  });
  const failed = [];
  page.on('requestfailed', (r) => failed.push({ url: r.url().slice(-70), err: r.failure()?.errorText }));
  page.on('response', (r) => {
    if (r.status() === 404) failed.push({ url: r.url().slice(-90), err: 'HTTP 404' });
  });
  if (!(await uiLogin(page))) throw new Error('登录失败');

  /* P1 用户画像页 */
  reqLog.length = 0;
  failed.length = 0;
  await gotoHash(page, `douyin/profile/${secUid}`);
  await page.waitForTimeout(2500);
  out.profile = {
    bodyText: await page.evaluate(() => (document.querySelector('.douyin-page')?.innerText || '').replace(/\s+/g, ' ').slice(0, 400)),
    visibleTextNodes: await page.evaluate(
      () => [...document.querySelectorAll('.douyin-page *')].filter((e) => e.children.length === 0 && (e.textContent || '').trim()).length
    ),
    emptyDescriptions: await page.evaluate(() => [...document.querySelectorAll('.el-empty__description')].map((e) => e.textContent.trim())),
    apiCalls: reqLog.map((r) => `${r.url} → ${r.status}`),
    failures: failed.slice(0, 6),
    cards: await page.evaluate(() => document.querySelectorAll('.douyin-page .art-card').length)
  };

  /* P2 滚动位置保留（真实滚动容器） */
  await gotoHash(page, 'douyin/rooms');
  const scrollerInfo = await page.evaluate(() => {
    const cands = ['.layout-content', 'main', '#app', ...[]].concat([]);
    const all = [...document.querySelectorAll('*')];
    const found = [];
    for (const el of all) {
      const cs = getComputedStyle(el);
      if (/auto|scroll/.test(cs.overflowY) && el.scrollHeight > el.clientHeight + 20) {
        found.push({
          sel: el.id ? '#' + el.id : el.tagName.toLowerCase() + '.' + String(el.className || '').split(' ').slice(0, 2).join('.'),
          clientH: el.clientHeight,
          scrollH: el.scrollHeight
        });
      }
      if (found.length >= 4) break;
    }
    return found;
  });
  const scrollSet = await page.evaluate(() => {
    const el = [...document.querySelectorAll('*')].find(
      (e) => /auto|scroll/.test(getComputedStyle(e).overflowY) && e.scrollHeight > e.clientHeight + 20
    );
    if (!el) return { found: false };
    el.scrollTop = 300;
    el.setAttribute('data-audit-scroller', '1');
    return { found: true, after: el.scrollTop, cls: String(el.className).split(' ').slice(0, 2).join('.') };
  });
  await gotoHash(page, 'douyin/trends');
  await gotoHash(page, 'douyin/rooms');
  const afterBack = await page.evaluate(() => {
    const el = document.querySelector('[data-audit-scroller]');
    return el ? el.scrollTop : 'no-scroller';
  });
  await gotoHash(page, 'douyin/trends');
  await page.goBack();
  await page.waitForTimeout(900);
  const afterGoBack = await page.evaluate(() => {
    const el = document.querySelector('[data-audit-scroller]');
    return { hash: location.hash, scrollTop: el ? el.scrollTop : 'no-scroller' };
  });
  out.scroll = { scrollerInfo, scrollSet, afterHashNav: afterBack, afterBrowserBack: afterGoBack };

  /* P3 窄屏 */
  for (const vp of [
    { width: 1280, height: 800 },
    { width: 1024, height: 768 }
  ]) {
    await page.setViewportSize(vp);
    await page.waitForTimeout(400);
    const rows = [];
    for (const [route, label] of ROUTES) {
      await gotoHash(page, route);
      rows.push(
        await page.evaluate(
          ({ label, route }) => {
            const vw = window.innerWidth;
            const vis = (el) => {
              const cs = getComputedStyle(el);
              if (cs.display === 'none' || cs.visibility === 'hidden') return false;
              const r = el.getBoundingClientRect();
              return r.width > 0 && r.height > 0;
            };
            const off = [];
            for (const el of document.querySelectorAll('body *')) {
              if (!vis(el) || getComputedStyle(el).position === 'fixed') continue;
              const r = el.getBoundingClientRect();
              if (r.right > vw + 1) {
                if (el.closest('.overflow-auto, [class*="overflow-x"], .el-table__body-wrapper, .dy-scroll')) continue;
                off.push(
                  `${el.tagName.toLowerCase()}.${String(el.className || '').split(' ').slice(0, 2).join('.')}[right=${Math.round(r.right)}]`
                );
              }
              if (off.length >= 4) break;
            }
            const tiny = [];
            for (const el of document.querySelectorAll('button, a, [role="button"], .el-radio-button__inner, .el-check-tag')) {
              if (!vis(el)) continue;
              const r = el.getBoundingClientRect();
              if (r.width < 24 || r.height < 24) tiny.push(`${el.tagName.toLowerCase()} ${Math.round(r.width)}x${Math.round(r.height)}`);
              if (tiny.length >= 4) break;
            }
            return {
              label,
              route,
              docScrollW: document.documentElement.scrollWidth,
              innerW: vw,
              overflow: document.documentElement.scrollWidth > vw,
              offenders: off,
              tiny: [...new Set(tiny)]
            };
          },
          { label, route }
        )
      );
    }
    out.narrow[`${vp.width}x${vp.height}`] = rows;
  }
  await page.setViewportSize({ width: 1500, height: 950 });

  /* P4 font-size:0 */
  await gotoHash(page, 'douyin/trends');
  out.zeroFont = await page.evaluate(() => {
    const rows = [];
    for (const el of document.querySelectorAll('.douyin-page *')) {
      const cs = getComputedStyle(el);
      if (cs.display === 'none') continue;
      if (parseFloat(cs.fontSize) === 0 && (el.textContent || '').trim()) {
        rows.push(`${el.tagName.toLowerCase()}.${String(el.className || '').split(' ').slice(0, 2).join('.')}«${el.textContent.trim().slice(0, 14)}»`);
      }
      if (rows.length >= 12) break;
    }
    return rows;
  });

  /* P5 keep-alive 页的轮询是否在切走后继续 */
  for (const r of ['douyin/dashboard', 'douyin/sessions', 'douyin/status']) {
    await gotoHash(page, r);
    await page.waitForTimeout(1200);
  }
  await gotoHash(page, 'douyin/search'); // 停在一个非轮询页
  await page.waitForTimeout(500);
  reqLog.length = 0;
  await page.waitForTimeout(20000);
  const byUrl = {};
  for (const r of reqLog) byUrl[r.url] = (byUrl[r.url] || 0) + 1;
  out.polling = { duringSeconds: 20, stillOn: 'douyin/search', requests: byUrl, total: reqLog.length };

  /* P6 暗色对比度 */
  await page.evaluate(() => {
    const raw = localStorage.getItem('setting');
    const obj = raw ? JSON.parse(raw) : {};
    const data = obj.setting || obj;
    data.systemThemeType = 'dark';
    localStorage.setItem('setting', JSON.stringify(obj.setting ? { ...obj, setting: data } : data));
  });
  await page.reload({ waitUntil: 'networkidle' });
  for (let i = 0; i < 60; i++) {
    if (await page.evaluate(() => !!document.querySelector('.douyin-page'))) break;
    await page.waitForTimeout(200);
  }
  await gotoHash(page, 'douyin/status');
  out.dark = await page.evaluate(`(() => {
    ${CONTRAST_FN}
    const sel = ['.dy-toolbar-title','.text-g-500','.text-g-600','.el-tag','.mon-chip','.el-progress-bar__outer','.dy-stat-card','.art-card-header h4','[class*="bg-amber-100"]','[class*="bg-blue-50"]'];
    const rows = [];
    for (const s of sel) {
      const el = document.querySelector('.douyin-page ' + s);
      if (!el) { rows.push({ sel: s, found: false }); continue; }
      rows.push({ sel: s, found: true, color: getComputedStyle(el).color, bg: bgOf(el), ratio: ratio(el), fontSize: getComputedStyle(el).fontSize });
    }
    return { htmlClass: document.documentElement.className, bodyBg: getComputedStyle(document.body).backgroundColor, rows };
  })()`);

  /* P7 房间卡悬停/按下反馈（animation-fill-mode: both 是否压掉 transform） */
  await gotoHash(page, 'douyin/rooms');
  const cardLoc = page.locator('.room-card').first();
  const cardState = async () => cardLoc.evaluate((el) => {
    const cs = getComputedStyle(el);
    return `transform=${cs.transform} anim=${cs.animationName}/${cs.animationDuration} fill=${cs.animationFillMode} shadow=${cs.boxShadow.slice(0, 34)}`;
  });
  const p7 = { rest: await cardState() };
  await cardLoc.hover();
  await page.waitForTimeout(400);
  p7.hover = await cardState();
  await page.mouse.down();
  await page.waitForTimeout(250);
  p7.active = await cardState();
  await page.mouse.up();
  await page.mouse.move(3, 3);
  await page.waitForTimeout(300);
  out.cardFeedback = p7;

  /* P8 首次加载（全新上下文）真实滚动容器高度轨迹：空态 → 内容是否跳变 */
  const state = await ctx.storageState();
  out.firstLoad = [];
  for (const [route, label] of ROUTES) {
    const c = await browser.newContext({ viewport: { width: 1500, height: 950 }, storageState: state });
    const p = await c.newPage();
    await p.goto(`${FRONT}/#/${route}`, { waitUntil: 'domcontentloaded' });
    const seq = [];
    for (let i = 0; i < 12; i++) {
      await p.waitForTimeout(250);
      seq.push(
        await p.evaluate(() => {
          const sc = document.querySelector('#app-main') || document.scrollingElement;
          const pg = document.querySelector('.douyin-page');
          return {
            h: Math.round(sc.scrollHeight),
            txt: pg ? (pg.innerText || '').replace(/\s+/g, '').length : 0,
            empty: !!document.querySelector('.douyin-page .el-empty'),
            loading: !!document.querySelector('.el-loading-mask')
          };
        })
      );
    }
    out.firstLoad.push({ route, label, seq });
    await c.close();
  }

  /* P9 搜索页状态保留（非 keepAlive：进详情再返回） */
  await gotoHash(page, 'douyin/search');
  const heroInput = page.locator('input[placeholder*="昵称"], input[placeholder*="查询"]').first();
  let p9 = { inputFound: (await heroInput.count()) > 0 };
  if (p9.inputFound) {
    await heroInput.fill('林语');
    await heroInput.press('Enter');
    await page.waitForTimeout(6000);
    p9.beforeNav = {
      value: await heroInput.inputValue().catch(() => 'ERR'),
      rows: await page.evaluate(() => document.querySelectorAll('.douyin-page [class*="row"], .douyin-page .art-card').length),
      text: await page.evaluate(() => (document.querySelector('.douyin-page')?.innerText || '').replace(/\s+/g, ' ').slice(0, 120))
    };
    await gotoHash(page, `douyin/detail/${sid}`);
    await page.goBack();
    await page.waitForTimeout(2500);
    const inp2 = page.locator('input[placeholder*="昵称"], input[placeholder*="查询"]').first();
    p9.afterBack = {
      hash: await page.evaluate(() => location.hash),
      value: (await inp2.count()) ? await inp2.inputValue().catch(() => 'ERR') : 'input-gone',
      text: await page.evaluate(() => (document.querySelector('.douyin-page')?.innerText || '').replace(/\s+/g, ' ').slice(0, 120))
    };
  }
  out.searchState = p9;

  /* P10 prefers-reduced-motion 下路由切换到底还有哪些动画在跑 */
  const rmc = await browser.newContext({ viewport: { width: 1500, height: 950 }, storageState: state, reducedMotion: 'reduce' });
  const rmp = await rmc.newPage();
  await rmp.goto(`${FRONT}/#/douyin/dashboard`, { waitUntil: 'domcontentloaded' });
  await rmp.waitForTimeout(3000);
  await rmp.evaluate(() => {
    location.hash = '#/douyin/rooms';
  });
  const rmSeq = [];
  for (let i = 0; i < 5; i++) {
    await rmp.waitForTimeout(70);
    rmSeq.push(
      await rmp.evaluate(() =>
        document.getAnimations().filter((a) => a.playState === 'running').map((a) => `${a.animationName || 'tr:' + a.transitionProperty}@${Math.round((a.effect?.getTiming?.().duration) || 0)}`)
      )
    );
  }
  await rmp.waitForTimeout(1500);
  out.reducedMotion = {
    navSequence: rmSeq,
    cardAnim: await rmp.evaluate(() => {
      const c = document.querySelector('.douyin-page .art-card');
      return c ? getComputedStyle(c).animationName + ' / ' + getComputedStyle(c).transitionDuration : 'no-card';
    }),
    infiniteStillRunning: await rmp.evaluate(() => document.getAnimations().filter((a) => a.playState === 'running').map((a) => a.animationName || '?')),
    roomCardHoverMs: await rmp.evaluate(() => {
      const c = document.querySelector('.room-card');
      return c ? getComputedStyle(c).transitionDuration + ' / ' + getComputedStyle(c).animationName : 'no-room-card';
    })
  };

  await browser.close();
  console.log(JSON.stringify(out, null, 2));
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
