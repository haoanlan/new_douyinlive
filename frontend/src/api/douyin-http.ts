import axios, { type AxiosRequestConfig } from 'axios'
import { useUserStore } from '@/store/modules/user'
import { ElMessage } from 'element-plus'

/**
 * 抖音后端 HTTP 实例
 *
 * 后端 web-dashboard.js 返回裸 JSON（无 {code,msg,data} 包装），
 * 认证方式为 Authorization: Bearer <token>，401 时返回 HTTP 401。
 * 模板自带的 @/utils/http 期待 BaseResponse 包装，因此这里独立实现。
 */
export const douyinRequest = axios.create({
  baseURL: '/',
  timeout: 20000,
  validateStatus: (status) => status >= 200 && status < 300
})

douyinRequest.interceptors.request.use((config) => {
  const { accessToken } = useUserStore()
  if (accessToken) {
    config.headers.set('Authorization', `Bearer ${accessToken}`)
  }
  return config
})

douyinRequest.interceptors.response.use(
  (response) => response.data,
  (error) => {
    if (error.response?.status === 401) {
      ElMessage.error('认证失败，请重新登录')
      useUserStore().logOut()
    } else if (error.response?.status) {
      ElMessage.error(`请求失败：HTTP ${error.response.status}`)
    } else {
      ElMessage.error(error.message || '请求失败')
    }
    return Promise.reject(error)
  }
)

/** 响应拦截器已解包 data；axios 的 get/post 别名第一个参数是 url 字符串，
 *  这里包装为 config 对象形式，兼容业务层 `request.get({ url, ... })` 调用。 */
function toConfig(config: AxiosRequestConfig | string): AxiosRequestConfig {
  if (typeof config === 'string') return { url: config }
  return config
}

export interface DouyinRequest {
  get<T = any>(config: AxiosRequestConfig | string): Promise<T>
  post<T = any>(config: AxiosRequestConfig | string): Promise<T>
  put<T = any>(config: AxiosRequestConfig | string): Promise<T>
  del<T = any>(config: AxiosRequestConfig | string): Promise<T>
}

export default {
  get: (config: AxiosRequestConfig | string) => {
    const cfg = toConfig(config)
    return douyinRequest.get(cfg.url!, { params: cfg.params, headers: cfg.headers })
  },
  post: (config: AxiosRequestConfig | string) => {
    const cfg = toConfig(config)
    return douyinRequest.post(cfg.url!, cfg.data, { params: cfg.params, headers: cfg.headers })
  },
  put: (config: AxiosRequestConfig | string) => {
    const cfg = toConfig(config)
    return douyinRequest.put(cfg.url!, cfg.data, { params: cfg.params, headers: cfg.headers })
  },
  del: (config: AxiosRequestConfig | string) => {
    const cfg = toConfig(config)
    return douyinRequest.delete(cfg.url!, {
      params: cfg.params,
      data: cfg.data,
      headers: cfg.headers
    })
  }
} as unknown as DouyinRequest
