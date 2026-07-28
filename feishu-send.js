/**
 * 飞书消息发送工具
 * 使用 tenant_access_token 直接调飞书 Open API 发送卡片消息
 * 不走 OpenClaw 的消息工具（避免 interactive card 支持问题）
 */
const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');

// Feishu Open API 地址
const FEISHU_HOST = 'open.feishu.cn';

/**
 * 从 .env 读取 feishu 凭证
 */
function getFeishuCredentials() {
  const envPath = path.join(__dirname, '.env');
  if (!fs.existsSync(envPath)) {
    feishuLog('[ERROR] .env not found at', envPath);
    return null;
  }
  try {
    const envContent = fs.readFileSync(envPath, 'utf-8');
    const get = (key) => {
      const m = envContent.match(new RegExp(`^${key}=['"]?([^'"]+)['"]?`, 'm'));
      return m ? m[1] : '';
    };
    const appId = get('FEISHU_APP_ID');
    const appSecret = get('FEISHU_APP_SECRET');
    if (!appId || !appSecret) {
      feishuLog('[ERROR] FEISHU_APP_ID or FEISHU_APP_SECRET missing from .env');
      return null;
    }
    return { appId, appSecret };
  } catch (e) {
    feishuLog('[ERROR] failed to read .env:', e.message);
    return null;
  }
}

/** 飞书专用日志 */
const feishuLogPath = require('path').join(__dirname, 'logs', 'feishu.log');
function feishuLog(msg) {
  const line = `[${new Date().toISOString()}] ${msg}\n`;
  try { require('fs').appendFileSync(feishuLogPath, line); } catch(e) {}
  // 同时输出到 stdout 以便 daemon.log 捕获
  process.stdout.write(line);
}

/**
 * HTTPS 请求封装
 */
function request(method, host, pathname, headers, body) {
  return new Promise((resolve, reject) => {
    const opts = {
      hostname: host,
      path: pathname,
      method: method,
      headers: headers,
    };
    const req = https.request(opts, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, body: JSON.parse(data) });
        } catch (e) {
          resolve({ status: res.statusCode, body: data });
        }
      });
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

/**
 * 获取 tenant_access_token
 */
async function getToken() {
  const creds = getFeishuCredentials();
  if (!creds) return null;

  const body = JSON.stringify({
    app_id: creds.appId,
    app_secret: creds.appSecret,
  });

  const res = await request('POST', FEISHU_HOST, '/open-apis/auth/v3/tenant_access_token/internal', {
    'Content-Type': 'application/json',
  }, body);

  if (res.status !== 200 || !res.body?.tenant_access_token) {
    feishuLog('[ERROR] token request failed:', res.status, JSON.stringify(res.body));
    return null;
  }

  return res.body.tenant_access_token;
}

/**
 * 发送卡片消息到指定会话
 * @param {string} chatId - 飞书会话 chat_id (如 oc_xxx)
 * @param {object} card - 卡片对象 {config, header, elements}
 * @returns {Promise<boolean>} 是否成功
 */
async function sendCard(chatId, card) {
  const token = await getToken();
  if (!token) {
    feishuLog('[ERROR] no token, cannot send card');
    return false;
  }

  // 构建消息体 — 注意飞书 API 要求卡片包在 content.card 里
  const body = JSON.stringify({
    receive_id: chatId,
    msg_type: 'interactive',
    content: JSON.stringify(card),  // content 本身是 JSON 字符串化的卡片对象
  });

  const url = `/open-apis/im/v1/messages?receive_id_type=chat_id`;
  const res = await request('POST', FEISHU_HOST, url, {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${token}`,
  }, body);

  if (res.status === 200 && res.body?.code === 0) {
    feishuLog('[OK] card sent successfully, msg_id:', res.body.data?.message_id);
    return true;
  }

  feishuLog('[ERROR] send card failed:', res.status, JSON.stringify(res.body));
  return false;
}

/**
 * 上传图片到飞书并获取 image_key
 * @param {string} imagePath - 本地图片路径
 * @param {string} imageType - 图片类型: 'message' (默认) 或 'avatar'
 * @returns {Promise<string|null>} image_key
 */
async function uploadImage(imagePath, imageType = 'message') {
  const token = await getToken();
  if (!token) return null;

  const fileBuffer = fs.readFileSync(imagePath);
  const boundary = '----WebKitFormBoundary' + Date.now().toString(36);

  let body = '';
  body += '--' + boundary + '\r\n';
  body += 'Content-Disposition: form-data; name="image_type"\r\n\r\n';
  body += imageType + '\r\n';
  body += '--' + boundary + '\r\n';
  body += 'Content-Disposition: form-data; name="image"; filename="report.jpg"\r\n';
  body += 'Content-Type: image/jpeg\r\n\r\n';

  const bodyStart = Buffer.from(body, 'utf-8');
  const bodyEnd = Buffer.from('\r\n--' + boundary + '--\r\n', 'utf-8');
  const fullBody = Buffer.concat([bodyStart, fileBuffer, bodyEnd]);

  feishuLog(`[uploadImage] → size=${fileBuffer.length} bytes`);
  const res = await request('POST', FEISHU_HOST, '/open-apis/im/v1/images', {
    'Content-Type': 'multipart/form-data; boundary=' + boundary,
    'Authorization': 'Bearer ' + token,
    'Content-Length': String(fullBody.length),
  }, fullBody);

  if (res.status === 200 && res.body?.code === 0) {
    feishuLog(`[uploadImage] ✓ key=${res.body.data?.image_key}`);
    return res.body.data?.image_key || null;
  }

  feishuLog(`[uploadImage] ✗ status=${res.status} body=${JSON.stringify(res.body)}`);
  return null;
}

/**
 * 发送图片消息到指定会话
 * @param {string} chatId - 飞书会话 chat_id
 * @param {string} imagePath - 本地图片路径
 * @returns {Promise<boolean>} 是否成功
 */
async function sendImage(chatId, imagePath, receiveIdType = 'open_id') {
  feishuLog(`[sendImage] → ${receiveIdType}:${chatId} file=${imagePath}`);
  const imageKey = await uploadImage(imagePath);
  if (!imageKey) return false;

  const token = await getToken();
  if (!token) return false;

  const body = JSON.stringify({
    receive_id: chatId,
    msg_type: 'image',
    content: JSON.stringify({ image_key: imageKey }),
  });

  const url = `/open-apis/im/v1/messages?receive_id_type=${receiveIdType}`;
  const res = await request('POST', FEISHU_HOST, url, {
    'Content-Type': 'application/json',
    'Authorization': 'Bearer ' + token,
  }, body);

  if (res.status === 200 && res.body?.code === 0) {
    feishuLog(`[sendImage] ✓ msg_id=${res.body.data?.message_id}`);
    return true;
  }

  feishuLog(`[sendImage] ✗ status=${res.status} body=${JSON.stringify(res.body)}`);
  return false;
}

/**
 * 发送文本消息到指定会话
 * @param {string} chatId - 飞书会话 chat_id
 * @param {string} text - 文本内容
 * @returns {Promise<boolean>}
 */
async function sendText(chatId, text, receiveIdType = 'open_id') {
  const token = await getToken();
  if (!token) return false;

  const body = JSON.stringify({
    receive_id: chatId,
    msg_type: 'text',
    content: JSON.stringify({ text }),
  });

  const url = `/open-apis/im/v1/messages?receive_id_type=${receiveIdType}`;
  feishuLog(`[sendText] → ${receiveIdType}:${chatId} len=${text.length}`);
  const res = await request('POST', FEISHU_HOST, url, {
    'Content-Type': 'application/json',
    'Authorization': 'Bearer ' + token,
  }, body);

  if (res.status === 200 && res.body?.code === 0) {
    feishuLog(`[sendText] ✓ msg_id=${res.body.data?.message_id}`);
    return true;
  }

  feishuLog(`[sendText] ✗ status=${res.status} body=${JSON.stringify(res.body)}`);
  return false;
}

module.exports = { sendCard, sendImage, sendText, getFeishuCredentials };
