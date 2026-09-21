#!/usr/bin/env node
/**
 * 修正某个礼物的单价，并重算受影响场次的聚合数据（agg_* + 预聚合表）
 *
 * 用法:
 *   node scripts/fix-gift-price.js "<礼物名>" <新单价>          # 执行
 *   node scripts/fix-gift-price.js "<礼物名>" <新单价> --dry-run # 只预览
 *
 * 说明:
 *   - gifts.diamond_count 改为新单价
 *   - gifts.total_diamonds（连击是累计值）按比例换算：newTotal = oldTotal / oldUnit * newUnit
 *     （oldUnit=0 时退化为 newUnit * repeat_count）
 *   - 受影响场次重算 sessions.agg_gifts/agg_diamonds/agg_danmaku/agg_users
 *     并重建 session_gift_ranking / session_anchor_ranking /
 *     session_danmaku_ranking / session_gift_details / session_timeline
 *   - 不改动采集进程，但 monitor.js 的 GIFT_PRICE_MAP 也要同步改，否则新数据仍是旧价
 */
const path = require('path');
const dbMod = require(path.join(__dirname, '..', 'db-sqlite.js'));
const { comboDedupGifts } = require(path.join(__dirname, '..', 'lib', 'gift-utils.js'));

const [giftName, newPriceArg] = process.argv.slice(2);
const dryRun = process.argv.includes('--dry-run');
const newPrice = Number(newPriceArg);

if (!giftName || !Number.isFinite(newPrice) || newPrice <= 0) {
  console.error('用法: node scripts/fix-gift-price.js "<礼物名>" <新单价> [--dry-run]');
  process.exit(1);
}

(async () => {
  const d = dbMod.getDb();
  const rows = d.prepare('SELECT * FROM gifts WHERE gift_name = ? ORDER BY id').all(giftName);
  if (!rows.length) { console.error(`未找到礼物: ${giftName}`); process.exit(1); }

  const sessions = [...new Set(rows.map(r => r.session_id))];
  const units = [...new Set(rows.map(r => Number(r.diamond_count || 0)))];
  const rawBefore = rows.reduce((a, r) => a + Number(r.total_diamonds || 0), 0);
  console.log(`礼物「${giftName}」: ${rows.length} 行, 涉及 ${sessions.length} 个场次 [${sessions.join(', ')}]`);
  console.log(`  旧单价: ${units.join(', ')} → 新单价: ${newPrice}`);
  console.log(`  原始累计钻石: ${rawBefore}`);

  const before = {};
  for (const sid of sessions) {
    const g = d.prepare('SELECT agg_gifts, agg_diamonds, agg_users, agg_danmaku FROM sessions WHERE id = ?').get(sid);
    before[sid] = g || {};
  }

  if (dryRun) {
    console.log('[dry-run] 未写入。受影响场次当前聚合:');
    for (const sid of sessions) console.log(' ', sid, JSON.stringify(before[sid]));
    return;
  }

  const upd = d.prepare('UPDATE gifts SET diamond_count = ?, total_diamonds = ? WHERE id = ?');
  const apply = d.transaction(() => {
    for (const r of rows) {
      const oldUnit = Number(r.diamond_count || 0);
      const oldTotal = Number(r.total_diamonds || 0);
      const rep = Number(r.repeat_count || 1) || 1;
      const newTotal = oldUnit > 0 ? Math.round(oldTotal / oldUnit * newPrice) : newPrice * rep;
      upd.run(newPrice, newTotal, r.id);
    }
  });
  apply();
  console.log(`已更新 ${rows.length} 行 gifts`);

  // 重算受影响场次聚合（与 endSession 口径一致）
  for (const sid of sessions) {
    const rawGifts = d.prepare('SELECT * FROM gifts WHERE session_id = ? ORDER BY id').all(sid);
    const deduped = comboDedupGifts(rawGifts);
    const agg_gifts = deduped.reduce((s, g) => s + (g.repeat_count || 1), 0);
    const agg_diamonds = deduped.reduce((s, g) => s + (g.total_diamonds || 0), 0);
    const dmRow = d.prepare('SELECT COUNT(*) as cnt FROM danmaku WHERE session_id = ?').get(sid);
    const giftUsers = deduped.map(g => g.user_sec_uid).filter(Boolean);
    const danmakuUsers = d.prepare('SELECT DISTINCT user_sec_uid FROM danmaku WHERE session_id = ? AND user_sec_uid IS NOT NULL').all(sid).map(r => r.user_sec_uid);
    const agg_users = new Set([...giftUsers, ...danmakuUsers]).size;
    d.prepare('UPDATE sessions SET agg_gifts=?, agg_diamonds=?, agg_danmaku=?, agg_users=? WHERE id=?')
      .run(agg_gifts, agg_diamonds, dmRow.cnt, agg_users, sid);
    await dbMod.buildPrecomputed(d, sid, deduped);
    const after = d.prepare('SELECT agg_gifts, agg_diamonds, agg_users, agg_danmaku FROM sessions WHERE id = ?').get(sid);
    console.log(`场次 ${sid}: agg_diamonds ${before[sid].agg_diamonds} → ${after.agg_diamonds} (Δ ${after.agg_diamonds - before[sid].agg_diamonds}), agg_gifts ${before[sid].agg_gifts} → ${after.agg_gifts}`);
  }
  console.log('完成。');
})().catch(e => { console.error('失败:', e.message); process.exit(1); });
