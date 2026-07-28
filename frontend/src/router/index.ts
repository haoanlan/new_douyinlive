import { createRouter, createWebHistory } from 'vue-router'

const router = createRouter({
  history: createWebHistory(),
  routes: [
    {
      path: '/',
      name: 'hosts',
      component: () => import('@/views/HomeView.vue'),
    },
    {
      path: '/sessions/:hostId',
      name: 'sessions',
      component: () => import('@/views/HomeView.vue'),
      props: true,
    },
    {
      path: '/detail/:sessionId',
      name: 'detail',
      component: () => import('@/views/HomeView.vue'),
      props: true,
    },
  ],
})

export default router
