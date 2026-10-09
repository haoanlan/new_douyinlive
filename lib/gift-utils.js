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

/**
 * 礼物名 → 图标 URL 的查表函数（带缓存，10 分钟过期）。
 *
 * 为什么要全表扫而不是从"当前用户那几条礼物"里取：
 * 图标写在每条礼物行自带的 icon 字段里，**同一个礼物名有一部分行的 icon 是空的**
 * （实测「钻石跑车」206/288 行有值、「玫瑰星瀚」443/552、「定制跑车」54/154）。
 * 只看当前用户去重后的那几条，恰好挑中空行就永远显示不出图标 ——
 * 用户反馈的「钻石跑车在馈赠明细里没有图标」就是这么来的
 * （而且 gift_icons 名称表里根本没有「钻石跑车」这个名字，兜底也兜不住）。
 *
 * 全表 GROUP BY 实测约 1s、675 个名字，所以缓存住；期间新礼物类型出现时
 * 最多 10 分钟内显示占位图标，过期后自动重建。
 *
 * @param {object} db better-sqlite3 实例
 * @param {number} ttlMs 缓存有效期
 * @returns {(name: string) => (string|null)} 传礼物名，返回图标 URL 或 null
 */
function getGiftIconLookup(db, ttlMs = 10 * 60 * 1000) {
  let map = null;
  let builtAt = 0;
  return function lookupIcon(name) {
    if (!name) return null;
    const now = Date.now();
    if (!map || now - builtAt > ttlMs) {
      const next = new Map();
      try {
        const rows = db
          .prepare(
            "SELECT gift_name, MAX(icon) AS icon FROM gifts WHERE icon IS NOT NULL AND icon != '' GROUP BY gift_name"
          )
          .all();
        for (const r of rows) if (r.gift_name && r.icon) next.set(r.gift_name, r.icon);
      } catch (e) {
        // 表结构异常时不让接口挂掉，退化成"没有图标"（前端会显示通用礼物图标）
      }
      map = next;
      builtAt = now;
    }
    return map.get(name) || null;
  };
}

module.exports = { comboDedupGifts, getGiftIconLookup };
