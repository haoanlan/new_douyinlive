/**
 * 房间状态对象与主播名加载
 *
 * 由 monitor.js 拆分而来（逐字搬运，未改动逻辑）。
 */
const path = require('path');
const db = require('../../db-sqlite.js');
const api = require('../douyin-api.js');
const { DATA_DIR } = require('./context');

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
    removed: false,        // 已被"删除房间"移除：禁止任何重连，否则房间会复活
    lastStatusCode: null,  // 最近一次 live_status 的 code（供 /api/rooms 直接读内存）
    lastTitle: null,       // 最近一次 live_status 的 title
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

module.exports = {
  createRoomState,
  getDisplayName,
  loadRoomName,
};
