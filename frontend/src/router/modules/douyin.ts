import { AppRouteRecord } from '@/types/router'

export const douyinRoutes: AppRouteRecord = {
  name: 'Douyin',
  path: '/douyin',
  component: '/index/index',
  meta: {
    title: 'menus.douyin.title',
    icon: 'ri:live-line',
    roles: ['R_SUPER', 'R_GUEST']
  },
  children: [
    {
      path: 'dashboard',
      name: 'DouyinDashboard',
      component: '/douyin/dashboard',
      meta: {
        title: 'menus.douyin.dashboard',
        icon: 'ri:bar-chart-2-line',
        keepAlive: true,
        roles: ['R_SUPER', 'R_GUEST']
      }
    },
    {
      path: 'rooms',
      name: 'DouyinRooms',
      component: '/douyin/rooms',
      meta: { title: 'menus.douyin.rooms', icon: 'ri:live-line', keepAlive: true, roles: ['R_SUPER', 'R_GUEST'] }
    },
    {
      path: 'sessions',
      name: 'DouyinSessions',
      component: '/douyin/sessions',
      meta: {
        title: 'menus.douyin.sessions',
        icon: 'ri:file-list-3-line',
        isHide: true,
        isHideTab: true,
        keepAlive: true,
        // 隐藏页没有自己的菜单项/标签，指定高亮归属（侧边栏与工作标签都用它兜底）
        activePath: '/douyin/rooms',
        roles: ['R_SUPER', 'R_GUEST']
      }
    },
    {
      path: 'trends',
      name: 'DouyinTrends',
      component: '/douyin/trends',
      meta: {
        title: 'menus.douyin.trends',
        icon: 'ri:line-chart-line',
        keepAlive: true,
        roles: ['R_SUPER', 'R_GUEST']
      }
    },
    {
      path: 'search',
      name: 'DouyinSearch',
      component: '/douyin/search',
      meta: {
        title: 'menus.douyin.search',
        icon: 'ri:search-line',
        // 查询要调抖音接口、结果也可能很长：离开（比如点进某个用户）后回来必须还在，
        // 不能因为没缓存就清空关键词与结果。见 docs/UI-AUDIT-2026-10-07.md P0-1。
        keepAlive: true,
        roles: ['R_SUPER', 'R_GUEST']
      }
    },
    {
      path: 'status',
      name: 'DouyinStatus',
      component: '/douyin/status',
      meta: {
        title: 'menus.douyin.status',
        icon: 'ri:heart-pulse-line',
        keepAlive: true,
        roles: ['R_SUPER', 'R_GUEST']
      }
    },
    {
      path: 'detail/:sessionId',
      name: 'DouyinDetail',
      component: '/douyin/detail',
      meta: {
        title: 'menus.douyin.detail',
        icon: 'ri:file-chart-line',
        isHide: true,
        isHideTab: true,
        activePath: '/douyin/rooms',
        roles: ['R_SUPER', 'R_GUEST']
      },
      props: true
    },
    {
      path: 'profile/:secUid',
      name: 'DouyinProfile',
      component: '/douyin/profile',
      meta: {
        title: 'menus.douyin.profile',
        icon: 'ri:user-star-line',
        isHide: true,
        isHideTab: true,
        activePath: '/douyin/search',
        roles: ['R_SUPER', 'R_GUEST']
      },
      props: true
    }
  ]
}
