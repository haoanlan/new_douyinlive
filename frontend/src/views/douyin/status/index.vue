<!--
  状态监控
  页面结构（只有四块，每块自带重启）：
    1. 顶栏：总体状态 + 自动刷新 + 全局「快速重启」
    2. Go 代理状态      [重启/启动]
    3. 监控脚本状态     [重启/启动]
    4. WebSocket 状态   [重连]
    5. 异常提醒 + 运行日志
-->
<template>
  <div class="p-4">
    <!-- 1. 顶栏 -->
    <div class="art-card dy-toolbar px-5 py-4 mb-5 flex items-center justify-between gap-4 flex-wrap">
      <div class="flex items-center gap-3">
        <span class="size-2.5 rounded-full shrink-0" :class="overall.dotClass" />
        <div>
          <h3 class="text-base font-bold text-g-900 leading-tight">状态监控</h3>
          <div class="text-xs text-g-500 mt-1">
            {{ overallText }}
            <template v-if="status?.checkedAt"> · 更新于 {{ fmtClock(status.checkedAt) }}</template>
          </div>
        </div>
      </div>

      <div class="dy-toolbar-actions">
        <span class="dy-switch-btn">
          <span class="dy-switch-btn__label">自动刷新</span>
          <el-switch v-model="autoRefresh" />
        </span>
        <el-button :loading="loading" @click="refresh">
          <ArtSvgIcon icon="ri:refresh-line" class="mr-1" />
          刷新
        </el-button>
        <el-button type="primary" :loading="busy === 'restart'" @click="handleRestart">
          <ArtSvgIcon icon="ri:restart-line" class="mr-1" />
          快速重启
        </el-button>
      </div>
    </div>

    <!-- 2~4. 三个状态行 -->
    <div class="art-card p-5 mb-5">
      <div v-loading="loading && !status" element-loading-text="检测中…">
        <div
          v-for="(item, i) in items"
          :key="item.key"
          class="flex items-center gap-3 h-[54px]"
          :class="i ? 'border-t border-g-100' : ''"
        >
          <span class="size-2 rounded-full shrink-0" :class="item.dotClass" />
          <span class="text-sm text-g-800 shrink-0 whitespace-nowrap w-[104px]">{{ item.name }}</span>
          <span class="text-xs text-g-500 flex-1 min-w-0 truncate">{{ item.detail }}</span>
          <span class="text-sm shrink-0" :class="item.tone">{{ item.stateText }}</span>
          <el-button
            size="small"
            class="shrink-0 ml-2"
            :loading="busy === item.action.act"
            @click="act(item.action.act)"
          >
            <ArtSvgIcon :icon="item.action.icon" class="mr-1" />
            {{ item.action.text }}
          </el-button>
        </div>
      </div>
    </div>

    <!-- 5. 异常提醒 + 运行日志 -->
    <div class="art-card p-5 mb-5">
      <div class="art-card-header">
        <div class="title">
          <h4>异常提醒</h4>
          <p>{{ issues.length ? `${issues.length} 项待处理` : '未发现异常' }}</p>
        </div>
      </div>

      <div class="mt-4 flex flex-col">
        <div
          v-for="(it, i) in issues"
          :key="i"
          class="flex items-start gap-2.5 py-2.5"
          :class="i ? 'border-t border-g-100' : ''"
        >
          <ArtSvgIcon
            :icon="it.level === 'error' ? 'ri:error-warning-line' : 'ri:alert-line'"
            class="text-base mt-0.5 shrink-0"
            :class="it.level === 'error' ? 'text-red-500' : 'text-amber-500'"
          />
          <span
            class="flex-1 min-w-0 text-sm leading-relaxed"
            :class="it.level === 'error' ? 'text-red-600' : 'text-amber-700'"
          >
            {{ it.text }}
          </span>
        </div>

        <div
          v-if="!issues.length"
          class="flex items-center gap-2.5 rounded-xl bg-emerald-50/70 px-4 py-3.5"
        >
          <ArtSvgIcon icon="ri:checkbox-circle-line" class="text-base text-emerald-500 shrink-0" />
          <span class="text-sm text-emerald-700">代理、监控脚本与连接均正常</span>
        </div>
      </div>

      <!-- 运行日志 -->
      <div class="mt-4">
        <span
          class="inline-flex items-center gap-1 mb-2 text-xs text-g-500 c-p select-none hover:text-theme"
          role="button"
          tabindex="0"
          @click="showLog = !showLog"
          @keyup.enter="showLog = !showLog"
        >
          运行日志
          <ArtSvgIcon :icon="showLog ? 'ri:arrow-up-s-line' : 'ri:arrow-down-s-line'" />
        </span>
        <div
          v-show="showLog"
          class="rounded-xl bg-g-100/50 px-4 py-3 max-h-80 overflow-auto"
        >
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

    <!-- 操作结果 -->
    <el-dialog v-model="dialogVisible" :title="dialog.title" width="520px">
      <div
        class="text-sm whitespace-pre-line leading-relaxed"
        :class="dialog.ok ? 'text-g-800' : 'text-red-600'"
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
  import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
  import { ElMessage } from 'element-plus'
  import {
    fetchServiceStatus,
    performServiceAction,
    type ServiceAction,
    type ServiceStatus
  } from '@/api/douyin'
  import { fmtClock } from '@/utils/format'

  defineOptions({ name: 'DouyinStatus' })

  const status = ref<ServiceStatus | null>(null)
  const loading = ref(true)
  const autoRefresh = ref(true)
  const busy = ref<ServiceAction | ''>('')
  const showLog = ref(true)

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

  const overallText = computed(() => {
    if (!status.value) return '正在检测服务状态…'
    if (issues.value.some((i) => i.level === 'error')) return '存在异常，详见下方提醒'
    if (!proxyHealthy.value || !daemonRunning.value) return '监控未完全运行'
    return '服务运行正常'
  })

  /** 顶栏状态圆点 */
  const overall = computed(() => {
    if (!status.value) return { dotClass: 'bg-g-300' }
    if (issues.value.some((i) => i.level === 'error')) return { dotClass: 'bg-danger' }
    if (!proxyHealthy.value || !daemonRunning.value) return { dotClass: 'bg-warning' }
    return { dotClass: 'bg-success' }
  })

  /** 三个状态行，每行都带对应的重启/启动按钮 */
  const items = computed(() => {
    const s = status.value
    const w = s?.ws
    const tag = s?.proxy?.health?.tag

    // --- Go 代理 ---
    const proxyItem = {
      key: 'proxy',
      name: 'Go 抓取代理',
      dotClass: proxyHealthy.value ? 'bg-success' : proxyReachable.value ? 'bg-warning' : 'bg-danger',
      tone: proxyHealthy.value
        ? 'text-emerald-600'
        : proxyReachable.value
          ? 'text-amber-600'
          : 'text-red-500',
      stateText: proxyHealthy.value ? '正常' : proxyReachable.value ? '响应异常' : '未运行',
      detail: proxyHealthy.value
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

    // --- 监控脚本 ---
    const daemonItem = {
      key: 'daemon',
      name: '监控脚本',
      dotClass: daemonRunning.value ? 'bg-success' : s?.daemon?.pidStale ? 'bg-warning' : 'bg-danger',
      tone: daemonRunning.value
        ? 'text-emerald-600'
        : s?.daemon?.pidStale
          ? 'text-amber-600'
          : 'text-red-500',
      stateText: daemonRunning.value ? '运行中' : s?.daemon?.pidStale ? '状态异常' : '未运行',
      detail: daemonRunning.value
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

    // --- WebSocket 连接 ---
    const wsAllOk = Boolean(w?.rooms && w.connected === w.rooms)
    const stale = w?.source === 'log-stale'
    const wsItem = {
      key: 'ws',
      name: 'WebSocket 连接',
      dotClass: !w?.rooms ? 'bg-g-300' : wsAllOk ? 'bg-success' : 'bg-warning',
      tone: !w?.rooms ? 'text-g-500' : wsAllOk ? 'text-emerald-600' : 'text-amber-600',
      stateText: !w?.rooms ? '无连接' : wsAllOk ? '全部已连接' : '部分断开',
      detail: w?.rooms
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
        // 连接由监控脚本维护，"重连"等价于重启监控脚本
        text: '重连',
        icon: 'ri:refresh-line',
        act: (daemonRunning.value ? 'restart' : 'start') as ServiceAction
      }
    }

    return [proxyItem, daemonItem, wsItem]
  })

  function logColor(src: string): string {
    if (src === 'proxy') return 'text-sky-500'
    if (src === 'daemon') return 'text-amber-500'
    return 'text-emerald-500'
  }

  async function refresh() {
    if (!status.value) loading.value = true
    try {
      status.value = await fetchServiceStatus()
    } catch {
      /* 保留上次数据 */
    } finally {
      loading.value = false
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
    await act('restart')
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
    timer = window.setInterval(refresh, 8000)
  }
  const stopTimer = () => {
    if (timer) clearInterval(timer)
    timer = undefined
  }

  watch(autoRefresh, (on) => (on ? startTimer() : stopTimer()))
  onMounted(() => {
    refresh()
    startTimer()
  })
  onUnmounted(() => stopTimer())
</script>

<style scoped lang="scss">
  /* 工具条控件圆角/间距与卡片统一 */
  @use '@styles/custom/douyin-toolbar.scss';
</style>
