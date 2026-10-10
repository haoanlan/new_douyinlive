<!-- 布局内容 -->
<template>
  <div class="layout-content" :class="{ 'overflow-auto': isFullPage }" :style="containerStyle">
    <div id="app-content-header">
      <!-- 节日滚动 -->
      <ArtFestivalTextScroll v-if="!isFullPage" />

      <!-- 路由信息调试 -->
      <div
        v-if="isOpenRouteInfo === 'true'"
        class="px-2 py-1.5 mb-3 text-sm text-g-500 bg-g-200 border-full-d rounded-md"
      >
        router meta：{{ route.meta }}
      </div>
    </div>

    <RouterView v-if="isRefresh" v-slot="{ Component, route }" :style="contentStyle">
      <!--
        单一个 Transition + KeepAlive（原来拆成"缓存页/非缓存页"两个 Transition）。
        拆开的问题：两个 Transition 各自独立，**跨越两者的切换无法协调**；
        而且返回一个缓存页时（详情 → 场次列表），KeepAlive 复用同一个 DOM 节点，
        enter-from 的添加与移除落在同一帧，浏览器没机会绘制中间态 → 动画整段被跳过，
        观感就是"啪"地硬切（用户指出的正是这一跳）。

        现在：
        - Transition 包 KeepAlive（Vue 官方推荐结构），进出都由同一实例管；
        - **:css="false" + JS 钩子（Web Animations API）**：
          CSS 类名版有两个坑 ——（1）返回缓存页时 KeepAlive 复用同一 DOM 节点，
          "插入"与"移除 enter-from"同帧发生，浏览器没有中间态可绘制；
          （2）改用 @keyframes 后 Vue 判定不到时长，会立刻摘掉 active 类，动画被截断
          （实测进场 20ms 就到位）。交给浏览器排期最稳：元素一进 DOM 就必定从头播。
        - 不加 mode="out-in"：交叉淡入更连续（离开页在钩子里设为绝对定位，不参与布局）；
        - 缓存白名单用 :include（按路由 meta.keepAlive 生成）——
          原来靠 v-if 分流来区分缓存，合并后必须显式告诉 KeepAlive 只缓存这些页面，
          否则搜索/详情/画像也会被缓存（筛选条件、场次 id 全留在内存里）。
      -->
      <Transition
        :css="false"
        :name="showTransitionMask ? '' : actualTransition"
        @enter="onPageEnter"
        @leave="onPageLeave"
        @leave-cancelled="onPageLeaveCancelled"
      >
        <KeepAlive :max="10" :include="keepAliveInclude" :exclude="keepAliveExclude">
          <component class="art-page-view" :is="Component" :key="route.path" />
        </KeepAlive>
      </Transition>
    </RouterView>

    <!-- 全屏页面切换过渡遮罩（用于提升页面切换视觉体验） -->
    <Teleport to="body">
      <div
        v-show="showTransitionMask"
        class="fixed top-0 left-0 z-[2000] w-screen h-screen pointer-events-none bg-box"
      />
    </Teleport>
  </div>
</template>
<script setup lang="ts">
  import type { CSSProperties } from 'vue'
  import { useRoute } from 'vue-router'
  import { useAutoLayoutHeight } from '@/hooks/core/useLayoutHeight'
  import { useSettingStore } from '@/store/modules/setting'
  import { useWorktabStore } from '@/store/modules/worktab'

  defineOptions({ name: 'ArtPageContent' })

  const route = useRoute()
  const router = useRouter()
  const { containerMinHeight } = useAutoLayoutHeight()
  const { pageTransition, containerWidth, refresh } = storeToRefs(useSettingStore())
  const { keepAliveExclude } = storeToRefs(useWorktabStore())

  /**
   * KeepAlive 的缓存白名单：只缓存路由 meta.keepAlive 为真的页面。
   *
   * 合并成一个 Transition 之后，所有页面都会流经同一个 KeepAlive，
   * 所以要显式用 include 圈定范围（原来靠模板里的 v-if 分流）。
   * 组件名与路由 name 一一对应（各页 defineOptions({ name }) 都对齐过）。
   */
  const keepAliveInclude = computed(() =>
    router
      .getRoutes()
      .filter((r) => r.meta?.keepAlive && r.name)
      .map((r) => String(r.name))
  )

  const isRefresh = shallowRef(true)
  const isOpenRouteInfo = import.meta.env.VITE_OPEN_ROUTE_INFO
  const showTransitionMask = ref(false)

  // 标记是否是首次加载（浏览器刷新）
  const isFirstLoad = ref(true)

  // 检查当前路由是否需要使用无基础布局模式
  const isFullPage = computed(() => route.matched.some((r) => r.meta?.isFullPage))
  const prevIsFullPage = ref(isFullPage.value)

  // 切换动画名称：首次加载、从全屏返回时不使用动画
  const actualTransition = computed(() => {
    if (isFirstLoad.value) return ''
    if (prevIsFullPage.value && !isFullPage.value) return ''
    return pageTransition.value
  })

  // 监听全屏状态变化，显示过渡遮罩
  watch(isFullPage, (val, oldVal) => {
    if (val !== oldVal) {
      showTransitionMask.value = true
      // 延迟隐藏遮罩，给足时间让页面完成切换
      setTimeout(() => {
        showTransitionMask.value = false
      }, 50)
    }

    nextTick(() => {
      prevIsFullPage.value = val
    })
  })

  const containerStyle = computed(
    (): CSSProperties =>
      isFullPage.value
        ? {
            position: 'fixed',
            top: 0,
            left: 0,
            width: '100%',
            height: '100vh',
            zIndex: 2500,
            background: 'var(--default-bg-color)'
          }
        : {
            maxWidth: containerWidth.value
          }
  )

  const contentStyle = computed(
    (): CSSProperties => ({
      minHeight: containerMinHeight.value
    })
  )

  const reload = () => {
    isRefresh.value = false
    nextTick(() => {
      isRefresh.value = true
    })
  }

  /* ===== 页面进出动画（Web Animations API） =====
   *
   * 为什么要走 JS 钩子而不是 CSS 类名，见模板里的注释（缓存页复用节点时
   * CSS 版动画会被跳过或被 Vue 提前截断）。
   *
   * 时长取值的依据（实测）：
   *   退场那一段在"离开缓存页"时会被 KeepAlive 移动节点而提前结束（实测 ~40–70ms），
   *   所以**主要观感交给进场**：240ms 从下 10px 淡入，配 cubic-bezier(0.4,0,0.2,1)
   *   （比 0.23,1,0.32,1 均衡，不会 20ms 就冲到 0.97），读起来是"新页缓缓就位"；
   *   退场只作收尾：120ms 向上 4px 淡出。
   */
  const PAGE_IN_MS = 240
  const PAGE_IN_EASE = 'cubic-bezier(0.4, 0, 0.2, 1)'
  const PAGE_OUT_MS = 120
  const PAGE_OUT_EASE = 'cubic-bezier(0.4, 0, 1, 1)'
  const PAGE_IN_SHIFT = 10

  const reduceMotion = () =>
    typeof window !== 'undefined' &&
    window.matchMedia &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches

  /** 离开页脱离文档流：交叉淡入时两页同时存在，否则滚动高度翻倍、滚动条会跳 */
  const detachForLeave = (el: HTMLElement) => {
    el.style.position = 'absolute'
    el.style.top = '0'
    el.style.right = '0'
    el.style.left = '0'
  }
  const reattach = (el: HTMLElement) => {
    el.style.position = ''
    el.style.top = ''
    el.style.right = ''
    el.style.left = ''
  }

  const onPageEnter = (el: Element, done: () => void) => {
    const node = el as HTMLElement
    reattach(node)
    if (!actualTransition.value || reduceMotion()) return done()
    const anim = node.animate(
      [
        { opacity: 0, transform: `translate3d(0, ${PAGE_IN_SHIFT}px, 0)` },
        { opacity: 1, transform: 'none' }
      ],
      { duration: PAGE_IN_MS, easing: PAGE_IN_EASE, fill: 'both' }
    )
    /*
     * 播完必须 cancel()，不能只靠 fill: 'both' 留在最后状态。
     * fill 会让动画效果持续生效，getComputedStyle 的 transform 也就一直是
     * matrix(1,0,0,1,0,0)（非 none）—— 页面根节点因此成为 **position: fixed 的包含块**，
     * 而 el-dialog / el-drawer 默认不 teleport 到 body，它们的 .el-overlay 就在这棵子树里：
     * 实测弹窗被摆到页面内部（27,1365，本该视口居中）、遮罩变成页面大小 360×2766、
     * 打开时还会闪。cancel() 之后动画效果消失，transform 回到 none。
     */
    anim.finished.then(
      () => {
        anim.cancel()
        done()
      },
      () => {
        anim.cancel()
        done()
      }
    )
  }

  const onPageLeave = (el: Element, done: () => void) => {
    const node = el as HTMLElement
    detachForLeave(node)
    if (!actualTransition.value || reduceMotion()) {
      reattach(node)
      return done()
    }
    const anim = node.animate(
      [
        { opacity: 1, transform: 'none' },
        { opacity: 0, transform: 'translate3d(0, -4px, 0)' }
      ],
      { duration: PAGE_OUT_MS, easing: PAGE_OUT_EASE, fill: 'both' }
    )
    const finish = () => {
      // 同 onPageEnter：播完取消动画效果，别把 transform 留在页面上
      anim.cancel()
      reattach(node)
      done()
    }
    anim.finished.then(finish, finish)
  }

  const onPageLeaveCancelled = (el: Element) => {
    reattach(el as HTMLElement)
  }

  watch(refresh, reload, { flush: 'post' })

  // 组件挂载后标记首次加载完成
  onMounted(() => {
    // 延迟一帧，确保首次渲染完成
    nextTick(() => {
      isFirstLoad.value = false
    })
  })
</script>
