// 导出指定场次中「萱萱」收到的礼物明细（含连击去重）
const db = require('better-sqlite3')('/opt/data/douyin-monitor/db/douyin.db');
const gu = require('/opt/data/douyin-monitor/lib/gift-utils.js');

const SESSION = Number(process.argv[2] || 252);
const NAME_PAT = process.argv[3] || '%萱%';

const sess = db.prepare('SELECT * FROM sessions WHERE id=?').get(SESSION);
const rows = db.prepare('SELECT * FROM gifts WHERE session_id=? AND to_nickname LIKE ? ORDER BY create_time, id').all(SESSION, NAME_PAT);
const dedup = gu.comboDedupGifts(rows);
const keepIds = new Set(dedup.map(r => r.id));

const fmt = ts => {
  const n = Number(ts);
  const ms = n > 1e12 ? n : n * 1000;
  return new Date(ms + 8 * 3600 * 1000).toISOString().replace('T', ' ').slice(0, 19);
};

const dia = r => Number(r.total_diamonds || 0);

// 逐条
const records = rows.map(r => ({
  时间: fmt(r.create_time),
  ts: Number(r.create_time) > 1e12 ? Number(r.create_time) : Number(r.create_time) * 1000,
  送礼人: r.nickname || '',
  送礼人ID: r.user_display_id || '',
  sec_uid: r.user_sec_uid || '',
  礼物: r.gift_name || '',
  单价: Number(r.diamond_count || 0),
  连击数: Number(r.repeat_count || 0),
  连击帧: Number(r.combo_count || 0),
  累计钻石: dia(r),
  是否终结帧: Number(r.repeat_end || 0) === 1 ? 1 : 0,
  计入统计: keepIds.has(r.id) ? 1 : 0,
}));

// 按送礼人
const byUser = {};
for (const r of dedup) {
  const k = (r.user_sec_uid || r.user_display_id || '') + '|' + (r.nickname || '');
  byUser[k] = byUser[k] || { 送礼人: r.nickname || '', ID: r.user_display_id || '', sec_uid: r.user_sec_uid || '', 去重条数: 0, 钻石: 0, 神秘人次数: 0 };
  byUser[k].去重条数++;
  byUser[k].钻石 += dia(r);
  if (!r.user_sec_uid && !r.user_display_id) byUser[k].神秘人次数++;
}
const rawByUser = {};
for (const r of rows) {
  const k = (r.user_sec_uid || r.user_display_id || '') + '|' + (r.nickname || '');
  rawByUser[k] = (rawByUser[k] || 0) + dia(r);
}
const userList = Object.values(byUser)
  .map(u => ({ 送礼人: u.送礼人, ID: u.ID, sec_uid: u.sec_uid, 去重条数: u.去重条数, 钻石: u.钻石, 原始累计: rawByUser[(u.sec_uid || u.id || '') + '|' + u.送礼人] || 0 }))
  .sort((a, b) => b.钻石 - a.钻石);

// 按礼物
const byGift = {};
for (const r of dedup) {
  const g = r.gift_name || '';
  byGift[g] = byGift[g] || { 礼物: g, 去重条数: 0, 钻石: 0, 单价: Number(r.diamond_count || 0) };
  byGift[g].去重条数++;
  byGift[g].钻石 += dia(r);
}
const giftList = Object.values(byGift).sort((a, b) => b.钻石 - a.钻石);

// 送礼人 × 礼物
const cross = {};
for (const r of dedup) {
  const k = (r.nickname || '') + '||' + (r.gift_name || '');
  cross[k] = cross[k] || { 送礼人: r.nickname || '', 礼物: r.gift_name || '', 去重条数: 0, 钻石: 0 };
  cross[k].去重条数++;
  cross[k].钻石 += dia(r);
}
const crossList = Object.values(cross).sort((a, b) => b.钻石 - a.钻石);

// 时间线：10分钟桶
const bucketMs = 10 * 60 * 1000;
const tl = {};
for (const r of dedup) {
  const ts = Number(r.create_time) > 1e12 ? Number(r.create_time) : Number(r.create_time) * 1000;
  const b = Math.floor(ts / bucketMs) * bucketMs;
  tl[b] = tl[b] || { 时间段: fmt(b), 去重钻石: 0, 条数: 0 };
  tl[b].去重钻石 += dia(r);
  tl[b].条数++;
}
const timeline = Object.entries(tl).map(([k, v]) => ({ ...v, _b: Number(k) })).sort((a, b) => a._b - b._b);

// 漏录排查：全场消息（弹幕+礼物合并）最大间隔
const all = db.prepare('SELECT create_time FROM danmaku WHERE session_id=? UNION ALL SELECT create_time FROM gifts WHERE session_id=? ORDER BY 1').all(SESSION, SESSION)
  .map(r => { const n = Number(r.create_time); return n > 1e12 ? n : n * 1000; });
const gaps = [];
for (let i = 1; i < all.length; i++) {
  const d = all[i] - all[i - 1];
  if (d > 60 * 1000) gaps.push({ 起: fmt(all[i - 1]), 止: fmt(all[i]), 间隔秒: Math.round(d / 1000) });
}
gaps.sort((a, b) => b.间隔秒 - a.间隔秒);

const totalDedup = dedup.reduce((a, r) => a + dia(r), 0);
const totalRaw = rows.reduce((a, r) => a + dia(r), 0);
const nullTo = db.prepare("SELECT COUNT(*) n, SUM(total_diamonds) dia FROM gifts WHERE session_id=? AND (to_nickname IS NULL OR to_nickname='')").get(SESSION);

console.log(JSON.stringify({
  session: sess, namePat: NAME_PAT,
  summary: {
    原始条数: rows.length, 去重条数: dedup.length,
    钻石_去重: totalDedup, 钻石_原始: totalRaw,
    时间起: records.length ? records[0].时间 : null,
    时间止: records.length ? records[records.length - 1].时间 : null,
    无收礼人归属条数: nullTo.n, 无收礼人归属钻石原始: nullTo.dia || 0,
  },
  records, userList, giftList, crossList, timeline, gaps: gaps.slice(0, 20),
}, null, 1));
