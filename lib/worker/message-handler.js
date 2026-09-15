/**
 * WebSocket 消息处理：弹幕/礼物/进场/点赞/直播状态
 *
 * 由 monitor.js 拆分而来（逐字搬运，未改动逻辑）。
 */
const fs = require('fs');
const path = require('path');
const db = require('../../db-sqlite.js');
const api = require('../douyin-api.js');
const { getCookie } = require('../config-reader');
const { DATA_DIR } = require('./context');
const { cstISO } = require('./time');
const { setStreamerDir } = require('./session');

// ====== 用户提取 ======
function extractUser(data) {
  const user = data.user || data.userValue?.user || {};
  return {
    id: user.id || '',
    nickname: user.nickname || '匿名',
    avatar: (user.avatarThumb?.urlList?.[0]) || '',
  };
}

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

module.exports = {
  handleMessage,
  extractUser,
  resolveAnchorName,
  extractTextContent,
};
