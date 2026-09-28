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
