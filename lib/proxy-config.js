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

/**
 * 可视化配置：哪些字段可以改。
 *
 * 这份白名单是**对着本机实际的二进制 v2.2.1 实测**出来的（scripts 里跑过一次逐字段测试）：
 *   ✅ port / unknown / log.level / websocket.* / sign.provider / tikhub.key
 *      / api.key / api.allowed_domains / monitor.* / cookie.*
 *   ❌ protocol.mode           → "field protocol not found in type main.configFileSchema"
 *   ❌ proxy.url / proxy.rooms → "field proxy not found in type main.configFileSchema"
 * 所以 protocol / proxy 只做提示、不允许写：写进去下次启动代理直接失败。
 */
const EDITABLE = [
  // 注意：**没有 port**。端口被应用固定（监控脚本、状态页健康检查都按 1088 探活），
  // 允许在页面上改会直接把采集打断，所以只在页面上显示、不可编辑。
  { key: 'log.level', label: '日志级别', type: 'enum', options: ['debug', 'info', 'warn', 'error'] },
  { key: 'sign.provider', label: '签名方式', type: 'enum', options: ['', 'local', 'tikhub'] },
  { key: 'tikhub.key', label: 'TikHub Key', type: 'secret' },
  { key: 'api.key', label: 'API Key', type: 'secret' },
  { key: 'monitor.poll_interval', label: '未开播轮询间隔', type: 'duration' },
  { key: 'monitor.notify_interval', label: '状态通知间隔', type: 'duration' },
  { key: 'websocket.path', label: 'WebSocket 路径', type: 'string' },
  { key: 'cookie.use_stored', label: '使用预存 Cookie', type: 'boolean' },
  { key: 'cookie.douyin', label: '默认 Cookie', type: 'secret' },
  { key: 'cookie.rooms', label: '房间专用 Cookie', type: 'map' }
];

/** 当前二进制不支持的段（出现在根 config.yaml 里会让代理启动失败） */
const UNSUPPORTED_SECTIONS = [
  { key: 'protocol', reason: '当前二进制 v2.2.1 的 schema 不含 protocol 段，写了代理会启动失败' },
  { key: 'proxy', reason: '当前二进制 v2.2.1 的 schema 不含 proxy 段（房间级代理需升级代理）' }
];

/**
 * 读取可视化配置所需的当前值（**含 cookie 明文**，只走单独的 GET 接口，不进 8 秒轮询的状态接口）
 * @param {string} root
 */
function readEditableConfig(root) {
  const file = path.join(root, 'config.yaml');
  let raw = '';
  let exists = false;
  try {
    raw = fs.readFileSync(file, 'utf-8');
    exists = true;
  } catch {
    /* 文件不存在：返回空值，前端会提示 */
  }
  const get = (key) => {
    const [parent, child] = key.split('.');
    if (!child) return (raw.match(new RegExp(`^${parent}:\\s*(?:'([^']*)'|"([^"]*)"|(\\S+))`, 'm')) || []).slice(1).find((v) => v !== undefined) || '';
    return blockValue(nestedBlock(raw, parent), child);
  };
  const values = {};
  for (const f of EDITABLE) {
    if (f.type === 'map') {
      const pairs = nestedMap(nestedBlock(raw, 'cookie'), 'rooms').filter(([, v]) => v);
      values[f.key] = Object.fromEntries(pairs);
    } else if (f.type === 'boolean') {
      values[f.key] = get(f.key) === '' ? true : get(f.key) !== 'false';
    } else {
      values[f.key] = get(f.key);
    }
  }
  const unsupported = UNSUPPORTED_SECTIONS.filter((s) => new RegExp(`^${s.key}:`, 'm').test(raw)).map((s) => ({
    ...s,
    present: true
  }));
  return { file: 'config.yaml', exists, values, unsupported, editable: EDITABLE };
}

/**
 * 校验一份 patch（只校验白名单里的键）。
 * 校验规则尽量与代理自身的规则一致 —— 代理是启动时严格校验、错了直接退出，
 * 所以在页面上就挡住，别等重启才发现起不来。
 * @returns {{ok: boolean, errors: string[], warnings: string[]}}
 */
function validatePatch(patch) {
  const errors = [];
  const warnings = [];
  const p = patch || {};
  // 端口不开放编辑：应用内部所有探活都按固定端口走，改了就断采集
  if (p.port !== undefined) errors.push('监听端口由应用固定，不支持在这里修改');
  if (p['log.level'] !== undefined) {
    const v = String(p['log.level']).trim();
    if (!['debug', 'info', 'warn', 'error'].includes(v)) errors.push(`日志级别只能是 debug/info/warn/error（收到 ${v || '空'}）`);
  }
  if (p['sign.provider'] !== undefined) {
    const v = String(p['sign.provider']).trim();
    if (!['', 'local', 'tikhub'].includes(v)) errors.push(`签名方式只能是 留空 / local / tikhub（收到 ${v}）`);
  }
  // 代理原话：sign.provider=tikhub 时必须配置 tikhub.key、APP_TIKHUB_KEY 或 --tikhub-key
  const provider = p['sign.provider'] !== undefined ? String(p['sign.provider']).trim() : null;
  const key = p['tikhub.key'] !== undefined ? String(p['tikhub.key']).trim() : null;
  if (provider === 'tikhub' && key === '') {
    errors.push('签名方式选了 tikhub 但 TikHub Key 为空 —— 代理会启动失败（原文：sign.provider=tikhub 时必须配置 tikhub.key）');
  }
  for (const k of ['monitor.poll_interval', 'monitor.notify_interval']) {
    if (p[k] === undefined) continue;
    const v = String(p[k]).trim();
    if (!/^\d+(ms|s|m|h)$/.test(v)) errors.push(`${k} 需要形如 15s / 500ms / 2m 的时长（收到 ${v || '空'}）`);
  }
  if (p['websocket.path'] !== undefined) {
    const v = String(p['websocket.path']).trim();
    if (!v.startsWith('/')) errors.push('WebSocket 路径要以 / 开头');
    else if (/^\/(health|metrics|api)(\/|$)/.test(v)) errors.push('WebSocket 路径不能占用保留路由 /health、/metrics、/api/*');
  }
  if (p['api.key'] !== undefined) {
    const v = String(p['api.key']).trim();
    if (v && v.length < 8) warnings.push('API Key 偏短，建议至少 8 位随机字符');
  }
  if (p['cookie.rooms'] !== undefined) {
    const rooms = p['cookie.rooms'];
    if (typeof rooms !== 'object' || Array.isArray(rooms)) errors.push('房间专用 Cookie 必须是「房间ID → Cookie」的对象');
    else {
      for (const [rid, cv] of Object.entries(rooms)) {
        if (!String(rid).trim()) errors.push('房间专用 Cookie 里有空房间号');
        if (!String(cv).trim()) warnings.push(`房间 ${rid} 的 Cookie 是空的，会被忽略`);
      }
    }
  }
  if (p['cookie.use_stored'] === false && (p['cookie.douyin'] || (p['cookie.rooms'] && Object.keys(p['cookie.rooms']).length))) {
    warnings.push('cookie.use_stored=false 时预存 Cookie 会被忽略（只剩匿名 ttwid）');
  }
  return { ok: errors.length === 0, errors, warnings };
}

/** YAML 标量转义：含特殊字符就用双引号包起来 */
function yamlScalar(value) {
  const s = String(value ?? '');
  if (s === '') return '""';
  if (/^[\w.\-:/]+$/.test(s)) return `"${s}"`;
  return `"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

/**
 * 写入配置：**只改白名单里的键**，其余内容（dashboard 段、注释、未知字段）原样保留。
 *
 * 做法是逐行原地改，而不是整份重写 —— 整份重写会把用户的注释和其它配置抹掉。
 * 写完先自己重新解析一遍核对，不对就回滚（改配置文件不能靠运气）。
 *
 * @returns {{ok: boolean, changed: string[], error?: string}}
 */
function writeEditableConfig(root, patch) {
  const file = path.join(root, 'config.yaml');
  const bak = `${file}.bak`;
  let lines;
  try {
    lines = fs.readFileSync(file, 'utf-8').split(/\r?\n/);
  } catch (e) {
    return { ok: false, changed: [], error: `读不到 config.yaml：${e.message}` };
  }
  const before = lines.join('\n');
  const changed = [];

  /** 找到 section 的起止行（section 行 + 其缩进更深的子行） */
  const findSection = (section) => {
    const start = lines.findIndex((l) => new RegExp(`^${section}:`).test(l));
    if (start < 0) return null;
    let end = start;
    for (let i = start + 1; i < lines.length; i++) {
      if (!lines[i].trim()) {
        end = i;
        continue;
      }
      if (!/^[ \t]/.test(lines[i])) break;
      end = i;
    }
    return { start, end };
  };

  /** 设置 `section.child` 的标量值（没有就插到该段末尾；段不存在就在文件末尾新建） */
  const setScalar = (section, child, value) => {
    const scalar = typeof value === 'boolean' ? String(value) : yamlScalar(value);
    const sec = findSection(section);
    if (!sec) {
      lines.push('', `${section}:`, `  ${child}: ${scalar}`);
    } else {
      const idx = lines.findIndex(
        (l, i) => i > sec.start && i <= sec.end + 1 && new RegExp(`^[ \\t]+${child}:`).test(l)
      );
      if (idx >= 0) {
        const indent = (lines[idx].match(/^[ \t]*/) || ['  '])[0];
        lines[idx] = `${indent}${child}: ${scalar}`;
      } else {
        // 插到段落最后一个非空子行之后
        let insertAt = sec.start + 1;
        for (let i = sec.start + 1; i <= sec.end; i++) if (lines[i].trim()) insertAt = i + 1;
        lines.splice(insertAt, 0, `  ${child}: ${scalar}`);
      }
    }
    changed.push(`${section}.${child}`);
  };

  /** 替换 `section.child` 这个映射（如 cookie.rooms） */
  const setMap = (section, child, map) => {
    const sec = findSection(section);
    if (!sec) {
      lines.push('', `${section}:`, `  ${child}:`);
      for (const [k, v] of Object.entries(map)) lines.push(`    ${yamlScalar(k)}: ${yamlScalar(v)}`);
      changed.push(`${section}.${child}`);
      return;
    }
    const idx = lines.findIndex((l, i) => i > sec.start && i <= sec.end + 1 && new RegExp(`^[ \\t]+${child}:`).test(l));
    const entries = Object.entries(map);
    if (idx < 0) {
      const insertAt = sec.end + 1;
      const block = [`  ${child}:`].concat(entries.map(([k, v]) => `    ${yamlScalar(k)}: ${yamlScalar(v)}`));
      if (!entries.length) lines.splice(insertAt, 0, `  ${child}: {}`);
      else lines.splice(insertAt, 0, ...block);
      changed.push(`${section}.${child}`);
      return;
    }
    // 删掉旧的子行
    const childIndent = (lines[idx].match(/^[ \t]*/) || ['  '])[0].length;
    let end = idx;
    for (let i = idx + 1; i < lines.length; i++) {
      if (!lines[i].trim()) {
        end = i;
        continue;
      }
      if ((lines[i].match(/^[ \t]*/) || [''])[0].length <= childIndent) break;
      end = i;
    }
    const block = !entries.length
      ? [`${' '.repeat(childIndent)}${child}: {}`]
      : [`${' '.repeat(childIndent)}${child}:`].concat(
          entries.map(([k, v]) => `${' '.repeat(childIndent + 2)}${yamlScalar(k)}: ${yamlScalar(v)}`)
        );
    lines.splice(idx, end - idx + 1, ...block);
    changed.push(`${section}.${child}`);
  };

  for (const [key, value] of Object.entries(patch || {})) {
    if (value === undefined) continue;
    const [section, child] = key.split('.');
    if (!child) continue;
    if (key === 'cookie.rooms') setMap('cookie', 'rooms', value || {});
    else setScalar(section, child, value);
  }

  const after = lines.join('\n');
  try {
    fs.writeFileSync(bak, before, 'utf-8');
    fs.writeFileSync(file, after, 'utf-8');
  } catch (e) {
    return { ok: false, changed: [], error: `写 config.yaml 失败：${e.message}` };
  }
  // 写完立刻核对：解析出来的值要和 patch 一致，否则回滚
  const verify = readEditableConfig(root);
  const bad = [];
  for (const [key, value] of Object.entries(patch || {})) {
    if (value === undefined) continue;
    const got = verify.values[key];
    if (key === 'cookie.rooms') {
      if (JSON.stringify(got || {}) !== JSON.stringify(value || {})) bad.push(key);
    } else if (key === 'cookie.use_stored') {
      if (Boolean(got) !== Boolean(value)) bad.push(key);
    } else if (String(got) !== String(value)) bad.push(key);
  }
  if (bad.length) {
    fs.writeFileSync(file, before, 'utf-8'); // 回滚
    return { ok: false, changed: [], error: `写入后核对不一致，已回滚：${bad.join(', ')}` };
  }
  return { ok: true, changed };
}

/**
 * 代理配置文件与根 config.yaml 是否一致。
 *
 * 代理只在**启动时**读一次配置，所以"改了 config.yaml 但没重启"是最容易踩的坑：
 * 页面上看着是新值，代理用的还是旧值。这里把「按 config.yaml 渲染出来的内容」
 * 和磁盘上正在被代理使用的那份逐行比一遍（忽略头部三行生成注释与空行），
 * 不一致就说明需要重启代理 —— 比只比 cookie 长度更全面（改日志级别也能发现）。
 *
 * 注：函数内懒加载 proxy-binary（那个模块反过来也会 require 本模块），
 * 运行时才解析，避免模块循环初始化。
 */
function isProxyConfigInSync(root) {
  const file = path.join(root, 'proxy-config.yaml');
  let actual = '';
  try {
    actual = fs.readFileSync(file, 'utf-8');
  } catch {
    return { exists: false, inSync: false };
  }
  const { renderProxyConfig } = require('./proxy-binary.js');
  const { content: expected } = renderProxyConfig(root);
  const norm = (s) =>
    String(s)
      .split(/\r?\n/)
      .filter((l) => l.trim() && !/^#/.test(l.trim()))
      .join('\n')
      .trim();
  return { exists: true, inSync: norm(actual) === norm(expected) };
}

module.exports = {
  classifyCookie,
  readProxyConfig,
  effectiveCookieByRoom,
  readProxyRuntime,
  readEditableConfig,
  validatePatch,
  writeEditableConfig,
  isProxyConfigInSync,
  nestedBlock,
  blockValue,
  blockHasKey,
  nestedList,
  nestedMap,
  LOGIN_COOKIE_KEYS,
  ANON_COOKIE_KEYS,
  EDITABLE,
  UNSUPPORTED_SECTIONS
};
