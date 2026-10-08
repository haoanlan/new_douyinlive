/**
 * 快速入口配置
 * 包含：应用列表、快速链接等配置
 */
import { WEB_LINKS } from '@/utils/constants'
import type { FastEnterConfig } from '@/types/config'

const fastEnterConfig: FastEnterConfig = {
  // 显示条件（屏幕宽度）
  minWidth: 1200,
  // 应用列表
  // 原来的 Console/Analysis/Fireworks/Chat/ChangeLog 都是模板遗留、当前根本没有注册
  // （点击会抛 MATCHER_NOT_FOUND 且无任何提示），这里换成真实存在的抖音页面。
  // 见 docs/UI-AUDIT-2026-10-07.md P2-26。
  applications: [
    {
      name: '数据概览',
      description: '实时状态与历史总览',
      icon: 'ri:bar-chart-2-line',
      iconColor: '#377dff',
      enabled: true,
      order: 1,
      routeName: 'DouyinDashboard'
    },
    {
      name: '房间管理',
      description: '监控房间与场次',
      icon: 'ri:live-line',
      iconColor: '#ff3b30',
      enabled: true,
      order: 2,
      routeName: 'DouyinRooms'
    },
    {
      name: '趋势分析',
      description: '同一房间跨场次走势',
      icon: 'ri:line-chart-line',
      iconColor: '#7A7FFF',
      enabled: true,
      order: 3,
      routeName: 'DouyinTrends'
    },
    {
      name: '信息查询',
      description: '按昵称查用户画像',
      icon: 'ri:search-line',
      iconColor: '#13DEB9',
      enabled: true,
      order: 4,
      routeName: 'DouyinSearch'
    },
    {
      name: '状态监控',
      description: '服务与连接健康',
      icon: 'ri:heart-pulse-line',
      iconColor: '#ffb100',
      enabled: true,
      order: 5,
      routeName: 'DouyinStatus'
    },
    {
      name: '官方文档',
      description: '使用指南与开发文档',
      icon: 'ri:bill-line',
      iconColor: '#ffb100',
      enabled: true,
      order: 6,
      link: WEB_LINKS.DOCS
    },
    {
      name: '技术支持',
      description: '技术支持与问题反馈',
      icon: 'ri:user-location-line',
      iconColor: '#ff6b6b',
      enabled: true,
      order: 7,
      link: WEB_LINKS.COMMUNITY
    },
    {
      name: '哔哩哔哩',
      description: '技术分享与交流',
      icon: 'ri:bilibili-line',
      iconColor: '#FB7299',
      enabled: true,
      order: 8,
      link: WEB_LINKS.BILIBILI
    }
  ],
  // 快速链接
  quickLinks: [
    {
      name: '登录',
      enabled: true,
      order: 1,
      routeName: 'Login'
    },
    {
      name: '注册',
      enabled: true,
      order: 2,
      routeName: 'Register'
    },
    {
      name: '忘记密码',
      enabled: true,
      order: 3,
      routeName: 'ForgetPassword'
    },
    {
      name: '定价',
      enabled: false, // 模板遗留，本项目管理后台没有这个页面（UI-AUDIT P2-26）
      order: 4,
      routeName: 'Pricing'
    },
    {
      name: '个人中心',
      enabled: false, // 同上，路由未注册
      order: 5,
      routeName: 'UserCenter'
    },
    {
      name: '留言管理',
      enabled: false, // 同上，路由未注册
      order: 6,
      routeName: 'ArticleComment'
    }
  ]
}

export default Object.freeze(fastEnterConfig)
