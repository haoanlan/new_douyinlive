<template>
  <!--
    不再用 v-loading 全屏遮罩：这一页的数据没到时本来就有完整骨架
    （标题回落成"场次详情"、统计卡是 0、列表是空态），
    再盖一层白板既多余又廉价。改成"有内容时刷新才轻微变淡" + 工具条的刷新按钮转圈。
  -->
  <div
    class="douyin-page dy-stagger p-4"
    :class="loading && detail ? 'opacity-60' : ''"
    style="transition: opacity 200ms cubic-bezier(0.23, 1, 0.32, 1)"
  >
    <!-- 面包屑统一由顶栏渲染；"回到该主播场次列表"的入口移到下面的工具条上 -->

    <!-- 失败必须说出来（UI-AUDIT P1-11）：否则页面停在全 0 的假数据上 -->
    <QueryErrorState
      v-if="queryError"
      class="mb-5"
      :message="queryError"
      :retrying="loading"
      @retry="refresh"
    />

    <!-- 场次头部 -->
    <div class="art-card dy-toolbar mb-5 flex items-center justify-between gap-4 flex-wrap">
      <div class="flex items-center gap-3.5 min-w-0">
        <el-avatar :size="48" :src="detail?.session?.streamer_avatar" class="shrink-0">{{
          detail?.session?.streamer_name?.[0] || '场'
        }}</el-avatar>
        <div class="min-w-0">
          <div class="flex items-center gap-2">
            <span class="text-base font-medium text-g-900 truncate">
              {{ detail?.session?.room_title || detail?.session?.title || '场次详情' }}
            </span>
            <el-tag v-if="detail?.session?.is_live" type="danger" size="small" class="!border-none"
              >直播中</el-tag
            >
          </div>
          <div class="text-xs text-g-500 mt-1 truncate">
            {{ detail?.session?.streamer_name || '' }}
            <!-- 开始 → 结束（跨天时结束时间带日期，见 fmtSessionRange）；直播中由上面的标签表达 -->
            <template v-if="detail?.session?.start_time">
              · {{ fmtSessionRange(detail.session.start_time, detail.session.end_time) }}
            </template>
          </div>
        </div>
      </div>
      <div class="flex items-center gap-2">
        <!--
          面包屑统一到顶栏后，"回到该主播的场次列表"（原来只存在于页面内面包屑、
          且带着 hostId）需要一个新的明确入口 —— 这是详情页最主要的回退路径。
        -->
        <el-button
          v-if="streamerId"
          @click="router.push({ path: '/douyin/sessions', query: { hostId: streamerId } })"
        >
          <ArtSvgIcon icon="ri:arrow-left-line" class="mr-1" />场次列表
        </el-button>
        <el-button :disabled="loading" @click="refresh">
          <!-- 同状态监控页：不用 el-button 的 :loading（会在图标前再插一个转圈把按钮撑宽），
               改成图标原地旋转，宽度恒定 -->
          <ArtSvgIcon
            icon="ri:refresh-line"
            class="mr-1"
            :class="loading ? 'dy-spin' : ''"
          />刷新
        </el-button>
      </div>
    </div>

    <!-- 统计卡片 -->
    <ElRow :gutter="20">
      <ElCol v-for="stat in statCards" :key="stat.label" :xs="12" :sm="8" :md="8" :lg="4">
        <div class="art-card flex items-center justify-between h-20 px-5 mb-5">
          <div class="min-w-0">
            <div class="text-xs text-g-500">{{ stat.label }}</div>
            <!-- 卡片会 truncate 数值，所以补 title 显示完整值（评审 P2 点过这个问题） -->
            <div
              class="text-[20px] font-medium text-g-900 mt-1 leading-none truncate"
              :title="stat.title || stat.value"
            >
              {{ stat.value }}
            </div>
          </div>
          <div class="size-9 rounded-lg flex-cc bg-theme/10 shrink-0">
            <ArtSvgIcon :icon="stat.icon" class="text-base text-theme" />
          </div>
        </div>
      </ElCol>
    </ElRow>

    <!--
      三个榜单：单行三列。
      原来这里是 el-row + 左右两个 el-col，各自 flex 竖堆若干个卡 ——
      两栏内容高度天然不同，底部必然参差，数据少时更明显（强行对齐也对不齐）。
      改成单行 grid 后，行内卡片等高，底部由布局保证齐平。
    -->
    <div class="dy-detail-grid dy-detail-grid--3 mb-5">
          <div class="art-card p-5 flex flex-col">
            <div class="art-card-header">
              <div class="title">
                <h4>礼物排行</h4>
                <p>钻石 Top</p>
              </div>
            </div>
            <div class="dy-scroll flex-1 min-h-0 flex flex-col gap-2.5 mt-4">
              <div
                v-for="(u, i) in detail?.gifts || []"
                :key="u.nickname"
                class="dy-detail-row flex items-center gap-3 rounded-xl bg-g-100/50 px-3 py-2 c-p"
                role="button"
                tabindex="0"
                :aria-label="`查看 ${u.nickname} 的送礼明细`"
                @click="openGiftDetail(u)"
                @keydown.enter.prevent="openGiftDetail(u)"
                @keydown.space.prevent="openGiftDetail(u)"
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
          <div class="art-card p-5 flex flex-col">
            <div class="art-card-header">
              <div class="title">
                <h4>团播主播排名</h4>
                <p>累计钻石</p>
              </div>
            </div>
            <div class="dy-scroll flex-1 min-h-0 flex flex-col gap-2.5 mt-4">
              <div
                v-for="(a, i) in detail?.anchorRanking || []"
                :key="a.anchor_name"
                class="dy-detail-row flex items-center gap-3 rounded-xl bg-g-100/50 px-3 py-2 c-p"
                role="button"
                tabindex="0"
                :aria-label="`查看 ${a.anchor_name} 的送礼人员`"
                @click="openAnchorPeopleList(a)"
                @keydown.enter.prevent="openAnchorPeopleList(a)"
                @keydown.space.prevent="openAnchorPeopleList(a)"
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
          <div class="art-card p-5 flex flex-col">
            <div class="art-card-header">
              <div class="title">
                <h4>弹幕排行</h4>
                <p>发言次数 Top 20</p>
              </div>
            </div>
            <div class="dy-scroll flex-1 min-h-0 flex flex-col gap-2.5 mt-4">
              <!--
                行结构与另两个榜单保持一致：
                头像同样是 32px（原来是 26px，整行比另两列矮 6px，
                于是同样高度下这里能多显示一行 —— 视觉上"三个榜不一样高"）。
              -->
              <div
                v-for="(d, i) in (detail?.danmakuRanking || []).slice(0, 20)"
                :key="d.nickname"
                class="dy-detail-row flex items-center gap-3 rounded-xl bg-g-100/50 px-3 py-2"
              >
                <span
                  class="w-6 h-6 rounded-md flex-cc text-xs font-bold shrink-0"
                  :class="rankClass(i)"
                  >{{ i + 1 }}</span
                >
                <el-avatar :size="32" :src="d.avatar" class="shrink-0">{{
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

    <!--
      第二行：词云 + 最新动态。
      时间线已移除 —— 它把钻石/礼物/弹幕三条线叠在同一根 Y 轴上，
      而弹幕量级比礼物高两个数量级，礼物会被压成贴地的一条线，读不出信息。
    -->
    <div class="dy-detail-grid dy-detail-grid--2 mb-5">
      <div class="art-card p-5 flex flex-col">
        <div class="art-card-header">
          <div class="title">
            <h4>弹幕词云</h4>
            <p>高频词汇</p>
          </div>
        </div>
        <!--
          词云必须有**确定高度**的容器：canvas 原来只有 224px 高，40 个词挤在里面，
          实际着色覆盖率仅 18% —— 看起来又小又有大片留白。
          这里给足高度，并让 canvas 撑满（宽高都吃满容器）。
        -->
        <div v-if="detail?.danmakuWords?.length" class="dy-cloud-box mt-3">
          <canvas id="wordcloudCanvas" class="w-full h-full block"></canvas>
        </div>
        <el-empty v-else description="暂无词频数据" :image-size="60" />
      </div>
      <div class="art-card p-5 flex flex-col">
        <div class="art-card-header">
          <div class="title">
            <h4>最新动态</h4>
            <p>
              弹幕 + 礼物
              <!-- 说明清楚"为什么只有这些"，避免被误认为数据缺失 -->
              <template v-if="!activeQuery && feedTotal > FEED_FETCH_LIMIT">
                · 已载入最新 {{ fmtNum(FEED_FETCH_LIMIT) }} / 共 {{ fmtNum(feedTotal) }} 条，更早的请搜索
              </template>
              <template v-else-if="activeQuery">
                · 全量命中 {{ fmtNum(feedSearchTotal) }} 条
              </template>
            </p>
          </div>
        </div>

        <!--
          搜索：交给服务端在全量弹幕里检索（前端只有最新 2000 条）。
          样式与「房间管理」页的搜索框保持一致：固定宽度 + ArtSvgIcon 前缀。
        -->
        <div class="dy-feed-search mt-3 mb-2">
          <el-input
            v-model="feedSearch"
            placeholder="搜索全部弹幕的用户或内容"
            class="dy-feed-search-input"
            clearable
            @keyup.enter="submitFeedSearch"
            @clear="clearFeedSearch"
          >
            <template #prefix>
              <ArtSvgIcon icon="ri:search-line" class="text-g-400" />
            </template>
            <template #suffix>
              <!--
                加载状态放在输入框内（而不是按钮上）：
                按钮如果切换成 loading 转圈，文字会被替换掉，视觉上就是"按钮变了一下"。
                这里保持按钮文字与尺寸完全不变，只在输入框里给一个转圈反馈。
              -->
              <ArtSvgIcon
                v-if="feedSearching"
                icon="ri:loader-4-line"
                class="text-g-400 dy-feed-search-spin"
              />
            </template>
          </el-input>
          <el-button type="primary" @click="submitFeedSearch">搜索</el-button>
        </div>

        <div ref="feedScrollRef" class="dy-scroll flex-1 min-h-0">
          <!--
            渐进披露（取代原来的"固定行高 64px 虚拟滚动"）：
            行高会随内容换行而变（弹幕 2–3 行、礼物行更高），写死高度必然重叠，
            所以这里不对高度做任何假设 —— 只渲染最新 N 条 + 底部「加载更多」。
          -->
          <div class="dy-feed-list">
            <div
              v-for="m in renderedFeed"
              :key="m._key"
              class="dy-feed-row"
              :class="m._type === 'gift' ? 'dy-feed-row--gift' : ''"
            >
              <el-avatar :size="32" :src="m.avatar_url" class="shrink-0">{{
                m.nickname?.[0]
              }}</el-avatar>
              <div class="min-w-0 flex-1">
                <!-- 第一行：昵称 + 礼物标签（左）· 时间（右） -->
                <div class="dy-feed-row__meta">
                  <span class="dy-feed-row__name">{{ m.nickname }}</span>
                  <span v-if="m._type === 'gift'" class="dy-feed-row__tag">礼物</span>
                  <span class="dy-feed-row__time">{{ fmtTime(m.timestamp) }}</span>
                </div>
                <!-- 第二行：内容（礼物行带图标、数量、钻石数） -->
                <template v-if="m._type === 'gift'">
                  <div class="dy-feed-row__text dy-feed-row__gift">
                    <el-image
                      v-if="m.gift_icon"
                      :src="m.gift_icon"
                      fit="contain"
                      class="dy-feed-row__gift-icon"
                    />
                    <ArtSvgIcon v-else icon="ri:gift-2-line" class="dy-feed-row__gift-icon" />
                    <span class="dy-feed-row__gift-name">{{ m.gift_name }}</span>
                    <span v-if="(m.count || 0) > 1" class="dy-feed-row__dim">×{{ m.count }}</span>
                    <span v-if="m.total_diamonds" class="dy-feed-row__diamond">
                      <ArtSvgIcon icon="ri:diamond-line" />
                      {{ fmtNum(m.total_diamonds) }}
                    </span>
                    <span v-if="m.to_nickname" class="dy-feed-row__dim">
                      → {{ m.to_nickname }}
                    </span>
                  </div>
                </template>
                <span
                  v-else
                  class="dy-feed-row__text"
                  v-html="replaceDouyinEmoji(esc(m.content || ''))"
                ></span>
              </div>
            </div>

            <!-- 还有更多：给一个明确出口，而不是静默截断 -->
            <div v-if="hasMoreFeed" class="py-2 text-center">
              <el-button size="small" text type="primary" @click="loadMoreFeed">
                加载更多（还有 {{ fmtNum(displayedFeed.length - feedShownCount) }} 条）
              </el-button>
            </div>
            <div v-else-if="displayedFeed.length" class="py-2 text-center text-xs text-g-500">
              已显示全部 {{ fmtNum(displayedFeed.length) }} 条
            </div>
          </div>
          <el-empty
            v-if="!displayedFeed.length"
            :description="
              activeQuery ? `没有匹配「${activeQuery}」的动态` : '暂无动态'
            "
            :image-size="60"
          />
        </div>
      </div>
    </div>

    <el-dialog
      v-model="giftDialogVisible"
      :show-header="false"
      :show-close="false"
      width="500"
      class="detail-dialog"
      align-center
    >
      <div class="px-5 py-4">
        <div class="flex items-center gap-3 pb-3.5 border-b border-dashed">
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
            class="dy-pressable size-7 rounded-lg flex-cc bg-g-100/70 text-g-500 hover:bg-g-100 hover:text-g-900 shrink-0"
            aria-label="关闭礼物明细"
            @click="giftDialogVisible = false"
          >
            <ArtSvgIcon icon="ri:close-line" class="text-base" />
          </button>
        </div>
        <div class="flex flex-col gap-2.5 max-h-80 overflow-y-auto pt-3.5 pr-1">
          <div
            v-for="(g, i) in giftDialogList"
            :key="i"
            class="dy-rank-row flex items-center gap-3 rounded-xl bg-g-100/50 px-3 py-2"
          >
            <el-image
              v-if="g.gift_icon"
              :src="g.gift_icon"
              fit="contain"
              class="!size-7 shrink-0"
              :preview-src-list="[g.gift_icon]"
              preview-teleported
            />
            <ArtSvgIcon v-else icon="ri:gift-2-line" class="text-base shrink-0 text-g-500" />
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
        <div class="flex items-center gap-3 pb-3.5 border-b border-dashed">
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
            class="dy-pressable size-7 rounded-lg flex-cc bg-g-100/70 text-g-500 hover:bg-g-100 hover:text-g-900 shrink-0"
            aria-label="关闭送礼人员榜单"
            @click="peopleDialogVisible = false"
          >
            <ArtSvgIcon icon="ri:close-line" class="text-base" />
          </button>
        </div>
        <div class="flex flex-col gap-2.5 max-h-80 overflow-y-auto pt-3.5 pr-1">
          <div
            v-for="(p, i) in peopleDialogList"
            :key="i"
            class="dy-rank-row flex items-center gap-3 rounded-xl bg-g-100/50 px-3 py-2"
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
  import { useRoute, useRouter } from 'vue-router'
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
  import { fmtTime, formatDuration, fmtNum, fmtTitle, fmtSessionRange, rankClass } from '@/utils/format'
  import { apiErrorMessage } from '@/utils/douyin-error'

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
  const router = useRouter()
  const sessionId = String(route.params.sessionId)
  const detail = ref<SessionDetail | null>(null)
  const streamerId = computed(() => detail.value?.session?.streamer_id)
  const loading = ref(true)
  /** 取数失败的原因（与「真的没有数据」区分开） */
  const queryError = ref('')

  /**
   * 「最新动态」的取数与渲染策略。
   *
   * 修过的 bug（DESIGN-REVIEW P1-9）：
   *  1) 原来 `items.slice(-limit)` 作用在**升序**数组上 → 取到的是**最旧**的 N 条，
   *     标题写着"最新动态"却不最新。已改为降序取前 N。
   *  2) 原来"全部"模式用固定行高 64px 虚拟滚动，而弹幕会换行 2–3 行、礼物行更高
   *     → 行与行必然重叠、完全不可读。已改为渐进披露，不再猜行高。
   *  3) 原来一次 `fetchDanmaku(sessionId, 50000)`：实测场次 153（6.5 万条弹幕）
   *     单这一请求就要 **19 秒 / 22MB**，回来后还要在主线程 map + 排序 5 万条 ——
   *     这才是"全部"卡顿的真正原因。现在只取最新 2000 条（762ms / 902KB），
   *     更早的内容由**服务端**按关键字检索。
   */
  const feedRaw = ref<FeedItem[]>([])
  /** 搜索框里的文字（输入中，未提交） */
  const feedSearch = ref('')
  /** 已生效的搜索词（服务端检索用的就是它） */
  const activeQuery = ref('')
  /** 搜索请求进行中 */
  const feedSearching = ref(false)
  /** 本场次弹幕总数（后端 total，用于说明"只展示最新 N 条"） */
  const feedTotal = ref(0)
  /** 本次搜索在服务端命中的总数 */
  const feedSearchTotal = ref(0)

  /** 一次取多少条（后端上限也是 2000） */
  const FEED_FETCH_LIMIT = 2000
  /** 渐进披露：首屏渲染多少条，点「加载更多」递增 */
  const FEED_PAGE = 200

  /**
   * 当前要展示的列表。
   *
   * 搜索已改为**服务端检索**（前端只有最新 2000 条，搜不到更早的内容），
   * 这里只在 activeQuery 与输入框一致时再兜一层过滤，
   * 保证弹幕与礼物都按同一个词筛过、不会出现"服务端筛了、前端又混进没筛的"。
   */
  const displayedFeed = computed(() => {
    const q = activeQuery.value.trim().toLowerCase()
    // 输入框已改动但还没提交搜索：先按当前列表展示，避免打字时列表跳动
    if (!q || q !== feedSearch.value.trim().toLowerCase()) return feedRaw.value
    return feedRaw.value.filter((d) => {
      const content = d._type === 'gift' ? d.gift_name : d.content
      return (
        (content || '').toLowerCase().includes(q) || (d.nickname || '').toLowerCase().includes(q)
      )
    })
  })

  /** 实际渲染的条数（渐进披露：点「加载更多」每次加一档） */
  const feedShownCount = ref(FEED_PAGE)
  const renderedFeed = computed(() => displayedFeed.value.slice(0, feedShownCount.value))
  const hasMoreFeed = computed(() => displayedFeed.value.length > feedShownCount.value)

  function loadMoreFeed() {
    feedShownCount.value += 400
  }

  /** 提交搜索：交给服务端在全量弹幕里检索 */
  async function submitFeedSearch() {
    activeQuery.value = feedSearch.value.trim()
    await searchFeed()
    if (feedScrollRef.value) feedScrollRef.value.scrollTop = 0
  }

  /** 清空搜索：恢复为「最新 2000 条」 */
  async function clearFeedSearch() {
    if (!activeQuery.value && !feedSearch.value) return
    feedSearch.value = ''
    activeQuery.value = ''
    feedSearchTotal.value = 0
    feedShownCount.value = FEED_PAGE
    await loadDanmakuFeed()
    if (feedScrollRef.value) feedScrollRef.value.scrollTop = 0
  }

  const feedScrollRef = ref<HTMLElement>()

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
    /*
     * 只取最新 2000 条。
     * 原来是 `fetchDanmaku(sessionId, 50000)`：实测场次 153（6.5 万条弹幕）
     * 单这一请求就要 **19 秒 / 22MB**，返回后还要在主线程 map + 排序 5 万条 ——
     * 这是"全部"卡顿的真正原因，不是渲染（渲染本来就有渐进披露兜着）。
     * 更早的内容改由服务端按关键字检索（见 searchFeed）。
     */
    const dmData = await fetchDanmaku(sessionId, FEED_FETCH_LIMIT)
    const dmList = dmData.data || dmData.messages || []
    feedTotal.value = dmData.total ?? dmList.length
    const giftList = detail.value?.giftDetails || []
    feedRaw.value = buildFeedItems(dmList, giftList)
  }

  /** 弹幕 + 礼物 → 统一的时间线数组（按时间**降序**，最新在前） */
  function buildFeedItems(dmList: any[], giftList: any[]): FeedItem[] {
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
    // 按时间降序：监测场景关注"刚刚发生了什么"。
    // 原来升序 + slice(-limit) 取到的是**最旧**的 N 条，标题写着"最新"却不最新。
    items.sort((a, b) => b._ts - a._ts)
    return items
  }

  /**
   * 在全量弹幕里搜索。
   *
   * 前端只有最新 2000 条，搜不到更早的 —— 所以关键字交给**服务端**用 SQL 检索
   * （实测全量 6.5 万条里搜"哈哈哈哈"：192ms / 236 条命中）。
   * 空关键字则恢复为最新的 2000 条。
   */
  async function searchFeed() {
    const q = feedSearch.value.trim()
    feedSearching.value = true
    feedShownCount.value = 200
    try {
      const dmData = await fetchDanmaku(sessionId, FEED_FETCH_LIMIT, q)
      const dmList = dmData.data || dmData.messages || []
      feedSearchTotal.value = dmData.total ?? dmList.length
      const gifts = q
        ? (detail.value?.giftDetails || []).filter(
            (g) =>
              (g.gift_name || '').toLowerCase().includes(q.toLowerCase()) ||
              (g.nickname || '').toLowerCase().includes(q.toLowerCase())
          )
        : detail.value?.giftDetails || []
      feedRaw.value = buildFeedItems(dmList, gifts)
    } catch {
      // 搜索失败保持原列表，避免把"搜不到"伪装成"没有"
      feedSearchTotal.value = 0
    } finally {
      feedSearching.value = false
    }
  }

  const statCards = computed(() => [
    {
      label: '峰值在线',
      icon: 'ri:signal-wifi-line',
      // 全部走 fmtNum，保证同一排卡片口径一致（原来这里单独用 toLocaleString）
      value: fmtNum(detail.value?.session?.online_peak || 0),
      title: fmtTitle(detail.value?.session?.online_peak || 0)
    },
    {
      label: '总钻石',
      icon: 'ri:diamond-line',
      value: fmtNum(detail.value?.summary?.total_diamonds || 0),
      title: fmtTitle(detail.value?.summary?.total_diamonds || 0)
    },
    {
      label: '点赞',
      icon: 'ri:thumb-up-line',
      value: fmtNum(detail.value?.session?.stats_like || 0),
      title: fmtTitle(detail.value?.session?.stats_like || 0)
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

  let timer: number | undefined

  function renderCloud() {
    if (detail.value?.danmakuWords?.length) {
      nextTick(() => {
        renderWordCloud(detail.value!.danmakuWords || [])
      })
    }
  }

  /**
   * 词云容器尺寸变化时重绘。
   *
   * 为什么必须有：canvas 的绘制依赖容器实际尺寸，而首次绘制时布局往往还没稳定
   * （网格行高、flex 分配都要等一帧）。实测首次绘制只拿到 224px 高，
   * 于是词云被压扁、着色覆盖率只有 18%。
   * 有了 ResizeObserver，容器最终尺寸一确定就按正确尺寸重绘。
   */
  let cloudObserver: ResizeObserver | undefined
  function observeCloudBox() {
    if (cloudObserver || typeof ResizeObserver === 'undefined') return
    const el = document.querySelector('.dy-cloud-box')
    if (!el) return
    let last = ''
    cloudObserver = new ResizeObserver(() => {
      const r = el.getBoundingClientRect()
      const key = `${Math.round(r.width)}x${Math.round(r.height)}`
      // 尺寸没变就不重绘，避免死循环（重绘会改 canvas 属性，但不会改容器尺寸）
      if (key === last) return
      last = key
      renderWordCloud(detail.value?.danmakuWords || [])
    })
    cloudObserver.observe(el)
  }

  async function refresh() {
    loading.value = true
    try {
      detail.value = await fetchSessionDetail(sessionId)
      queryError.value = ''
      renderCloud()
      observeCloudBox()
      loadDanmakuFeed()
    } catch (e) {
      // 以前这里只有 finally 没有 catch：场次不存在/接口失败时异常逃逸，
      // 页面停在一片全 0 的假数据上，用户以为"这场真的没有数据"（UI-AUDIT P1-11）
      queryError.value = apiErrorMessage(e, '场次详情加载失败')
    } finally {
      loading.value = false
    }
  }

  onMounted(() => {
    refresh()
    timer = window.setInterval(() => {
      if (detail.value?.session?.is_live) refresh()
    }, 15000)
  })
  onUnmounted(() => {
    clearInterval(timer)
    cloudObserver?.disconnect()
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

  /*
   * 榜单里可点进明细的行。
   * 原来是裸 div @click + `hover:bg-g-100/70 transition-colors`：
   * 鼠标可用但键盘完全不可达，而且没有任何按下反馈。
   */
  .dy-detail-row {
    transition: background-color var(--dy-dur-fast) ease;
  }

  @media (hover: hover) and (pointer: fine) {
    .dy-detail-row:hover {
      background-color: var(--art-gray-100);
    }
  }

  .dy-detail-row:active {
    background-color: var(--art-gray-200, var(--art-gray-100));
  }

  .dy-detail-row:focus-visible {
    outline: none;
    box-shadow:
      0 0 0 2px #fff,
      0 0 0 4px var(--theme-color);
  }

  /*
   * 搜索框与按钮的样式写在全局 `custom/douyin-motion.scss` 里（按 .dy- 类名限定）。
   * 原因：本文件的 <style> 是**全局**的（没有 scoped），
   * 在这里写 :deep() 是无效写法 —— 它不会被 Vue 编译转换，而是原样输出，
   * 浏览器不认识 :deep() 于是整条规则被丢弃（实测样式完全没生效）。
   * 而全局块里又不能写裸的 `.el-input__wrapper`，那会泄漏到全站所有输入框。
   */
</style>
