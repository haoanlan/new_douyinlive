const crypto = require('crypto');

const hashPwd = (s) => crypto.createHash('sha256').update(s).digest('hex');

module.exports = async function (pathname, query, req, res, ctx) {
  const { dbInstance, sendJSON, sendError, bodyParse } = ctx;

  // --- 登录 ---
  if (pathname === '/api/auth/login' && req.method === 'POST') {
    const body = await bodyParse(req);
    const userName = String(body.userName || '').trim();
    const password = String(body.password || '');
    if (!userName || !password) return sendError(res, '请输入用户名和密码', 400);
    const user = dbInstance.prepare(
      'SELECT id, username, password, role, enabled FROM dashboard_users WHERE username = ?'
    ).get(userName);
    if (!user || user.enabled !== 1 || user.password !== hashPwd(password)) {
      return sendError(res, '用户名或密码错误', 401);
    }
    const token = Buffer.from(`${userName}:${Date.now()}`).toString('base64');
    return sendJSON(res, { token, refreshToken: token, roles: [user.role], userId: user.id, userName: user.username });
  }

  // --- 用户信息（按 token） ---
  if (pathname === '/api/user/info') {
    const auth = String(req.headers.authorization || '');
    const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
    const userName = token ? Buffer.from(token, 'base64').toString().split(':')[0] : '';
    const user = userName ? dbInstance.prepare(
      'SELECT id, username, role, enabled FROM dashboard_users WHERE username = ?'
    ).get(userName) : null;
    if (!user || user.enabled !== 1) return sendError(res, '未授权', 401);
    return sendJSON(res, { userId: user.id, userName: user.username, roles: [user.role], email: '', avatar: '' });
  }

  // --- 用户列表（分页，供系统管理页） ---
  if (pathname === '/api/user/list') {
    const current = parseInt(query.current) || 1;
    const size = parseInt(query.size) || 10;
    const keyword = String(query.userName || '').trim();
    const where = keyword ? 'WHERE username LIKE ?' : '';
    const params = keyword ? [`%${keyword}%`] : [];
    const total = dbInstance.prepare(`SELECT COUNT(*) c FROM dashboard_users ${where}`).get(...params).c;
    const rows = dbInstance.prepare(
      `SELECT id, username, role, enabled, create_time
       FROM dashboard_users ${where} ORDER BY id LIMIT ? OFFSET ?`
    ).all(...params, size, (current - 1) * size);
    const list = rows.map((r) => ({
      id: r.id,
      userName: r.username,
      userRoles: [r.role],
      status: r.enabled === 1 ? '1' : '0',
      createTime: r.create_time,
      avatar: '',
      nickName: r.username,
      userPhone: '',
      userEmail: '',
      createBy: '',
      updateBy: '',
      updateTime: ''
    }));
    return sendJSON(res, { records: list, current, size, total });
  }

  return false;
};
