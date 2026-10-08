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
            <!--
              库里出现过的全部名字（含 douxxx / 神秘人 这类抖音自动生成的游客名，
              generated=true 的用浅色标签区分）。搜索卡片上只展示真名，完整历史在这里看。
            -->
            <div v-if="profile?.nicknames?.length" class="flex items-center gap-1.5 mt-2 flex-wrap">
              <span class="text-xs text-g-400 shrink-0">库内名字</span>
              <el-tag
                v-for="n in profile.nicknames"
                :key="n.nickname"
                size="small"
                effect="plain"
                :type="n.generated ? 'info' : 'primary'"
                class="max-w-[220px] truncate"
                :title="`${n.nickname} · 出现 ${n.count} 次`"
              >
                {{ n.nickname }}
              </el-tag>
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
            <!-- 行样式与总览页一致：圆角矩形长条，不用表格分割线（用户要求） -->
            <div class="flex flex-col gap-2.5 mt-4">
              <div
                v-for="(g, i) in (profile?.topGiftsByCount || []).slice(0, 8)"
                :key="g.gift_name"
                class="flex items-center gap-2.5 rounded-xl bg-g-100/50 px-3 py-2 min-h-[52px]"
              >
                <span
                  class="w-6 h-6 rounded-md flex-cc text-xs font-bold shrink-0"
                  :class="rankClass(i)"
                  >{{ i + 1 }}</span
                >
                <el-image
                  v-if="g.icon_url"
                  :src="g.icon_url"
                  fit="contain"
                  class="!size-7 shrink-0"
                  :preview-src-list="[g.icon_url]"
                  preview-teleported
                />
                <ArtSvgIcon v-else icon="ri:gift-2-line" class="text-base shrink-0 text-g-500" />
                <span class="flex-1 min-w-0 truncate text-sm text-g-800">{{ g.gift_name }}</span>
                <span class="text-xs text-g-500 shrink-0" :title="fmtTitle(g.count)"
                  >{{ fmtNum(g.count) }} 次</span
                >
                <span
                  class="text-sm font-bold text-theme shrink-0"
                  :title="fmtTitle(g.total_diamonds)"
                  >{{ fmtNum(g.total_diamonds) }}钻</span
                >
              </div>
              <el-empty
                v-if="!profile?.topGiftsByCount?.length"
                description="暂无礼物"
                :image-size="60"
              />
            </div>
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
            <!-- 条形行 + 整行可点（与总览「最近场次」同一套交互） -->
            <div class="flex flex-col gap-2.5 mt-4">
              <div
                v-for="s in (profile?.activeSessions || []).slice(0, 8)"
                :key="s.id"
                class="dy-row-link flex items-center gap-3 rounded-xl bg-g-100/50 px-3 py-2.5"
                role="button"
                tabindex="0"
                :aria-label="`查看场次 #${s.id} 详情`"
                @click="goDetail(s.id)"
                @keydown.enter.prevent="goDetail(s.id)"
                @keydown.space.prevent="goDetail(s.id)"
              >
                <el-avatar :size="32" :src="s.avatar" class="shrink-0">{{
                  s.streamer_name?.[0] || '场'
                }}</el-avatar>
                <div class="flex-1 min-w-0">
                  <div class="text-sm truncate">{{ s.streamer_name || '未知主播' }}</div>
                  <div class="text-xs text-g-500 truncate">{{ fmtTs(s.start_time) }}</div>
                </div>
                <span
                  class="text-sm font-bold text-theme shrink-0"
                  :title="fmtTitle(s.session_diamonds)"
                  >{{ fmtNum(s.session_diamonds) }}钻</span
                >
                <ArtSvgIcon icon="ri:arrow-right-s-line" class="text-base text-g-400 shrink-0" />
              </div>
              <el-empty
                v-if="!profile?.activeSessions?.length"
                description="暂无数据"
                :image-size="60"
              />
            </div>
          </div>
        </el-col>

        <!-- 右列 -->
        <el-col :sm="24" :md="12">
          <div class="art-card p-5 mb-5">
            <div class="art-card-header"><div class="title"><h4>常送主播</h4></div></div>
            <div class="flex flex-col gap-2.5 mt-4">
              <div
                v-for="(s, i) in profile?.topStreamers || []"
                :key="s.name"
                class="flex items-center gap-2.5 rounded-xl bg-g-100/50 px-3 py-2 min-h-[52px]"
              >
                <span
                  class="w-6 h-6 rounded-md flex-cc text-xs font-bold shrink-0"
                  :class="rankClass(i)"
                  >{{ i + 1 }}</span
                >
                <span class="flex-1 min-w-0 truncate text-sm text-g-800">{{ s.name }}</span>
                <span class="text-xs text-g-500 shrink-0" :title="fmtTitle(s.count)"
                  >{{ fmtNum(s.count) }} 次</span
                >
                <span class="text-sm font-bold text-theme shrink-0" :title="fmtTitle(s.diamonds)"
                  >{{ fmtNum(s.diamonds) }}钻</span
                >
              </div>
              <el-empty v-if="!profile?.topStreamers?.length" description="暂无数据" :image-size="60" />
            </div>
          </div>

          <div class="art-card p-5 mb-5">
            <div class="art-card-header"><div class="title"><h4>近期行为</h4></div></div>
            <!-- 原来是 el-timeline（带竖线 + 圆点）→ 改成与总览一致的条形行 -->
            <div class="flex flex-col gap-2.5 mt-4">
              <div
                v-for="(a, i) in (profile?.recent_actions || []).slice(0, 10)"
                :key="i"
                class="flex items-center gap-2.5 rounded-xl bg-g-100/50 px-3 py-2"
              >
                <el-tag
                  size="small"
                  :type="a.type === 'gift' ? 'warning' : 'info'"
                  class="shrink-0 !border-none"
                >
                  {{ a.type === 'gift' ? '礼物' : '弹幕' }}
                </el-tag>
                <span class="flex-1 min-w-0 truncate text-sm text-g-700">{{ a.content }}</span>
                <span class="text-xs text-g-400 shrink-0">{{ a.time }}</span>
              </div>
              <el-empty
                v-if="!profile?.recent_actions?.length"
                description="暂无行为"
                :image-size="60"
              />
            </div>
          </div>

          <div class="art-card p-5">
            <div class="art-card-header"><div class="title"><h4>馈赠明细</h4></div></div>
            <div class="flex flex-col gap-2.5 mt-4">
              <div
                v-for="(g, i) in (profile?.giftBreakdown || []).slice(0, 8)"
                :key="g.gift_name"
                class="flex items-center gap-2.5 rounded-xl bg-g-100/50 px-3 py-2 min-h-[52px]"
              >
                <span
                  class="w-6 h-6 rounded-md flex-cc text-xs font-bold shrink-0"
                  :class="rankClass(i)"
                  >{{ i + 1 }}</span
                >
                <el-image
                  v-if="g.icon_url"
                  :src="g.icon_url"
                  fit="contain"
                  class="!size-7 shrink-0"
                  :preview-src-list="[g.icon_url]"
                  preview-teleported
                />
                <ArtSvgIcon v-else icon="ri:gift-2-line" class="text-base shrink-0 text-g-500" />
                <span class="flex-1 min-w-0 truncate text-sm text-g-800">{{ g.gift_name }}</span>
                <span class="text-xs text-g-500 shrink-0" :title="fmtTitle(g.count)"
                  >{{ fmtNum(g.count) }} 次</span
                >
                <span
                  class="text-sm font-bold text-theme shrink-0"
                  :title="fmtTitle(g.total_diamonds)"
                  >{{ fmtNum(g.total_diamonds) }}钻</span
                >
              </div>
              <el-empty
                v-if="!profile?.giftBreakdown?.length"
                description="暂无数据"
                :image-size="60"
              />
            </div>
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
  import { fmtNum, fmtTitle, rankClass } from '@/utils/format'
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
