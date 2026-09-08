import request from './douyin-http'

export interface LoginResult {
  token: string
  refreshToken: string
  roles: string[]
  userId: number
  userName: string
}

export interface UserInfo {
  userId: number
  userName: string
  roles: string[]
  email?: string
  avatar?: string
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

export function fetchUserList(params: Record<string, unknown>) {
  return request.get<UserListResult>({ url: '/api/user/list', params })
}
