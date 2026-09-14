/**
 * 探测 Go 代理（1088）的 HTTP/WebSocket 响应特征，用于状态页健康判定。
 * 用法: node scripts/probe-proxy.js
 */
const http = require('http');
const net = require('net');

function tcpProbe(port, timeout = 1500) {
  return new Promise((resolve) => {
    const sock = net.connect({ host: '127.0.0.1', port });
    const done = (v) => { try { sock.destroy(); } catch {} resolve(v); };
    sock.setTimeout(timeout);
    sock.on('connect', () => done(true));
    sock.on('timeout', () => done(false));
    sock.on('error', () => done(false));
  });
}

function httpProbe(path) {
  return new Promise((resolve) => {
    const req = http.request(
      { host: '127.0.0.1', port: 1088, path, method: 'GET', timeout: 2500 },
      (res) => {
        let body = '';
        res.on('data', (c) => (body += c));
        res.on('end', () => resolve({ status: res.statusCode, body: body.slice(0, 300) }));
      }
    );
    req.on('error', (e) => resolve({ error: e.code || e.message }));
    req.on('timeout', () => { req.destroy(); resolve({ error: 'timeout' }); });
    req.end();
  });
}

function wsHandshakeProbe() {
  return new Promise((resolve) => {
    const key = Buffer.from('dGhlIHNhbXBsZSBub25jZQ==').toString('base64');
    const req = http.request(
      {
        host: '127.0.0.1',
        port: 1088,
        path: '/ws/000000',
        method: 'GET',
        timeout: 2500,
        headers: {
          Connection: 'Upgrade',
          Upgrade: 'websocket',
          'Sec-WebSocket-Version': '13',
          'Sec-WebSocket-Key': key
        }
      },
      (res) => resolve({ upgraded: false, status: res.statusCode })
    );
    req.on('upgrade', (res) => {
      resolve({ upgraded: true, status: 101, headers: res.headers });
      req.destroy();
    });
    req.on('error', (e) => resolve({ error: e.code || e.message }));
    req.on('timeout', () => { req.destroy(); resolve({ error: 'timeout' }); });
    req.end();
  });
}

(async () => {
  console.log('TCP 1088 可达:', await tcpProbe(1088));
  for (const p of ['/', '/healthz', '/status', '/ws']) {
    console.log(`HTTP GET ${p} ->`, JSON.stringify(await httpProbe(p)));
  }
  console.log('WebSocket 升级探测 /ws/000000 ->', JSON.stringify(await wsHandshakeProbe()));
})();
