<!--
  状态监控 —— 版式对齐 Art Design Pro X「监控 / 缓存监控」（frontend.artd.pro/#/monitor/cache）：

    1. Hero 头卡：h1 + 说明 + 右侧操作（状态标签 / 自动刷新 / 刷新状态 / 重启全部服务），
       卡内嵌 4 个 kv 小卡（运行模式 / 监控脚本 / 监控房间 / 最近检查）
    2. 四张指标 tile：标题 + 图标块 + 大数字 + 进度条 + 底部小标签/状态词
    3. 两栏 1.38fr / 360px：左「服务明细」（kv grid + 服务行列表带操作按钮），
       右「连接健康」（进度条）+「异常提醒」（dashed 空态）
    4. 整宽「运行日志」（折叠）

  约定（改动前请先读）：
    - 状态取不到（statusError）时一律显示「状态未知」并禁用操作，不能用红色「未运行」
      冒充结论 —— 那会让人误判成服务挂了。
    - 重启类操作走 confirmDangerous 二次确认，且文案里写明影响面。
-->
<template>
  <div class="douyin-page p-4 flex flex-col gap-4">
    <!-- 状态取不到：明确说明，而不是把下面渲染成红色「未运行」 -->
    <el-alert
      v-if="statusError"
      type="error"
      :closable="false"
      show-icon
      :title="
        status
          ? '状态刷新失败，下方显示的是上一次成功获取的状态'
          : '状态检测失败，暂时无法判断服务是否正常'
      "
    >
      <div class="flex items-center gap-3 flex-wrap">
        <span class="text-xs break-all">{{ statusError }}</span>
        <el-button size="small" type="primary" plain :loading="loading" @click="refresh">
          重试
        </el-button>
      </div>
    </el-alert>

    <!-- ① Hero 头卡 -->
    <section class="art-card p-5">
      <div class="flex flex-wrap items-start justify-between gap-4">
        <div class="min-w-0 flex-1">
          <h1 class="text-[20px] font-semibold tracking-tight text-g-900 m-0">状态监控</h1>
          <p class="mt-2 text-sm leading-7 text-g-600 max-w-2xl">
            聚合 Go 抓取代理、监控脚本与各房间 WebSocket
            连接的健康状态，用于快速判断当前是否在正常采集。
          </p>
        </div>
        <div class="flex flex-wrap items-center gap-3">
          <span class="mon-chip" :class="overall.chipClass">
            <ArtSvgIcon :icon="overall.icon" class="text-xs" />
            {{ overall.chip }}
          </span>
          <span class="dy-switch-btn">
            <span class="dy-switch-btn__label">自动刷新</span>
            <el-switch v-model="autoRefresh" />
          </span>
          <el-button :loading="loading" @click="refresh">
            <ArtSvgIcon icon="ri:refresh-line" class="mr-1" />
            刷新状态
          </el-button>
          <el-button
            type="primary"
            :loading="busy === 'restart'"
            :disabled="Boolean(statusError) && !status"
            @click="handleRestart"
          >
            <ArtSvgIcon icon="ri:restart-line" class="mr-1" />
            重启全部服务
          </el-button>
        </div>
      </div>

      <!-- hero 内嵌 kv 小卡 -->
      <div class="grid grid-cols-2 md:grid-cols-4 gap-3 mt-5">
        <div v-for="f in heroKv" :key="f.label" class="mon-kv">
          <div class="mon-kv__label">{{ f.label }}</div>
          <div class="mon-kv__value" :class="f.tone || 'text-g-900'">{{ f.value }}</div>
        </div>
      </div>
    </section>

    <!-- ② 四张指标 tile（无进度条：每张只放一组互不重复的事实） -->
    <section class="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
      <article v-for="m in tiles" :key="m.label" class="art-card p-5">
        <div class="flex items-start justify-between gap-3">
          <div class="min-w-0">
            <div class="text-sm font-medium text-g-600">{{ m.label }}</div>
            <ArtCountTo
              v-if="m.count !== null"
              class="mt-3 block truncate text-3xl font-semibold leading-none text-g-900"
              :target="m.count"
              :duration="1200"
              :suffix="m.suffix"
            />
            <div
              v-else
              class="mt-3 truncate text-3xl font-semibold leading-none"
              :class="m.textTone || 'text-g-900'"
            >
              {{ m.text }}
            </div>
          </div>
          <div class="size-9 rounded-lg flex-cc bg-theme/10 shrink-0">
            <ArtSvgIcon :icon="m.icon" class="text-base text-theme" />
          </div>
        </div>
        <div
          class="mt-4 flex items-center justify-between gap-3 border-t border-g-100 pt-3 text-xs"
        >
          <span class="text-g-500 shrink-0">{{ m.footLabel }}</span>
          <span class="truncate font-medium" :class="m.footTone || 'text-g-700'">
            {{ m.footValue }}
          </span>
        </div>
      </article>
    </section>

    <!-- ③ 两栏：服务明细 / 连接健康 + 异常提醒 -->
    <section class="grid grid-cols-1 xl:grid-cols-[minmax(0,1.38fr)_minmax(360px,0.8fr)] gap-4">
      <!-- 左：服务明细 -->
      <article class="art-card p-5">
        <div class="flex flex-wrap items-start justify-between gap-4">
          <div class="min-w-0">
            <h3 class="text-lg font-semibold text-g-900 m-0">服务明细</h3>
            <p class="mt-1 text-sm leading-6 text-g-600">每项可单独重启，互不影响。</p>
          </div>
          <!-- 这里原来还有一个和 Hero 右上完全相同的状态 chip，同一结论并排出现两次 -->
        </div>

        <!-- 服务事实 kv：4 格用两列排（三列时第 4 格会单独占一行，看着像漏了一个） -->
        <div class="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div v-for="f in serviceKv" :key="f.label" class="mon-kv">
            <div class="mon-kv__label">{{ f.label }}</div>
            <div class="mon-kv__value text-g-900" :title="f.value">{{ f.value }}</div>
          </div>
        </div>

        <!-- 服务行（保留逐项重启） -->
        <div class="mt-5" v-loading="loading && !status" element-loading-text="检测中…">
          <div
            v-for="(item, i) in items"
            :key="item.key"
            class="mon-service"
            :class="i ? 'border-t border-g-100' : ''"
          >
            <ArtSvgIcon :icon="item.icon" class="text-base shrink-0" :class="item.iconTone" />
            <div class="min-w-0 flex-1">
              <div class="flex items-center gap-2">
                <span class="text-sm font-medium text-g-900">{{ item.name }}</span>
                <span class="mon-dot" :class="item.dotClass" />
                <span class="text-xs font-medium" :class="item.tone">{{ item.stateText }}</span>
              </div>
              <div class="text-xs text-g-500 mt-1 truncate" :title="item.detail">
                {{ item.detail }}
              </div>
            </div>
            <el-button
              size="small"
              plain
              class="shrink-0"
              :loading="busy === item.action.act"
              :disabled="!statusKnown"
              @click="actWithConfirm(item.action.act)"
            >
              <ArtSvgIcon :icon="item.action.icon" class="mr-1" />
              {{ item.action.text }}
            </el-button>
          </div>
        </div>
      </article>

      <!-- 右：房间连接（每房间一行）+ 异常提醒 -->
      <article class="art-card p-5">
        <h3 class="text-lg font-semibold text-g-900 m-0">房间连接</h3>
        <p class="mt-1 text-sm leading-6 text-g-600">
          每个监控房间的 WebSocket 与直播状态。
        </p>

        <!--
          这里原来还有一行小结「已连接 5 / 5 · 直播中 0 · 录制中 0」——
          那三个数正是上面三张 tile 的数字，属于同一个数出现两次，去掉。
          每行房间自己的状态已经在下面列着了，聚合数看 tile。
        -->
        <p v-if="roomSourceNote" class="mt-4 text-xs leading-5 text-warning">
          {{ roomSourceNote }}
        </p>

        <div
          v-if="roomRows.length"
          class="flex flex-col mt-3 max-h-[260px] overflow-y-auto dy-scroll pr-1"
        >
          <div
            v-for="(r, i) in roomRows"
            :key="r.key"
            class="mon-room"
            :class="i ? 'border-t border-g-100' : ''"
          >
            <span class="mon-dot" :class="r.dotClass" />
            <div class="min-w-0 flex-1">
              <div class="flex items-center gap-2 min-w-0">
                <span class="text-sm font-medium text-g-900 truncate" :title="r.name">
                  {{ r.name }}
                </span>
                <span class="text-xs font-medium shrink-0" :class="r.tone">{{ r.stateText }}</span>
                <span
                  v-if="r.recording"
                  class="shrink-0 rounded-md bg-danger/12 px-1.5 py-0.5 text-[11px] leading-none text-danger"
                  >录制中</span
                >
              </div>
              <div v-if="r.title" class="text-xs text-g-500 mt-0.5 truncate" :title="r.title">
                {{ r.title }}
              </div>
            </div>
          </div>
        </div>
        <!-- 空态：没有房间可比"暂无数据"说得更具体 -->
        <div
          v-else
          class="mt-3 rounded-lg border border-dashed border-g-200 px-4 py-6 text-center text-sm"
          :class="statusKnown ? 'text-g-500' : 'text-g-600'"
        >
          {{ roomsEmptyText }}
        </div>

        <div class="mon-panel__divider"></div>
        <div class="flex flex-wrap items-start justify-between gap-3">
          <div class="min-w-0">
            <h4 class="text-base font-semibold text-g-900 m-0">异常提醒</h4>
            <p class="mt-1 text-xs leading-5 text-g-500">
              {{ issues.length ? `${issues.length} 项待处理` : '未发现异常' }}
            </p>
          </div>
        </div>

        <div class="flex flex-col mt-3">
          <template v-if="issues.length">
            <div
              v-for="(it, i) in issues"
              :key="i"
              class="flex items-start gap-2.5 py-2.5"
              :class="i ? 'border-t border-g-100' : ''"
            >
              <ArtSvgIcon
                :icon="it.level === 'error' ? 'ri:error-warning-line' : 'ri:alert-line'"
                class="text-base mt-0.5 shrink-0"
                :class="it.level === 'error' ? 'text-danger' : 'text-warning'"
              />
              <span
                class="flex-1 min-w-0 text-sm leading-relaxed"
                :class="it.level === 'error' ? 'text-danger' : 'text-warning'"
              >
                {{ it.text }}
              </span>
            </div>
          </template>
          <!-- 官方 dashed 空态 -->
          <div
            v-else
            class="rounded-lg border border-dashed border-g-200 px-4 py-6 text-center text-sm"
            :class="statusKnown ? 'text-g-500' : 'text-g-600'"
          >
            {{ statusKnown ? '代理、监控脚本与连接均正常' : '状态未知，无法判断是否存在异常' }}
          </div>
        </div>
      </article>
    </section>

    <!-- ④ 运行日志 -->
    <article class="art-card p-5">
      <div class="flex flex-wrap items-start justify-between gap-3">
        <div class="min-w-0">
          <h3 class="text-lg font-semibold text-g-900 m-0">运行日志</h3>
          <p class="mt-1 text-sm leading-6 text-g-600">
            代理与监控脚本的最近输出 · {{ status?.logLines?.length || 0 }} 行
          </p>
        </div>
        <!-- 按钮原来写「运行日志（18 行）」，与左边的 h3 重复了一遍「运行日志」 -->
        <button
          type="button"
          class="dy-pressable inline-flex min-h-6 items-center gap-1 text-xs text-g-500 select-none hover:text-theme"
          aria-controls="dy-status-log"
          :aria-expanded="showLog"
          @click="showLog = !showLog"
        >
          {{ showLog ? '收起' : '展开' }}
          <ArtSvgIcon
            :icon="showLog ? 'ri:arrow-up-s-line' : 'ri:arrow-down-s-line'"
            class="log-caret"
            :class="showLog ? 'log-caret--open' : ''"
          />
        </button>
      </div>
      <div class="log-collapse" :class="showLog ? 'log-collapse--open' : ''">
        <div id="dy-status-log" class="log-collapse__inner">
          <div class="rounded-xl bg-g-100/50 px-4 py-3 max-h-80 overflow-auto mt-3">
            <template v-if="status?.logLines?.length">
              <div
                v-for="(l, i) in status.logLines"
                :key="i"
                class="flex gap-2 py-0.5 font-mono text-xs leading-relaxed"
              >
                <span class="shrink-0" :class="logColor(l.src)">[{{ l.src }}]</span>
                <span class="text-g-600 break-all">{{ l.text }}</span>
              </div>
            </template>
            <div v-else class="text-sm text-g-500">暂无日志输出</div>
          </div>
        </div>
      </div>
    </article>

    <!-- 操作结果 -->
    <el-dialog v-model="dialogVisible" :title="dialog.title" width="520px" class="dy-status-dialog">
      <div
        class="text-sm whitespace-pre-line leading-relaxed"
        :class="dialog.ok ? 'text-g-800' : 'text-danger'"
      >
        {{ dialog.message }}
      </div>
      <div
        v-if="dialog.logLines?.length"
        class="mt-3 rounded-xl border border-g-200/70 bg-g-100/40 px-3 py-2 max-h-52 overflow-auto font-mono text-xs text-g-600"
      >
        <div v-for="(l, i) in dialog.logLines" :key="i" class="whitespace-pre-wrap break-all">
          {{ l }}
        </div>
      </div>
      <template #footer>
        <el-button @click="dialogVisible = false">关闭</el-button>
        <el-button type="primary" @click="refresh">刷新状态</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
  import { computed, onActivated, onDeactivated, onMounted, onUnmounted, ref, watch } from 'vue'
  import { ElMessage, ElMessageBox } from 'element-plus'
  import {
    fetchServiceStatus,
    performServiceAction,
    type ServiceAction,
    type ServiceStatus
  } from '@/api/douyin'
  import { fmtClock } from '@/utils/format'
  import { apiErrorMessage } from '@/utils/douyin-error'

  defineOptions({ name: 'DouyinStatus' })

  const status = ref<ServiceStatus | null>(null)
  const loading = ref(true)
  const autoRefresh = ref(true)
  const busy = ref<ServiceAction | ''>('')
  const showLog = ref(false)
  /**
   * 状态取不到时不能把下面渲染成红色「未运行」。
   * `status` 为 null 有两种完全不同的含义 ——「还在检测」与「检测失败了」，
   * 一律显示红色「未运行」会让人以为服务挂了（实际可能只是网络问题）。
   */
  const statusError = ref('')

  const dialogVisible = ref(false)
  const dialog = ref<{ title: string; message: string; ok: boolean; logLines?: string[] }>({
    title: '',
    message: '',
    ok: true
  })

  const proxyHealthy = computed(() => Boolean(status.value?.proxy?.healthy))
  const proxyReachable = computed(() => Boolean(status.value?.proxy?.reachable))
  const daemonRunning = computed(() => Boolean(status.value?.daemon?.running))
  const issues = computed(() => status.value?.issues || [])
  /**
   * 只有成功取到过、且当前没有报错，下面才表达真实状态；
   * 否则一律「状态未知」，绝不用红色「未运行」冒充结论。
   */
  const statusKnown = computed(() => Boolean(status.value) && !statusError.value)

  const configuredRooms = computed(() => status.value?.configuredRooms || 0)
  const connectedRooms = computed(() => status.value?.ws?.rooms ?? 0)
  const liveRooms = computed(() => status.value?.ws?.live ?? 0)
  const recordingRooms = computed(() => status.value?.ws?.recording ?? 0)

  /**
   * 总体状态。`unknown` 是独立语义 —— 取不到状态时既不能说"正常"也不能说"异常"。
   * chipClass 用模板的浅色标签风格（绿=低/正常、红=风险、灰=未知）。
   */
  const overall = computed(() => {
    if (!statusKnown.value) {
      return {
        chip: '未知',
        chipClass: 'mon-chip--unknown',
        icon: 'ri:question-line',
        detail: statusError.value || '未能取到服务状态，无法判断当前是否正常'
      }
    }
    if (issues.value.some((i) => i.level === 'error')) {
      return {
        chip: '异常',
        chipClass: 'mon-chip--danger',
        icon: 'ri:error-warning-line',
        detail: `检测到 ${issues.value.length} 项异常，详见下方「异常提醒」`
      }
    }
    if (!proxyHealthy.value || !daemonRunning.value) {
      return {
        chip: '风险',
        chipClass: 'mon-chip--danger',
        icon: 'ri:alert-line',
        detail: '监控未完全运行，部分功能不可用，请逐项检查「服务明细」'
      }
    }
    return {
      // 文案用「运行正常」而不是「已连接」：后者是下面「已连接 5 / 5」那格的标签，
      // 同一个词在两处表示两个不同的东西容易误读
      chip: '运行正常',
      chipClass: 'mon-chip--ok',
      icon: 'ri:link',
      detail: `代理与监控脚本运行正常，${connectedRooms.value}/${configuredRooms.value} 个房间连接就绪，采集指标读取正常`
    }
  })

  /**
   * Hero 内嵌 kv 小卡 —— 只放「环境事实」，且全页不重复。
   *
   * 原来这四格是「运行模式 / 监控脚本 / 监控房间 / 最近检查」：
   *   - 运行模式写死「嵌入式监控」，是个常量不是数据；
   *   - 监控房间 5 个 与下面第一张 tile 完全同一个数；
   *   - 监控脚本 运行中 与「服务明细」行、tile 三处重复。
   * 现在四格各自出现在全页唯一一处。
   */
  const heroKv = computed(() => {
    const s = status.value
    const unknown = !statusKnown.value
    return [
      { label: '运行平台', value: unknown ? '—' : s?.platform || '—' },
      { label: '代理地址', value: unknown ? '—' : `127.0.0.1:${s?.proxy?.port ?? 1088}` },
      {
        // 库内房间 ≠ 已启用监控的房间：房间管理里可能有历史房间没启用，两个数都要看得见
        label: '库内房间',
        value: unknown ? '—' : `${s?.totalRooms ?? 0} 个`
      },
      {
        label: '最近检查',
        value: s?.checkedAt ? fmtClock(s.checkedAt) : '—',
        tone: 'text-g-900'
      }
    ]
  })

  /**
   * 四张指标 tile：**数字 + 各自不同的副标题，不再画进度条**。
   *
   * 原来每张卡底下都有一根条，四根里三根没有意义：
   *   - 「监控房间 5 个」的条量的是"已连接占比"，与右邻卡「WebSocket 连接 5/5 · 连接率 100%」
   *     是同一个数画两遍，它 footer 的「已连接 5 个」是第三遍；
   *   - 「录制中」的条量录制率、footer 却写「正在直播」—— 一根条一个指标、旁边标另一个；
   *   - 「Go 抓取代理」的条是布尔值（true→100% / false→0%），版本号配进度条纯装饰。
   * 现在每张卡只负责一组互不重复的事实。
   */
  const tiles = computed(() => {
    const s = status.value
    const unknown = !statusKnown.value
    const rooms = configuredRooms.value
    const connected = connectedRooms.value
    const recording = recordingRooms.value
    const live = liveRooms.value
    const daemonTone = unknown
      ? 'text-g-900'
      : daemonRunning.value
        ? 'text-success'
        : s?.daemon?.pidStale
          ? 'text-warning'
          : 'text-danger'
    return [
      {
        label: '监控脚本',
        icon: 'ri:robot-2-line',
        count: null,
        suffix: '',
        text: unknown
          ? '—'
          : daemonRunning.value
            ? '运行中'
            : s?.daemon?.pidStale
              ? '状态异常'
              : '未运行',
        textTone: daemonTone,
        footLabel: '监控 PID',
        footValue: unknown ? '—' : String(s?.daemon?.pid ?? '—'),
        footTone: 'text-g-700'
      },
      {
        label: '监控房间',
        icon: 'ri:live-line',
        count: unknown ? 0 : rooms,
        suffix: ' 个',
        text: '',
        footLabel: '已连接',
        footValue: unknown || !rooms ? '—' : `${connected} / ${rooms}`,
        footTone:
          !unknown && rooms && connected === rooms ? 'text-success' : 'text-g-700'
      },
      {
        label: '正在直播',
        icon: 'ri:radio-line',
        count: unknown ? 0 : live,
        suffix: ' 个',
        text: '',
        footLabel: '正在录制',
        footValue: unknown ? '—' : `${recording} 个`,
        footTone: recording ? 'text-danger' : 'text-g-700'
      },
      {
        // 代理版本是字符串，用不了滚动数字
        label: 'Go 抓取代理',
        icon: 'ri:server-line',
        count: null,
        suffix: '',
        text: unknown ? '—' : s?.proxy?.health?.tag || `:${s?.proxy?.port ?? 1088}`,
        textTone: unknown ? 'text-g-900' : proxyHealthy.value ? 'text-g-900' : 'text-danger',
        footLabel: '健康检查',
        footValue: unknown
          ? '—'
          : proxyHealthy.value
            ? '通过'
            : proxyReachable.value
              ? '异常'
              : '未运行',
        footTone: !unknown && proxyHealthy.value ? 'text-success' : 'text-g-700'
      }
    ]
  })

  /**
   * 每房间一行的连接明细（取代原来「连接健康」的三根聚合进度条）。
   *
   * 那三根条画的是「连接就绪 5/5 / 正在直播 0/5 / 正在录制 0/5」——这三个数 tile 里都有；
   * 而且 0/5 画成 0% 就是一条灰色空槽，不表达任何信息。
   * 后端 /api/service/status 的 `ws.states` 本来就返回了每个房间的明细，直接列出来更有用。
   */
  const roomRows = computed(() => {
    const unknown = !statusKnown.value
    return (status.value?.ws?.states || []).map((r) => {
      const connected = r.connected === true
      const live = r.liveStatus === true
      return {
        key: `${r.roomId}-${r.name || ''}`,
        name: r.name || r.roomId,
        title: r.title || '',
        /*
         * 圆点只表达"连接"：连上=绿、断开=红。
         * 原来"已连接但没开播"给的是琥珀色，5 个房间全没开播时整列都是警告色，
         * 看着像出了问题 —— 而未开播是主播没播，不是我们的故障。
         */
        dotClass: unknown ? 'bg-g-300' : connected ? 'bg-success' : 'bg-danger',
        stateText: unknown ? '状态未知' : connected ? (live ? '直播中' : '未开播') : '未连接',
        tone: unknown
          ? 'text-g-500'
          : connected
            ? live
              ? 'text-success'
              : 'text-g-600'
            : 'text-danger',
        recording: r.recording === true,
        stale: Boolean(r.stale)
      }
    })
  })

  /** 房间列为空时，说清为什么空 —— 「暂无数据」等于没说 */
  const roomsEmptyText = computed(() => {
    if (!statusKnown.value) return '状态未知，无法列出房间'
    const src = status.value?.ws?.source
    if (src === 'log-stale') return '监控脚本未运行，日志里也没有房间状态'
    if (!daemonRunning.value) return '监控脚本未运行，没有房间连接'
    if (!configuredRooms.value) {
      return status.value?.totalRooms
        ? `未启用任何监控房间（房间管理里的 ${status.value.totalRooms} 个都未启用）`
        : '尚未配置监控房间，请先在「房间管理」里添加并启用'
    }
    return '已配置房间，但监控脚本尚未回报连接状态'
  })

  /** 房间状态来源说明：日志来源时明确写出"可能延迟"，别让人当成实时 */
  const roomSourceNote = computed(() => {
    const src = status.value?.ws?.source
    if (src === 'log') return '控制通道不可用，房间状态取自监控日志（可能略有延迟）'
    if (src === 'log-stale') return '监控脚本未运行，下面是历史日志里的连接状态，仅供参考'
    return ''
  })

  /** 数据新鲜度：实时来源是 0ms，日志来源会累积 */
  const freshText = computed(() => {
    const age = status.value?.ws?.ageMs
    if (!statusKnown.value) return '—'
    if (age === null || age === undefined) return '—'
    if (age < 5000) return '实时'
    const mins = Math.round(age / 60000)
    if (mins < 60) return `${mins} 分钟前`
    if (mins < 1440) return `${Math.round(mins / 60)} 小时前`
    return `${Math.round(mins / 1440)} 天前`
  })

  /**
   * 「服务明细」顶部 kv —— 与 Hero kv / tile / 服务行去重后剩下的实时事实。
   * 原来这里的「代理地址 / 代理版本」在下面服务行的副标题里又写了一遍，
   * 「监控 PID / 控制通道」同样重复。
   */
  const serviceKv = computed(() => {
    const s = status.value
    const unknown = !statusKnown.value
    return [
      {
        label: '控制通道',
        value: unknown ? '状态未知' : s?.daemon?.controlChannel ? '正常' : '不可用'
      },
      {
        label: '数据来源',
        value: unknown
          ? '—'
          : s?.ws?.source === 'memory'
            ? '守护进程内存'
            : s?.ws?.source === 'socket'
              ? '控制通道'
              : s?.ws?.source === 'log'
                ? '监控日志'
                : s?.ws?.source === 'log-stale'
                  ? '历史日志'
                  : '无'
      },
      { label: '数据新鲜度', value: freshText.value },
      { label: '代理进程', value: unknown ? '—' : s?.proxy?.binaryName || '—' }
    ]
  })

  /** 两行服务明细（Go 抓取代理 / 监控脚本），每行带对应的重启/启动按钮 */
  const items = computed(() => {
    const s = status.value
    // 状态未知时不猜测：显示灰色「状态未知」，也不提供会把服务搞得更乱的操作
    const unknown = !statusKnown.value
    const tone = (ok: boolean, warn = false) =>
      unknown ? 'text-g-500' : ok ? 'text-success' : warn ? 'text-warning' : 'text-danger'
    const dot = (ok: boolean, warn = false) =>
      unknown ? 'bg-g-300' : ok ? 'bg-success' : warn ? 'bg-warning' : 'bg-danger'
    const iconTone = (ok: boolean, warn = false) =>
      unknown ? 'text-g-400' : ok ? 'text-success' : warn ? 'text-warning' : 'text-danger'

    const proxyItem = {
      key: 'proxy',
      name: 'Go 抓取代理',
      icon: 'ri:server-line',
      dotClass: dot(proxyHealthy.value, proxyReachable.value),
      tone: tone(proxyHealthy.value, proxyReachable.value),
      iconTone: iconTone(proxyHealthy.value, proxyReachable.value),
      stateText: unknown
        ? '状态未知'
        : proxyHealthy.value
          ? '正常'
          : proxyReachable.value
            ? '响应异常'
            : '未运行',
      detail: unknown
        ? '未能取到状态，无法判断代理是否正常'
        : proxyHealthy.value
          ? // 不再重复"地址 · 版本 · 健康检查通过"（地址在 Hero kv、版本是那张 tile 的数字、
            // 健康结论是它 footer），这里只说还额外验证了什么
            `端口 ${s?.proxy?.port ?? 1088} 在监听，/health 通过${
              s?.proxy?.wsProbe?.upgraded ? '，WebSocket 探测正常' : ''
            }`
          : proxyReachable.value
            ? `127.0.0.1:${s?.proxy?.port ?? 1088} 端口在监听但 /health 不通过`
            : s?.proxy?.binaryExists
              ? '进程未启动'
              : s?.proxy?.foreignBinary
                ? `${s.proxy.foreignBinary} 不是当前平台（${s.platform}）的构建`
                : '未找到代理二进制',
      action: {
        text: proxyHealthy.value ? '重启' : '启动',
        icon: proxyHealthy.value ? 'ri:restart-line' : 'ri:play-line',
        act: (proxyHealthy.value ? 'restart-proxy' : 'start-proxy') as ServiceAction
      }
    }

    const daemonItem = {
      key: 'daemon',
      name: '监控脚本',
      icon: 'ri:robot-2-line',
      dotClass: dot(daemonRunning.value, Boolean(s?.daemon?.pidStale)),
      tone: tone(daemonRunning.value, Boolean(s?.daemon?.pidStale)),
      iconTone: iconTone(daemonRunning.value, Boolean(s?.daemon?.pidStale)),
      stateText: unknown
        ? '状态未知'
        : daemonRunning.value
          ? '运行中'
          : s?.daemon?.pidStale
            ? '状态异常'
            : '未运行',
      /*
       * 运行中时不在这一行重复 PID 与「控制通道正常」：
       * PID 在「监控脚本」tile 的 footer 里，控制通道在左侧 kv 里。
       * 这里只说状态是怎么来的（实时上报 / 从日志解析）。
       */
      detail: unknown
        ? '未能取到状态，无法判断监控脚本是否在运行'
        : daemonRunning.value
          ? s?.daemon?.controlChannel
            ? '房间状态经控制通道实时上报'
            : '控制通道不可用，房间状态改从监控日志解析'
          : s?.daemon?.pidStale
            ? 'PID 文件残留（上次异常退出），重启可清理'
            : s?.configuredRooms
              ? '未运行（上次运行已退出），当前没有采集数据'
              : '未运行，且没有启用任何监控房间',
      action: {
        text: daemonRunning.value ? '重启' : '启动',
        icon: daemonRunning.value ? 'ri:restart-line' : 'ri:play-line',
        act: (daemonRunning.value ? 'restart' : 'start') as ServiceAction
      }
    }

    /*
     * 只保留两个真正的服务行。
     *
     * 原来还有第三行「WebSocket 连接」，但它的按钮执行的是 **daemon 的 restart/start**，
     * 与上一行「监控脚本」的按钮是同一个 action —— 一个动作两个入口，
     * 而且这一行讲的"连接"根本不是它能重启的东西。
     * 连接情况现在由右栏「房间连接」按房间列出，比一行聚合文字更有用。
     */
    return [proxyItem, daemonItem]
  })

  /** 日志来源着色（用语义色，深色模式下才不会看不清） */
  function logColor(src: string): string {
    if (src === 'proxy') return 'text-theme'
    if (src === 'daemon') return 'text-warning'
    return 'text-success'
  }

  async function refresh() {
    if (!status.value) loading.value = true
    try {
      status.value = await fetchServiceStatus()
      statusError.value = ''
    } catch (e) {
      statusError.value = apiErrorMessage(e, '服务状态获取失败')
    } finally {
      loading.value = false
    }
  }

  /**
   * 二次确认：重启类操作会中断全部连接与正在进行的录制，
   * 这是本页唯一会造成数据损失的一类操作，必须有授权边界。
   */
  async function confirmDangerous(action: ServiceAction): Promise<boolean> {
    const s = status.value
    const rooms = s?.configuredRooms || 0
    const recording = s?.ws?.recording || 0
    const live = s?.ws?.live || 0

    const impact: string[] = []
    if (rooms) impact.push(`<li>${rooms} 个监控房间的连接会全部断开并重新建立</li>`)
    if (recording) {
      impact.push(
        `<li><b>正在录制的 ${recording} 个房间会中断</b>，当前场次会被结束；` +
          `恢复后要等抓取代理重新确认开播（实测约 1 分钟），这段时间的数据不会记录</li>`
      )
    } else if (live) {
      impact.push(`<li>当前有 ${live} 个房间在直播，重启期间不会记录弹幕 / 礼物</li>`)
    }
    if (!rooms && !recording && !live) impact.push('<li>所有房间连接会重新建立</li>')
    impact.push('<li>历史数据不会被删除</li>')

    const titleMap: Record<string, string> = {
      restart: '重启 Go 代理与监控脚本？',
      'restart-proxy': '重启 Go 抓取代理？',
      'start-proxy': '启动 Go 抓取代理？',
      start: '启动监控脚本？',
      stop: '停止监控脚本？'
    }

    try {
      await ElMessageBox.confirm(
        `<p>将执行：<b>${titleMap[action] || '执行该操作'}</b></p>` +
          `<p class="mt-2">影响范围：</p><ul class="mt-1 pl-5 list-disc">${impact.join('')}</ul>`,
        '确认执行',
        {
          confirmButtonText: '确认执行',
          cancelButtonText: '取消',
          type: 'warning',
          dangerouslyUseHTMLString: true
        }
      )
      return true
    } catch {
      return false
    }
  }

  /** 缺前置条件时点重启：直接讲清缺什么，而不是让按钮变灰 */
  async function handleRestart() {
    const s = status.value
    const reasons: string[] = []
    if (s && !s.proxy?.binaryExists) {
      reasons.push(
        s.proxy?.foreignBinary
          ? `目录里的 ${s.proxy.foreignBinary} 不是当前平台（${s.platform}）的构建`
          : `未找到代理二进制（候选：${(s.proxy?.candidates || []).join(' / ')}）`
      )
    }
    if (s && (s.configuredRooms || 0) === 0) {
      reasons.push('还没有配置监控房间，请先在「房间管理」里添加')
    }
    if (reasons.length) {
      dialog.value = {
        title: '暂时无法重启',
        message: `请先补齐以下条件：\n\n· ${reasons.join('\n· ')}`,
        ok: false
      }
      dialogVisible.value = true
      ElMessage.warning('缺少启动条件，详情见弹窗')
      return
    }
    if (!(await confirmDangerous('restart'))) return
    await act('restart')
  }

  async function actWithConfirm(action: ServiceAction) {
    if (!(await confirmDangerous(action))) return
    await act(action)
  }

  async function act(action: ServiceAction) {
    busy.value = action
    try {
      const res: any = await performServiceAction(action)
      const ok = res?.ok !== false
      const message = res?.message || res?.error || (ok ? '已完成' : '未知错误')
      dialog.value = { title: ok ? '操作成功' : '操作未完成', message, ok, logLines: res?.logLines }
      dialogVisible.value = true
      if (ok) ElMessage.success(message)
      else ElMessage.warning(message)
      setTimeout(refresh, ok ? 1500 : 300)
    } catch (e: any) {
      dialog.value = { title: '操作失败', message: e?.message || '请求失败', ok: false }
      dialogVisible.value = true
      ElMessage.error(e?.message || '请求失败')
    } finally {
      busy.value = ''
    }
  }

  let timer: number | undefined
  const startTimer = () => {
    stopTimer()
    timer = window.setInterval(() => {
      // 切走时由 onDeactivated 停表；这里再挡一层"浏览器标签页被隐藏"
      if (document.visibilityState === 'visible') refresh()
    }, 8000)
  }
  const stopTimer = () => {
    if (timer) clearInterval(timer)
    timer = undefined
  }

  watch(autoRefresh, (on) => (on ? startTimer() : stopTimer()))
  // keep-alive：这页被缓存，onUnmounted 不会触发 —— 旧版切走后仍在每 8s 请求（实测复现）
  let activatedOnce = false
  onMounted(() => {
    refresh()
    startTimer()
  })
  onActivated(() => {
    // 首次挂载时 mounted 与 activated 都会触发，跳过以免重复请求
    if (!activatedOnce) {
      activatedOnce = true
      return
    }
    refresh()
    if (autoRefresh.value) startTimer()
  })
  onDeactivated(() => stopTimer())
  onUnmounted(() => stopTimer())
</script>

<style scoped lang="scss">
  /*
   * 这份工具条样式原来只被 search 页 @use，而 status 也在用 `.dy-switch-btn`
   * （自动刷新开关的等高外框 + hover 边框）→ 那些规则根本没被加载（UI-AUDIT P2-9）。
   */
  @use '@styles/custom/douyin-toolbar.scss';

  /* ===== kv 小卡（官方 hero/面板内嵌的 label+value 卡） ===== */
  .mon-kv {
    min-width: 0;
    padding: 10px 14px;
    border: 1px solid var(--art-gray-200);
    border-radius: 8px;
  }

  .mon-kv__label {
    font-size: 12px;
    line-height: 1.4;
    color: var(--dy-text-muted);
  }

  .mon-kv__value {
    margin-top: 6px;
    font-size: 14px;
    font-weight: 600;
    line-height: 1.35;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    font-variant-numeric: tabular-nums;
  }

  /* ===== 两栏面板公共 ===== */
  .mon-panel__divider {
    height: 1px;
    background: var(--art-gray-200);
    margin: 16px 0;
  }

  /* 服务明细行 */
  .mon-service {
    display: flex;
    align-items: center;
    gap: 12px;
    min-height: 64px;
  }

  .mon-dot {
    width: 8px;
    height: 8px;
    border-radius: 9999px;
    flex-shrink: 0;
  }

  /* 房间连接行 */
  .mon-room {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 10px 0;
  }

  /* ===== 日志折叠 ===== */
  .log-collapse {
    display: grid;
    grid-template-rows: 0fr;
    transition: grid-template-rows var(--dy-dur-slow) var(--dy-ease-in-out);
  }

  .log-collapse--open {
    grid-template-rows: 1fr;
  }

  .log-collapse__inner {
    min-height: 0;
    overflow: hidden;
  }

  .log-caret {
    transition: transform var(--dy-dur-base) var(--dy-ease-out);
  }

  .log-caret--open {
    transform: rotate(180deg);
  }

  @media (prefers-reduced-motion: reduce) {
    .log-collapse,
    .log-caret {
      transition-duration: 1ms;
    }

    .log-caret--open {
      transform: none;
    }
  }
</style>

<!--
  弹窗在窄屏（手机查看）下不能固定 520px 撑破视口。
  el-dialog 默认 teleport 到 body，不在本组件 DOM 子树里，
  scoped style（含 :deep）选不到，必须用非 scoped 的全局样式。
-->
<style>
  .dy-status-dialog {
    max-width: calc(100vw - 32px);
  }
</style>
