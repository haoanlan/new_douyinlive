/**
 * 共享工具函数 — 提取自 HomeView / DetailView / SessionsView
 * 纯函数，无副作用，不影响 UI
 *
 * 已删除本文件里的 `esc()`：它与 utils/douyin-emoji.ts 的同名函数重复，
 * 实际被调用的只有后者（detail 页从 douyin-emoji 导入），本文件那个 0 调用者。
 */

/**
 * 到分钟：YYYY/MM/DD HH:mm（年/月/日 时:分）
 *
 * 解析统一走下面的 toDate()（原来这里自己写了一套判断，正则只认 `/^\d+$/`，
 * 于是库里的 `"1781342931.0"`（带小数的时间戳字符串）走 `new Date(...)` → Invalid Date，
 * 房间列表显示成"最近 Invalid Date" —— 移动端巡检截图里抓到的）。
 * 解析不出来时返回兜底值（默认 '-'），**绝不把 "Invalid Date" 端给用户**。
 */
export function fmtTime(ts: any, fallback = '-'): string {
  const d = toDate(ts)
  if (!d) return fallback
  return d.toLocaleString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  })
}

/**
 * 只到「日」：YYYY/MM/DD
 *
 * **粒度是设计选择，不是不一致**（用户明确指出）：有些地方只需要知道哪一天
 * （如"首次出现"、场次日期、趋势图横轴），有些地方需要精确到分钟
 * （如"首次活跃/最近活跃"、场次开始时间）。统一的是**写法与实现**，不是粒度。
 *
 * 空值/非法值的兜底文案可传：搜索页用 '—'，场次列表用 ''（保持各自的界面观感不变）。
 * 原本有两份实现（search 的 fmtDay 与这里的 fmtSessionTime），空值行为已经不一致
 * （'—' vs ''），合并成这一处，以后修解析逻辑只改这里。
 */
export function fmtDate(t: any, fallback = '—'): string {
  if (!t) return fallback
  let date: Date
  if (/^(\d+(\.\d+)?)$/.test(String(t).trim())) {
    // 秒/毫秒都能吃：13 位以上按毫秒
    const ts = parseFloat(String(t))
    date = new Date(ts > 1e12 ? ts : ts * 1000)
  } else {
    date = new Date(t)
  }
  if (isNaN(date.getTime())) return String(t).slice(0, 10)
  const mm = String(date.getMonth() + 1).padStart(2, '0')
  const dd = String(date.getDate()).padStart(2, '0')
  return `${date.getFullYear()}/${mm}/${dd}`
}

/**
 * 只到「日」的旧名字（场次列表/筛选器在用）。
 * 保留这个名字不动调用点，内部委托给 fmtDate —— 空值仍返回 ''（与原来一致）。
 */
export function fmtSessionTime(t: any): string {
  return fmtDate(t, '')
}

/** 格式化时长 (分钟 → Xh Xm) */
export function formatDuration(min: number): string {
  if (min < 60) return min + '分钟'
  const h = Math.floor(min / 60),
    m = min % 60
  return m > 0 ? `${h}h ${m}m` : `${h}h`
}

/**
 * 格式化数字（万/亿，保留两位小数）—— **全站唯一的数字显示口径**
 *
 * 为什么要有"唯一口径"（DESIGN-REVIEW P1-7）：
 * 原来同一页里混用三套写法 —— fmtNum()（1.23万）、toLocaleString()（12,345）、
 * 以及裸整数。结果 dashboard 的汇总卡写"27.73万"，同一页的榜单却写"37,965"，
 * 读的人得在心里做一次换算，非常别扭。
 *
 * 约定：
 *   - 展示一律用 fmtNum（大数缩写，扫读快）
 *   - 需要精确值时用 fmtFull（千分位），并配 fmtTitle 作为悬浮提示
 *
 * 注意 1.23万 这种缩写会丢掉差异：1.23万 与 1.24万 看着几乎一样。
 * 所以凡是"数值本身是结论"的地方（排行、明细），请用 fmtFull 或加 title。
 */
export function fmtNum(n: number | null | undefined): string {
  if (n === null || n === undefined || Number.isNaN(Number(n))) return '0'
  const v = Number(n)
  if (!v) return '0'
  if (v >= 1e8) return (v / 1e8).toFixed(2) + '亿'
  if (v >= 10000) return (v / 10000).toFixed(2) + '万'
  return v.toLocaleString('zh-CN')
}

/**
 * 精确数值（千分位，不做万/亿缩写）。
 * 用于：排行榜数值、明细行、以及任何"差一点都能看出来"的地方。
 */
export function fmtFull(n: number | null | undefined): string {
  if (n === null || n === undefined || Number.isNaN(Number(n))) return '0'
  return Number(n).toLocaleString('zh-CN')
}

/**
 * 悬浮提示用的完整数值（配合 :title）。
 * 缩写展示 + title 显示原值，既保持扫读效率又不丢精度。
 */
export function fmtTitle(n: number | null | undefined): string {
  return fmtFull(n)
}

/**
 * 排名徽章样式（前三名高亮）
 *
 * 底与字必须**成对**给定：原来返回 `bg-amber-100 text-amber-600` 这类 Tailwind 固定调色板，
 * 而 `.douyin-page` 的语义色收口会把 `text-amber-*` / `text-orange-*` 改成"给深色底用的亮色"，
 * 于是暗色下浅色底徽章实测只有 1.5:1 / 3.14:1（需 4.5）。现在交给 `.dy-rank--*`
 * 在样式层配对（浅色/暗色各一套，见 custom/douyin-motion.scss）。
 */
export function rankClass(i: number): string {
  if (i === 0) return 'dy-rank dy-rank--1'
  if (i === 1) return 'dy-rank dy-rank--2'
  if (i === 2) return 'dy-rank dy-rank--3'
  return 'bg-g-100 text-g-500'
}

/**
 * 毫秒/秒/字符串时间 → Date
 * 后端 create_time 是毫秒时间戳，session start_time 是 "YYYY-MM-DD HH:mm:ss"
 */
export function toDate(t: any): Date | null {
  if (t === null || t === undefined || t === '') return null
  if (typeof t === 'number' || /^\d+(\.\d+)?$/.test(String(t).trim())) {
    const n = Number(t)
    if (!n) return null
    return new Date(n > 1e12 ? n : n * 1000)
  }
  const d = new Date(t)
  return isNaN(d.getTime()) ? null : d
}

/** 相对时间（刚刚 / N 分钟前 / N 小时前 / N 天前 / 日期） */
export function fmtAgo(t: any): string {
  const d = toDate(t)
  if (!d) return '-'
  const diff = Date.now() - d.getTime()
  if (diff < 0) return fmtTime(t)
  const min = Math.floor(diff / 60000)
  if (min < 1) return '刚刚'
  if (min < 60) return `${min} 分钟前`
  const hour = Math.floor(min / 60)
  if (hour < 24) return `${hour} 小时前`
  const day = Math.floor(hour / 24)
  if (day < 30) return `${day} 天前`
  return fmtTime(t)
}

/** 只取时间戳的时分秒 (HH:mm:ss) */
export function fmtClock(t: any): string {
  const d = toDate(t)
  if (!d) return '-'
  return d.toLocaleTimeString('zh-CN', { hour12: false })
}

/**
 * 只取时分 (HH:mm)。
 * 用于场次的"结束时间"这类展示：同一天内只需要时分，
 * `fmtClock` 带秒（23:41:07）在列表里太啰嗦。
 */
export function fmtHm(t: any): string {
  const d = toDate(t)
  if (!d) return '-'
  const p = (x: number) => String(x).padStart(2, '0')
  return `${p(d.getHours())}:${p(d.getMinutes())}`
}

/**
 * 场次时间范围："2026/10/07 22:08 → 23:41"
 *
 * 同一天只给结束的时分；**跨天必须带上日期** —— 否则实测会出现
 * 「2026/09/16 16:57 → 15:12」这种"结束比开始还早"的读法（那天实际是 09/22 结束的）。
 *
 * short = true：省掉年份（"08/02 13:00 → 08/03 02:59"）。
 * 窄屏用它 —— 完整写法在 390px 上要换行，把场次详情头部撑成两行高，
 * 导致"加载完成后按钮位置往下跳"（用户反馈）；紧凑写法一行放得下，头部高度恒定。
 */
export function fmtSessionRange(start: any, end: any, short = false): string {
  if (!start) return '-'
  const head = short ? fmtShortDateTime(start) : fmtTime(start)
  if (!end) return head
  const s = toDate(start)
  const e = toDate(end)
  if (!s || !e) return `${head} → ${short ? fmtShortDateTime(end) : fmtTime(end)}`
  const sameDay =
    s.getFullYear() === e.getFullYear() && s.getMonth() === e.getMonth() && s.getDate() === e.getDate()
  if (sameDay) return `${head} → ${fmtHm(end)}`
  return `${head} → ${short ? fmtShortDateTime(end) : fmtTime(end)}`
}

/** 只到分钟但省略年份："08/02 13:00"（窄屏用，见 fmtSessionRange 的 short 参数） */
export function fmtShortDateTime(t: any): string {
  const d = toDate(t)
  if (!d) return fmtTime(t)
  const p = (x: number) => String(x).padStart(2, '0')
  return `${p(d.getMonth() + 1)}/${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

/** 转义属性值（用于 HTML 属性内部） */
function escAttr(s: string | null | undefined): string {
  if (!s) return ''
  return s
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

/** 生成头像 HTML（用于 v-html） */
export function avatarHtml(url: string, name: string, size?: number): string {
  const s = size ? `width:${size}px;height:${size}px` : ''
  const safeName = escAttr(name?.[0] || '?')
  if (url) {
    const safeUrl = escAttr(url)
    return `<div class="avatar" style="${s}"><img src="${safeUrl}" alt="" loading="eager" style="opacity:0;transition:opacity 0.2s" onload="this.style.opacity=1" onerror="this.style.opacity=0;this.parentElement.textContent='${safeName}'"></div>`
  }
  return `<div class="avatar" style="${s};display:flex;align-items:center;justify-content:center;font-size:13px;color:var(--text-muted)">${safeName}</div>`
}

/** 52px 头像 */
export function avatarHtml52(url: string, name: string): string {
  return avatarHtml(url, name, 52)
}

/** 礼物 emoji 映射 */
export function giftEmoji(name: string): string {
  if (!name) return '🎁'
  if (name.includes('火箭') || name.includes('🚀')) return '🚀'
  if (name.includes('跑车') || name.includes('🚗')) return '🚗'
  if (name.includes('嘉年华')) return '🎪'
  if (name.includes('玫瑰')) return '🌹'
  if (name.includes('棒棒糖')) return '🍭'
  if (name.includes('啤酒')) return '🍺'
  if (name.includes('比心')) return '❤️'
  return '🎁'
}
