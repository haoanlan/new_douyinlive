#!/usr/bin/env node

// 启动时加载 .env 文件
try {
  const fs = require('fs');
  const envPath = __dirname + '/.env';
  if (fs.existsSync(envPath)) {
    const lines = fs.readFileSync(envPath, 'utf8').split('\n');
    for (const line of lines) {
      const m = line.match(/^\s*([\w_]+)\s*=\s*(.*?)\s*$/);
      if (m && !process.env[m[1]]) {
        process.env[m[1]] = m[2].replace(/["']/g, '');
      }
    }
  }
} catch(e) {/* ignore */}

/**
 * 抖音直播间监控 - 多房间常驻守护
 *
 * 模式：
 *   --daemon              监控 config 中所有房间
 *   --daemon <room_id>    只监控指定房间
 *   stop                  停止守护进程
 *   status                查看所有房间状态
 *   snapshot [room_id]    截图
 *   report-image [room_id] 生成图片报告
 */
const { WebSocket } = require('ws');
const { spawn } = require('child_process');
const net = require('net');
const fs = require('fs');
const path = require('path');
const db = require('./db-sqlite.js');
const api = require('./lib/douyin-api.js');
const { getCookie } = require('./lib/config-reader');
const reportImg = require('./report-image.js');
const feishu = require('./feishu-send.js');

const DATA_DIR = __dirname;
const PID_FILE = path.join(DATA_DIR, 'monitor.pid');
const CONFIG_FILE = path.join(DATA_DIR, 'runtime-config.json');
const LOG_FILE = path.join(DATA_DIR, 'logs', 'daemon.log');
const CONTROL_SOCKET = path.join(DATA_DIR, 'monitor.sock');

// ====== 日志 ======
const logsDir = path.join(DATA_DIR, 'logs');
if (!fs.existsSync(logsDir)) fs.mkdirSync(logsDir, { recursive: true });

// 日志轮转：单文件最大 10MB，保留最近 3 个备份
const LOG_MAX_SIZE = 10 * 1024 * 1024;  // 10MB
const LOG_BACKUPS = 3;

function rotateLogFile(filePath) {
  try {
    const stat = fs.statSync(filePath);
    if (stat.size < LOG_MAX_SIZE) return;
    // 删除最旧的备份
    const oldest = filePath + '.' + LOG_BACKUPS;
    try { fs.unlinkSync(oldest); } catch(e) {}
    // 重命名：.2 -> .3, .1 -> .2, 当前 -> .1
    for (let i = LOG_BACKUPS - 1; i >= 1; i--) {
      const src = filePath + '.' + i;
      const dst = filePath + '.' + (i + 1);
      try { fs.renameSync(src, dst); } catch(e) {}
    }
    try { fs.renameSync(filePath, filePath + '.1'); } catch(e) {}
    console.log(`[log] 已轮转: ${filePath}`);
  } catch (e) { /* 文件不存在则忽略 */ }
}

const logStream = fs.createWriteStream(LOG_FILE, { flags: 'a' });

// 错误日志滑动窗口：每分钟最多 50 条
const _errorLogWindow = { count: 0, resetTime: Date.now() + 60000 };
const isDaemon = process.argv.includes('--daemon');
if (isDaemon) {
  // daemon 模式：stdout/stderr 重定向到 /dev/null，彻底避免 EPIPE
  const devNull = require('fs').createWriteStream('/dev/null');
  process.stdout = devNull;
  process.stderr = devNull;
}
console.log = (...args) => { const s = args.join(' '); logStream.write(`[${new Date().toISOString()}] ${s}\n`); };
console.error = (...args) => {
  const now = Date.now();
  // 滑动窗口：超过 1 分钟重置计数
  if (now > _errorLogWindow.resetTime) {
    _errorLogWindow.count = 0;
    _errorLogWindow.resetTime = now + 60000;
  }
  if (_errorLogWindow.count < 50) {
    const s = args.join(' ');
    logStream.write(`[${new Date().toISOString()}] ERROR ${s}\n`);
    _errorLogWindow.count++;
  }
};

// ====== 时区 ======
function cstISO() {
  const now = new Date();
  const cst = new Date(now.getTime() + 8 * 60 * 60 * 1000);
  return cst.toISOString().replace('Z', '+08:00');
}
function cstFileTimestamp() {
  const now = new Date();
  const cst = new Date(now.getTime() + 8 * 60 * 60 * 1000);
  return cst.toISOString().replace(/[:.]/g, '-').slice(0, 19);
}

// ====== 目录管理 ======

function setStreamerDir(room, authorName) {
  if (!authorName) return;
  const streamersDir = path.join(DATA_DIR, 'streamers');
  if (!fs.existsSync(streamersDir)) fs.mkdirSync(streamersDir, { recursive: true });
  const linksDir = path.join(DATA_DIR, 'current_sessions');
  if (!fs.existsSync(linksDir)) fs.mkdirSync(linksDir, { recursive: true });
  const dir = path.join(streamersDir, authorName.replace(/[\\/:*?"<>|]/g, '_'));
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  room.sessionDir = dir;
  room.sessionFile = path.join(dir, 'current_session.json');
  room.reportFile = path.join(dir, 'pending_report.json');
  const rootLink = path.join(linksDir, `${room.roomId}.json`);
  try { fs.unlinkSync(rootLink); } catch(e) {}
  try { fs.symlinkSync(room.sessionFile, rootLink); } catch(e) {
    try { fs.copyFileSync(room.sessionFile, rootLink); } catch(e2) {}
  }
}

// ====== 多房间状态 ======
const rooms = new Map();  // roomId -> roomState
let isShuttingDown = false;
let daemonLoopInterval = null;

/** 创建房间状态对象 */
function createRoomState(roomId) {
  return {
    roomId,
    displayName: roomId,  // 初始用roomId，获取到主播名后更新
    ws: null,
    session: null,
    sessionFile: path.join(DATA_DIR, 'current_sessions', `${roomId}.json`),
    sessionDir: DATA_DIR,
    reportFile: path.join(DATA_DIR, `pending_report_${roomId}.json`),
    isRecording: false,
    dbSessionId: null,
    dbSyncState: { danmaku: 0, gifts: 0, members: 0, online: 0, likes: 0 },
    stats: { danmakuUsers: {}, giftUsers: {} },
    liveStopTimer: null,
    lastDataTime: null,
    pendingDbUpdates: [],
    reconnectCount: 0,  // 重连次数，用于指数退避
  };
}

/** 获取房间显示名 */
function getDisplayName(room) {
  if (room.session?.room_author) return room.session.room_author;
  return room.displayName || room.roomId;
}

/** 尝试从DB加载房间名，若无则通过API查询 */
async function loadRoomName(room) {
  try {
    const d = db.getDb();
    const row = d.prepare("SELECT name FROM streamers WHERE room_id = ? AND name IS NOT NULL AND name != '' ORDER BY id DESC LIMIT 1").get(room.roomId);
    if (row && row.name) {
      room.displayName = row.name;
      return;
    }
  } catch(e) { /* ignore */ }
  
  // DB没有名字，通过API查询
  try {
    const liveInfo = await api.getLiveInfo(room.roomId);
    if (liveInfo && liveInfo.sec_uid) {
      const userInfo = await api.getUserInfo(liveInfo.sec_uid);
      if (userInfo && userInfo.nickname) {
        room.displayName = userInfo.nickname;
        // 保存到DB
        const avatarUrl = userInfo.avatar_thumb?.url_list?.[0] || '';
        db.upsertStreamer(userInfo.nickname, room.roomId, avatarUrl, liveInfo.sec_uid || '')
          .catch(e => console.error(`[daemon] upsertStreamer 失败:`, e.message));
        console.log(`[daemon] 通过API获取到名字: ${userInfo.nickname}`);
      }
    }
  } catch(e) { /* ignore */ }
}

// ====== 配置（带缓存 + 热加载） ======
let _configCache = null;
let _configMtime = 0;

function _loadConfigRaw() {
  try {
    if (fs.existsSync(CONFIG_FILE)) {
      return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf-8'));
    }
  } catch (e) { /* ignore */ }
  return {
    rooms: [{ id: '72288034336', name: '', enabled: true }],
    room_id: '72288034336',  // 兼容旧配置
    check_interval_seconds: 30,
    reconnect_delay_seconds: 10,
    save_json: false,
    feishu: { open_id: '' },
  };
}

function loadConfig() {
  try {
    const stat = fs.statSync(CONFIG_FILE);
    const mt = stat.mtimeMs;
    if (_configCache && mt === _configMtime) return _configCache;
    _configCache = _loadConfigRaw();
    _configMtime = mt;
  } catch (e) {
    if (!_configCache) _configCache = _loadConfigRaw();
  }
  return _configCache;
}

// fs.watch 热加载配置文件
try {
  fs.watch(CONFIG_FILE, { persistent: false }, () => {
    try {
      _configCache = _loadConfigRaw();
      _configMtime = fs.statSync(CONFIG_FILE).mtimeMs;
      console.log('[config] 配置文件已热加载');
    } catch (e) { /* ignore */ }
  });
} catch (e) { /* fs.watch 可能不支持某些环境 */ }

// 配置写入队列，防止并发写入导致数据损坏
let _configWriteQueue = Promise.resolve();
function saveConfig(config) {
  _configWriteQueue = _configWriteQueue.then(() => {
    try {
      fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
      _configCache = config;  // 写入后同步缓存
      _configMtime = fs.statSync(CONFIG_FILE).mtimeMs;
    } catch (e) {
      console.error('[config] 写入配置失败:', e.message);
    }
  }).catch(() => {});
  return _configWriteQueue;
}

/** 获取要监控的房间列表 */
function getTargetRooms(config, cliRoomId) {
  // 命令行指定房间
  if (cliRoomId) {
    return [{ id: cliRoomId, name: '', enabled: true }];
  }
  // 新格式：rooms 数组
  if (config.rooms && Array.isArray(config.rooms)) {
    return config.rooms.filter(r => r.enabled !== false);
  }
  // 兼容旧格式：单 room_id
  if (config.room_id) {
    return [{ id: config.room_id, name: '', enabled: true }];
  }
  return [];
}

// ====== Session 管理（按房间） ======
function createSession(room, roomId) {
  room.stats.danmakuUsers = {};
  room.stats.giftUsers = {};

  const s = {
    room_id: roomId,
    room_title: '',
    room_author: '',
    room_avatar: '',
    start_time: cstISO(),
    end_time: null,
    duration_seconds: 0,
    stats: { danmaku: 0, gift: 0, like: 0, member: 0, follow: 0, social: 0 },
    online: [],
    danmaku: [],
    gifts: [],
    members: [],
    topDanmakuUsers: [],
    topGiftUsers: [],
    rawMessages: new Map(),
    toUserAvatars: {},
    _seenMembers: new Set(),
  };
  return s;
}

function saveSession(room) {
  if (!room.session) return;
  room.session.duration_seconds = Math.round(
    (new Date(room.session.end_time || Date.now()) - new Date(room.session.start_time)) / 1000
  );
  if (loadConfig().save_json) {
    try {
      // Map/Set 不能直接 JSON.stringify，需要转换
      const data = { ...room.session };
      if (data._seenMembers instanceof Set) data._seenMembers = [...data._seenMembers];
      if (data.rawMessages instanceof Map) data.rawMessages = Object.fromEntries(data.rawMessages);
      fs.writeFileSync(room.sessionFile, JSON.stringify(data, null, 2), 'utf-8');
    } catch(e) {}
  }
}

// 快照：将内存中的 session 数据写入临时文件，防止异常退出丢数据
function snapshotSession(room) {
  if (!room.session || !room.isRecording) return;
  try {
    room.session.duration_seconds = Math.round(
      (Date.now() - new Date(room.session.start_time)) / 1000
    );
    const snapshotFile = path.join(DATA_DIR, `snapshot_${room.roomId}.json`);
    // 用临时文件写入再 rename，防止写一半崩溃导致文件损坏
    const tmpFile = snapshotFile + '.tmp';
    fs.writeFileSync(tmpFile, JSON.stringify(room.session, null, 2), 'utf-8');
    fs.renameSync(tmpFile, snapshotFile);
  } catch (e) {
    console.error(`[snapshot][${room.roomId}] 快照失败:`, e.message);
  }
}

// 从快照恢复（进程重启时）
function restoreFromSnapshot(roomId) {
  try {
    const snapshotFile = path.join(DATA_DIR, `snapshot_${roomId}.json`);
    if (fs.existsSync(snapshotFile)) {
      const data = JSON.parse(fs.readFileSync(snapshotFile, 'utf-8'));
      fs.unlinkSync(snapshotFile);  // 读取后删除快照
      return data;
    }
  } catch (e) {}
  return null;
}

// ====== DB 刷写（按房间） ======
async function dbFlush(room) {
  if (!room.session || !room.dbSessionId) return;
  try {
    // 记录写库前的数组长度，写库成功后从内存中删除已入库部分
    const lenDanmaku = room.session.danmaku.length;
    const lenGifts = room.session.gifts.length;
    const lenMembers = room.session.members.length;
    const lenOnline = room.session.online.length;
    const newDanmaku = room.session.danmaku.slice(room.dbSyncState.danmaku);
    if (newDanmaku.length > 0) {
      await db.insertDanmaku(room.dbSessionId, newDanmaku.map(d => ({
        msgId: d.uid + '_' + d.time,
        nickname: d.nickname,
        avatar: d.avatar || '',
        content: d.content,
        userDisplayId: d.user_display_id || null,
        userSecUid: d.user_sec_uid || null,
        createTime: new Date(d.time).getTime()
      })));
      room.dbSyncState.danmaku = room.session.danmaku.length;
    }
    const newGifts = room.session.gifts.slice(room.dbSyncState.gifts);
    if (newGifts.length > 0) {
      await db.insertGifts(room.dbSessionId, newGifts.map(g => ({
        msgId: g.uid + '_' + g.time,
        nickname: g.nickname,
        avatar: g.avatar || '',
        toNickname: g.to_nickname || '',
        toAvatar: g.to_avatar || room.session.toUserAvatars[g.to_nickname] || '',
        toUserDisplayId: g.to_user_display_id || null,
        toUserSecUid: g.to_user_sec_uid || null,
        giftName: g.gift_name,
        diamondCount: g.diamond_per_unit || 0,
        repeatCount: g.count || 1,
        totalDiamonds: g.total_diamonds || 0,
        userDisplayId: g.user_display_id || null,
        userSecUid: g.user_sec_uid || null,
        createTime: new Date(g.time).getTime(),
        traceId: g.traceId || null,
        comboCount: g.comboCount || 0,
        repeatEnd: g.repeatEnd !== undefined && g.repeatEnd !== null ? g.repeatEnd : null,
        groupCount: g.groupCount || 1,
        sendType: g.sendType !== undefined && g.sendType !== null ? g.sendType : null,
        icon: g.icon || null
      })));
      room.dbSyncState.gifts = room.session.gifts.length;
    }
    const newMembers = room.session.members.slice(room.dbSyncState.members);
    if (newMembers.length > 0) {
      await db.insertMembers(room.dbSessionId, newMembers.map(m => ({
        nickname: m.nickname,
        avatar: m.avatar || null,
        userDisplayId: m.user_display_id || null,
        userSecUid: m.user_sec_uid || null,
        createTime: m.time ? new Date(m.time).getTime() : Date.now()
      })));
      room.dbSyncState.members = room.session.members.length;
    }
    const newOnline = room.session.online.slice(room.dbSyncState.online);
    if (newOnline.length > 0) {
      for (const o of newOnline) {
        const dt = o.time;
        if (dt) {
          await db.getPool().query(
            'INSERT INTO online_records (session_id, count, recorded_at) VALUES (?, ?, ?)',
            [room.dbSessionId, parseInt(String(o.count), 10) || 0, dt]
          );
        }
      }
      room.dbSyncState.online = room.session.online.length;
    }
    if (newDanmaku.length > 0 || newGifts.length > 0 || newMembers.length > 0) {
      const peak = room.session.online.length > 0
        ? room.session.online.reduce((max, o) => Math.max(max, parseInt(String(o.count), 10) || 0), 0)
        : 0;
      await db.updateSessionStats(room.dbSessionId, {
        danmaku: newDanmaku.length,
        gift: newGifts.length,
        member: newMembers.length
      });
      await db.getPool().query(
        'UPDATE sessions SET stats_like = ?, stats_follow = ?, stats_social = ?, online_peak = ? WHERE id = ?',
        [room.session.stats.like || 0, room.session.stats.follow || 0, room.session.stats.social || 0, peak, room.dbSessionId]
      );
      room.dbSyncState.likes = room.session.stats.like || 0;
    } else if (room.session.stats.like > 0 && room.session.stats.like !== room.dbSyncState.likes) {
      await db.getPool().query(
        'UPDATE sessions SET stats_like = ?, stats_follow = ?, stats_social = ? WHERE id = ?',
        [room.session.stats.like || 0, room.session.stats.follow || 0, room.session.stats.social || 0, room.dbSessionId]
      );
      room.dbSyncState.likes = room.session.stats.like || 0;
    }
    // 写库全部成功，从内存数组中删除已入库部分，防止内存无限增长
    if (lenDanmaku > 0) room.session.danmaku.splice(0, lenDanmaku);
    if (lenGifts > 0) room.session.gifts.splice(0, lenGifts);
    if (lenMembers > 0) room.session.members.splice(0, lenMembers);
    if (lenOnline > 0) room.session.online.splice(0, lenOnline);
    // splice 后数组只剩未入库部分，重置同步位置
    room.dbSyncState.danmaku = 0;
    room.dbSyncState.gifts = 0;
    room.dbSyncState.members = 0;
    room.dbSyncState.online = 0;
  } catch(e) {
    if (e.code !== 'SQLITE_CONSTRAINT') {
      console.error(`[dbFlush][${room.roomId}] 错误:`, e.message);
    }
  }
}

function finalizeSession(room) {
  if (!room.session) return;

  room.session.topDanmakuUsers = Object.entries(room.stats.danmakuUsers)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([nickname, count]) => ({ nickname, count }));

  room.session.topGiftUsers = Object.entries(room.stats.giftUsers)
    .sort((a, b) => b[1].totalDiamonds - a[1].totalDiamonds)
    .slice(0, 10)
    .map(([nickname, d]) => ({
      nickname,
      count: d.count,
      totalDiamonds: d.totalDiamonds,
      gifts: d.giftNames?.join('、') || '',
    }));

  // 清理 rawMessages 中的 _uniq 字段
  for (const msg of room.session.rawMessages.values()) {
    delete msg._uniq;
  }
  room.session.end_time = cstISO();
  saveSession(room);

  if (room.dbSessionId) {
    const start = new Date(room.session.start_time);
    const end = new Date(room.session.end_time);
    const dur = Math.round((end - start) / 1000);
    db.endSession(room.dbSessionId, dur, room.session.file_path || '')
      .catch(e => console.error(`[session][${room.roomId}] endSession 失败:`, e.message));
  }

  if (loadConfig().save_json) {
    const ts = cstFileTimestamp();
    const bakFile = path.join(room.sessionDir, `session_${ts}.json`);
    try {
      fs.copyFileSync(room.sessionFile, bakFile);
      console.log(`[session][${room.roomId}] 已备份: ${bakFile}`);
    } catch(e) {}
  }
}

// ====== 图片报告 ======
async function generateAndSendReport(room) {
  try {
    const data = await reportImg.load(room.roomId);
    if (!data) {
      console.error(`[report][${room.roomId}] 无法加载 session 数据`);
      return;
    }
    const config = loadConfig();
    const openId = config.feishu?.open_id || '';
    if (!openId) { console.error('[report] feishu.open_id 未配置'); return; }
    const pngPath = await reportImg.generateImage(data);
    const sent = await feishu.sendImage(openId, pngPath, 'open_id');
    if (sent) {
      console.log(`[report][${room.roomId}] 图片报告已发送`);
    } else {
      console.error(`[report][${room.roomId}] 图片发送失败`);
    }
    try { fs.unlinkSync(pngPath); } catch(e){}
  } catch (e) {
    console.error(`[report][${room.roomId}] 生成报告失败:`, e.message);
  }
}

// ====== 用户提取 ======
function extractUser(data) {
  const user = data.user || data.userValue?.user || {};
  return {
    id: user.id || '',
    nickname: user.nickname || '匿名',
    avatar: (user.avatarThumb?.urlList?.[0]) || '',
  };
}

// ====== 星守护主播昵称缓存 ======
const _anchorNameCache = {};

async function resolveAnchorName(anchorId, fallbackName) {
  if (_anchorNameCache[anchorId]) return { ..._anchorNameCache[anchorId] };

  const SYMB = 'Dkdpgh4ZKsQB80/Mfvw36XI1R25+WUAlEi7NLboqYTOPuzmFjJnryx9HVGcaStCe=';
  function randomABogus() {
    let s = 'AG';
    for (let i = 0; i < 25; i++) s += SYMB[Math.floor(Math.random() * 64)];
    return s;
  }

  try {
    const cookie = getCookie();

    const ab = randomABogus();
    const url = 'https://www.douyin.com/aweme/v1/web/user/profile/other/?user_id=' + anchorId + '&a_bogus=' + ab;
    const resp = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
        'Referer': 'https://www.douyin.com/',
        'Cookie': cookie,
      }
    });
    const data = await resp.json();
    if (data.status_code === 0 && data.user?.nickname) {
      const info = {
        nickname: data.user.nickname,
        secUid: data.user.sec_uid || '',
        displayId: data.user.unique_id || '',
      };
      _anchorNameCache[anchorId] = info;
      return { ...info };
    }
  } catch(e) {}
  return { nickname: fallbackName || '主播', secUid: '', displayId: '' };
}

// ====== 消息处理（按房间） ======
function handleMessage(room, data) {
  const method = data.common?.method || data.method || data.type || '';
  const session = room.session;

  // 收到数据 → 取消延迟停播
  if (room.liveStopTimer && method) {
    clearTimeout(room.liveStopTimer);
    room.liveStopTimer = null;
  }
  if (method) room.lastDataTime = Date.now();

  switch (method) {
    case 'WebcastChatMessage': {
      session.stats.danmaku++;
      const user = extractUser(data);
      const rawUser = data.user || data.userValue?.user || {};
      const userDispId = rawUser.displayId || rawUser.id || user.id || '';
      const userSec = rawUser.secUid || '';
      const content = extractTextContent(data) || data.content || '';
      if (content) {
        session.danmaku.push({
          time: cstISO(), uid: user.id, nickname: user.nickname, avatar: user.avatar,
          user_display_id: userDispId, user_sec_uid: userSec, content,
        });
        room.stats.danmakuUsers[user.nickname] = (room.stats.danmakuUsers[user.nickname] || 0) + 1;
      }
      break;
    }

    case 'WebcastGiftMessage': {
      room.lastDataTime = Date.now();
      const user = extractUser(data);
      let displayName = '';
      if (data.common?.displayText?.pieces) {
        const pieces = data.common.displayText.pieces;
        const pattern = data.common.displayText.defaultPattern || '';
        if (pattern.includes('送给') && pieces.length > 3) {
          const giftPiece = pieces[3];
          if (giftPiece && giftPiece.type === 1 && giftPiece.stringValue) displayName = giftPiece.stringValue;
        } else if (pattern.includes('送出') && pieces.length > 1) {
          const giftPiece = pieces[1];
          if (giftPiece && giftPiece.type === 1 && giftPiece.stringValue) displayName = giftPiece.stringValue;
        }
      }
      const baseName = data.gift?.name || data.giftName || '礼物';
      const IGNORE_DISPLAY_NAMES = ['主播照片'];
      const GIFT_NAME_REWRITE = {'甄爱皮肤': '甄爱跑车'};
      const effectiveDisplayName = IGNORE_DISPLAY_NAMES.includes(displayName) ? '' : (GIFT_NAME_REWRITE[displayName] || displayName);
      let giftName = effectiveDisplayName || baseName;
      let diamondPerUnit = parseInt(String(data.gift?.diamondCount || 0), 10);
      // ===== 融合礼物价格匹配 =====
      const FUSION_KEYWORDS = {
        '气球': '热气球', '兔兔': '比心兔兔', '小心心': '小心心',
        '烟花': '万象烟花', '礼花': '礼花筒', '玫瑰': '真爱玫瑰',
        '跑车': '跑车', '飞机': '私人飞机', '邮轮': '豪华邮轮',
      };
      const FUSION_RULES = [
        { k: ['邮轮','飞机'], t: 4 },
        { k: ['邮轮','兔兔','气球','跑车'], t: 4 },
        { k: ['邮轮','兔兔','气球'], t: 4 },
        { k: ['邮轮','兔兔','跑车'], t: 4 },
        { k: ['邮轮','气球','跑车'], t: 4 },
        { k: ['邮轮','兔兔'], t: 4 },
        { k: ['邮轮','气球'], t: 4 },
        { k: ['邮轮','跑车'], t: 4 },
        { k: ['邮轮'], t: 4 },
        { k: ['飞机','兔兔','气球','跑车'], t: 3 },
        { k: ['飞机','兔兔','气球'], t: 3 },
        { k: ['飞机','兔兔','跑车'], t: 3 },
        { k: ['飞机','气球','跑车'], t: 3 },
        { k: ['飞机','兔兔'], t: 3 },
        { k: ['飞机','气球'], t: 3 },
        { k: ['飞机','跑车'], t: 3 },
        { k: ['兔兔','气球','跑车'], t: 2 },
        { k: ['兔兔','跑车'], t: 2 },
        { k: ['气球','跑车'], t: 2 },
        { k: ['兔兔','小心心'], t: 2 },
        { k: ['兔兔','烟花'], t: 2 },
        { k: ['兔兔','礼花'], t: 2 },
        { k: ['兔兔','玫瑰'], t: 2 },
        { k: ['气球','小心心'], t: 2 },
        { k: ['气球','烟花'], t: 2 },
        { k: ['气球','礼花'], t: 2 },
        { k: ['气球','玫瑰'], t: 2 },
        { k: ['跑车','小心心'], t: 2 },
        { k: ['跑车','烟花'], t: 2 },
        { k: ['跑车','礼花'], t: 2 },
        { k: ['跑车','玫瑰'], t: 2 },
        { k: ['小心心','烟花'], t: 2 },
        { k: ['小心心','礼花'], t: 2 },
        { k: ['小心心','玫瑰'], t: 2 },
        { k: ['烟花','礼花'], t: 2 },
        { k: ['烟花','玫瑰'], t: 2 },
        { k: ['礼花','玫瑰'], t: 2 },
        { k: ['兔兔','礼花','玫瑰'], t: 1 },
        { k: ['气球','兔兔'], t: 1 },
        { k: ['气球','礼花'], t: 1 },
        { k: ['气球','玫瑰'], t: 1 },
        { k: ['兔兔','小心心'], t: 1 },
        { k: ['兔兔','烟花'], t: 1 },
        { k: ['兔兔','礼花'], t: 1 },
        { k: ['兔兔','玫瑰'], t: 1 },
        { k: ['小心心','礼花'], t: 1 },
        { k: ['小心心','玫瑰'], t: 1 },
        { k: ['烟花','礼花'], t: 1 },
        { k: ['礼花','玫瑰'], t: 1 },
      ];
      const FUSION_PRICES = {
        1: { 2:819, 3:864 },
        2: { 2:1239, 3:1539, 4:1719, 5:1886 },
        3: { 2:3199, 3:3499, 4:3679, 5:3846, 6:3879 },
        4: { 2:6199, 3:7199, 4:8199, 5:9199, 6:10200 },
      };
      if (giftName && displayName && giftName.includes('工坊宝箱')) {
        const found = [];
        for (const [kw, base] of Object.entries(FUSION_KEYWORDS)) {
          if (giftName.includes(kw)) found.push({ kw, base });
        }
        if (found.length > 0) {
          const matched = FUSION_RULES.find(r => r.k.every(k => found.some(f => f.kw === k)));
          if (matched) {
            const tier = FUSION_PRICES[matched.t];
            const price = tier[Math.min(found.length, Object.keys(tier).length)];
            if (price !== undefined) diamondPerUnit = price;
          }
        }
      }
      const GIFT_PRICE_MAP = {
        '闪烁星河': 99, '点点星光': 9, '星光闪耀': 9, '闪耀星辰': 99,
        '钻石跑车': 1500, '豪华跑车': 1200, '钻石兔兔': 360, '钻石热气球': 620,
        '钻石火箭': 12001, '钻石飞艇': 23333, '烈焰跑车': 6000, '至尊超跑': 12000,
        '御风飞机': 9000, '钻石邮轮': 7200,
        '青绿典藏版嘉年华': 36000, '凌霄战机': 18000,
        '无界超跑': 36000, '星际战舰': 36000,
      };
      const fixedPrice = GIFT_PRICE_MAP[giftName];
      if (fixedPrice !== undefined) diamondPerUnit = fixedPrice;
      const repeatCount = parseInt(String(data.repeatCount || '1'), 10);
      session.stats.gift++;
      const giftCount = repeatCount;
      const totalDiamonds = diamondPerUnit * giftCount;
      const toUser = data.toUser;
      const to_nickname = toUser && toUser.nickname ? toUser.nickname : '';
      const to_avatar = toUser?.avatarThumb?.urlList?.[0] || '';
      const toUserDisplayId = toUser?.displayId || '';
      const toUserSecUid = toUser?.secUid || '';
      const rawUser = data.user || data.userValue?.user || {};
      const userDisplayId = rawUser.displayId || rawUser.id || user.id || '';
      const userSecUid = rawUser.secUid || '';
      session.gifts.push({
        time: cstISO(), uid: user.id, nickname: user.nickname, avatar: user.avatar,
        user_display_id: userDisplayId, user_sec_uid: userSecUid,
        gift_name: giftName, count: giftCount, diamond_per_unit: diamondPerUnit,
        total_diamonds: totalDiamonds, to_nickname, to_avatar,
        to_user_display_id: toUserDisplayId, to_user_sec_uid: toUserSecUid,
        traceId: data.traceId || null,
        comboCount: parseInt(String(data.comboCount || '1'), 10),
        repeatEnd: data.repeatEnd !== undefined ? data.repeatEnd : null,
        groupCount: parseInt(String(data.groupCount || '1'), 10),
        sendType: data.sendType !== undefined ? parseInt(data.sendType, 10) : null,
        icon: data.gift?.icon?.urlList?.[0] || null,
      });
      // gift_debug.json 已禁用（调试代码，同步写入阻塞事件循环）
      // try {
      //   const debugPath = path.join(DATA_DIR, 'gift_debug.json');
      //   let existing = [];
      //   try { existing = JSON.parse(fs.readFileSync(debugPath, 'utf8')); } catch(e) {}
      //   existing.push({
      //     time: cstISO(),
      //     giftId: data.giftId || data.gift?.id || null,
      //     giftName, baseName, displayName,
      //     diamondCount: data.gift?.diamondCount || null,
      //     diamondPerUnit, count: giftCount, totalDiamonds,
      //     icon: data.gift?.icon?.urlList || null,
      //     iconType: data.gift?.iconType || null,
      //     image: data.gift?.image?.urlList || null,
      //     webpImage: data.gift?.webpImage?.urlList || null,
      //     uid: user.id, nickname: user.nickname, avatar: user.avatar,
      //     user_display_id: userDisplayId, user_sec_uid: userSecUid,
      //     to_nickname, to_avatar,
      //     to_user_display_id: toUserDisplayId, to_user_sec_uid: toUserSecUid,
      //     traceId: data.traceId || null,
      //     comboCount: parseInt(String(data.comboCount || '1'), 10),
      //     repeatEnd: data.repeatEnd !== undefined ? data.repeatEnd : null,
      //     groupCount: parseInt(String(data.groupCount || '1'), 10),
      //     sendType: data.sendType !== undefined ? parseInt(data.sendType, 10) : null,
      //     giftRaw: JSON.parse(JSON.stringify(data.gift || {})),
      //     giftKeys: data.gift ? Object.keys(data.gift) : [],
      //   });
      //   const jsonStr = JSON.stringify(existing, null, 2);
      //   if (Buffer.byteLength(jsonStr, 'utf8') > 20 * 1024 * 1024) {
      //     existing = existing.slice(Math.floor(existing.length / 2));
      //   }
      //   fs.writeFileSync(debugPath, JSON.stringify(existing, null, 2));
      // } catch(e) {}
      if (!room.stats.giftUsers[user.nickname]) {
        room.stats.giftUsers[user.nickname] = { count: 0, totalDiamonds: 0, giftNames: [] };
      }
      room.stats.giftUsers[user.nickname].count += giftCount;
      room.stats.giftUsers[user.nickname].totalDiamonds += totalDiamonds;
      if (!room.stats.giftUsers[user.nickname].giftNames.includes(giftName)) {
        room.stats.giftUsers[user.nickname].giftNames.push(giftName);
      }
      break;
    }

    case 'WebcastLikeMessage': {
      const total = parseInt(String(data.total || '0'), 10);
      const prev = session._totalLikes || 0;
      if (total > prev) { session.stats.like += (total - prev); session._totalLikes = total; }
      break;
    }

    case 'WebcastMemberMessage': {
      const user = extractUser(data);
      const rawUser = data.user || data.userValue?.user || {};
      const userDispId = rawUser.displayId || rawUser.id || user.id || '';
      const userSec = rawUser.secUid || rawUser.sec_uid || data.user?.secUid || data.user?.sec_uid || '';
      const userAvatar = rawUser.avatarThumb?.urlList?.[0] || user.avatar || '';
      const key = user.nickname;
      if (key && !session._seenMembers.has(key)) {
        session._seenMembers.add(key);
        session.stats.member++;
        session.members.push({
          time: new Date().toISOString(), uid: user.id, nickname: user.nickname,
          avatar: userAvatar, user_display_id: userDispId, user_sec_uid: userSec,
        });
      }
      break;
    }

    case 'WebcastFansclubMessage': {
      room.lastDataTime = Date.now();
      if (data.action !== 7) break;
      const fcGuard = data.user?.fansClub?.data || {};
      const anchorId = fcGuard.anchorId;
      const guardExpired = parseInt(String(fcGuard.guardExpiredTime || '0'), 10);
      if (!anchorId) break;
      const nowSec = Math.floor(Date.now() / 1000);
      const diffDays = guardExpired ? (guardExpired - nowSec) / 86400 : 0;
      const is12Month = guardExpired && diffDays >= 365;
      const giftName = is12Month ? '星守护(12个月)' : '星守护(1个月)';
      const diamondPrice = is12Month ? 1280 * 12 : 1280;
      resolveAnchorName(anchorId, data.livename || '').then(anchor => {
        const rawUser = data.user || {};
        session.gifts.push({
          time: cstISO(), uid: rawUser.id || '', nickname: rawUser.nickname || '匿名',
          avatar: (rawUser.avatarThumb?.urlList?.[0]) || '',
          user_display_id: rawUser.displayId || rawUser.id || '',
          user_sec_uid: rawUser.secUid || '',
          gift_name: giftName, count: 1, diamond_per_unit: diamondPrice,
          total_diamonds: diamondPrice, to_nickname: anchor.nickname, to_avatar: '',
          to_user_display_id: anchor.displayId, to_user_sec_uid: anchor.secUid,
          traceId: data.common?.msgId || null, comboCount: 1, repeatEnd: 1,
          groupCount: 1, sendType: 5,
        });
        session.stats.gift++;
        if (!room.stats.giftUsers[rawUser.nickname]) {
          room.stats.giftUsers[rawUser.nickname] = { count: 0, totalDiamonds: 0, giftNames: [] };
        }
        room.stats.giftUsers[rawUser.nickname].count += 1;
        room.stats.giftUsers[rawUser.nickname].totalDiamonds += diamondPrice;
        if (!room.stats.giftUsers[rawUser.nickname].giftNames.includes(giftName)) {
          room.stats.giftUsers[rawUser.nickname].giftNames.push(giftName);
        }
      }).catch(() => {});
      break;
    }

    case 'WebcastScreenChatMessage':
    case 'WebcastPrivilegeScreenChatMessage': {
      room.lastDataTime = Date.now();
      session.stats.danmaku++;
      const scrUser = extractUser(data);
      const scrContent = extractTextContent(data) || data.content || '';
      if (scrContent) {
        session.danmaku.push({
          time: cstISO(), uid: scrUser.id, nickname: scrUser.nickname, avatar: scrUser.avatar,
          user_display_id: scrUser.displayId || data.user?.displayId || '',
          user_sec_uid: data.user?.secUid || scrUser.secUid || '',
          content: '[飘屏] ' + scrContent,
        });
      }
      break;
    }

    case 'WebcastSocialMessage': {
      session.stats.follow++;
      break;
    }

    case 'WebcastRoomStatsMessage': {
      const count = parseInt(data.total || data.displayValue || 0, 10);
      session.online.push({ time: cstISO(), count });
      break;
    }

    case 'WebcastResidentGuestMessage': {
      const updateRoom = (sid) => {
        if (data.title && session.room_title !== data.title) {
          session.room_title = data.title;
          if (sid) db.getPool().query('UPDATE sessions SET room_title = ? WHERE id = ? AND (room_title IS NULL OR room_title = "")', [data.title, sid]).catch(e => console.error(`[session] 更新标题失败:`, e.message));
        }
        if (data.livename && !session.room_author) {
          session.room_author = data.livename;
          setStreamerDir(room, data.livename);
          if (sid) db.updateStreamerName(sid, data.livename, data.avatarThumb || '').catch(e => console.error(`[session] 更新主播名失败:`, e.message));
          console.log(`[${room.roomId}] 🔴 主播名确认: ` + data.livename);
        }
        if (data.avatarThumb && !session.room_avatar) {
          session.room_avatar = data.avatarThumb;
          if (sid) db.updateStreamerAvatar(sid, data.avatarThumb).catch(e => console.error(`[session] 更新头像失败:`, e.message));
        }
      };
      updateRoom(room.dbSessionId);
      if (!room.dbSessionId) room.pendingDbUpdates.push(updateRoom);
      break;
    }

    case 'WebcastCommonCardAreaMessage':
    case 'WebcastGroupLiveContainerChangeMessage': {
      try {
        const container = data.data;
        if (container && Array.isArray(container)) {
          for (const item of container) {
            if (item.containerPayload) {
              const payload = JSON.parse(item.containerPayload);
              const users = payload.rl_user_base_info || [];
              for (const u of users) {
                if (u.nick_name && u.avatar && !session.toUserAvatars[u.nick_name]) {
                  session.toUserAvatars[u.nick_name] = u.avatar;
                }
              }
              const v2 = payload.rl_user_base_info_v2 || [];
              for (const team of v2) {
                const teamUsers = team.rl_user_base_info || [];
                for (const u of teamUsers) {
                  if (u.nick_name && u.avatar && !session.toUserAvatars[u.nick_name]) {
                    session.toUserAvatars[u.nick_name] = u.avatar;
                  }
                }
              }
            }
          }
        }
      } catch(e) {}
      break;
    }

    default: {
      if (!session.room_avatar && data.avatarThumb) session.room_avatar = data.avatarThumb;
      if (!session._unseenMethods) session._unseenMethods = {};
      if (!session._unseenMethods[method]) {
        session._unseenMethods[method] = true;
        console.log(`[${room.roomId}] ❓ 未处理消息类型:`, method);
      }
      const uniq = method + (data.common?.msgId ? '_' + data.common.msgId.slice(-6) : '');
      if (!session.rawMessages.has(uniq)) {
        session.rawMessages.set(uniq, { method, data });
        // 限制 Map 大小，删除最早的条目
        if (session.rawMessages.size > 50) {
          const firstKey = session.rawMessages.keys().next().value;
          session.rawMessages.delete(firstKey);
        }
      }
    }
  }
}

function extractTextContent(data) {
  if (data.displayText?.defaultPattern) {
    let text = data.displayText.defaultPattern;
    if (data.displayText.pieces) {
      data.displayText.pieces.forEach(p => {
        if (p.type === 11) {
          const name = p.userValue?.user?.nickname || '';
          text = text.replace('{0:user}', name);
        } else if (p.type === 1) {
          text = text.replace('{1:string}', p.stringValue || '');
        }
      });
    }
    text = text.replace(/\{[^}]+\}/g, '');
    return text;
  }
  return data.content || data.text || '';
}

// ====== douyinLive 二进制管理 ======
let binaryProcess = null;
let binaryCrashCount = 0;

function checkPort(port) {
  return new Promise((resolve) => {
    const s = net.createConnection({ host: '127.0.0.1', port }, () => { s.destroy(); resolve(true); });
    s.on('error', () => { s.destroy(); resolve(false); });
    s.setTimeout(2000, () => { s.destroy(); resolve(false); });
  });
}

function startBinary() {
  const binaryPath = __dirname + '/douyinLive-linux-amd64';
  console.log('[binary] 启动 douyinLive 代理...');
  try {
    binaryProcess = spawn(binaryPath, ['--unknown', '--log-level', 'debug'], { cwd: __dirname, stdio: ['ignore', 'pipe', 'pipe'] });
    const binaryLogFile = path.join(logsDir, 'binary_output.log');
    const binaryLogStream = fs.createWriteStream(binaryLogFile, { flags: 'a' });
    binaryProcess.stdout.pipe(binaryLogStream);
    binaryProcess.stderr.pipe(binaryLogStream);
    binaryProcess.on('exit', (code, sig) => {
      const reason = sig ? `信号 ${sig}` : `退出码 ${code}`;
      console.log(`[binary] 进程退出 (${reason})`);
      binaryProcess = null;
      binaryCrashCount++;
      const delay = Math.min(binaryCrashCount * 5000, 60000);
      if (binaryCrashCount <= 10) {
        console.log(`[binary] ${delay/1000}秒后自动重启...`);
        setTimeout(startBinary, delay);
      } else {
        console.log('[binary] 重试次数过多，不再自动重启');
      }
    });
    binaryProcess.on('error', (err) => {
      console.error('[binary] 启动失败:', err.message);
      binaryProcess = null;
    });
  } catch (e) {
    console.error('[binary] 启动异常:', e.message);
  }
}

async function ensureBinaryRunning() {
  const portOpen = await checkPort(1088);
  if (!portOpen && (!binaryProcess || binaryProcess.killed)) {
    console.log('[daemon] 1088 端口未响应，尝试启动二进制...');
    startBinary();
    await new Promise(r => setTimeout(r, 5000));
    const ok = await checkPort(1088);
    if (ok) {
      console.log('[daemon] 二进制启动成功');
      binaryCrashCount = 0;
    }
  }
}

// ====== WebSocket 连接（按房间） ======
function startConnection(roomId, config) {
  if (isShuttingDown) return;

  let room = rooms.get(roomId);
  if (!room) {
    room = createRoomState(roomId);
    rooms.set(roomId, room);
  }

  const wsUrl = `ws://127.0.0.1:1088/ws/${roomId}`;
  console.log(`[${getDisplayName(room)}] 连接: ${wsUrl}`);

  // 清理旧连接，防止重叠
  if (room.ws) {
    try { room.ws.removeAllListeners(); room.ws.close(); } catch(e) {}
  }
  room.ws = new WebSocket(wsUrl);

  room.ws.on('open', () => {
    room.reconnectCount = 0;  // 连接成功，重置退避计数
    console.log(`[${getDisplayName(room)}] 已连接，等待直播...`);
  });

  room.ws.on('message', (raw) => {
    try {
      const str = raw.toString();
      const data = JSON.parse(str);

      // ====== 系统消息 ======
      if (data.type === 'system') {
        const event = data.event || '';
        if (event === 'live_status') {
          if (data.livename) room.displayName = data.livename;
          console.log(`[${getDisplayName(room)}] [live_status] live=${data.live} title=${data.title||''}主播=${data.livename||''}`);
          const isLive = !!data.live;

          // 主播回来时，取消可能残留的下播定时器
          if (isLive && room.liveStopTimer) {
            clearTimeout(room.liveStopTimer);
            room.liveStopTimer = null;
            console.log(`[${getDisplayName(room)}] 🟢 主播回来了，取消下播确认`);
          }

          if (isLive && !room.isRecording) {
            // 🔴 开播
            console.log(`[${getDisplayName(room)}] 🔴 检测到开播！`);
            const openId = config.feishu?.open_id || '';
            room.session = createSession(room, roomId);
            room.session.room_title = data.title || '';
            room.session.room_author = data.livename || '';
            if (room.session.room_author) setStreamerDir(room, room.session.room_author);
            room.isRecording = true;
            saveSession(room);
            db.init().then(async () => {
              try {
                const pool = db.getPool();
                await pool.query("UPDATE sessions SET end_time = datetime('now','localtime') WHERE room_id = ? AND end_time IS NULL", [roomId]);
                const name = getDisplayName(room);
                if (openId) {
                  feishu.sendText(openId, '🔴 ' + name + ' 开播啦！\n' + (data.title || ''), 'open_id').catch(() => {});
                }
                const streamerId = await db.upsertStreamer(room.session.room_author || '', roomId, '', '');
                room.dbSessionId = await db.createSession(streamerId, room.session.room_title, roomId);
                room.dbSyncState = { danmaku: 0, gifts: 0, members: 0, online: 0, likes: 0 };
                console.log(`[${getDisplayName(room)}] [db] session #${room.dbSessionId} 已创建`);
                // 执行挂起的更新
                const updates = room.pendingDbUpdates;
                room.pendingDbUpdates = [];
                for (const fn of updates) fn(room.dbSessionId);
              } catch(e) {
                console.error(`[${getDisplayName(room)}] [db] 创建 session 失败:`, e.message);
              }
            });
            console.log(`[${getDisplayName(room)}] 开始录制: ${data.title || ''}`);
          } else if (!isLive && room.isRecording) {
            // 🟢 可能下播
            // 如果最近还有数据流入（lastDataTime在60秒内），说明主播只是暂时离开，不启动下播定时器
            const dataAge = room.lastDataTime ? (Date.now() - room.lastDataTime) / 1000 : Infinity;
            if (dataAge < 60) {
              console.log(`[${getDisplayName(room)}] 🟡 live=false 但最近${Math.round(dataAge)}秒有数据流入，跳过下播判定`);
            } else if (!room.liveStopTimer) {
              room.liveStopTimer = setTimeout(() => {
                room.liveStopTimer = null;
                if (!room.isRecording) return;
                // 定时器触发时再次检查：如果期间有新数据流入，取消下播
                const lateDataAge = room.lastDataTime ? (Date.now() - room.lastDataTime) / 1000 : Infinity;
                if (lateDataAge < 60) {
                  console.log(`[${getDisplayName(room)}] 🟡 下播确认时发现最近${Math.round(lateDataAge)}秒有数据，取消下播`);
                  return;
                }
                console.log(`[${getDisplayName(room)}] 🟢 确认下播！`);
                room.isRecording = false;
                finalizeSession(room);
                console.log(`[${getDisplayName(room)}] session 已保存 (${room.session.stats.danmaku}条弹幕, ${room.session.stats.gift}个礼物)`);
                generateAndSendReport(room);
              }, 30000);
              console.log(`[${getDisplayName(room)}] 🟡 直播可能已结束，30秒后确认...`);
            }
          }

          if (room.session) room.session._liveStatus = isLive;
          if (!isLive && !room.isRecording) {
            console.log(`[${getDisplayName(room)}] 直播未开播，等待中... (${data.message || ''})`);
          }
        } else {
          console.log(`[${getDisplayName(room)}] [系统] ${data.message || JSON.stringify(data)}`);
        }
        return;
      }

      // ====== 直播数据 ======
      if (room.session && room.isRecording) {
        if (data.livename && !room.session.room_author) {
          room.displayName = data.livename;
          console.log(`[${getDisplayName(room)}] 🏷️ 抓到主播名:`, data.livename);
          room.session.room_author = data.livename;
          setStreamerDir(room, data.livename);
          const doUpdate = (sid) => {
            db.updateStreamerName(sid, data.livename, data.avatarThumb || '').catch(e => console.error(`[session] 更新主播名失败:`, e.message));
          };
          if (room.dbSessionId) doUpdate(room.dbSessionId);
          else room.pendingDbUpdates.push(doUpdate);
        }
        if (data.title && !room.session.room_title) {
          room.session.room_title = data.title;
          if (room.dbSessionId) {
            db.getPool().query('UPDATE sessions SET room_title = ? WHERE id = ? AND (room_title IS NULL OR room_title = "")', [data.title, room.dbSessionId]).catch(e => console.error(`[session] 更新标题失败:`, e.message));
          }
        }
        if (data.avatarThumb && !room.session.room_avatar) {
          room.session.room_avatar = data.avatarThumb;
          if (room.dbSessionId) db.updateStreamerAvatar(room.dbSessionId, data.avatarThumb).catch(e => console.error(`[session] 更新头像失败:`, e.message));
        }
      }

      if (room.session) {
        if (!room.isRecording && room.dbSessionId) {
          room.isRecording = true;
          console.log(`[${getDisplayName(room)}] 检测到新数据，恢复录制`);
        }
        if (room.isRecording) {
          handleMessage(room, data);
          saveSession(room);
        }
      }
    } catch (e) {
      const method = (typeof data === 'object' && data) ? (data._method || data.method || data.event || '?') : '?';
      console.error(`[${getDisplayName(room)}] 消息处理错误 [${method}]:`, e.message);
    }
  });

  room.ws.on('close', (code) => {
    console.log(`[${getDisplayName(room)}] 连接断开 (code=${code})`);
    if (isShuttingDown) return;
    // 检查房间是否已被暂停，暂停则不重连
    const currentConfig = loadConfig();
    const roomConfig = currentConfig.rooms?.find(r => r.id === roomId);
    if (roomConfig && roomConfig.enabled === false) {
      console.log(`[${getDisplayName(room)}] 房间已暂停，停止重连`);
      return;
    }
    // code=1000 不再直接结束 session — 团播切换主播时 Go 代理会断开 WS，
    // 但直播还在播。下播由 live_status 事件的 30 秒确认机制来处理。
    if (code === 1000 && room.isRecording) {
      console.log(`[${getDisplayName(room)}] WS正常关闭(code=1000)，保持录制状态，尝试重连...`);
      // 清理可能残留的下播确认 timer，防止重连期间误触发
      if (room.liveStopTimer) {
        clearTimeout(room.liveStopTimer);
        room.liveStopTimer = null;
      }
    }
    // 指数退避：base * 2^count，最大 60 秒
    let delay;
    if (code === 1000 && room.isRecording) {
      delay = 2000;  // 录制中 code=1000 快速重连
    } else {
      const base = (config.reconnect_delay_seconds || 10) * 1000;
      delay = Math.min(base * Math.pow(2, room.reconnectCount), 60000);
      room.reconnectCount = Math.min(room.reconnectCount + 1, 10);  // 上限 10 次
    }
    console.log(`[${getDisplayName(room)}] ${delay/1000}秒后重连 (退避第${room.reconnectCount}次)...`);
    setTimeout(async () => {
      await ensureBinaryRunning().catch(e => console.error(`[daemon] ensureBinary 异常:`, e.message));
      startConnection(roomId, config);
    }, delay);
  });

  room.ws.on('error', (err) => {
    console.log(`[${getDisplayName(room)}] WS错误: ${err.message}`);
    ensureBinaryRunning().catch(e => console.error(`[daemon] ensureBinary 异常:`, e.message));
  });
}

// ====== 控制 Socket ======

function startControlSocket() {
  // 清理旧 socket
  try { fs.unlinkSync(CONTROL_SOCKET); } catch(e) {}

  const server = net.createServer((conn) => {
    let buf = '';
    let processed = false;
    conn.on('data', (chunk) => {
      buf += chunk.toString();
      // 收到数据后立即处理并回复（不等 end 事件）
      if (!processed) {
        processed = true;
        try {
          const cmd = JSON.parse(buf);
          handleControlCommand(cmd).then(resp => {
            if (!conn.destroyed) {
              conn.end(JSON.stringify(resp));
            }
          }).catch(e => {
            if (!conn.destroyed) {
              conn.end(JSON.stringify({ ok: false, error: e.message }));
            }
          });
        } catch (e) {
          if (!conn.destroyed) {
            conn.end(JSON.stringify({ ok: false, error: '无效JSON: ' + e.message }));
          }
        }
      }
    });
    conn.on('error', () => {});  // 忽略客户端断开错误
  });

  server.listen(CONTROL_SOCKET, () => {
    console.log(`[control] 监听 ${CONTROL_SOCKET}`);
  });

  server.on('error', (err) => {
    console.error('[control] socket 错误:', err.message);
  });

  return server;
}

async function handleControlCommand(req) {
  const { cmd, roomId } = req;
  const config = loadConfig();

  switch (cmd) {
    case 'status': {
      return { ok: true, data: daemonStatus() };
    }

    case 'lookup': {
      // 通过 API 查询主播名（给 dashboard 用）
      if (!roomId) return { ok: false, error: '缺少 roomId' };
      try {
        const liveInfo = await api.getLiveInfo(roomId);
        if (liveInfo && liveInfo.sec_uid) {
          const userInfo = await api.getUserInfo(liveInfo.sec_uid);
          if (userInfo && userInfo.nickname) {
            return {
              ok: true,
              nickname: userInfo.nickname,
              avatar: userInfo.avatar_thumb?.url_list?.[0] || '',
              sec_uid: liveInfo.sec_uid,
              room_id: roomId,
              is_live: liveInfo.room_status === '2',
              title: liveInfo.room_title || ''
            };
          }
        }
        return { ok: false, error: '未找到主播信息' };
      } catch(e) {
        return { ok: false, error: '查询失败: ' + e.message };
      }
    }

    case 'add': {
      if (!roomId) return { ok: false, error: '缺少 roomId' };
      if (!/^[A-Za-z0-9]{5,30}$/.test(roomId)) return { ok: false, error: `roomId 格式无效: ${roomId}（应为5-30位字母数字）` };
      if (rooms.has(roomId)) return { ok: false, error: `房间 ${roomId} 已在监控` };
      // 写入配置
      if (!config.rooms) config.rooms = [];
      if (!config.rooms.find(r => r.id === roomId)) {
        config.rooms.push({ id: roomId, name: '', enabled: true });
        saveConfig(config);
      }
      // 启动连接
      await ensureBinaryRunning().catch(e => console.error(`[daemon] ensureBinary 异常:`, e.message));
      startConnection(roomId, config);
      // 加载主播名（DB → API），确保飞书通知不用房间号
      const room = rooms.get(roomId);
      if (room) {
        await loadRoomName(room).catch(() => {});
        console.log(`[daemon] ${room.displayName} (${roomId}) 已加载`);
      }
      return { ok: true, message: `已添加房间 ${roomId}` };
    }

    case 'remove': {
      if (!roomId) return { ok: false, error: '缺少 roomId' };
      const room = rooms.get(roomId);
      if (!room) {
        // 房间不在 rooms Map（可能是 disabled 未启动），仍从配置移除
        if (config.rooms) {
          config.rooms = config.rooms.filter(r => r.id !== roomId);
          saveConfig(config);
        }
        return { ok: true, message: `已移除房间 ${roomId}（未在监控中）` };
      }
      // 停止录制
      if (room.isRecording && room.session) {
        room.isRecording = false;
        await dbFlush(room);
        finalizeSession(room);
        generateAndSendReport(room);
      }
      // 关闭连接
      if (room.ws) try { room.ws.close(); } catch(e) {}
      if (room.liveStopTimer) clearTimeout(room.liveStopTimer);
      rooms.delete(roomId);
      // 从配置中移除
      if (config.rooms) {
        config.rooms = config.rooms.filter(r => r.id !== roomId);
        saveConfig(config);
      }
      return { ok: true, message: `已移除房间 ${roomId}` };
    }

    case 'pause': {
      if (!roomId) return { ok: false, error: '缺少 roomId' };
      const room = rooms.get(roomId);
      if (!room) return { ok: false, error: `房间 ${roomId} 不在监控中` };
      // 如果正在录制，先结束录制、出报告
      if (room.isRecording && room.session) {
        room.isRecording = false;
        await dbFlush(room);
        finalizeSession(room);
        generateAndSendReport(room);
      }
      // 关闭 WS 连接但保留 room 状态
      if (room.ws) try { room.ws.close(); } catch(e) {}
      room.ws = null;
      // 标记为暂停
      if (config.rooms) {
        const r = config.rooms.find(r => r.id === roomId);
        if (r) { r.enabled = false; saveConfig(config); }
      }
      return { ok: true, message: `已暂停房间 ${roomId}` };
    }

    case 'resume': {
      if (!roomId) return { ok: false, error: '缺少 roomId' };
      let room = rooms.get(roomId);
      if (!room) {
        room = createRoomState(roomId);
        rooms.set(roomId, room);
      }
      // 更新配置
      if (!config.rooms) config.rooms = [];
      const exist = config.rooms.find(r => r.id === roomId);
      if (exist) exist.enabled = true;
      else config.rooms.push({ id: roomId, name: '', enabled: true });
      saveConfig(config);
      // 重新连接
      if (room.ws) try { room.ws.close(); } catch(e) {}
      await ensureBinaryRunning().catch(e => console.error(`[daemon] ensureBinary 异常:`, e.message));
      startConnection(roomId, config);
      return { ok: true, message: `已恢复房间 ${roomId}` };
    }

    default:
      return { ok: false, error: `未知命令: ${cmd}` };
  }
}

// ====== 守护进程管理 ======
function writePid() {
  fs.writeFileSync(PID_FILE, String(process.pid), 'utf-8');
}

function readPid() {
  try {
    if (fs.existsSync(PID_FILE)) {
      return parseInt(fs.readFileSync(PID_FILE, 'utf-8').trim(), 10);
    }
  } catch (e) {}
  return null;
}

async function stopDaemon() {
  isShuttingDown = true;
  if (daemonLoopInterval) clearInterval(daemonLoopInterval);
  if (binaryProcess && !binaryProcess.killed) {
    try { binaryProcess.kill('SIGTERM'); } catch(e) {}
  }
  // 刷新所有房间
  for (const [roomId, room] of rooms) {
    try { await dbFlush(room); } catch(e) {}
    snapshotSession(room);  // 停止前做最后一次快照
    if (room.isRecording && room.session) {
      room.isRecording = false;
      finalizeSession(room);
      console.log(`[stop][${getDisplayName(room)}] session 已保存`);
      await generateAndSendReport(room);
    }
    // 清理快照文件
    try { fs.unlinkSync(path.join(DATA_DIR, `snapshot_${roomId}.json`)); } catch(e) {}
    if (room.ws) {
      try { room.ws.close(); } catch (e) {}
    }
  }
  try { await db.close(); } catch(e) {}
  try { fs.unlinkSync(PID_FILE); } catch (e) {}
  try { fs.unlinkSync(CONTROL_SOCKET); } catch (e) {}
  console.log('[stop] 守护进程已停止');
}

function daemonStatus() {
  const roomsStatus = {};
  for (const [roomId, room] of rooms) {
    roomsStatus[roomId] = {
      connected: room.ws && room.ws.readyState === WebSocket.OPEN,
      recording: room.isRecording,
      liveStatus: room.session?._liveStatus ?? null,
      stats: room.session?.stats || null,
    };
  }
  return {
    running: process.pid === readPid(),
    pid: process.pid,
    rooms: roomsStatus,
  };
}

/** 通过 Unix socket 发送控制命令到守护进程 */
function sendCommand(req, timeout = 3000) {
  return new Promise((resolve, reject) => {
    if (!fs.existsSync(CONTROL_SOCKET)) {
      return reject(new Error('socket 文件不存在'));
    }
    const client = net.createConnection(CONTROL_SOCKET, () => {
      client.end(JSON.stringify(req));
    });
    let buf = '';
    client.on('data', (chunk) => { buf += chunk.toString(); });
    client.on('end', () => {
      try { resolve(JSON.parse(buf)); }
      catch (e) { reject(new Error('解析响应失败')); }
    });
    client.on('error', reject);
    setTimeout(() => { client.destroy(); reject(new Error('超时')); }, timeout);
  });
}

// ====== 主入口 ======
if (require.main === module) {
  const args = process.argv.slice(2);

  if (args[0] === 'stop') {
    const pid = readPid();
    if (pid && pid !== process.pid) {
      try {
        process.kill(pid, 'SIGTERM');
        console.log('[stop] 已发送 SIGTERM 到进程', pid);
        setTimeout(() => { try { fs.unlinkSync(PID_FILE); } catch(e){} }, 1000);
      } catch (e) {
        console.error('[stop] 无法终止进程', pid, ':', e.message);
        try { fs.unlinkSync(PID_FILE); } catch(e){}
      }
    } else {
      console.log('[stop] 没有运行的守护进程');
      try { fs.unlinkSync(PID_FILE); } catch(e){}
    }
    process.exit(0);
  }

  if (args[0] === 'status') {
    // 尝试通过 socket 获取详细状态
    sendCommand({ cmd: 'status' }).then(resp => {
      if (resp.ok) {
        console.log(JSON.stringify(resp.data, null, 2));
      } else {
        // socket 不通，检查进程是否在跑
        const pid = readPid();
        if (pid) {
          try { process.kill(pid, 0); console.log(JSON.stringify({ running: true, pid, note: 'socket 不可达' }, null, 2)); }
          catch (e) { console.log(JSON.stringify({ running: false, pid: null }, null, 2)); try { fs.unlinkSync(PID_FILE); } catch(ex){} }
        } else {
          console.log(JSON.stringify({ running: false, pid: null }, null, 2));
        }
      }
      process.exit(0);
    }).catch(() => {
      const pid = readPid();
      console.log(JSON.stringify({ running: !!pid, pid }, null, 2));
      process.exit(0);
    });
    return;
  }

  // add/remove/pause/resume 需要指定 room_id
  if (['add', 'remove', 'pause', 'resume'].includes(args[0])) {
    const roomId = args.find(a => /^\d+$/.test(a));
    if (!roomId) {
      console.error(`用法: node monitor.js ${args[0]} <room_id>`);
      process.exit(1);
    }
    sendCommand({ cmd: args[0], roomId }).then(resp => {
      if (resp.ok) {
        console.log(`✅ ${resp.message || 'OK'}`);
      } else {
        console.error(`❌ ${resp.error}`);
        process.exit(1);
      }
      process.exit(0);
    }).catch(e => {
      console.error(`❌ 无法连接守护进程: ${e.message}`);
      console.error('确保守护进程正在运行 (node monitor.js --daemon)');
      process.exit(1);
    });
    return;
  }

  if (args[0] === 'snapshot' || args[0] === '快照') {
    const targetRoomId = args.find(a => /^\d+$/.test(a));
    (async () => {
      try {
        const data = await reportImg.load(targetRoomId);
        if (!data) {
          console.log(JSON.stringify({ type: 'snapshot', error: '暂无直播数据' }));
          process.exit(0);
        }
        const config = loadConfig();
        const pngPath = await reportImg.generateImage(data);
        const openId = config.feishu?.open_id || '';
        if (!openId) { console.log(JSON.stringify({ type: 'snapshot', error: 'feishu.open_id 未配置' })); process.exit(1); }
        const ok = await feishu.sendImage(openId, pngPath, 'open_id');
        try { fs.unlinkSync(pngPath); } catch(e){}
        console.log(JSON.stringify({ type: 'snapshot', result: ok ? 'ok' : 'failed' }));
      } catch (e) {
        console.log(JSON.stringify({ type: 'snapshot', error: e.message }));
      }
      process.exit(0);
    })();
    return;
  }

  if (args[0] === 'report-image' || args[0] === '图片') {
    const targetRoomId = args.find(a => /^\d+$/.test(a));
    (async () => {
      try {
        const data = await reportImg.load(targetRoomId);
        if (!data) {
          console.log(JSON.stringify({ type: 'image', error: '暂无直播数据' }));
          process.exit(0);
        }
        const config = loadConfig();
        const pngPath = await reportImg.generateImage(data);
        const openId = config.feishu?.open_id || '';
        if (!openId) { console.log('feishu.open_id 未配置'); return; }
        const ok = await feishu.sendImage(openId, pngPath, 'open_id');
        if (ok) {
          console.log('图片报告已发送 ✅');
          try { fs.unlinkSync(pngPath); } catch(e){}
        } else {
          console.log('图片发送失败');
        }
      } catch (e) {
        console.log('生成图片失败:', e.message);
      }
      process.exit(0);
    })();
    return;
  }

  // ====== 启动守护进程 ======
  const config = loadConfig();
  const cliRoomId = args.find(a => /^\d+$/.test(a));
  const targetRooms = getTargetRooms(config, cliRoomId);

  if (targetRooms.length === 0) {
    console.error('[daemon] 没有配置要监控的房间');
    console.error('用法: node monitor.js --daemon [room_id]');
    console.error('或在 runtime-config.json 中配置 rooms 数组');
    process.exit(1);
  }

  db.init().catch(e => console.error('[db] 初始化失败:', e.message));

  // 定期 DB 刷写 + 内存快照
  setInterval(() => {
    for (const [, room] of rooms) {
      if (room.isRecording && room.session) {
        dbFlush(room).catch(e => console.error(`[dbFlush][${room.roomId}] 异常:`, e.message));
        snapshotSession(room);  // 每次刷写时也做快照，防异常退出丢数据
      }
    }
  }, 5000);

  // 定期日志轮转（每 5 分钟检查一次）
  setInterval(() => {
    rotateLogFile(LOG_FILE);
    rotateLogFile(path.join(logsDir, 'binary_output.log'));
  }, 5 * 60 * 1000);

  // 检查已有进程
  const existingPid = readPid();
  if (existingPid) {
    try {
      process.kill(existingPid, 0);
      console.error(`[daemon] 已有守护进程在运行 (PID ${existingPid})`);
      console.error('运行 "node monitor.js stop" 先停止');
      process.exit(1);
    } catch (e) {
      console.log('[daemon] 清理过期 PID');
    }
  }

  writePid();
  const roomIds = targetRooms.map(r => r.id).join(', ');
  console.log(`[daemon] 启动，PID=${process.pid}，监控房间=${roomIds}`);

  // 启动控制 socket
  const controlServer = startControlSocket();

  ensureBinaryRunning().then(async () => {
    for (const r of targetRooms) {
      const room = createRoomState(r.id);
      rooms.set(r.id, room);
      await loadRoomName(room);
      console.log(`[daemon] ${room.displayName} (${r.id}) 已加载`);
      startConnection(r.id, config);
    }
  }).catch((e) => {
    console.error('[daemon] 二进制启动失败，仍尝试连接:', e.message);
    for (const r of targetRooms) {
      startConnection(r.id, config);
    }
  });

  process.on('unhandledRejection', (reason) => {
    console.error('[daemon] 未处理的 Promise 拒绝:', reason?.message || reason);
  });
  process.on('uncaughtException', (err) => {
    console.error('[daemon] 未捕获异常:', err.message, err.stack);
  });
  process.on('SIGINT', async () => { console.log('\n[daemon] 收到 SIGINT'); await stopDaemon(); process.exit(0); });
  process.on('SIGTERM', async () => { console.log('[daemon] 收到 SIGTERM'); await stopDaemon(); process.exit(0); });

  // 定期心跳
  daemonLoopInterval = setInterval(async () => {
    // 每 30 秒检查一次 Go 代理健康状态
    const portOpen = await checkPort(1088).catch(() => false);
    if (!portOpen) {
      console.log('[daemon] Go 代理端口不可达，尝试重启...');
      await ensureBinaryRunning().catch(e => console.error(`[daemon] ensureBinary 异常:`, e.message));
    }
    
    for (const [roomId, room] of rooms) {
      const st = room.session?.stats || {};
      const connected = room.ws && room.ws.readyState === WebSocket.OPEN;
      console.log(`[${getDisplayName(room)}] [heartbeat] 录制=${room.isRecording} 连接=${connected} 弹幕=${st.danmaku||0} 礼物=${st.gift||0}`);
      if (!connected) ensureBinaryRunning().catch(e => console.error(`[daemon] ensureBinary 异常:`, e.message));
    }
  }, 30000);
}
