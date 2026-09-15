#!/usr/bin/env node


// 启动时加载 .env 文件
try {
  const fs = require('fs');
  const envPath = __dirname + '/.env';
  if (fs.existsSync(envPath)) {
    const lines = fs.readFileSync(envPath, 'utf8').split('\n');
    for (const line of lines) {
      const m = line.match(/^\s*([\w_]+)\s*=\s*(.*?)\s*$/);
      if (m && !process.env[m[1]]) {
        process.env[m[1]] = m[2].replace(/["']/g, '');
      }
    }
  }
} catch(e) {/* ignore */}

/**
 * 抖音直播间监控 - 入口（薄壳）
 *
 * 这个文件原本是 1900 行的单体，现在只负责三件事：
 *   1. 确定运行模式（独立进程 / 嵌入仪表盘），并在任何日志产生之前接管 console
 *   2. 组装各模块，并把控制命令处理器注入 lifecycle（避免循环依赖）
 *   3. 保留命令行子命令
 *
 * 具体实现按职责拆到了 lib/worker/ 下：
 *   context.js          路径常量 + 跨模块共享状态（rooms Map、isShuttingDown 等）
 *   logger.js           日志流、轮转、console 接管
 *   config.js           配置读写 + 热加载 + 要监控哪些房间
 *   time.js             东八区时间格式化
 *   room-state.js       房间状态对象、主播名加载
 *   proxy-process.js    Go 抓取代理二进制的启动与守护
 *   session.js          场次：开播建档、批量刷库、结束出报告
 *   message-handler.js  WebSocket 消息处理（弹幕/礼物/进场/点赞/直播状态）
 *   connection.js       每房间一条长连接、心跳、指数退避重连
 *   commands.js         控制命令 + 控制 socket
 *   lifecycle.js        worker 启停、PID、状态查询
 *
 * 模式：
 *   --daemon               监控 config 中所有房间（独立进程）
 *   --daemon <room_id>     只监控指定房间
 *   stop                   停止守护进程
 *   status                 查看所有房间状态
 *   snapshot [room_id]     截图
 *   report-image [room_id] 生成图片报告
 *
 * 嵌入模式：被 web-dashboard.js require 时（require.main !== module），
 *   worker 与仪表盘同进程运行，控制命令走同进程函数调用，不再需要 monitor.sock。
 *   可用 DASHBOARD_EMBED_WORKER=0 让仪表盘不启用嵌入 worker，退回两进程模式。
 */
const fs = require('fs');
const reportImg = require('./report-image.js');
const feishu = require('./feishu-send.js');

const ctx = require('./lib/worker/context.js');
const logger = require('./lib/worker/logger.js');

// ====== 运行模式 ======
const IS_STANDALONE = require.main === module;
ctx.isStandalone = IS_STANDALONE;

// 接管 console 必须发生在任何模块产生日志之前。
// 独立模式：输出收进 logs/daemon.log（--daemon 时额外丢弃 stdout 防 EPIPE）
// 嵌入模式：镜像一份到 daemon.log，同时保留仪表盘自己的 stdout
logger.installConsoleCapture({
  standalone: IS_STANDALONE,
  daemonMode: process.argv.includes('--daemon'),
});

// 接管之后再加载其余模块（它们加载时可能写日志）
const { loadConfig, getTargetRooms } = require('./lib/worker/config.js');
const lifecycle = require('./lib/worker/lifecycle.js');
const commands = require('./lib/worker/commands.js');

const { DATA_DIR, PID_FILE } = ctx;
const {
  startDaemon, stopWorker, stopDaemon,
  isWorkerRunning, getRoomStateList, daemonStatus, readPid,
} = lifecycle;
const { sendCommand, handleControlCommand } = commands;

// 控制 socket 的命令处理器在这里注入：
// lifecycle.startDaemon 需要 startControlSocket（在 commands 里），
// 而 commands 又需要 lifecycle 的启停函数 —— 由入口注入即可打破循环依赖。
lifecycle.setCommandHandler(handleControlCommand);

// ====== 命令行子命令 ======
if (require.main === module) {
  const args = process.argv.slice(2);

  if (args[0] === 'stop') {
    const pid = readPid();
    if (pid && pid !== process.pid) {
      try {
        process.kill(pid, 'SIGTERM');
        console.log('[stop] 已发送 SIGTERM 到进程', pid);
        setTimeout(() => { try { fs.unlinkSync(PID_FILE); } catch(e){} }, 1000);
      } catch (e) {
        console.error('[stop] 无法终止进程', pid, ':', e.message);
        try { fs.unlinkSync(PID_FILE); } catch(e){}
      }
    } else {
      console.log('[stop] 没有运行的守护进程');
      try { fs.unlinkSync(PID_FILE); } catch(e){}
    }
    process.exit(0);
  }

  if (args[0] === 'status') {
    // 尝试通过 socket 获取详细状态
    sendCommand({ cmd: 'status' }).then(resp => {
      if (resp.ok) {
        console.log(JSON.stringify(resp.data, null, 2));
      } else {
        // socket 不通，检查进程是否在跑
        const pid = readPid();
        if (pid) {
          try { process.kill(pid, 0); console.log(JSON.stringify({ running: true, pid, note: 'socket 不可达' }, null, 2)); }
          catch (e) { console.log(JSON.stringify({ running: false, pid: null }, null, 2)); try { fs.unlinkSync(PID_FILE); } catch(ex){} }
        } else {
          console.log(JSON.stringify({ running: false, pid: null }, null, 2));
        }
      }
      process.exit(0);
    }).catch(() => {
      const pid = readPid();
      console.log(JSON.stringify({ running: !!pid, pid }, null, 2));
      process.exit(0);
    });
    return;
  }

  // add/remove/pause/resume 需要指定 room_id
  if (['add', 'remove', 'pause', 'resume'].includes(args[0])) {
    const roomId = args.find(a => /^\d+$/.test(a));
    if (!roomId) {
      console.error(`用法: node monitor.js ${args[0]} <room_id>`);
      process.exit(1);
    }
    sendCommand({ cmd: args[0], roomId }).then(resp => {
      if (resp.ok) {
        console.log(`✅ ${resp.message || 'OK'}`);
      } else {
        console.error(`❌ ${resp.error}`);
        process.exit(1);
      }
      process.exit(0);
    }).catch(e => {
      console.error(`❌ 无法连接守护进程: ${e.message}`);
      console.error('确保守护进程正在运行 (node monitor.js --daemon)');
      process.exit(1);
    });
    return;
  }

  if (args[0] === 'snapshot' || args[0] === '快照') {
    const targetRoomId = args.find(a => /^\d+$/.test(a));
    (async () => {
      try {
        const data = await reportImg.load(targetRoomId);
        if (!data) {
          console.log(JSON.stringify({ type: 'snapshot', error: '暂无直播数据' }));
          process.exit(0);
        }
        const config = loadConfig();
        const pngPath = await reportImg.generateImage(data);
        const openId = config.feishu?.open_id || '';
        if (!openId) { console.log(JSON.stringify({ type: 'snapshot', error: 'feishu.open_id 未配置' })); process.exit(1); }
        const ok = await feishu.sendImage(openId, pngPath, 'open_id');
        try { fs.unlinkSync(pngPath); } catch(e){}
        console.log(JSON.stringify({ type: 'snapshot', result: ok ? 'ok' : 'failed' }));
      } catch (e) {
        console.log(JSON.stringify({ type: 'snapshot', error: e.message }));
      }
      process.exit(0);
    })();
    return;
  }

  if (args[0] === 'report-image' || args[0] === '图片') {
    const targetRoomId = args.find(a => /^\d+$/.test(a));
    (async () => {
      try {
        const data = await reportImg.load(targetRoomId);
        if (!data) {
          console.log(JSON.stringify({ type: 'image', error: '暂无直播数据' }));
          process.exit(0);
        }
        const config = loadConfig();
        const pngPath = await reportImg.generateImage(data);
        const openId = config.feishu?.open_id || '';
        if (!openId) { console.log('feishu.open_id 未配置'); return; }
        const ok = await feishu.sendImage(openId, pngPath, 'open_id');
        if (ok) {
          console.log('图片报告已发送 ✅');
          try { fs.unlinkSync(pngPath); } catch(e){}
        } else {
          console.log('图片发送失败');
        }
      } catch (e) {
        console.log('生成图片失败:', e.message);
      }
      process.exit(0);
    })();
    return;
  }

  // ====== 启动守护进程（独立模式）======
  startDaemon({ cliRoomId: args.find(a => /^\d+$/.test(a)) }).catch((e) => {
    console.error('[daemon] 启动失败:', e.message);
    process.exit(1);
  });
}

// ====== 对外导出：供 web-dashboard.js 嵌入调用 ======
module.exports = {
  startDaemon,
  stopWorker,
  stopDaemon,
  isWorkerRunning,
  getRoomStateList,
  handleControlCommand,
  daemonStatus,
  loadConfig,
  getTargetRooms,
  DATA_DIR,
  PID_FILE,
};
