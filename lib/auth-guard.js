/**
 * 登录态与角色的统一校验
 *
 * 为什么单独抽出来：原来 `requireSuper` 只定义在 lib/routes/auth.js 内部（管理账号用），
 * 而真正高危的运维接口都没有做角色校验 —— 只要"已登录"就能：
 *   - POST /api/service/action            停/启/重启 监控 worker 与 Go 代理（含 taskkill）
 *   - POST /api/service/proxy-config      覆写根目录 config.yaml（含 cookie.douyin / api.key）
 *   - POST /api/douyin/qrlogin/start      拉起可见浏览器并写 Cookie
 * 而 guest 账号的默认口令同样是 123456（db-sqlite.js 种子），等于任意登录用户都能停掉采集链路。
 *
 * 鉴权口径与 web-dashboard.js 的 checkAuth 一致：Bearer token（lib/auth-token.js，按进程签发），
 * 再去库里确认账号仍启用且角色是 R_SUPER。
 */
const authToken = require('./auth-token');

/** 取当前登录用户（含角色）；未登录或已被禁用 → null */
function currentUser(req, dbInstance) {
  const session = authToken.fromRequest(req);
  if (!session) return null;
  const u = dbInstance
    .prepare('SELECT id, username, role, enabled FROM dashboard_users WHERE username = ?')
    .get(session.userName);
  return u && u.enabled === 1 ? u : null;
}

/**
 * 管理员校验：通过返回 user；否则写入 401/403 响应并返回 null。
 * 调用方拿到 null 就 `return true`（响应已发出，别再往下走别的分支）。
 */
function requireSuper(req, res, dbInstance, sendError) {
  const me = currentUser(req, dbInstance);
  if (!me) {
    sendError(res, '未授权', 401);
    return null;
  }
  if (me.role !== 'R_SUPER') {
    sendError(res, '需要管理员权限', 403);
    return null;
  }
  return me;
}

module.exports = { currentUser, requireSuper };
