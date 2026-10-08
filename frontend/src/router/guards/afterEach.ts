import { nextTick } from 'vue'
import { useSettingStore } from '@/store/modules/setting'
import { Router } from 'vue-router'
import NProgress from 'nprogress'
import { loadingService } from '@/utils/ui'
import { getPendingLoading, resetPendingLoading } from './beforeEach'

/**
 * 滚动位置记忆（见 docs/UI-AUDIT-2026-10-07.md P0-2）
 *
 * `#app-main` 才是真正的滚动容器（views/index/style.scss），vue-router 的
 * scrollBehavior 管不到它；原来这里无条件 `scrollTop = 0`，于是每次切页、
 * 每次后退都回到最上面 —— 列表页（rooms/sessions）看完第 3 屏点进详情再回来，
 * 位置全丢（实测：滚到 900 → 切走 → 回来 = 0，浏览器后退也 = 0）。
 *
 * 规则：离开某个地址时记下位置；**浏览器后退/前进**回到该地址时还原，
 * 正常向前导航仍然回顶。
 *
 * 怎么判断"后退/前进"：不能靠 `popstate` 事件打标记 —— vue-router 自己也在监听
 * popstate，而浏览器会在每个监听器返回后做一次微任务检查，于是 vue-router 的导航
 * 可能在我们的监听器之前就跑完了 afterEach（标记还没置位就已被消费）。实测就是
 * 这样：后退时位置始终是 0。
 *
 * 改用历史条目序号：vue-router 给每个新条目写 `position = 上一个 position + 1`
 * （replace 则保持原值），所以「新位置不等于上次位置 + 1」就说明这是前进/后退。
 */
const scrollPositions = new Map<string, number>()
let lastPosition = -1

function scrollContainer(): HTMLElement | null {
  return document.getElementById('app-main')
}

/** 路由全局后置守卫 */
export function setupAfterEachGuard(router: Router) {
  router.beforeEach((to, from) => {
    const el = scrollContainer()
    if (el && from.fullPath && from.fullPath !== to.fullPath) {
      scrollPositions.set(from.fullPath, el.scrollTop)
    }
  })

  router.afterEach((to) => {
    const el = scrollContainer()
    if (el) {
      const position = window.history.state?.position ?? 0
      const isPop = lastPosition >= 0 && position !== lastPosition + 1
      lastPosition = position

      const saved = isPop ? scrollPositions.get(to.fullPath) : undefined
      el.scrollTop = saved ?? 0
      // 缓存页可能刚被重新激活、非缓存页的数据还是异步来的：
      // DOM 更新后再补一次，避免被后续渲染冲掉。
      if (saved) {
        nextTick(() => {
          const again = scrollContainer()
          if (again && again.scrollTop !== saved) again.scrollTop = saved
        })
      }
    }

    // 关闭进度条
    const settingStore = useSettingStore()
    if (settingStore.showNprogress) {
      NProgress.done()
      // 确保进度条完全移除，避免残影
      setTimeout(() => {
        NProgress.remove()
      }, 600)
    }

    // 关闭 loading 效果
    if (getPendingLoading()) {
      nextTick(() => {
        loadingService.hideLoading()
        resetPendingLoading()
      })
    }
  })
}
