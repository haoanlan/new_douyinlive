import { createRouter, createWebHistory } from 'vue-router'

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes: [
    {
      path: '/',
      component: () => import('@/components/AppLayout.vue'),
      children: [
        {
          path: '',
          name: 'hosts',
          component: () => import('@/views/HomeView.vue'),
          meta: { viewLevel: 'hosts', pageTitle: '直播监控', showBackBtn: false, showTopNav: true },
        },
        {
          path: 'sessions/:hostId',
          name: 'sessions',
          component: () => import('@/views/SessionsView.vue'),
          meta: { viewLevel: 'sessions', showBackBtn: true, showTopNav: false },
        },
        {
          path: 'detail/:sessionId',
          name: 'detail',
          component: () => import('@/views/DetailView.vue'),
          meta: { viewLevel: 'detail', showBackBtn: true, showTopNav: false },
        },
      ],
    },
    // 404 兜底路由
    { path: '/:pathMatch(.*)*', redirect: '/' },
  ],
  scrollBehavior(_to, _from, savedPosition) {
    if (savedPosition) return savedPosition
    return { top: 0 }
  },
})

// 路由参数校验：缺少必要参数时回退到首页
router.beforeEach((to) => {
  if (to.name === 'sessions' && !to.params.hostId) {
    return { name: 'hosts' }
  }
  if (to.name === 'detail' && !to.params.sessionId) {
    return { name: 'hosts' }
  }
})

export default router
