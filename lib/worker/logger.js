/**
 * 日志：日志流、轮转、console 接管
 *
 * 为什么 console 接管要参数化：
 *   原 monitor.js 在模块加载时就覆盖全局 console.log/error。它作为独立进程运行时
 *   这是对的（所有输出收进 logs/daemon.log）；但被 web-dashboard.js require 进
 *   同一进程时，这会把**宿主（仪表盘）自己的日志也吞掉**。
 *   所以改成显式 install：嵌入模式下镜像一份到 daemon.log，同时保留宿主的 stdout。
 *
 * 注意：install 必须由入口在**任何可能产生日志的代码之前**调用。
 */
const fs = require('fs');
const { LOG_FILE } = require('./context');

/** 单文件最大 10MB，保留最近 3 个备份 */
const LOG_MAX_SIZE = 10 * 1024 * 1024;
const LOG_BACKUPS = 3;

const logStream = fs.createWriteStream(LOG_FILE, { flags: 'a' });

// 错误日志滑动窗口：每分钟最多 50 条
const _errorLogWindow = { count: 0, resetTime: Date.now() + 60000 };
const _rawConsole = { log: console.log.bind(console), error: console.error.bind(console) };

let IS_STANDALONE = false;
let isDaemon = false;
let _installed = false;

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

/**
 * 接管 console。
 * @param {object} opts
 * @param {boolean} opts.standalone 是否作为独立进程运行（require.main === module）
 * @param {boolean} opts.daemonMode 命令行是否带 --daemon
 */
function installConsoleCapture({ standalone = false, daemonMode = false } = {}) {
  if (_installed) return;
  _installed = true;
  IS_STANDALONE = standalone;
  isDaemon = daemonMode;

  if (isDaemon && IS_STANDALONE) {
    // daemon 模式：stdout/stderr 丢弃，彻底避免 EPIPE。
    // 注意：Windows 上没有 /dev/null，必须走 NUL / \\.\NUL，
    // 否则 createWriteStream 抛 ENOENT 变成未捕获异常。
    const isWin = process.platform === 'win32';
    try {
      const devNull = isWin
        ? fs.createWriteStream('\\\\.\\NUL', { flags: 'w' })
        : fs.createWriteStream('/dev/null');
      devNull.on('error', () => { /* 丢弃：daemon 模式下不关心 stdout */ });
      process.stdout = devNull;
      process.stderr = devNull;
    } catch (e) {
      // 拿不到空设备也不能让进程崩，退化为把 stdout/stderr 指向日志流
      process.stdout = logStream;
      process.stderr = logStream;
    }
  }

  console.log = (...args) => {
    const s = args.join(' ');
    logStream.write(`[${new Date().toISOString()}] ${s}\n`);
    if (!IS_STANDALONE) _rawConsole.log(...args);  // 嵌入模式：同时保留宿主的 stdout
  };

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
    if (!IS_STANDALONE) _rawConsole.error(...args);  // 嵌入模式：同时保留宿主的 stderr
  };
}

module.exports = { logStream, rotateLogFile, installConsoleCapture, LOG_MAX_SIZE, LOG_BACKUPS };
