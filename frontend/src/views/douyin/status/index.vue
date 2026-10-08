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

    <!-- ② 四张指标 tile -->
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
            <div v-else class="mt-3 truncate text-3xl font-semibold leading-none text-g-900">
              {{ m.text }}
            </div>
          </div>
          <div class="size-9 rounded-lg flex-cc bg-theme/10 shrink-0">
            <ArtSvgIcon :icon="m.icon" class="text-base text-theme" />
          </div>
        </div>
        <div class="mt-4 h-2 overflow-hidden rounded-full bg-g-100">
          <div
            class="h-full rounded-full"
            :style="{ width: m.bar.percent + '%', backgroundColor: m.bar.color }"
          />
        </div>
        <div class="mt-3 flex items-center justify-between gap-3 text-xs">
          <span class="text-g-500">{{ m.footLabel }}</span>
          <span class="truncate font-medium text-g-700">{{ m.footValue }}</span>
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
          <span class="mon-chip" :class="overall.chipClass">{{ overall.chip }}</span>
        </div>

        <!-- 服务事实 kv -->
        <div class="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
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

      <!-- 右：连接健康 + 异常提醒 -->
      <article class="art-card p-5">
        <h3 class="text-lg font-semibold text-g-900 m-0">连接健康</h3>
        <p class="mt-1 text-sm leading-6 text-g-600">各房间 WebSocket 连接与采集概况。</p>

        <div class="mt-5">
          <div v-for="b in bars" :key="b.label" class="mon-bar-item">
            <div class="mon-bar-item__row">
              <span class="mon-bar-item__label">{{ b.label }}</span>
              <span class="mon-bar-item__value">{{ b.text }}</span>
            </div>
            <el-progress
              :percentage="b.percentage"
              :stroke-width="6"
              :show-text="false"
              :color="b.color"
              class="[&_.el-progress-bar__outer]:bg-[rgb(240_240_240)]"
            />
          </div>
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
          <p class="mt-1 text-sm leading-6 text-g-600">代理与监控脚本的最近输出。</p>
        </div>
        <button
          type="button"
          class="dy-pressable inline-flex min-h-6 items-center gap-1 text-xs text-g-500 select-none hover:text-theme"
          aria-controls="dy-status-log"
          :aria-expanded="showLog"
          @click="showLog = !showLog"
        >
          运行日志（{{ status?.logLines?.length || 0 }} 行）
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
      chip: '已连接',
      chipClass: 'mon-chip--ok',
      icon: 'ri:link',
      detail: `代理与监控脚本运行正常，${connectedRooms.value}/${configuredRooms.value} 个房间连接就绪，采集指标读取正常`
    }
  })

  /** Hero 内嵌 kv 小卡（缓存监控页 hero 的「引擎/状态/Key 数量/内存」位） */
  const heroKv = computed(() => {
    const unknown = !statusKnown.value
    return [
      { label: '运行模式', value: unknown ? '—' : '嵌入式监控' },
      {
        label: '监控脚本',
        value: unknown ? '状态未知' : daemonRunning.value ? '运行中' : '未运行',
        tone: unknown ? 'text-g-500' : daemonRunning.value ? 'text-success' : 'text-danger'
      },
      {
        label: '监控房间',
        value: unknown ? '—' : `${configuredRooms.value} 个`,
        tone: 'text-g-900'
      },
      {
        label: '最近检查',
        value: status.value?.checkedAt ? fmtClock(status.value.checkedAt) : '—',
        tone: 'text-g-900'
      }
    ]
  })

  /** 四张指标 tile（缓存监控页的命中率/Key 数量/Ops/s/客户端连接位） */
  const tiles = computed(() => {
    const s = status.value
    const unknown = !statusKnown.value
    const rooms = configuredRooms.value
    const connected = connectedRooms.value
    const recording = recordingRooms.value
    const live = liveRooms.value
    const pct = (n: number) => (unknown || !rooms ? 0 : Math.round((n / rooms) * 100))
    return [
      {
        label: '监控房间',
        icon: 'ri:live-line',
        count: unknown ? 0 : rooms,
        suffix: ' 个',
        text: '',
        bar: { percent: pct(connected), color: 'var(--dy-text-success)' },
        footLabel: '已连接',
        footValue: unknown ? '—' : `${connected} 个`
      },
      {
        label: 'WebSocket 连接',
        icon: 'ri:link',
        count: unknown ? 0 : connected,
        suffix: rooms ? ` / ${rooms}` : ' 个',
        text: '',
        bar: {
          percent: pct(connected),
          color:
            !unknown && connected === rooms && rooms > 0
              ? 'var(--dy-text-success)'
              : 'var(--dy-text-warning)'
        },
        footLabel: '连接率',
        footValue: unknown || !rooms ? '—' : `${pct(connected)}%`
      },
      {
        label: '录制中',
        icon: 'ri:radio-line',
        count: unknown ? 0 : recording,
        suffix: ' 个',
        text: '',
        bar: { percent: pct(recording), color: 'var(--dy-text-danger)' },
        footLabel: '正在直播',
        footValue: unknown ? '—' : `${live} 个`
      },
      {
        // 代理版本是字符串，用不了滚动数字
        label: 'Go 抓取代理',
        icon: 'ri:server-line',
        count: null,
        suffix: '',
        text: unknown ? '—' : s?.proxy?.health?.tag || `:${s?.proxy?.port ?? 1088}`,
        bar: {
          percent: unknown ? 0 : proxyHealthy.value ? 100 : 0,
          color: !unknown && proxyHealthy.value ? 'var(--dy-text-success)' : 'var(--dy-text-danger)'
        },
        footLabel: '健康检查',
        footValue: unknown
          ? '—'
          : proxyHealthy.value
            ? '通过'
            : proxyReachable.value
              ? '异常'
              : '未运行'
      }
    ]
  })

  /** 「服务明细」顶部 kv（缓存监控页「连接与指标」的 kv grid 位） */
  const serviceKv = computed(() => {
    const s = status.value
    const unknown = !statusKnown.value
    return [
      { label: '代理地址', value: unknown ? '—' : `127.0.0.1:${s?.proxy?.port ?? 1088}` },
      { label: '代理版本', value: unknown ? '—' : s?.proxy?.health?.tag || '—' },
      { label: '监控 PID', value: unknown ? '—' : String(s?.daemon?.pid ?? '—') },
      {
        label: '控制通道',
        value: unknown ? '状态未知' : s?.daemon?.controlChannel ? '正常' : '不可用'
      },
      {
        label: '数据来源',
        value: unknown
          ? '—'
          : s?.ws?.source === 'log'
            ? '监控日志'
            : s?.ws?.source === 'socket'
              ? '控制通道'
              : '无'
      },
      { label: '运行平台', value: unknown ? '—' : s?.platform || '—' }
    ]
  })

  /** 连接健康进度条 */
  const bars = computed(() => {
    const unknown = !statusKnown.value
    const rooms = configuredRooms.value
    const connected = connectedRooms.value
    const live = liveRooms.value
    const recording = recordingRooms.value
    const pct = (n: number) => (unknown || !rooms ? 0 : Math.round((n / rooms) * 100))
    return [
      {
        label: '连接就绪',
        text: unknown ? '未知' : `${connected} / ${rooms}`,
        percentage: pct(connected),
        color: unknown
          ? 'var(--dy-text-muted)'
          : connected === rooms && rooms > 0
            ? 'var(--dy-text-success)'
            : 'var(--dy-text-warning)'
      },
      {
        label: '正在直播',
        text: unknown ? '未知' : `${live} / ${rooms}`,
        percentage: pct(live),
        color: unknown ? 'var(--dy-text-muted)' : 'var(--dy-text-accent)'
      },
      {
        label: '正在录制',
        text: unknown ? '未知' : `${recording} / ${rooms}`,
        percentage: pct(recording),
        color: unknown ? 'var(--dy-text-muted)' : 'var(--dy-text-danger)'
      }
    ]
  })

  /** 三行服务明细，每行都带对应的重启/启动按钮 */
  const items = computed(() => {
    const s = status.value
    const w = s?.ws
    const tag = s?.proxy?.health?.tag
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
          ? `127.0.0.1:${s?.proxy?.port ?? 1088}${tag ? ' · ' + tag : ''} · 健康检查通过`
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
      detail: unknown
        ? '未能取到状态，无法判断监控脚本是否在运行'
        : daemonRunning.value
          ? `PID ${s?.daemon?.pid}${s?.daemon?.controlChannel ? ' · 控制通道正常' : ' · 控制通道不可用（房间状态取自日志）'}`
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

    const wsAllOk = Boolean(w?.rooms && w.connected === w.rooms)
    const stale = w?.source === 'log-stale'
    const wsItem = {
      key: 'ws',
      name: 'WebSocket 连接',
      icon: 'ri:link',
      dotClass: !w?.rooms ? 'bg-g-300' : wsAllOk ? 'bg-success' : 'bg-warning',
      tone: !w?.rooms ? 'text-g-500' : tone(wsAllOk, true),
      iconTone: !w?.rooms ? 'text-g-400' : iconTone(wsAllOk, true),
      stateText: unknown ? '状态未知' : !w?.rooms ? '无连接' : wsAllOk ? '全部已连接' : '部分断开',
      detail: unknown
        ? '未能取到状态，无法判断连接情况'
        : w?.rooms
          ? `${w.connected} / ${w.rooms} 已连接 · 直播中 ${w.live} · 录制中 ${w.recording}${
              stale ? '（来自历史日志）' : ''
            }`
          : !daemonRunning.value
            ? s?.configuredRooms
              ? `监控脚本未运行，${s.configuredRooms} 个监控房间的连接已中断`
              : s?.totalRooms
                ? `未启用任何监控房间（房间管理里的 ${s.totalRooms} 个是历史房间，需在房间管理里启用）`
                : '监控脚本未运行，启动后自动建立连接'
            : !s?.daemon?.controlChannel
              ? '控制通道不可用，连接数读不到'
              : s?.configuredRooms
                ? `已配置 ${s.configuredRooms} 个房间，尚未回报连接`
                : '尚未配置监控房间',
      action: {
        // 「重连」实际执行的是守护进程 restart/start，副作用远超"重连"二字
        // （会中断全部房间连接与正在进行的录制），文案必须如实写明。
        text: daemonRunning.value ? '重启监控脚本' : '启动监控脚本',
        icon: daemonRunning.value ? 'ri:restart-line' : 'ri:play-line',
        act: (daemonRunning.value ? 'restart' : 'start') as ServiceAction
      }
    }

    return [proxyItem, daemonItem, wsItem]
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

  /* 连接健康进度条 */
  .mon-bar-item + .mon-bar-item {
    margin-top: 16px;
  }

  .mon-bar-item__row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    margin-bottom: 8px;
  }

  .mon-bar-item__label {
    font-size: 13px;
    color: var(--dy-text-secondary);
  }

  .mon-bar-item__value {
    font-size: 13px;
    font-weight: 600;
    color: var(--dy-text-primary);
    font-variant-numeric: tabular-nums;
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
