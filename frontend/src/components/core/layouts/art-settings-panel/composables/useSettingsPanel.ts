import { ref, computed, watch } from 'vue'
import { useSettingStore } from '@/store/modules/setting'
import { storeToRefs } from 'pinia'
import { useBreakpoints } from '@vueuse/core'
import AppConfig from '@/config'
import { SystemThemeEnum, MenuTypeEnum } from '@/enums/appEnum'
import { mittBus } from '@/utils/sys'
import { StorageConfig } from '@/utils'
import { useTheme } from '@/hooks/core/useTheme'
import { useCeremony } from '@/hooks/core/useCeremony'
import { useSettingsState } from './useSettingsState'
import { useSettingsHandlers } from './useSettingsHandlers'

/**
 * 设置面板核心逻辑管理
 */
export function useSettingsPanel() {
  const settingStore = useSettingStore()
  const { systemThemeType, systemThemeMode, menuType } = storeToRefs(settingStore)

  // Composables
  const { openFestival, cleanup } = useCeremony()
  const { setSystemTheme, setSystemAutoTheme } = useTheme()
  const { initColorWeak } = useSettingsState()
  const { domOperations } = useSettingsHandlers()

  // 响应式状态
  const showDrawer = ref(false)

  // 使用 VueUse breakpoints 优化性能
  const breakpoints = useBreakpoints({ tablet: 1000 })
  const isMobile = breakpoints.smaller('tablet')

  // 记录窗口宽度变化前的菜单类型
  const getStoredDesktopMenuType = (): MenuTypeEnum | undefined => {
    const storedMenuType = localStorage.getItem(StorageConfig.RESPONSIVE_MENU_TYPE_KEY)
    return Object.values(MenuTypeEnum).includes(storedMenuType as MenuTypeEnum)
      ? (storedMenuType as MenuTypeEnum)
      : undefined
  }

  const setStoredDesktopMenuType = (type: MenuTypeEnum) => {
    localStorage.setItem(StorageConfig.RESPONSIVE_MENU_TYPE_KEY, type)
  }

  const clearStoredDesktopMenuType = () => {
    localStorage.removeItem(StorageConfig.RESPONSIVE_MENU_TYPE_KEY)
  }

  const storedDesktopMenuType = getStoredDesktopMenuType()
  const beforeMenuType = ref<MenuTypeEnum | undefined>(storedDesktopMenuType)
  const hasChangedMenu = ref(Boolean(storedDesktopMenuType))

  // 计算属性
  const systemThemeColor = computed(() => settingStore.systemThemeColor as string)

  // 主题相关处理
  const useThemeHandlers = () => {
    // 初始化系统颜色
    const initSystemColor = () => {
      if (!AppConfig.systemMainColor.includes(systemThemeColor.value)) {
        settingStore.setElementTheme(AppConfig.systemMainColor[0])
        settingStore.reload()
      }
    }

    // 初始化系统主题
    const initSystemTheme = () => {
      if (systemThemeMode.value === SystemThemeEnum.AUTO) {
        setSystemAutoTheme()
      } else {
        setSystemTheme(systemThemeType.value)
      }
    }

    // 监听系统主题变化
    const listenerSystemTheme = () => {
      const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)')
      mediaQuery.addEventListener('change', initSystemTheme)
      return () => {
        mediaQuery.removeEventListener('change', initSystemTheme)
      }
    }

    return {
      initSystemColor,
      initSystemTheme,
      listenerSystemTheme
    }
  }

  // 响应式布局处理
  const useResponsiveLayout = () => {
    // 使用 watch 监听断点变化，性能更优
    const stopWatch = watch(
      isMobile,
      (mobile: boolean) => {
        if (mobile) {
          // 切换到移动端布局
          if (!hasChangedMenu.value) {
            beforeMenuType.value = menuType.value
            if (menuType.value !== MenuTypeEnum.LEFT) {
              setStoredDesktopMenuType(menuType.value)
              useSettingsState().switchMenuLayouts(MenuTypeEnum.LEFT)
              hasChangedMenu.value = true
            }
          }

          settingStore.setMenuOpen(false)
        } else {
          // 恢复桌面端布局
          if (hasChangedMenu.value && beforeMenuType.value) {
            if (menuType.value === MenuTypeEnum.LEFT) {
              useSettingsState().switchMenuLayouts(beforeMenuType.value)
            }

            clearStoredDesktopMenuType()
            hasChangedMenu.value = false
          }

          settingStore.setMenuOpen(true)
        }
      },
      { immediate: true }
    )

    return { stopWatch }
  }

  /*
   * 抵消 Element 锁滚动的"滚动条宽度补偿"误判。
   *
   * lock-scroll 打开时 useLockscreen 会测量滚动条宽度，并把 body 宽度设成
   * `calc(100% - 宽度)`，用来抵消"滚动条消失后布局变宽"。但它的测量方式是往 body
   * 塞一个 `overflow: scroll` 的临时 div —— 在**设备模拟**（DevTools 的 iPhone 16）
   * 和 overlay 滚动条环境里，视口滚动条其实**不占位**（真实宽度 0），临时 div 却仍然
   * 报出 15px。于是 body 被凭空压窄 15px：
   *   实测 393×852（iPhone 16）：头像右边界 377 → 362（左移 15px），设置按钮同幅左移，
   *   顶栏宽度 393 → 378；关闭后回归原位。左侧内容不动、只有右对齐元素跟着跑，
   *   看起来就是"打开设置页面元素抖一下"。
   *
   * 这里用**真实**视口滚动条宽度（innerWidth - documentElement.clientWidth）判断：
   * 只有它 ≤ 0（补偿必然多余）时才挂 .dy-no-sb-compensate，由 CSS 把宽度还原成 auto。
   * 真实滚动条确实占位时（经典滚动条 + 文档可滚）不加类，Element 原本的补偿是对的。
   */
  let sbCompensateTimer: ReturnType<typeof setTimeout> | null = null

  const syncScrollbarCompensation = () => {
    if (sbCompensateTimer) {
      clearTimeout(sbCompensateTimer)
      sbCompensateTimer = null
    }
    const realWidth = window.innerWidth - document.documentElement.clientWidth
    document.body.classList.toggle('dy-no-sb-compensate', realWidth <= 0)
  }

  /*
   * 撤销上面的覆盖。时机很关键：Element 的 cleanup 是在关闭后 **200ms** 才把
   * body 宽度还原的，早于它撤类会让 body 在关闭动画中途又被压窄一次（再来一次左移）。
   */
  const clearScrollbarCompensation = () => {
    if (sbCompensateTimer) clearTimeout(sbCompensateTimer)
    sbCompensateTimer = setTimeout(() => {
      document.body.classList.remove('dy-no-sb-compensate')
      sbCompensateTimer = null
    }, 400)
  }

  /*
   * 用 watch 而非在各处手动调用：抽屉除了「点 X / 关闭按钮」，还能用 Esc、点遮罩关掉，
   * 那些路径不经过 closeDrawer。watch 默认 flush:'pre'，会在组件重新渲染、
   * ElDrawer 收到新的 modelValue **之前**执行，所以挂类来得及拦住 Element 设宽度。
   */
  watch(showDrawer, (val: boolean) => {
    if (val) syncScrollbarCompensation()
    else clearScrollbarCompensation()
  })

  // 抽屉控制
  const useDrawerControl = () => {
    // 用于存储 setTimeout 的 ID，以便在需要时清除
    let themeChangeTimer: ReturnType<typeof setTimeout> | null = null

    // 打开抽屉
    const handleOpen = () => {
      // 清除可能存在的旧定时器
      if (themeChangeTimer) {
        clearTimeout(themeChangeTimer)
      }
      // 延迟添加 theme-change class，避免抽屉打开动画受影响
      themeChangeTimer = setTimeout(() => {
        domOperations.setBodyClass('theme-change', true)
        themeChangeTimer = null
      }, 500)
    }

    // 关闭抽屉
    const handleClose = () => {
      // 清除未执行的定时器，防止关闭后才添加 class
      if (themeChangeTimer) {
        clearTimeout(themeChangeTimer)
        themeChangeTimer = null
      }
      // 立即移除 theme-change class
      domOperations.setBodyClass('theme-change', false)
    }

    // 打开设置
    const openSetting = () => {
      showDrawer.value = true
    }

    // 关闭设置
    const closeDrawer = () => {
      showDrawer.value = false
    }

    return {
      handleOpen,
      handleClose,
      openSetting,
      closeDrawer
    }
  }

  // Props 变化监听
  const usePropsWatcher = (props: { open?: boolean }) => {
    watch(
      () => props.open,
      (val: boolean | undefined) => {
        if (val !== undefined) {
          // 挂类 / 撤类统一由 watch(showDrawer) 负责，这里只赋值
          showDrawer.value = val
        }
      }
    )
  }

  // 初始化设置
  const useSettingsInitializer = () => {
    const themeHandlers = useThemeHandlers()
    const { openSetting } = useDrawerControl()
    const { stopWatch } = useResponsiveLayout()
    let themeCleanup: (() => void) | null = null

    const initializeSettings = () => {
      mittBus.on('openSetting', openSetting)
      themeHandlers.initSystemColor()
      themeCleanup = themeHandlers.listenerSystemTheme()
      initColorWeak()

      // 设置盒子模式
      const boxMode = settingStore.boxBorderMode ? 'border-mode' : 'shadow-mode'
      domOperations.setRootAttribute('data-box-mode', boxMode)

      themeHandlers.initSystemTheme()
      openFestival()
    }

    const cleanupSettings = () => {
      stopWatch()
      themeCleanup?.()
      cleanup()
    }

    return {
      initializeSettings,
      cleanupSettings
    }
  }

  return {
    // 状态
    showDrawer,

    // 方法组合
    useThemeHandlers,
    useResponsiveLayout,
    useDrawerControl,
    usePropsWatcher,
    useSettingsInitializer
  }
}
