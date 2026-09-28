<template>
  <div class="douyin-page p-4">
    <!-- 加载失败 / 无数据 -->
    <div v-if="error" class="art-card p-5 mb-4">
      <el-empty :description="error" :image-size="80">
        <el-button @click="load">重试</el-button>
      </el-empty>
    </div>

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

        <!-- 关键指标 -->
        <div class="grid grid-cols-2 md:grid-cols-5 gap-3 mt-4 pt-4 border-t border-dashed border-t-d">
          <div v-for="s in stats" :key="s.label">
            <div class="text-xl font-semibold text-g-900 leading-none">{{ s.value }}</div>
            <div class="text-xs text-g-500 mt-1">{{ s.label }}</div>
          </div>
        </div>
      </div>

      <el-row :gutter="16">
        <!-- 左列 -->
        <el-col :sm="24" :md="12">
          <div class="art-card p-5 mb-4">
            <div class="art-card-header"><div class="title"><h4>常用礼物</h4></div></div>
            <el-table :data="profile?.topGiftsByCount || []" size="small">
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
              <el-table-column prop="count" label="次数" width="80" />
              <el-table-column prop="total_diamonds" label="钻石" width="90" />
            </el-table>
            <el-empty v-if="!profile?.topGiftsByCount?.length" description="暂无礼物" :image-size="60" />
          </div>

          <div class="art-card p-5 mb-4">
            <div class="art-card-header"><div class="title"><h4>活跃时段</h4></div></div>
            <div class="flex items-end gap-0.5 h-24">
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
              <el-table-column prop="streamer_name" label="主播" min-width="110" show-overflow-tooltip />
              <el-table-column label="开始时间" width="150">
                <template #default="{ row }">{{ fmtTs(row.start_time) }}</template>
              </el-table-column>
              <el-table-column prop="session_diamonds" label="钻石" width="90" />
            </el-table>
            <el-empty v-if="!profile?.activeSessions?.length" description="暂无数据" :image-size="60" />
          </div>
        </el-col>

        <!-- 右列 -->
        <el-col :sm="24" :md="12">
          <div class="art-card p-5 mb-4">
            <div class="art-card-header"><div class="title"><h4>常送主播</h4></div></div>
            <el-table :data="profile?.topStreamers || []" size="small">
              <el-table-column prop="name" label="主播" min-width="120" show-overflow-tooltip />
              <el-table-column prop="count" label="次数" width="80" />
              <el-table-column prop="diamonds" label="钻石" width="90" />
            </el-table>
            <el-empty v-if="!profile?.topStreamers?.length" description="暂无数据" :image-size="60" />
          </div>

          <div class="art-card p-5 mb-4">
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
              <el-table-column prop="gift_name" label="礼物" min-width="120" show-overflow-tooltip />
              <el-table-column prop="count" label="次数" width="80" />
              <el-table-column prop="total_diamonds" label="钻石" width="90" />
            </el-table>
            <el-empty v-if="!profile?.giftBreakdown?.length" description="暂无数据" :image-size="60" />
          </div>
        </el-col>
      </el-row>
    </template>
  </div>
</template>

<script setup lang="ts">
  import { computed, onMounted, ref } from 'vue'
  import { useRoute } from 'vue-router'
  import { fetchUser, type UserProfile } from '@/api/douyin'

  defineOptions({ name: 'DouyinProfile' })

  const route = useRoute()
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
    return [
      { label: '累计钻石', value: p?.total_diamonds ?? '-' },
      { label: '送礼次数', value: p?.gift_count ?? '-' },
      { label: '礼物种类', value: p?.gift_types_count ?? '-' },
      { label: '弹幕条数', value: p?.danmakuCount ?? '-' },
      { label: '活跃场次', value: p?.activeSessionCount ?? '-' }
    ]
  })

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

  async function load() {
    loading.value = true
    error.value = ''
    try {
      profile.value = await fetchUser(secUid)
    } catch (e: unknown) {
      // 后端在「该用户没有任何送礼记录」时返回 404，这里给出明确提示而不是空白页
      const msg = (e as { response?: { status?: number }; message?: string })?.response?.status === 404
        ? `未找到该用户的记录（sec_uid: ${secUid}）`
        : (e as Error)?.message || '加载失败'
      error.value = msg
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
