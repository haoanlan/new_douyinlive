/**
 * 带认证的文件下载（报告图片等）
 *
 * 背景（DESIGN-REVIEW P0-1）：
 * sessions 页的「下载报告」原来用 `window.open(getReportUrl(id))` 打开新标签。
 * 浏览器导航**不会带上 Authorization 头**，而 web-dashboard.js 对所有 /api/*
 * 都走 checkAuth（只认 Bearer 头）→ 新标签里只有一行
 *   {"error":"未授权，请先登录"}
 * 也就是说「下载报告」是个永远不可能成功的死按钮（单条与批量都一样）。
 *
 * 正确做法：先用带 token 的请求把文件取成 blob，再用 object URL 触发下载。
 */
import axios from 'axios'
import { useUserStore } from '@/store/modules/user'
import { apiErrorMessage, decodeBlobError } from '@/utils/douyin-error'

/** 从 Content-Disposition 里取文件名（后端有给就用） */
function filenameFromDisposition(disposition: string | undefined, fallback: string): string {
  if (!disposition) return fallback
  // filename*=UTF-8''xxx 或 filename="xxx"
  const star = /filename\*=UTF-8''([^;]+)/i.exec(disposition)
  if (star?.[1]) {
    try {
      return decodeURIComponent(star[1])
    } catch {
      /* ignore */
    }
  }
  const plain = /filename="?([^";]+)"?/i.exec(disposition)
  return plain?.[1] ? plain[1].trim() : fallback
}

/**
 * 用带认证的请求下载文件并触发浏览器保存。
 *
 * 注意：这里不复用 douyinRequest —— 它的响应拦截器会把二进制响应按文本解析
 * （transformResponse 里 JSON.parse），会破坏图片字节；且失败时它只拿到解包后的
 * data。下载走独立的 axios 实例，能拿到原始 blob 与响应头。
 *
 * @param url 接口地址
 * @param fallbackName 后端没给文件名时使用的名字
 * @returns 实际保存的文件名
 * @throws 失败时抛出带可读信息的 Error（调用方展示即可）
 */
export async function downloadWithAuth(url: string, fallbackName: string): Promise<string> {
  const { accessToken } = useUserStore()
  try {
    const res = await axios.get(url, {
      responseType: 'blob',
      timeout: 120000, // 报告可能是后端现生成（要渲染截图），给足时间
      headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : {}
    })
    const name = filenameFromDisposition(
      res.headers?.['content-disposition'] as string | undefined,
      fallbackName
    )
    const blobUrl = URL.createObjectURL(res.data as Blob)
    try {
      const a = document.createElement('a')
      a.href = blobUrl
      a.download = name
      document.body.appendChild(a)
      a.click()
      a.remove()
    } finally {
      // 延后释放：Safari 上立刻 revoke 会导致下载中断
      setTimeout(() => URL.revokeObjectURL(blobUrl), 10000)
    }
    return name
  } catch (e) {
    // responseType:'blob' 时，后端的 JSON 错误体也会是 Blob，需要先解出文本
    const blobMsg = await decodeBlobError((e as { response?: { data?: unknown } })?.response?.data)
    throw new Error(blobMsg || apiErrorMessage(e, '下载失败'))
  }
}
