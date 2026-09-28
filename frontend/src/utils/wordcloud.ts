/**
 * 词云绘制 — 纯 canvas 逻辑，无 Vue 依赖
 *
 * 修过的问题：canvas 只有 224px 高、字号 13–37px，40 个词挤在里面，
 * 实测**着色覆盖率仅 18%** —— 视觉上就是"又小又有大片留白，像是被截断了"。
 * 现在：
 *  - 容器给足高度（.dy-cloud-box），并按容器尺寸渲染
 *  - 字号档位拉开（14–44px）并让大词真正占据空间
 *  - 词数上限提到 70，螺旋步长加密，尽量把画布填满
 *  - 放置失败时缩小字号重试（而不是直接丢弃），减少无谓留白
 *
 * @param words 词频数据
 * @param canvasEl 可选 canvas 元素，不传则用 getElementById
 */
export function renderWordCloud(words: any[], canvasEl?: HTMLCanvasElement | null) {
  const canvas = canvasEl || (document.getElementById('wordcloudCanvas') as HTMLCanvasElement)
  if (!canvas || !words.length) return
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  const dpr = window.devicePixelRatio || 1
  const rect = canvas.getBoundingClientRect()
  const W = Math.round(rect.width)
  const H = Math.round(rect.height)
  if (W < 40 || H < 40) return
  canvas.width = W * dpr
  canvas.height = H * dpr
  /*
   * 关键：setTransform 而不是 scale。
   * canvas.width 赋值会重置变换矩阵，但更稳妥的是显式 setTransform，
   * 避免重复渲染时 dpr 被累积乘上（画第二次就变成 2 倍、内容溢出被裁）。
   */
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  ctx.clearRect(0, 0, W, H)

  // 统计词频
  const wordFreq: Record<string, number> = {}
  words.forEach((w: any) => {
    const text = w.content?.trim()
    if (!text || text.length < 2 || text.length > 12) return
    if (!/[\u4e00-\u9fa5a-zA-Z0-9]/.test(text)) return
    const clean = text.replace(/[^\u4e00-\u9fa5a-zA-Z0-9]/g, '')
    if (clean.length >= 2 && clean.length <= 10) wordFreq[clean] = (wordFreq[clean] || 0) + w.cnt
    if (text.length <= 8 && text !== clean) wordFreq[text] = (wordFreq[text] || 0) + w.cnt
  })

  // 去重排序（上限 70：原来 40 个填不满画布）
  const sorted = Object.entries(wordFreq).sort((a, b) => b[1] - a[1])
  const finalWords: [string, number][] = []
  const used = new Set<string>()
  for (const [word, freq] of sorted) {
    if (finalWords.length >= 70) break
    if (used.has(word)) continue
    let skip = false
    for (const u of used) {
      if (u.includes(word) && u.length > word.length) {
        skip = true
        break
      }
    }
    if (skip) continue
    finalWords.push([word, freq])
    used.add(word)
  }

  if (!finalWords.length) {
    ctx.fillStyle = '#888'
    ctx.font = '14px sans-serif'
    ctx.textAlign = 'center'
    ctx.fillText('暂无词频数据', W / 2, H / 2)
    return
  }

  // 螺旋线放置
  const maxFreq = finalWords[0][1]
  const minFreq = finalWords[finalWords.length - 1][1]
  const FONT_MIN = 14
  // 上限跟着画布高度走，避免小画布上出现一个词占满整行
  const FONT_MAX = Math.max(28, Math.min(52, Math.round(H * 0.17)))
  const colors = [
    '#4f6ef7',
    '#8b5cf6',
    '#e8722c',
    '#12a150',
    '#e5484d',
    '#c99a00',
    '#d6409f',
    '#0a8fc4',
    '#9a5cf5',
    '#0d9b74'
  ]
  const placed: { x: number; y: number; w: number; h: number }[] = []
  const cx = W / 2
  const cy = H / 2

  finalWords.forEach(([word, freq], idx) => {
    const ratio = maxFreq > minFreq ? (freq - minFreq) / (maxFreq - minFreq) : 0.5
    let fontSize = FONT_MIN + ratio * (FONT_MAX - FONT_MIN)
    // 放置失败就缩一档重试（最多缩 3 次），别直接丢掉留白
    for (let shrink = 0; shrink <= 3; shrink++) {
      const fs = fontSize * Math.pow(0.82, shrink)
      const padding = 3
      ctx.font = `bold ${fs.toFixed(1)}px "PingFang SC", "Microsoft YaHei", sans-serif`
      const tw = ctx.measureText(word).width + padding * 2
      const th = fs * 1.12 + padding * 2
      let done = false
      /*
       * 螺旋候选点：纵向拉长（椭圆）。
       * 纯圆形螺旋在宽扁容器的左右两侧容易留下大片空白 —— 实测容器从 224px
       * 拉高到 410px 后覆盖率只从 18% 涨到 24%，就是因为候选点没往上下扩展。
       * 这里给 y 方向加权，让螺旋先把上下填满。
       */
      const SPIRAL_Y = 1.55
      for (let t = 0; t < 3200; t++) {
        const angle = t * 0.2
        const radius = t * 0.5
        const x = cx + radius * Math.cos(angle) - tw / 2
        const y = cy + radius * Math.sin(angle) * SPIRAL_Y - th / 2
        if (x < 1 || x + tw > W - 1 || y < 1 || y + th > H - 1) continue
        let coll = false
        for (const p of placed) {
          if (
            x < p.x + p.w + padding &&
            x + tw + padding > p.x &&
            y < p.y + p.h + padding &&
            y + th + padding > p.y
          ) {
            coll = true
            break
          }
        }
        if (coll) continue
        ctx.fillStyle = colors[idx % colors.length]
        ctx.globalAlpha = 0.78 + ratio * 0.22
        ctx.textAlign = 'left'
        ctx.textBaseline = 'alphabetic'
        ctx.fillText(word, x + padding, y + th - fs * 0.32)
        ctx.globalAlpha = 1
        placed.push({ x, y, w: tw, h: th })
        done = true
        break
      }
      if (done) break
      // 已经缩到最小还是放不下，就放弃这个词
      if (fs <= FONT_MIN * 0.6) break
    }
  })
}
