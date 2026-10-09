import request from './douyin-http'

export interface LoginResult {
  token: string
  refreshToken: string
  roles: string[]
  role?: string
  userId: number
  userName: string
}

export interface UserInfo {
  userId: number
  userName: string
  roles: string[]
  /** 后端原始角色码：R_SUPER / R_GUEST */
  role?: string
  email?: string
  avatar?: string
  createTime?: string
  lastLoginTime?: string
  /** 令牌策略说明（后端随 /api/user/info 一起给） */
  tokenPolicy?: string
}

export interface UserListResult {
  records: {
    id: number
    userName: string
    userRoles: string[]
    status: string
    createTime: string
    /** 后端把"上次登录"放这个字段（列表直接复用模板的字段名） */
    updateTime?: string
  }[]
  current: number
  size: number
  total: number
}

export function fetchLogin(params: { userName: string; password: string }) {
  return request.post<LoginResult>({ url: '/api/auth/login', data: params })
}

export function fetchGetUserInfo() {
  return request.get<UserInfo>({ url: '/api/user/info' })
}

/** 修改自己的密码（需要当前密码；成功后应重新登录） */
export function changePassword(params: { oldPassword: string; newPassword: string }) {
  return request.post<{ ok: boolean; message?: string }>({
    url: '/api/user/password',
    data: params
  })
}

export function fetchUserList(params: Record<string, unknown>) {
  return request.get<UserListResult>({ url: '/api/user/list', params })
}

/* ---------- 用户管理（仅管理员；后端会再校验一次角色与"最后一个管理员"保护） ---------- */

export function createUser(data: { userName: string; password: string; role: string }) {
  return request.post<{ ok: boolean; message?: string }>({ url: '/api/user/create', data })
}

export function updateUser(data: { id: number; enabled?: boolean; role?: string }) {
  return request.post<{ ok: boolean; message?: string }>({ url: '/api/user/update', data })
}

export function resetUserPassword(data: { id: number; newPassword: string }) {
  return request.post<{ ok: boolean; message?: string }>({
    url: '/api/user/reset-password',
    data
  })
}

export function deleteUser(data: { id: number }) {
  return request.post<{ ok: boolean; message?: string }>({ url: '/api/user/delete', data })
}
