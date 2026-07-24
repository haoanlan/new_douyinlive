/**
 * 共享工具函数 — 提取自 HomeView / DetailView / SessionsView
 * 纯函数，无副作用，不影响 UI
 */

/** HTML 转义 */
export function esc(s: string | null | undefined): string {
  if (!s) return ''
  const d = document.createElement('div')
  d.textContent = s
  return d.innerHTML
}

/** 格式化完整时间 (年/月/日 时:分) */
export function fmtTime(ts: any): string {
  if (!ts) return '-'
  let d: Date
  if (typeof ts === 'number' || (typeof ts === 'string' && /^\d+$/.test(ts.trim()))) {
    const n = Number(ts)
    d = new Date(n > 1e12 ? n : n * 1000)
  } else {
    d = new Date(ts)
  }
  return d.toLocaleString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
}

/** 格式化场次日期 (YYYY/MM/DD) */
export function fmtSessionTime(t: any): string {
  if (!t) return ''
  let date: Date
  if (/^(\d+(\.\d+)?)$/.test(String(t).trim())) {
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

/** 格式化时长 (分钟 → Xh Xm) */
export function formatDuration(min: number): string {
  if (min < 60) return min + '分钟'
  const h = Math.floor(min / 60), m = min % 60
  return m > 0 ? `${h}h ${m}m` : `${h}h`
}

/** 格式化数字 (万) */
export function fmtNum(n: number): string {
  if (!n) return '0'
  if (n >= 10000) return (n / 10000).toFixed(1) + '万'
  return n.toLocaleString()
}

/** 生成头像 HTML（用于 v-html） */
export function avatarHtml(url: string, name: string, size?: number): string {
  const s = size ? `width:${size}px;height:${size}px` : ''
  if (url) return `<div class="avatar" style="${s}"><img src="${url}" alt="" loading="eager" style="opacity:0;transition:opacity 0.2s" onload="this.style.opacity=1" onerror="this.style.opacity=0;this.parentElement.innerHTML='${name?.[0] || '?'}'"></div>`
  return `<div class="avatar" style="${s};display:flex;align-items:center;justify-content:center;font-size:13px;color:var(--text-muted)">${name?.[0] || '?'}</div>`
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
