<!-- 一个让 SVG 图片跟随主题的组件，只对特定 svg 图片生效，不建议开发者使用 -->
<!-- 图片地址 https://iconpark.oceanengine.com/illustrations/13 -->
<template>
  <div class="theme-svg" :style="sizeStyle">
    <div v-if="src" class="svg-container" v-html="svgContent"></div>
  </div>
</template>

<script setup lang="ts">
  import { ref, computed, watchEffect, onMounted, onUnmounted } from 'vue'

  interface Props {
    size?: string | number
    themeColor?: string
    src?: string
  }

  const props = withDefaults(defineProps<Props>(), {
    size: 500,
    themeColor: 'var(--el-color-primary)'
  })

  const svgContent = ref('')

  // 计算样式
  const sizeStyle = computed(() => {
    const sizeValue = typeof props.size === 'number' ? `${props.size}px` : props.size
    return {
      width: sizeValue,
      height: sizeValue
    }
  })

  /*
   * 颜色映射配置。
   *
   * `#071F4D` 是插图里的深海军蓝块：浅色下映射到 primary-dark-2 正好；
   * 但深色主题的 --art-color 是纯黑，primary-dark-2 铺在黑底上只有约 2.4:1，
   * 这块图形几乎融进背景（审计 P2-11）。所以深色下改用亮档，保持图形可辨。
   */
  const colorMappings = computed<Record<string, string>>(() => ({
    '#C7DEFF': 'var(--el-color-primary-light-6)',
    '#071F4D': isDark.value
      ? 'var(--el-color-primary-light-3)'
      : 'var(--el-color-primary-dark-2)',
    '#00E4E5': 'var(--el-color-primary-light-1)',
    '#006EFF': 'var(--el-color-primary)',
    '#fff': 'var(--default-box-color)',
    '#ffffff': 'var(--default-box-color)',
    '#DEEBFC': 'var(--el-color-primary-light-7)'
  }))

  /** 跟随 html.dark（主题切换时由主题逻辑加/去这个类） */
  const isDark = ref(false)
  const syncDark = () => {
    isDark.value = document.documentElement.classList.contains('dark')
  }

  // 将主题色应用到 SVG 内容
  const applyThemeToSvg = (content: string): string => {
    return Object.entries(colorMappings.value).reduce(
      (processedContent, [originalColor, themeColor]) => {
        const fillRegex = new RegExp(`fill="${originalColor}"`, 'gi')
        const strokeRegex = new RegExp(`stroke="${originalColor}"`, 'gi')

        return processedContent
          .replace(fillRegex, `fill="${themeColor}"`)
          .replace(strokeRegex, `stroke="${themeColor}"`)
      },
      content
    )
  }

  // 加载 SVG 文件内容
  const loadSvgContent = async () => {
    if (!props.src) {
      svgContent.value = ''
      return
    }

    try {
      const response = await fetch(props.src)
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`)
      }

      const content = await response.text()
      svgContent.value = applyThemeToSvg(content)
    } catch (error) {
      console.error('Failed to load SVG:', error)
      svgContent.value = ''
    }
  }

  watchEffect(() => {
    loadSvgContent()
  })

  // 主题切换只给 html 加/去 .dark，这里跟着同步，插图颜色才会即时更新
  let darkObserver: MutationObserver | undefined
  onMounted(() => {
    syncDark()
    darkObserver = new MutationObserver(syncDark)
    darkObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] })
  })
  onUnmounted(() => darkObserver?.disconnect())
</script>

<style lang="scss" scoped>
  .theme-svg {
    display: inline-block;

    .svg-container {
      width: 100%;
      height: 100%;

      :deep(svg) {
        width: 100%;
        height: 100%;
      }
    }
  }
</style>
