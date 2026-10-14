import App from './App.vue'
import { createApp } from 'vue'
import { initStore } from './store'                 // Store
import { initRouter } from './router'               // Router
import language from './locales'                    // 国际化
import '@styles/core/tailwind.css'                  // tailwind
import '@styles/index.scss'                         // 样式
import '@utils/sys/console.ts'                      // 控制台输出内容
import { setupGlobDirectives } from './directives'
import { setupErrorHandle } from './utils/sys/error-handle'
import { prefetchPagesWhenIdle } from './router/core/prefetch'

document.addEventListener(
  'touchstart',
  function () {},
  { passive: false }
)

const app = createApp(App)
initStore(app)
initRouter(app)
setupGlobDirectives(app)
setupErrorHandle(app)

app.use(language)
app.mount('#app')

/*
 * 空闲时预取抖音各页的分包：路由是懒加载的，首次进入某页要先下载它的 JS
 * （生产版实测单个分包 39~124KB）。登录后浏览器空闲时先拉下来，
 * 点菜单时直接命中缓存，跳转不再等 chunk。
 * 只在空闲时跑，不抢首屏资源；失败静默（真进页面时会正常加载）。
 */
prefetchPagesWhenIdle([
  '/douyin/dashboard',
  '/douyin/rooms',
  '/douyin/sessions',
  '/douyin/trends',
  '/douyin/search',
  '/douyin/status',
  '/douyin/detail',
  '/douyin/profile'
])