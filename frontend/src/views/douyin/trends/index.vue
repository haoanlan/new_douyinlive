<template>
  <div v-loading="loading" class="p-4" element-loading-text="加载中…">
    <el-card shadow="never">
      <template #header>
        <div class="flex items-center gap-3 flex-wrap">
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
      </template>
      <div ref="diamondRef" class="h-72"></div>
      <el-divider />
      <div ref="danmakuRef" class="h-72"></div>
      <el-divider />
      <div ref="onlineRef" class="h-72"></div>
    </el-card>
  </div>
</template>

<script setup lang="ts">
  import { nextTick, onMounted, ref } from 'vue'
  import { echarts } from '@/plugins/echarts'
  import { fetchTrends, type Trends } from '@/api/douyin'

  defineOptions({ name: 'DouyinTrends' })

  const loading = ref(true)
  const range = ref('7d')
  const group = ref('day')
  const diamondRef = ref<HTMLElement>()
  const danmakuRef = ref<HTMLElement>()
  const onlineRef = ref<HTMLElement>()

  function renderLine(
    el: HTMLElement,
    xData: string[],
    series: { name: string; data: number[] }[]
  ) {
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

  async function refresh() {
    loading.value = true
    const t: Trends = await fetchTrends(range.value, group.value)
    nextTick(() => {
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
      loading.value = false
    })
  }

  onMounted(refresh)
</script>
