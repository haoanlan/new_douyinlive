<template>
  <div class="douyin-page dy-stagger p-4">
    <!-- 工具条 -->
    <div class="dy-toolbar art-card combined-toolbar mb-5 flex items-center justify-between gap-4 flex-wrap">
      <div class="flex items-center gap-2.5 min-w-0">
        <span class="font-bold text-g-900 shrink-0">数据合并查看</span>
        <span class="text-xs text-g-500 truncate">
          跨主播挑场次，合起来看成一份数据 · 共 {{ totalSessions }} 场可选
        </span>
      </div>
      <div class="dy-toolbar-actions">
        <el-button :loading="loading" @click="refresh">
          <ArtSvgIcon icon="ri:refresh-line" class="mr-1" />刷新
        </el-button>
        <el-button v-if="selectedIds.size" @click="clearSelection">清空选择</el-button>
      </div>
    </div>

    <!-- 失败：与「没有数据」区分开，并给重试入口（与其它抖音页一致） -->
    <QueryErrorState
      v-if="queryError && !loading"
      class="mb-5"
      :message="queryError"
      :retrying="loading"
      @retry="refresh"
    />

    <!-- 首屏骨架：与真实卡片同形，避免数据到达时整块高度跳变 -->
    <div v-else-if="loading && !groups.length" class="flex flex-col gap-5">
      <div v-for="i in 3" :key="i" class="art-card p-5">
        <div class="flex items-center gap-3">
          <el-skeleton-item variant="circle" style="width: 40px; height: 40px" />
          <div class="flex-1 min-w-0">
            <el-skeleton-item variant="h3" style="width: 34%" />
            <el-skeleton-item variant="text" style="width: 22%; margin-top: 8px" />
          </div>
          <el-skeleton-item variant="button" style="width: 64px" />
        </div>
        <div v-for="j in 3" :key="j" class="mt-3 rounded-xl bg-g-100/50 px-4 py-3">
          <el-skeleton-item variant="text" style="width: 58%" />
        </div>
      </div>
    </div>

    <!-- 没有主播可合并 -->
    <div v-else-if="!groups.length" class="art-card px-5 py-8 mb-5">
      <div class="flex flex-col items-center text-center">
        <div class="size-11 rounded-full flex-cc bg-theme/10 mb-3">
          <ArtSvgIcon icon="ri:merge-cells-horizontal" class="text-xl text-theme" />
        </div>
        <div class="text-sm font-medium text-g-900">暂无可合并的主播</div>
        <p class="mt-1.5 text-xs text-g-600">
          监控列表里还没有主播，先到「房间管理」添加一个直播间。
        </p>
        <el-button class="mt-4" type="primary" plain @click="router.push('/douyin/rooms')">
          <ArtSvgIcon icon="ri:arrow-left-line" class="mr-1" />
          去房间管理
        </el-button>
      </div>
    </div>

    <!-- 每个主播一张卡：卡内是该主播的场次（组内按开始时间倒序） -->
    <el-row v-else :gutter="20">
      <el-col v-for="g in groups" :key="String(g.streamer.id)" :xs="24" :md="12" :xl="8">
        <div class="art-card p-5 mb-5 flex flex-col">
          <!-- 卡头：主播名 + 场次数 / 总钻石 / 已选 x/y + 全选 -->
          <div class="flex items-center gap-3">
            <el-avatar :size="40" :src="avatarSrc(g.streamer.avatar)" class="shrink-0">
              {{ g.streamer.name?.[0] || '播' }}
            </el-avatar>
            <div class="min-w-0 flex-1">
              <div class="text-sm font-bold text-g-900 truncate" :title="g.streamer.name">
                {{ g.streamer.name }}
              </div>
              <div class="text-xs text-g-500 mt-1 flex items-center gap-x-3 gap-y-1 flex-wrap">
                <span>{{ g.sessions.length }} 场</span>
                <span class="flex items-center gap-1" :title="fmtFull(g.totalDiamonds)">
                  <ArtSvgIcon icon="ri:diamond-line" class="text-g-400" />{{
                    fmtNum(g.totalDiamonds)
                  }}
                </span>
                <span :class="selectedInGroup(g) ? 'text-theme font-medium' : ''">
                  已选 {{ selectedInGroup(g) }}/{{ g.sessions.length }}
                </span>
              </div>
            </div>
            <el-button v-if="g.sessions.length" class="shrink-0" @click="toggleGroup(g)">
              {{ allSelectedInGroup(g) ? '取消全选' : '全选' }}
            </el-button>
          </div>

          <!-- 场次行 -->
          <div class="flex flex-col gap-2.5 mt-4">
            <div
              v-for="s in visibleSessions(g)"
              :key="s.id"
              class="dy-row-link combined-row flex flex-col rounded-xl bg-g-100/50 px-4 py-2.5 c-p"
              :class="selectedIds.has(s.id) ? 'combined-row--on' : ''"
              @click="toggle(s.id)"
            >
              <div class="flex items-center gap-2.5">
                <el-checkbox
                  class="-ml-1 shrink-0"
                  :model-value="selectedIds.has(s.id)"
                  :aria-label="`选择场次 #${s.id}`"
                  @click.stop
                  @change="toggle(s.id)"
                />
                <span class="flex-1 min-w-0 text-sm text-g-800 truncate">
                  {{ fmtSessionRange(s.started_at, s.ended_at) }}
                </span>
                <el-tag
                  v-if="s.is_live"
                  type="danger"
                  size="small"
                  effect="light"
                  class="!border-none shrink-0"
                >
                  直播中
                </el-tag>
              </div>
              <div class="flex items-center gap-4 mt-1.5 pl-6 text-xs text-g-500 flex-wrap">
                <span class="flex items-center gap-1" :title="fmtFull(s.total_diamonds)">
                  <ArtSvgIcon icon="ri:diamond-line" class="text-g-400" />{{
                    fmtNum(s.total_diamonds)
                  }}
                </span>
                <span class="flex items-center gap-1" :title="fmtFull(s.gift_count)">
                  <ArtSvgIcon icon="ri:gift-2-line" class="text-g-400" />{{
                    fmtNum(s.gift_count)
                  }}
                </span>
                <span class="flex items-center gap-1" :title="fmtFull(s.danmaku_count)">
                  <ArtSvgIcon icon="ri:chat-3-line" class="text-g-400" />{{
                    fmtNum(s.danmaku_count)
                  }}
                </span>
              </div>
            </div>

            <div v-if="!g.sessions.length" class="text-xs text-g-500 py-2">该主播暂无场次</div>

            <!-- 场次多时先收起：一个主播可能上百场，全铺开会把页面拉成几十屏 -->
            <el-button
              v-if="g.sessions.length > COLLAPSED_COUNT"
              class="self-start"
              text
              bg
              @click="toggleExpand(g)"
            >
              <ArtSvgIcon
                :icon="expandedIds.has(keyOf(g)) ? 'ri:arrow-up-s-line' : 'ri:arrow-down-s-line'"
                class="mr-1"
              />
              {{ expandedIds.has(keyOf(g)) ? '收起' : `展开全部 ${g.sessions.length} 场` }}
            </el-button>
          </div>
        </div>
      </el-col>
    </el-row>

    <!-- 底部浮动操作条：只在有场次可选时出现 -->
    <div v-if="groups.length" class="dy-combined-bar">
      <div class="flex items-center gap-3 min-w-0">
        <span class="text-sm text-g-700 shrink-0">
          已选 <b class="text-theme">{{ selectedIds.size }}</b> 场
        </span>
        <el-button v-if="selectedIds.size" text @click="clearSelection">清空</el-button>
      </div>
      <!--
        点击兜底：Element 的 disabled 按钮在 Chrome 里**不派发 click**，
        所以「未满 2 场时点一下要提示」这条靠外层 span 接住 ——
        锁定态给按钮加 pointer-events:none，事件就落到这层 span 上。
      -->
      <span class="dy-combined-bar__cta" @click="onMergeClick">
        <el-button
          type="primary"
          class="dy-combined-bar__btn"
          :class="{ 'is-locked': selectedIds.size < 2 }"
          :disabled="selectedIds.size < 2 || merging"
          :loading="merging"
          @click="viewCombined"
        >
          <ArtSvgIcon icon="ri:merge-cells-horizontal" class="mr-1" />
          查看合并
        </el-button>
      </span>
    </div>

    <!-- ===================== 合并结果弹窗 ===================== -->
    <el-dialog
      v-model="dialogVisible"
      width="820"
      class="dy-combined-dialog"
      align-center
      :close-on-click-modal="false"
    >
      <template #header>
        <div class="flex items-center gap-3">
          <div class="size-10 rounded-lg flex-cc bg-theme/10 shrink-0">
            <ArtSvgIcon icon="ri:merge-cells-horizontal" class="text-lg text-theme" />
          </div>
          <div class="min-w-0 flex-1">
            <div class="text-base font-medium text-g-900">数据合并结果</div>
            <div class="text-xs text-g-500 mt-0.5 truncate">
              <template v-if="result">
                已合并 {{ result.session_ids.length }} 场直播 · 场次
                {{ result.session_ids.join('、') }}
              </template>
              <template v-else>正在合并 {{ pendingIds.length }} 场直播的数据…</template>
            </div>
          </div>
        </div>
      </template>

      <!-- 合并中 -->
      <div v-if="merging && !result" class="flex flex-col gap-4">
        <el-row :gutter="16">
          <el-col v-for="i in 4" :key="i" :xs="12" :sm="6">
            <div class="rounded-xl bg-g-100/50 h-20 mb-4"></div>
          </el-col>
        </el-row>
        <el-skeleton :rows="6" animated />
      </div>

      <!-- 失败：留在弹窗里给重试，而不是关掉弹窗只弹一条 toast -->
      <QueryErrorState
        v-else-if="mergeError"
        :message="mergeError"
        :retrying="merging"
        @retry="viewCombined"
      />

      <template v-else-if="result">
        <!-- 4 张统计卡 -->
        <el-row :gutter="16">
          <el-col v-for="c in statCards" :key="c.label" :xs="12" :sm="6">
            <div class="art-card h-20 mb-4 flex items-center justify-between px-4" :title="c.title">
              <div class="min-w-0">
                <div class="text-xs text-g-500">{{ c.label }}</div>
                <div class="text-[20px] font-medium text-g-900 mt-1 leading-none truncate">
                  {{ c.value }}
                </div>
              </div>
              <div class="size-9 rounded-lg flex-cc bg-theme/10 shrink-0">
                <ArtSvgIcon :icon="c.icon" class="text-base text-theme" />
              </div>
            </div>
          </el-col>
        </el-row>

        <!-- 三个榜单 -->
        <el-tabs v-model="activeTab" class="combined-tabs">
          <el-tab-pane label="礼物排行" name="gifts">
            <div class="text-xs text-g-500 mb-2 truncate">
              按送礼钻石降序 Top {{ result.gifts.length }} · 同一用户跨场次已合并
            </div>
            <div class="flex flex-col gap-2.5 max-h-[420px] overflow-y-auto pr-1">
              <div
                v-for="(g, i) in result.gifts"
                :key="g.user_sec_uid || g.nickname"
                class="dy-rank-row flex items-center gap-3 rounded-xl bg-g-100/50 px-3 py-2"
              >
                <span
                  class="w-6 h-6 rounded-md flex-cc text-xs font-bold shrink-0"
                  :class="rankClass(i)"
                  >{{ i + 1 }}</span
                >
                <el-avatar :size="32" :src="avatarSrc(g.avatar_url)" class="shrink-0">
                  {{ g.nickname?.[0] || '?' }}
                </el-avatar>
                <span class="flex-1 min-w-0 truncate text-sm text-g-800">{{ g.nickname }}</span>
                <div class="text-right shrink-0">
                  <div class="text-sm font-bold text-theme" :title="fmtFull(g.total_diamonds)">
                    {{ fmtFull(g.total_diamonds) }}
                  </div>
                  <div class="text-xs text-g-500">{{ fmtFull(g.gift_count) }} 个礼物</div>
                </div>
              </div>
              <div v-if="!result.gifts.length" class="text-xs text-g-500 py-6 text-center">
                所选场次暂无礼物数据
              </div>
            </div>
          </el-tab-pane>

          <el-tab-pane label="主播排行" name="anchors">
            <div class="text-xs text-g-500 mb-2 truncate">
              团播场景里的每个主播 · 共 {{ result.anchorRanking.length }} 位
            </div>
            <div class="flex flex-col gap-2.5 max-h-[420px] overflow-y-auto pr-1">
              <div
                v-for="(a, i) in result.anchorRanking"
                :key="a.anchor_sec_uid || a.anchor_name"
                class="dy-rank-row flex items-center gap-3 rounded-xl bg-g-100/50 px-3 py-2"
              >
                <span
                  class="w-6 h-6 rounded-md flex-cc text-xs font-bold shrink-0"
                  :class="rankClass(i)"
                  >{{ i + 1 }}</span
                >
                <el-avatar :size="32" :src="avatarSrc(a.anchor_avatar)" class="shrink-0">
                  {{ a.anchor_name?.[0] || '?' }}
                </el-avatar>
                <span class="flex-1 min-w-0 truncate text-sm text-g-800">{{ a.anchor_name }}</span>
                <div class="text-right shrink-0">
                  <div class="text-sm font-bold text-theme" :title="fmtFull(a.total_diamonds)">
                    {{ fmtFull(a.total_diamonds) }}
                  </div>
                  <div class="text-xs text-g-500">{{ fmtFull(a.user_count) }} 人送礼</div>
                </div>
              </div>
              <div v-if="!result.anchorRanking.length" class="text-xs text-g-500 py-6 text-center">
                所选场次暂无主播数据
              </div>
            </div>
          </el-tab-pane>

          <el-tab-pane label="弹幕排行" name="danmaku">
            <div class="text-xs text-g-500 mb-2 truncate">
              按发言条数降序 Top {{ result.danmakuRanking.length }} · 同一用户跨场次已合并
            </div>
            <div class="flex flex-col gap-2.5 max-h-[420px] overflow-y-auto pr-1">
              <div
                v-for="(d, i) in result.danmakuRanking"
                :key="d.user_sec_uid || d.nickname"
                class="dy-rank-row flex items-center gap-3 rounded-xl bg-g-100/50 px-3 py-2"
              >
                <span
                  class="w-6 h-6 rounded-md flex-cc text-xs font-bold shrink-0"
                  :class="rankClass(i)"
                  >{{ i + 1 }}</span
                >
                <el-avatar :size="32" :src="avatarSrc(d.avatar)" class="shrink-0">
                  {{ d.nickname?.[0] || '?' }}
                </el-avatar>
                <span class="flex-1 min-w-0 truncate text-sm text-g-800">{{ d.nickname }}</span>
                <span class="text-sm font-bold text-g-800 shrink-0">
                  {{ fmtFull(d.msg_count) }} 条
                </span>
              </div>
              <div
                v-if="!result.danmakuRanking.length"
                class="text-xs text-g-500 py-6 text-center"
              >
                所选场次暂无弹幕数据
              </div>
            </div>
          </el-tab-pane>
        </el-tabs>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
  import { computed, onActivated, onMounted, ref } from 'vue'
  import { useRouter } from 'vue-router'
  import { ElMessage } from 'element-plus'
  import {
    fetchCombinedSessions,
    fetchSessions,
    fetchStreamers,
    type CombinedResult,
    type Session,
    type Streamer
  } from '@/api/douyin'
  import { apiErrorMessage } from '@/utils/douyin-error'
  import { fmtFull, fmtNum, fmtSessionRange, rankClass, toDate } from '@/utils/format'

  /*
   * keep-alive 的匹配靠组件 name（与路由 name 一致）。
   * 路由 meta 里写了 keepAlive: true，名字对不上缓存就静默失效。
   */
  defineOptions({ name: 'DouyinCombined' })

  /** 卡片里默认展示几场；超出的收起，避免「一个主播 147 场」把页面拉成几十屏 */
  const COLLAPSED_COUNT = 5

  /** 一个主播 + 它的场次（组内已按开始时间倒序） */
  interface StreamerGroup {
    streamer: Streamer
    sessions: Session[]
    totalDiamonds: number
  }

  const router = useRouter()

  const groups = ref<StreamerGroup[]>([])
  const loading = ref(true)
  /** 取数失败的真实原因；非空时显示错误态而不是空态 */
  const queryError = ref('')

  /** 已勾选的场次 id（Set 让 toggle 是 O(1)；每次都换一个新 Set，响应式不依赖集合插桩） */
  const selectedIds = ref<Set<number>>(new Set())
  /** 已「展开全部」的主播（key = streamer.id） */
  const expandedIds = ref<Set<number>>(new Set())

  const merging = ref(false)
  const mergeError = ref('')
  const dialogVisible = ref(false)
  const result = ref<CombinedResult | null>(null)
  /** 正在合并的场次 id（弹窗头部在结果到达前用它显示进度） */
  const pendingIds = ref<number[]>([])
  const activeTab = ref('gifts')

  const totalSessions = computed(() => groups.value.reduce((s, g) => s + g.sessions.length, 0))

  const statCards = computed(() => {
    const s = result.value?.summary
    return [
      {
        label: '总钻石',
        icon: 'ri:diamond-line',
        value: fmtNum(s?.total_diamonds),
        title: `精确值 ${fmtFull(s?.total_diamonds)}`
      },
      {
        label: '总礼物',
        icon: 'ri:gift-2-line',
        value: fmtNum(s?.total_gifts),
        title: `精确值 ${fmtFull(s?.total_gifts)}`
      },
      {
        label: '总弹幕',
        icon: 'ri:chat-3-line',
        value: fmtNum(s?.total_danmaku),
        title: `精确值 ${fmtFull(s?.total_danmaku)}`
      },
      {
        label: '独立用户',
        /*
         * 口径必须写清楚：后端是把每场的预聚合 agg_users 相加（sessions.js:416），
         * 同一个人看了两场会被算两次 —— 不能读成「跨场次去重后的独立用户」。
         */
        icon: 'ri:user-3-line',
        value: fmtNum(s?.user_count),
        title: `各场次用户数之和（未跨场次去重）精确值 ${fmtFull(s?.user_count)}`
      }
    ]
  })

  const keyOf = (g: StreamerGroup) => Number(g.streamer.id)

  function selectedInGroup(g: StreamerGroup) {
    return g.sessions.filter((s) => selectedIds.value.has(s.id)).length
  }

  function allSelectedInGroup(g: StreamerGroup) {
    return g.sessions.length > 0 && selectedInGroup(g) === g.sessions.length
  }

  function visibleSessions(g: StreamerGroup) {
    if (g.sessions.length <= COLLAPSED_COUNT) return g.sessions
    return expandedIds.value.has(keyOf(g)) ? g.sessions : g.sessions.slice(0, COLLAPSED_COUNT)
  }

  /** 场次开始时间 → 毫秒；解析不出来给 0（排在最后，不炸排序） */
  function startMs(s: Session) {
    return toDate(s.started_at)?.getTime() ?? 0
  }

  /**
   * el-avatar 的 src 只接受 `string | undefined`，而后端这几个头像字段**实测会返回 null**
   * （主播头像尤其常见）。类型保留 `| null` 保持诚实，在这里统一收口成 undefined
   * —— 不写成 `|| undefined` 散在模板里十几处，改的时候容易漏。
   */
  function avatarSrc(url?: string | null): string | undefined {
    return url || undefined
  }

  /**
   * 拉主播列表 → **并发**拉每个主播的场次 → 按主播分组。
   *
   * 单个主播的场次接口失败**不拖垮整页**：那一组给空列表，
   * 其它主播照常可选（否则一个主播挂了整个合并功能就没了）。
   */
  async function refresh() {
    const isFirst = !groups.value.length
    if (isFirst) loading.value = true
    try {
      const streamers = await fetchStreamers()
      const list = Array.isArray(streamers) ? streamers : []
      const settled = await Promise.all(
        list.map(async (streamer) => {
          try {
            const rows = await fetchSessions(String(streamer.id))
            return { streamer, sessions: Array.isArray(rows) ? rows : [] }
          } catch {
            return { streamer, sessions: [] as Session[] }
          }
        })
      )
      groups.value = settled.map(({ streamer, sessions }) => ({
        streamer,
        // 组内按开始时间倒序（最近的场次排最上面）
        sessions: [...sessions].sort((a, b) => startMs(b) - startMs(a)),
        totalDiamonds: sessions.reduce((s, x) => s + (x.total_diamonds || 0), 0)
      }))
      // 刷新后可能有的场次没了：把失效的选择清掉，避免「已选 N 场」与实际不符
      const alive = new Set(groups.value.flatMap((g) => g.sessions.map((s) => s.id)))
      selectedIds.value = new Set([...selectedIds.value].filter((id) => alive.has(id)))
      queryError.value = ''
    } catch (e) {
      queryError.value = apiErrorMessage(e, '主播列表加载失败')
    } finally {
      loading.value = false
    }
  }

  function toggle(id: number) {
    const next = new Set(selectedIds.value)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    selectedIds.value = next
  }

  function toggleGroup(g: StreamerGroup) {
    const next = new Set(selectedIds.value)
    if (allSelectedInGroup(g)) g.sessions.forEach((s) => next.delete(s.id))
    else g.sessions.forEach((s) => next.add(s.id))
    selectedIds.value = next
  }

  function toggleExpand(g: StreamerGroup) {
    const next = new Set(expandedIds.value)
    const k = keyOf(g)
    if (next.has(k)) next.delete(k)
    else next.add(k)
    expandedIds.value = next
  }

  function clearSelection() {
    selectedIds.value = new Set()
  }

  /** 外层容器的点击兜底：锁定态的按钮收不到 click（disabled），由这里给提示 */
  function onMergeClick() {
    if (selectedIds.value.size >= 2) return
    ElMessage.warning('请至少选择 2 个场次')
  }

  async function viewCombined() {
    const ids = [...selectedIds.value]
    if (ids.length < 2) {
      ElMessage.warning('请至少选择 2 个场次')
      return
    }
    if (merging.value) return
    pendingIds.value = ids
    merging.value = true
    mergeError.value = ''
    result.value = null
    activeTab.value = 'gifts'
    dialogVisible.value = true
    try {
      result.value = await fetchCombinedSessions(ids)
    } catch (e) {
      mergeError.value = apiErrorMessage(e, '合并失败')
    } finally {
      merging.value = false
    }
  }

  // keep-alive：切回来时刷新一次（首次挂载 mounted 与 activated 都会触发，跳过重复请求）
  let activatedOnce = false
  onMounted(() => {
    refresh()
  })
  onActivated(() => {
    if (!activatedOnce) {
      activatedOnce = true
      return
    }
    refresh()
  })
</script>

<style scoped>
  /*
   * 场次行：整行可点（复选框仍是真正可聚焦的控件，键盘/读屏走它）。
   * hover/焦点反馈复用全局 `.dy-row-link`。
   */
  .combined-row {
    border: 1px solid transparent;
    transition:
      background-color var(--dy-dur-fast) ease,
      border-color var(--dy-dur-fast) ease;
  }

  /* 选中态：主题色描边 + 加深一档灰底。用现成的 CSS 变量，不引入 color-mix 之类的新语法 */
  .combined-row--on {
    background-color: var(--art-gray-200);
    border-color: var(--theme-color);
  }

  /*
   * 底部浮动操作条。
   *
   * 故意**不挂** `.art-card` / `.dy-toolbar`：那两个类会被 mobile-check 的
   * 「卡片左右边与页面容器对齐」扫描命中，而固定定位的元素左右边天然不等宽，
   * 会被误报成对齐问题。这里自带一套卡面样式（同一个 --default-box-color 底色）。
   */
  .dy-combined-bar {
    position: fixed;
    left: 50%;
    bottom: 24px;
    z-index: 20;
    transform: translateX(-50%);
    display: flex;
    align-items: center;
    gap: 16px;
    max-width: calc(100vw - 24px);
    padding: 10px 16px;
    background: var(--default-box-color);
    border: 1px solid var(--art-gray-200);
    border-radius: 12px;
    box-shadow: 0 6px 24px rgb(0 0 0 / 12%);
  }

  /* 锁定态：让 click 穿过按钮落到外层 span 上，「点一下给提示」才生效 */
  .dy-combined-bar__btn.is-locked {
    pointer-events: none;
  }

  .dy-combined-bar__cta {
    display: inline-flex;
  }

  :deep(.combined-tabs .el-tabs__item) {
    font-size: 14px;
  }

  :deep(.combined-tabs .el-tabs__nav-wrap::after) {
    height: 1px;
  }

  @media (max-width: 640px) {
    .dy-combined-bar {
      left: 12px;
      right: 12px;
      bottom: 12px;
      transform: none;
      justify-content: space-between;
      gap: 10px;
      padding: 8px 12px;
    }
  }
</style>
