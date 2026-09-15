/**
 * 共享上下文：路径常量 + 跨模块的运行时状态
 *
 * 为什么需要这个文件：
 *   拆分 monitor.js 时，rooms（内存中的房间状态表）和 isShuttingDown 这类状态
 *   被多个模块共用。对象（Map）可以解构共享同一个实例，但**原始值不行** ——
 *   解构布尔值只会在各模块里复制一份快照，一个模块改了别的模块看不到。
 *   所以原始值统一放在这里，各模块通过 ctx.xxx 读写。
 *
 * 注意 DATA_DIR 是仓库根目录（monitor.js 原本就在根目录，__dirname 即根目录），
 * 本文件在 lib/worker/ 下，所以要往上退两级。
 */
const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', '..');
const PID_FILE = path.join(DATA_DIR, 'monitor.pid');
const CONFIG_FILE = path.join(DATA_DIR, 'runtime-config.json');
const LOG_FILE = path.join(DATA_DIR, 'logs', 'daemon.log');
const CONTROL_SOCKET = path.join(DATA_DIR, 'monitor.sock');
const logsDir = path.join(DATA_DIR, 'logs');
if (!fs.existsSync(logsDir)) fs.mkdirSync(logsDir, { recursive: true });

/** roomId -> roomState。对象，可以安全解构共享 */
const rooms = new Map();

module.exports = {
  // 路径常量
  DATA_DIR,
  PID_FILE,
  CONFIG_FILE,
  LOG_FILE,
  CONTROL_SOCKET,
  logsDir,

  // 共享状态（原始值，必须通过 ctx.xxx 读写）
  rooms,
  isShuttingDown: false,  // 正在关停：此时禁止重连
  workerRunning: false,   // worker 是否在运行
  isStandalone: false,    // 独立进程模式（node monitor.js --daemon）
};
