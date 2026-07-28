/**
 * 礼物连击去重工具函数
 * 按 (uid, gift_name, 收礼人) 三分组，识别连续连击序列，取每序列最高 combo_count 的帧
 */

/**
 * 连击去重：同一用户对同一收礼人送同一礼物的连续连击帧只保留最高 count 的一条
 * @param {Array} gifts 礼物列表
 * @returns {Array} 去重后的礼物列表
 */
function comboDedupGifts(gifts) {
  const rawGroups = {};
  for (const g of gifts) {
    const uid = g.user_display_id || g.nickname;
    const toKey = g.to_user_sec_uid || g.to_user_display_id || g.to_nickname || '';
    const key = uid + '\x00' + (g.gift_name || '') + '\x00' + toKey;
    if (!rawGroups[key]) rawGroups[key] = [];
    rawGroups[key].push(g);
  }
  const deduped = [];
  for (const [, items] of Object.entries(rawGroups)) {
    if (items.length === 1) { deduped.push(items[0]); continue; }
    items.sort((a, b) => (a.id || 0) - (b.id || 0));

    let seq = [items[0]];
    const sequences = [];
    for (let i = 1; i < items.length; i++) {
      const prev = seq[seq.length - 1];
      const curr = items[i];
      const pc = parseInt(String(prev.combo_count || 1), 10);
      const cc = parseInt(String(curr.combo_count || 1), 10);
      // 连击递增时加入序列。同值+repeat_end加入（连击终结帧）。
      // cc小于pc但>1时也加入（帧序错乱，如combo 4在3之前到）
      if (cc > pc || (cc === pc && curr.repeat_end === 1) || (cc < pc && cc > 1)) {
        seq.push(curr);
      } else {
        sequences.push(seq);
        seq = [curr];
      }
    }
    sequences.push(seq);

    for (const s of sequences) {
      if (s.length === 1) {
        deduped.push(s[0]);
      } else {
        // 序列内帧序可能错乱（如combo 4在3之前到），按combo_count排序取最高
        s.sort((a, b) => {
          const ac = parseInt(String(a.combo_count || 1), 10);
          const bc = parseInt(String(b.combo_count || 1), 10);
          if (bc !== ac) return bc - ac;
          return (b.repeat_end === 1 ? 1 : 0) - (a.repeat_end === 1 ? 1 : 0);
        });
        deduped.push(s[0]);
      }
    }
  }
  return deduped;
}

module.exports = { comboDedupGifts };
