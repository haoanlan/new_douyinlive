<template>
  <div v-loading="loading" class="douyin-page p-4" element-loading-text="加载中…">
    <div class="art-card p-5">
      <div class="flex items-center gap-3 flex-wrap mb-4">
        <span class="font-bold">趋势分析</span>
        <el-radio-group v-model="range" @change="refresh">
          <el-radio-button value="7d">7天</el-radio-button>
          <el-radio-button value="30d">30天</el-radio-button>
          <el-radio-button value="90d">90天</el-radio-button>
          <el-radio-button value="all">全部</el-radio-button>
        </el-radio-group>
        <el-radio-group v-model="group" @change="refresh">
          <el-radio-button value="day">按日</el-radio-button>
          <el-radio-button value="week">按周</el-radio-button>
          <el-radio-button value="month">按月</el-radio-button>
        </el-radio-group>
      </div>

      <!--
        失败必须可见（P0-3）。原来 refresh() 的 try 没有 catch：
        请求失败时 loading.value=false 写在 nextTick 回调里，永远不会执行
        → 整页被"加载中…"蒙层**永久盖住**，用户完全无法操作也无从得知失败。
        这里既在 finally 里必定关闭蒙层，也用 alert 说明失败原因并可重试。
      -->
      <el-alert
        v-if="queryError"
        type="error"
        :closable="false"
        show-icon
        class="mb-4"
        title="趋势数据加载失败"
      >
        <div class="flex items-center gap-3 flex-wrap">
          <span class="text-xs break-all">{{ queryError }}</span>
          <el-button size="small" type="primary" plain :loading="loading" @click="refresh">
            重试
          </el-button>
        </div>
      </el-alert>

      <!-- 首次加载失败时下面三块还是空的，说明清楚，避免被读成"真的没数据" -->
      <div v-if="queryError && !hasData" class="py-10 text-center text-sm text-g-600">
        未能取到趋势数据，图表暂不可用。请重试或稍后再看。
      </div>

      <template v-else>
        <div ref="diamondRef" class="h-72"></div>
        <el-divider />
        <div ref="danmakuRef" class="h-72"></div>
        <el-divider />
        <div ref="onlineRef" class="h-72"></div>

        <!-- 空态：数据范围选得再对，也可能真的没有任何数据（P2 补齐，避免空白图） -->
        <div
          v-if="!loading && !queryError && !hasData"
          class="py-6 text-center text-sm text-g-600"
        >
          该时间范围内没有任何数据。可以换一个时间范围，或先确认房间是否已开始采集。
        </div>
      </template>
    </div>
  </div>
</template>

<script setup lang="ts">
  import { computed, nextTick, onMounted, onUnmounted, ref } from 'vue'
  import { echarts } from '@/plugins/echarts'
  import { fetchTrends, type Trends } from '@/api/douyin'
  import { apiErrorMessage } from '@/utils/douyin-error'

  defineOptions({ name: 'DouyinTrends' })

  const loading = ref(true)
  const range = ref('7d')
  const group = ref('day')
  /** 取数失败的真实原因；非空时显示错误条而不是永久蒙层（P0-3） */
  const queryError = ref('')
  const lastData = ref<Trends | null>(null)
  const diamondRef = ref<HTMLElement>()
  const danmakuRef = ref<HTMLElement>()
  const onlineRef = ref<HTMLElement>()

  /** 是否真的取到过数据（用于区分「空」与「没取到」） */
  const hasData = computed(() => {
    const t = lastData.value
    if (!t) return false
    return Boolean(t.giftTrend?.length || t.danmakuTrend?.length || t.onlineTrend?.length)
  })

  function renderLine(
    el: HTMLElement,
    xData: string[],
    series: { name: string; data: number[] }[]
  ) {
    const existing = echarts.getInstanceByDom(el)
    if (existing) existing.dispose()
    const chart = echarts.init(el)
    chart.setOption({
      tooltip: { trigger: 'axis' },
      legend: { data: series.map((s) => s.name) },
      grid: { left: 60, right: 20, top: 40, bottom: 30 },
      xAxis: { type: 'category', data: xData },
      yAxis: { type: 'value' },
      series: series.map((s) => ({
        name: s.name,
        type: 'line',
        smooth: true,
        data: s.data,
        areaStyle: { opacity: 0.15 }
      }))
    })
  }

  /**
   * 拉取并渲染趋势。
   *
   * P0-3 修复点：`loading.value = false` 原来写在 `nextTick()` 回调里，
   * 而 await fetchTrends 没有 catch —— 只要请求抛错，函数就在 await 处中断，
   * nextTick 回调永远不会注册，`loading` 永远是 true，
   * 整页被"加载中…"蒙层永久盖住（用户只能刷新浏览器）。
   * 现在用 try/catch/finally 保证蒙层一定关闭，失败转为可见的错误态。
   */
  async function refresh() {
    loading.value = true
    try {
      const t: Trends = await fetchTrends(range.value, group.value)
      lastData.value = t
      queryError.value = ''
      await nextTick()
      if (diamondRef.value) {
        renderLine(
          diamondRef.value,
          t.giftTrend.map((i) => i.date),
          [
            { name: '钻石', data: t.giftTrend.map((i) => i.total_diamonds) },
            { name: '礼物数', data: t.giftTrend.map((i) => i.gift_count) }
          ]
        )
      }
      if (danmakuRef.value) {
        renderLine(
          danmakuRef.value,
          t.danmakuTrend.map((i) => i.date),
          [{ name: '弹幕数', data: t.danmakuTrend.map((i) => i.danmaku_count) }]
        )
      }
      if (onlineRef.value) {
        renderLine(
          onlineRef.value,
          t.onlineTrend.map((i) => i.date),
          [{ name: '在线峰值', data: t.onlineTrend.map((i) => i.peak_online ?? 0) }]
        )
      }
    } catch (e) {
      queryError.value = apiErrorMessage(e, '趋势数据加载失败')
    } finally {
      loading.value = false
    }
  }

  onMounted(refresh)
  onUnmounted(() => {
    ;[diamondRef, danmakuRef, onlineRef].forEach((r) => {
      if (r.value) echarts.getInstanceByDom(r.value)?.dispose()
    })
  })
</script>
