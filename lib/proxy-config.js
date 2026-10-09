/**
 * Go 抓取代理（jwwsjlm/douyinLive）配置与 Cookie 规则的解读。
 *
 * 为什么需要单独一个模块：
 *   代理有**自己的一套 config schema**（严格校验，不认识的字段直接启动失败，
 *   例如 "field dashboard not found in type main.configFileSchema"），
 *   因此它读的是单独一份 proxy-config.yaml（由 lib/proxy-binary.js 生成），
 *   与 Node 端的 config.yaml 不是一回事。状态监控页要回答"代理实际在用哪套 cookie 规则"，
 *   就必须读代理这一份。
 *
 * 代理侧的 Cookie 规则（依据官方 docs/configuration.md）：
 *   WebSocket 临时 Cookie > cookie.rooms[直播间ID] > cookie.douyin > 自动获取(ttwid 等匿名)
 *   cookie.use_stored=false 时忽略前两者（临时 Cookie 仍优先），
 *   且"日志里的 has_cookie=true 不代表已有登录态"—— 匿名 ttwid 也算有 cookie。
 *   所以这里把 cookie 分成 未配置 / 匿名态 / 登录态 三档，而不是"有没有填"。
 */
const fs = require('fs');
const path = require('path');

/** 判定"登录态"的 cookie 键（抖音登录后才会下发） */
const LOGIN_COOKIE_KEYS = [
  'sessionid',
  'sessionid_ss',
  'sid_tt',
  'uid_tt',
  'uid_tt_ss',
  'sso_uid_tt',
  'sso_uid_tt_ss',
  'sid_ucp_v1',
  'ssid_ucp_v1',
  'passport_assist_user'
];

/** 匿名访问也会有的 cookie 键（程序会自己抓 ttwid） */
const ANON_COOKIE_KEYS = [
  'ttwid',
  'odin_tt',
  'msToken',
  's_v_web_id',
  '__ac_nonce',
  'tt_scid',
  'passport_csrf_token'
];

/**
 * 解析 cookie 字符串 → 结构化状态。
 * **只返回判定结果与键名，不返回 cookie 值本身**（状态页不需要、也不该外泄）。
 * @param {string} raw cookie 字符串
 * @returns {{configured: boolean, length: number, auth: 'none'|'anonymous'|'login'|'unknown', loginKeys: string[], anonKeys: string[], keyCount: number}}
 */
function classifyCookie(raw) {
  const s = String(raw || '').trim();
  if (!s) return { configured: false, length: 0, auth: 'none', loginKeys: [], anonKeys: [], keyCount: 0 };
  const names = s
    .split(';')
    .map((p) => p.split('=')[0].trim())
    .filter(Boolean);
  const loginKeys = names.filter((n) => LOGIN_COOKIE_KEYS.includes(n));
  const anonKeys = names.filter((n) => ANON_COOKIE_KEYS.includes(n));
  const auth = loginKeys.length ? 'login' : anonKeys.length ? 'anonymous' : 'unknown';
  return {
    configured: true,
    length: s.length,
    auth,
    loginKeys,
    anonKeys,
    keyCount: names.length
  };
}

/** 取某个顶层键下面缩进更深的整块（原样行数组）；找不到返回 [] */
function nestedBlock(yaml, parentKey) {
  const lines = String(yaml || '').split(/\r?\n/);
  const head = new RegExp(`^${parentKey}:\\s*$|^${parentKey}:\\s*#`);
  const start = lines.findIndex((l) => head.test(l));
  if (start < 0) return [];
  const out = [];
  for (let i = start + 1; i < lines.length; i++) {
    const l = lines[i];
    if (!l.trim()) {
      out.push(l);
      continue;
    }
    if (!/^[ \t]/.test(l)) break; // 回到顶层了
    out.push(l);
  }
  return out;
}

/** 取块内的一级子键值（支持单/双引号与裸值） */
function blockValue(block, key) {
  const re = new RegExp(`^[ \\t]+${key}:\\s*(?:'([^']*)'|"([^"]*)"|([^\\s#]+))`);
  for (const l of block) {
    const m = l.match(re);
    if (m) return (m[1] ?? m[2] ?? m[3] ?? '').trim();
  }
  return '';
}

/** 块内是否出现某个一级子键（哪怕值为空 / 是 {} ） */
function blockHasKey(block, key) {
  return block.some((l) => new RegExp(`^[ \\t]+${key}:`).test(l));
}

/**
 * 解析 `cookie.rooms` 这类"两层缩进的映射"：
 *   cookie:
 *     rooms:
 *       "516466932480": "ttwid=..."
 * 也兼容空映射 `rooms: {}` / `rooms:`（无子项）。
 * @returns {[string, string][]} [key, value] 列表（值已去引号）
 */
function nestedMap(block, key) {
  const idx = block.findIndex((l) => new RegExp(`^[ \\t]+${key}:`).test(l));
  if (idx < 0) return [];
  const keyIndent = (block[idx].match(/^[ \t]*/) || [''])[0].length;
  const inline = block[idx].replace(new RegExp(`^[ \\t]+${key}:`), '').trim();
  if (inline && inline !== '{}') return []; // 只处理块写法
  const out = [];
  for (let i = idx + 1; i < block.length; i++) {
    const l = block[i];
    if (!l.trim()) continue;
    const indent = (l.match(/^[ \t]*/) || [''])[0].length;
    if (indent <= keyIndent) break;
    const m = l.match(/^[ \t]+("([^"]*)"|'([^']*)'|([^:\s]+)):\s*(?:'([^']*)'|"([^"]*)"|(.*))$/);
    if (!m) continue;
    const k = m[2] ?? m[3] ?? m[4] ?? '';
    const v = (m[5] ?? m[6] ?? m[7] ?? '').trim();
    if (k) out.push([k, v]);
  }
  return out;
}

/** 列表写法：`allowed_domains:` 下每行 `- "douyin.com"` */
function nestedList(block, key) {
  const idx = block.findIndex((l) => new RegExp(`^[ \\t]+${key}:`).test(l));
  if (idx < 0) return [];
  const keyIndent = (block[idx].match(/^[ \t]*/) || [''])[0].length;
  const inline = block[idx].replace(new RegExp(`^[ \\t]+${key}:`), '').trim();
  if (inline.startsWith('[')) {
    return inline
      .replace(/^\[|\]$/g, '')
      .split(',')
      .map((s) => s.trim().replace(/^['"]|['"]$/g, ''))
      .filter(Boolean);
  }
  const out = [];
  for (let i = idx + 1; i < block.length; i++) {
    const l = block[i];
    if (!l.trim()) continue;
    const indent = (l.match(/^[ \t]*/) || [''])[0].length;
    if (indent <= keyIndent) break;
    const m = l.match(/^[ \t]+-\s*(?:'([^']*)'|"([^"]*)"|(\S+))\s*$/);
    if (m) out.push((m[1] ?? m[2] ?? m[3] ?? '').trim());
  }
  return out;
}

/**
 * 读取并解读代理专用配置 proxy-config.yaml
 * @param {string} root 项目根目录（代理的工作目录）
 * @returns {object} 结构化配置；文件不存在时 exists=false，其余字段给默认值
 */
function readProxyConfig(root) {
  const file = path.join(root, 'proxy-config.yaml');
  const result = {
    file: 'proxy-config.yaml',
    filePath: file,
    exists: false,
    /** 是否由 lib/proxy-binary.js 自动生成（生成的文件带固定注释头） */
    generated: false,
    port: '',
    logLevel: '',
    websocket: { path: '/ws', allowedOrigins: [] },
    protocol: { mode: '' },
    sign: { provider: '', effective: 'local' },
    tikhub: { hasKey: false },
    api: { hasKey: false, allowedDomains: [] },
    monitor: { pollInterval: '', notifyInterval: '' },
    /** v2.2.x 的二进制 schema 里没有 proxy 段，写了会启动失败（见 lib/proxy-binary.js 注释） */
    proxy: { present: false, url: '', roomCount: 0 },
    cookie: {
      useStored: true,
      default: classifyCookie(''),
      rooms: { count: 0, entries: [] }
    }
  };
  let raw = '';
  try {
    raw = fs.readFileSync(file, 'utf-8');
  } catch {
    return result;
  }
  result.exists = true;
  result.generated = /proxy-binary\.js/.test(raw);

  result.port = (raw.match(/^port:\s*(?:'([^']*)'|"([^"]*)"|(\S+))/m) || []).slice(1).find(Boolean) || '';

  const logBlock = nestedBlock(raw, 'log');
  result.logLevel = blockValue(logBlock, 'level');
  const wsBlock = nestedBlock(raw, 'websocket');
  result.websocket.path = blockValue(wsBlock, 'path') || '/ws';
  result.websocket.allowedOrigins = nestedList(wsBlock, 'allowed_origins');
  const protoBlock = nestedBlock(raw, 'protocol');
  result.protocol.mode = blockValue(protoBlock, 'mode');
  const signBlock = nestedBlock(raw, 'sign');
  result.sign.provider = blockValue(signBlock, 'provider');
  result.sign.effective = result.sign.provider === 'tikhub' ? 'tikhub' : 'local';
  const tikhubBlock = nestedBlock(raw, 'tikhub');
  result.tikhub.hasKey = Boolean(blockValue(tikhubBlock, 'key'));
  const apiBlock = nestedBlock(raw, 'api');
  result.api.hasKey = Boolean(blockValue(apiBlock, 'key'));
  result.api.allowedDomains = nestedList(apiBlock, 'allowed_domains');
  const monitorBlock = nestedBlock(raw, 'monitor');
  result.monitor.pollInterval = blockValue(monitorBlock, 'poll_interval');
  result.monitor.notifyInterval = blockValue(monitorBlock, 'notify_interval');

  const proxyBlock = nestedBlock(raw, 'proxy');
  result.proxy.present = proxyBlock.length > 0 || /^proxy:/m.test(raw);
  if (result.proxy.present) {
    result.proxy.url = blockValue(proxyBlock, 'url');
    result.proxy.roomCount = nestedMap(proxyBlock, 'rooms').length;
  }

  const cookieBlock = nestedBlock(raw, 'cookie');
  const useStored = blockValue(cookieBlock, 'use_stored');
  result.cookie.useStored = useStored === '' ? true : useStored !== 'false';
  result.cookie.default = classifyCookie(blockValue(cookieBlock, 'douyin'));
  const roomPairs = nestedMap(cookieBlock, 'rooms').filter(([, v]) => v);
  result.cookie.rooms = {
    count: roomPairs.length,
    entries: roomPairs.map(([roomId, value]) => ({ roomId, ...classifyCookie(value) }))
  };
  return result;
}

/**
 * 每个监控房间最终会用哪一档 cookie（代理侧优先级）。
 * @param {object} proxyCfg readProxyConfig() 的结果
 * @param {{roomId: string, name?: string}[]} rooms 当前监控的房间
 * @returns {{roomId: string, name: string, source: 'room'|'default'|'auto', auth: string}[]}
 */
function effectiveCookieByRoom(proxyCfg, rooms) {
  const roomMap = new Map((proxyCfg?.cookie?.rooms?.entries || []).map((e) => [String(e.roomId), e]));
  const useStored = proxyCfg?.cookie?.useStored !== false;
  const hasDefault = Boolean(proxyCfg?.cookie?.default?.configured);
  return (rooms || []).map((r) => {
    const id = String(r.roomId);
    const own = roomMap.get(id);
    if (!useStored) return { roomId: id, name: r.name || '', source: 'auto', auth: 'none' };
    if (own) return { roomId: id, name: r.name || '', source: 'room', auth: own.auth };
    if (hasDefault) return { roomId: id, name: r.name || '', source: 'default', auth: proxyCfg.cookie.default.auth };
    return { roomId: id, name: r.name || '', source: 'auto', auth: 'none' };
  });
}

/**
 * 只读文件末尾若干字节（日志会长到几 MB，状态页每 8 秒轮询一次，不能整份读）
 * @param {string} file
 * @param {number} maxBytes
 * @returns {string}
 */
function readTail(file, maxBytes = 400 * 1024) {
  const fd = fs.openSync(file, 'r');
  try {
    const size = fs.fstatSync(fd).size;
    const start = Math.max(0, size - maxBytes);
    const len = size - start;
    const buf = Buffer.alloc(len);
    fs.readSync(fd, buf, 0, len, start);
    return buf.toString('utf-8');
  } finally {
    fs.closeSync(fd);
  }
}

/**
 * 从代理日志（logs/binary_output.log）里提取**运行期**的 cookie / 风控情况。
 *
 * 为什么要看日志：配置里"填了 cookie"和"运行时真的能用"是两回事 ——
 * 实测代理启动时会对每个房间报 `未找到TTWID cookie`，随后又出现
 * `直播页状态不存在 ... body_len=6297 has_user_unique_id=false`（官方文档称之为验证页/访问限制，
 * 处置建议是配登录 Cookie 或换出口 IP）。这些只有日志里才有。
 *
 * 每类信号都带"最后一次发生在什么时候"，页面才能区分「历史发生过」和「现在还在发生」。
 *
 * @param {string} logPath
 * @returns {object}
 */
function readProxyRuntime(logPath) {
  const out = {
    logExists: false,
    lastActivityAt: '',
    ttwidMissing: 0,
    ttwidMissingAt: '',
    /** 最近 30 分钟内是否还在发生（区分"历史发生过"和"现在还在发生"） */
    ttwidMissingRecent: 0,
    verificationPage: 0,
    verificationPageAt: '',
    verificationPageRecent: 0,
    livePageOffline: 0,
    upstreamDial: 0,
    /** 日志里的 has_cookie 标记（裸标记或 =true/=false 都认）；没出现过是 null */
    hasCookie: null,
    lastErrors: []
  };
  let text = '';
  try {
    text = readTail(logPath);
  } catch {
    return out;
  }
  out.logExists = true;
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  out.lastActivityAt = (lines[lines.length - 1] || '').slice(0, 26);

  const RECENT_MS = 30 * 60 * 1000;
  const now = Date.now();
  /** 日志行首的 `2026-10-09 10:42:39.671 +08:00` → 毫秒；解析失败返回 null */
  const lineTime = (l) => {
    const m = l.match(/^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2}(?:\.\d+)?)\s*([+-]\d{2}:?\d{2})?/);
    if (!m) return null;
    const t = Date.parse(`${m[1]}T${m[2]}${m[3] || '+08:00'}`);
    return Number.isFinite(t) ? t : null;
  };
  const isRecent = (l) => {
    const t = lineTime(l);
    return t !== null && now - t <= RECENT_MS;
  };

  const lastErrorMap = new Map();
  for (const l of lines) {
    const at = l.slice(0, 26);
    if (/未找到\s*TTWID\s*cookie/i.test(l)) {
      out.ttwidMissing++;
      out.ttwidMissingAt = at;
      if (isRecent(l)) out.ttwidMissingRecent++;
    }
    // 「直播页状态不存在」= 拿到的是验证页（body 很短、没有 user_unique_id），官方建议配 cookie 或换出口 IP
    if (/直播页状态不存在/.test(l)) {
      out.verificationPage++;
      out.verificationPageAt = at;
      if (isRecent(l)) out.verificationPageRecent++;
    }
    if (/step=live_page_offline/.test(l)) out.livePageOffline++;
    if (/step=dial/.test(l)) out.upstreamDial++;
    if (/has_cookie=false/.test(l)) out.hasCookie = false;
    else if (/has_cookie(?:=true)?\b/.test(l)) out.hasCookie = true;
    const m = l.match(/(ERROR|WARN)\s+(.*?)room_id=(\S+)(?:.*?err="([^"]*)")?/);
    if (m) {
      const err = (m[4] || m[2] || '').trim();
      lastErrorMap.set(m[3], {
        roomId: m[3],
        level: m[1],
        time: at,
        error: err.slice(0, 160)
      });
    }
  }
  out.lastErrors = [...lastErrorMap.values()];
  return out;
}

module.exports = {
  classifyCookie,
  readProxyConfig,
  effectiveCookieByRoom,
  readProxyRuntime,
  LOGIN_COOKIE_KEYS,
  ANON_COOKIE_KEYS
};
