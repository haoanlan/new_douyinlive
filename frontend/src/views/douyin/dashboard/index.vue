<template>
  <div class="p-4">
    <!-- 汇总卡片 -->
    <div class="flex flex-wrap gap-5 mb-5">
      <div
        v-for="card in cards"
        :key="card.des"
        class="art-card relative flex-1 min-w-[220px] flex flex-col justify-center h-32 px-5"
      >
        <div class="flex items-center justify-between pr-2">
          <span class="text-g-700 text-sm">{{ card.des }}</span>
          <div class="size-10 rounded-lg flex-cc bg-theme/10 shrink-0">
            <ArtSvgIcon :icon="card.icon" class="text-lg text-theme" />
          </div>
        </div>
        <div class="mt-1 flex items-baseline gap-1">
          <span class="text-[24px] font-bold text-g-900 leading-tight whitespace-nowrap">{{
            card.num
          }}</span>
          <span class="text-sm font-medium text-g-500 shrink-0">{{ card.unit }}</span>
        </div>
      </div>
    </div>

    <!-- 监控状态 —— 立即显示，无阻塞 -->
    <div v-loading="!daemon" class="flex flex-wrap gap-5 mb-5" element-loading-text="连接中…">
      <div class="art-card relative flex-1 min-w-[160px] flex items-center gap-3 h-20 px-5">
        <div class="size-10 rounded-lg flex-cc bg-theme/10 shrink-0">
          <ArtSvgIcon icon="ri:server-line" class="text-lg text-theme" />
        </div>
        <div class="min-w-0">
          <div class="text-xs text-g-500">守护进程</div>
          <el-tag :type="daemonRunning ? 'success' : 'danger'" size="small" effect="light">
            {{ daemonRunning ? '运行中' : '未运行' }}
          </el-tag>
        </div>
      </div>
      <div class="art-card relative flex-1 min-w-[160px] flex items-center gap-3 h-20 px-5">
        <div class="size-10 rounded-lg flex-cc bg-theme/10 shrink-0">
          <ArtSvgIcon icon="ri:server-line" class="text-lg text-theme" />
        </div>
        <div class="min-w-0">
          <div class="text-xs text-g-500">Go 代理</div>
          <el-tag :type="daemonRunning ? 'success' : 'danger'" size="small" effect="light">
            {{ daemonRunning ? '正常' : '未知' }}
          </el-tag>
        </div>
      </div>
      <div class="art-card relative flex-1 min-w-[160px] flex items-center gap-3 h-20 px-5">
        <div class="size-10 rounded-lg flex-cc bg-theme/10 shrink-0">
          <ArtSvgIcon icon="ri:link" class="text-lg text-theme" />
        </div>
        <div class="min-w-0">
          <div class="text-xs text-g-500">WebSocket 连接</div>
          <div class="flex items-baseline gap-1">
            <span class="text-lg font-bold text-g-900">{{ connectedCount }}</span>
            <span class="text-xs text-g-500">/ {{ totalRooms }} 房间</span>
          </div>
        </div>
      </div>
      <div class="art-card relative flex-1 min-w-[160px] flex items-center gap-3 h-20 px-5">
        <div class="size-10 rounded-lg flex-cc bg-theme/10 shrink-0">
          <ArtSvgIcon icon="ri:radio-line" class="text-lg text-theme" />
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
          <TransitionGroup name="list" tag="div" class="flex flex-col gap-2.5 mt-4" appear>
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
              <el-avatar :size="32" :src="p.streamer_avatar">{{ p.streamer?.[0] }}</el-avatar>
              <div class="flex-1 min-w-0">
                <div class="text-sm truncate">{{
                  p.streamer || p.room_title || '场次 #' + p.id
                }}</div>
                <div class="text-xs text-g-500">{{ fmtTime(p.start_time) }}</div>
              </div>
              <span class="text-sm font-bold text-theme shrink-0"
                >{{ p.online_peak.toLocaleString() }}人</span
              >
            </div>
            <el-empty
              v-if="!overview?.peakSessions?.length"
              description="暂无数据"
              :image-size="60"
            />
          </TransitionGroup>
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
          <TransitionGroup name="list" tag="div" class="flex flex-col gap-2.5 mt-4" appear>
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
              <span v-else class="text-base shrink-0">🎁</span>
              <span class="flex-1 min-w-0 truncate text-sm text-g-800">{{ g.name }}</span>
              <span class="text-sm font-bold text-theme shrink-0">{{ fmtNum(g.diamonds) }}钻</span>
            </div>
            <el-empty v-if="!overview?.topGifts?.length" description="暂无数据" :image-size="60" />
          </TransitionGroup>
        </div>
      </el-col>
    </el-row>

    <!-- 送礼榜 + 弹幕活跃 -->
    <el-row :gutter="20">
      <el-col :sm="24" :md="12" :lg="12">
        <div class="art-card p-5 mb-5">
          <div class="art-card-header">
            <div class="title">
              <h4>送礼榜</h4>
              <p>累计钻石 Top 5</p>
            </div>
          </div>
          <TransitionGroup name="list" tag="div" class="flex flex-col gap-2.5 mt-4" appear>
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
              <el-avatar :size="32" :src="u.avatar">{{ u.nickname?.[0] }}</el-avatar>
              <span class="flex-1 min-w-0 text-sm truncate">{{ u.nickname }}</span>
              <span class="text-sm font-bold text-theme shrink-0">{{ fmtNum(u.diamonds) }}钻</span>
            </div>
            <el-empty v-if="!overview?.topUsers?.length" description="暂无数据" :image-size="60" />
          </TransitionGroup>
        </div>
      </el-col>
      <el-col :sm="24" :md="12" :lg="12">
        <div class="art-card p-5 mb-5">
          <div class="art-card-header">
            <div class="title">
              <h4>弹幕活跃</h4>
              <p>发言次数 Top 5</p>
            </div>
          </div>
          <TransitionGroup name="list" tag="div" class="flex flex-col gap-2.5 mt-4" appear>
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
              <el-avatar :size="32" :src="d.avatar">{{ d.nickname?.[0] }}</el-avatar>
              <span class="flex-1 min-w-0 text-sm truncate">{{ d.nickname }}</span>
              <span class="text-sm font-bold text-g-800 shrink-0"
                >{{ d.count.toLocaleString() }}条</span
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
      <TransitionGroup name="list" tag="div" class="flex flex-col gap-2.5 mt-4" appear>
        <div
          v-for="s in overview?.recentSessions || []"
          :key="s.id"
          class="rounded-xl bg-g-100/50 px-3 py-2.5"
        >
          <div class="flex items-center gap-3">
            <el-avatar :size="34" :src="s.streamer_avatar">{{ s.streamer?.[0] }}</el-avatar>
            <div class="flex-1 min-w-0">
              <div class="font-medium text-sm truncate">{{ s.room_title || '场次 #' + s.id }}</div>
              <div class="text-xs text-g-500 truncate">{{ s.streamer || '-' }}</div>
            </div>
            <span class="text-xs text-g-500 shrink-0">{{ fmtTime(s.start_time) }}</span>
            <el-button
              size="small"
              type="primary"
              link
              @click="router.push(`/douyin/detail/${s.id}`)"
            >
              详情
            </el-button>
          </div>
          <div
            class="flex items-center gap-4 mt-2 pt-2 border-t border-g-100/80 text-xs text-g-600 flex-wrap"
          >
            <span class="flex items-center gap-1">
              <ArtSvgIcon icon="ri:diamond-line" class="text-g-400" />{{ fmtNum(s.diamonds) }}
            </span>
            <span class="flex items-center gap-1">
              <ArtSvgIcon icon="ri:chat-3-line" class="text-g-400" />{{
                s.danmaku.toLocaleString()
              }}
              条
            </span>
            <span class="flex items-center gap-1">
              <ArtSvgIcon icon="ri:user-3-line" class="text-g-400" />{{ s.users.toLocaleString() }}
              人
            </span>
            <span class="ml-auto flex items-center gap-1 shrink-0">
              <ArtSvgIcon icon="ri:signal-wifi-line" class="text-g-400" />在线峰值
              {{ s.online_peak.toLocaleString() }}
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
  import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
  import { useRouter } from 'vue-router'
  import { useTransition } from '@vueuse/core'
  import { fetchOverview, fetchStatus, type OverviewData, type DaemonStatus } from '@/api/douyin'
  import { fmtNum, fmtTime, rankClass } from '@/utils/format'

  defineOptions({ name: 'DouyinDashboard' })

  const router = useRouter()
  const overview = ref<OverviewData | null>(null)
  const daemon = ref<DaemonStatus | null>(null)

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
    { des: '活跃用户', icon: 'ri:user-heart-line', unit: '人' },
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
    } catch {}
  }

  async function refreshOverview() {
    try {
      const ov = await fetchOverview()
      overview.value = ov
      const s = ov?.summary
      if (s) {
        rawSessions.value = s.total_sessions || 0
        rawDiamonds.value = s.total_diamonds || 0
        rawDanmaku.value = s.total_danmaku || 0
        rawUsers.value = s.unique_users || 0
        rawLikes.value = s.total_likes || 0
      }
    } catch {}
  }

  // 录制停止（场次结束归档）时刷新历史总览数据
  let wasRecording = false
  watch(hasRecording, (recording) => {
    if (wasRecording && !recording) refreshOverview()
    wasRecording = recording
  })

  let statusTimer: number | undefined
  onMounted(() => {
    refreshStatus()
    refreshOverview()
    statusTimer = window.setInterval(refreshStatus, 10000)
  })
  onUnmounted(() => {
    clearInterval(statusTimer)
  })
</script>

<style scoped>
  .list-enter-active,
  .list-leave-active {
    transition: all 0.4s ease;
  }

  .list-enter-from {
    opacity: 0;
    transform: translateY(10px);
  }

  .list-leave-to {
    opacity: 0;
    transform: translateX(-10px);
  }

  .list-move {
    transition: transform 0.4s ease;
  }
</style>
