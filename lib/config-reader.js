/**
 * config.yaml 统一解析模块
 *
 * 替代之前散落在 check-fanbadge.js、lib/douyin-api.js、monitor.js、
 * web-dashboard.js、sync-gift-icons.js 中的 5 种不同正则解析。
 *
 * 统一规则：
 * - 支持 YAML 单引号、双引号、无引号三种值格式
 * - 正确处理 cookie.douyin 和 dashboard.token 的嵌套结构
 * - 路径自动从项目根目录（本文件的上两级）查找 config.yaml
 */
const fs = require('fs');
const path = require('path');

// 项目根目录（lib/ 的上一级）
const PROJECT_ROOT = path.join(__dirname, '..');
const CONFIG_PATH = path.join(PROJECT_ROOT, 'config.yaml');

let _cache = null;
let _mtime = 0;

/**
 * 读取 config.yaml 原始文本（带 mtime 缓存）
 * @returns {string} config.yaml 内容，文件不存在时返回空字符串
 */
function readRaw() {
  try {
    const stat = fs.statSync(CONFIG_PATH);
    const mt = stat.mtimeMs;
    if (_cache && mt === _mtime) return _cache;
    _cache = fs.readFileSync(CONFIG_PATH, 'utf-8');
    _mtime = mt;
    return _cache;
  } catch {
    return '';
  }
}

/**
 * 从 YAML 文本中提取嵌套键的值
 * 支持 single/double/no-quote 三种格式
 *
 * @param {string} yaml - YAML 原始文本
 * @param {string} parentKey - 父键名（如 "cookie"）
 * @param {string} childKey - 子键名（如 "douyin"）
 * @returns {string} 提取到的值，未找到返回空字符串
 */
function extractNestedValue(yaml, parentKey, childKey) {
  // 第一步：找到 parentKey: 下的缩进块
  const parentRe = new RegExp(`^${parentKey}:\\s*\\n((?:[ \\t]+.*\\n?)*)`, 'm');
  const parentMatch = yaml.match(parentRe);
  if (!parentMatch) return '';
  const block = parentMatch[1];
  // 第二步：在块内查找 childKey: 'value' / "value" / value
  const childRe = new RegExp(
    `^\\s*${childKey}:\\s*(?:'([^']*)'|"([^"]*)"|([^\\s\\n#]+))`,
    'm'
  );
  const m = block.match(childRe);
  if (!m) return '';
  return (m[1] ?? m[2] ?? m[3] ?? '').trim();
}

/**
 * 从 YAML 文本中提取顶层键的值
 * @param {string} yaml - YAML 原始文本
 * @param {string} key - 键名
 * @returns {string} 提取到的值
 */
function extractTopValue(yaml, key) {
  const re = new RegExp(`^${key}:\\s*(?:'([^']*)'|"([^"]*)"|([^\\s\\n#]+))`, 'm');
  const m = yaml.match(re);
  if (!m) return '';
  return (m[1] ?? m[2] ?? m[3] ?? '').trim();
}

// ===================== 公共 API =====================

/**
 * 获取抖音 Cookie
 * @returns {string} cookie 字符串，未配置返回空字符串
 */
function getCookie() {
  return extractNestedValue(readRaw(), 'cookie', 'douyin');
}

/**
 * 获取仪表盘 Token
 * 优先读环境变量 DASHBOARD_TOKEN
 * @returns {string} token，未配置返回空字符串
 */
function getDashboardToken() {
  if (process.env.DASHBOARD_TOKEN) return process.env.DASHBOARD_TOKEN;
  return extractNestedValue(readRaw(), 'dashboard', 'token');
}

/**
 * 获取仪表盘绑定地址
 * 优先读环境变量 DASHBOARD_HOST
 * @returns {string} 绑定地址，默认 127.0.0.1
 */
function getDashboardHost() {
  if (process.env.DASHBOARD_HOST) return process.env.DASHBOARD_HOST;
  const val = extractNestedValue(readRaw(), 'dashboard', 'host');
  return val || '127.0.0.1';
}

/**
 * 获取仪表盘端口
 * 优先读环境变量 DASHBOARD_PORT
 * @returns {string} 端口，默认 9871
 */
function getDashboardPort() {
  if (process.env.DASHBOARD_PORT) return process.env.DASHBOARD_PORT;
  const val = extractNestedValue(readRaw(), 'dashboard', 'port');
  return val || '9871';
}

/**
 * 获取仪表盘用户名
 * 优先读环境变量 DASHBOARD_USERNAME
 * @returns {string} 用户名，默认 admin
 */
function getDashboardUsername() {
  if (process.env.DASHBOARD_USERNAME) return process.env.DASHBOARD_USERNAME;
  const val = extractNestedValue(readRaw(), 'dashboard', 'username');
  return val || 'admin';
}

/**
 * 获取仪表盘密码
 * 优先读环境变量 DASHBOARD_PASSWORD
 * @returns {string} 密码，未配置返回空字符串
 */
function getDashboardPassword() {
  if (process.env.DASHBOARD_PASSWORD) return process.env.DASHBOARD_PASSWORD;
  return extractNestedValue(readRaw(), 'dashboard', 'password');
}

/**
 * 获取 config.yaml 的完整路径
 * @returns {string}
 */
function getConfigPath() {
  return CONFIG_PATH;
}

module.exports = {
  readRaw,
  getCookie,
  getDashboardToken,
  getDashboardHost,
  getDashboardPort,
  getDashboardUsername,
  getDashboardPassword,
  getConfigPath,
  // 导出底层函数供特殊场景使用
  extractNestedValue,
  extractTopValue,
};
