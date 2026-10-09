const crypto = require('crypto');
const authToken = require('../auth-token');

const hashPwd = (s) => crypto.createHash('sha256').update(String(s)).digest('hex');
const nowText = () => new Date().toLocaleString('sv-SE').replace('T', ' ');
const ROLES = ['R_SUPER', 'R_GUEST'];

module.exports = async function (pathname, query, req, res, ctx) {
  const { dbInstance, sendJSON, sendError, bodyParse } = ctx;

  /** 取当前登录用户（含角色）；未登录/已被禁用返回 null */
  const currentUser = () => {
    const session = authToken.fromRequest(req);
    if (!session) return null;
    const u = dbInstance
      .prepare('SELECT id, username, role, enabled FROM dashboard_users WHERE username = ?')
      .get(session.userName);
    return u && u.enabled === 1 ? u : null;
  };
  /** 只有管理员能改账号 */
  const requireSuper = () => {
    const me = currentUser();
    if (!me) {
      sendError(res, '未授权', 401);
      return null;
    }
    if (me.role !== 'R_SUPER') {
      sendError(res, '只有管理员可以管理账号', 403);
      return null;
    }
    return me;
  };
  /** 还剩几个启用的管理员（用于"不能把自己锁在外面"这类保护） */
  const enabledSupers = (exceptId) =>
    dbInstance
      .prepare(
        `SELECT COUNT(*) c FROM dashboard_users
         WHERE role = 'R_SUPER' AND enabled = 1 ${exceptId ? 'AND id != ?' : ''}`
      )
      .get(...(exceptId ? [exceptId] : [])).c;

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

    // 令牌按进程签发：重启仪表盘后旧令牌自动失效（= 每次启动都要重新登录）
    const token = authToken.issue(user.username);

    // 记录本次登录时间，个人中心要显示"上次登录"
    try {
      dbInstance.prepare('UPDATE dashboard_users SET last_login_time = ? WHERE id = ?').run(nowText(), user.id);
    } catch (e) {
      /* 老库没有这一列也不影响登录 */
    }

    return sendJSON(res, {
      token,
      refreshToken: token,
      roles: [user.role],
      role: user.role,
      userId: user.id,
      userName: user.username
    });
  }

  // --- 用户信息（按 token） ---
  if (pathname === '/api/user/info') {
    const session = authToken.fromRequest(req);
    const user = session
      ? dbInstance.prepare(
          'SELECT id, username, role, enabled, create_time, last_login_time FROM dashboard_users WHERE username = ?'
        ).get(session.userName)
      : null;
    if (!user || user.enabled !== 1) return sendError(res, '未授权', 401);
    return sendJSON(res, {
      userId: user.id,
      userName: user.username,
      roles: [user.role],
      role: user.role,
      email: '',
      avatar: '',
      createTime: user.create_time || '',
      lastLoginTime: user.last_login_time || '',
      // 令牌策略告知前端：后端一重启，旧令牌就失效
      tokenPolicy: '仪表盘每次启动后都需要重新登录（令牌只在本次运行期间有效）'
    });
  }

  // --- 修改自己的密码 ---
  if (pathname === '/api/user/password' && req.method === 'POST') {
    const session = authToken.fromRequest(req);
    if (!session) return sendError(res, '未授权', 401);
    const body = await bodyParse(req);
    const oldPassword = String(body.oldPassword || '');
    const newPassword = String(body.newPassword || '');

    if (!oldPassword || !newPassword) return sendError(res, '请填写当前密码与新密码', 400);
    if (newPassword.length < 6) return sendError(res, '新密码至少 6 位', 400);
    if (newPassword.length > 64) return sendError(res, '新密码过长（最多 64 位）', 400);

    const user = dbInstance.prepare(
      'SELECT id, username, password, enabled FROM dashboard_users WHERE username = ?'
    ).get(session.userName);
    if (!user || user.enabled !== 1) return sendError(res, '未授权', 401);
    if (user.password !== hashPwd(oldPassword)) return sendError(res, '当前密码不正确', 400);
    if (user.password === hashPwd(newPassword)) return sendError(res, '新密码不能与当前密码相同', 400);

    dbInstance.prepare('UPDATE dashboard_users SET password = ? WHERE id = ?').run(hashPwd(newPassword), user.id);
    return sendJSON(res, { ok: true, message: '密码已修改，请用新密码重新登录' });
  }

  // --- 用户管理（仅管理员） ---
  if (pathname === '/api/user/create' && req.method === 'POST') {
    const me = requireSuper();
    if (!me) return;
    const body = await bodyParse(req);
    const userName = String(body.userName || '').trim();
    const password = String(body.password || '');
    const role = ROLES.includes(body.role) ? body.role : 'R_GUEST';
    if (userName.length < 2 || userName.length > 32) return sendError(res, '用户名长度需在 2~32 位', 400);
    if (!/^[\w.@-]+$/.test(userName)) return sendError(res, '用户名只能含字母、数字与 _ . @ -', 400);
    if (password.length < 6) return sendError(res, '密码至少 6 位', 400);
    const exists = dbInstance.prepare('SELECT id FROM dashboard_users WHERE username = ?').get(userName);
    if (exists) return sendError(res, `用户名 ${userName} 已存在`, 409);
    dbInstance
      .prepare('INSERT INTO dashboard_users (username, password, role, enabled) VALUES (?, ?, ?, 1)')
      .run(userName, hashPwd(password), role);
    return sendJSON(res, { ok: true, message: `已创建账号 ${userName}（${role === 'R_SUPER' ? '管理员' : '普通用户'}）` });
  }

  if (pathname === '/api/user/update' && req.method === 'POST') {
    const me = requireSuper();
    if (!me) return;
    const body = await bodyParse(req);
    const id = Number(body.id);
    const target = dbInstance.prepare('SELECT id, username, role, enabled FROM dashboard_users WHERE id = ?').get(id);
    if (!target) return sendError(res, '账号不存在', 404);

    const nextEnabled = body.enabled === undefined ? target.enabled : body.enabled ? 1 : 0;
    const nextRole = ROLES.includes(body.role) ? body.role : target.role;

    // 保护：不能把最后一个启用的管理员禁用/降级，否则没人能再进来管理
    const losingSuper =
      target.role === 'R_SUPER' && target.enabled === 1 && (nextEnabled === 0 || nextRole !== 'R_SUPER');
    if (losingSuper && enabledSupers(target.id) === 0) {
      return sendError(res, '这是最后一个启用的管理员，不能禁用或降级（否则没人能管理账号）', 400);
    }
    if (target.id === me.id && nextEnabled === 0) {
      return sendError(res, '不能禁用当前登录的账号', 400);
    }
    dbInstance
      .prepare('UPDATE dashboard_users SET enabled = ?, role = ? WHERE id = ?')
      .run(nextEnabled, nextRole, id);
    return sendJSON(res, { ok: true, message: `已更新 ${target.username}` });
  }

  if (pathname === '/api/user/reset-password' && req.method === 'POST') {
    const me = requireSuper();
    if (!me) return;
    const body = await bodyParse(req);
    const id = Number(body.id);
    const newPassword = String(body.newPassword || '');
    if (newPassword.length < 6) return sendError(res, '密码至少 6 位', 400);
    const target = dbInstance.prepare('SELECT id, username FROM dashboard_users WHERE id = ?').get(id);
    if (!target) return sendError(res, '账号不存在', 404);
    dbInstance.prepare('UPDATE dashboard_users SET password = ? WHERE id = ?').run(hashPwd(newPassword), id);
    return sendJSON(res, { ok: true, message: `已重置 ${target.username} 的密码` });
  }

  if (pathname === '/api/user/delete' && req.method === 'POST') {
    const me = requireSuper();
    if (!me) return;
    const body = await bodyParse(req);
    const id = Number(body.id);
    const target = dbInstance.prepare('SELECT id, username, role, enabled FROM dashboard_users WHERE id = ?').get(id);
    if (!target) return sendError(res, '账号不存在', 404);
    if (target.id === me.id) return sendError(res, '不能删除当前登录的账号', 400);
    if (target.role === 'R_SUPER' && target.enabled === 1 && enabledSupers(target.id) === 0) {
      return sendError(res, '这是最后一个启用的管理员，不能删除', 400);
    }
    dbInstance.prepare('DELETE FROM dashboard_users WHERE id = ?').run(id);
    return sendJSON(res, { ok: true, message: `已删除账号 ${target.username}` });
  }

  // --- 用户列表（分页，供系统管理页；需要登录） ---
  if (pathname === '/api/user/list') {
    if (!authToken.fromRequest(req)) return sendError(res, '未授权', 401);
    const current = parseInt(query.current) || 1;
    const size = parseInt(query.size) || 10;
    const keyword = String(query.userName || '').trim();
    const where = keyword ? 'WHERE username LIKE ?' : '';
    const params = keyword ? [`%${keyword}%`] : [];
    const total = dbInstance.prepare(`SELECT COUNT(*) c FROM dashboard_users ${where}`).get(...params).c;
    const rows = dbInstance.prepare(
      `SELECT id, username, role, enabled, create_time, last_login_time
       FROM dashboard_users ${where} ORDER BY id LIMIT ? OFFSET ?`
    ).all(...params, size, (current - 1) * size);
    const list = rows.map((r) => ({
      id: r.id,
      userName: r.username,
      userRoles: [r.role],
      status: r.enabled === 1 ? '1' : '0',
      createTime: r.create_time,
      updateTime: r.last_login_time || '',
      avatar: '',
      nickName: r.username,
      userPhone: '',
      userEmail: '',
      createBy: '',
      updateBy: ''
    }));
    return sendJSON(res, { records: list, current, size, total });
  }

  return false;
};
