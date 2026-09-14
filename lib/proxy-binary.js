/**
 * Go 抓取代理（jwwsjlm/douyinLive）的配置托管与启动
 *
 * 背景：代理有自己的 config.yaml schema（严格校验，不认识的字段会直接报错退出），
 * 而 Node 端的 config.yaml 含 dashboard 等字段，两者不能共用同一份文件，
 * 否则代理会启动失败：
 *   "line 26: field dashboard not found in type main.configFileSchema"
 *
 * 因此这里：
 *  1) 平台自适应定位二进制（也支持环境变量 DOUYIN_PROXY_BIN 指定）
 *  2) 在项目根目录维护一份代理专用配置 proxy-config.yaml，
 *     每次启动前按 Node 端 config.yaml 重新生成，保证 cookie 只需配置一处
 *  3) 启动时显式传 --config proxy-config.yaml，避免代理误读 Node 的 config.yaml
 */
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const PORT = 1088;
const PROXY_CONFIG_NAME = 'proxy-config.yaml';

/** 默认二进制名（按平台） */
function defaultBinaryName(platform = process.platform) {
  if (platform === 'win32') return 'douyinLive-win-amd64.exe';
  if (platform === 'darwin') return 'douyinLive-darwin-amd64';
  return 'douyinLive-linux-amd64';
}

/** 候选名列表：覆盖项目约定名 + 官方 release 解压后的名字 */
function candidateNames(platform = process.platform) {
  const list = [];
  if (platform === 'win32') {
    list.push('douyinLive-win-amd64.exe', 'douyinLive.exe', 'douyinLive-win-amd64');
  } else if (platform === 'darwin') {
    list.push('douyinLive-darwin-amd64', 'douyinLive-macos-amd64', 'douyinLive');
  } else {
    list.push('douyinLive-linux-amd64', 'douyinLive-linux-arm64', 'douyinLive');
  }
  // 开发机常见情况：目录里放的是别的平台构建（例如本地验证 Linux 版）
  list.push('douyinLive-linux-amd64', 'douyinLive-win-amd64.exe');
  return [...new Set(list)];
}

/** 文件名是否属于指定平台（用于扫描时过滤，避免把错误的平台当成可用） */
function belongsToPlatform(fileName, platform = process.platform) {
  const n = fileName.toLowerCase();
  if (platform === 'win32') return n.includes('win') || n.endsWith('.exe');
  if (platform === 'darwin') return n.includes('darwin') || n.includes('macos');
  return n.includes('linux') && !n.endsWith('.exe');
}

/**
 * 解析实际可用的二进制
 * @returns {{ path: string|null, name: string, candidates: string[], source: string|null, foreign: string|null }}
 *   foreign: 若是"存在但不属于当前平台"的文件名（例如在 Windows 上只有 linux 版），会填在这里
 */
function resolveBinary(root, platform = process.platform) {
  const candidates = candidateNames(platform);
  const envPath = process.env.DOUYIN_PROXY_BIN || process.env.BINARY_PATH || '';
  if (envPath) {
    const abs = path.isAbsolute(envPath) ? envPath : path.join(root, envPath);
    return fs.existsSync(abs)
      ? { path: abs, name: path.basename(abs), candidates, source: 'env', foreign: null }
      : { path: null, name: path.basename(abs), candidates, source: 'env', foreign: null };
  }

  for (const name of candidates) {
    const p = path.join(root, name);
    if (fs.existsSync(p)) {
      return {
        path: p,
        name,
        candidates,
        source: name === defaultBinaryName(platform) ? 'platform' : 'scan',
        foreign: null
      };
    }
  }

  // 兜底扫描：找出 douyinLive* 文件，区分本平台/其他平台
  let foreign = null;
  try {
    for (const f of fs.readdirSync(root)) {
      if (!/^douyinLive/i.test(f)) continue;
      if (/\.(json|log|md|db|old|bak|yaml|yml)$/i.test(f)) continue;
      const p = path.join(root, f);
      try { if (!fs.statSync(p).isFile()) continue; } catch { continue; }
      if (belongsToPlatform(f, platform)) {
        return { path: p, name: f, candidates, source: 'scan', foreign: null };
      }
      if (!foreign) foreign = f;
    }
  } catch { /* ignore */ }

  return { path: null, name: defaultBinaryName(platform), candidates, source: null, foreign };
}

/** 从 Node 端 config.yaml 取抖音 cookie（避免两处配置） */
function readCookieFromNodeConfig(root) {
  try {
    const yaml = fs.readFileSync(path.join(root, 'config.yaml'), 'utf-8');
    const m = yaml.match(/^\s*douyin:\s*(?:'([^']*)'|"([^"]*)"|(\S+))/m);
    return (m?.[1] ?? m?.[2] ?? m?.[3] ?? '').trim();
  } catch {
    return '';
  }
}

/**
 * 生成/刷新代理专用配置 proxy-config.yaml
 * @returns {string} 配置文件绝对路径
 */
function ensureProxyConfig(root, { port = PORT, logLevel = 'info' } = {}) {
  const file = path.join(root, PROXY_CONFIG_NAME);
  const cookie = readCookieFromNodeConfig(root);
  const content = [
    '# 该文件由 lib/proxy-binary.js 自动生成，供 Go 抓取代理使用。',
    '# Go 代理的配置 schema 与 Node 端不同（不接受 dashboard 等字段），因此单独一份。',
    '# cookie 会自动从根目录 config.yaml 的 cookie.douyin 同步过来，不需要在这里手动填写。',
    '',
    `port: "${port}"`,
    '',
    'websocket:',
    '  path: "/ws"',
    '  allowed_origins: []',
    '',
    'unknown: false',
    '',
    'log:',
    `  level: "${logLevel}"`,
    '',
    'sign:',
    '  provider: ""',
    '',
    'tikhub:',
    '  key: ""',
    '',
    'api:',
    '  key: ""',
    '  allowed_domains:',
    '    - "douyin.com"',
    '',
    'monitor:',
    '  poll_interval: "15s"',
    '  notify_interval: "30s"',
    '',
    // 注意：这里不生成 proxy: 段。官方 config.example.yaml 里有该字段，
    // 但已发布的二进制（v2.2.1）schema 尚未包含它，写了会导致启动失败：
    //   "line 31: field proxy not found in type main.configFileSchema"
    // 需要在服务器上走代理时，升级代理到支持该字段的版本后再补这一节。
    'cookie:',
    '  use_stored: true',
    `  douyin: "${cookie.replace(/"/g, '\\"')}"`,
    '  rooms: {}',
    ''
  ].join('\n');
  fs.writeFileSync(file, content, 'utf-8');
  return file;
}

/**
 * 启动代理（分离进程；日志落文件，stdio 不用管道，避免受限环境 EPERM）
 * @returns {{ ok: boolean, pid?: number, error?: string }}
 */
function startProxy(root, binPath, logFile, { port = PORT, logLevel = 'info' } = {}) {
  try {
    const configFile = ensureProxyConfig(root, { port, logLevel });
    const out = fs.openSync(logFile, 'a');
    const child = spawn(
      binPath,
      ['--config', configFile, '--port', String(port), '--log-level', logLevel],
      { cwd: root, detached: true, stdio: ['ignore', out, out] }
    );
    child.unref();
    return { ok: true, pid: child.pid, configFile };
  } catch (e) {
    return { ok: false, error: `启动 Go 代理失败: ${e.message}` };
  }
}

module.exports = {
  PORT,
  PROXY_CONFIG_NAME,
  defaultBinaryName,
  candidateNames,
  belongsToPlatform,
  resolveBinary,
  readCookieFromNodeConfig,
  ensureProxyConfig,
  startProxy
};
