/**
 * 房间运行状态（连接 / 录制 / 开播）的唯一数据源
 *
 * 为什么要抽出来：
 *   /api/rooms（房间管理页）和 /api/service/status（状态监控页）都需要"每个房间现在连没连上"，
 *   早期实现只在 /api/rooms 里通过 monitor.sock 取，socket 不可用时直接返回 {}，
 *   于是页面把所有房间都显示成未连接 —— 而日志里其实明确记录了连接状态。
 *   这里统一封装为「socket 优先 + 日志兜底 + 逐房间新鲜度判定」，两处共用同一份逻辑。
 *
 * 返回的房间状态字段：
 *   roomId, name, connected, recording, liveStatus, statusCode, title, danmaku, gift,
 *   ageMs（数据年龄，毫秒）, stale（是否已过期）, source（socket | log）
 */
const fs = require('fs');
const net = require('net');
const path = require('path');

/** 日志超过这个时间没有新记录，就认为数据已经过期（默认 5 分钟） */
const STALE_MS = 5 * 60 * 1000;

/** 读取文件尾部若干行 */
function tailLines(file, maxLines = 300) {
  try {
    const raw = fs.readFileSync(file, 'utf-8');
    return raw.split(/\r?\n/).filter(Boolean).slice(-maxLines);
  } catch {
    return [];
  }
}

/** 通过控制 socket 向守护进程要一次状态 */
function askDaemon(socketPath, timeout = 2000) {
  return new Promise((resolve) => {
    if (!fs.existsSync(socketPath)) return resolve(null);
    let buf = '';
    let settled = false;
    const done = (v) => { if (!settled) { settled = true; resolve(v); } };
    const client = net.createConnection(socketPath, () => {
      client.write(JSON.stringify({ cmd: 'status' }));
    });
    client.on('data', (c) => { buf += c.toString(); });
    client.on('end', () => {
      try { client.destroy(); } catch { /* ignore */ }
      try {
        const j = JSON.parse(buf);
        done(j?.data?.rooms ? j.data : null);
      } catch { done(null); }
    });
    client.on('error', () => done(null));
    setTimeout(() => { try { client.destroy(); } catch { /* ignore */ } done(null); }, timeout);
  });
}

/**
 * 解析 daemon 日志里的房间状态。
 * 识别三类行（monitor.js 输出）：
 *   [房间名] 已连接，等待直播...
 *   [房间名] [heartbeat] 录制=false 连接=true 弹幕=0 礼物=0
 *   [房间名] [live_status] code=ROOM_OFFLINE live=false ended=false title=xxx
 */
function parseRoomStatesFromLog(lines, { nameToId = {} } = {}) {
  const states = {};
  const ensure = (rawName) => {
    if (!states[rawName]) {
      states[rawName] = {
        name: rawName,
        roomId: nameToId[rawName] || '',
        connected: null,
        recording: null,
        liveStatus: null,
        statusCode: null,
        title: null,
        danmaku: null,
        gift: null,
        lastHeartbeatAt: null,
        lastStatusAt: null,
        connectedAt: null
      };
    }
    return states[rawName];
  };

  for (const line of lines) {
    const tsMatch = line.match(/^\[([0-9T:.Z+-]+)\]\s*/);
    const ts = tsMatch ? Date.parse(tsMatch[1]) : null;
    const body = line.replace(/^\[[^\]]+\]\s*/, '');

    const hb = body.match(
      /^\[(.+?)\]\s*\[heartbeat\]\s*录制=(\S+)\s*连接=(\S+)\s*弹幕=(\d+)\s*礼物=(\d+)/
    );
    if (hb) {
      const st = ensure(hb[1]);
      st.recording = hb[2] === 'true';
      st.connected = hb[3] === 'true';
      st.danmaku = Number(hb[4]);
      st.gift = Number(hb[5]);
      if (ts) st.lastHeartbeatAt = Math.max(st.lastHeartbeatAt || 0, ts);
      continue;
    }

    const ls = body.match(
      /^\[(.+?)\]\s*\[live_status\]\s*code=(\S+)\s*live=(\S+)\s*ended=(\S+)\s*title=(.*)$/
    );
    if (ls) {
      const st = ensure(ls[1]);
      st.statusCode = ls[2];
      st.liveStatus = ls[3] === 'true';
      st.title = (ls[5] || '').trim() || null;
      if (ts) st.lastStatusAt = Math.max(st.lastStatusAt || 0, ts);
      continue;
    }

    // 刚连上时还没有 heartbeat，靠这条判断已连接
    const conn = body.match(/^\[(.+?)\]\s*(已连接|连接断开)/);
    if (conn) {
      const st = ensure(conn[1]);
      if (conn[2] === '已连接') {
        st.connected = true;
        if (ts) st.connectedAt = Math.max(st.connectedAt || 0, ts);
      } else {
        st.connected = false;
        if (ts) st.lastStatusAt = Math.max(st.lastStatusAt || 0, ts);
      }
    }
  }

  return Object.values(states);
}

/** 房间名 ↔ 房间号映射（日志里只有房间名） */
function buildNameMaps(dbInstance) {
  const nameToId = {};
  const idToName = {};
  try {
    const rows = dbInstance.prepare('SELECT room_id, name FROM streamers').all();
    for (const r of rows) {
      if (r.name && r.room_id) {
        nameToId[r.name] = String(r.room_id);
        idToName[String(r.room_id)] = r.name;
      }
    }
  } catch { /* 映射失败不影响主流程 */ }
  return { nameToId, idToName };
}

/**
 * 取当前房间运行状态
 * @returns {{ source:'socket'|'log'|'none', stale:boolean, ageMs:number|null, rooms:Array }}
 */
async function getRoomStates({ dbInstance, dataDir }) {
  const socketPath = path.join(dataDir, 'monitor.sock');
  const daemonLog = path.join(dataDir, 'logs', 'daemon.log');
  const { nameToId } = buildNameMaps(dbInstance);

  // 1) 首选控制通道（精确、实时）
  const socketRooms = await askDaemon(socketPath);
  if (socketRooms) {
    return {
      source: 'socket',
      stale: false,
      ageMs: 0,
      rooms: Object.entries(socketRooms).map(([id, st]) => ({
        roomId: String(id),
        name: nameToId[String(id)] || '',
        connected: Boolean(st?.connected),
        recording: Boolean(st?.recording),
        liveStatus: st?.liveStatus ?? null,
        statusCode: null,
        title: null,
        danmaku: st?.stats?.danmaku ?? null,
        gift: st?.stats?.gift ?? null,
        ageMs: 0,
        stale: false
      }))
    };
  }

  // 2) 兜底：解析守护进程日志，并逐房间判定新鲜度
  const parsed = parseRoomStatesFromLog(tailLines(daemonLog, 400), { nameToId });
  if (!parsed.length) return { source: 'none', stale: true, ageMs: null, rooms: [] };

  const now = Date.now();
  const withAge = parsed.map((r) => {
    const last = Math.max(r.lastHeartbeatAt || 0, r.lastStatusAt || 0, r.connectedAt || 0);
    const ageMs = last ? now - last : null;
    return { ...r, ageMs, stale: ageMs === null || ageMs > STALE_MS };
  });

  // 只保留仍然新鲜房间：旧会话残留不能因为别的房间有新日志而被当成当前状态
  const fresh = withAge.filter((r) => !r.stale);
  if (!fresh.length) {
    return { source: 'log-stale', stale: true, ageMs: null, rooms: withAge };
  }
  const ageMs = Math.min(...fresh.map((r) => r.ageMs).filter((a) => a !== null));
  return { source: 'log', stale: false, ageMs, rooms: fresh };
}

module.exports = {
  STALE_MS,
  tailLines,
  askDaemon,
  parseRoomStatesFromLog,
  buildNameMaps,
  getRoomStates
};
