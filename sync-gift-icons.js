/**
 * 从抖音API拉取礼物列表并缓存到SQLite
 * 用法: node sync-gift-icons.js
 */
const https = require('https');
const http = require('http');
const Database = require('better-sqlite3');
const path = require('path');
const { getCookie } = require('./lib/config-reader');

const DB_PATH = path.join(__dirname, 'db', 'douyin.db');

function fetchGiftList(cookie) {
  return new Promise((resolve, reject) => {
    const url = 'https://live.douyin.com/webcast/gift/list/?device_platform=webapp&aid=6383&cookie_enabled=true&browser_language=zh-CN&browser_platform=Win32&browser_name=Chrome&browser_version=120.0.0.0';
    const opts = {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Referer': 'https://live.douyin.com/',
        'Cookie': cookie
      }
    };
    https.get(url, opts, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try {
          const j = JSON.parse(data);
          resolve(j.data?.gifts || []);
        } catch (e) { reject(e); }
      });
    }).on('error', reject);
  });
}

async function main() {
  // 读取cookie（使用共享模块 lib/config-reader.js）
  const cookie = getCookie();
  if (!cookie) { console.error('找不到cookie，请检查 config.yaml'); process.exit(1); }

  console.log('正在拉取礼物列表...');
  const gifts = await fetchGiftList(cookie);
  console.log(`获取到 ${gifts.length} 个礼物`);

  if (!gifts.length) { console.error('礼物列表为空'); process.exit(1); }

  const db = new Database(DB_PATH);
  const upsert = db.prepare(`
    INSERT INTO gift_icons (gift_id, name, icon_url, diamond_count)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(gift_id) DO UPDATE SET
      name = excluded.name,
      icon_url = excluded.icon_url,
      diamond_count = excluded.diamond_count
  `);

  const tx = db.transaction(() => {
    for (const g of gifts) {
      const iconUrl = g.icon?.url_list?.[0] || g.image?.url_list?.[0] || '';
      upsert.run(g.id, g.name || '', iconUrl, g.diamond_count || 0);
    }
  });
  tx();

  console.log(`已写入/更新 ${gifts.length} 个礼物图标`);
  db.close();
}

main().catch(e => { console.error(e); process.exit(1); });
