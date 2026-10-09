import type { App } from 'vue'
import { createRouter, createWebHashHistory } from 'vue-router'
import { staticRoutes } from './routes/staticRoutes'
import { configureNProgress } from '@/utils/router'
import { setupBeforeEachGuard } from './guards/beforeEach'
import { setupAfterEachGuard } from './guards/afterEach'

/**
 * 页面滚动位置记忆：fullPath → scrollTop。
 *
 * 为什么需要：滚动容器是布局里的 #app-main。从场次列表点进某个场次详情、
 * 再点「场次列表」返回时，列表是 KeepAlive 缓存的（筛选条件都还在），
 * 但滚动位置会被 scrollBehavior 归零 —— 用户看到的是一份"回到顶部"的列表，
 * 得重新找刚才那一行，很廉价。
 *
 * 浏览器前进/后退由 vue-router 的 savedPosition 负责；
 * 这里专门补"页面内按钮返回"这一类（push 到父级路径）。
 * 位置在 beforeEach 里保存（那时 DOM 还没换）。
 */
export const scrollMemory = new Map<string, number>()

/**
 * 导航栈（最近访问过的 fullPath，末尾是当前页）。
 *
 * 用来判断"这次跳转是不是回到了上一页"（A → B → A）。
 * 为什么不用路径前缀判断：场次详情是 /douyin/detail/287，**不是** /douyin/sessions 的子路径，
 * `from.path.startsWith(to.path + '/')` 永远不成立（我第一版就是这么写的，实测没生效）。
 * 栈判断与实际操作一致：用户在 B 点「返回 A」时，栈尾部是 [... , A, B]，
 * 目标 A 正好是"末两项之前"的那一项。
 */
const navStack: string[] = []

/** 守卫里调用：记录本次要去的页面 */
export function rememberNavigation(fullPath: string): void {
  if (!fullPath) return
  if (navStack[navStack.length - 1] === fullPath) return
  navStack.push(fullPath)
  if (navStack.length > 50) navStack.shift()
}

/** 目标页面是否正好是"当前页的上一页"（= 用户点了返回） */
function isBackToPreviousPage(targetFullPath: string): boolean {
  return navStack.length >= 3 && navStack[navStack.length - 3] === targetFullPath
}

// 创建路由实例
export const router = createRouter({
  history: createWebHashHistory(),
  routes: staticRoutes, // 静态路由
  /*
   * 切页滚动复位 / 恢复。
   *
   * - 浏览器前进/后退：用浏览器给的位置（savedPosition）；
   * - **点「返回」回到上一页**（如 场次详情 → 场次列表）：恢复上次的位置 —— 这才是"返回"的预期；
   * - 其它跳转（菜单、链接）：回到顶部；
   * - 同一路径只换 query：不动（避免翻页/筛选被弹回顶部）。
   */
  scrollBehavior(to, from, savedPosition) {
    if (savedPosition) return savedPosition
    if (to.path === from.path) return false

    const remembered = scrollMemory.get(to.fullPath)
    if (isBackToPreviousPage(to.fullPath) && remembered > 0) {
      const container = document.getElementById('app-main')
      if (container) container.scrollTop = remembered
      return { el: '#app-main', top: remembered }
    }

    const container = document.getElementById('app-main')
    if (container) container.scrollTop = 0
    return { top: 0 }
  }
})

// 初始化路由
export function initRouter(app: App<Element>): void {
  configureNProgress() // 顶部进度条
  setupBeforeEachGuard(router) // 路由前置守卫
  setupAfterEachGuard(router) // 路由后置守卫
  app.use(router)
}

// 主页路径，默认使用菜单第一个有效路径，配置后使用此路径
export const HOME_PAGE_PATH = ''
