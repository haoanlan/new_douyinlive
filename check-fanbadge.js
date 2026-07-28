const https = require('https');
const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');

const configContent = fs.readFileSync('config.yaml', 'utf-8');
const cookieMatch = configContent.match(/cookie:\s*\n\s*douyin:\s*'([^']+)'/);
const cookie = cookieMatch ? cookieMatch[1] : '';

const db = new Database('db/douyin.db');

// 从外部文件加载主播列表（streamers.json）
const streamersPath = path.join(__dirname, 'streamers.json');
if (!fs.existsSync(streamersPath)) {
  console.error('未找到 streamers.json，请复制 streamers.example.json 为 streamers.json 并填写主播信息');
  process.exit(1);
}
const streamers = JSON.parse(fs.readFileSync(streamersPath, 'utf-8'));

// 敌意弹幕用户
const startMs = new Date('2026-06-29T18:20:00Z').getTime();
const endMs = new Date('2026-06-29T18:35:00Z').getTime();

const hostileUsers = db.prepare(`
  SELECT DISTINCT d.nickname, d.user_sec_uid
  FROM danmaku d
  JOIN sessions s ON d.session_id = s.id
  WHERE d.create_time >= ? AND d.create_time < ?
    AND s.room_id = '305154900785'
    AND (
      d.content LIKE '%提词器%' OR d.content LIKE '%念稿%' OR d.content LIKE '%看稿%' OR
      d.content LIKE '%背诗%' OR d.content LIKE '%练台词%' OR d.content LIKE '%干巴%' OR
      d.content LIKE '%怪怪%' OR d.content LIKE '%进步%' OR d.content LIKE '%拉跨%' OR
      d.content LIKE '%瞟%' OR d.content LIKE '%念书%' OR d.content LIKE '%提词%' OR
      d.content LIKE '%小学生%' OR d.content LIKE '%好了%' OR d.content LIKE '%别看了%' OR
      d.content LIKE '%够了%' OR d.content LIKE '%下一个%' OR d.content LIKE '%情商低%' OR
      d.content LIKE '%对比%' OR d.content LIKE '%吓跑%' OR d.content LIKE '%公司不管%' OR
      d.content LIKE '%别唠%' OR d.content LIKE '%多练%' OR d.content LIKE '%乱说%' OR
      d.content LIKE '%说的什么%' OR d.content LIKE '%一句嗯%' OR d.content LIKE '%别催%' OR
      d.content LIKE '%照着%' OR d.content LIKE '%滚%' OR d.content LIKE '%分b不刷%'
    )
    AND d.user_sec_uid IS NOT NULL AND d.user_sec_uid != ''
  ORDER BY d.create_time ASC
`).all(startMs, endMs);

// 所有主播（从 streamers.json 加载，见上方）

function query(userUid, anchorUid) {
  return new Promise((resolve, reject) => {
    const params = new URLSearchParams({
      aid: '6383', device_platform: 'web',
      sec_target_uid: userUid, sec_anchor_id: anchorUid,
    });
    const url = `https://live.douyin.com/webcast/user/profile/?${params}`;
    const req = https.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Referer': 'https://www.douyin.com/',
        'Cookie': cookie,
      },
      timeout: 10000,
    }, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          const fc = json.data?.user_data?.fans_club?.data;
          resolve({
            status: fc?.user_fans_club_status || 0,
            level: fc?.level || 0,
            clubName: fc?.club_name || '',
          });
        } catch (e) {
          resolve({ status: -1, level: 0, clubName: '' });
        }
      });
    });
    req.on('error', () => resolve({ status: -1, level: 0, clubName: '' }));
    req.on('timeout', () => { req.destroy(); resolve({ status: -1, level: 0, clubName: '' }); });
  });
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function main() {
  console.log(`敌意用户: ${hostileUsers.length} 人, 主播: ${streamers.length} 人`);
  console.log(`总查询: ${hostileUsers.length * streamers.length} 次, 预计 ${Math.ceil(hostileUsers.length * streamers.length * 0.3 / 60)} 分钟`);
  console.log('---\n');

  const found = [];
  let count = 0;
  const total = hostileUsers.length * streamers.length;

  for (const user of hostileUsers) {
    for (const streamer of streamers) {
      count++;
      const result = await query(user.user_sec_uid, streamer.sec_uid);
      
      if (result.status > 0 || result.level > 0) {
        found.push({
          user: user.nickname,
          streamer: streamer.name,
          level: result.level,
          clubName: result.clubName,
          status: result.status,
        });
        console.log(`🔴 ${user.nickname} → ${streamer.name} | 灯牌等级:${result.level} 状态:${result.status} ${result.clubName}`);
      }
      
      if (count % 100 === 0) console.log(`进度: ${count}/${total}`);
      await sleep(150);
    }
  }

  console.log('\n========== 结果 ==========');
  if (found.length === 0) {
    console.log('所有敌意用户均无灯牌');
  } else {
    // 按主播分组
    const byStreamer = {};
    found.forEach(f => {
      if (!byStreamer[f.streamer]) byStreamer[f.streamer] = [];
      byStreamer[f.streamer].push(f);
    });
    for (const [s, users] of Object.entries(byStreamer)) {
      console.log(`\n${s} 的灯牌成员中的喷子:`);
      users.forEach(u => console.log(`  ${u.user} (等级${u.level}, ${u.clubName})`));
    }
  }
  db.close();
}

main().catch(console.error);
