/**
 * 场次生命周期：开播建档、内存累积、批量刷库、结束出报告
 *
 * 由 monitor.js 拆分而来（逐字搬运，未改动逻辑）。
 */
const fs = require('fs');
const path = require('path');
const db = require('../../db-sqlite.js');
const reportImg = require('../../report-image.js');
const feishu = require('../../feishu-send.js');
const { DATA_DIR } = require('./context');
const { loadConfig } = require('./config');
const { cstISO, cstFileTimestamp } = require('./time');

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
      await db.updateSessionStats(room.dbSessionId, {
        danmaku: newDanmaku.length,
        gift: newGifts.length,
        member: newMembers.length
      });
      await db.getPool().query(
        'UPDATE sessions SET stats_like = ?, stats_follow = ?, stats_social = ? WHERE id = ?',
        [room.session.stats.like || 0, room.session.stats.follow || 0, room.session.stats.social || 0, room.dbSessionId]
      );
      room.dbSyncState.likes = room.session.stats.like || 0;
    } else if (room.session.stats.like > 0 && room.session.stats.like !== room.dbSyncState.likes) {
      await db.getPool().query(
        'UPDATE sessions SET stats_like = ?, stats_follow = ?, stats_social = ? WHERE id = ?',
        [room.session.stats.like || 0, room.session.stats.follow || 0, room.session.stats.social || 0, room.dbSessionId]
      );
      room.dbSyncState.likes = room.session.stats.like || 0;
    }
    // online_peak 单独更新：只要有在线数据就计算峰值
    if (lenOnline > 0) {
      const peak = room.session.online.reduce((max, o) => Math.max(max, parseInt(String(o.count), 10) || 0), 0);
      if (peak > 0) {
        await db.getPool().query(
          'UPDATE sessions SET online_peak = MAX(COALESCE(online_peak, 0), ?) WHERE id = ?',
          [peak, room.dbSessionId]
        );
      }
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
      .then(() => console.log(`[session][${room.roomId}] endSession 完成, id=${room.dbSessionId}`))
      .catch(e => console.error(`[session][${room.roomId}] endSession 失败:`, e.message, e.stack));
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

module.exports = {
  setStreamerDir,
  createSession,
  saveSession,
  snapshotSession,
  restoreFromSnapshot,
  dbFlush,
  finalizeSession,
  generateAndSendReport,
};
