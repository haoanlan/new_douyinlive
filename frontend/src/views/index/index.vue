<!-- 布局容器 -->
<template>
  <div class="app-layout">
    <!--
      手机/窄屏下侧栏是"抽屉"：由顶栏菜单按钮切换（menuOpen），切换路由后自动收起。
      样式在 assets/styles/custom/douyin-mobile.scss。
      注意：这里**没有遮罩层** —— 模板原本就没有，我加过一版（为了"点空白处收起"），
      结果它带来一串问题：压在抽屉之上吃掉菜单点击、灰色蒙层被当成"故障"，
      所以整块删掉。收起抽屉只靠两个可靠途径：
        1) 顶栏菜单按钮（menuOpen 取反）
        2) 点了菜单项 → 路由变化 → 下面的 watch 自动收起
    -->
    <aside id="app-sidebar" :class="{ 'is-mobile-open': menuOpen }">
      <ArtSidebarMenu />
    </aside>

    <main id="app-main">
      <div id="app-header">
        <ArtHeaderBar />
      </div>
      <div id="app-content">
        <ArtPageContent />
      </div>
    </main>

    <div id="app-global">
      <ArtGlobalComponent />
    </div>
  </div>
</template>

<script setup lang="ts">
  import { storeToRefs } from 'pinia'
  import { useSettingStore } from '@/store/modules/setting'

  defineOptions({ name: 'AppLayout' })

  const route = useRoute()
  const settingStore = useSettingStore()
  const { menuOpen } = storeToRefs(settingStore)

  /**
   * 是否窄屏（抽屉模式）。
   * 关键：桌面端 menuOpen 表示"侧栏展开/收起"，绝不能被下面的收尾逻辑改掉
   * （否则每次导航侧栏都会自己收起来 —— 这是加抽屉时差点引入的回归）。
   */
  const isNarrowScreen = (): boolean =>
    typeof window !== 'undefined' && window.matchMedia('(max-width: 800px)').matches

  const closeMenu = (): void => {
    if (isNarrowScreen() && menuOpen.value) settingStore.setMenuOpen(false)
  }

  // 手机上点了菜单项就收起抽屉（否则抽屉会一直盖在新页面上）
  watch(() => route.fullPath, closeMenu)
</script>

<style lang="scss" scoped>
  @use './style';
</style>
