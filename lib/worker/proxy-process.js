/**
 * Go 抓取代理二进制的生命周期管理
 *
 * 由 monitor.js 拆分而来（逐字搬运，未改动逻辑）。
 */
const net = require('net');
const fs = require('fs');
const path = require('path');
const { DATA_DIR, logsDir } = require('./context');

let binaryProcess = null;
let binaryCrashCount = 0;
/*
 * 两个定时器必须提到模块级，否则 stopWorker 无从清理（原实现把 watchTimer 声明在
 * startBinary 内部，谁都无法清除；代理挂了之后的自动重启 setTimeout 同样无人管）。
 */
let watchTimer = null;
let restartTimer = null;
/** 用户显式"停止监控"后置 true：此时端口关闭属预期，不能再自动拉起代理 */
let stopping = false;

function checkPort(port) {
  return new Promise((resolve) => {
    const s = net.createConnection({ host: '127.0.0.1', port }, () => { s.destroy(); resolve(true); });
    s.on('error', () => { s.destroy(); resolve(false); });
    s.setTimeout(2000, () => { s.destroy(); resolve(false); });
  });
}

function startBinary() {
  // 平台自适应定位代理二进制；配置由 lib/proxy-binary.js 生成代理专用 proxy-config.yaml
  // （代理的 config schema 与 Node 端不同，不能共用 config.yaml）
  stopping = false;
  const proxy = require('../proxy-binary');
  const resolved = proxy.resolveBinary(DATA_DIR);
  if (!resolved.path) {
    console.error(`[binary] 未找到 Go 抓取代理（候选: ${resolved.candidates.join(', ')}）`);
    if (resolved.foreign) {
      console.error(`[binary] 目录里的 ${resolved.foreign} 不是当前平台(${process.platform})的构建，请换成对应平台版本`);
    }
    console.error('[binary] 请放到项目根目录，或用环境变量 DOUYIN_PROXY_BIN 指定');
    return;
  }
  const binaryPath = resolved.path;
  console.log(`[binary] 启动 ${resolved.name} 代理...`);
  try {
    const started = proxy.startProxy(DATA_DIR, binaryPath, path.join(logsDir, 'binary_output.log'), {
      port: 1088
      // 不再传 logLevel：命令行优先级高于配置文件，会把 config.yaml 的 log.level 顶掉
    });
    if (!started.ok) {
      console.error('[binary] 启动失败:', started.error);
      return;
    }
    /*
     * 保存真实的 ChildProcess 句柄（started.child），killBinaryProcess 才杀得掉。
     * 以前这里存的是 `{ pid, killed:false }` 对象字面量 —— 没有 kill 方法，
     * 调用 `.kill('SIGTERM')` 直接 TypeError，又被空 catch 吞掉，代理永远不会被停掉。
     */
    binaryProcess = { pid: started.pid, child: started.child || null, killed: false };
    const binaryLogFile = path.join(logsDir, 'binary_output.log');
    const binaryLogStream = fs.createWriteStream(binaryLogFile, { flags: 'a' });
    binaryLogStream.on('error', () => { /* 忽略日志流错误 */ });
    // 进程句柄不可跨模块传递，用轮询替代 exit 事件：端口消失即认为代理挂了
    if (watchTimer) { clearInterval(watchTimer); watchTimer = null; }
    watchTimer = setInterval(() => {
      if (stopping) return;   // 主动停止中，端口关闭是预期行为
      checkPort(1088).then((open) => {
        if (!open && binaryProcess && !stopping) {
          if (watchTimer) { clearInterval(watchTimer); watchTimer = null; }
          console.log('[binary] 代理端口已关闭，进程应已退出');
          binaryProcess = null;
          binaryCrashCount++;
          const delay = Math.min(binaryCrashCount * 5000, 60000);
          if (binaryCrashCount <= 10) {
            console.log(`[binary] ${delay / 1000}秒后自动重启...`);
            if (restartTimer) clearTimeout(restartTimer);
            restartTimer = setTimeout(() => { restartTimer = null; startBinary(); }, delay);
          } else {
            console.log('[binary] 重试次数过多，不再自动重启');
          }
        }
      }).catch(() => { /* ignore */ });
    }, 15000);
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


/**
 * 停掉代理子进程（供 stopWorker 调用）
 *
 * 修了两个实测问题：
 *   1) 原来调的是模块私有对象上的 `.kill()` —— 那个对象是 `{pid, killed}` 字面量，
 *      没有 kill 方法，TypeError 被空 catch 吞掉 → 点「停止监控」后代理仍在跑（实测 1088 存活）。
 *      现在优先用真实 ChildProcess 句柄；句柄不可用时退回按 PID 结束进程。
 *   2) 停止后必须清掉 watchTimer 与"自动重启"的 setTimeout，并置 stopping，
 *      否则端口一关，15 秒后 watchTimer 又会把代理拉起来 —— 与用户意图相反。
 */
function killBinaryProcess() {
  stopping = true;
  if (watchTimer) { clearInterval(watchTimer); watchTimer = null; }
  if (restartTimer) { clearTimeout(restartTimer); restartTimer = null; }
  const p = binaryProcess;
  binaryProcess = null;
  binaryCrashCount = 0;
  if (!p || p.killed) return;
  p.killed = true;
  try {
    if (p.child && !p.child.killed) {
      p.child.kill('SIGTERM');
      console.log(`[binary] 已终止代理子进程 (PID ${p.pid})`);
      return;
    }
  } catch (e) {
    console.error('[binary] 终止代理句柄失败，改用 PID:', e.message);
  }
  try {
    process.kill(p.pid, 'SIGTERM');
    console.log(`[binary] 已按 PID 终止代理 (PID ${p.pid})`);
  } catch (e) {
    // 进程已经不存在是正常情况（例如它自己崩了）
    console.log(`[binary] 代理进程不存在或已退出 (PID ${p.pid}): ${e.code || e.message}`);
  }
}

module.exports = {
  checkPort,
  startBinary,
  ensureBinaryRunning,
  killBinaryProcess,
};
