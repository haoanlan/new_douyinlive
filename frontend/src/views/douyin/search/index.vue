<!-- 信息查询（原「匿名查询」）—— 按总览页卡片风格重做 -->
<template>
  <div class="douyin-page p-4">
    <!-- 顶部工具条 -->
    <div class="art-card dy-toolbar mb-5 flex items-center justify-between gap-4 flex-wrap">
      <div class="flex items-center gap-3">
        <div class="size-9 rounded-lg flex-cc bg-theme/10 shrink-0">
          <ArtSvgIcon icon="ri:user-search-line" class="text-base text-theme" />
        </div>
        <div>
          <div class="dy-toolbar-title">信息查询</div>
          <div class="flex items-center gap-2.5 mt-1.5 text-xs text-g-500">
            <span class="flex items-baseline gap-1">
              <b class="dy-count text-g-900">{{ users.length }}</b>个匹配用户
            </span>
            <span class="w-px h-3 bg-g-300" />
            <span class="flex items-baseline gap-1">
              <b class="dy-count text-g-900">{{ totalSessions }}</b>个参与场次
            </span>
            <span class="w-px h-3 bg-g-300" />
            <span class="flex items-baseline gap-1">
              <b class="dy-count text-theme">{{ fmtNum(totalDiamonds) }}</b>累计钻石
            </span>
            <template v-if="lastQuery">
              <span class="w-px h-3 bg-g-300" />
              <el-tag size="small" effect="plain">关键词 {{ lastQuery }}</el-tag>
            </template>
            <template v-if="lastScope">
              <span class="w-px h-3 bg-g-300" />
              <el-tag size="small" effect="plain" type="info">{{ lastScope }}</el-tag>
            </template>
          </div>
        </div>
      </div>

      <div class="dy-toolbar-actions">
        <!--
          查询范围：默认「全部直播间」；选中某个直播间时把 streamer_id 传给后端，
          SQL 只扫该直播间的场次，命中的用户变少 → 抖音接口补全调用量同步下降。
        -->
        <el-select v-model="scopeId" clearable placeholder="全部直播间" style="width: 160px">
          <el-option label="全部直播间" value="" />
          <el-option v-for="s in scopeOptions" :key="s.id" :label="s.name" :value="s.id">
            <div class="flex items-center justify-between gap-3">
              <span class="truncate">{{ s.name }}</span>
              <span class="text-xs text-g-500 shrink-0">{{ s.session_count ?? 0 }} 场</span>
            </div>
          </el-option>
        </el-select>
        <el-select v-model="sortKey" style="width: 130px">
          <el-option label="按最近活跃" value="recent" />
          <el-option label="按累计钻石" value="diamonds" />
          <el-option label="按弹幕数" value="danmaku" />
          <el-option label="按场次数" value="sessions" />
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
            class="dy-pressable px-3 h-7 rounded-lg text-xs text-g-700 bg-g-100/70 hover:bg-theme/10 hover:text-theme"
            @click="quickSearch(kw)"
          >
            {{ kw }}
          </button>
        </div>
        <div class="flex items-center gap-2 text-xs text-g-500">
          <ArtSvgIcon icon="ri:information-line" class="text-g-400" />
          查询会调用抖音接口补全用户资料，人数较多时会分批请求，请稍候；
          结果太多时可在右上角先选一个直播间缩小范围
        </div>
      </div>
    </div>

    <div v-else v-loading="loading" element-loading-text="查询中…">
      <!-- 失败：与「没有结果」明确区分（P0-3） -->
      <QueryErrorState
        v-if="!loading && queryError"
        :message="queryError"
        :retrying="loading"
        @retry="doSearch"
      />

      <!-- 空结果：只有查询真的成功且确实没人时才显示 -->
      <div v-else-if="!loading && !sortedUsers.length" class="art-card p-5">
        <el-empty :description="`没有匹配「${lastQuery}」的用户`" :image-size="80" />
      </div>

      <!-- 结果卡片 -->
      <template v-else>
        <div class="flex items-center justify-between mb-3 px-1">
          <span class="text-sm text-g-600">
            共 <b class="text-g-900">{{ sortedUsers.length }}</b> 个用户
            <span v-if="entryCount" class="text-g-400">
              · 其中仅进场 {{ entryCount }} 个（排在最后）
            </span>
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
                    <span class="text-base font-medium text-g-900 truncate leading-snug">
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
                    <span v-if="!u.sec_uid" class="text-xs text-g-400">库里没有用户标识</span>
                  </div>
                  <div
                    v-if="otherNicknames(u).length"
                    class="flex items-center gap-1.5 mt-2 flex-wrap"
                  >
                    <span class="text-xs text-g-400 shrink-0">库内别名</span>
                    <el-tag
                      v-for="n in otherNicknames(u).slice(0, 3)"
                      :key="n"
                      size="small"
                      effect="plain"
                      type="info"
                    >
                      {{ n }}
                    </el-tag>
                    <span v-if="otherNicknames(u).length > 3" class="text-xs text-g-400">
                      +{{ otherNicknames(u).length - 3 }}
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

              <!-- 仅进场用户：三个空格子降噪成一行（占结果的大多数，满屏虚线格最扎眼） -->
              <div
                v-if="isEntryOnly(u)"
                class="mt-3.5 pt-3 border-t border-g-100/80 flex items-center gap-3 flex-wrap text-sm"
              >
                <span class="inline-flex items-center gap-1.5 text-g-500">
                  <ArtSvgIcon icon="ri:door-open-line" class="text-g-400" />
                  仅进场
                </span>
                <span class="text-g-600">
                  参与 <b class="text-g-900 font-medium">{{ u.sessions?.length || 0 }}</b> 场
                </span>
                <span class="text-g-400 text-xs">
                  没有弹幕与送礼<template v-if="!hasSessions(u)">
                    （查询只取最近 200 条匹配记录）</template
                  >
                </span>
              </div>

              <template v-else>
                <!-- 统计格：套官方 today-sales 的 tile 语言（实线框 + 图标块 + 数字上标签下） -->
                <div class="grid grid-cols-3 gap-2.5 mt-4">
                  <div class="flex items-center gap-3 px-4 py-3 border border-g-300/85 rounded-xl">
                    <div class="size-9 rounded-lg flex-cc bg-theme/10 shrink-0">
                      <ArtSvgIcon icon="ri:live-line" class="text-base text-theme" />
                    </div>
                    <div class="min-w-0">
                      <div
                        class="text-xl font-medium leading-none truncate"
                        :class="hasSessions(u) ? 'text-g-900' : 'text-g-400'"
                        :title="hasSessions(u) ? String(u.sessions.length) : ''"
                      >
                        {{ hasSessions(u) ? u.sessions.length : '—' }}
                      </div>
                      <div class="text-xs text-g-500 mt-1.5">参与场次</div>
                    </div>
                  </div>
                  <div class="flex items-center gap-3 px-4 py-3 border border-g-300/85 rounded-xl">
                    <div class="size-9 rounded-lg flex-cc bg-theme/10 shrink-0">
                      <ArtSvgIcon icon="ri:diamond-line" class="text-base text-theme" />
                    </div>
                    <div class="min-w-0">
                      <div
                        class="text-xl font-medium leading-none truncate"
                        :class="u.total_diamonds ? 'text-theme' : 'text-g-400'"
                        :title="u.total_diamonds ? fmtTitle(u.total_diamonds) : ''"
                      >
                        {{ u.total_diamonds ? fmtNum(u.total_diamonds) : '—' }}
                      </div>
                      <div class="text-xs text-g-500 mt-1.5">累计钻石</div>
                    </div>
                  </div>
                  <div class="flex items-center gap-3 px-4 py-3 border border-g-300/85 rounded-xl">
                    <div class="size-9 rounded-lg flex-cc bg-theme/10 shrink-0">
                      <ArtSvgIcon icon="ri:chat-3-line" class="text-base text-theme" />
                    </div>
                    <div class="min-w-0">
                      <div
                        class="text-xl font-medium leading-none truncate"
                        :class="u.danmaku_count ? 'text-g-900' : 'text-g-400'"
                        :title="u.danmaku_count ? fmtTitle(u.danmaku_count) : ''"
                      >
                        {{ u.danmaku_count ? fmtNum(u.danmaku_count) : '—' }}
                      </div>
                      <div class="text-xs text-g-500 mt-1.5">弹幕数</div>
                    </div>
                  </div>
                </div>
              </template>

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
                  class="dy-pressable px-2 h-6 rounded-md bg-g-100/70 text-g-700 hover:bg-theme/10 hover:text-theme"
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
  import { computed, onMounted, ref } from 'vue'
  import { useRouter } from 'vue-router'
  import { anonymousLookup, fetchStreamers, type Streamer } from '@/api/douyin'
  import { fmtAgo, fmtNum, fmtTitle, fmtSessionTime } from '@/utils/format'
  import { apiErrorMessage } from '@/utils/douyin-error'

  defineOptions({ name: 'DouyinSearch' })

  const router = useRouter()

  const query = ref('')
  const lastQuery = ref('')
  /** 上一次查询实际使用的范围（展示的是"当时查了什么"，不是当前下拉的值） */
  const lastScope = ref('')
  const results = ref<any[]>([])
  const loading = ref(false)
  const searched = ref(false)
  /** 查询失败的真实原因；非空时显示错误态而不是「没有匹配的用户」（P0-3） */
  const queryError = ref('')
  const sortKey = ref<'recent' | 'diamonds' | 'danmaku' | 'sessions'>('recent')

  /**
   * 查询范围（默认全部直播间）。
   * 选中具体直播间时会把 streamer_id 传给后端做 SQL 缩圈 ——
   * 命中用户少了，抖音接口补全的调用量也随之下降。
   */
  const scopeId = ref<number | string>('')
  const scopeOptions = ref<Streamer[]>([])

  async function loadScopeOptions() {
    try {
      const list = await fetchStreamers()
      scopeOptions.value = [...list].sort((a, b) => (b.session_count ?? 0) - (a.session_count ?? 0))
    } catch {
      // 范围下拉是增强能力，拿不到就只剩「全部直播间」，不打断查询
    }
  }

  onMounted(loadScopeOptions)

  const hotKeywords = ['无限', '苏江', '林语巷', '神秘人']

  const users = computed(() => results.value || [])

  const totalDiamonds = computed(() =>
    users.value.reduce((sum, u) => sum + (u.total_diamonds || 0), 0)
  )
  const totalSessions = computed(() =>
    users.value.reduce((sum, u) => sum + (u.sessions?.length || 0), 0)
  )

  /** 「仅进场记录」= 没弹幕没送礼 —— 排序时整体沉底（用户决定：照常展示仅靠后） */
  function isEntryOnly(u: any): boolean {
    return !u.danmaku_count && !u.total_diamonds
  }

  const sortedUsers = computed(() => {
    const list = [...users.value]
    const num = (v: any) => (typeof v === 'number' ? v : 0)
    const bySort = (a: any, b: any) => {
      switch (sortKey.value) {
        case 'diamonds':
          return num(b.total_diamonds) - num(a.total_diamonds)
        case 'danmaku':
          return num(b.danmaku_count) - num(a.danmaku_count)
        case 'sessions':
          return (b.sessions?.length || 0) - (a.sessions?.length || 0)
        default:
          return num(b.latest_action?.time) - num(a.latest_action?.time)
      }
    }
    // 先按所选排序排好，再把「仅进场」整体挪到最后（组内相对顺序不变）
    list.sort(bySort)
    const interactive = list.filter((u) => !isEntryOnly(u))
    const entryOnly = list.filter(isEntryOnly)
    return [...interactive, ...entryOnly]
  })

  /** 结果里「仅进场」的数量（结果头与卡片降噪共用同一口径） */
  const entryCount = computed(() => users.value.filter(isEntryOnly).length)

  /**
   * 信息查询。
   *
   * P0-3 修复点：原来 catch 里直接 `results.value = []` ——
   * 网络失败/后端 500 被渲染成「没有匹配『xxx』的用户」，
   * 与「确实查不到这个人」在界面上**完全一样**，
   * 使用者会以为这个人没送过礼，而真相是这次查询根本没成功。
   * 现在失败单独进入错误态（带重试），空结果只在真的查成功且为空时出现。
   */
  async function doSearch() {
    const q = query.value.trim()
    if (!q) return
    loading.value = true
    searched.value = true
    lastQuery.value = q
    // 记录本次查询的真实范围（展示口径以"当时查的"为准）
    const scoped = scopeId.value !== '' && scopeId.value != null
    const scopeName = scoped
      ? scopeOptions.value.find((s) => String(s.id) === String(scopeId.value))?.name || ''
      : ''
    lastScope.value = scoped ? `范围：${scopeName}的直播间` : '范围：全部直播间'
    try {
      const res: any = await anonymousLookup(q, scoped ? String(scopeId.value) : undefined)
      results.value = res?.users || (Array.isArray(res) ? res : [])
      queryError.value = ''
    } catch (e) {
      results.value = []
      queryError.value = apiErrorMessage(e, '查询失败')
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

  /** 库内别名去掉与当前显示昵称相同的那条（否则昵称旁边会贴一个一模一样的标签） */
  function otherNicknames(u: any): string[] {
    const cur = u?.nickname || ''
    return (u?.db_nicknames || []).filter((n: string) => n && n !== cur)
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
