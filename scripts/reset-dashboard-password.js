#!/usr/bin/env node
/**
 * 重置仪表盘账号密码（忘记密码时用）。
 *
 * 用法：
 *   node scripts/reset-dashboard-password.js 新密码              # 改 admin
 *   node scripts/reset-dashboard-password.js 用户名 新密码        # 改指定账号
 *   node scripts/reset-dashboard-password.js --list              # 看有哪些账号
 *
 * 说明：仪表盘的账号存在 db/douyin.db 的 dashboard_users 表里，密码是 sha256。
 * 没有"邮箱找回"这类流程（也不需要邮箱），忘记密码就跑这个脚本 —— 它必须能
 * 在本机执行，等于"谁能碰这台机器谁就能重置密码"，与仪表盘本身的定位一致。
 */
const crypto = require('crypto');
const path = require('path');
const Database = require('better-sqlite3');

const ROOT = path.join(__dirname, '..');
const DB_PATH = path.join(ROOT, 'db', 'douyin.db');
const hashPwd = (s) => crypto.createHash('sha256').update(String(s)).digest('hex');

const args = process.argv.slice(2);

if (!args.length || args[0] === '-h' || args[0] === '--help') {
  console.log(
    [
      '用法：',
      '  node scripts/reset-dashboard-password.js 新密码           # 重置 admin 的密码',
      '  node scripts/reset-dashboard-password.js 用户名 新密码     # 重置指定账号',
      '  node scripts/reset-dashboard-password.js --list           # 列出所有账号'
    ].join('\n')
  );
  process.exit(0);
}

const db = new Database(DB_PATH);

// 老库可能还没有这一列（正常由 db-sqlite.js 在启动时补），这里保证脚本自己也能跑
try {
  db.exec('ALTER TABLE dashboard_users ADD COLUMN last_login_time TEXT DEFAULT NULL');
} catch (e) {
  /* 已存在 */
}

if (args[0] === '--list') {
  const rows = db.prepare('SELECT id, username, role, enabled, create_time, last_login_time FROM dashboard_users').all();
  console.log(`共 ${rows.length} 个账号：`);
  for (const r of rows) {
    console.log(
      `  #${r.id} ${r.username} [${r.role === 'R_SUPER' ? '管理员' : '普通用户'}] ` +
        `${r.enabled ? '启用' : '已禁用'} 创建于 ${r.create_time || '—'} 上次登录 ${r.last_login_time || '—'}`
    );
  }
  process.exit(0);
}

const userName = args.length >= 2 ? args[0] : 'admin';
const newPassword = args.length >= 2 ? args[1] : args[0];

if (newPassword.length < 6) {
  console.error('新密码至少 6 位');
  process.exit(1);
}

const user = db.prepare('SELECT id, username FROM dashboard_users WHERE username = ?').get(userName);
if (!user) {
  const names = db.prepare('SELECT username FROM dashboard_users').all().map((r) => r.username).join(', ');
  console.error(`没有这个账号：${userName}（现有：${names}）`);
  process.exit(1);
}

db.prepare('UPDATE dashboard_users SET password = ? WHERE id = ?').run(hashPwd(newPassword), user.id);
console.log(`已重置 ${user.username} 的密码（${newPassword.length} 位）。`);
console.log('如果仪表盘正在运行，直接用新密码登录即可；已经登录的会话不受影响，除非重启仪表盘。');
