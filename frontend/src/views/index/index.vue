<!-- 布局容器 -->
<template>
  <div class="app-layout">
    <!--
      手机/窄屏下侧栏是"抽屉"：由顶栏菜单按钮切换（menuOpen），
      点遮罩或切换路由后自动收起。样式在 assets/styles/custom/douyin-mobile.scss
      （原来这套移动端规则写在 ./style.scss 里，实测那份 CSS 根本没进浏览器，
       所以窄屏下侧栏宽度一直是 0 —— 手机上压根没有能打开的菜单）。
    -->
    <aside id="app-sidebar" :class="{ 'is-mobile-open': menuOpen }">
      <ArtSidebarMenu />
    </aside>

    <div
      v-show="menuOpen"
      class="mobile-sidebar-mask"
      aria-hidden="true"
      @click="closeMenu"
    />

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
