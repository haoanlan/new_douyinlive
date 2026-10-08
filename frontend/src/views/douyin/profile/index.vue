<template>
  <div class="douyin-page p-4">
    <!--
      加载失败：用共用错误态（不是空态插图），并把重试的进行中状态接上。
      原来这里是 el-empty + 一个没有 loading 的「重试」按钮（UI-AUDIT P1-10）。
    -->
    <QueryErrorState v-if="error" :message="error" :retrying="loading" @retry="load" />

    <template v-else>
      <!-- 头部 -->
      <div class="art-card p-5 mb-4" v-loading="loading">
        <div class="flex items-center gap-4 flex-wrap">
          <div class="relative shrink-0 flex">
            <el-avatar :size="56" :src="profile?.avatar">{{ profile?.nickname?.[0] }}</el-avatar>
          </div>
          <div class="flex-1 min-w-0">
            <div class="text-lg font-bold text-g-900 truncate">{{ profile?.nickname || '-' }}</div>
            <div class="text-sm text-g-500 mt-0.5">
              <span v-if="profile?.giftStyle">{{ profile.giftStyle }}</span>
              <span v-if="profile?.danmakuStyle"> · 弹幕 {{ profile.danmakuStyle }}</span>
            </div>
            <div class="text-xs text-g-400 mt-1">
              首次活跃 {{ fmtTs(profile?.firstSeen) }} · 最近活跃 {{ fmtTs(profile?.lastSeen) }}
            </div>
          </div>
        </div>

        <!-- 关键指标：官方 tile 语言（图标块 + 数字 + 标签）；数字口径 P1-7 -->
        <div class="grid grid-cols-2 md:grid-cols-5 gap-3 mt-4 pt-4 border-t border-g-100">
          <div
            v-for="s in stats"
            :key="s.label"
            class="flex items-center gap-3 px-4 py-3 border border-g-300/85 rounded-xl"
          >
            <div class="size-9 rounded-lg flex-cc bg-theme/10 shrink-0">
              <ArtSvgIcon :icon="s.icon" class="text-base text-theme" />
            </div>
            <div class="min-w-0">
              <div class="text-xl font-medium leading-none" :title="s.title">
                {{ s.value }}
              </div>
              <div class="text-xs text-g-500 mt-1.5">{{ s.label }}</div>
            </div>
          </div>
        </div>
      </div>

      <!-- 底部 6 个模块排成矩形网格（两列、行内等高、底边齐平），见 douyin-motion.scss 的 .dy-profile-grid -->
      <el-row :gutter="20" class="dy-profile-grid">
        <!-- 左列 -->
        <el-col :sm="24" :md="12">
          <div class="art-card p-5 mb-5">
            <div class="art-card-header"><div class="title"><h4>常用礼物</h4></div></div>
            <el-table :data="profile?.topGiftsByCount || []" size="small">
              <!-- 空态交给表格自己，避免"表格空态 + 卡片空态"两份同时出现（P2-15） -->
              <template #empty>
                <el-empty description="暂无礼物" :image-size="60" />
              </template>
              <el-table-column label="礼物" min-width="130">
                <template #default="{ row }">
                  <div class="flex items-center gap-2">
                    <el-image
                      v-if="row.icon_url"
                      :src="row.icon_url"
                      :preview-src-list="[row.icon_url]"
                      fit="contain"
                      class="!w-6 !h-6 shrink-0"
                    />
                    <span class="truncate">{{ row.gift_name }}</span>
                  </div>
                </template>
              </el-table-column>
              <el-table-column label="次数" width="80" align="right">
                <template #default="{ row }">
                  <span :title="fmtTitle(row.count)">{{ fmtNum(row.count) }}</span>
                </template>
              </el-table-column>
              <el-table-column label="钻石" width="90" align="right">
                <template #default="{ row }">
                  <span :title="fmtTitle(row.total_diamonds)">
                    {{ fmtNum(row.total_diamonds) }}
                  </span>
                </template>
              </el-table-column>
            </el-table>
          </div>

          <div class="art-card p-5 flex flex-col">
            <div class="art-card-header"><div class="title"><h4>活跃时段</h4></div></div>
            <!-- 图表区 flex-1：矩形网格行内等高后由它吃掉多余高度，避免卡片下方留一大片空白 -->
            <div class="flex items-end gap-0.5 h-24 flex-1 min-h-24" role="img" :aria-label="hourBarsAria">
              <div
                v-for="h in hourBars"
                :key="h.hour"
                class="hour-bar flex-1 rounded-t"
                :class="h.empty ? 'hour-bar--empty' : 'bg-theme/60'"
                :style="{ height: h.empty ? undefined : h.h + '%' }"
                :title="`${h.hour}:00 — ${h.count} 次`"
              />
            </div>
            <div class="flex justify-between text-xs text-g-400 mt-1">
              <span>0 点</span><span>12 点</span><span>23 点</span>
            </div>
            <div v-if="profile?.peakHour" class="text-xs text-g-500 mt-2">
              高峰时段：<b class="text-g-900">{{ profile.peakHour }}</b>
            </div>
          </div>

          <div class="art-card p-5">
            <div class="art-card-header"><div class="title"><h4>活跃场次</h4></div></div>
            <el-table :data="(profile?.activeSessions || []).slice(0, 8)" size="small">
              <template #empty>
                <el-empty description="暂无数据" :image-size="60" />
              </template>
              <el-table-column prop="streamer_name" label="主播" min-width="110" show-overflow-tooltip />
              <el-table-column label="开始时间" width="150">
                <template #default="{ row }">{{ fmtTs(row.start_time) }}</template>
              </el-table-column>
              <el-table-column label="钻石" width="90" align="right">
                <template #default="{ row }">
                  <span :title="fmtTitle(row.session_diamonds)">
                    {{ fmtNum(row.session_diamonds) }}
                  </span>
                </template>
              </el-table-column>
              <el-table-column label="" width="70" align="right">
                <template #default="{ row }">
                  <el-button size="small" text type="primary" @click="goDetail(row.id)">
                    详情
                  </el-button>
                </template>
              </el-table-column>
            </el-table>
          </div>
        </el-col>

        <!-- 右列 -->
        <el-col :sm="24" :md="12">
          <div class="art-card p-5 mb-5">
            <div class="art-card-header"><div class="title"><h4>常送主播</h4></div></div>
            <el-table :data="profile?.topStreamers || []" size="small">
              <template #empty>
                <el-empty description="暂无数据" :image-size="60" />
              </template>
              <el-table-column prop="name" label="主播" min-width="120" show-overflow-tooltip />
              <el-table-column label="次数" width="80" align="right">
                <template #default="{ row }">
                  <span :title="fmtTitle(row.count)">{{ fmtNum(row.count) }}</span>
                </template>
              </el-table-column>
              <el-table-column label="钻石" width="90" align="right">
                <template #default="{ row }">
                  <span :title="fmtTitle(row.diamonds)">{{ fmtNum(row.diamonds) }}</span>
                </template>
              </el-table-column>
            </el-table>
          </div>

          <div class="art-card p-5 mb-5">
            <div class="art-card-header"><div class="title"><h4>近期行为</h4></div></div>
            <el-timeline>
              <el-timeline-item
                v-for="(a, i) in profile?.recent_actions || []"
                :key="i"
                :timestamp="a.time"
              >
                <el-tag size="small" :type="a.type === 'gift' ? 'warning' : 'info'" class="mr-2">
                  {{ a.type === 'gift' ? '礼物' : '弹幕' }}
                </el-tag>
                {{ a.content }}
              </el-timeline-item>
            </el-timeline>
            <el-empty
              v-if="!profile?.recent_actions?.length"
              description="暂无行为"
              :image-size="60"
            />
          </div>

          <div class="art-card p-5">
            <div class="art-card-header"><div class="title"><h4>馈赠明细</h4></div></div>
            <el-table :data="(profile?.giftBreakdown || []).slice(0, 8)" size="small">
              <template #empty>
                <el-empty description="暂无数据" :image-size="60" />
              </template>
              <el-table-column prop="gift_name" label="礼物" min-width="120" show-overflow-tooltip />
              <el-table-column label="次数" width="80" align="right">
                <template #default="{ row }">
                  <span :title="fmtTitle(row.count)">{{ fmtNum(row.count) }}</span>
                </template>
              </el-table-column>
              <el-table-column label="钻石" width="90" align="right">
                <template #default="{ row }">
                  <span :title="fmtTitle(row.total_diamonds)">
                    {{ fmtNum(row.total_diamonds) }}
                  </span>
                </template>
              </el-table-column>
            </el-table>
          </div>
        </el-col>
      </el-row>
    </template>
  </div>
</template>

<script setup lang="ts">
  import { computed, onMounted, ref } from 'vue'
  import { useRoute, useRouter } from 'vue-router'
  import { fetchUser, type UserProfile } from '@/api/douyin'
  import { fmtNum, fmtTitle } from '@/utils/format'
  import { apiErrorMessage } from '@/utils/douyin-error'

  defineOptions({ name: 'DouyinProfile' })

  const route = useRoute()
  const router = useRouter()
  const secUid = String(route.params.secUid)
  const profile = ref<UserProfile | null>(null)
  const loading = ref(true)
  const error = ref('')

  /** 时间戳 → 可读时间（后端给的是毫秒时间戳，也可能是已有格式的字符串） */
  function fmtTs(ts?: number | string | null) {
    if (ts === undefined || ts === null || ts === '') return '-'
    const n = typeof ts === 'number' ? ts : Number(ts)
    // 非纯数字（已经是格式化好的时间串）直接返回
    if (!Number.isFinite(n) || n <= 0) return String(ts)
    const d = new Date(n > 1e12 ? n : n * 1000)
    if (Number.isNaN(d.getTime())) return String(ts)
    const p = (x: number) => String(x).padStart(2, '0')
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
  }

  const stats = computed(() => {
    const p = profile.value
    const raw: { label: string; value: number | undefined; icon: string }[] = [
      { label: '累计钻石', value: p?.total_diamonds, icon: 'ri:diamond-line' },
      { label: '送礼次数', value: p?.gift_count, icon: 'ri:gift-2-line' },
      { label: '礼物种类', value: p?.gift_types_count, icon: 'ri:price-tag-3-line' },
      { label: '弹幕条数', value: p?.danmakuCount, icon: 'ri:chat-3-line' },
      { label: '活跃场次', value: p?.activeSessionCount, icon: 'ri:live-line' }
    ]
    return raw.map((s) => ({
      label: s.label,
      icon: s.icon,
      value: s.value === undefined ? '-' : fmtNum(s.value),
      title: s.value === undefined ? '' : fmtTitle(s.value)
    }))
  })

  function goDetail(sessionId: number) {
    router.push(`/douyin/detail/${sessionId}`)
  }

  /**
   * 24 小时柱状：按最大值归一化到百分比高度。
   *
   * 原来 `count === 0 ? 2` 会把「没有活动的小时」也画成一根可见的柱子，
   * 而且和真实数据同色 —— 读图结论直接被污染（看起来每个小时都有人送礼）。
   * 现在 0 用 0 高度 + 一条独立的浅色基线表达「这一小时确实没有」，
   * 并且加了个 `empty` 标记让模板用不同颜色渲染。
   */
  const hourBars = computed(() => {
    const map = new Map<number, number>()
    for (const h of profile.value?.hourStats || []) {
      const hour = Number(h.hour)
      if (Number.isFinite(hour)) map.set(hour, Number(h.count) || 0)
    }
    const values = Array.from({ length: 24 }, (_, i) => map.get(i) || 0)
    const max = Math.max(...values, 1)
    return values.map((count, hour) => ({
      hour: String(hour).padStart(2, '0'),
      count,
      empty: count === 0,
      // 0 就是 0（靠基线表达"这一格存在但为空"），非 0 至少 6% 保证可见
      h: count === 0 ? 0 : Math.max(6, Math.round((count / max) * 100))
    }))
  })

  /** 活跃时段柱状图的无障碍摘要（4.5px 宽的柱子没法逐根朗读） */
  const hourBarsAria = computed(() => {
    const total = (profile.value?.hourStats || []).reduce((s, h) => s + (Number(h.count) || 0), 0)
    const peak = profile.value?.peakHour
    return `送礼活跃时段分布，共 ${total} 次${peak ? `，高峰 ${peak}` : ''}`
  })

  async function load() {
    loading.value = true
    error.value = ''
    try {
      profile.value = await fetchUser(secUid)
    } catch (e: unknown) {
      // 后端在「该用户没有任何送礼记录」时返回 404 —— 给一句人话，
      // 不要把内部字段名和 64 字符的 sec_uid 抛给用户（UI-AUDIT P1-10）
      const status = (e as { response?: { status?: number } })?.response?.status
      error.value =
        status === 404
          ? '没有找到这个用户的互动记录（该用户可能没有送礼或弹幕数据）'
          : apiErrorMessage(e, '用户画像加载失败')
    } finally {
      loading.value = false
    }
  }

  onMounted(load)
</script>

<style scoped>
  /*
   * 活跃时段柱状图。
   *
   * 两个细节：
   *   1) 有数据的小时：悬停加深，且只在真指针设备上启用（触屏会误触发）
   *   2) 没有数据的小时：**不是**一根和真数据同色的柱子，而是一条浅色基线，
   *      否则"每个小时都有人送礼"这种错误结论会被读出来
   */
  .hour-bar {
    transition: background-color var(--dy-dur-fast) ease;
  }

  @media (hover: hover) and (pointer: fine) {
    .hour-bar:not(.hour-bar--empty):hover {
      background-color: var(--theme-color);
    }
  }

  /* 空小时：2px 基线，颜色明显弱于真实数据 */
  .hour-bar--empty {
    height: 2px;
    background-color: var(--art-gray-300);
  }
</style>
