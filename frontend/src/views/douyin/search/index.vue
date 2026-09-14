<!-- 匿名查询 —— 按总览页卡片风格重做 -->
<template>
  <div class="p-4">
    <!-- 顶部工具条 -->
    <div class="art-card dy-toolbar px-5 py-4 mb-5 flex items-center justify-between gap-4 flex-wrap">
      <div class="flex items-center gap-3">
        <div class="size-10 rounded-lg flex-cc bg-theme/10 shrink-0">
          <ArtSvgIcon icon="ri:user-search-line" class="text-lg text-theme" />
        </div>
        <div>
          <div class="font-bold text-g-900 leading-tight">匿名查询</div>
          <div class="flex items-center gap-2.5 mt-1.5 text-xs text-g-500">
            <span class="flex items-baseline gap-1">
              <b class="text-[13px] font-semibold text-g-900">{{ users.length }}</b>个匹配用户
            </span>
            <span class="w-px h-3 bg-g-300" />
            <span class="flex items-baseline gap-1">
              <b class="text-[13px] font-semibold text-g-900">{{ totalSessions }}</b>个参与场次
            </span>
            <span class="w-px h-3 bg-g-300" />
            <span class="flex items-baseline gap-1">
              <b class="text-[13px] font-semibold text-theme">{{ fmtNum(totalDiamonds) }}</b>累计钻石
            </span>
            <template v-if="lastQuery">
              <span class="w-px h-3 bg-g-300" />
              <span>关键词「{{ lastQuery }}」</span>
            </template>
          </div>
        </div>
      </div>

      <div class="dy-toolbar-actions">
        <el-select v-model="sortKey" style="width: 130px">
          <el-option label="按最近活跃" value="recent" />
          <el-option label="按累计钻石" value="diamonds" />
          <el-option label="按弹幕数" value="danmaku" />
          <el-option label="按场次数" value="sessions" />
        </el-select>
        <el-select
          v-model="streamerFilter"
          clearable
          placeholder="全部主播"
          style="width: 150px"
        >
          <el-option v-for="s in streamerOptions" :key="s" :label="s" :value="s" />
        </el-select>
        <el-input
          v-model="query"
          placeholder="输入昵称关键词，回车查询"
          style="width: 240px"
          clearable
          @keyup.enter="doSearch"
        >
          <template #prefix>
            <ArtSvgIcon icon="ri:search-line" class="text-g-400" />
          </template>
        </el-input>
        <el-button type="primary" :loading="loading" @click="doSearch">
          <ArtSvgIcon icon="ri:search-line" class="mr-1" />
          查询
        </el-button>
      </div>
    </div>

    <!-- 首次进入的引导 -->
    <div v-if="!searched" class="art-card p-5">
      <div class="art-card-header">
        <div class="title">
          <h4>开始查询</h4>
          <p>支持昵称模糊匹配，数据来自本库的弹幕、礼物与进场记录</p>
        </div>
      </div>
      <div class="mt-4 flex flex-col gap-3">
        <div class="flex items-center gap-2 flex-wrap">
          <span class="text-sm text-g-500">试试这些关键词：</span>
          <button
            v-for="kw in hotKeywords"
            :key="kw"
            class="px-3 h-7 rounded-lg text-xs text-g-700 bg-g-100/70 hover:bg-theme/10 hover:text-theme transition-colors"
            @click="quickSearch(kw)"
          >
            {{ kw }}
          </button>
        </div>
        <div class="flex items-center gap-2 text-xs text-g-500">
          <ArtSvgIcon icon="ri:information-line" class="text-g-400" />
          查询会调用抖音接口补全用户资料，人数较多时会分批请求，请稍候
        </div>
      </div>
    </div>

    <div v-else v-loading="loading" element-loading-text="查询中…">
      <!-- 空结果 -->
      <div v-if="!loading && !sortedUsers.length" class="art-card p-5">
        <el-empty :description="`没有匹配「${lastQuery}」的用户`" :image-size="80" />
      </div>

      <!-- 结果卡片 -->
      <template v-else>
        <div class="flex items-center justify-between mb-3 px-1">
          <span class="text-sm text-g-600">
            共 <b class="text-g-900">{{ sortedUsers.length }}</b> 个用户
            <span v-if="streamerFilter" class="text-g-400">（已筛选主播：{{ streamerFilter }}）</span>
          </span>
          <el-button size="small" text @click="doSearch">
            <ArtSvgIcon icon="ri:refresh-line" class="mr-1" />
            重新查询
          </el-button>
        </div>

        <ElRow :gutter="20">
          <ElCol v-for="u in sortedUsers" :key="u.sec_uid || u.nickname" :sm="24" :md="12" :lg="12">
            <div class="art-card relative px-5 py-4 mb-5">
              <!-- 头部：头像 + 昵称 + 别名 -->
              <div class="flex items-start gap-3.5">
                <el-avatar :size="48" :src="u.avatar" class="shrink-0">
                  {{ (u.nickname || '?')[0] }}
                </el-avatar>
                <div class="flex-1 min-w-0">
                  <div class="flex items-center gap-2">
                    <span class="text-[17px] font-medium text-g-900 truncate leading-snug">
                      {{ u.nickname || '未知用户' }}
                    </span>
                    <el-tag v-if="u.unique_id" size="small" effect="plain" class="shrink-0">
                      ID {{ u.unique_id }}
                    </el-tag>
                  </div>
                  <div class="flex items-center gap-1.5 mt-1 flex-wrap">
                    <span
                      v-if="u.ip_location"
                      class="inline-flex items-center gap-1 text-xs text-g-500"
                    >
                      <ArtSvgIcon icon="ri:map-pin-line" class="text-g-400" />{{ u.ip_location }}
                    </span>
                    <span v-if="u.user_gender" class="text-xs text-g-500">
                      {{ u.user_gender === 1 ? '男' : '女' }}
                    </span>
                    <span v-if="u.is_private" class="text-xs text-warning">私密账号</span>
                    <span v-if="!u.sec_uid" class="text-xs text-g-400">库里无 sec_uid</span>
                  </div>
                  <div v-if="u.db_nicknames?.length" class="flex items-center gap-1.5 mt-2 flex-wrap">
                    <span class="text-xs text-g-400 shrink-0">库内别名</span>
                    <el-tag
                      v-for="n in u.db_nicknames.slice(0, 3)"
                      :key="n"
                      size="small"
                      effect="plain"
                      type="info"
                    >
                      {{ n }}
                    </el-tag>
                    <span v-if="u.db_nicknames.length > 3" class="text-xs text-g-400">
                      +{{ u.db_nicknames.length - 3 }}
                    </span>
                  </div>
                </div>
                <el-button
                  v-if="u.sec_uid"
                  size="small"
                  type="primary"
                  class="shrink-0"
                  @click="router.push(`/douyin/profile/${u.sec_uid}`)"
                >
                  画像
                </el-button>
              </div>

              <!-- 三格统计：无数据的格子弱化为虚线占位，避免一排“0”看着像坏了 -->
              <div class="grid grid-cols-3 gap-2 mt-4">
                <div
                  class="rounded-xl px-3 py-2"
                  :class="hasSessions(u) ? 'bg-g-100/50' : 'bg-g-100/30 border border-dashed border-g-200'"
                >
                  <div class="text-xs text-g-500 flex items-center gap-1">
                    <ArtSvgIcon icon="ri:live-line" class="text-g-400" />参与场次
                  </div>
                  <div class="mt-0.5 flex items-baseline gap-1">
                    <span
                      class="text-[17px] font-bold leading-tight"
                      :class="hasSessions(u) ? 'text-g-900' : 'text-g-400'"
                    >
                      {{ hasSessions(u) ? u.sessions.length : '—' }}
                    </span>
                    <span class="text-xs text-g-500">场</span>
                  </div>
                </div>
                <div
                  class="rounded-xl px-3 py-2"
                  :class="
                    u.total_diamonds ? 'bg-g-100/50' : 'bg-g-100/30 border border-dashed border-g-200'
                  "
                >
                  <div class="text-xs text-g-500 flex items-center gap-1">
                    <ArtSvgIcon icon="ri:diamond-line" class="text-g-400" />累计钻石
                  </div>
                  <div class="mt-0.5 flex items-baseline gap-1">
                    <span
                      class="text-[17px] font-bold leading-tight"
                      :class="u.total_diamonds ? 'text-theme' : 'text-g-400'"
                    >
                      {{ u.total_diamonds ? fmtNum(u.total_diamonds) : '—' }}
                    </span>
                    <span class="text-xs text-g-500">钻</span>
                  </div>
                </div>
                <div
                  class="rounded-xl px-3 py-2"
                  :class="
                    u.danmaku_count ? 'bg-g-100/50' : 'bg-g-100/30 border border-dashed border-g-200'
                  "
                >
                  <div class="text-xs text-g-500 flex items-center gap-1">
                    <ArtSvgIcon icon="ri:chat-3-line" class="text-g-400" />弹幕数
                  </div>
                  <div class="mt-0.5 flex items-baseline gap-1">
                    <span
                      class="text-[17px] font-bold leading-tight"
                      :class="u.danmaku_count ? 'text-g-900' : 'text-g-400'"
                    >
                      {{ u.danmaku_count ? u.danmaku_count.toLocaleString() : '—' }}
                    </span>
                    <span class="text-xs text-g-500">条</span>
                  </div>
                </div>
              </div>
              <div
                v-if="!hasSessions(u) && !u.total_diamonds && !u.danmaku_count"
                class="mt-2 text-xs text-g-400 flex items-center gap-1"
              >
                <ArtSvgIcon icon="ri:information-line" />
                本库仅命中进场记录（查询只取最近 200 条匹配记录）
              </div>

              <!-- 最近动作 / 最近弹幕 / 最近礼物 -->
              <div class="flex flex-col gap-2 mt-4 pt-3 border-t border-g-100/80">
                <div v-if="u.latest_action" class="flex items-center gap-2 text-xs">
                  <span
                    class="px-1.5 py-0.5 rounded-md shrink-0"
                    :class="actionClass(u.latest_action.type)"
                  >
                    {{ actionLabel(u.latest_action.type) }}
                  </span>
                  <span class="flex-1 min-w-0 truncate text-g-700">
                    {{ cleanText(u.latest_action.detail) }}
                  </span>
                  <span class="text-g-400 shrink-0">{{ fmtAgo(u.latest_action.time) }}</span>
                </div>
                <div v-if="u.latest_danmaku" class="flex items-center gap-2 text-xs">
                  <span class="px-1.5 py-0.5 rounded-md bg-blue-50 text-blue-500 shrink-0">
                    弹幕
                  </span>
                  <span class="flex-1 min-w-0 truncate text-g-600">
                    {{ cleanText(u.latest_danmaku.detail) }}
                  </span>
                  <span class="text-g-400 shrink-0">{{ fmtAgo(u.latest_danmaku.time) }}</span>
                </div>
                <div v-if="u.latest_gift" class="flex items-center gap-2 text-xs">
                  <span class="px-1.5 py-0.5 rounded-md bg-amber-50 text-amber-600 shrink-0">
                    礼物
                  </span>
                  <span class="flex-1 min-w-0 truncate text-g-600">
                    {{ cleanText(u.latest_gift.detail) }}
                  </span>
                  <span class="text-g-400 shrink-0">{{ fmtAgo(u.latest_gift.time) }}</span>
                </div>
                <div
                  v-if="!u.latest_action && !u.latest_danmaku && !u.latest_gift"
                  class="text-xs text-g-400"
                >
                  暂无行为记录
                </div>
              </div>

              <!-- 底部：参与场次入口 -->
              <div
                v-if="u.sessions?.length"
                class="flex items-center gap-2 mt-3 pt-3 border-t border-g-100/80 text-xs text-g-600 flex-wrap"
              >
                <ArtSvgIcon icon="ri:time-line" class="text-g-400" />
                <span class="shrink-0">最近参与</span>
                <button
                  v-for="s in u.sessions.slice(0, 2)"
                  :key="s.id"
                  class="px-2 h-6 rounded-md bg-g-100/70 text-g-700 hover:bg-theme/10 hover:text-theme transition-colors"
                  @click="router.push(`/douyin/detail/${s.id}`)"
                >
                  {{ s.streamer_name || '场次 #' + s.id }} · {{ fmtSessionTime(s.start_time) }}
                </button>
                <span v-if="u.sessions.length > 2" class="text-g-400">
                  还有 {{ u.sessions.length - 2 }} 场
                </span>
              </div>
            </div>
          </ElCol>
        </ElRow>
      </template>
    </div>
  </div>
</template>

<script setup lang="ts">
  import { computed, ref } from 'vue'
  import { useRouter } from 'vue-router'
  import { anonymousLookup } from '@/api/douyin'
  import { fmtAgo, fmtNum, fmtSessionTime } from '@/utils/format'

  defineOptions({ name: 'DouyinSearch' })

  const router = useRouter()

  const query = ref('')
  const lastQuery = ref('')
  const results = ref<any[]>([])
  const loading = ref(false)
  const searched = ref(false)
  const sortKey = ref<'recent' | 'diamonds' | 'danmaku' | 'sessions'>('recent')
  const streamerFilter = ref('')

  const hotKeywords = ['无限', '苏江', '林语巷', '神秘人']

  const users = computed(() => results.value || [])

  const totalDiamonds = computed(() =>
    users.value.reduce((sum, u) => sum + (u.total_diamonds || 0), 0)
  )
  const totalSessions = computed(() =>
    users.value.reduce((sum, u) => sum + (u.sessions?.length || 0), 0)
  )

  const streamerOptions = computed(() => {
    const set = new Set<string>()
    for (const u of users.value) {
      for (const s of u.sessions || []) {
        if (s.streamer_name && s.streamer_name !== '未知') set.add(s.streamer_name)
      }
    }
    return [...set]
  })

  const sortedUsers = computed(() => {
    let list = [...users.value]
    if (streamerFilter.value) {
      list = list.filter((u) =>
        (u.sessions || []).some((s: any) => s.streamer_name === streamerFilter.value)
      )
    }
    const num = (v: any) => (typeof v === 'number' ? v : 0)
    switch (sortKey.value) {
      case 'diamonds':
        return list.sort((a, b) => num(b.total_diamonds) - num(a.total_diamonds))
      case 'danmaku':
        return list.sort((a, b) => num(b.danmaku_count) - num(a.danmaku_count))
      case 'sessions':
        return list.sort((a, b) => (b.sessions?.length || 0) - (a.sessions?.length || 0))
      default:
        return list.sort(
          (a, b) => num(b.latest_action?.time) - num(a.latest_action?.time)
        )
    }
  })

  async function doSearch() {
    const q = query.value.trim()
    if (!q) return
    loading.value = true
    searched.value = true
    lastQuery.value = q
    try {
      const res: any = await anonymousLookup(q)
      results.value = res?.users || (Array.isArray(res) ? res : [])
    } catch {
      results.value = []
    } finally {
      loading.value = false
    }
  }

  function quickSearch(kw: string) {
    query.value = kw
    doSearch()
  }

  function hasSessions(u: any): boolean {
    return Boolean(u?.sessions?.length)
  }

  /** 后端 detail 里带 [礼物] 前缀与表情，去掉多余前后缀让行更干净 */
  function cleanText(s?: string | null): string {
    if (!s) return ''
    return String(s).replace(/^\[[^\]]+\]\s*/, '').trim()
  }

  function actionLabel(type?: string): string {
    if (type === 'gift') return '礼物'
    if (type === 'danmaku') return '弹幕'
    if (type === 'member') return '进场'
    return '行为'
  }

  function actionClass(type?: string): string {
    if (type === 'gift') return 'bg-amber-50 text-amber-600'
    if (type === 'danmaku') return 'bg-blue-50 text-blue-500'
    return 'bg-emerald-50 text-emerald-600'
  }
</script>

<style scoped lang="scss">
  /* 工具条控件圆角/间距与卡片统一（与状态监控页同一套） */
  @use '@styles/custom/douyin-toolbar.scss';
</style>
