import request from '@/utils/http'
import { AppRouteRecord } from '@/types/router'

// 获取用户列表
export function fetchGetUserList(params: Api.SystemManage.UserSearchParams) {
  return request.get<Api.SystemManage.UserList>({
    url: '/api/user/list',
    params
  })
}

/*
 * fetchGetRoleList 已删除：它调用的 /api/role/list 后端并不存在，且全项目无人调用。
 * fetchGetMenuList 保留 —— 只在后端菜单模式（VITE_ACCESS_MODE=backend）下会用到，
 * 本项目两个 env 都是 frontend，属于待用而非死代码。
 */

// 获取菜单列表
export function fetchGetMenuList() {
  return request.get<AppRouteRecord[]>({
    url: '/api/v3/system/menus'
  })
}
