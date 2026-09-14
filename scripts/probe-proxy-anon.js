/**
 * 探测 Go 代理在「没有 cookie」时的能力边界：
 * 房间解析 / 直播状态 / 主播信息分别能不能拿到。
 * 用法: node scripts/probe-proxy-anon.js [房间号]
 */
const PROXY = process.env.PROXY_BASE || 'http://127.0.0.1:1088';
const ROOM = process.argv[2] || '48465460802';

async function get(path) {
  try {
    const res = await fetch(`${PROXY}${path}`, { signal: AbortSignal.timeout(15000) });
    const text = await res.text();
    let json = null;
    try { json = JSON.parse(text); } catch { /* ignore */ }
    return { status: res.status, json, text: text.slice(0, 300) };
  } catch (e) {
    return { status: 0, error: e.message };
  }
}

async function main() {
  console.log(`代理: ${PROXY}  房间: ${ROOM}\n`);

  const health = await get('/health');
  console.log(`/health -> ${health.status} ${JSON.stringify(health.json?.data || health.text)}`);

  const caps = await get('/api/v1/capabilities');
  if (caps.json?.data) {
    const d = caps.json.data;
    console.log(`\n/api/v1/capabilities:`);
    console.log(`  websocket_endpoint: ${d.websocket_endpoint}`);
    console.log(`  websocket_auth: ${JSON.stringify(d.websocket_auth)}`);
    console.log(`  endpoints: ${(d.endpoints || []).join(', ')}`);
  }

  console.log(`\n--- 匿名（无 cookie）能力探测 ---`);
  const rooms = await get('/api/v1/rooms');
  console.log(`/api/v1/rooms -> ${rooms.status} ${JSON.stringify(rooms.json?.data || rooms.json || rooms.text).slice(0, 200)}`);

  const resolve = await get(`/api/v1/rooms/resolve?url=https://live.douyin.com/${ROOM}`);
  console.log(`/api/v1/rooms/resolve -> ${resolve.status} ${JSON.stringify(resolve.json?.data || resolve.json || resolve.text).slice(0, 300)}`);

  const status = await get(`/api/v1/rooms/${ROOM}/status`);
  console.log(`/api/v1/rooms/${ROOM}/status -> ${status.status} ${JSON.stringify(status.json?.data || status.json || status.text).slice(0, 300)}`);

  const anchor = await get(`/api/v1/rooms/${ROOM}/anchor`);
  console.log(`/api/v1/rooms/${ROOM}/anchor -> ${anchor.status} ${JSON.stringify(anchor.json?.data || anchor.json || anchor.text).slice(0, 300)}`);
}

main().catch((e) => { console.error('失败:', e.message); process.exitCode = 1; });
