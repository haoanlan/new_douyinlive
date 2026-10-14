<!-- 系统 logo（抖音直播监控：圆角方块 + 抖音配色的音符标记。纯本地 SVG，不依赖外部图标 CDN） -->
<template>
  <div class="flex-cc">
    <img :style="logoStyle" src="@imgs/common/logo.svg" alt="抖音直播监控" class="w-full h-full" />
  </div>
</template>

<script setup lang="ts">
  defineOptions({ name: 'ArtLogo' })

  interface Props {
    /** logo 大小 */
    size?: number | string
  }

  const props = withDefaults(defineProps<Props>(), {
    size: 36
  })

  const logoStyle = computed(() => ({ width: `${props.size}px` }))
</script>
