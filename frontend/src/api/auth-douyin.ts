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
