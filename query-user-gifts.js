#!/usr/bin/env node
/**
 * 查询用户礼物记录（带 comboDedupGifts 去重）
 *
 * 用法：
 *   node query-user-gifts.js <昵称关键词>
 *
 * 示例：
 *   node query-user-gifts.js suisui
 *   node query-user-gifts.js 萱萱
 *   node query-user-gifts.js 神秘人
 */
const db = require('./db-sqlite.js');
const { comboDedupGifts } = require('./lib/gift-utils.js');

async function main() {
  const keyword = process.argv[2];
  if (!keyword) {
    console.error('用法: node query-user-gifts.js <昵称关键词>');
    process.exit(1);
  }

  const pool = db.getPool();
  try {
    const [gifts] = await pool.query(
      'SELECT id, nickname, gift_name, diamond_count, repeat_count, total_diamonds, ' +
      'combo_count, repeat_end, send_type, create_time, user_display_id, user_sec_uid, ' +
      'to_nickname, to_user_display_id, to_user_sec_uid FROM gifts WHERE nickname LIKE ? ORDER BY id',
      [`%${keyword}%`]
    );

    if (gifts.length === 0) {
      console.log(`未找到昵称包含"${keyword}"的用户`);
      return;
    }

    const deduped = comboDedupGifts(gifts);
    deduped.sort((a, b) => b.create_time - a.create_time);

    console.log(`昵称: ${gifts[0].nickname}`);
    console.log(`原始记录: ${gifts.length} 条 → 去重后: ${deduped.length} 条\n`);

    let total = 0;
    for (const g of deduped) {
      const time = new Date(g.create_time).toLocaleString('zh-CN', {timeZone: 'Asia/Shanghai'});
      total += g.total_diamonds;
      const toStr = g.to_nickname ? ' → ' + g.to_nickname : '';
      const detail = g.repeat_count > 1 ? ` ×${g.repeat_count} = 💎${g.total_diamonds}` : ` = 💎${g.total_diamonds}`;
      console.log(`${time}  ${g.gift_name}${detail}${toStr}`);
    }
    console.log(`\n💎 总计: ${total} 钻石 (≈ ¥${Math.round(total / 10)})`);
  } finally {
    // SQLite: no need to close pool
  }
}

main().catch(e => console.error('Error:', e.message));
