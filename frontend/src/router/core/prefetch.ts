/**
 * 路由分包预取
 *
 * 背景：路由组件是 `import.meta.glob('../../views/**\/*.vue')` 懒加载的 ——
 * 首次进入某个页面时要**先下载该页的 JS 分包**，下载期间只有骨架/空白（实测生产版分包
 * 124KB / 79KB / 72KB / 45KB / 39KB 不等）。用户点菜单时才发现要等，这是"跳转慢"的主要来源。
 *
 * 做法：登录后（应用已挂载）用 requestIdleCallback 在**浏览器空闲时**把常用页面的分包先拉下来。
 * 用户点菜单时直接命中缓存，跳转不再等 chunk。
 *
 * 为什么不用 hover 预取：菜单组件是模板自带的（art-sidebar-menu），
 * 改它要动模板库组件；而本项目实际只有抖音这几个页面，空闲预取覆盖面更全、代码更少。
 * 只在空闲时跑，不抢首屏资源；失败静默（预取失败不影响功能，真正进入页面时还会正常加载）。
 */

const modules = import.meta.glob('../../views/**/*.vue')

/** 与 ComponentLoader 相同的路径解析规则：先 `/x.vue`，再 `/x/index.vue` */
function resolveLoader(componentPath: string): (() => Promise<any>) | null {
  if (!componentPath) return null
  return (
    modules[`../../views${componentPath}.vue`] || modules[`../../views${componentPath}/index.vue`] || null
  )
}

/** 预取单个页面（已缓存时是一次极轻的 no-op） */
export function prefetchPage(componentPath: string): void {
  const loader = resolveLoader(componentPath)
  if (!loader) return
  try {
    void loader().catch(() => {})
  } catch {
    /* 预取失败无所谓，真正跳转时会再走一次正常加载 */
  }
}

/**
 * 空闲时批量预取。
 * @param componentPaths 路由里的 component 值（例如 '/douyin/rooms'）
 * @param idleMs 延迟多久开始（等首屏稳定）
 */
export function prefetchPagesWhenIdle(componentPaths: string[], idleMs = 2000): void {
  const run = () => {
    for (const p of componentPaths) prefetchPage(p)
  }
  const schedule = () => {
    const w = window as any
    if (typeof w.requestIdleCallback === 'function') {
      w.requestIdleCallback(run, { timeout: 3000 })
    } else {
      setTimeout(run, 300)
    }
  }
  setTimeout(schedule, idleMs)
}
