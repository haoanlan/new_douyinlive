/**
 * 用 Go 代理批量查询房间当前的直播状态（匿名，无需 cookie）。
 * 用法: node scripts/probe-rooms-live.js
 */
const PROXY = process.env.PROXY_BASE || 'http://127.0.0.1:1088';

// 库里场次数最多的几个房间
const ROOMS = [
  { id: '65209552987', name: '林语巷' },
  { id: '57644688826', name: '萱萱🍋🍋‍🟩🍒🧸🛌林语巷' },
  { id: '305154900785', name: '苏江巅峰之夜王者赛道' },
  { id: '48465460802', name: '无限·011' },
  { id: 'sjcm009', name: 'Fire苏江009' }
];

async function main() {
  // 批量接口（一次问多个房间）
  try {
    const res = await fetch(`${PROXY}/api/v1/rooms/status:batch`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ live_ids: ROOMS.map((r) => r.id) }),
      signal: AbortSignal.timeout(20000)
    });
    const json = await res.json();
    console.log(`批量查询 HTTP ${res.status}`);
    const list = json?.data?.rooms || json?.data || [];
    if (Array.isArray(list) && list.length) {
      for (const item of list) {
        const known = ROOMS.find((r) => r.id === item.live_id);
        console.log(
          `  ${String(known?.name || item.live_id).padEnd(26)} ${String(item.live_id).padEnd(14)} status=${item.status} is_live=${item.is_live} has_room=${item.has_room}`
        );
      }
      return;
    }
    console.log('  返回结构:', JSON.stringify(json).slice(0, 300));
  } catch (e) {
    console.log('批量接口失败:', e.message, '→ 改为逐个查询');
  }

  for (const r of ROOMS) {
    try {
      const res = await fetch(`${PROXY}/api/v1/rooms/${r.id}/status`, {
        signal: AbortSignal.timeout(15000)
      });
      const json = await res.json();
      const d = json?.data || {};
      console.log(
        `  ${r.name.padEnd(26)} ${String(r.id).padEnd(14)} status=${d.status} is_live=${d.is_live} has_room=${d.has_room}`
      );
    } catch (e) {
      console.log(`  ${r.name} 查询失败: ${e.message}`);
    }
  }
}

main().catch((e) => { console.error('失败:', e.message); process.exitCode = 1; });
