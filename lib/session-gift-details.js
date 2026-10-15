/**
 * 场次礼物明细：聚合与富化（唯一实现）
 *
 * 为什么要有这个文件（2026-10 补）：
 *   场次详情接口 /api/sessions/:id/detail 与按需接口 /api/sessions/:id/gift-details
 *   原本各自算一遍明细。第二次实现时漏了"昵称规整"这一步，导致同一个 sec_uid 的
 *   多行明细带着不同昵称 —— 前端弹窗按昵称筛选，于是整行消失。实测场次 301：
 *     sec_uid ...XOWXwTro 既叫 "dou7906155"（送 闪烁星河 99 钻）又叫 "淩乱ぺ"（送 星光闪耀 18 钻）
 *     → 榜单（按 sec_uid 聚合）把 99 钻算进了总分，点开弹窗却只剩 星光闪耀。
 *   聚合口径只允许有一份，所以抽到这里。
 */

/** 看起来像"自动生成"的昵称：匿名占位或抖音的 dou+数字 */
function isGeneratedName(name) {
  if (!name) return true;
  const n = String(name).trim();
  if (!n) return true;
  if (n.startsWith('神秘人')) return true;
  if (/^dou\d+$/i.test(n)) return true;
  return false;
}

/**
 * 同一用户只保留一个昵称：多行明细必须显示同一个名字，
 * 否则"按昵称筛选"的界面会把同一个人拆成两个。
 *
 * 规则（按优先级）：
 *   1. 排除自动生成的名字（神秘人xxx、dou123456）
 *   2. 剩下的取**出现次数最多**的；并列取更长的（更可能是完整昵称）
 *   3. 若全是自动生成，则退回出现次数最多的那个
 */
function canonicalizeNicknames(rows) {
  const byUser = new Map();
  for (const r of rows) {
    const uid = r.user_sec_uid || r.nickname;
    if (!uid) continue;
    if (!byUser.has(uid)) byUser.set(uid, new Map());
    const names = byUser.get(uid);
    const name = r.nickname || '';
    names.set(name, (names.get(name) || 0) + 1);
  }

  const best = new Map();
  for (const [uid, names] of byUser.entries()) {
    const entries = [...names.entries()].filter(([n]) => n);
    if (!entries.length) continue;
    const real = entries.filter(([n]) => !isGeneratedName(n));
    const pool = real.length ? real : entries;
    pool.sort((a, b) => b[1] - a[1] || b[0].length - a[0].length);
    best.set(uid, pool[0][0]);
  }

  for (const r of rows) {
    const uid = r.user_sec_uid || r.nickname;
    const name = best.get(uid);
    if (name) r.nickname = name;
  }
  return rows;
}

/**
 * 直播中场次：把去重后的礼物行聚合成明细。
 *
 * 分组键 = 用户(sec_uid 优先) + 礼物名 + 收礼人（与历史实现一致），
 * 也就是说"同一人送的不同礼物"是**不同的行** —— 这正是需要 canonicalizeNicknames 的原因。
 */
function aggregateGiftDetails(dedupedGifts, { canonicalize = true } = {}) {
  const map = new Map();
  for (const g of dedupedGifts || []) {
    const uid = g.user_sec_uid || g.nickname;
    const key = uid + '\x00' + (g.gift_name || '') + '\x00' + (g.to_nickname || '');
    let row = map.get(key);
    if (!row) {
      row = {
        nickname: g.nickname,
        user_sec_uid: g.user_sec_uid,
        gift_name: g.gift_name,
        to_nickname: g.to_nickname,
        total_diamonds: 0,
        count: 0,
        avatar_url: g.avatar_url || null,
        gift_icon: g.gift_icon || g.icon || null,
        create_time: g.create_time || 0
      };
      map.set(key, row);
    }
    // 真实昵称/头像优先（匿名行不覆盖已知的真实信息）
    if (g.nickname && !isGeneratedName(g.nickname)) {
      row.nickname = g.nickname;
      if (g.avatar_url) row.avatar_url = g.avatar_url;
    } else if (!row.avatar_url && g.avatar_url) {
      row.avatar_url = g.avatar_url;
    }
    row.total_diamonds += g.total_diamonds || 0;
    row.count += g.repeat_count || 1;
    if ((g.create_time || 0) > row.create_time) row.create_time = g.create_time || 0;
  }
  const rows = [...map.values()];
  // 「最新动态」是时间线，保留当时记录到的原始昵称；排行榜/弹窗才需要统一
  return canonicalize ? canonicalizeNicknames(rows) : rows;
}

/**
 * 已结束场次：把预聚合表 session_gift_details 的行规整成同样的形状。
 * 字段名对齐（表里是 count，接口历史上也是 count，别改名 —— 前端读的是 count）。
 */
function normalizeStoredDetails(rows, { canonicalize = true } = {}) {
  const normalized = (rows || []).map((r) => ({
    nickname: r.nickname,
    user_sec_uid: r.user_sec_uid,
    gift_name: r.gift_name,
    to_nickname: r.to_nickname,
    total_diamonds: r.total_diamonds || 0,
    count: r.count || 0,
    avatar_url: r.avatar_url || null,
    gift_icon: r.gift_icon || null,
    create_time: r.create_time || 0
  }));
  return canonicalize ? canonicalizeNicknames(normalized) : normalized;
}

/**
 * 富化：补头像与礼物图标（两层兜底，与历史实现一致）
 *   - 头像：明细自带 → 本场次同昵称的头像
 *   - 图标：本场次礼物行的 icon → 全库礼物名查表（gift_icons）
 */
function enrichGiftDetails(dbInstance, sid, rows, { giftIconOf, getAvatarBySecUid }) {
  // 头像
  try {
    const avRows = dbInstance
      .prepare('SELECT DISTINCT nickname, avatar FROM gifts WHERE session_id = ? AND avatar IS NOT NULL')
      .all(sid);
    const avatarMap = {};
    for (const r of avRows) if (!avatarMap[r.nickname]) avatarMap[r.nickname] = r.avatar;
    for (const d of rows) {
      if (!d.avatar_url) d.avatar_url = avatarMap[d.nickname] || null;
      if (!d.avatar_url && d.user_sec_uid && typeof getAvatarBySecUid === 'function') {
        d.avatar_url = getAvatarBySecUid(d.user_sec_uid) || null;
      }
    }
  } catch {
    /* 头像缺失不影响主流程 */
  }

  // 图标
  try {
    const iconRows = dbInstance
      .prepare("SELECT DISTINCT gift_name, icon FROM gifts WHERE session_id = ? AND icon IS NOT NULL AND icon != ''")
      .all(sid);
    const iconMap = {};
    for (const r of iconRows) if (!iconMap[r.gift_name]) iconMap[r.gift_name] = r.icon;

    const missing = [...new Set(rows.filter((d) => !d.gift_icon && !iconMap[d.gift_name]).map((d) => d.gift_name))];
    const globalMap = {};
    for (const name of missing) {
      let url = null;
      if (typeof giftIconOf === 'function') url = giftIconOf(name);
      if (!url) {
        const gi = dbInstance.prepare('SELECT icon_url FROM gift_icons WHERE name = ?').get(name);
        if (gi) url = gi.icon_url;
      }
      if (url) globalMap[name] = url;
    }
    let filled = 0;
    for (const d of rows) {
      if (!d.gift_icon) {
        d.gift_icon = iconMap[d.gift_name] || globalMap[d.gift_name] || null;
        if (d.gift_icon) filled++;
      }
    }
    if (filled) console.log(`[gift-details] 场次 ${sid} 补回 ${filled} 条礼物图标`);
  } catch {
    /* 图标缺失不影响主流程 */
  }

  return rows;
}

module.exports = {
  isGeneratedName,
  canonicalizeNicknames,
  aggregateGiftDetails,
  normalizeStoredDetails,
  enrichGiftDetails
};
