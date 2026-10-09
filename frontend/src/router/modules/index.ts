import { AppRouteRecord } from '@/types/router'
import { douyinRoutes } from './douyin'
import { accountRoutes } from './account'

/**
 * 导出所有模块化路由
 */
export const routeModules: AppRouteRecord[] = [douyinRoutes, accountRoutes]
