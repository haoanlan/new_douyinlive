<!--
  查询失败状态（DESIGN-REVIEW P0-3 的统一解法）

  产品原则 3「失败绝不伪装成空或正常」：监控工具最不可接受的失败模式，
  是让人以为一切正常。因此任何「取数据失败」都必须与「真的没有数据」
  在视觉上明确区分开，并给出重试入口。

  用法：
    <QueryErrorState
      v-if="queryError"
      :message="queryError"
      :retrying="loading"
      @retry="refresh"
    />
-->
<template>
  <div class="art-card px-5 py-8">
    <div class="flex flex-col items-center text-center">
      <div class="size-11 rounded-full flex-cc bg-danger/10 mb-3">
        <ArtSvgIcon icon="ri:error-warning-line" class="text-xl text-danger" />
      </div>
      <div class="text-sm font-medium text-g-900">数据加载失败</div>
      <p class="mt-1.5 text-xs text-g-600 max-w-[46ch] leading-relaxed break-words">
        {{ message || '请求失败，未能取到数据。' }}
      </p>
      <p class="mt-1 text-xs text-g-600">
        页面显示的<b>不是</b>「没有数据」，而是这一次没能取到数据。
      </p>
      <el-button class="mt-4" type="primary" plain :loading="retrying" @click="$emit('retry')">
        <ArtSvgIcon icon="ri:refresh-line" class="mr-1" />
        重试
      </el-button>
    </div>
  </div>
</template>

<script setup lang="ts">
  defineOptions({ name: 'QueryErrorState' })

  defineProps<{
    /** 失败原因（后端返回的真实原因优先） */
    message?: string
    /** 重试请求进行中 */
    retrying?: boolean
  }>()

  defineEmits<{ retry: [] }>()
</script>
