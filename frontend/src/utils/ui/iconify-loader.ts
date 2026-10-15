/**
 * 离线图标加载器
 *
 * 实测背景：前端用 @iconify/vue 的 <Icon>，图标默认走**运行时 CDN**
 * （api.iconify.design / api.simplesvg.com / api.unisvg.com）。
 * 这台机器上三个域名**全部连不上**（ERR_CONNECTION_TIMED_OUT / REFUSED），
 * 于是所有图标都是空白 —— 对一个本地/内网工具是硬伤。
 *
 * 做法：把源码里**实际用到**的图标（约 110 个）作为子集打进 bundle，
 * 启动时用 addCollection() 注册，不再依赖网络。
 * 子集由 scripts/gen-icon-subset.cjs 扫描生成（构建前自动跑，见 package.json 的 build 脚本）。
 *
 * 注意：动态拼接的图标名（如 `ri:${x}-line`）扫不到，联网时仍走 CDN；
 * 确认不再联网的话，把它们改成字面量，或补进生成脚本的 EXTRA。
 *
 * @module utils/ui/iconify-loader
 */
import { addCollection } from '@iconify/vue'
import offlineIcons from '@/assets/iconify/offline-icons.json'

/** 生成的子集形如 { ri: { prefix, icons, aliases, width, height }, ... } */
interface OfflineCollection {
  prefix: string
  icons: Record<string, unknown>
  aliases?: Record<string, unknown>
  width?: number
  height?: number
}

let registered = false

/** 注册离线图标集（幂等，重复调用不会重复注册） */
export function registerOfflineIcons(): void {
  if (registered) return
  registered = true

  const collections = offlineIcons as unknown as Record<string, OfflineCollection>
  let count = 0
  const failed: string[] = []
  for (const [key, collection] of Object.entries(collections)) {
    try {
      // addCollection 需要 prefix 字段；生成脚本已写好，这里再兜一层
      addCollection({
        ...collection,
        prefix: collection.prefix || key
      } as Parameters<typeof addCollection>[0])
      count += Object.keys(collection.icons || {}).length
    } catch (e) {
      // 校验不过会整包被拒（例如别名指向缺失的父图标）—— 必须报出来，
      // 否则表现就是"图标静默空白"，非常难查（第一版就这么翻车的）。
      failed.push(`${key}: ${(e as Error).message}`)
    }
  }
  if (failed.length) console.error('[iconify] 离线图标集注册失败：\n  ' + failed.join('\n  '))
  if (import.meta.env.DEV || failed.length) {
    console.info(
      `[iconify] 已注册离线图标 ${count} 个（${Object.keys(collections).length} 个图标集），不依赖 CDN`
    )
  }
}
