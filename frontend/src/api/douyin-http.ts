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
    const cfg = (error.config || {}) as { showErrorMessage?: boolean }
    const status = error.response?.status
    // 后端 web-dashboard.js 的失败响应体里带着真正的原因
    // （例如 {"ok":false,"error":"房间 65209552987 已在监控"}）。
    // 原来只按状态码提示「请求失败：HTTP 409」，把最有用的信息丢掉了。
    const backendMsg =
      error.response?.data?.error || error.response?.data?.message || ''
    if (backendMsg) (error as { backendMessage?: string }).backendMessage = backendMsg

    if (status === 401) {
      ElMessage.error('认证失败，请重新登录')
      useUserStore().logOut()
    } else if (cfg.showErrorMessage !== false) {
      // 优先展示后端给的真实原因，没有才退回状态码文案
      ElMessage.error(
        backendMsg || (status ? `请求失败：HTTP ${status}` : error.message || '请求失败')
      )
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

/**
 * 统一走 douyinRequest.request({...cfg, method})，把整份 config 透传下去。
 * 原来只转发 url/data/params/headers，会丢掉自定义选项（例如 showErrorMessage），
 * 导致「关掉自动错误提示」这类配置静默失效。
 */
export default {
  get: (config: AxiosRequestConfig | string) =>
    douyinRequest.request({ ...toConfig(config), method: 'GET' }),
  post: (config: AxiosRequestConfig | string) =>
    douyinRequest.request({ ...toConfig(config), method: 'POST' }),
  put: (config: AxiosRequestConfig | string) =>
    douyinRequest.request({ ...toConfig(config), method: 'PUT' }),
  del: (config: AxiosRequestConfig | string) =>
    douyinRequest.request({ ...toConfig(config), method: 'DELETE' })
} as unknown as DouyinRequest
