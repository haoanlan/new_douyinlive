import { AppRouteRecord } from '@/types/router'

/**
 * 账号管理（只有管理员看得到）。
 *
 * 本项目原来只挂了 douyin 一个模块，所以这里单独成一个模块：
 * 侧边栏会按 meta.roles 自动对普通用户隐藏。
 */
export const accountRoutes: AppRouteRecord = {
  path: '/account',
  name: 'Account',
  component: '/index/index',
  meta: {
    title: '账号管理',
    icon: 'ri:shield-user-line',
    roles: ['R_SUPER']
  },
  children: [
    {
      path: 'users',
      name: 'UserManage',
      component: '/system/user-manage',
      meta: {
        title: '用户管理',
        icon: 'ri:user-settings-line',
        keepAlive: true,
        roles: ['R_SUPER']
      }
    }
  ]
}
