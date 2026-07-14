/**
 * 词云绘制 — 纯 canvas 逻辑，无 Vue 依赖
 */
export function renderWordCloud(words: any[]) {
  const canvas = document.getElementById("wordcloudCanvas")
  if (!canvas || !words.length) return
  const ctx = canvas.getContext("2d")
  if (!ctx) return
  const dpr = window.devicePixelRatio || 1
  const rect = canvas.getBoundingClientRect()
  canvas.width = rect.width * dpr
  canvas.height = rect.height * dpr
  ctx.scale(dpr, dpr)
  const W = rect.width, H = rect.height
  ctx.clearRect(0, 0, W, H)

  // 统计词频
  const wordFreq: Record<string, number> = {}
  words.forEach((w: any) => {
    const text = w.content?.trim()
    if (!text || text.length < 2 || text.length > 12) return
    if (!/[\u4e00-\u9fa5a-zA-Z0-9]/.test(text)) return
    const clean = text.replace(/[^\u4e00-\u9fa5a-zA-Z0-9]/g, "")
    if (clean.length >= 2 && clean.length <= 10) wordFreq[clean] = (wordFreq[clean] || 0) + w.cnt
    if (text.length <= 8 && text !== clean) wordFreq[text] = (wordFreq[text] || 0) + w.cnt
  })

  // 去重排序取前40
  const sorted = Object.entries(wordFreq).sort((a, b) => b[1] - a[1])
  const finalWords: [string, number][] = []
  const used = new Set<string>()
  for (const [word, freq] of sorted) {
    if (finalWords.length >= 40) break
    if (used.has(word)) continue
    let skip = false
    for (const u of used) { if (u.includes(word) && u.length > word.length) { skip = true; break } }
    if (skip) continue
    finalWords.push([word, freq])
    used.add(word)
  }

  if (!finalWords.length) {
    ctx.fillStyle = "#888"; ctx.font = "14px sans-serif"; ctx.textAlign = "center"
    ctx.fillText("暂无词频数据", W / 2, H / 2)
    return
  }

  // 螺旋线放置
  const maxFreq = finalWords[0][1], minFreq = finalWords[finalWords.length - 1][1]
  const colors = ["#6c8cff","#a78bfa","#fb923c","#4ade80","#f87171","#facc15","#f472b6","#38bdf8","#c084fc","#34d399"]
  const placed: {x:number,y:number,w:number,h:number}[] = []
  const padding = 4, cx = W / 2, cy = H / 2
  finalWords.forEach(([word, freq], idx) => {
    const ratio = maxFreq > minFreq ? (freq - minFreq) / (maxFreq - minFreq) : 0.5
    const fontSize = 13 + ratio * 24
    ctx.font = "bold " + fontSize + "px PingFang SC, Microsoft YaHei, sans-serif"
    const tw = ctx.measureText(word).width + padding * 2
    const th = fontSize + padding * 2
    for (let t = 0; t < 800; t++) {
      const angle = t * 0.3, radius = t * 0.8
      const x = cx + radius * Math.cos(angle) - tw / 2
      const y = cy + radius * Math.sin(angle) - th / 2
      if (x < -10 || x + tw > W + 10 || y < -10 || y + th > H + 10) continue
      let coll = false
      for (const p of placed) {
        if (x < p.x + p.w + padding && x + tw + padding > p.x && y < p.y + p.h + padding && y + th + padding > p.y) { coll = true; break }
      }
      if (!coll) {
        ctx.fillStyle = colors[idx % colors.length]
        ctx.globalAlpha = 0.55 + ratio * 0.45
        ctx.fillText(word, x + padding, y + th - fontSize * 0.3)
        ctx.globalAlpha = 1
        placed.push({ x, y, w: tw, h: th })
        break
      }
    }
  })
}
