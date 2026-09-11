<template>
  <div v-loading="loading" class="p-4" element-loading-text="加载中…">
    <el-breadcrumb class="mb-5" separator="/">
      <el-breadcrumb-item :to="{ path: '/douyin/rooms' }">
        <ArtSvgIcon icon="ri:home-4-line" class="text-sm text-g-500" /> 房间管理
      </el-breadcrumb-item>
      <el-breadcrumb-item
        :to="streamerId ? { path: '/douyin/sessions', query: { hostId: streamerId } } : undefined"
        >场次历史</el-breadcrumb-item
      >
      <el-breadcrumb-item>{{
        detail?.session?.room_title || detail?.session?.title || '场次详情'
      }}</el-breadcrumb-item>
    </el-breadcrumb>

    <!-- 场次头部 -->
    <div class="art-card px-5 py-4 mb-5 flex items-center justify-between gap-4 flex-wrap">
      <div class="flex items-center gap-3.5 min-w-0">
        <el-avatar :size="48" :src="detail?.session?.streamer_avatar" class="shrink-0">{{
          detail?.session?.streamer_name?.[0] || '场'
        }}</el-avatar>
        <div class="min-w-0">
          <div class="flex items-center gap-2">
            <span class="text-[17px] font-bold text-g-900 truncate">
              {{ detail?.session?.room_title || detail?.session?.title || '场次详情' }}
            </span>
            <el-tag v-if="detail?.session?.is_live" type="danger" size="small" class="!border-none"
              >直播中</el-tag
            >
          </div>
          <div class="text-xs text-g-500 mt-1 truncate">
            {{ detail?.session?.streamer_name || '' }}
            <template v-if="detail?.session?.start_time">
              · {{ fmtTime(detail.session.start_time) }}
            </template>
          </div>
        </div>
      </div>
      <el-button @click="refresh">
        <ArtSvgIcon icon="ri:refresh-line" class="mr-1" />刷新
      </el-button>
    </div>

    <!-- 统计卡片 -->
    <ElRow :gutter="20">
      <ElCol v-for="stat in statCards" :key="stat.label" :xs="12" :sm="8" :md="8" :lg="4">
        <div class="art-card flex items-center justify-between h-20 px-5 mb-5">
          <div class="min-w-0">
            <div class="text-xs text-g-500">{{ stat.label }}</div>
            <div class="text-[20px] font-medium text-g-900 mt-1 leading-none truncate">
              {{ stat.value }}
            </div>
          </div>
          <div class="size-9 rounded-lg flex-cc bg-theme/10 shrink-0">
            <ArtSvgIcon :icon="stat.icon" class="text-base text-theme" />
          </div>
        </div>
      </ElCol>
    </ElRow>

    <el-row :gutter="20">
      <el-col :sm="24" :md="8">
        <div class="flex flex-col gap-5 h-full">
          <div class="art-card p-5">
            <div class="art-card-header">
              <div class="title">
                <h4>礼物排行</h4>
                <p>钻石 Top</p>
              </div>
            </div>
            <div class="flex flex-col gap-2.5 mt-4 max-h-[360px] overflow-y-auto pr-1">
              <div
                v-for="(u, i) in detail?.gifts || []"
                :key="u.nickname"
                class="flex items-center gap-3 rounded-xl bg-g-100/50 px-3 py-2 c-p hover:bg-g-100/70 transition-colors"
                @click="openGiftDetail(u)"
              >
                <span
                  class="w-6 h-6 rounded-md flex-cc text-xs font-bold shrink-0"
                  :class="rankClass(i)"
                  >{{ i + 1 }}</span
                >
                <el-avatar :size="32" :src="u.avatar_url" class="shrink-0">{{
                  u.nickname?.[0]
                }}</el-avatar>
                <span class="flex-1 min-w-0 truncate text-sm text-g-800">{{ u.nickname }}</span>
                <span class="text-sm font-bold text-theme shrink-0">{{
                  fmtNum(u.total_diamonds)
                }}</span>
              </div>
              <el-empty v-if="!detail?.gifts?.length" description="暂无礼物" :image-size="60" />
            </div>
          </div>
          <div class="art-card p-5">
            <div class="art-card-header">
              <div class="title">
                <h4>团播主播排名</h4>
                <p>累计钻石</p>
              </div>
            </div>
            <div class="flex flex-col gap-2.5 mt-4 max-h-[320px] overflow-y-auto pr-1">
              <div
                v-for="(a, i) in detail?.anchorRanking || []"
                :key="a.anchor_name"
                class="flex items-center gap-3 rounded-xl bg-g-100/50 px-3 py-2 c-p hover:bg-g-100/70 transition-colors"
                @click="openAnchorPeopleList(a)"
              >
                <span
                  class="w-6 h-6 rounded-md flex-cc text-xs font-bold shrink-0"
                  :class="rankClass(i)"
                  >{{ i + 1 }}</span
                >
                <el-avatar :size="32" :src="a.anchor_avatar" class="shrink-0">{{
                  a.anchor_name?.[0]
                }}</el-avatar>
                <span class="flex-1 min-w-0 truncate text-sm text-g-800">{{ a.anchor_name }}</span>
                <span class="text-sm font-bold text-theme shrink-0">{{
                  fmtNum(a.total_diamonds)
                }}</span>
              </div>
              <el-empty
                v-if="!detail?.anchorRanking?.length"
                description="暂无主播数据"
                :image-size="60"
              />
            </div>
          </div>
          <div class="art-card p-5">
            <div class="art-card-header">
              <div class="title">
                <h4>弹幕排行</h4>
                <p>发言次数 Top 20</p>
              </div>
            </div>
            <div class="flex flex-col gap-2.5 mt-4 max-h-[320px] overflow-y-auto pr-1">
              <div
                v-for="(d, i) in (detail?.danmakuRanking || []).slice(0, 20)"
                :key="d.nickname"
                class="flex items-center gap-3 rounded-xl bg-g-100/50 px-3 py-2"
              >
                <span
                  class="w-6 h-6 rounded-md flex-cc text-xs font-bold shrink-0"
                  :class="rankClass(i)"
                  >{{ i + 1 }}</span
                >
                <el-avatar :size="26" :src="d.avatar" class="shrink-0">{{
                  d.nickname?.[0]
                }}</el-avatar>
                <span class="flex-1 min-w-0 truncate text-sm text-g-800">{{ d.nickname }}</span>
                <span class="text-sm font-bold text-g-800 shrink-0">{{ d.msg_count }}条</span>
              </div>
              <el-empty
                v-if="!detail?.danmakuRanking?.length"
                description="暂无弹幕"
                :image-size="60"
              />
            </div>
          </div>
        </div>
      </el-col>

      <el-col :sm="24" :md="16">
        <div class="flex flex-col gap-5 h-full">
          <div class="art-card p-5">
            <div class="art-card-header">
              <div class="title">
                <h4>弹幕词云</h4>
                <p>高频词汇</p>
              </div>
            </div>
            <div v-if="detail?.danmakuWords?.length" class="h-56 mt-2">
              <canvas id="wordcloudCanvas" class="w-full h-full"></canvas>
            </div>
            <el-empty v-else description="暂无词频数据" :image-size="60" />
          </div>
          <div class="art-card p-5">
            <div class="art-card-header">
              <div class="title">
                <h4>时间线</h4>
                <p>钻石 / 礼物 / 弹幕</p>
              </div>
            </div>
            <div ref="timelineRef" class="h-64 mt-2"></div>
            <el-empty
              v-if="!detail?.summary?.timeline?.length"
              description="暂无时间线数据"
              :image-size="60"
            />
          </div>
          <div class="art-card p-5 flex-1">
            <div class="art-card-header">
              <div class="title">
                <h4>最新动态</h4>
                <p>弹幕 + 礼物</p>
              </div>
            </div>
            <div class="flex items-center gap-3 mt-3 mb-2">
              <div class="flex-1 min-w-0">
                <el-input
                  v-model="feedSearch"
                  placeholder="搜索用户、弹幕或礼物..."
                  clearable
                  size="default"
                  :prefix-icon="SearchIcon"
                />
              </div>
              <el-select v-model="feedLimit" style="width: 110px" @change="onFeedLimitChange">
                <el-option v-for="opt in feedLimits" :key="opt.v" :label="opt.l" :value="opt.v" />
              </el-select>
            </div>
            <div ref="feedScrollRef" class="mt-2 h-72 overflow-y-auto pr-1" @scroll="onFeedScroll">
              <template v-if="feedLimit === 0">
                <div :style="{ height: feedTotalHeight + 'px', position: 'relative' }">
                  <div
                    v-for="m in virtualFeedItems"
                    :key="m._key"
                    class="rounded-xl bg-g-100/50 px-3 py-2.5 absolute inset-x-0"
                    :style="{ top: m._top + 'px' }"
                  >
                    <div class="flex items-center gap-3">
                      <el-avatar :size="32" :src="m.avatar_url" class="shrink-0">{{
                        m.nickname?.[0]
                      }}</el-avatar>
                      <div class="flex-1 min-w-0">
                        <div class="flex items-center gap-2">
                          <span class="text-sm font-bold text-g-900 truncate">{{
                            m.nickname
                          }}</span>
                          <span class="text-[11px] text-g-400 shrink-0">{{
                            fmtTime(m.timestamp)
                          }}</span>
                        </div>
                        <template v-if="m._type === 'gift'">
                          <div class="flex items-center gap-1 mt-0.5 text-sm">
                            <span class="text-theme">送了</span>
                            <el-image
                              v-if="m.gift_icon"
                              :src="m.gift_icon"
                              fit="contain"
                              class="!size-4 align-middle inline-block"
                            />
                            <span v-else>🎁</span>
                            <span class="font-medium text-g-800">{{ m.gift_name }}</span>
                            <span v-if="(m.count || 0) > 1" class="text-g-500">×{{ m.count }}</span>
                            <span v-if="m.total_diamonds" class="font-bold text-theme">{{
                              fmtNum(m.total_diamonds)
                            }}</span>
                          </div>
                        </template>
                        <span
                          v-else
                          class="text-sm text-g-700 mt-0.5"
                          v-html="replaceDouyinEmoji(esc(m.content || ''))"
                        ></span>
                      </div>
                    </div>
                  </div>
                </div>
              </template>
              <template v-else>
                <div class="flex flex-col gap-2">
                  <div
                    v-for="m in displayedFeed"
                    :key="m._key"
                    class="rounded-xl bg-g-100/50 px-3 py-2.5"
                  >
                    <div class="flex items-center gap-3">
                      <el-avatar :size="32" :src="m.avatar_url" class="shrink-0">{{
                        m.nickname?.[0]
                      }}</el-avatar>
                      <div class="flex-1 min-w-0">
                        <div class="flex items-center gap-2">
                          <span class="text-sm font-bold text-g-900 truncate">{{
                            m.nickname
                          }}</span>
                          <span class="text-[11px] text-g-400 shrink-0">{{
                            fmtTime(m.timestamp)
                          }}</span>
                        </div>
                        <template v-if="m._type === 'gift'">
                          <div class="flex items-center gap-1 mt-0.5 text-sm">
                            <span class="text-theme">送了</span>
                            <el-image
                              v-if="m.gift_icon"
                              :src="m.gift_icon"
                              fit="contain"
                              class="!size-4 align-middle inline-block"
                            />
                            <span v-else>🎁</span>
                            <span class="font-medium text-g-800">{{ m.gift_name }}</span>
                            <span v-if="(m.count || 0) > 1" class="text-g-500">×{{ m.count }}</span>
                            <span v-if="m.total_diamonds" class="font-bold text-theme">{{
                              fmtNum(m.total_diamonds)
                            }}</span>
                          </div>
                        </template>
                        <span
                          v-else
                          class="text-sm text-g-700 mt-0.5"
                          v-html="replaceDouyinEmoji(esc(m.content || ''))"
                        ></span>
                      </div>
                    </div>
                  </div>
                </div>
              </template>
              <el-empty v-if="!displayedFeed.length" description="暂无动态" :image-size="60" />
            </div>
          </div>
        </div>
      </el-col>
    </el-row>

    <el-dialog
      v-model="giftDialogVisible"
      :show-header="false"
      :show-close="false"
      width="500"
      class="detail-dialog"
      align-center
    >
      <div class="px-5 py-4">
        <div class="flex items-center gap-3 pb-3.5 border-b border-dashed border-t-d">
          <el-avatar :size="40" :src="giftDialogAvatar" class="shrink-0">{{
            giftDialogUser?.[0]
          }}</el-avatar>
          <div class="min-w-0 flex-1">
            <div class="text-base font-medium text-g-900 truncate">{{ giftDialogUser }}</div>
            <div class="text-xs text-g-500 flex items-center gap-2 mt-0.5">
              <span>{{ giftDialogList.length }} 种礼物</span>
              <span class="flex items-center gap-1">
                <ArtSvgIcon icon="ri:diamond-line" class="text-g-400" />共
                {{ fmtNum(giftDialogTotal) }}
              </span>
            </div>
          </div>
          <button
            class="size-7 rounded-lg flex-cc bg-g-100/70 text-g-500 hover:bg-g-100 hover:text-g-900 transition-colors shrink-0"
            @click="giftDialogVisible = false"
          >
            <ArtSvgIcon icon="ri:close-line" class="text-base" />
          </button>
        </div>
        <div class="flex flex-col gap-2.5 max-h-80 overflow-y-auto pt-3.5 pr-1">
          <div
            v-for="(g, i) in giftDialogList"
            :key="i"
            class="flex items-center gap-3 rounded-xl bg-g-100/50 px-3 py-2"
          >
            <el-image
              v-if="g.gift_icon"
              :src="g.gift_icon"
              fit="contain"
              class="!size-7 shrink-0"
              :preview-src-list="[g.gift_icon]"
              preview-teleported
            />
            <span v-else class="text-base shrink-0">🎁</span>
            <div class="flex-1 min-w-0">
              <div class="text-sm text-g-800 truncate">{{ g.gift_name }}</div>
              <div v-if="g.to_nickname" class="text-xs text-g-500 truncate">
                送给 {{ g.to_nickname }}
              </div>
            </div>
            <div class="text-right shrink-0">
              <div class="text-sm font-bold text-theme">{{ fmtNum(g.total_diamonds) }}</div>
              <div class="text-xs text-g-500">{{ g.count }} 个</div>
            </div>
          </div>
          <el-empty v-if="!giftDialogList.length" description="暂无明细" :image-size="60" />
        </div>
      </div>
    </el-dialog>

    <el-dialog
      v-model="peopleDialogVisible"
      :show-header="false"
      :show-close="false"
      width="500"
      class="detail-dialog"
      align-center
    >
      <div class="px-5 py-4">
        <div class="flex items-center gap-3 pb-3.5 border-b border-dashed border-t-d">
          <el-avatar :size="40" :src="peopleAnchorAvatar" class="shrink-0">{{
            peopleAnchorName?.[0]
          }}</el-avatar>
          <div class="min-w-0 flex-1">
            <div class="text-base font-medium text-g-900 truncate">{{ peopleAnchorName }}</div>
            <div class="text-xs text-g-500 mt-0.5"
              >送出礼物的人员榜单 · {{ peopleDialogList.length }} 人</div
            >
          </div>
          <button
            class="size-7 rounded-lg flex-cc bg-g-100/70 text-g-500 hover:bg-g-100 hover:text-g-900 transition-colors shrink-0"
            @click="peopleDialogVisible = false"
          >
            <ArtSvgIcon icon="ri:close-line" class="text-base" />
          </button>
        </div>
        <div class="flex flex-col gap-2.5 max-h-80 overflow-y-auto pt-3.5 pr-1">
          <div
            v-for="(p, i) in peopleDialogList"
            :key="i"
            class="flex items-center gap-3 rounded-xl bg-g-100/50 px-3 py-2"
          >
            <span
              class="w-6 h-6 rounded-md flex-cc text-xs font-bold shrink-0"
              :class="rankClass(i)"
              >{{ i + 1 }}</span
            >
            <el-avatar :size="28" :src="p.avatar_url" class="shrink-0">{{
              p.nickname?.[0]
            }}</el-avatar>
            <span class="flex-1 min-w-0 truncate text-sm text-g-800">{{ p.nickname }}</span>
            <span class="text-sm font-bold text-theme shrink-0">{{
              fmtNum(p.total_diamonds)
            }}</span>
          </div>
          <el-empty v-if="!peopleDialogList.length" description="暂无数据" :image-size="60" />
        </div>
      </div>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
  import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
  import { useRoute } from 'vue-router'
  import { Search } from '@element-plus/icons-vue'
  import { echarts } from '@/plugins/echarts'
  import {
    fetchSessionDetail,
    fetchDanmaku,
    type SessionDetail,
    type GiftRankItem,
    type AnchorRankItem
  } from '@/api/douyin'
  import { renderWordCloud } from '@/utils/wordcloud'
  import { replaceDouyinEmoji, esc } from '@/utils/douyin-emoji'
  import { fmtTime, formatDuration, fmtNum, rankClass } from '@/utils/format'

  const SearchIcon = Search

  interface FeedItem {
    _type: 'danmaku' | 'gift'
    _key: string
    _ts: number
    nickname: string
    content?: string
    gift_name?: string
    count?: number
    total_diamonds?: number
    to_nickname?: string
    gift_icon?: string
    timestamp?: number
    avatar_url?: string
    _top?: number
  }

  defineOptions({ name: 'DouyinDetail' })

  const route = useRoute()
  const sessionId = String(route.params.sessionId)
  const detail = ref<SessionDetail | null>(null)
  const timelineRef = ref<HTMLElement>()
  const streamerId = computed(() => detail.value?.session?.streamer_id)
  const loading = ref(true)

  const feedRaw = ref<FeedItem[]>([])
  const feedSearch = ref('')
  const feedLimit = ref(200)
  const feedLimits = [
    { v: 50, l: '50条' },
    { v: 100, l: '100条' },
    { v: 200, l: '200条' },
    { v: 0, l: '全部' }
  ]
  const displayedFeed = computed(() => {
    const q = feedSearch.value.trim().toLowerCase()
    let items = feedRaw.value
    if (q) {
      items = items.filter((d) => {
        const content = d._type === 'gift' ? d.gift_name : d.content
        return (
          (content || '').toLowerCase().includes(q) || (d.nickname || '').toLowerCase().includes(q)
        )
      })
    } else {
      const limit = feedLimit.value
      items = limit ? items.slice(-limit) : items
    }
    return items
  })

  const FEED_ITEM_H = 64
  const feedScrollRef = ref<HTMLElement>()
  const feedScrollTop = ref(0)
  const feedViewH = ref(288)
  const feedTotalHeight = computed(() => displayedFeed.value.length * FEED_ITEM_H)
  const virtualFeedItems = computed(() => {
    const start = Math.max(0, Math.floor(feedScrollTop.value / FEED_ITEM_H) - 6)
    const end = Math.min(
      displayedFeed.value.length,
      Math.ceil((feedScrollTop.value + feedViewH.value) / FEED_ITEM_H) + 6
    )
    return displayedFeed.value.slice(start, end).map((m, idx) => ({
      ...m,
      _top: (start + idx) * FEED_ITEM_H
    }))
  })

  function onFeedScroll() {
    feedScrollTop.value = feedScrollRef.value?.scrollTop || 0
  }

  function onFeedLimitChange() {
    feedScrollTop.value = 0
  }

  const giftDialogVisible = ref(false)
  const giftDialogUser = ref('')
  const giftDialogList = ref<NonNullable<SessionDetail['giftDetails']>>([])
  const giftDialogAvatar = computed(() => giftDialogList.value[0]?.avatar_url || '')
  const giftDialogTotal = computed(() =>
    giftDialogList.value.reduce((s, g) => s + (g.total_diamonds || 0), 0)
  )

  const peopleDialogVisible = ref(false)
  const peopleAnchorName = ref('')
  const peopleAnchorAvatar = ref('')
  const peopleDialogList = ref<{ nickname: string; avatar_url?: string; total_diamonds: number }[]>(
    []
  )

  function openGiftDetail(gift: GiftRankItem) {
    giftDialogUser.value = gift.nickname
    giftDialogList.value = (detail.value?.giftDetails || []).filter(
      (g) => g.nickname === gift.nickname
    )
    giftDialogVisible.value = true
  }

  function openAnchorPeopleList(anchor: AnchorRankItem) {
    peopleAnchorName.value = anchor.anchor_name
    peopleAnchorAvatar.value = anchor.anchor_avatar || ''
    const map = new Map<string, { nickname: string; avatar_url?: string; total_diamonds: number }>()
    ;(detail.value?.giftDetails || [])
      .filter((g) => g.to_nickname === anchor.anchor_name)
      .forEach((g) => {
        const cur = map.get(g.nickname) || {
          nickname: g.nickname,
          avatar_url: g.avatar_url,
          total_diamonds: 0
        }
        cur.total_diamonds += g.total_diamonds || 0
        if (!cur.avatar_url && g.avatar_url) cur.avatar_url = g.avatar_url
        map.set(g.nickname, cur)
      })
    peopleDialogList.value = [...map.values()].sort((a, b) => b.total_diamonds - a.total_diamonds)
    peopleDialogVisible.value = true
  }

  async function loadDanmakuFeed() {
    const [dmData] = await Promise.all([fetchDanmaku(sessionId, 50000)])
    const dmList = dmData.data || dmData.messages || []
    const giftList = detail.value?.giftDetails || []
    const items: FeedItem[] = []
    dmList.forEach((d: any) => {
      const ts = Number(d.timestamp || d.create_time) || 0
      if (!d.content) return
      items.push({
        _type: 'danmaku',
        _key: 'dm_' + ts + '_' + d.nickname,
        _ts: ts > 1e12 ? ts : ts * 1000,
        nickname: d.nickname,
        content: d.content,
        timestamp: d.timestamp || d.create_time,
        avatar_url: d.avatar_url || d.avatar
      })
    })
    giftList.forEach((g) => {
      const ts = Number(g.create_time || 0)
      items.push({
        _type: 'gift',
        _key: 'gf_' + ts + '_' + g.nickname + '_' + g.gift_name,
        _ts: ts > 1e12 ? ts : ts * 1000,
        nickname: g.nickname,
        gift_name: g.gift_name,
        count: g.count || 0,
        total_diamonds: g.total_diamonds || 0,
        to_nickname: g.to_nickname || '',
        gift_icon: g.gift_icon || '',
        timestamp: g.create_time,
        avatar_url: g.avatar_url || ''
      })
    })
    items.sort((a, b) => a._ts - b._ts)
    feedRaw.value = items
  }

  const statCards = computed(() => [
    {
      label: '峰值在线',
      icon: 'ri:signal-wifi-line',
      value: (detail.value?.session?.online_peak || 0).toLocaleString()
    },
    {
      label: '总钻石',
      icon: 'ri:diamond-line',
      value: fmtNum(detail.value?.summary?.total_diamonds || 0)
    },
    {
      label: '点赞',
      icon: 'ri:thumb-up-line',
      value: (detail.value?.session?.stats_like || 0).toLocaleString()
    },
    {
      label: '弹幕',
      icon: 'ri:chat-3-line',
      value: fmtNum(detail.value?.summary?.danmaku_count || 0)
    },
    {
      label: '用户',
      icon: 'ri:user-3-line',
      value: fmtNum(detail.value?.summary?.user_count || 0)
    },
    {
      label: '时长',
      icon: 'ri:time-line',
      value:
        detail.value?.session?.duration_min != null
          ? formatDuration(detail.value.session.duration_min)
          : '进行中'
    }
  ])

  let timelineChart: echarts.ECharts | null = null
  let timer: number | undefined

  function renderTimeline() {
    const timeline = detail.value?.summary?.timeline
    if (!timelineRef.value || !timeline?.length) return
    if (!timelineChart) {
      timelineChart = echarts.init(timelineRef.value)
    }
    timelineChart.setOption({
      tooltip: { trigger: 'axis' },
      legend: { data: ['钻石', '礼物', '弹幕'] },
      grid: { left: 55, right: 55, top: 40, bottom: 30 },
      xAxis: { type: 'category', data: timeline.map((i) => i.time) },
      yAxis: [
        { type: 'value', name: '钻石', position: 'left' },
        { type: 'value', name: '弹幕/礼物', position: 'right' }
      ],
      series: [
        {
          name: '钻石',
          type: 'bar',
          yAxisIndex: 0,
          data: timeline.map((i) => i.diamonds),
          itemStyle: { color: '#409EFF', borderRadius: [4, 4, 0, 0] },
          barMaxWidth: 20
        },
        {
          name: '礼物',
          type: 'line',
          yAxisIndex: 1,
          smooth: true,
          data: timeline.map((i) => i.gifts),
          itemStyle: { color: '#E6A23C' }
        },
        {
          name: '弹幕',
          type: 'line',
          yAxisIndex: 1,
          smooth: true,
          data: timeline.map((i) => i.danmaku),
          itemStyle: { color: '#67C23A' }
        }
      ]
    })
  }

  function renderCloud() {
    if (detail.value?.danmakuWords?.length) {
      nextTick(() => {
        renderWordCloud(detail.value!.danmakuWords || [])
      })
    }
  }

  async function refresh() {
    loading.value = true
    try {
      detail.value = await fetchSessionDetail(sessionId)
      renderCloud()
      renderTimeline()
      loadDanmakuFeed()
    } finally {
      loading.value = false
    }
  }

  watch(timelineRef, () => renderTimeline())

  onMounted(() => {
    refresh()
    timer = window.setInterval(() => {
      if (detail.value?.session?.is_live) refresh()
    }, 15000)
  })
  onUnmounted(() => {
    clearInterval(timer)
    timelineChart?.dispose()
  })
</script>

<style>
  /* 覆盖模板全局 .el-dialog__body 的 25px 内边距与 dialog 自身内边距，由内容自行控制间距 */
  .el-dialog.detail-dialog {
    --el-dialog-padding-primary: 0px;
  }

  .el-dialog.detail-dialog .el-dialog__body {
    padding: 0 !important;
  }
</style>
