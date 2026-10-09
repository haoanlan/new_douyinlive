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
 * 生成代理专用配置内容。
 *
 * 关键：**根目录 config.yaml 才是配置源**（它本身就是代理那套 schema，另外多一个
 * Node 专有的 dashboard 段）。这里把代理认识的字段原样转发过去，而不是写死 ——
 * 原来只转发了 cookie，log.level / sign.provider / tikhub.key / monitor.* 全被写死，
 * 于是"在 config.yaml 里改了没反应"，看起来就像这套配置很复杂。
 *
 * 实测（本机二进制 v2.2.1）不认 `protocol` 与 `proxy` 两个段，
 * 写进去会 "field xxx not found in type main.configFileSchema" 直接退出，
 * 所以这两段一律不转发，并通过 warnings 告诉调用方（状态页会显示出来）。
 *
 * @returns {{content: string, warnings: string[]}}
 */
function renderProxyConfig(root, { port = PORT, logLevel = 'info' } = {}) {
  const {
    readEditableConfig,
    nestedBlock,
    blockValue,
    nestedList,
    UNSUPPORTED_SECTIONS
  } = require('./proxy-config.js');
  const editable = readEditableConfig(root);
  const v = editable.values || {};
  let raw = '';
  try {
    raw = fs.readFileSync(path.join(root, 'config.yaml'), 'utf-8');
  } catch {
    /* 没有 config.yaml 就全用默认值 */
  }

  const warnings = [];
  for (const s of editable.unsupported || []) {
    const known = UNSUPPORTED_SECTIONS.find((u) => u.key === s.key);
    if (known) warnings.push(`config.yaml 里的 ${s.key} 段不会被转发：${known.reason}`);
  }

  // 可视化编辑器没覆盖、但代理认识且值得转发的字段
  const wsBlock = nestedBlock(raw, 'websocket');
  const wsPath = blockValue(wsBlock, 'path') || '/ws';
  const allowedOrigins = nestedList(wsBlock, 'allowed_origins');
  const apiBlock = nestedBlock(raw, 'api');
  const allowedDomains = nestedList(apiBlock, 'allowed_domains');
  // 官方默认值就是 douyin.com；config.yaml 里没写这一项时不能传空数组 ——
  // 空列表的含义是"一个域名都不允许"，会把 URL 解析接口直接打死
  if (!allowedDomains.length) allowedDomains.push('douyin.com');
  const apiKey = blockValue(apiBlock, 'key');
  const unknownTop = (raw.match(/^unknown:\s*(\S+)/m) || [])[1] || 'false';

  const effectivePort = String(port || PORT);
  const effectiveLog = String(v['log.level'] || logLevel || 'info');
  const useStored = v['cookie.use_stored'] !== false;
  const cookieDefault = String(v['cookie.douyin'] || '');
  const cookieRooms = v['cookie.rooms'] || {};

  const lines = [
    '# 该文件由 lib/proxy-binary.js 自动生成，供 Go 抓取代理使用。',
    '# 配置源是根目录 config.yaml（代理认识它那套字段；dashboard 段是 Node 专有，不转发）。',
    '# 不要在代理启动后手改这里 —— 每次启动都会按 config.yaml 重新生成。',
    '',
    `port: "${effectivePort}"`,
    '',
    'websocket:',
    `  path: ${JSON.stringify(wsPath)}`,
    allowedOrigins.length ? '  allowed_origins:' : '  allowed_origins: []'
  ];
  for (const o of allowedOrigins) lines.push(`    - ${JSON.stringify(o)}`);
  lines.push(
    '',
    `unknown: ${unknownTop}`,
    '',
    'log:',
    `  level: "${effectiveLog}"`,
    '',
    'sign:',
    `  provider: "${String(v['sign.provider'] || '')}"`,
    '',
    'tikhub:',
    `  key: "${String(v['tikhub.key'] || '').replace(/"/g, '\\"')}"`,
    '',
    'api:',
    `  key: "${String(apiKey || '').replace(/"/g, '\\"')}"`
  );
  if (allowedDomains.length) {
    lines.push('  allowed_domains:');
    for (const d of allowedDomains) lines.push(`    - ${JSON.stringify(d)}`);
  } else {
    lines.push('  allowed_domains: []');
  }
  lines.push(
    '',
    'monitor:',
    `  poll_interval: "${String(v['monitor.poll_interval'] || '15s')}"`,
    `  notify_interval: "${String(v['monitor.notify_interval'] || '30s')}"`,
    '',
    'cookie:',
    `  use_stored: ${useStored}`,
    `  douyin: "${cookieDefault.replace(/"/g, '\\"')}"`
  );
  const roomEntries = Object.entries(cookieRooms).filter(([, cv]) => String(cv || '').trim());
  if (!roomEntries.length) {
    lines.push('  rooms: {}');
  } else {
    lines.push('  rooms:');
    for (const [roomId, cv] of roomEntries) {
      lines.push(`    ${JSON.stringify(String(roomId))}: "${String(cv).replace(/"/g, '\\"')}"`);
    }
  }
  lines.push('');
  return { content: lines.join('\n'), warnings };
}

/**
 * 生成/刷新代理专用配置 proxy-config.yaml
 * @returns {string} 配置文件绝对路径
 */
function ensureProxyConfig(root, { port = PORT, logLevel = 'info' } = {}) {
  const file = path.join(root, PROXY_CONFIG_NAME);
  const { content, warnings } = renderProxyConfig(root, { port, logLevel });
  fs.writeFileSync(file, content, 'utf-8');
  for (const w of warnings) console.warn(`[proxy-config] ${w}`);
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
    /*
     * 只传 --config 与 --port：
     *   - 官方优先级是「命令行 > 环境变量 > 配置文件」，而 --port 必须传，
     *     因为监控脚本、状态页健康检查都按固定端口探活；
     *   - **不再传 --log-level** —— 它会把配置文件里的 log.level 顶掉，
     *     导致"在页面上改了日志级别、重启后没生效"（实测踩到）。
     */
    const child = spawn(binPath, ['--config', configFile, '--port', String(port)], {
      cwd: root,
      detached: true,
      stdio: ['ignore', out, out]
    });
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
  renderProxyConfig,
  ensureProxyConfig,
  startProxy
};
