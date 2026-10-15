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
      /*
       * 数据合并查看：跨主播、跨场次把多场直播的数据合成一份。
       *
       * 为什么是独立路由而不是详情页里的一个 tab：选择场次要能跨主播
       * （在「场次历史」里一次只能看一个主播），放详情页里就选不到别人家的场次。
       */
      path: 'combined',
      name: 'DouyinCombined',
      component: '/douyin/combined',
      meta: {
        title: 'menus.douyin.combined',
        icon: 'ri:merge-cells-horizontal',
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
    },
    {
      /*
       * 个人中心。
       *
       * 原来头像菜单里的「个人中心」指向 /system/user-center，但本项目的
       * routeModules 只挂了 douyin 模块（systemRoutes 根本没注册），
       * 那个链接**一直是 404**。这里把它作为隐藏子页真正挂上。
       * 组件复用 views/system/user-center（路由路径与组件目录本来就可以不同）。
       */
      path: 'account',
      name: 'UserCenter',
      component: '/system/user-center',
      meta: {
        title: '个人中心',
        icon: 'ri:user-3-line',
        isHide: true,
        /*
         * 个人中心要有**自己的标签页**。
         *
         * 原来这里是 isHideTab: true + activePath: '/douyin/status'（从状态监控那条
         * 路由抄下来的）—— 于是点个人中心后，高亮的却是「状态监控」，
         * 两个页面毫无关系（用户："个人中心路由挂在了状态监控上"）。
         * 改成不隐藏标签、并且不再借用别人的 activePath。
         */
        isHideTab: false,
        keepAlive: true,
        roles: ['R_SUPER', 'R_GUEST']
      }
    }
  ]
}
