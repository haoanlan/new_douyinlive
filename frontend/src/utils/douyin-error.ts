/**
 * 抖音后端错误信息提取（共用）
 *
 * 背景：抖音后端（web-dashboard.js）的失败响应体里带着**真正的原因**，
 * 例如 {"ok":false,"error":"房间 65209552987 已在监控"}；
 * 而请求层只能按 HTTP 状态码给出「请求失败：HTTP 409」这类通用文案。
 * 原来这段逻辑只存在于 rooms/index.vue（apiErrorMessage），
 * 其他页面失败时拿不到原因，只能显示模糊的「失败」。
 *
 * 这里提到公共层，供所有抖音页面复用。
 */

/** 模板自带 @/utils/http 抛出的 HttpError 形状 */
interface HttpErrorLike {
  name?: string
  status?: number
  message?: string
  data?: unknown
}

/** api/douyin-http 抛出的 axios 原始错误形状（拦截器已挂 backendMessage） */
interface AxiosErrorLike {
  backendMessage?: string
  message?: string
  response?: { status?: number; data?: unknown }
}

/** 从可能是 Uint8Array/字符串/对象的 body 里取出 message 字段 */
function pickMessage(body: unknown): string {
  if (!body) return ''
  // axios 在 responseType:'blob' 时会把 JSON 错误体也转成 Blob，
  // 此时 body 是 Blob，需要调用方先解出文本（见 decodeBlobError）
  if (typeof body === 'string') {
    try {
      const j = JSON.parse(body)
      return j?.error || j?.message || ''
    } catch {
      return body
    }
  }
  const o = body as { error?: string; message?: string }
  return o?.error || o?.message || ''
}

function isHttpErrorLike(e: unknown): e is HttpErrorLike {
  const x = e as HttpErrorLike
  return Boolean(x && typeof x === 'object' && typeof x.status === 'number' && 'data' in x)
}

/**
 * 取出后端返回的真实失败原因。
 * @param e 捕获到的异常
 * @param fallback 兜底文案
 */
export function apiErrorMessage(e: unknown, fallback = '请求失败'): string {
  if (isHttpErrorLike(e)) {
    if (e.data instanceof Uint8Array) return new TextDecoder().decode(e.data) || fallback
    return pickMessage(e.data) || e.message || fallback
  }
  const ax = e as AxiosErrorLike
  return (
    ax?.backendMessage ||
    pickMessage(ax?.response?.data) ||
    ax?.message ||
    fallback
  )
}

/**
 * 解析 blob 形式的错误响应体（responseType:'blob' 时后端 JSON 也会变成 Blob）。
 * 由调用方在 catch 里 await 后交给 apiErrorMessage。
 */
export async function decodeBlobError(blob: unknown): Promise<string> {
  try {
    if (blob && typeof (blob as Blob).text === 'function') {
      const text = await (blob as Blob).text()
      try {
        const j = JSON.parse(text)
        return j?.error || j?.message || text
      } catch {
        return text
      }
    }
  } catch {
    /* ignore */
  }
  return ''
}

/**
 * 给人看的错误文案。
 *
 * 为什么需要它：`apiErrorMessage()` 会把 axios 的原始 message 端出来，
 * 后端挂掉时用户看到的是 **"Request failed with status code 500"** ——
 * 对一个监控面板的使用者来说，这句话不说明任何事（截图里就是这个样子）。
 * 这里按"后端给的原因 → 状态码 → 网络层"的优先级翻译成人话，
 * 并且**永远保留状态码**（排查时有用），只是前面加上解释。
 *
 * @param e 捕获到的异常
 * @param fallback 兜底文案
 */
export function humanizeRequestError(e: unknown, fallback = '请求失败'): string {
  const ax = e as AxiosErrorLike & { code?: string; status?: number }
  const status = ax?.response?.status ?? ax?.status ?? (e as HttpErrorLike)?.status
  // 后端自己给的原因通常最具体（例如「房间 X 已在监控」）
  const backend = ax?.backendMessage || pickMessage(ax?.response?.data) || pickMessage((e as HttpErrorLike)?.data)

  /*
   * 5xx 例外：服务端错误的后端 message 常常是 "internal error" 这类通用英文，
   * 对使用者毫无信息量（实测就是这样）。这类先给人话解释，再把后端原文附在后面，
   * 既让用户看懂、又不丢排查线索。
   */
  if (typeof status === 'number' && status >= 500) {
    return backend && !/^(internal error|error|unknown)/i.test(backend)
      ? `后端服务出错（HTTP ${status}）：${backend}`
      : `后端服务出错（HTTP ${status}）—— 服务可能正在重启或内部异常`
  }

  // 1) 其它情况后端给的原因最有用，直接用
  if (backend) return backend

  const raw = (e as Error)?.message || ''
  // 2) 有 HTTP 状态码：按码翻译
  if (typeof status === 'number') {
    if (status === 401 || status === 403) return `登录状态已失效（HTTP ${status}），请重新登录`
    if (status === 404) return `接口不存在（HTTP 404），后端版本可能不匹配`
    if (status === 429) return '请求过于频繁（HTTP 429），请稍后再试'
    return `请求被拒绝（HTTP ${status}）`
  }

  // 3) 没有响应：网络层/超时
  if (ax?.code === 'ECONNABORTED' || /timeout/i.test(raw)) return '请求超时 —— 后端可能正在处理大数据量'
  if (ax?.code === 'ERR_NETWORK' || /Network Error/i.test(raw)) return '无法连接后端服务 —— 请确认仪表盘进程还在运行'
  return raw || fallback
}

