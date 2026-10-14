/**
 * 数字滚动动画检查（常驻脚本，直接 node 跑；需要 5173 开发服务已启动）
 *
 * 守两件事 —— 两件都真踩过，且都是"看起来像数据错了"的观感问题：
 *
 *   ① 动画过程中**不允许超过目标值**。
 *      @vueuse 的 useTransition 算进度是 `alpha = ease((now - startedAt) / duration)`，
 *      **alpha 没有钳到 1**（源码里判断"是否继续"用的是上一帧的 now，下一帧完全可以越过 endAt）。
 *      只要有一帧被拖慢（页面刚加载、正在渲染大列表时很常见），alpha 就 > 1，
 *      数字会冲过目标再回落 —— 用户原话："5 位数 数字滚动动画会超过五位再变回来"。
 *      现在组件传了夹住的 EASE_OUT_CLAMPED，这里守着别退化。
 *
 *   ② 数字字号在整段动画里**必须恒定**。
 *      字号档位若按"动画中的当前值"算长度，数字每长一位就换一次字号，
 *      0.8 秒里跳好几次（实测移动端 24px→14px→16px→18px），看起来在抖。
 *      现在档位按**目标值**的长度算，这里守着。
 *
 * 用法：node scripts/anim-check.js   （退出码 0 = 通过）
 */
const { chromium } = require('playwright');
const fs = require('fs');

const FRONT = 'http://127.0.0.1:5173';
const CHROME = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe'
].find((c) => fs.existsSync(c));

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

/** 页面一加载就挂采样器：每 25ms 记一次五张 KPI 卡的文本与字号 */
const INSTALL_SAMPLER = () => {
  window.__samples = [];
  const tick = () => {
    const cards = [...document.querySelectorAll('.dy-stat-card')];
    const row = cards.map((c) => {
      const num = c.querySelector('.dy-stat-num');
      const txt = num ? num.textContent.trim() : '';
      const v = Number(txt.replace(/,/g, ''));
      return {
        label: c.querySelector('.text-xs')?.textContent?.trim(),
        text: txt,
        num: Number.isNaN(v) ? null : v,
        fs: num ? getComputedStyle(num).fontSize : ''
      };
    });
    if (row.length) window.__samples.push({ t: Math.round(performance.now()), row });
    if (performance.now() < 20000) setTimeout(tick, 25);
  };
  setTimeout(tick, 300);
};

let failed = 0;

const report = (label, samples) => {
  console.log(`\n== ${label} ==（采样 ${samples.length} 次）`);
  if (!samples.length) {
    console.log('  ✗ 没有采到样本');
    failed++;
    return;
  }
  const labels = samples[samples.length - 1].row.map((r) => r.label);
  for (let i = 0; i < labels.length; i++) {
    const series = samples.map((s) => s.row[i]).filter(Boolean);
    if (!series.length) continue;
    const target = series[series.length - 1].num;
    const maxSeen = Math.max(...series.map((x) => x.num ?? 0));
    const fonts = [...new Set(series.map((x) => x.fs))];
    const ok = maxSeen <= target && fonts.length === 1;
    if (!ok) failed++;
    console.log(
      `  ${String(labels[i]).padEnd(6)} 目标 ${String(target).padStart(12)}  最大 ${String(maxSeen).padStart(12)} ` +
        `${maxSeen > target ? '✗ 超目标' : '✓'}  字号 ${fonts.join('/')} ${fonts.length > 1 ? '✗ 变动' : '✓ 恒定'}`
    );
  }
};

(async () => {
  if (!CHROME) {
    console.error('未找到 Chrome，跳过动画检查');
    process.exit(0);
  }
  const b = await chromium.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox'] });

  for (const [vp, w, h] of [
    ['桌面 1440', 1440, 900],
    ['移动端 390', 390, 844]
  ]) {
    const ctx = await b.newContext({ viewport: { width: w, height: h } });
    const page = await ctx.newPage();
    await page.addInitScript(INSTALL_SAMPLER);
    await page.goto(FRONT, { waitUntil: 'networkidle', timeout: 60000 });
    await page.waitForTimeout(2000);
    await page.locator('.el-input__inner').nth(0).fill('admin');
    await page.locator('.el-input__inner').nth(1).fill('123456');
    await drag(page);
    await page.locator('button:has-text("登录")').first().click();
    await page.waitForTimeout(7000);
    // 切走再切回：触发一次新的滚动动画
    await page.evaluate(() => (window.__samples = []));
    await page.goto(`${FRONT}/#/douyin/rooms`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1000);
    await page.goto(`${FRONT}/#/douyin/dashboard`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(3500);
    report(vp, await page.evaluate(() => window.__samples));
    await ctx.close();
  }

  await b.close();
  console.log(`\n===== 动画检查：${failed === 0 ? '全部通过' : failed + ' 项未通过'} =====`);
  process.exit(failed === 0 ? 0 : 1);
})();
