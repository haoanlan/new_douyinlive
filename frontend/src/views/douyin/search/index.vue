<!--
  信息查询（原「匿名查询」）—— 按「查询台」重设计：

  结构契约：
    1. Hero 查询台：大输入 + 范围/排序内联 + 热词 chips；右侧竖排聚合大数字
       （匹配用户/参与场次/累计钻石）。引导态与结果态共用 hero，不再有独立引导卡。
    2. 结果区：单栏信息流（一个容器 + 分隔行），不是两列胖卡片网格。
       「仅进场记录」用带计数的分组分隔线 —— 把排序规则变成可见的结构。
    3. 范围下拉把 streamer_id 传给后端缩圈（SQL 少扫 + 抖音接口补全调用变少）。
-->
<template>
  <div class="douyin-page p-4">
    <!-- ===== 查询台 hero ===== -->
    <div class="art-card dy-query-hero p-5 mb-5">
      <div class="flex gap-6 flex-wrap lg:flex-nowrap">
        <!-- 左：标题 + 说明 + 大输入 + 次级控制 + 热词 -->
        <div class="flex-1 min-w-0">
          <div class="flex items-center gap-2.5">
            <div class="size-9 rounded-lg flex-cc bg-theme/10 shrink-0">
              <ArtSvgIcon icon="ri:user-search-line" class="text-base text-theme" />
            </div>
            <div class="text-xl font-semibold text-g-900">信息查询</div>
          </div>
          <p class="text-sm text-g-500 mt-2 leading-relaxed">
            按昵称关键词检索本库的弹幕、礼物与进场记录；结果太多时先选一个直播间缩小范围。
          </p>

          <div class="flex items-center gap-2.5 mt-4">
            <el-input
              v-model="query"
              size="large"
              placeholder="输入昵称关键词，回车查询"
              clearable
              class="query-input flex-1"
              @keyup.enter="doSearch"
            >
              <template #prefix>
                <ArtSvgIcon icon="ri:search-line" class="text-g-400" />
              </template>
            </el-input>
            <el-button type="primary" size="large" :loading="loading" @click="doSearch">
              查询
            </el-button>
          </div>

          <div class="flex items-center gap-2 mt-3 flex-wrap">
            <!-- 范围：默认全部直播间；选中具体房间 → 后端按 streamer_id 缩圈 -->
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
          </div>

          <div class="flex items-center gap-2 mt-3 flex-wrap">
            <span class="text-xs text-g-500 shrink-0">热门关键词</span>
            <button
              v-for="kw in hotKeywords"
              :key="kw"
              class="dy-pressable px-2.5 h-7 rounded-lg text-xs text-g-700 bg-g-100/70 hover:bg-theme/10 hover:text-theme"
              @click="quickSearch(kw)"
            >
              {{ kw }}
            </button>
          </div>
        </div>

        <!-- 右：查询聚合（结果态） / 查询提示（待查询态） -->
        <aside
          class="w-full lg:w-56 shrink-0 flex flex-col justify-center gap-4 lg:border-l lg:border-g-100 lg:pl-6"
        >
          <template v-if="searched && !queryError">
            <div>
              <div class="text-xs text-g-500">匹配用户</div>
              <div class="text-2xl font-semibold text-g-900 leading-tight mt-0.5">
                {{ fmtNum(users.length) }}
              </div>
            </div>
            <div>
              <div class="text-xs text-g-500">参与场次</div>
              <div class="text-2xl font-semibold text-g-900 leading-tight mt-0.5">
                {{ fmtNum(totalSessions) }}
              </div>
            </div>
            <div>
              <div class="text-xs text-g-500">累计钻石</div>
              <div
                class="text-2xl font-semibold leading-tight mt-0.5"
                :class="totalDiamonds ? 'text-theme' : 'text-g-400'"
                :title="fmtTitle(totalDiamonds)"
              >
                {{ fmtNum(totalDiamonds) }}
              </div>
            </div>
          </template>
          <div v-else class="flex flex-col gap-2.5 text-xs text-g-500 leading-relaxed">
            <div class="flex gap-1.5">
              <ArtSvgIcon icon="ri:information-line" class="text-g-400 mt-0.5 shrink-0" />
              <span>查询会调用抖音接口补全用户资料，人数较多时分批请求，请稍候</span>
            </div>
            <div class="flex gap-1.5">
              <ArtSvgIcon icon="ri:scan-line" class="text-g-400 mt-0.5 shrink-0" />
              <span>先选一个直播间再查，能明显减少命中人数与接口调用量</span>
            </div>
          </div>
        </aside>
      </div>
    </div>

    <!-- ===== 结果区 ===== -->
    <div v-if="searched" v-loading="loading" element-loading-text="查询中…">
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

      <!-- 单栏信息流 -->
      <div v-else class="art-card p-0">
        <div
          class="flex items-center justify-between gap-3 px-5 py-3.5 border-b border-g-100 flex-wrap"
        >
          <span class="text-sm text-g-600">
            共 <b class="text-g-900">{{ sortedUsers.length }}</b> 个用户
            <span v-if="lastScope" class="text-g-400">· {{ lastScope }}</span>
          </span>
          <el-button size="small" text @click="doSearch">
            <ArtSvgIcon icon="ri:refresh-line" class="mr-1" />
            重新查询
          </el-button>
        </div>

        <!-- 有互动的用户（完整展示） -->
        <template v-if="interactiveUsers.length">
          <ResultRow
            v-for="u in interactiveUsers"
            :key="u.sec_uid || u.nickname"
            :user="u"
            @open-profile="openProfile(u.sec_uid)"
            @open-session="openSession"
          />
        </template>

        <!-- 仅进场记录：分组分隔线 = 排序规则的可视化 -->
        <div
          v-if="entryOnlyUsers.length"
          class="flex items-center gap-2 px-5 py-2 bg-g-100/50 border-y border-g-100 text-xs text-g-500"
        >
          <ArtSvgIcon icon="ri:door-open-line" class="text-g-400" />
          仅进场记录 · {{ entryOnlyUsers.length }} 人（没有弹幕与送礼，排在最后）
        </div>
        <ResultRow
          v-for="u in entryOnlyUsers"
          :key="u.sec_uid || u.nickname"
          :user="u"
          @open-profile="openProfile(u.sec_uid)"
          @open-session="openSession"
        />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
  import { computed, onMounted, ref } from 'vue'
  import { useRouter } from 'vue-router'
  import { anonymousLookup, fetchStreamers, type Streamer } from '@/api/douyin'
  import { fmtNum, fmtTitle } from '@/utils/format'
  import { apiErrorMessage } from '@/utils/douyin-error'
  import ResultRow from './modules/result-row.vue'

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

  const interactiveUsers = computed(() => sortedUsers.value.filter((u) => !isEntryOnly(u)))
  const entryOnlyUsers = computed(() => sortedUsers.value.filter(isEntryOnly))

  /**
   * 信息查询。
   *
   * P0-3 修复点：失败单独进入错误态（带重试），
   * 空结果只在真的查成功且为空时出现，不把网络失败伪装成「没有这个人」。
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

  function openProfile(secUid?: string) {
    if (secUid) router.push(`/douyin/profile/${secUid}`)
  }

  function openSession(id: number) {
    router.push(`/douyin/detail/${id}`)
  }
</script>

<style scoped lang="scss">
  /*
   * 查询台专属控件样式：原 dy-toolbar 的控件口径（灰底、10px 圆角、聚焦反描边）
   * 迁到这里 —— 本页不再用 dy-toolbar 类，样式必须跟着容器走，
   * 否则输入框会退回 element-plus 默认的 4px 白底，与全站口径分裂。
   */
  .dy-query-hero {
    :deep(.el-input__wrapper),
    :deep(.el-select__wrapper) {
      border-radius: 10px;
    }

    :deep(.el-input__wrapper) {
      background: var(--art-gray-100);
      box-shadow: none;
      transition: box-shadow 0.2s ease;
    }

    :deep(.el-input__wrapper:hover) {
      box-shadow: 0 0 0 1px var(--art-gray-400) inset;
    }

    :deep(.el-input__wrapper.is-focus) {
      box-shadow: 0 0 0 1px var(--theme-color) inset;
    }

    :deep(.el-button) {
      border-radius: 10px;
    }
  }
</style>
