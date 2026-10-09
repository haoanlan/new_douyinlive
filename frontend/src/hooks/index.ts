// 通用功能集合
export { useCommon } from './core/useCommon'

// 应用模式
export { useAppMode } from './core/useAppMode'

// 权限控制
export { useAuth } from './core/useAuth'

/*
 * 原来这里还 re-export 了 useTable（指向 ./core/useTable）。
 * 清理模板页时 useTable.ts 已删除（唯一使用者是模板的系统管理/用户页），
 * 但这条 re-export 漏了 —— 因为它在桶文件里用的是相对路径，
 * 而当时的引用扫描只匹配 '@/...' 形式，加上 Vite 有 transform 缓存，
 * 直到重启后缓存清空才报 "Failed to resolve import"。
 * 现在改用 scripts/import-check.js 做静态检查（不依赖缓存），这类断链会当场暴露。
 */

// 表格列配置管理
export { useTableColumns } from './core/useTableColumns'

// 主题相关
export { useTheme } from './core/useTheme'

// 礼花+文字滚动
export { useCeremony } from './core/useCeremony'

// 顶栏快速入口
export { useFastEnter } from './core/useFastEnter'

// 顶栏功能管理
export { useHeaderBar } from './core/useHeaderBar'

// 图表相关
export { useChart, useChartComponent, useChartOps } from './core/useChart'

// 布局高度
export { useLayoutHeight, useAutoLayoutHeight } from './core/useLayoutHeight'
