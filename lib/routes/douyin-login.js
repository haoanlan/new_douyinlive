/**
 * 抖音扫码登录路由
 *
 * 「代理配置」抽屉里的「扫码登录」按钮走这三个接口：
 *   POST /api/douyin/qrlogin/start   → 起一个可见浏览器窗口，返回二维码（data URL）
 *   GET  /api/douyin/qrlogin/status  → 轮询扫码状态（等待 / 已扫码待确认 / 已写入 / 出错）
 *   POST /api/douyin/qrlogin/cancel  → 关窗口放弃
 *
 * 登录成功后自动把 Cookie 写进根 config.yaml 的 cookie.douyin（走 proxy-config 那套
 * 校验 + 逐行原地改 + 写完自查回滚），**不自动重启代理** —— 前端按用户的勾选再调
 * /api/service/action 的 restart-proxy，复用已经验证过的重启路径。
 */
const qrLogin = require('../douyin-qrlogin');
const proxyConfigLib = require('../proxy-config');

module.exports = async function (pathname, query, req, res, ctx) {
  const { sendJSON, sendError, bodyParse, DATA_DIR } = ctx;

  if (pathname === '/api/douyin/qrlogin/start' && req.method === 'POST') {
    const result = await qrLogin.startSession({
      root: DATA_DIR,
      onSaved: async (cookieString) => {
        // 先按代理那套规则校验一遍（例如键太少要提醒），再落盘
        const checked = proxyConfigLib.validatePatch({ 'cookie.douyin': cookieString });
        if (!checked.ok) return { ok: false, error: checked.errors.join('；') };
        const written = proxyConfigLib.writeEditableConfig(DATA_DIR, { 'cookie.douyin': cookieString });
        if (!written.ok) return { ok: false, error: written.error };
        const info = proxyConfigLib.classifyCookie(cookieString);
        return {
          ok: true,
          message:
            info.auth === 'login'
              ? `登录成功，Cookie 已写入 config.yaml（${info.keyCount} 个键，含 ${info.loginKeys.join('/')}）`
              : `Cookie 已写入 config.yaml，但没识别到登录键（${info.keyCount} 个键），可能不是登录态`
        };
      }
    });
    if (!result.ok) return sendError(res, result.error, 500);
    return sendJSON(res, result);
  }

  if (pathname === '/api/douyin/qrlogin/status' && req.method === 'GET') {
    const id = String(query.id || '');
    if (!id) return sendError(res, '缺少 id', 400);
    return sendJSON(res, qrLogin.getStatus(id));
  }

  if (pathname === '/api/douyin/qrlogin/cancel' && req.method === 'POST') {
    const body = await bodyParse(req);
    const id = String(body?.id || '');
    if (!id) return sendError(res, '缺少 id', 400);
    return sendJSON(res, await qrLogin.cancelSession(id));
  }

  return false;
};
