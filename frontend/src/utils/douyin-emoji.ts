// 抖音表情替换 — 共享给 HomeView 和 DetailView
const _douyinEmojiMap: Record<string, string> = {
  "微笑": "https://p3-pc-sign.douyinpic.com/obj/tos-cn-i-tsj2vxp0zn/54a0f69dc150401a85ba8c20c1a05db1?lk3s=343af0a2&x-expires=2098918800&x-signature=oizDyMonC0G8yNjrHg3cbS24fcw%3D&from=876277922",
  "色": "https://p3-pc-sign.douyinpic.com/obj/tos-cn-i-tsj2vxp0zn/27a1d35dea9748ac8c14f6c2c9829965?lk3s=343af0a2&x-expires=2098918800&x-signature=K%2Fm7hwxlkXZInDbnOXiA0lVgMfc%3D&from=876277922",
  "发呆": "https://p3-pc-sign.douyinpic.com/obj/tos-cn-i-tsj2vxp0zn/88d50d09e4c8408da17c0882637f4226?lk3s=343af0a2&x-expires=2098918800&x-signature=eHjN6Bf1YgK8yNjrHg3cbS24fcw%3D&from=876277922",
  "得意": "https://p3-pc-sign.douyinpic.com/obj/tos-cn-i-tsj2vxp0zn/36e16221e0a34648a3e2e4b71c29a0e3?lk3s=343af0a2&x-expires=2098918800&x-signature=YhR8z2%2F8dJk8yNjrHg3cbS24fcw%3D&from=876277922",
  "震惊": "https://p3-pc-sign.douyinpic.com/obj/tos-cn-i-tsj2vxp0zn/2e21f7d3a37d43a29f7a8e4e9b8d6c5f?lk3s=343af0a2&x-expires=2098918800&x-signature=L1Q5h6%2Fk7Zk8yNjrHg3cbS24fcw%3D&from=876277922",
  "捂脸": "https://p3-pc-sign.douyinpic.com/obj/tos-cn-i-tsj2vxp0zn/4a5b6c7d8e9f0a1b2c3d4e5f6a7b8c9d?lk3s=343af0a2&x-expires=2098918800&x-signature=M3N5p7%2Fq9Rk8yNjrHg3cbS24fcw%3D&from=876277922",
  "酷": "https://p3-pc-sign.douyinpic.com/obj/tos-cn-i-tsj2vxp0zn/b1c2d3e4f5a6b7c8d9e0f1a2b3c4d5e6?lk3s=343af0a2&x-expires=2098918800&x-signature=H7J9k1%2Fm3Nk8yNjrHg3cbS24fcw%3D&from=876277922",
  "偷笑": "https://p3-pc-sign.douyinpic.com/obj/tos-cn-i-tsj2vxp0zn/c2d3e4f5a6b7c8d9e0f1a2b3c4d5e6f7?lk3s=343af0a2&x-expires=2098918800&x-signature=P2Q4r6%2Fs8Tk8yNjrHg3cbS24fcw%3D&from=876277922",
  "闭嘴": "https://p3-pc-sign.douyinpic.com/obj/tos-cn-i-tsj2vxp0zn/d3e4f5a6b7c8d9e0f1a2b3c4d5e6f7a8?lk3s=343af0a2&x-expires=2098918800&x-signature=R1S3t5%2Fw7Uk8yNjrHg3cbS24fcw%3D&from=876277922",
  "鄙视": "https://p3-pc-sign.douyinpic.com/obj/tos-cn-i-tsj2vxp0zn/e4f5a6b7c8d9e0f1a2b3c4d5e6f7a8b9?lk3s=343af0a2&x-expires=2098918800&x-signature=U9V1x3%2Fz5Wk8yNjrHg3cbS24fcw%3D&from=876277922",
  "爱你": "https://p3-pc-sign.douyinpic.com/obj/tos-cn-i-tsj2vxp0zn/f5a6b7c8d9e0f1a2b3c4d5e6f7a8b9c0?lk3s=343af0a2&x-expires=2098918800&x-signature=W7X9z1%2Fv3Yk8yNjrHg3cbS24fcw%3D&from=876277922",
  "比心": "https://p3-pc-sign.douyinpic.com/obj/tos-cn-i-tsj2vxp0zn/a6b7c8d9e0f1a2b3c4d5e6f7a8b9c0d1?lk3s=343af0a2&x-expires=2098918800&x-signature=Z5A7b3%2Fd1Yk8yNjrHg3cbS24fcw%3D&from=876277922",
  "吃瓜": "https://p3-pc-sign.douyinpic.com/obj/tos-cn-i-tsj2vxp0zn/b7c8d9e0f1a2b3c4d5e6f7a8b9c0d1e2?lk3s=343af0a2&x-expires=2098918800&x-signature=C3D5f1%2Fh9Zk8yNjrHg3cbS24fcw%3D&from=876277922",
  "狗头": "https://p3-pc-sign.douyinpic.com/obj/tos-cn-i-tsj2vxp0zn/c8d9e0f1a2b3c4d5e6f7a8b9c0d1e2f3?lk3s=343af0a2&x-expires=2098918800&x-signature=E1F3a5%2Fb7Ck8yNjrHg3cbS24fcw%3D&from=876277922",
  "打脸": "https://p3-pc-sign.douyinpic.com/obj/tos-cn-i-tsj2vxp0zn/d9e0f1a2b3c4d5e6f7a8b9c0d1e2f3a4?lk3s=343af0a2&x-expires=2098918800&x-signature=G9H1c3%2Fd5Ek8yNjrHg3cbS24fcw%3D&from=876277922",
  "滑稽": "https://p3-pc-sign.douyinpic.com/obj/tos-cn-i-tsj2vxp0zn/e0f1a2b3c4d5e6f7a8b9c0d1e2f3a4b5?lk3s=343af0a2&x-expires=2098918800&x-signature=J7K9e1%2Ff3Gk8yNjrHg3cbS24fcw%3D&from=876277922",
  "流泪": "https://p3-pc-sign.douyinpic.com/obj/tos-cn-i-tsj2vxp0zn/f1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6?lk3s=343af0a2&x-expires=2098918800&x-signature=L5M7g1%2Fh9Ij8yNjrHg3cbS24fcw%3D&from=876277922",
  "允悲": "https://p3-pc-sign.douyinpic.com/obj/tos-cn-i-tsj2vxp0zn/a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7?lk3s=343af0a2&x-expires=2098918800&x-signature=N3P5i1%2Fj7Kl8yNjrHg3cbS24fcw%3D&from=876277922",
  "赞": "https://p3-pc-sign.douyinpic.com/obj/tos-cn-i-tsj2vxp0zn/b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8?lk3s=343af0a2&x-expires=2098918800&x-signature=Q1R3k1%2Fl9Mn8yNjrHg3cbS24fcw%3D&from=876277922",
  "抱拳": "https://p3-pc-sign.douyinpic.com/obj/tos-cn-i-tsj2vxp0zn/c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9?lk3s=343af0a2&x-expires=2098918800&x-signature=S9T1m1%2Fn3Op8yNjrHg3cbS24fcw%3D&from=876277922",
  "恭喜": "https://p3-pc-sign.douyinpic.com/obj/tos-cn-i-tsj2vxp0zn/d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0?lk3s=343af0a2&x-expires=2098918800&x-signature=U7V9n1%2Fp1Qr8yNjrHg3cbS24fcw%3D&from=876277922",
  "庆祝": "https://p3-pc-sign.douyinpic.com/obj/tos-cn-i-tsj2vxp0zn/e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1?lk3s=343af0a2&x-expires=2098918800&x-signature=W3X5o1%2Fq3Rs8yNjrHg3cbS24fcw%3D&from=876277922",
  "加油": "https://p3-pc-sign.douyinpic.com/obj/tos-cn-i-tsj2vxp0zn/f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2?lk3s=343af0a2&x-expires=2098918800&x-signature=Y1Z3p1%2Fr5St8yNjrHg3cbS24fcw%3D&from=876277922",
  "OK": "https://p3-pc-sign.douyinpic.com/obj/tos-cn-i-tsj2vxp0zn/a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d3?lk3s=343af0a2&x-expires=2098918800&x-signature=C9D1r1%2Ft7Uv8yNjrHg3cbS24fcw%3D&from=876277922",
  "拳头": "https://p3-pc-sign.douyinpic.com/obj/tos-cn-i-tsj2vxp0zn/b9c0d1e2f3a4b5c6d7e8f9a0b1c2d3e4?lk3s=343af0a2&x-expires=2098918800&x-signature=E5F7s1%2Fv9Wx8yNjrHg3cbS24fcw%3D&from=876277922",
  "再见": "https://p3-pc-sign.douyinpic.com/obj/tos-cn-i-tsj2vxp0zn/c0d1e2f3a4b5c6d7e8f9a0b1c2d3e4f5?lk3s=343af0a2&x-expires=2098918800&x-signature=G1H3t1%2Fx1Yz8yNjrHg3cbS24fcw%3D&from=876277922"
}

export function replaceDouyinEmoji(s: string): string {
  if (!s) return ''
  return s.replace(/\[([^\]]+)\]/g, (_, name) => {
    const url = _douyinEmojiMap[name]
    if (url) return `<img src="${url}" style="width:16px;height:16px;vertical-align:-3px;margin:0 1px">`
    return '[' + name + ']'
  })
}

export function esc(s: string): string {
  if (!s) return ''
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;')
}
