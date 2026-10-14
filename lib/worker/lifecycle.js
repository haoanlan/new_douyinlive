/**
 * worker 生命周期：启动 / 停止 / PID / 状态查询
 *
 * 由 monitor.js 拆分而来（逐字搬运，未改动逻辑）。
 */
const fs = require('fs');
const path = require('path');
const { WebSocket } = require('ws');
const db = require('../../db-sqlite.js');
const ctx = require('./context');
const { DATA_DIR, PID_FILE, LOG_FILE, CONTROL_SOCKET, logsDir, rooms } = ctx;
const { loadConfig, getTargetRooms } = require('./config');
const { createRoomState, getDisplayName, loadRoomName } = require('./room-state');
const { snapshotSession, dbFlush, finalizeSession, generateAndSendReport } = require('./session');
const { checkPort, ensureBinaryRunning, killBinaryProcess } = require('./proxy-process');
const { startConnection } = require('./connection');
const { rotateLogFile } = require('./logger');

let daemonLoopInterval = null;
let flushInterval = null;    // 每 5 秒刷库
let rotateInterval = null;   // 每 5 分钟日志轮转

// ====== 守护进程管理 ======
/*
 * PID 文件带心跳（JSON），不再只写一个裸 PID。
 *
 * 起因（实测踩到）：嵌入模式的 worker 会把**宿主 dashboard 的 PID** 写进 monitor.pid，
 * 而启动时判断"是否已有 worker 在跑"只看 `process.kill(pid, 0)` 是否成功。
 * PID 一旦被系统复用、或上一次的宿主异常退出而 PID 恰好仍被别的进程占用，
 * 新起的 dashboard 就会认为"已有守护进程"→ **拒绝启动 worker** →
 * 采集静默停止、/api/status 一直 503，直到有人手动点「重启」。
 *
 * 心跳可区分"真的还有 worker 在写库"与"残留/被复用的 PID"：
 *   - 活着的 worker 每 5 秒更新一次 heartbeatAt（见 flushInterval）；
 *   - 超过 PID_STALE_MS 没更新，就当作残留，清理后接管。
 * 文件格式兼容旧的裸数字，避免升级后旧文件解析失败。
 */
const PID_STALE_MS = 45000;

function writePid() {
  try {
    fs.writeFileSync(
      PID_FILE,
      JSON.stringify({ pid: process.pid, embedded: true, startedAt: Date.now(), heartbeatAt: Date.now() }),
      'utf-8'
    );
  } catch (e) {
    console.error('[daemon] 写 PID 文件失败:', e.message);
  }
}

/** 刷新心跳（worker 运行期间定期调用） */
function touchPid() {
  try {
    const cur = readPidInfo();
    if (cur && cur.pid !== process.pid) return; // 已被别人接管，别覆盖
    fs.writeFileSync(
      PID_FILE,
      JSON.stringify({ pid: process.pid, embedded: true, startedAt: cur?.startedAt || Date.now(), heartbeatAt: Date.now() }),
      'utf-8'
    );
  } catch (e) {
    /* 心跳失败不致命 */
  }
}

/** 解析 PID 文件，返回 {pid, heartbeatAt, legacy}；兼容旧的裸数字格式 */
function readPidInfo() {
  try {
    if (!fs.existsSync(PID_FILE)) return null;
    const raw = fs.readFileSync(PID_FILE, 'utf-8').trim();
    if (!raw) return null;
    if (raw.startsWith('{')) {
      const j = JSON.parse(raw);
      const pid = parseInt(j.pid, 10);
      if (!pid) return null;
      return { pid, heartbeatAt: Number(j.heartbeatAt) || 0, startedAt: Number(j.startedAt) || 0, legacy: false };
    }
    const pid = parseInt(raw, 10);
    return pid ? { pid, heartbeatAt: 0, startedAt: 0, legacy: true } : null;
  } catch (e) {
    return null;
  }
}

function readPid() {
  const info = readPidInfo();
  return info ? info.pid : null;
}

/**
 * 判断 PID 文件是否代表"真的还有 worker 在写库"。
 * 活着的进程 + 新鲜心跳才算；旧的裸数字格式没有心跳，则回退为"进程活着就算占用"（保守，避免双写）。
 */
function isPidFileActive() {
  const info = readPidInfo();
  if (!info || info.pid === process.pid) return false;
  let alive = false;
  try { process.kill(info.pid, 0); alive = true; } catch (e) { alive = false; }
  if (!alive) return false;
  if (info.legacy || !info.heartbeatAt) return true;
  return Date.now() - info.heartbeatAt < PID_STALE_MS;
}


/**
 * 停止 worker：刷新并保存所有房间、断开连接、清理定时器。
 * 默认**不关闭数据库、不退出进程** —— 嵌入模式下仪表盘还要继续用 DB。
 * 可重复调用；调用后可以再次 startDaemon()。
 */
async function stopWorker({ closeDb = false } = {}) {
  ctx.isShuttingDown = true;
  if (daemonLoopInterval) { clearInterval(daemonLoopInterval); daemonLoopInterval = null; }
  if (flushInterval) { clearInterval(flushInterval); flushInterval = null; }
  if (rotateInterval) { clearInterval(rotateInterval); rotateInterval = null; }
  killBinaryProcess();
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
    try { fs.unlinkSync(path.join(DATA_DIR, `snapshot_${roomId}.json`)) } catch(e) {}
    if (room.ws) {
      try { room.ws.close(); } catch (e) {}
    }
    rooms.delete(roomId);
  }
  try { fs.unlinkSync(PID_FILE); } catch (e) {}
  if (closeDb) { try { await db.close(); } catch(e) {} }
  ctx.workerRunning = false;
  ctx.isShuttingDown = false;  // 收敛完成，允许再次 startDaemon()
}

/** 独立守护进程的优雅停止：停 worker + 关库 + 清理控制 socket */
async function stopDaemon() {
  await stopWorker({ closeDb: true });
  try { fs.unlinkSync(CONTROL_SOCKET); } catch (e) {}
  console.log('[stop] 守护进程已停止');
}

/** worker 是否正在运行（嵌入模式下路由用它判断"监控脚本是否在跑"） */
function isWorkerRunning() {
  return ctx.workerRunning;
}

/**
 * 直接读内存的房间运行状态，供 /api/rooms 与 /api/service/status 使用。
 * 嵌入模式下房间状态就在同一进程的内存里，不需要走 socket、也不需要解析日志。
 * 返回结构与 lib/room-status.js 的 getRoomStates() 对齐。
 */
function getRoomStateList() {
  const list = [];
  for (const [roomId, room] of rooms) {
    const connected = Boolean(room.ws && room.ws.readyState === WebSocket.OPEN);
    const st = room.session?.stats || {};
    list.push({
      roomId: String(roomId),
      name: getDisplayName(room),
      connected,
      recording: Boolean(room.isRecording),
      liveStatus: room.session?._liveStatus ?? null,
      statusCode: room.lastStatusCode ?? null,
      title: room.lastTitle || room.session?.room_title || '',
      danmaku: st.danmaku ?? null,
      gift: st.gift ?? null,
      ageMs: 0,
      stale: false,
      active: true,
    });
  }
  return list;
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

// ====== Worker 启动（独立模式 / 嵌入仪表盘共用）======
/**
 * 启动监控 worker。
 *
 * @param {object}  opts
 * @param {string}  [opts.cliRoomId] 只监控指定房间（命令行参数）
 * @param {boolean} [opts.embedded]  true = 被 web-dashboard.js require 进同一进程：
 *   - 不启动控制 socket（同进程直接函数调用，不需要 IPC）
 *   - 房间未配置时只告警，不退出进程
 *   - 不注册 SIGINT/SIGTERM 与全局异常兜底（由宿主进程统一负责）
 * @returns {Promise<{ok:boolean, pid?:number, rooms?:number, alreadyRunning?:boolean, error?:string}>}
 */
async function startDaemon({ cliRoomId = null, embedded = false } = {}) {
  if (ctx.workerRunning) {
    console.log('[daemon] worker 已在运行，忽略重复启动');
    return { ok: true, alreadyRunning: true, pid: process.pid };
  }

  const config = loadConfig();
  const targetRooms = getTargetRooms(config, cliRoomId);

  if (targetRooms.length === 0) {
    console.error('[daemon] 没有配置要监控的房间');
    console.error('用法: node monitor.js --daemon [room_id]');
    console.error('或在 runtime-config.json 中配置 rooms 数组');
    if (!embedded) process.exit(1);
    return { ok: false, error: '没有配置要监控的房间' };
  }

  await db.init().catch(e => console.error('[db] 初始化失败:', e.message));

  // 检查已有 worker：避免两个 worker 同时写同一个库。
  // 用"进程活着 + 心跳新鲜"判断，而不是只看 PID 存活 —— PID 会被系统复用，
  // 上一次宿主异常退出时残留的 PID 会让新进程误判并**拒绝启动 worker**（采集静默停止）。
  const existingPid = readPid();
  if (isPidFileActive()) {
    console.error(`[daemon] 已有守护进程在运行 (PID ${existingPid})`);
    if (!embedded) {
      console.error('运行 "node monitor.js stop" 先停止');
      process.exit(1);
    }
    console.error('[daemon] 嵌入模式不启动 worker：请先停止它，否则两个 worker 会同时写库');
    return { ok: false, error: `已有独立守护进程在运行 (PID ${existingPid})` };
  }
  if (existingPid) {
    console.log(`[daemon] 清理残留 PID 文件（PID ${existingPid} 已退出或心跳过期），接管 worker`);
  }

  writePid();  // 写入宿主进程 PID，独立模式据此检测冲突
  ctx.workerRunning = true;
  ctx.isShuttingDown = false;

  const roomIds = targetRooms.map(r => r.id).join(', ');
  console.log(`[daemon] 启动，PID=${process.pid}，监控房间=${roomIds}，模式=${embedded ? '嵌入仪表盘' : '独立进程'}`);

  // 控制 socket：仅独立模式需要（嵌入模式同进程直接调用函数，不再走 IPC）
  if (!embedded) {
    const handler = getCommandHandler();
    if (handler) require('./commands').startControlSocket(handler);
    else console.warn('[daemon] 未注入控制命令处理器，跳过控制 socket（嵌入模式不需要它）');
  }

  // 定期 DB 刷写 + 内存快照（顺带刷新 PID 心跳，见 isPidFileActive 的说明）
  flushInterval = setInterval(() => {
    touchPid();
    for (const [, room] of rooms) {
      if (room.isRecording && room.session) {
        dbFlush(room).catch(e => console.error(`[dbFlush][${room.roomId}] 异常:`, e.message));
        snapshotSession(room);  // 每次刷写时也做快照，防异常退出丢数据
      }
    }
  }, 5000);

  // 定期日志轮转（每 5 分钟检查一次）
  rotateInterval = setInterval(() => {
    rotateLogFile(LOG_FILE);
    rotateLogFile(path.join(logsDir, 'binary_output.log'));
  }, 5 * 60 * 1000);

  try {
    await ensureBinaryRunning();
  } catch (e) {
    console.error('[daemon] 二进制启动失败，仍尝试连接:', e.message);
  }

  for (const r of targetRooms) {
    if (rooms.has(r.id)) continue;
    const room = createRoomState(r.id);
    rooms.set(r.id, room);
    await loadRoomName(room);
    console.log(`[daemon] ${room.displayName} (${r.id}) 已加载`);
    startConnection(r.id, config);
  }

  if (!embedded) {
    process.on('unhandledRejection', (reason) => {
      console.error('[daemon] 未处理的 Promise 拒绝:', reason?.message || reason);
    });
    process.on('uncaughtException', (err) => {
      console.error('[daemon] 未捕获异常:', err.message, err.stack);
    });
    process.on('SIGINT', async () => { console.log('\n[daemon] 收到 SIGINT'); await stopDaemon(); process.exit(0); });
    process.on('SIGTERM', async () => { console.log('[daemon] 收到 SIGTERM'); await stopDaemon(); process.exit(0); });
  }

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

  return { ok: true, pid: process.pid, rooms: targetRooms.length };
}


// ====== 控制 socket 的依赖注入 ======
// startControlSocket 依赖 handleControlCommand，而 handleControlCommand 又要调用
// startDaemon/stopWorker —— 直接互相 require 会形成循环依赖。
// 所以由入口（monitor.js）把命令处理器注入进来，lifecycle 不反向依赖 commands。
let _commandHandler = null;
function setCommandHandler(fn) { _commandHandler = fn; }
function getCommandHandler() { return _commandHandler; }

module.exports = {
  writePid,
  readPid,
  readPidInfo,
  isPidFileActive,
  touchPid,
  stopWorker,
  stopDaemon,
  isWorkerRunning,
  getRoomStateList,
  daemonStatus,
  startDaemon,
  setCommandHandler,
};
