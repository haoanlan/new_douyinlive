/**
 * 仪表盘登录令牌。
 *
 * ## 为什么要有这个模块
 * 原来的 token 是 `base64(用户名:时间戳)` —— 谁都能伪造，而且**永不过期**：
 * 只要 `dashboard_users` 里还有这个用户名，几个月前的 token 照样能用。
 * 前端又把登录态持久化在 localStorage，于是"每次启动都不用登录就直接进页面"。
 *
 * 现在改成**按进程签发的 HMAC 令牌**：
 *   token = base64url(用户名:签发时间) + '.' + HMAC-SHA256(secret, payload)
 *   secret 是每次启动随机生成的（32 字节），只活在内存里。
 *
 * 由此得到两个行为：
 *   1. 重启仪表盘 = secret 变了 → 之前所有 token 立即失效 →
 *      前端下一次请求收到 401 → 自动回登录页（这就是"每次启动都要登录"）。
 *   2. 令牌自带签发时间，超过 TTL 也会失效，不再有"永久有效"的口子。
 *
 * 页面刷新（不重启后端）不受影响：secret 没变，token 继续有效。
 */
const crypto = require('crypto');

/** 令牌有效期：12 小时（重启会立刻失效，这个上限只是兜底） */
const TTL_MS = 12 * 60 * 60 * 1000;

let SECRET = '';

/** 进程启动时调用一次；没调用也会在首次使用时惰性生成 */
function init(secret) {
  SECRET = String(secret || crypto.randomBytes(32).toString('hex'));
  return SECRET;
}

function ensureSecret() {
  if (!SECRET) SECRET = crypto.randomBytes(32).toString('hex');
  return SECRET;
}

function sign(payload) {
  return crypto.createHmac('sha256', ensureSecret()).update(payload).digest('base64url');
}

/**
 * 签发令牌
 * @param {string} userName 用户名
 * @param {number} [ttlMs] 有效期
 */
function issue(userName, ttlMs = TTL_MS) {
  const issuedAt = Date.now();
  const payload = `${userName}:${issuedAt}:${ttlMs}`;
  return `${Buffer.from(payload).toString('base64url')}.${sign(payload)}`;
}

/**
 * 校验令牌
 * @returns {{userName: string, issuedAt: number} | null} 无效/过期返回 null
 */
function verify(token) {
  if (!token || typeof token !== 'string') return null;
  const dot = token.lastIndexOf('.');
  if (dot <= 0) return null;
  const body = token.slice(0, dot);
  const sig = token.slice(dot + 1);

  let payload;
  try {
    payload = Buffer.from(body, 'base64url').toString('utf8');
  } catch {
    return null;
  }

  const expect = sign(payload);
  const a = Buffer.from(sig);
  const b = Buffer.from(expect);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;

  const parts = payload.split(':');
  if (parts.length < 3) return null;
  const userName = parts[0];
  const issuedAt = Number(parts[1]);
  const ttlMs = Number(parts[2]);
  if (!userName || !Number.isFinite(issuedAt)) return null;
  if (Number.isFinite(ttlMs) && ttlMs > 0 && Date.now() - issuedAt > ttlMs) return null;

  return { userName, issuedAt };
}

/** 从 Authorization 头里取出令牌并校验 */
function fromRequest(req) {
  const auth = String((req && req.headers && req.headers.authorization) || '');
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  return verify(token);
}

module.exports = { init, ensureSecret, issue, verify, fromRequest, TTL_MS };
