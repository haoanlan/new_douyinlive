/**
 * 状态监控路由
 *
 * 页面只有四块：顶栏 / Go 代理 / 监控脚本 / WebSocket，外加异常提醒与日志。
 *
 * 判定口径：
 * - Go 代理  ：TCP 127.0.0.1:1088 可达 + /health 返回 status=ok
 *              （比单纯探端口准，能区分"端口被别的程序占用"和"代理真的可用"）
 * - 监控脚本 ：默认嵌入本进程（worker 与仪表盘同进程），直接问内存；
 *              设 DASHBOARD_EMBED_WORKER=0 可退回"独立守护进程 + 控制 socket"模式
 * - WS 连接  ：房间运行状态汇总，数据源统一走 lib/room-status.js
 *              （内存优先 → socket → daemon 日志兜底）
 *
 * 平台：Linux 服务器与 Windows 开发机通用，代理二进制由 lib/proxy-binary.js 解析。
 */
const fs = require('fs');
const net = require('net');
const http = require('http');
const path = require('path');
const { spawn } = require('child_process');
const proxyBinary = require('../proxy-binary');
const roomStatusLib = require('../room-status');
const workerControl = require('../worker-control');

const PROXY_PORT = proxyBinary.PORT;
const { tailLines } = roomStatusLib;

/** 监控 worker 是否嵌入在仪表盘进程内（默认是） */
const EMBED_WORKER = process.env.DASHBOARD_EMBED_WORKER !== '0';

/** TCP 端口探测 */
function probeTcp(port, timeout = 1200) {
  return new Promise((resolve) => {
    const sock = net.connect({ host: '127.0.0.1', port });
    const finish = (ok) => { try { sock.destroy(); } catch { /* ignore */ } resolve(ok); };
    sock.setTimeout(timeout);
    sock.on('connect', () => finish(true));
    sock.on('timeout', () => finish(false));
    sock.on('error', () => finish(false));
  });
}

/** WebSocket 升级握手探测：确认监听者确实是抓取代理 */
function probeWsHandshake(port = PROXY_PORT, timeout = 2000) {
  return new Promise((resolve) => {
    const req = http.request(
      {
        host: '127.0.0.1',
        port,
        path: '/ws/000000000000',
        method: 'GET',
        timeout,
        headers: {
          Connection: 'Upgrade',
          Upgrade: 'websocket',
          'Sec-WebSocket-Version': '13',
          'Sec-WebSocket-Key': 'dGhlIHNhbXBsZSBub25jZQ=='
        }
      },
      (res) => {
        res.resume();
        resolve({ upgraded: false, status: res.statusCode });
      }
    );
    req.on('upgrade', () => {
      resolve({ upgraded: true, status: 101 });
      req.destroy();
    });
    req.on('error', (e) => resolve({ upgraded: false, error: e.code || e.message }));
    req.on('timeout', () => { req.destroy(); resolve({ upgraded: false, error: 'timeout' }); });
    req.end();
  });
}

/** 读取代理 /health（能返回就说明代理是活的，还能拿到版本） */
function probeHealth(port = PROXY_PORT, timeout = 2000) {
  return new Promise((resolve) => {
    const req = http.request(
      { host: '127.0.0.1', port, path: '/health', method: 'GET', timeout },
      (res) => {
        let body = '';
        res.on('data', (c) => (body += c));
        res.on('end', () => {
          try {
            const j = JSON.parse(body);
            resolve({
              ok: res.statusCode === 200 && (j?.data?.status === 'ok' || j?.status === 'ok'),
              status: res.statusCode,
              data: j?.data || j || null
            });
          } catch {
            resolve({ ok: false, status: res.statusCode, error: '响应不是 JSON' });
          }
        });
      }
    );
    req.on('error', (e) => resolve({ ok: false, error: e.code || e.message }));
    req.on('timeout', () => { req.destroy(); resolve({ ok: false, error: 'timeout' }); });
    req.end();
  });
}

/** 进程是否存活 */
function isAlive(pid) {
  if (!pid) return false;
  try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; }
}

/** 通过控制 socket 向守护进程发命令 */
function askDaemon(socketPath, payload, timeout = 3000) {
  return new Promise((resolve) => {
    if (!fs.existsSync(socketPath)) return resolve({ ok: false, error: 'socket 不存在' });
    let buf = '';
    let settled = false;
    const done = (v) => { if (!settled) { settled = true; resolve(v); } };
    const client = net.createConnection(socketPath, () => {
      client.write(JSON.stringify(payload));
    });
    client.on('data', (c) => { buf += c.toString(); });
    client.on('end', () => {
      try { client.destroy(); } catch { /* ignore */ }
      try { done(JSON.parse(buf)); } catch { done({ ok: false, error: '解析响应失败' }); }
    });
    client.on('error', (e) => done({ ok: false, error: e.message }));
    setTimeout(() => { try { client.destroy(); } catch { /* ignore */ } done({ ok: false, error: '超时' }); }, timeout);
  });
}

/**
 * 停掉占用指定端口的进程（用于"重启 Go 代理"）。
 * 跨平台：Windows 走 netstat + taskkill，Linux/macOS 走 lsof + kill。
 * @returns {Promise<boolean>} 是否真的杀掉了进程
 */
async function stopProxyOnPort(port) {
  const { execFile } = require('child_process');
  const run = (cmd, args) =>
    new Promise((resolve) => {
      execFile(cmd, args, { timeout: 8000, windowsHide: true }, (err, stdout) => {
        resolve(err ? '' : String(stdout || ''));
      });
    });

  let pids = [];
  if (process.platform === 'win32') {
    const out = await run('netstat', ['-ano', '-p', 'tcp']);
    for (const line of out.split(/\r?\n/)) {
      const parts = line.trim().split(/\s+/);
      // 形如: TCP  127.0.0.1:1088  0.0.0.0:0  LISTENING  1234
      if (parts[0] === 'TCP' && parts[1] && parts[1].endsWith(`:${port}`) && parts[3] === 'LISTENING') {
        const pid = parseInt(parts[4], 10);
        if (pid && !pids.includes(pid)) pids.push(pid);
      }
    }
    for (const pid of pids) {
      await run('taskkill', ['/PID', String(pid), '/F']);
    }
  } else {
    const out = await run('lsof', ['-ti', `tcp:${port}`, '-sTCP:LISTEN']);
    pids = out.split(/\s+/).map((s) => parseInt(s, 10)).filter(Boolean);
    for (const pid of pids) {
      try { process.kill(pid, 'SIGTERM'); } catch { /* ignore */ }
    }
  }
  return pids.length > 0;
}

/** 启动守护进程（monitor.js --daemon），日志落 logs/dashboard-monitor.log */
function startDaemon(root, logFile) {
  try {
    const out = fs.openSync(logFile, 'a');
    const child = spawn(process.execPath, ['monitor.js', '--daemon'], {
      cwd: root,
      detached: true,
      // 不用管道：日志直接落文件，避免管道缓冲与受限环境下 EPERM
      stdio: ['ignore', out, out]
    });
    child.unref();
    return { ok: true, pid: child.pid };
  } catch (e) {
    return { ok: false, error: `启动守护进程失败: ${e.message}` };
  }
}

/** 等待条件成立 */
async function waitFor(fn, timeoutMs = 8000, stepMs = 500) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await fn()) return true;
    await new Promise((r) => setTimeout(r, stepMs));
  }
  return false;
}

module.exports = async function (pathname, query, req, res, ctx) {
  const { sendJSON, sendError, bodyParse, DATA_DIR, dbInstance } = ctx;
  const pidFile = path.join(DATA_DIR, 'monitor.pid');
  const socketPath = path.join(DATA_DIR, 'monitor.sock');
  const monitorLog = path.join(DATA_DIR, 'logs', 'dashboard-monitor.log');
  const binaryLog = path.join(DATA_DIR, 'logs', 'binary_output.log');
  const daemonLog = path.join(DATA_DIR, 'logs', 'daemon.log');
  const runtimeConfig = path.join(DATA_DIR, 'runtime-config.json');
  const configYaml = path.join(DATA_DIR, 'config.yaml');

  const readPidFile = () => {
    try { return parseInt(fs.readFileSync(pidFile, 'utf-8').trim(), 10) || null; } catch { return null; }
  };
  const bin = proxyBinary.resolveBinary(DATA_DIR);

  // ---------- 状态快照 ----------
  if (pathname === '/api/service/status') {
    const pid = readPidFile();
    const pidAlive = isAlive(pid);

    // 判定口径：
    //   嵌入模式（默认）—— worker 就在本进程里，直接问它：没有 socket、不会误报
    //   独立模式         —— monitor.pid 存活 + 控制 socket 能应答，才算真正在跑
    let daemonData = null;
    let daemonError = null;
    let daemonRunning = false;
    if (EMBED_WORKER && workerControl.isWorkerRunning()) {
      const reply = await workerControl.sendControlCommand('status');
      daemonRunning = true;
      if (reply && reply.ok && reply.data) {
        daemonData = reply.data;
      } else {
        daemonError = reply?.error || '控制命令无返回';
      }
    } else {
      const reply = await askDaemon(socketPath, { cmd: 'status' }, 2500);
      if (reply && reply.ok && reply.data) {
        daemonData = reply.data;
        daemonRunning = true;
      } else if (pidAlive) {
        // 控制通道不可用，但进程确实活着 → 视为运行中（降级）
        daemonRunning = true;
        daemonError = '控制通道不可用（monitor.sock 未建立），房间级实时状态不可读';
      } else if (pid) {
        daemonError = 'PID 文件存在但进程已不存在';
      } else {
        daemonError = '监控 worker 未运行';
      }
    }

    const portOpen = await probeTcp(PROXY_PORT);
    // 端口通了再看 /health：只有 health 正常才算代理真正可用
    const health = portOpen ? await probeHealth(PROXY_PORT) : null;
    const wsProbe = portOpen && !health?.ok ? await probeWsHandshake() : null;

    // 房间运行状态：统一走 lib/room-status.js（socket 优先 + 日志兜底 + 逐房间新鲜度）
    const roomStatus = await roomStatusLib.getRoomStates({ dbInstance, dataDir: DATA_DIR });
    const roomStates = roomStatus.rooms;
    const roomStateSource = roomStatus.source;
    const roomStateAgeMs = roomStatus.ageMs;

    // 陈旧日志不能当成"当前连接状态"
    const connected = roomStatus.stale ? [] : roomStates.filter((r) => r.connected);
    const recording = roomStatus.stale ? [] : roomStates.filter((r) => r.recording);
    const live = roomStateSource === 'log-stale' ? [] : roomStates.filter((r) => r.liveStatus === true);

    const checks = {
      binary: Boolean(bin.path),
      configYaml: fs.existsSync(configYaml),
      runtimeConfig: fs.existsSync(runtimeConfig),
      cookie: false
    };
    try {
      const yaml = fs.readFileSync(configYaml, 'utf-8');
      const m = yaml.match(/^\s*douyin:\s*(?:'([^']*)'|"([^"]*)"|(\S+))/m);
      checks.cookie = Boolean((m?.[1] ?? m?.[2] ?? m?.[3] ?? '').trim());
    } catch { /* 保持 false */ }

    let configuredRooms = 0;
    try {
      const rc = JSON.parse(fs.readFileSync(runtimeConfig, 'utf-8'));
      configuredRooms = (rc.rooms || []).filter((r) => r && r.enabled !== false).length;
    } catch { /* ignore */ }

    // 数据库里登记的房间总数（房间管理页显示的就是这些）
    let totalRooms = 0;
    try {
      totalRooms = dbInstance.prepare('SELECT COUNT(*) c FROM streamers').get().c;
    } catch { /* ignore */ }

    // 异常判定（页面只展示这些，不展示配置细节）
    const issues = [];
    if (!checks.binary) {
      if (bin.foreign) {
        issues.push({
          level: 'error',
          text: `目录里的 ${bin.foreign} 不是当前平台（${process.platform}）的构建，请换成对应平台的代理文件`
        });
      } else {
        issues.push({ level: 'error', text: `未找到 Go 抓取代理（候选：${bin.candidates.join(' / ')}），监控无法启动` });
      }
    }
    if (!checks.cookie) issues.push({ level: 'warn', text: 'config.yaml 未配置抖音 cookie，代理可能拉不到数据' });
    if (configuredRooms === 0) {
      issues.push({ level: 'warn', text: '未配置监控房间，守护进程启动后会立即退出' });
    }
    if (pidAlive && !daemonData) {
      issues.push({ level: 'warn', text: `监控脚本在运行，但${daemonError}` });
    }
    if (daemonData && !portOpen) issues.push({ level: 'error', text: '监控脚本在运行但 Go 代理端口 1088 不可达' });
    if (portOpen && health && !health.ok) {
      issues.push({
        level: 'warn',
        text: `1088 端口在监听但 /health 异常（${health.error || 'HTTP ' + health.status}），可能不是本项目的抓取代理`
      });
    }
    if (roomStateSource !== 'log-stale' && roomStates.length > 0 && connected.length === 0) {
      issues.push({ level: 'warn', text: '所有房间的 WebSocket 均已断开，监控脚本会自动重连' });
    }
    if (roomStateSource === 'log') {
      issues.push({
        level: 'warn',
        text: '控制通道不可用，房间状态取自监控日志（可能略有延迟）'
      });
    }
    if (roomStateSource === 'log-stale') {
      const mins = roomStateAgeMs ? Math.round(roomStateAgeMs / 60000) : null;
      issues.push({
        level: 'warn',
        text: `监控脚本未运行，当前连接状态未知（日志是${
          mins === null ? '更早' : mins > 1440 ? Math.round(mins / 1440) + ' 天前' : mins + ' 分钟前'
        }的记录，仅供参考）`
      });
    }
    if (pid && !pidAlive && !daemonData) {
      issues.push({ level: 'warn', text: 'monitor.pid 残留：上次异常退出，点「重启」会自动清理' });
    }

    const daemonLogLines = tailLines(daemonLog, 60);
    if (daemonLogLines.some((l) => /spawn EPERM|listen EACCES|operation not permitted/i.test(l))) {
      issues.push({
        level: 'warn',
        text: '当前运行环境限制了子进程/命名管道，页面重启可能拉不起来，请在服务器终端手动执行 node monitor.js --daemon'
      });
    }

    // 日志尾部（折叠展示，排查用）
    const logLines = [
      ...tailLines(monitorLog, 12).map((l) => ({ src: 'monitor', text: l })),
      ...tailLines(daemonLog, 10).map((l) => ({ src: 'daemon', text: l })),
      ...tailLines(binaryLog, 8).map((l) => ({ src: 'proxy', text: l }))
    ].slice(-24);

    return sendJSON(res, {
      ok: true,
      checkedAt: Date.now(),
      platform: process.platform,
      proxy: {
        port: PROXY_PORT,
        reachable: portOpen,
        healthy: Boolean(health?.ok),
        health: health?.data
          ? {
              status: health.data.status,
              tag: health.data.tag,
              commit: health.data.commit,
              signProvider: health.data.sign_provider
            }
          : null,
        wsProbe,
        binaryName: bin.name,
        binaryPath: bin.path ? path.relative(DATA_DIR, bin.path) : null,
        binaryExists: checks.binary,
        foreignBinary: bin.foreign || null,
        candidates: bin.candidates
      },
      daemon: {
        pid: pidAlive ? pid : null,
        pidFile: pid,
        pidStale: Boolean(pid && !pidAlive && !daemonData),
        running: daemonRunning,
        responsive: Boolean(daemonData),
        controlChannel: Boolean(daemonData),
        error: daemonError,
        data: daemonData
      },
      ws: {
        rooms: roomStateSource === 'log-stale' ? 0 : roomStates.length,
        connected: connected.length,
        recording: recording.length,
        live: live.length,
        connectedIds: connected.map((r) => r.roomId || r.name),
        source: roomStateSource,
        /** 日志数据的年龄（毫秒），仅 source 为 log/log-stale 时有值 */
        ageMs: roomStateAgeMs,
        states: roomStates
      },
      checks,
      configuredRooms,
      totalRooms,
      issues,
      logLines
    });
  }

  // ---------- 快速操作 ----------
  if (pathname === '/api/service/action' && req.method === 'POST') {
    const body = await bodyParse(req);
    const action = String(body.action || '');
    try { fs.mkdirSync(path.join(DATA_DIR, 'logs'), { recursive: true }); } catch { /* ignore */ }

    const clearPid = () => { try { fs.unlinkSync(pidFile); } catch { /* ignore */ } };

    /** 停止监控脚本：
     *    嵌入模式 —— 只停 worker（刷库 + 保存场次），仪表盘进程继续对外服务
     *    独立模式 —— 先走控制 socket 优雅停止，再兜底 SIGTERM */
    const stopDaemonProcess = async (pid) => {
      if (EMBED_WORKER && workerControl.isWorkerRunning()) {
        const reply = await workerControl.sendControlCommand('stop');
        const stopped = await waitFor(async () => !workerControl.isWorkerRunning(), 8000, 300);
        return { stopped, socketReply: reply, embedded: true };
      }
      if (!isAlive(pid)) { clearPid(); return { stopped: true, note: '进程已不存在' }; }
      const socketReply = await askDaemon(socketPath, { cmd: 'stop' }, 3000);
      let stopped = await waitFor(async () => !isAlive(pid), 6000);
      if (!stopped) {
        try { process.kill(pid, 'SIGTERM'); } catch { /* ignore */ }
        stopped = await waitFor(async () => !isAlive(pid), 4000);
      }
      if (stopped) clearPid();
      return { stopped, socketReply };
    };

    /**
     * 等待监控脚本就绪：先快速判死（进程已退出立即失败），
     * 再给控制 socket 留绑定时间（Windows 命名管道较慢）。
     */
    const waitDaemonReady = async (aliveTimeoutMs = 5000, bindTimeoutMs = 9000) => {
      // 嵌入模式：worker 就在本进程里，直接看它起没起来，无需等 socket 绑定
      if (EMBED_WORKER) {
        const ready = await waitFor(async () => workerControl.isWorkerRunning(), aliveTimeoutMs + bindTimeoutMs, 500);
        return { ready, pidAlive: true, pid: readPidFile() || process.pid, tail: tailLines(daemonLog, 12) };
      }
      const aliveDeadline = Date.now() + aliveTimeoutMs;
      while (Date.now() < aliveDeadline) {
        const pid = readPidFile();
        if (!pid || !isAlive(pid)) {
          return { ready: false, pidAlive: false, pid, tail: tailLines(daemonLog, 12) };
        }
        const probe = await askDaemon(socketPath, { cmd: 'status' }, 1200);
        if (probe?.ok && probe?.data) {
          return { ready: true, pidAlive: true, pid, tail: tailLines(daemonLog, 10) };
        }
        await new Promise((r) => setTimeout(r, 700));
      }
      const bindDeadline = Date.now() + bindTimeoutMs;
      while (Date.now() < bindDeadline) {
        await new Promise((r) => setTimeout(r, 1200));
        const probe = await askDaemon(socketPath, { cmd: 'status' }, 1500);
        if (probe?.ok && probe?.data) {
          return { ready: true, pidAlive: true, pid: readPidFile(), tail: tailLines(daemonLog, 10) };
        }
      }
      const finalPid = readPidFile();
      return { ready: false, pidAlive: isAlive(finalPid), pid: finalPid, tail: tailLines(daemonLog, 12) };
    };

    /** 启动 Go 代理 */
    if (action === 'start-proxy') {
      if (await probeTcp(PROXY_PORT)) {
        return sendJSON(res, { ok: true, message: `Go 代理已在监听 ${PROXY_PORT}`, alreadyRunning: true });
      }
      if (!bin.path) {
        return sendJSON(res, { ok: false, error: `未找到 Go 抓取代理（候选：${bin.candidates.join(' / ')}）` });
      }
      const started = proxyBinary.startBinary(bin.path, DATA_DIR, binaryLog);
      if (!started.ok) return sendJSON(res, started);
      const up = await waitFor(() => probeTcp(PROXY_PORT), 10000);
      return sendJSON(res, {
        ok: up,
        pid: started.pid,
        message: up
          ? `Go 代理已启动（${bin.name}）并监听 ${PROXY_PORT}`
          : '已触发启动，但 10 秒内端口仍未响应，请查看 logs/binary_output.log',
        logLines: tailLines(binaryLog, 8)
      });
    }

    /**
     * 重启 Go 代理：先停掉占用 1088 的进程（通常是旧代理），再用当前二进制拉起。
     * 说明：如果代理是由监控脚本托管的（monitor.js 会自己 ensureBinaryRunning），
     * 直接重启代理可能与脚本的自动重启竞争，所以这里先看有没有 daemon 在跑并提示。
     */
    if (action === 'restart-proxy') {
      const stoppedByTaskkill = await stopProxyOnPort(PROXY_PORT);
      await waitFor(async () => !(await probeTcp(PROXY_PORT)), 5000, 300);
      if (!bin.path) {
        return sendJSON(res, {
          ok: false,
          error: `未找到 Go 抓取代理（候选：${bin.candidates.join(' / ')}），无法重启`
        });
      }
      const started = proxyBinary.startBinary(bin.path, DATA_DIR, binaryLog);
      if (!started.ok) return sendJSON(res, started);
      const up = await waitFor(() => probeTcp(PROXY_PORT), 12000);
      const health = up ? await probeHealth(PROXY_PORT) : null;
      return sendJSON(res, {
        ok: up,
        pid: started.pid,
        message: up
          ? `Go 代理已重启（${bin.name}${health?.data?.tag ? ' ' + health.data.tag : ''}）`
          : '已触发重启，但 12 秒内端口仍未响应，请查看 logs/binary_output.log',
        killedPrevious: stoppedByTaskkill,
        logLines: tailLines(binaryLog, 10)
      });
    }

    /** 启动 / 重启 / 停止监控 worker
     *  嵌入模式下始终在本进程内启停，**不会** spawn 第二个 worker（避免两个 worker 同时写库） */
    if (action === 'start' || action === 'restart' || action === 'stop') {
      const pid = readPidFile();
      const running = EMBED_WORKER ? workerControl.isWorkerRunning() : isAlive(pid);

      if (action === 'stop') {
        if (!running) {
          clearPid();
          return sendJSON(res, { ok: true, message: '监控 worker 本来就没有运行（已清理残留 PID）' });
        }
        const r = await stopDaemonProcess(pid);
        if (r.stopped) {
          return sendJSON(res, {
            ok: true,
            message: r.embedded ? '监控 worker 已停止（仪表盘继续运行）' : `监控脚本已停止 (PID ${pid})`
          });
        }
        return sendJSON(res, {
          ok: false,
          error: r.embedded
            ? '监控 worker 停止超时，请查看 logs/daemon.log'
            : `无法停止进程 ${pid}，请在服务器上手动结束`
        });
      }

      if (action === 'start' && running) {
        return sendJSON(res, {
          ok: true,
          message: `监控 worker 已在运行 (PID ${pid || process.pid})`,
          alreadyRunning: true
        });
      }

      if (action === 'restart' && running) {
        const r = await stopDaemonProcess(pid);
        if (!r.stopped) {
          return sendJSON(res, { ok: false, error: `无法停止旧的监控 worker${pid ? ` (PID ${pid})` : ''}，重启中止` });
        }
      }

      if (!fs.existsSync(runtimeConfig)) {
        return sendJSON(res, {
          ok: false,
          error: '尚未配置监控房间：缺少 runtime-config.json，请先在「房间管理」添加房间'
        });
      }
      clearPid();

      // 嵌入模式：本进程内拉起 worker；独立模式：spawn 一个 monitor.js --daemon
      const started = EMBED_WORKER
        ? await workerControl.startWorker()
        : startDaemon(DATA_DIR, monitorLog);
      if (!started.ok) return sendJSON(res, started);

      const r = await waitDaemonReady();
      const readyPid = r.pid || started.pid || process.pid;
      if (r.ready) {
        return sendJSON(res, {
          ok: true,
          pid: readyPid,
          message: action === 'restart'
            ? `监控 worker 已重启 (PID ${readyPid})`
            : `监控 worker 已启动 (PID ${readyPid})`
        });
      }
      const why = !r.pidAlive ? '进程已退出' : 'worker 未就绪';
      const fatal = (r.tail || []).reverse().find((l) => /ERROR/.test(l));
      return sendJSON(res, {
        ok: false,
        pid: r.pid,
        error: `${action === 'restart' ? '重启' : '启动'}未成功（${why}）${fatal ? '：' + fatal.replace(/^\[[^\]]+\]\s*/, '').slice(0, 200) : ''}`,
        hint: !bin.path ? `未找到 Go 抓取代理（候选：${bin.candidates.join(' / ')}）` : undefined,
        logLines: r.tail
      });
    }

    return sendError(res, `未知操作: ${action}`, 400);
  }

  return false;
};
