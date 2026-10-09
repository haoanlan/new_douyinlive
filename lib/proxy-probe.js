/**
 * Go 抓取代理的探活工具（TCP / HTTP health / WebSocket 握手）。
 *
 * 原来这三个函数写在 lib/routes/status.js 里，只有状态监控页用得到；
 * 总览页也需要知道代理到底起没起来（否则它只看守护进程，
 * 代理挂了也显示"正常"），所以抽出来给两处共用。
 */
const net = require('net');
const http = require('http');

const DEFAULT_PORT = Number(process.env.PROXY_PORT || 1088);

/** TCP 端口探测 */
function probeTcp(port = DEFAULT_PORT, timeout = 1200) {
  return new Promise((resolve) => {
    const sock = net.connect({ host: '127.0.0.1', port });
    const finish = (ok) => {
      try {
        sock.destroy();
      } catch {
        /* ignore */
      }
      resolve(ok);
    };
    sock.setTimeout(timeout);
    sock.on('connect', () => finish(true));
    sock.on('timeout', () => finish(false));
    sock.on('error', () => finish(false));
  });
}

/** WebSocket 升级握手探测：确认监听者确实是抓取代理 */
function probeWsHandshake(port = DEFAULT_PORT, timeout = 2000) {
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
    req.on('timeout', () => {
      req.destroy();
      resolve({ upgraded: false, error: 'timeout' });
    });
    req.end();
  });
}

/** 读取代理 /health（能返回就说明代理是活的，还能拿到版本） */
function probeHealth(port = DEFAULT_PORT, timeout = 2000) {
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
    req.on('timeout', () => {
      req.destroy();
      resolve({ ok: false, error: 'timeout' });
    });
    req.end();
  });
}

/**
 * 轻量探测（给"总览页"这种只需要结论、不想读日志/配置的地方用）
 * @returns {Promise<{port:number, reachable:boolean, healthy:boolean, tag:string|null}>}
 */
async function probeProxyLight(port = DEFAULT_PORT) {
  const reachable = await probeTcp(port);
  if (!reachable) return { port, reachable: false, healthy: false, tag: null };
  const health = await probeHealth(port);
  return {
    port,
    reachable: true,
    healthy: Boolean(health?.ok),
    tag: health?.data?.tag || null
  };
}

module.exports = { probeTcp, probeWsHandshake, probeHealth, probeProxyLight, DEFAULT_PORT };
