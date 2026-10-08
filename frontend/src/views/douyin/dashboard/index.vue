<template>
  <div class="douyin-page p-4">
    <!--
      汇总卡片。
      与「场次历史 / 场次详情」的同款卡片对齐口径（原来这里是自己一套）：
        - 高度 h-32（128px）→ h-20（80px），三个页面统一
        - 数值 24px bold + text-sm 标签 → 20px medium + text-xs 标签
        - 图标容器 size-10/text-lg → size-9/text-base
      之前同一类卡片在三个页面是三种尺寸，扫过去会觉得"这些页不是一个产品"。
    -->
    <div class="dy-stat-row">
      <div v-for="card in cards" :key="card.des" class="art-card dy-stat-card">
        <div class="min-w-0">
          <div class="text-xs text-g-500">{{ card.des }}</div>
          <div class="mt-1 flex items-baseline gap-1">
            <span class="text-[20px] font-medium text-g-900 leading-none whitespace-nowrap">{{
              card.num
            }}</span>
            <span class="text-xs text-g-500 shrink-0">{{ card.unit }}</span>
          </div>
        </div>
        <div class="size-9 rounded-lg flex-cc bg-theme/10 shrink-0">
          <ArtSvgIcon :icon="card.icon" class="text-base text-theme" />
        </div>
      </div>
    </div>

    <!--
      P0-3：状态取不到时必须显式说明。
      否则后端一挂，下面四张卡照旧显示绿色「运行中 / 正常」，
      使用者会以为一切正常——这是监控工具最危险的失败模式。
    -->
    <el-alert
      v-if="statusError"
      type="error"
      :closable="false"
      show-icon
      class="mb-5"
      title="监控状态获取失败，下面显示的可能不是当前真实状态"
    >
      <div class="flex items-center gap-3 flex-wrap">
        <span class="text-xs break-all">{{ statusError }}</span>
        <span v-if="staleSeconds > 0" class="text-xs">
          · 数据已过期 {{ staleSeconds }} 秒
        </span>
        <el-button size="small" type="primary" plain @click="refreshStatus">重试</el-button>
      </div>
    </el-alert>

    <!-- 状态是好的但已经很久没刷新成功：提示数据新鲜度 -->
    <el-alert
      v-else-if="lastStatusAt && staleSeconds > 30"
      type="warning"
      :closable="false"
      show-icon
      class="mb-5"
      :title="`状态数据已 ${staleSeconds} 秒未更新，自动刷新可能已停止`"
    />

    <!-- 监控状态 —— 立即显示，无阻塞 -->
    <div v-loading="!daemon" class="flex flex-wrap gap-5 mb-5" element-loading-text="连接中…">
      <div class="art-card relative flex-1 min-w-[160px] flex items-center gap-3 h-20 px-5">
        <div class="size-9 rounded-lg flex-cc bg-theme/10 shrink-0">
          <ArtSvgIcon icon="ri:server-line" class="text-base text-theme" />
        </div>
        <div class="min-w-0">
          <div class="text-xs text-g-500">守护进程</div>
          <!-- 状态取失败时不再沿用上次的绿色标签（会看起来"一切正常"） -->
          <el-tag
            :type="statusError ? 'info' : daemonRunning ? 'success' : 'danger'"
            size="small"
            effect="light"
          >
            {{ statusError ? '状态未知' : daemonRunning ? '运行中' : '未运行' }}
          </el-tag>
        </div>
      </div>
      <div class="art-card relative flex-1 min-w-[160px] flex items-center gap-3 h-20 px-5">
        <div class="size-9 rounded-lg flex-cc bg-theme/10 shrink-0">
          <ArtSvgIcon icon="ri:server-line" class="text-base text-theme" />
        </div>
        <div class="min-w-0">
          <div class="text-xs text-g-500">Go 代理</div>
          <el-tag
            :type="statusError ? 'info' : daemonRunning ? 'success' : 'danger'"
            size="small"
            effect="light"
          >
            {{ statusError ? '状态未知' : daemonRunning ? '正常' : '未知' }}
          </el-tag>
        </div>
      </div>
      <div class="art-card relative flex-1 min-w-[160px] flex items-center gap-3 h-20 px-5">
        <div class="size-9 rounded-lg flex-cc bg-theme/10 shrink-0">
          <ArtSvgIcon icon="ri:link" class="text-base text-theme" />
        </div>
        <div class="min-w-0">
          <div class="text-xs text-g-500">WebSocket 连接</div>
          <div class="flex items-baseline gap-1">
            <span class="text-lg font-bold text-g-900">{{ connectedCount }}</span>
            <span class="text-xs text-g-500">/ {{ totalRooms }} 个房间</span>
          </div>
        </div>
      </div>
      <div class="art-card relative flex-1 min-w-[160px] flex items-center gap-3 h-20 px-5">
        <div class="size-9 rounded-lg flex-cc bg-theme/10 shrink-0">
          <ArtSvgIcon icon="ri:radio-line" class="text-base text-theme" />
        </div>
        <div class="min-w-0">
          <div class="text-xs text-g-500">录制中</div>
          <div class="flex items-baseline gap-1">
            <span class="text-lg font-bold text-g-900">{{ recordingCount }}</span>
            <span class="text-xs text-g-500">个</span>
          </div>
        </div>
      </div>
    </div>

    <!-- 历史总览取不到时说明原因，避免下面各块的「暂无数据」被读成"真的没数据" -->
    <el-alert
      v-if="overviewError"
      type="error"
      :closable="false"
      show-icon
      class="mb-5"
      title="历史总览数据加载失败"
    >
      <div class="flex items-center gap-3 flex-wrap">
        <span class="text-xs break-all">{{ overviewError }}</span>
        <el-button size="small" type="primary" plain @click="refreshOverview">重试</el-button>
      </div>
    </el-alert>

    <!-- 在线峰值 + 热门礼物 -->
    <el-row :gutter="20">
      <el-col :sm="24" :md="14" :lg="14">
        <div class="art-card p-5 h-105 mb-5">
          <div class="art-card-header">
            <div class="title">
              <h4>在线峰值场次</h4>
              <p>历史在线人数 Top 5</p>
            </div>
          </div>
          <el-skeleton v-if="!overview && !overviewError" :rows="5" animated class="mt-4" />
          <TransitionGroup v-else name="dy-list" tag="div" class="flex flex-col gap-2.5 mt-4" appear>
            <div
              v-for="(p, i) in overview?.peakSessions || []"
              :key="p.id"
              class="flex items-center gap-3 rounded-xl bg-g-100/50 px-3 py-2"
            >
              <span
                class="w-6 h-6 rounded-md flex-cc text-xs font-bold shrink-0"
                :class="rankClass(i)"
                >{{ i + 1 }}</span
              >
              <el-avatar :size="32" :src="p.streamer_avatar" class="shrink-0">{{
                p.streamer?.[0]
              }}</el-avatar>
              <div class="flex-1 min-w-0">
                <div class="text-sm truncate">{{
                  p.streamer || p.room_title || '场次 #' + p.id
                }}</div>
                <div class="text-xs text-g-500">{{ fmtTime(p.start_time) }}</div>
              </div>
              <span class="text-sm font-bold text-theme shrink-0" :title="fmtTitle(p.online_peak)"
                >{{ fmtNum(p.online_peak) }}人</span
              >
            </div>
          </TransitionGroup>
          <!-- 空态是"状态占位"，不是列表项：移出 TransitionGroup，否则它也会做一次进出动画 -->
          <el-empty
            v-if="overview && !overview?.peakSessions?.length"
            description="暂无数据"
            :image-size="60"
          />
        </div>
      </el-col>
      <el-col :sm="24" :md="10" :lg="10">
        <div class="art-card p-5 h-105 mb-5">
          <div class="art-card-header">
            <div class="title">
              <h4>热门礼物</h4>
              <p>累计钻石 Top 5</p>
            </div>
          </div>
          <el-skeleton v-if="!overview && !overviewError" :rows="5" animated class="mt-4" />
          <TransitionGroup v-else name="dy-list" tag="div" class="flex flex-col gap-2.5 mt-4" appear>
            <div
              v-for="(g, i) in (overview?.topGifts || []).slice(0, 5)"
              :key="g.name"
              class="flex items-center gap-2.5 rounded-xl bg-g-100/50 px-3 py-2 min-h-[52px]"
            >
              <span
                class="w-6 h-6 rounded-md flex-cc text-xs font-bold shrink-0"
                :class="rankClass(i)"
                >{{ i + 1 }}</span
              >
              <el-image
                v-if="g.icon"
                :src="g.icon"
                fit="contain"
                class="!size-7 shrink-0"
                :preview-src-list="[g.icon]"
                preview-teleported
              />
              <ArtSvgIcon v-else icon="ri:gift-2-line" class="text-base shrink-0 text-g-500" />
              <span class="flex-1 min-w-0 truncate text-sm text-g-800">{{ g.name }}</span>
              <span class="text-sm font-bold text-theme shrink-0">{{ fmtNum(g.diamonds) }}钻</span>
            </div>
          </TransitionGroup>
          <el-empty
            v-if="overview && !overview?.topGifts?.length"
            description="暂无数据"
            :image-size="60"
          />
        </div>
      </el-col>
    </el-row>

    <!-- 送礼榜 + 弹幕活跃 -->
    <el-row :gutter="20">
      <el-col :sm="24" :md="12" :lg="12" class="mb-5">
        <div class="art-card p-5 h-full">
          <div class="art-card-header">
            <div class="title">
              <h4>送礼榜</h4>
              <p>累计钻石 Top 5</p>
            </div>
          </div>
          <!--
            首屏骨架（UI-AUDIT P1-8）：原来数据没回来就先渲染 el-empty，
            回来后被整块替换 —— 既会被误读成「真没数据」，又让页面高度跳变（实测收缩 393px）。
          -->
          <el-skeleton v-if="!overview && !overviewError" :rows="4" animated class="mt-4" />
          <TransitionGroup v-else name="dy-list" tag="div" class="flex flex-col gap-2.5 mt-4" appear>
            <div
              v-for="(u, i) in overview?.topUsers || []"
              :key="u.sec_uid || u.nickname"
              class="flex items-center gap-3 rounded-xl bg-g-100/50 px-3 py-2"
            >
              <span
                class="w-6 h-6 rounded-md flex-cc text-xs font-bold shrink-0"
                :class="rankClass(i)"
                >{{ i + 1 }}</span
              >
              <el-avatar :size="32" :src="u.avatar" class="shrink-0">{{ u.nickname?.[0] }}</el-avatar>
              <span class="flex-1 min-w-0 text-sm truncate">{{ u.nickname }}</span>
              <span class="text-sm font-bold text-theme shrink-0">{{ fmtNum(u.diamonds) }}钻</span>
            </div>
            <el-empty v-if="!overview?.topUsers?.length" description="暂无数据" :image-size="60" />
          </TransitionGroup>
        </div>
      </el-col>
      <el-col :sm="24" :md="12" :lg="12" class="mb-5">
        <div class="art-card p-5 h-full">
          <div class="art-card-header">
            <div class="title">
              <h4>弹幕活跃</h4>
              <p>发言次数 Top 5</p>
            </div>
          </div>
          <el-skeleton v-if="!overview && !overviewError" :rows="4" animated class="mt-4" />
          <TransitionGroup v-else name="dy-list" tag="div" class="flex flex-col gap-2.5 mt-4" appear>
            <div
              v-for="(d, i) in overview?.topDanmaku || []"
              :key="d.nickname"
              class="flex items-center gap-3 rounded-xl bg-g-100/50 px-3 py-2"
            >
              <span
                class="w-6 h-6 rounded-md flex-cc text-xs font-bold shrink-0"
                :class="rankClass(i)"
                >{{ i + 1 }}</span
              >
              <el-avatar :size="32" :src="d.avatar" class="shrink-0">{{ d.nickname?.[0] }}</el-avatar>
              <span class="flex-1 min-w-0 text-sm truncate">{{ d.nickname }}</span>
              <span class="text-sm font-bold text-g-800 shrink-0" :title="fmtTitle(d.count)"
                >{{ fmtNum(d.count) }}条</span
              >
            </div>
            <el-empty
              v-if="!overview?.topDanmaku?.length"
              description="暂无数据"
              :image-size="60"
            />
          </TransitionGroup>
        </div>
      </el-col>
    </el-row>

    <!-- 最近场次 -->
    <div class="art-card p-5 mb-5">
      <div class="art-card-header">
        <div class="title">
          <h4>最近场次</h4>
          <p>最新 8 场直播记录</p>
        </div>
      </div>
      <el-skeleton v-if="!overview && !overviewError" :rows="6" animated class="mt-4" />
      <TransitionGroup v-else name="dy-list" tag="div" class="flex flex-col gap-2.5 mt-4" appear>
        <div
          v-for="s in overview?.recentSessions || []"
          :key="s.id"
          class="recent-row rounded-xl bg-g-100/50 px-3 py-2.5"
          role="button"
          tabindex="0"
          :aria-label="`查看场次 #${s.id} 详情`"
          @click="goDetail(s.id)"
          @keydown.enter.prevent="goDetail(s.id)"
          @keydown.space.prevent="goDetail(s.id)"
        >
          <div class="flex items-center gap-3">
            <el-avatar :size="34" :src="s.streamer_avatar" class="shrink-0">{{
              s.streamer?.[0]
            }}</el-avatar>
            <div class="flex-1 min-w-0">
              <div class="font-medium text-sm truncate">{{ s.room_title || '场次 #' + s.id }}</div>
              <div class="text-xs text-g-500 truncate">{{ s.streamer || '-' }}</div>
            </div>
            <span class="text-xs text-g-500 shrink-0">{{ fmtTime(s.start_time) }}</span>
            <!-- 整行已经可点，这里只留一个"可进入"的视觉提示：原来是 30×18 的小按钮，
                 触屏很难命中（UI-AUDIT P1-9）。 -->
            <ArtSvgIcon icon="ri:arrow-right-s-line" class="text-base text-g-400 shrink-0" />
          </div>
          <div
            class="flex items-center gap-4 mt-2 pt-2 border-t border-g-100/80 text-xs text-g-600 flex-wrap"
          >
            <span class="flex items-center gap-1" :title="fmtTitle(s.diamonds)">
              <ArtSvgIcon icon="ri:diamond-line" class="text-g-400" />{{ fmtNum(s.diamonds) }}
            </span>
            <span class="flex items-center gap-1" :title="fmtTitle(s.danmaku)">
              <ArtSvgIcon icon="ri:chat-3-line" class="text-g-400" />{{ fmtNum(s.danmaku) }}
              条
            </span>
            <span class="flex items-center gap-1" :title="fmtTitle(s.users)">
              <ArtSvgIcon icon="ri:user-3-line" class="text-g-400" />{{ fmtNum(s.users) }}
              人
            </span>
            <span class="ml-auto flex items-center gap-1 shrink-0" :title="fmtTitle(s.online_peak)">
              <ArtSvgIcon icon="ri:signal-wifi-line" class="text-g-400" />在线峰值
              {{ fmtNum(s.online_peak) }}
            </span>
          </div>
        </div>
        <el-empty
          v-if="!overview?.recentSessions?.length"
          description="暂无场次"
          :image-size="60"
        />
      </TransitionGroup>
    </div>
  </div>
</template>

<script setup lang="ts">
  import { computed, onActivated, onDeactivated, onMounted, onUnmounted, ref, watch } from 'vue'
  import { useRouter } from 'vue-router'
  import { useTransition } from '@vueuse/core'
  import { fetchOverview, fetchStatus, type OverviewData, type DaemonStatus } from '@/api/douyin'
  import { fmtNum, fmtFull, fmtTitle, fmtTime, rankClass } from '@/utils/format'
  import { apiErrorMessage } from '@/utils/douyin-error'

  defineOptions({ name: 'DouyinDashboard' })

  const router = useRouter()

  /**
   * 最近场次：整行可点。
   * 原来只有一个 30×18 的行内「详情」按钮 —— 触屏/鼠标都很难点中（UI-AUDIT P1-9），
   * 现在整行是点击目标（保留 role/tabindex/Enter/Space 的键盘通路）。
   */
  function goDetail(sessionId: number) {
    router.push(`/douyin/detail/${sessionId}`)
  }
  const overview = ref<OverviewData | null>(null)
  const daemon = ref<DaemonStatus | null>(null)

  /**
   * P0-3：「失败」不能伪装成「正常」。
   *
   * 原来 refreshStatus / refreshOverview 都是 `catch {}` 静默吞掉异常：
   * 后端挂掉时页面照常显示最后一次成功的数据，守护进程/Go 代理的标签
   * 依旧是绿色的「运行中 / 正常」——监控工具最不可接受的失败模式。
   * 现在分别记录失败原因与"最后一次成功更新的时刻"，让数据新鲜度可见。
   */
  const statusError = ref('')
  const overviewError = ref('')
  const lastStatusAt = ref<number | null>(null)
  /** 已过多久没成功刷新过状态（秒），用于提示数据是否过期 */
  const staleSeconds = ref(0)

  const daemonRunning = computed(() => Boolean(daemon.value?.data?.running))
  const roomStatusList = computed(() => {
    const rooms = daemon.value?.data?.rooms || {}
    return Object.values(rooms).map((s) => ({
      connected: Boolean(s?.connected),
      recording: Boolean(s?.recording)
    }))
  })
  const totalRooms = computed(() => roomStatusList.value.length)
  const connectedCount = computed(() => roomStatusList.value.filter((r) => r.connected).length)
  const recordingCount = computed(() => roomStatusList.value.filter((r) => r.recording).length)
  const hasRecording = computed(() => recordingCount.value > 0)

  const rawSessions = ref(0)
  const rawDiamonds = ref(0)
  const rawDanmaku = ref(0)
  const rawUsers = ref(0)
  const rawLikes = ref(0)

  const animSessions = useTransition(rawSessions, { duration: 800 })
  const animDiamonds = useTransition(rawDiamonds, { duration: 800 })
  const animDanmaku = useTransition(rawDanmaku, { duration: 800 })
  const animUsers = useTransition(rawUsers, { duration: 800 })
  const animLikes = useTransition(rawLikes, { duration: 800 })

  const PLACEHOLDER_CARDS = [
    { des: '直播场次', icon: 'ri:live-line', unit: '场' },
    { des: '总钻石', icon: 'ri:diamond-line', unit: '钻' },
    { des: '总弹幕', icon: 'ri:chat-3-line', unit: '条' },
    { des: '活跃用户', icon: 'ri:user-3-line', unit: '人' },
    { des: '总点赞', icon: 'ri:thumb-up-line', unit: '次' }
  ]

  const cards = computed(() => {
    const s = overview.value?.summary
    return PLACEHOLDER_CARDS.map((p, i) => ({
      ...p,
      num: s ? fmtNum([animSessions, animDiamonds, animDanmaku, animUsers, animLikes][i].value) : '--'
    }))
  })

  async function refreshStatus() {
    try {
      daemon.value = await fetchStatus()
      statusError.value = ''
      lastStatusAt.value = Date.now()
      staleSeconds.value = 0
    } catch (e) {
      // 保留上次数据，但必须明确告知"这份数据已经不可信了"
      statusError.value = apiErrorMessage(e, '监控状态获取失败')
    }
  }

  async function refreshOverview() {
    try {
      const ov = await fetchOverview()
      overview.value = ov
      overviewError.value = ''
      const s = ov?.summary
      if (s) {
        rawSessions.value = s.total_sessions || 0
        rawDiamonds.value = s.total_diamonds || 0
        rawDanmaku.value = s.total_danmaku || 0
        rawUsers.value = s.unique_users || 0
        rawLikes.value = s.total_likes || 0
      }
    } catch (e) {
      overviewError.value = apiErrorMessage(e, '总览数据加载失败')
    }
  }

  /** 每秒更新"数据已过期多久"，让使用者一眼看出这份状态是不是旧的 */
  let staleTimer: number | undefined
  function tickStale() {
    staleSeconds.value = lastStatusAt.value
      ? Math.floor((Date.now() - lastStatusAt.value) / 1000)
      : 0
  }

  // 录制停止（场次结束归档）时刷新历史总览数据
  let wasRecording = false
  watch(hasRecording, (recording) => {
    if (wasRecording && !recording) refreshOverview()
    wasRecording = recording
  })

  let statusTimer: number | undefined

  function stopTimers() {
    if (statusTimer) clearInterval(statusTimer)
    if (staleTimer) clearInterval(staleTimer)
    statusTimer = undefined
    staleTimer = undefined
  }

  function startTimers() {
    stopTimers()
    statusTimer = window.setInterval(() => {
      // 切到别的页面时由 onDeactivated 停表；这里再挡一层"浏览器标签页被隐藏"
      if (document.visibilityState === 'visible') refreshStatus()
    }, 10000)
    staleTimer = window.setInterval(tickStale, 1000)
  }

  // keep-alive 页：切回来刷新并恢复轮询、切走立刻停。
  // 旧版只在 onUnmounted 清定时器，而这页被缓存、根本不会 unmount ——
  // 于是停在其他页面时它仍在每 10s 偷偷请求（实测复现，见 UI-AUDIT P1-7）。
  let activatedOnce = false
  onMounted(() => {
    refreshStatus()
    refreshOverview()
    startTimers()
  })
  onActivated(() => {
    // 首次挂载时 mounted 与 activated 都会触发，跳过以免重复请求
    if (!activatedOnce) {
      activatedOnce = true
      return
    }
    refreshStatus()
    startTimers()
  })
  onDeactivated(() => stopTimers())
  onUnmounted(() => stopTimers())
</script>

<style scoped>
  /*
   * 统计卡（.dy-stat-row / .dy-stat-card）的布局已提到全局
   * `assets/styles/custom/douyin-motion.scss`，因为状态监控页也要用同一套。
   * 别在这里重新定义 —— 否则两页会各有一套、又走回"看着像共用其实不是"的老路。
   *
   * 列表进出统一走全局 `.dy-list-*`（同上文件）：
   * 原来这里是 `transition: all 0.4s ease`，进场 translateY(10px) 而退出 translateX(-10px) ——
   * 一个纵向进、一个横向出，方向不一致，看着像"被甩出去"。现在统一纵向。
   */

  /* 「最近场次」整行可点：给出悬停与键盘焦点的可见反馈 */
  .recent-row {
    cursor: pointer;
    transition: background-color var(--dy-dur-fast) var(--dy-ease-out);
  }

  @media (hover: hover) and (pointer: fine) {
    .recent-row:hover {
      background-color: var(--art-gray-200);
    }
  }

  .recent-row:focus-visible {
    outline: 2px solid var(--theme-color);
    outline-offset: 2px;
  }
</style>
