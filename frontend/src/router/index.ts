import type { App } from 'vue'
import { createRouter, createWebHashHistory } from 'vue-router'
import { staticRoutes } from './routes/staticRoutes'
import { configureNProgress } from '@/utils/router'
import { setupBeforeEachGuard } from './guards/beforeEach'
import { setupAfterEachGuard } from './guards/afterEach'

// 创建路由实例
export const router = createRouter({
  history: createWebHashHistory(),
  routes: staticRoutes, // 静态路由
  /*
   * 切页滚动复位。
   *
   * 滚动容器是布局里的 #app-main（不是 window），原来没有任何复位逻辑 ——
   * 从一个长页面（场次详情 / 信息查询）点菜单跳到别的页面，
   * 会停在上一页的滚动位置，看到"半截页面"，很廉价。
   *
   * - 浏览器前进/后退：恢复原位置（savedPosition），这是用户预期；
   * - 正常的菜单/链接跳转：回到顶部；
   * - 同一路径只换 query：不动（避免翻页/筛选时被弹回顶部）。
   */
  scrollBehavior(to, from, savedPosition) {
    if (savedPosition) return savedPosition
    if (to.path === from.path) return false
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
