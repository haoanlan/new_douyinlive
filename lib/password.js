/**
 * 口令哈希
 *
 * 旧实现是**无盐 sha256**（`crypto.createHash('sha256').update(pwd)`）：
 *   - 无盐 → 同一口令哈希相同（实测 admin 与 guest 都是 123456，哈希完全一样）；
 *   - sha256 快 → 彩虹表/GPU 秒破，而默认口令恰好是 123456；
 *   - 库文件（1GB，此前静态服务还能未认证下载 -wal）一旦外泄，口令等于明文。
 *
 * 新格式：scrypt + 每用户 16 字节随机盐，写成 `scrypt$N$r$p$salt$hash`
 * （把参数写进哈希串，将来调参不会让旧哈希失效）。
 * **旧哈希仍可登录**，登录成功时自动升级为新格式 —— 不会把用户锁在外面。
 */
const crypto = require('crypto');

const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 64 };

/** 生成新格式哈希 */
function hashPassword(plain) {
  const salt = crypto.randomBytes(16).toString('hex');
  const key = crypto.scryptSync(String(plain), salt, SCRYPT.keylen, { N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p });
  return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt}$${key.toString('hex')}`;
}

/** 是否为旧的无盐 sha256（64 位 hex） */
function isLegacyHash(stored) {
  return typeof stored === 'string' && /^[0-9a-f]{64}$/i.test(stored);
}

/**
 * 校验口令。
 * @returns {{ ok: boolean, needsUpgrade: boolean }} needsUpgrade=true 表示命中的是旧格式，
 *          调用方应在登录成功后把它重写为新格式。
 */
function verifyPassword(plain, stored) {
  if (!stored) return { ok: false, needsUpgrade: false };
  const s = String(stored);

  if (s.startsWith('scrypt$')) {
    try {
      const [, N, r, p, salt, hex] = s.split('$');
      const want = Buffer.from(hex, 'hex');
      const key = crypto.scryptSync(String(plain), salt, want.length, { N: Number(N), r: Number(r), p: Number(p) });
      return { ok: key.length === want.length && crypto.timingSafeEqual(key, want), needsUpgrade: false };
    } catch (e) {
      return { ok: false, needsUpgrade: false };
    }
  }

  if (!isLegacyHash(s)) return { ok: false, needsUpgrade: false };
  const legacy = crypto.createHash('sha256').update(String(plain)).digest('hex');
  const same = crypto.timingSafeEqual(Buffer.from(legacy, 'hex'), Buffer.from(s, 'hex'));
  return { ok: same, needsUpgrade: same };
}

module.exports = { hashPassword, verifyPassword, isLegacyHash };
