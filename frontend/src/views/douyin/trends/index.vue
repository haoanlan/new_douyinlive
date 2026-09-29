<!--
  趋势分析

  ## 这个页面的核心逻辑（重做过）

  原来它只有「时间范围」一个维度，后端 SQL 是 `WHERE create_time >= ...`，
  把**所有房间**的礼物/弹幕按日期加总 —— 那是"全站总和的日曲线"。

  为什么那样没意义：各房间的基线差几十倍（单场平均钻石从 1.9 万到 99 万），
  加总后的起伏主要反映"今天一共开了几场"，而不是任何一个直播间变好或变差。

  现在改为：**同一房间自己和自己比** —— 每个数据点是一场直播。
  · 选一个房间：看它自己的走势（这次比上次好还是差）
  · 多选几个房间：叠在同一张图对比（这才是"多房间对比"的意义）
  · X 轴默认按**场次**：同一主播一天可能播两场（如下午场 + 晚间场，
    两者峰值能差 3 倍），按日聚合会把它们压成一个点、抹掉这个差异；也可切换按日/周/月
-->
<template>
  <div class="douyin-page p-4">
    <!-- 面包屑：与其它抖音页一致 -->
    <el-breadcrumb class="mb-5" separator="/">
      <el-breadcrumb-item :to="{ path: '/douyin/dashboard' }">
        <ArtSvgIcon icon="ri:live-line" class="text-sm text-g-500" /> 抖音监控
      </el-breadcrumb-item>
      <el-breadcrumb-item>趋势分析</el-breadcrumb-item>
    </el-breadcrumb>

    <!-- 工具条：选房间 + 时间范围 + X 轴粒度 -->
    <div class="art-card dy-toolbar mb-5 flex items-center justify-between gap-4 flex-wrap">
      <div class="flex items-center gap-2 flex-wrap">
        <div class="dy-toolbar-title">趋势分析</div>
        <el-select
          v-model="selectedHosts"
          multiple
          collapse-tags
          collapse-tags-tooltip
          :multiple-limit="4"
          placeholder="选择房间（可多选对比，最多 4 个）"
          style="width: 340px"
          @change="refresh"
        >
          <el-option
            v-for="h in hosts"
            :key="h.hostId"
            :label="h.name"
            :value="h.hostId"
            :disabled="h.sessionCount === 0"
          >
            <div class="flex items-center justify-between gap-3">
              <span class="truncate">{{ h.name }}</span>
              <span class="text-xs text-g-500 shrink-0">{{ h.sessionCount }} 场</span>
            </div>
          </el-option>
        </el-select>
      </div>

      <div class="flex items-center gap-2 flex-wrap">
        <el-radio-group v-model="range" @change="refresh">
          <el-radio-button value="7d">7天</el-radio-button>
          <el-radio-button value="30d">30天</el-radio-button>
          <el-radio-button value="90d">90天</el-radio-button>
          <el-radio-button value="all">全部</el-radio-button>
        </el-radio-group>
        <el-radio-group v-model="xMode" @change="redraw">
          <el-radio-button value="session">按场次</el-radio-button>
          <el-radio-button value="day">按日</el-radio-button>
          <el-radio-button value="week">按周</el-radio-button>
          <el-radio-button value="month">按月</el-radio-button>
        </el-radio-group>
        <el-button :loading="loading" @click="refresh">
          <ArtSvgIcon icon="ri:refresh-line" class="mr-1" />刷新
        </el-button>
      </div>
    </div>

    <!--
      失败必须可见（P0-3）：不能把"取不到"显示成"没有数据"。
    -->
    <el-alert
      v-if="queryError"
      type="error"
      :closable="false"
      show-icon
      class="mb-5"
      title="趋势数据加载失败"
    >
      <div class="flex items-center gap-3 flex-wrap">
        <span class="text-xs break-all">{{ queryError }}</span>
        <el-button size="small" type="primary" plain :loading="loading" @click="refresh">
          重试
        </el-button>
      </div>
    </el-alert>

    <!-- 没选房间：明确提示，而不是给一片空白 -->
    <div v-if="!selectedHosts.length" class="art-card p-10">
      <el-empty description="请先在上方选择要分析的房间" :image-size="80">
        <div class="text-xs text-g-500">
          选一个房间看它自己的走势；多选几个可以把它们叠在同一张图上对比。
        </div>
      </el-empty>
    </div>

    <template v-else-if="hasData">
      <!--
        KPI：每个房间一张卡。
        用「平均每场」而不是「总和」—— 场次多的房间不该因为播得多就赢。
      -->
      <div class="dy-trend-kpis mb-5">
        <div v-for="s in series" :key="s.hostId" class="art-card p-4">
          <div class="flex items-center gap-2.5 mb-3">
            <el-avatar :size="32" :src="s.avatar">{{ s.name?.[0] }}</el-avatar>
            <div class="min-w-0 flex-1">
              <div class="text-sm font-medium text-g-900 truncate" :title="s.name">
                {{ s.name }}
              </div>
              <div class="text-xs text-g-500">
                {{ s.summary.sessions }} 场
                <template v-if="s.summary.sessionsWithData < s.summary.sessions">
                  · {{ s.summary.sessions - s.summary.sessionsWithData }} 场无数据
                </template>
              </div>
            </div>
          </div>
          <div class="grid grid-cols-2 gap-x-3 gap-y-2.5">
            <div v-for="k in kpiKeys" :key="k.key">
              <div class="text-xs text-g-500">{{ k.label }}</div>
              <div class="flex items-baseline gap-1.5">
                <span class="text-base font-medium text-g-900 leading-tight">
                  {{ k.fmt(s.summary[k.key as keyof HostTrendSummary] as number) }}
                </span>
                <!-- 与上一周期对比：涨跌用箭头 + 百分比，比只给一个数有用 -->
                <span
                  v-if="delta(s, k.key)"
                  class="text-xs shrink-0"
                  :class="delta(s, k.key)!.up ? 'text-success' : 'text-danger'"
                >
                  {{ delta(s, k.key)!.up ? '↑' : '↓' }}{{ delta(s, k.key)!.pct }}%
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- 指标开关：自己选要看哪些 -->
      <div class="art-card p-4 mb-5">
        <div class="flex items-center gap-2 flex-wrap">
          <span class="text-sm text-g-600 mr-1">显示指标</span>
          <el-check-tag
            v-for="m in allMetrics"
            :key="m.key"
            :checked="activeMetrics.includes(m.key)"
            @change="(v: boolean) => toggleMetric(m.key, v)"
          >
            {{ m.label }}
          </el-check-tag>
        </div>
      </div>

      <!--
        每个指标一张图。
        不做多指标叠一张：量级差太大（钻石 6 位数 vs 峰值 3 位数），
        共用一根轴会把小的那条压成贴地直线 —— 这是原来「时间线」犯过的错。

        这里用「全部渲染 + v-show 切换」而不是 v-for + 动态 :ref：
        函数式 :ref 每次渲染都会生成新闭包，会触发
        "Maximum recursive updates exceeded"（实测踩到过）。
        固定 ref 引用 + v-show 没有这个问题，图表实例也不用来回销毁重建。
      -->
      <div
        v-for="m in allMetrics"
        v-show="activeMetrics.includes(m.key)"
        :key="m.key"
        class="art-card p-5 mb-5"
      >
        <div class="flex items-center justify-between gap-3 mb-1 flex-wrap">
          <div class="flex items-center gap-2">
            <ArtSvgIcon :icon="m.icon" class="text-theme" />
            <span class="font-medium">{{ m.label }}</span>
            <span class="text-xs text-g-500">{{ m.hint }}</span>
          </div>
          <span class="text-xs text-g-500">{{ xAxisLabel }}</span>
        </div>
        <!-- ref 用静态 key，配合下面的 chartRefs 记录 -->
        <div :ref="recordChart(m.key)" class="h-72"></div>
      </div>

      <!--
        明细表：图看趋势，表看具体数字。
        同一主播一天多场时，表里能直接看到是下午场还是晚间场拖了后腿。
      -->
      <div class="art-card p-5">
        <div class="flex items-center justify-between gap-3 mb-3 flex-wrap">
          <div class="art-card-header !mb-0">
            <div class="title">
              <h4>场次明细</h4>
              <p>按开播时间排序，最近的在最上面</p>
            </div>
          </div>
          <el-radio-group v-model="detailHost" size="small">
            <el-radio-button v-for="s in series" :key="s.hostId" :value="s.hostId">
              {{ s.name }}
            </el-radio-button>
          </el-radio-group>
        </div>
        <el-table :data="detailRows" size="small" max-height="420" stripe>
          <el-table-column label="开播时间" min-width="150">
            <template #default="{ row }">
              <span class="text-xs">{{ fmtTime(row.startAt) }}</span>
              <el-tag v-if="!row.ended" size="small" type="success" class="ml-1">直播中</el-tag>
            </template>
          </el-table-column>
          <el-table-column label="峰值在线" width="100" align="right">
            <template #default="{ row }">{{ fmtNum(row.peakOnline) }}</template>
          </el-table-column>
          <el-table-column label="钻石" width="120" align="right">
            <template #default="{ row }">
              <span v-if="row.hasData">{{ fmtNum(row.diamonds) }}</span>
              <span v-else class="text-g-500" title="这一场没有采集到数据，不等于业绩为 0">—</span>
            </template>
          </el-table-column>
          <el-table-column label="弹幕" width="100" align="right">
            <template #default="{ row }">{{ fmtNum(row.danmaku) }}</template>
          </el-table-column>
          <el-table-column label="礼物数" width="100" align="right">
            <template #default="{ row }">{{ fmtNum(row.gifts) }}</template>
          </el-table-column>
          <el-table-column label="时长" width="90" align="right">
            <template #default="{ row }">{{ row.durationMinutes }}分</template>
          </el-table-column>
          <el-table-column label="钻/时" width="110" align="right">
            <template #default="{ row }">
              <span v-if="row.hasData">{{ fmtNum(row.diamondsPerHour) }}</span>
              <span v-else class="text-g-500">—</span>
            </template>
          </el-table-column>
          <el-table-column label="弹幕/千人" width="110" align="right">
            <template #default="{ row }">
              <span v-if="row.hasData">{{ fmtNum(row.danmakuPerThousand) }}</span>
              <span v-else class="text-g-500">—</span>
            </template>
          </el-table-column>
          <el-table-column label="" width="70" align="right">
            <template #default="{ row }">
              <el-button
                size="small"
                text
                type="primary"
                @click="goDetail(row.sessionId)"
              >
                详情
              </el-button>
            </template>
          </el-table-column>
        </el-table>
        <div v-if="!detailRows.length" class="py-6 text-center text-sm text-g-600">
          该时间范围内这个房间还没有场次记录。
        </div>
      </div>
    </template>

    <div v-else-if="!loading && !queryError" class="art-card p-10">
      <el-empty description="该时间范围内没有数据" :image-size="80">
        <div class="text-xs text-g-500">
          可以换一个更长的时间范围，或先确认这些房间是否已开始采集。
        </div>
      </el-empty>
    </div>
  </div>
</template>

<script setup lang="ts">
  import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
  import { useRouter } from 'vue-router'
  import { echarts } from '@/plugins/echarts'
  import {
    fetchHostTrends,
    fetchStreamers,
    type HostTrendSummary,
    type HostTrendSeries,
    type Streamer,
    type TrendMetricKey
  } from '@/api/douyin'
  import { apiErrorMessage } from '@/utils/douyin-error'
  import { fmtNum, fmtTime } from '@/utils/format'

  defineOptions({ name: 'DouyinTrends' })

  const router = useRouter()

  const loading = ref(true)
  const queryError = ref('')
  const hosts = ref<{ hostId: number; name: string; avatar: string | null; sessionCount: number }[]>([])
  const selectedHosts = ref<number[]>([])
  const series = ref<HostTrendSeries[]>([])
  const range = ref('30d')
  /** X 轴粒度：场次（默认）/ 日 / 周 / 月 */
  const xMode = ref<'session' | 'day' | 'week' | 'month'>('session')
  /** 明细表当前显示哪个房间 */
  const detailHost = ref<number | null>(null)

  const hasData = computed(() => series.value.some((s) => s.points.length > 0))

  /** KPI 卡上展示的四项（平均每场） */
  const kpiKeys = [
    { key: 'avgPeakOnline', label: '平均峰值在线', fmt: (v: number) => fmtNum(v) },
    { key: 'avgDiamonds', label: '平均钻石/场', fmt: (v: number) => fmtNum(v) },
    { key: 'avgDanmaku', label: '平均弹幕/场', fmt: (v: number) => fmtNum(v) },
    { key: 'avgDurationMinutes', label: '平均时长', fmt: (v: number) => `${v}分` }
  ]

  /** 全部可选指标 */
  const allMetrics: { key: TrendMetricKey; label: string; icon: string; hint: string }[] = [
    { key: 'peakOnline', label: '峰值在线', icon: 'ri:user-heart-line', hint: '每场最高同时在线人数' },
    { key: 'diamonds', label: '钻石', icon: 'ri:diamond-line', hint: '每场礼物收入（去重后）' },
    { key: 'danmaku', label: '弹幕', icon: 'ri:chat-3-line', hint: '每场弹幕条数' },
    { key: 'gifts', label: '礼物数', icon: 'ri:gift-2-line', hint: '每场礼物件数' },
    { key: 'users', label: '参与用户', icon: 'ri:group-line', hint: '每场发过弹幕或送礼的人数' },
    { key: 'durationMinutes', label: '时长', icon: 'ri:time-line', hint: '每场直播分钟数' },
    {
      key: 'diamondsPerHour',
      label: '钻/时',
      icon: 'ri:speed-up-line',
      hint: '每小时钻石，排除"播得久所以赚得多"'
    },
    {
      key: 'danmakuPerThousand',
      label: '弹幕/千人',
      icon: 'ri:chat-smile-2-line',
      hint: '每千名在线观众的弹幕量，衡量互动热度'
    }
  ]

  /** 默认只看这三个：监测场景最关心的就是"人多不多、赚不赚、聊不聊" */
  const activeMetrics = ref<TrendMetricKey[]>(['peakOnline', 'diamonds', 'danmaku'])

  /**
   * 切换指标显示。
   *
   * 注意：`el-check-tag` 的 change 事件传出的是**新值**（它内部已经做了 `!checked`），
   * 所以这里必须用传进来的 `next`，不能再按当前状态取反一次 ——
   * 两个反相会互相抵消，表现就是"点了没反应"（实测踩到过）。
   */
  function toggleMetric(key: TrendMetricKey, next: boolean) {
    const i = activeMetrics.value.indexOf(key)
    if (next) {
      if (i < 0) activeMetrics.value.push(key)
    } else {
      // 至少留一个，否则页面会空掉
      if (activeMetrics.value.length === 1) return
      if (i >= 0) activeMetrics.value.splice(i, 1)
    }
  }

  /**
   * 指标 → 图表容器 DOM 的映射。
   *
   * 故意用普通对象（不是 ref）：它只在渲染后被写入、在 redraw 里被读取，
   * 不参与响应式。放进响应式里会在写它的同时触发重渲染，正是
   * "Maximum recursive updates exceeded" 的成因之一。
   */
  const chartEls: Record<string, HTMLElement> = {}
  function recordChart(key: string) {
    return (el: unknown) => {
      if (el instanceof HTMLElement) chartEls[key] = el
    }
  }

  /** 与上一周期比：只在有 prevSummary 时给 */
  function delta(s: HostTrendSeries, key: string) {
    const prev = s.prevSummary as Record<string, number> | null
    if (!prev) return null
    const cur = s.summary[key as keyof HostTrendSummary] as number
    const old = prev[key]
    if (!old || old <= 0 || cur === undefined) return null
    const pct = Math.round(((cur - old) / old) * 100)
    if (!Number.isFinite(pct) || pct === 0) return null
    return { up: pct > 0, pct: Math.abs(pct) }
  }

  /**
   * 按 X 轴粒度把「每场」的点聚合。
   * 按场次时原样返回；按日/周/月时同一区间的场次取**平均**（不是求和）——
   * 求和会让"播得多的那天"看起来更好，而我们要看的是"每场表现"。
   */
  function bucketKey(startAt: string): string {
    const d = new Date(String(startAt).replace(' ', 'T'))
    if (Number.isNaN(d.getTime())) return String(startAt).slice(0, 10)
    const y = d.getFullYear()
    const m = String(d.getMonth() + 1).padStart(2, '0')
    const day = String(d.getDate()).padStart(2, '0')
    if (xMode.value === 'day') return `${y}-${m}-${day}`
    if (xMode.value === 'month') return `${y}-${m}`
    // 周：以周一为界
    const wd = d.getDay()
    const diff = wd === 0 ? 6 : wd - 1
    const mon = new Date(d)
    mon.setDate(d.getDate() - diff)
    return `${mon.getFullYear()}-${String(mon.getMonth() + 1).padStart(2, '0')}-${String(mon.getDate()).padStart(2, '0')}`
  }

  const xAxisLabel = computed(() => {
    const map: Record<string, string> = {
      session: 'X 轴：每场直播',
      day: 'X 轴：按日（当天多场取平均）',
      week: 'X 轴：按周（当周多场取平均）',
      month: 'X 轴：按月（当月多场取平均）'
    }
    return map[xMode.value]
  })

  interface Bucket {
    label: string
    keys: TrendMetricKey[]
    /** 每个指标的累加值 + 场次数，最后取平均 */
    acc: Record<string, number>
    count: number
    sessions: number[]
  }

  /** 把一个序列转成 X 轴标签 + 各指标的数值数组 */
  function toAxis(s: HostTrendSeries, metricKeys: TrendMetricKey[]) {
    if (xMode.value === 'session') {
      return {
        labels: s.points.map((p) => fmtTime(p.startAt)),
        values: metricKeys.map((k) => s.points.map((p) => (p[k] as number) ?? 0)),
        points: s.points
      }
    }
    const order: string[] = []
    const map = new Map<string, Bucket>()
    for (const p of s.points) {
      const k = bucketKey(p.startAt)
      if (!map.has(k)) {
        map.set(k, { label: k, keys: metricKeys, acc: {}, count: 0, sessions: [] })
        order.push(k)
      }
      const b = map.get(k)!
      for (const mk of metricKeys) b.acc[mk] = (b.acc[mk] || 0) + ((p[mk] as number) ?? 0)
      b.count += 1
      b.sessions.push(p.sessionId)
    }
    const buckets = order.map((k) => map.get(k)!).sort((a, b) => a.label.localeCompare(b.label))
    return {
      labels: buckets.map((b) => b.label),
      values: metricKeys.map((mk) => buckets.map((b) => Math.round((b.acc[mk] || 0) / b.count))),
      points: buckets.flatMap((b) => b.sessions)
    }
  }

  /** 等一帧，让 v-show 的 display 变更真正生效（浏览器需要一次样式计算） */
  function nextFrame() {
    return new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
  }

  /**
   * 等某个图表的容器变成可见且有尺寸。
   *
   * 为什么不能只用 `await nextTick()`：在 `flush: 'post'` 的 watcher 里，
   * nextTick 会**立即** resolve，而此时 v-show 改的 display 还没被浏览器计算，
   * clientWidth 依旧是 0（实测刚勾选的容器是 `0x0`）——
   * 于是被"尺寸为 0 就跳过"的守卫拦掉，图永远画不出来。
   * 这里显式轮询到可见为止，最多等 ~500ms。
   */
  async function waitVisible(el: HTMLElement, tries = 25): Promise<boolean> {
    for (let i = 0; i < tries; i++) {
      if (el.clientWidth > 0 && el.clientHeight > 0) return true
      await nextFrame()
    }
    return el.clientWidth > 0 && el.clientHeight > 0
  }

  /** 渲染/重绘所有指标图 */
  async function redraw() {
    await nextTick()
    for (const m of allMetrics) {
      if (!activeMetrics.value.includes(m.key)) continue
      const el = chartEls[m.key]
      if (!el) continue
      // 等容器真正显示出来（见 waitVisible 的说明）
      if (!(await waitVisible(el))) continue
      const existing = echarts.getInstanceByDom(el)
      if (existing) existing.dispose()
      if (!series.value.length) continue
      const chart = echarts.init(el)

      // 用第一个序列的 X 轴（按场次时各房间场次不同，无法对齐 —— 这是"按场次"的固有限制，
      // 所以多房间对比时提示用日期粒度）
      const aligned = xMode.value !== 'session'
      const first = toAxis(series.value[0], [m.key])
      const labels = first.labels

      const option: Record<string, unknown> = {
        tooltip: {
          trigger: 'axis',
          valueFormatter: (v: number) => fmtNum(v)
        },
        legend: { data: series.value.map((s) => s.name), type: 'scroll' },
        grid: { left: 64, right: 24, top: 44, bottom: 56 },
        xAxis: {
          type: 'category',
          data: labels,
          axisLabel: { rotate: labels.length > 8 ? 35 : 0, fontSize: 11 }
        },
        yAxis: { type: 'value', axisLabel: { formatter: (v: number) => fmtNum(v) } },
        series: series.value.map((s) => {
          const ax = toAxis(s, [m.key])
          return {
            name: s.name,
            type: 'line',
            smooth: true,
            symbolSize: 6,
            connectNulls: true,
            data: ax.values[0],
            areaStyle: series.value.length === 1 ? { opacity: 0.12 } : undefined
          }
        })
      }
      chart.setOption(option)
      // 多房间时 X 轴按场次无法对齐，给出说明而不是画错
      if (!aligned && series.value.length > 1) {
        chart.setOption({
          graphic: [
            {
              type: 'text',
              right: 12,
              top: 8,
              style: {
                text: '多房间对比建议切到"按日"，各房间场次数不同无法按场次对齐',
                fontSize: 11,
                fill: '#8a94a6'
              }
            }
          ]
        })
      }
    }
  }

  function disposeCharts() {
    chartEls.forEach((el) => echarts.getInstanceByDom(el)?.dispose())
  }

  async function loadHosts() {
    try {
      /**
       * 用 /api/streamers：它返回 `{ id, name, avatar, session_count, sec_uid }`，
       * 其中 `id` 就是趋势接口要的 streamer 主键，`session_count` 可直接用来排序。
       *
       * 注意别用 /api/streamers 里的 `sec_uid` 当 id —— 那是真的抖音 sec_uid（字符串），
       * 不是主键。另外 /api/rooms 只包含"已监控"的房间，会漏掉部分主播，
       * 所以这里用 streamers 全量。
       */
      const list = await fetchStreamers()
      hosts.value = list
        .map((h) => ({
          hostId: Number(h.id),
          name: h.name,
          avatar: h.avatar_url ?? null,
          sessionCount: h.session_count ?? 0
        }))
        .filter((h) => Number.isFinite(h.hostId))
      // 默认选场次最多的那个房间，省一步操作
      if (!selectedHosts.value.length) {
        const best = [...hosts.value].sort((a, b) => b.sessionCount - a.sessionCount)[0]
        if (best && best.sessionCount > 0) selectedHosts.value = [best.hostId]
      }
    } catch (e) {
      queryError.value = apiErrorMessage(e, '房间列表加载失败')
    }
  }

  async function refresh() {
    if (!selectedHosts.value.length) {
      series.value = []
      loading.value = false
      return
    }
    loading.value = true
    try {
      const data = await fetchHostTrends(selectedHosts.value, range.value)
      series.value = data.series || []
      queryError.value = ''
      if (!detailHost.value || !series.value.some((s) => s.hostId === detailHost.value)) {
        detailHost.value = series.value[0]?.hostId ?? null
      }
      await redraw()
    } catch (e) {
      queryError.value = apiErrorMessage(e, '趋势数据加载失败')
    } finally {
      loading.value = false
    }
  }

  /** 明细表数据：当前选中房间的场次，最近的在最上面 */
  const detailRows = computed(() => {
    const s = series.value.find((x) => x.hostId === detailHost.value)
    if (!s) return []
    return [...s.points].reverse()
  })

  function goDetail(sessionId: number) {
    router.push(`/douyin/detail/${sessionId}`)
  }

  // 指标开关变化时只重绘，不用重新请求。
  // flush: 'post' → 回调在 DOM 更新**之后**执行，这样刚勾上的图表容器已经显示、
  // 拿得到真实尺寸（默认 'pre' 会在 DOM 更新前跑，容器还是 display:none）。
  watch(activeMetrics, () => redraw(), { deep: true, flush: 'post' })

  onMounted(async () => {
    await loadHosts()
    await refresh()
  })

  onUnmounted(disposeCharts)
</script>
