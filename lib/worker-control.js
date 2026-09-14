/**
 * 仪表盘 → 监控 worker 的唯一调用入口。
 *
 * 演变背景：
 *   以前 worker（monitor.js）是独立进程，仪表盘只能通过一条命名管道
 *   （monitor.sock）跨进程发 JSON 命令。于是产生了一个环境相关故障：
 *   受限环境建不出命名管道时，房间的增/删/暂停/恢复全部返回 500，而且报错
 *   信息还是假的（"监控进程未运行"，可进程明明活着）。
 *
 *   现在 worker 与仪表盘在**同一个进程**里，控制命令就是一次普通函数调用：
 *   没有 IPC、没有管道、没有跨进程超时，也就不存在上述故障模式。
 *
 * 调用方只需要关心两件事：
 *   1. worker 是否在运行（isWorkerRunning）
 *   2. 命令的结果是成功还是业务失败（result.ok / result.error）
 */

const monitor = require('../monitor.js');

/** worker 是否正在运行 */
function isWorkerRunning() {
  return monitor.isWorkerRunning();
}

/**
 * 发送控制命令：add / remove / pause / resume / status / start / stop
 *
 * @param {string} cmd
 * @param {object} [payload] 例如 { roomId }
 * @returns {Promise<{ok:boolean, message?:string, error?:string, code?:string, data?:object}>}
 */
async function sendControlCommand(cmd, payload = {}) {
  if (!monitor.isWorkerRunning()) {
    return {
      ok: false,
      code: 'WORKER_DOWN',
      error: '监控 worker 未运行',
    };
  }
  try {
    const result = await monitor.handleControlCommand({ cmd, ...payload });
    return result || { ok: false, error: '控制命令无返回' };
  } catch (e) {
    return {
      ok: false,
      code: 'COMMAND_FAILED',
      error: `控制命令执行失败: ${e.message}`,
    };
  }
}

/**
 * 直接启动内嵌 worker（"启动/重启"操作用，worker 未运行时也能调用）。
 * 注意：不复用 sendControlCommand —— 它的前提是 worker 已经在跑。
 */
async function startWorker() {
  try {
    return await monitor.startDaemon({ embedded: true });
  } catch (e) {
    return { ok: false, error: `启动 worker 失败: ${e.message}` };
  }
}

/**
 * 房间运行状态：直接读 worker 内存（同进程，无需 socket / 日志解析）
 * @returns {Array} 空数组表示 worker 未运行
 */
function getRoomStates() {
  if (!monitor.isWorkerRunning()) return [];
  try {
    return monitor.getRoomStateList();
  } catch (e) {
    return [];
  }
}

/**
 * 把控制命令结果映射为 HTTP 状态码。
 *   worker 没在跑 → 503（服务不可用，不是服务端 bug）
 *   业务规则不满足（房间不存在、已在监控等）→ 409（冲突）
 *   成功 → 200
 */
function controlStatus(result) {
  if (result?.ok) return 200;
  if (result?.code === 'WORKER_DOWN') return 503;
  return 409;
}

module.exports = {
  isWorkerRunning,
  sendControlCommand,
  startWorker,
  getRoomStates,
  controlStatus,
};
