#!/usr/bin/env node
/**
 * 抖音直播监控 - Web 仪表板
 * 端口: 9871
 * 功能: 场次管理、礼物排行、弹幕记录、用户画像、趋势分析、CSV导出、图片报告
 */
const http = require('http');
const path = require('path');
const fs = require('fs');
const url = require('url');
const zlib = require('zlib');
const db = require('./db-sqlite.js');
const reportImg = require('./report-image.js');
const { comboDedupGifts } = require('./lib/gift-utils.js');
const { getAvatarBySecUid, getAvatarByNickname } = require('./lib/avatar-utils');
const { getCookie, getDashboardToken, getDashboardHost, getDashboardPort, getDashboardUsername, getDashboardPassword } = require('./lib/config-reader');

const routeHandlers = [
  require('./lib/routes/auth'),
  require('./lib/routes/overview'),
  require('./lib/routes/rooms'),
  require('./lib/routes/sessions'),
  require('./lib/routes/detail'),
  require('./lib/routes/gifts'),
  require('./lib/routes/users'),
  require('./lib/routes/misc'),
];

// ====== 连击去重（使用共享模块 lib/gift-utils.js）======

const PORT = getDashboardPort();
const HOST = getDashboardHost();
const DATA_DIR = __dirname;

// ====== 仪表盘认证 Token（使用共享模块 lib/config-reader.js）======
const AUTH_TOKEN = getDashboardToken();
const AUTH_USERNAME = getDashboardUsername();
const AUTH_PASSWORD = getDashboardPassword();

// ====== 认证中间件 ======
function checkAuth(req, res) {
  // 登录入口与用户列表免认证（列表仅本机演示）
  const { pathname } = parseQuery(req.url);
  if (pathname === '/api/auth/login' || pathname === '/api/user/list') return true;
  const auth = String(req.headers.authorization || '');
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  const userName = token ? Buffer.from(token, 'base64').toString().split(':')[0] : '';
  if (!userName) {
    res.writeHead(401, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ error: '未授权，请先登录' }));
    return false;
  }
  const user = db.getDb().prepare(
    'SELECT id, username, enabled FROM dashboard_users WHERE username = ?'
  ).get(userName);
  if (!user || user.enabled !== 1) {
    res.writeHead(401, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ error: '未授权，请先登录' }));
    return false;
  }
  return true;
}

// ====== 读取抖音Cookie（使用共享模块 lib/config-reader.js）======

// ====== 工具函数 ======
async function sendJSON(res, data, status = 200) {
  if (res.headersSent) return true;
  const json = JSON.stringify(data);
  const accept = res.req?.headers?.['accept-encoding'] || '';
  if (accept.includes('gzip') && json.length > 1024) {
    const buf = Buffer.from(json);
    const compressed = await new Promise((resolve, reject) => {
      zlib.gzip(buf, (err, result) => err ? reject(err) : resolve(result));
    });
    if (!res.headersSent) {
      res.writeHead(status, {
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Encoding': 'gzip',
        'Access-Control-Allow-Origin': '*'
      });
    }
    res.end(compressed);
  } else {
    if (!res.headersSent) {
      res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*' });
    }
    res.end(json);
  }
  return true;
}

function sendError(res, msg, status = 500) {
  sendJSON(res, { error: msg }, status);
}

function sendCSV(res, filename, rows, headers) {
  res.writeHead(200, {
    'Content-Type': 'text/csv; charset=utf-8',
    'Content-Disposition': `attachment; filename="${encodeURIComponent(filename)}"`,
    'Access-Control-Allow-Origin': '*'
  });
  // BOM for Excel
  res.write('\uFEFF');
  res.write(headers.join(',') + '\n');
  for (const row of rows) {
    res.write(row.map(v => `"${String(v ?? '').replace(/"/g, '""')}"`).join(',') + '\n');
  }
  res.end();
}

function parseQuery(reqUrl) {
  const u = new URL(reqUrl, 'http://localhost');
  const q = {};
  for (const [k, v] of u.searchParams) q[k] = v;
  return { pathname: u.pathname, query: q };
}

function bodyParse(req, maxBytes = 10 * 1024 * 1024) {
  return new Promise((resolve) => {
    let body = '';
    let size = 0;
    let tooLarge = false;
    req.on('data', chunk => {
      if (tooLarge) return;
      size += chunk.length;
      if (size > maxBytes) { tooLarge = true; body = ''; return; }
      body += chunk;
    });
    req.on('end', () => {
      if (tooLarge) { resolve({ _error: 'body too large' }); return; }
      try { resolve(JSON.parse(body)); } catch { resolve({}); }
    });
  });
}

// ====== API 路由 ======
async function handleAPI(req, res) {
  const { pathname, query } = parseQuery(req.url);
  const dbInstance = db.getDb();
  const ctx = { dbInstance, sendJSON, sendError, sendCSV, parseQuery, bodyParse, comboDedupGifts, getAvatarBySecUid, getAvatarByNickname, DATA_DIR, reportImg, getCookie };
  try {
    for (const handler of routeHandlers) {
      if (await handler(pathname, query, req, res, ctx)) return;
    }
    sendError(res, 'API 不存在', 404);
  } catch (e) {
    console.error('[API]', e.message);
    sendError(res, e.message);
  }
}

// ====== 静态文件服务 ======
async function serveStatic(req, res) {
  const { pathname } = parseQuery(req.url);
  let filePath;
  const VUE_DIST = path.join(DATA_DIR, 'frontend', 'dist');
  if (pathname === '/' || pathname === '/index.html') {
    filePath = path.join(VUE_DIST, 'index.html');
  } else {
    filePath = path.join(VUE_DIST, pathname);
    // fallback to DATA_DIR for API assets etc
    if (!await fs.promises.access(filePath).then(() => true).catch(() => false)) {
      filePath = path.join(DATA_DIR, pathname);
    }
  }

  // 安全检查：防止目录遍历（使用 path.resolve 确保规范化路径）
  const resolvedPath = path.resolve(filePath);
  const resolvedDataDir = path.resolve(DATA_DIR) + path.sep;
  if (!resolvedPath.startsWith(resolvedDataDir)) {
    res.writeHead(403); res.end('Forbidden'); return;
  }

  // 屏蔽敏感文件（config、备份、数据库、日志）
  const blockedExts = ['.yaml', '.yml', '.bak', '.db', '.db-journal', '.jsonl'];
  if (blockedExts.some(e => filePath.endsWith(e)) || filePath.endsWith('.log') || path.basename(filePath).startsWith('.')) {
    res.writeHead(403); res.end('Forbidden'); return;
  }

  if (!await fs.promises.access(filePath).then(() => true).catch(() => false)) {
    // SPA fallback: 非 API 路由返回 index.html
    if (!pathname.startsWith('/api/')) {
      filePath = path.join(VUE_DIST, 'index.html');
    } else {
      res.writeHead(404); res.end('Not Found'); return;
    }
  }

  const ext = path.extname(filePath).toLowerCase();
  const mimeTypes = {
    '.html': 'text/html', '.css': 'text/css', '.js': 'application/javascript',
    '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg',
    '.svg': 'image/svg+xml', '.ico': 'image/x-icon'
  };
  const contentType = mimeTypes[ext] || 'application/octet-stream';
  const accept = req.headers?.['accept-encoding'] || '';
  // gzip 压缩文本文件（>1KB）
  if (accept.includes('gzip') && (ext === '.html' || ext === '.css' || ext === '.js' || ext === '.json')) {
    try {
      const buf = await fs.promises.readFile(filePath);
      if (buf.length > 1024) {
        const compressed = await new Promise((resolve, reject) => {
          zlib.gzip(buf, (err, result) => err ? reject(err) : resolve(result));
        });
        // 带 hash 的静态资源长期缓存，index.html 不缓存
        const isHashed = /\-[A-Za-z0-9]{8}\.(css|js)$/.test(pathname);
        const cacheControl = pathname === '/' || pathname === '/index.html'
          ? 'no-cache'
          : isHashed ? 'public, max-age=31536000, immutable' : 'public, max-age=3600';
        res.writeHead(200, {
          'Content-Type': contentType,
          'Content-Encoding': 'gzip',
          'Cache-Control': cacheControl
        });
        res.end(compressed);
        return;
      }
    } catch (e) {
      // 读取失败，fallback 到非压缩
    }
  }
  // 非压缩响应也加缓存头
  const isHashed = /\-[A-Za-z0-9]{8}\.(css|js)$/.test(pathname);
  const cacheControl = pathname === '/' || pathname === '/index.html'
    ? 'no-cache'
    : isHashed ? 'public, max-age=31536000, immutable' : 'public, max-age=3600';
  res.writeHead(200, { 'Content-Type': contentType, 'Cache-Control': cacheControl });
  fs.createReadStream(filePath).pipe(res);
}

// ====== 主服务器 ======
const server = http.createServer(async (req, res) => {
  // CORS 预检（使用白名单，不反射 Origin）
  if (req.method === 'OPTIONS') {
    const origin = req.headers.origin || '';
    const allowed = origin === `http://127.0.0.1:${PORT}` || origin === `http://localhost:${PORT}`;
    res.writeHead(204, {
      'Access-Control-Allow-Origin': allowed ? origin : '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization'
    });
    return res.end();
  }

  const { pathname } = parseQuery(req.url);

  if (pathname.startsWith('/api/')) {
    // API 路由需要认证
    if (!checkAuth(req, res)) return;
    await handleAPI(req, res);
  } else {
    serveStatic(req, res);
  }
});

// 启动
async function start() {
  await db.init();
  server.listen(PORT, HOST, () => {
    console.log(`[dashboard] 仪表板已启动: http://${HOST}:${PORT}`);
    if (!AUTH_TOKEN) {
      console.warn('[dashboard] ⚠️ 警告: 未设置 DASHBOARD_TOKEN，仪表盘无认证保护！');
      console.warn('[dashboard] ⚠️ 请在 config.yaml 中设置 dashboard.token 或设置环境变量 DASHBOARD_TOKEN');
    } else {
      console.log('[dashboard] 已启用 Token 认证');
    }
    if (HOST === '0.0.0.0') {
      console.warn('[dashboard] ⚠️ 警告: 绑定 0.0.0.0，仪表盘可被外部网络访问');
    }
  });
}

start().catch(e => {
  console.error('[dashboard] 启动失败:', e.message);
  process.exit(1);
});