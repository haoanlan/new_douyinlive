/**
 * Chromium 可执行文件定位（报告图片渲染用）
 *
 * 背景：`report-image.js` 原来把 Linux 服务器上的绝对路径写死在代码里：
 *   '/opt/data/home/.agent-browser/browsers/chrome-148.0.7778.167/chrome'
 * 结果本地（Windows）调用 /api/sessions/:id/report 必然 500：
 *   "browserType.launch: Failed to launch chromium because executable doesn't exist at ..."
 * 而前端「下载报告」只显示一句「报告生成失败」，看不出是路径问题。
 *
 * 这里按 lib/proxy-binary.js 的同款思路做平台自适应：
 *  1) 环境变量优先（PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH / CHROME_PATH）
 *  2) 系统已安装的 Chrome / Edge（Windows 开发机、macOS 上最常见）
 *  3) 服务器上的既有约定路径（保持向后兼容，避免改坏线上）
 *  4) 都不存在时返回 null，交给 playwright 用自带的 chromium
 */
const fs = require('fs');
const path = require('path');

/** 环境变量（按优先级） */
const ENV_KEYS = ['PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH', 'CHROME_PATH', 'CHROMIUM_PATH'];

/** 系统已安装浏览器的常见位置 */
function systemCandidates() {
  if (process.platform === 'win32') {
    const pf = process.env['PROGRAMFILES'] || 'C:\\Program Files';
    const pf86 = process.env['PROGRAMFILES(X86)'] || 'C:\\Program Files (x86)';
    const local = process.env.LOCALAPPDATA || '';
    return [
      path.join(pf, 'Google', 'Chrome', 'Application', 'chrome.exe'),
      path.join(pf86, 'Google', 'Chrome', 'Application', 'chrome.exe'),
      local && path.join(local, 'Google', 'Chrome', 'Application', 'chrome.exe'),
      path.join(pf86, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
      path.join(pf, 'Microsoft', 'Edge', 'Application', 'msedge.exe')
    ].filter(Boolean);
  }
  if (process.platform === 'darwin') {
    return [
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      '/Applications/Chromium.app/Contents/MacOS/Chromium',
      '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge'
    ];
  }
  return [
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser'
  ];
}

/**
 * 服务器上的既有约定路径（通配 chrome-* 版本目录，避免版本升级后再次失效）
 * @returns {string[]}
 */
function serverCandidates() {
  const roots = [
    '/opt/data/home/.agent-browser/browsers',
    '/opt/hermes/.playwright',
    path.join(require('os').homedir(), '.cache', 'ms-playwright')
  ];
  const out = [];
  for (const root of roots) {
    let entries = [];
    try {
      entries = fs.readdirSync(root);
    } catch {
      continue;
    }
    for (const name of entries) {
      // chrome-148.0.7778.167/chrome 、chromium_headless_shell-1234/.../chrome-headless-shell
      for (const rel of [
        ['chrome'],
        ['chrome-linux64', 'chrome'],
        ['chrome-headless-shell-linux64', 'chrome-headless-shell'],
        ['chrome-mac', 'Chromium.app', 'Contents', 'MacOS', 'Chromium']
      ]) {
        out.push(path.join(root, name, ...rel));
      }
    }
  }
  return out;
}

/**
 * 解析可用的 Chromium/Chrome 可执行文件
 * @returns {string|null} 绝对路径；null 表示交给 playwright 自己找
 */
function resolveChromium() {
  for (const key of ENV_KEYS) {
    const v = process.env[key];
    if (v && fs.existsSync(v)) return v;
  }
  for (const p of [...systemCandidates(), ...serverCandidates()]) {
    try {
      if (fs.existsSync(p)) return p;
    } catch {
      /* ignore */
    }
  }
  return null;
}

module.exports = { resolveChromium, systemCandidates, serverCandidates, ENV_KEYS };
