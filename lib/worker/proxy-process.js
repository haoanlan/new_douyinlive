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
      port: 1088,
      logLevel: 'info'
    });
    if (!started.ok) {
      console.error('[binary] 启动失败:', started.error);
      return;
    }
    // 需要拿到子进程句柄以便监控退出与自动重启，这里复用同一套 spawn 结果
    binaryProcess = { pid: started.pid, killed: false };
    const binaryLogFile = path.join(logsDir, 'binary_output.log');
    const binaryLogStream = fs.createWriteStream(binaryLogFile, { flags: 'a' });
    binaryLogStream.on('error', () => { /* 忽略日志流错误 */ });
    // 进程句柄不可跨模块传递，用轮询替代 exit 事件：端口消失即认为代理挂了
    const watchTimer = setInterval(() => {
      checkPort(1088).then((open) => {
        if (!open && binaryProcess) {
          clearInterval(watchTimer);
          console.log('[binary] 代理端口已关闭，进程应已退出');
          binaryProcess = null;
          binaryCrashCount++;
          const delay = Math.min(binaryCrashCount * 5000, 60000);
          if (binaryCrashCount <= 10) {
            console.log(`[binary] ${delay / 1000}秒后自动重启...`);
            setTimeout(startBinary, delay);
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


/** 停掉代理子进程（供 stopWorker 调用，替换直接访问模块私有变量） */
function killBinaryProcess() {
  if (binaryProcess && !binaryProcess.killed) {
    try { binaryProcess.kill('SIGTERM'); } catch (e) { /* ignore */ }
  }
}

module.exports = {
  checkPort,
  startBinary,
  ensureBinaryRunning,
  killBinaryProcess,
};
