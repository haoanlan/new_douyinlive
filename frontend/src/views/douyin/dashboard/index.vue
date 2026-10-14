<template>
  <div class="douyin-page dy-stagger p-4">
    <!--
      汇总卡片。
      与「场次历史 / 场次详情」的同款卡片对齐口径（原来这里是自己一套）：
        - 高度 h-32（128px）→ h-20（80px），三个页面统一
        - 数值 24px bold + text-sm 标签 → 20px medium + text-xs 标签
        - 图标容器 size-10/text-lg → size-9/text-base
      之前同一类卡片在三个页面是三种尺寸，扫过去会觉得"这些页不是一个产品"。
    -->
    <div class="dy-stat-row">
      <div v-for="card in cards" :key="card.des" class="art-card dy-stat-card">
        <div class="min-w-0">
          <!-- pr-10 只留给**标签行**：图标在右上角，占的是这一行的高度；
               数字在下一行，横向空间应该全部给它（否则 390px 下 11 位数字会溢出）。 -->
          <div class="pr-10 text-xs text-g-500">{{ card.des }}</div>
          <!--
            标签 → 数字 → 单位 的间距都放大了（mt-1.5→mt-3、gap-1.5→gap-2）：
            原来三行挤在一起，"198 场"读起来像一坨。
            数字字号按**长度自适应**（见 numSizeClass）：真实数值会越来越长
            （188,718,167 已经是 11 位），字号跟着档位退，而不是换行或被裁掉。
            whitespace-nowrap 保证千分位数字永远不会从逗号处断成两行。
          -->
          <div class="mt-3 flex items-baseline gap-2">
            <span
              class="dy-stat-num font-bold text-g-900 leading-none tabular-nums whitespace-nowrap"
              :class="card.sizeClass"
            >
              {{ card.num }}
            </span>
            <span class="text-xs text-g-500 shrink-0">{{ card.unit }}</span>
          </div>
        </div>
        <!-- 图标缩小并移到右上角：不再和数字抢横向空间（视觉重心也回到数字上） -->
        <div class="dy-stat-icon absolute right-3.5 top-3.5 size-7 rounded-md flex-cc bg-theme/10">
          <ArtSvgIcon :icon="card.icon" class="text-xs text-theme" />
        </div>
      </div>
    </div>

    <!--
      连接异常：**合并成一条**。
      原来这里是两条 el-alert 上下堆叠（"监控状态获取失败" + "历史总览数据加载失败"）——
      同一个根因（后端不可达）写两遍，红条占掉近半屏；正文还直接把
      "Request failed with status code 500" 端给用户，既不解释也不给时间感。
      现在：两个都失败就合成一条，正文里说清
        · 分别是什么错（已翻译成人话）
        · 数据停在多久以前、最后成功是什么时候
        · 一个「重试」把两边一起重取
      只有一个失败时仍然单独显示，保持精确（便于判断是哪个子系统的问题）。
    -->
    <el-alert
      v-if="connAlert"
      :type="connAlert.type"
      :closable="false"
      show-icon
      class="mb-5"
      :title="connAlert.title"
    >
      <div class="flex items-start gap-3 flex-wrap">
        <div class="text-xs leading-relaxed min-w-0">
          <div v-for="(line, i) in connAlert.lines" :key="i" class="break-all">{{ line }}</div>
        </div>
        <el-button size="small" type="primary" plain @click="retryAll">重试</el-button>
      </div>
    </el-alert>

    <!-- 状态正常但久未刷新成功：提示新鲜度（用相对时间，不再报"N 秒"） -->
    <el-alert
      v-else-if="lastStatusAt && staleSeconds > 30"
      type="warning"
      :closable="false"
      show-icon
      class="mb-5"
      :title="`状态数据 ${fmtAgo(lastStatusAt)}更新过，自动刷新可能已停止`"
    />

    <!--
      数据陈旧时，在**卡片行本身**打标记。
      只在上方弹一条错误是不够的：卡片里的数字长得和实时数据一模一样，
      用户往下扫一眼就会当成当前值（截图里就是这个场景）。
    -->
    <div v-if="overviewStale" class="dy-stale-bar mb-3">
      <ArtSvgIcon icon="ri:time-line" class="text-sm shrink-0" />
      <span class="min-w-0">
        <template v-if="lastOverviewAt">
          历史总览停留在
          <b>{{ fmtAgo(lastOverviewAt) }}</b>
          （{{ fmtTime(lastOverviewAt) }}），下面卡片里的数字不是最新的
        </template>
        <template v-else> 历史总览尚未成功加载过，下面卡片里的数字可能为空或过时 </template>
      </span>
      <el-button link type="primary" size="small" class="shrink-0" @click="refreshOverview">
        立即刷新
      </el-button>
    </div>

    <!--
      监控状态 —— 立即显示，无阻塞。
      原来这里是 `v-loading="!daemon"`：一块行内白板盖在状态卡上（用户反馈"遮罩大片空白、不够优雅"）。
      改成同形的骨架卡：宽度/高度与真实卡片一致，数据到位直接替换，没有"盖住—揭开"的过程。
    -->
    <div v-if="!daemon && !statusError" class="flex flex-wrap gap-5 mb-5">
      <div
        v-for="i in 4"
        :key="i"
        class="art-card relative flex-1 min-w-[160px] flex items-center gap-3 h-20 px-5"
      >
        <el-skeleton-item variant="button" style="width: 36px; height: 36px; border-radius: 8px" />
        <div class="min-w-0 flex-1">
          <el-skeleton-item variant="text" style="width: 40%" />
          <el-skeleton-item variant="text" style="width: 60%; margin-top: 8px" />
        </div>
      </div>
    </div>

    <div v-else class="flex flex-wrap gap-5 mb-5">
      <div class="art-card relative flex-1 min-w-[160px] flex items-center gap-3 h-20 px-5">
        <div class="size-9 rounded-lg flex-cc bg-theme/10 shrink-0">
          <ArtSvgIcon icon="ri:server-line" class="text-base text-theme" />
        </div>
        <div class="min-w-0">
          <div class="text-xs text-g-500">守护进程</div>
          <!-- 状态取失败时不再沿用上次的绿色标签（会看起来"一切正常"） -->
          <el-tag
            :type="statusError ? 'info' : daemonRunning ? 'success' : 'danger'"
            size="small"
            effect="light"
          >
            {{ statusError ? '状态未知' : daemonRunning ? '运行中' : '未运行' }}
          </el-tag>
        </div>
      </div>
      <div class="art-card relative flex-1 min-w-[160px] flex items-center gap-3 h-20 px-5">
        <div class="size-9 rounded-lg flex-cc bg-theme/10 shrink-0">
          <ArtSvgIcon icon="ri:server-line" class="text-base text-theme" />
        </div>
        <div class="min-w-0">
          <div class="text-xs text-g-500">Go 代理</div>
          <!--
            这里原来也用 daemonRunning —— 于是"监控脚本在跑"就等于"代理正常"，
            代理挂了（或者根本没启动）照样绿。现在用后端随 /api/status 给的代理探活结果。
          -->
          <el-tag
            :type="statusError ? 'info' : proxyHealthy ? 'success' : proxyReachable ? 'warning' : 'danger'"
            size="small"
            effect="light"
          >
            {{
              statusError
                ? '状态未知'
                : proxyHealthy
                  ? `正常${proxyTag ? ' · ' + proxyTag : ''}`
                  : proxyReachable
                    ? '响应异常'
                    : '未运行'
            }}
          </el-tag>
        </div>
      </div>
      <div class="art-card relative flex-1 min-w-[160px] flex items-center gap-3 h-20 px-5">
        <div class="size-9 rounded-lg flex-cc bg-theme/10 shrink-0">
          <ArtSvgIcon icon="ri:link" class="text-base text-theme" />
        </div>
        <div class="min-w-0">
          <div class="text-xs text-g-500">WebSocket 连接</div>
          <div class="flex items-baseline gap-1">
            <span class="text-lg font-bold text-g-900">{{ connectedCount }}</span>
            <span class="text-xs text-g-500">/ {{ totalRooms }} 个房间</span>
          </div>
        </div>
      </div>
      <div class="art-card relative flex-1 min-w-[160px] flex items-center gap-3 h-20 px-5">
        <div class="size-9 rounded-lg flex-cc bg-theme/10 shrink-0">
          <ArtSvgIcon icon="ri:radio-line" class="text-base text-theme" />
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

    <!--
      历史总览取不到时的说明已合并到上方的 connAlert（原来这里是第二条红条）。
      单独失败时 connAlert 会只显示这一条，仍然看得见原因；不再重复堆两条。
    -->

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
          <el-skeleton v-if="!overview && !overviewError" :rows="5" animated class="mt-4" />
          <TransitionGroup v-else name="dy-list" tag="div" class="flex flex-col gap-2.5 mt-4" appear>
            <div
              v-for="(p, i) in overview?.peakSessions || []"
              :key="p.id"
              class="dy-rank-row flex items-center gap-3 rounded-xl bg-g-100/50 px-3 py-2"
            >
              <span
                class="w-6 h-6 rounded-md flex-cc text-xs font-bold shrink-0"
                :class="rankClass(i)"
                >{{ i + 1 }}</span
              >
              <el-avatar :size="32" :src="p.streamer_avatar" class="shrink-0">{{
                p.streamer?.[0]
              }}</el-avatar>
              <div class="flex-1 min-w-0">
                <div class="text-sm truncate">{{
                  p.streamer || p.room_title || '场次 #' + p.id
                }}</div>
                <div class="text-xs text-g-500">{{ fmtTime(p.start_time) }}</div>
              </div>
              <span class="text-sm font-bold text-theme shrink-0" :title="fmtTitle(p.online_peak)"
                >{{ fmtFull(p.online_peak) }}人</span
              >
            </div>
          </TransitionGroup>
          <!-- 空态是"状态占位"，不是列表项：移出 TransitionGroup，否则它也会做一次进出动画 -->
          <el-empty
            v-if="loadFailed || (overview && !overview?.peakSessions?.length)"
            :description="loadFailed ? EMPTY_LOAD_FAILED : '暂无数据'"
            :image-size="60"
          />
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
          <el-skeleton v-if="!overview && !overviewError" :rows="5" animated class="mt-4" />
          <TransitionGroup v-else name="dy-list" tag="div" class="flex flex-col gap-2.5 mt-4" appear>
            <div
              v-for="(g, i) in (overview?.topGifts || []).slice(0, 5)"
              :key="g.name"
              class="dy-rank-row flex items-center gap-2.5 rounded-xl bg-g-100/50 px-3 py-2 min-h-[52px]"
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
              <ArtSvgIcon v-else icon="ri:gift-2-line" class="text-base shrink-0 text-g-500" />
              <span class="flex-1 min-w-0 truncate text-sm text-g-800">{{ g.name }}</span>
              <span class="text-sm font-bold text-theme shrink-0">{{ fmtFull(g.diamonds) }}钻</span>
            </div>
          </TransitionGroup>
          <el-empty
            v-if="loadFailed || (overview && !overview?.topGifts?.length)"
            :description="loadFailed ? EMPTY_LOAD_FAILED : '暂无数据'"
            :image-size="60"
          />
        </div>
      </el-col>
    </el-row>

    <!-- 送礼榜 + 弹幕活跃 -->
    <el-row :gutter="20">
      <el-col :sm="24" :md="12" :lg="12" class="mb-5">
        <div class="art-card p-5 h-full">
          <div class="art-card-header">
            <div class="title">
              <h4>送礼榜</h4>
              <p>累计钻石 Top 5</p>
            </div>
          </div>
          <!--
            首屏骨架（UI-AUDIT P1-8）：原来数据没回来就先渲染 el-empty，
            回来后被整块替换 —— 既会被误读成「真没数据」，又让页面高度跳变（实测收缩 393px）。
          -->
          <el-skeleton v-if="!overview && !overviewError" :rows="4" animated class="mt-4" />
          <TransitionGroup v-else name="dy-list" tag="div" class="flex flex-col gap-2.5 mt-4" appear>
            <div
              v-for="(u, i) in overview?.topUsers || []"
              :key="u.sec_uid || u.nickname"
              class="dy-rank-row flex items-center gap-3 rounded-xl bg-g-100/50 px-3 py-2"
            >
              <span
                class="w-6 h-6 rounded-md flex-cc text-xs font-bold shrink-0"
                :class="rankClass(i)"
                >{{ i + 1 }}</span
              >
              <el-avatar :size="32" :src="u.avatar" class="shrink-0">{{ u.nickname?.[0] }}</el-avatar>
              <span class="flex-1 min-w-0 text-sm truncate">{{ u.nickname }}</span>
              <span class="text-sm font-bold text-theme shrink-0">{{ fmtFull(u.diamonds) }}钻</span>
            </div>
            <el-empty v-if="loadFailed || !overview?.topUsers?.length" :description="loadFailed ? EMPTY_LOAD_FAILED : '暂无数据'" :image-size="60" />
          </TransitionGroup>
        </div>
      </el-col>
      <el-col :sm="24" :md="12" :lg="12" class="mb-5">
        <div class="art-card p-5 h-full">
          <div class="art-card-header">
            <div class="title">
              <h4>弹幕活跃</h4>
              <p>发言次数 Top 5</p>
            </div>
          </div>
          <el-skeleton v-if="!overview && !overviewError" :rows="4" animated class="mt-4" />
          <TransitionGroup v-else name="dy-list" tag="div" class="flex flex-col gap-2.5 mt-4" appear>
            <div
              v-for="(d, i) in overview?.topDanmaku || []"
              :key="d.nickname"
              class="dy-rank-row flex items-center gap-3 rounded-xl bg-g-100/50 px-3 py-2"
            >
              <span
                class="w-6 h-6 rounded-md flex-cc text-xs font-bold shrink-0"
                :class="rankClass(i)"
                >{{ i + 1 }}</span
              >
              <el-avatar :size="32" :src="d.avatar" class="shrink-0">{{ d.nickname?.[0] }}</el-avatar>
              <span class="flex-1 min-w-0 text-sm truncate">{{ d.nickname }}</span>
              <span class="text-sm font-bold text-g-800 shrink-0" :title="fmtTitle(d.count)"
                >{{ fmtFull(d.count) }}条</span
              >
            </div>
            <el-empty
              v-if="loadFailed || !overview?.topDanmaku?.length"
              :description="loadFailed ? EMPTY_LOAD_FAILED : '暂无数据'"
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
      <el-skeleton v-if="!overview && !overviewError" :rows="6" animated class="mt-4" />
      <TransitionGroup v-else name="dy-list" tag="div" class="flex flex-col gap-2.5 mt-4" appear>
        <div
          v-for="s in overview?.recentSessions || []"
          :key="s.id"
          class="recent-row rounded-xl bg-g-100/50 px-3 py-2.5"
          role="button"
          tabindex="0"
          :aria-label="`查看场次 #${s.id} 详情`"
          @click="goDetail(s.id)"
          @keydown.enter.prevent="goDetail(s.id)"
          @keydown.space.prevent="goDetail(s.id)"
        >
          <div class="flex items-center gap-3">
            <el-avatar :size="34" :src="s.streamer_avatar" class="shrink-0">{{
              s.streamer?.[0]
            }}</el-avatar>
            <div class="flex-1 min-w-0">
              <div class="font-medium text-sm truncate">{{ s.room_title || '场次 #' + s.id }}</div>
              <div class="text-xs text-g-500 truncate">{{ s.streamer || '-' }}</div>
            </div>
            <span class="text-xs text-g-500 shrink-0">{{ fmtTime(s.start_time) }}</span>
            <!-- 整行已经可点，这里只留一个"可进入"的视觉提示：原来是 30×18 的小按钮，
                 触屏很难命中（UI-AUDIT P1-9）。 -->
            <ArtSvgIcon icon="ri:arrow-right-s-line" class="text-base text-g-400 shrink-0" />
          </div>
          <div
            class="flex items-center gap-4 mt-2 pt-2 border-t border-g-100/80 text-xs text-g-600 flex-wrap"
          >
            <span class="flex items-center gap-1" :title="fmtTitle(s.diamonds)">
              <ArtSvgIcon icon="ri:diamond-line" class="text-g-400" />{{ fmtNum(s.diamonds) }}
            </span>
            <span class="flex items-center gap-1" :title="fmtTitle(s.danmaku)">
              <ArtSvgIcon icon="ri:chat-3-line" class="text-g-400" />{{ fmtNum(s.danmaku) }}
              条
            </span>
            <span class="flex items-center gap-1" :title="fmtTitle(s.users)">
              <ArtSvgIcon icon="ri:user-3-line" class="text-g-400" />{{ fmtNum(s.users) }}
              人
            </span>
            <span class="ml-auto flex items-center gap-1 shrink-0" :title="fmtTitle(s.online_peak)">
              <ArtSvgIcon icon="ri:signal-wifi-line" class="text-g-400" />在线峰值
              {{ fmtNum(s.online_peak) }}
            </span>
          </div>
        </div>
        <el-empty
          v-if="loadFailed || !overview?.recentSessions?.length"
          :description="loadFailed ? EMPTY_LOAD_FAILED : '暂无场次'"
          :image-size="60"
        />
      </TransitionGroup>
    </div>
  </div>
</template>

<script setup lang="ts">
  import { computed, onActivated, onDeactivated, onMounted, onUnmounted, ref, watch } from 'vue'
  import { useRouter } from 'vue-router'
  import { useTransition } from '@vueuse/core'
  import { fetchOverview, fetchStatus, type OverviewData, type DaemonStatus } from '@/api/douyin'
  import { fmtNum, fmtFull, fmtTitle, fmtTime, fmtAgo, rankClass } from '@/utils/format'
  import { humanizeRequestError } from '@/utils/douyin-error'

  defineOptions({ name: 'DouyinDashboard' })

  const router = useRouter()

  /**
   * 最近场次：整行可点。
   * 原来只有一个 30×18 的行内「详情」按钮 —— 触屏/鼠标都很难点中（UI-AUDIT P1-9），
   * 现在整行是点击目标（保留 role/tabindex/Enter/Space 的键盘通路）。
   */
  function goDetail(sessionId: number) {
    router.push(`/douyin/detail/${sessionId}`)
  }
  const overview = ref<OverviewData | null>(null)
  const daemon = ref<DaemonStatus | null>(null)

  /**
   * P0-3：「失败」不能伪装成「正常」。
   *
   * 原来 refreshStatus / refreshOverview 都是 `catch {}` 静默吞掉异常：
   * 后端挂掉时页面照常显示最后一次成功的数据，守护进程/Go 代理的标签
   * 依旧是绿色的「运行中 / 正常」——监控工具最不可接受的失败模式。
   * 现在分别记录失败原因与"最后一次成功更新的时刻"，让数据新鲜度可见。
   */
  const statusError = ref('')
  const overviewError = ref('')
  const lastStatusAt = ref<number | null>(null)
  /** 历史总览最后一次成功的时间（用于给卡片行打"陈旧"标记） */
  const lastOverviewAt = ref<number | null>(null)
  /** 已过多久没成功刷新过状态（秒），用于提示数据是否过期 */
  const staleSeconds = ref(0)
  /** 历史总览已过多久没更新（秒） */
  const overviewStaleSeconds = ref(0)

  /**
   * 卡片里的数字是否已经不是最新的。
   * 失败、或超过 90 秒没成功刷新，都算陈旧（状态轮询是 10 秒一次，
   * 90 秒 ≈ 连丢 9 次，已经可以确定不是偶发抖动）。
   */
  const overviewStale = computed(
    () => Boolean(overviewError.value) || (overviewStaleSeconds.value > 90 && lastOverviewAt.value !== null)
  )

  /**
   * 合并后的连接异常提示。
   * 两个都失败 → 一条，标题说明"整体不可达"，正文分别列出原因与数据停在哪；
   * 只有一个失败 → 仍然单独显示，便于判断是哪个子系统的问题。
   */
  const connAlert = computed<{ type: 'error' | 'warning'; title: string; lines: string[] } | null>(() => {
    const both = Boolean(statusError.value && overviewError.value)
    if (both) {
      const lines = [`监控状态：${statusError.value}`, `历史总览：${overviewError.value}`]
      if (lastOverviewAt.value) {
        lines.push(`页面上的数据是 ${fmtAgo(lastOverviewAt.value)}（${fmtTime(lastOverviewAt.value)}）的，可能已经不准`)
      } else {
        lines.push('尚未成功获取过数据')
      }
      return { type: 'error', title: '无法连接后端服务 —— 页面显示的是旧数据', lines }
    }
    if (statusError.value) {
      const lines = [statusError.value]
      if (lastStatusAt.value) lines.push(`状态数据停留在 ${fmtAgo(lastStatusAt.value)}`)
      lines.push('下面四张状态卡显示的可能不是当前真实情况')
      return { type: 'error', title: '监控状态获取失败', lines }
    }
    if (overviewError.value) {
      return { type: 'error', title: '历史总览数据加载失败', lines: [overviewError.value] }
    }
    return null
  })

  /**
   * "取数失败且从来没有成功过" —— 此时各榜单卡要显示"数据未加载"而不是"暂无数据"。
   * 这两句话对使用者的含义完全不同：后者会被读成"这个直播间真的没有数据"（审计 P1-11 的老问题）。
   */
  const loadFailed = computed(() => Boolean(overviewError.value) && !overview.value)
  const EMPTY_LOAD_FAILED = '数据未加载 —— 上方已说明原因，可点「重试」'

  /** 一个按钮把两边一起重取（原来是两条提示各带一个重试按钮） */
  function retryAll() {
    refreshStatus()
    refreshOverview()
  }

  const daemonRunning = computed(() => Boolean(daemon.value?.data?.running))
  /** Go 代理的真实状态（后端随 /api/status 给的轻量探活，不再拿守护进程顶替） */
  const proxyHealthy = computed(() => Boolean(daemon.value?.proxy?.healthy))
  const proxyReachable = computed(() => Boolean(daemon.value?.proxy?.reachable))
  const proxyTag = computed(() => daemon.value?.proxy?.tag || '')
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

  /**
   * 数字滚动动画的缓动。
   *
   * 为什么必须自己传：@vueuse 的 useTransition 默认用**恒等函数**，而它算进度是
   *   `alpha = ease((now - startedAt) / duration)`
   * —— **alpha 没有被钳到 1**（源码里判断"是否继续"用的是上一帧的 now，
   * 下一帧完全可以越过 endAt）。只要有一帧被拖慢（页面刚加载时很常见），
   * alpha 就 > 1，数值会冲过目标再回落 —— 用户看到的"数字超过实际值又变回来"。
   * 这里用夹住的 ease-out：单调、且永远不超过目标值。
   */
  const EASE_OUT_CLAMPED = (t: number) => 1 - Math.pow(1 - Math.min(1, Math.max(0, t)), 3)

  const animSessions = useTransition(rawSessions, { duration: 800, transition: EASE_OUT_CLAMPED })
  const animDiamonds = useTransition(rawDiamonds, { duration: 800, transition: EASE_OUT_CLAMPED })
  const animDanmaku = useTransition(rawDanmaku, { duration: 800, transition: EASE_OUT_CLAMPED })
  const animUsers = useTransition(rawUsers, { duration: 800, transition: EASE_OUT_CLAMPED })
  const animLikes = useTransition(rawLikes, { duration: 800, transition: EASE_OUT_CLAMPED })

  const PLACEHOLDER_CARDS = [
    { des: '直播场次', icon: 'ri:live-line', unit: '场' },
    { des: '总钻石', icon: 'ri:diamond-line', unit: '钻' },
    { des: '总弹幕', icon: 'ri:chat-3-line', unit: '条' },
    { des: '活跃用户', icon: 'ri:user-3-line', unit: '人' },
    { des: '总点赞', icon: 'ri:thumb-up-line', unit: '次' }
  ]

  /**
   * 数字字号按**长度**自适应（真实数值会一直变长）。
   *
   * 为什么需要：KPI 卡显示的是实际值，"188,718,167" 已经 11 个字符。
   * 实测（1440 / 390 两档，用 mock 放大数值跑出来的）：
   *   · 桌面 275px 卡：11 位 30px 还有 43px 余量，1000 倍（15 位）也放得下
   *   · 手机 174px 卡：固定字号时 11 位就已经 −16px（溢出），必须逐档退
   * 所以每个档位都给移动端和 md 起各一个字号，宁可小一号也不换行/截断 ——
   * 数字必须完整可读。
   *
   * 类名必须是**字面量**（Tailwind 靠扫源码生成样式），不要改成运行时拼字符串。
   */
  function numSizeClass(num: string) {
    const len = (num || '').length
    // 桌面档留足：当前最大数据 11 位（188,718,167）在 275px 卡里 30px 仍有 43px 余量，
    // 所以 ≤11 位都保持最大字号；再长才逐档退（实测 1000 倍即 15 位也放得下）。
    if (len <= 7) return 'text-2xl md:text-3xl'
    if (len <= 9) return 'text-xl md:text-3xl'
    if (len <= 11) return 'text-lg md:text-3xl'
    if (len <= 13) return 'text-base md:text-2xl'
    if (len <= 15) return 'text-sm md:text-xl'
    return 'text-xs md:text-lg'
  }

  const cards = computed(() => {
    const s = overview.value?.summary
    const RAW = [rawSessions, rawDiamonds, rawDanmaku, rawUsers, rawLikes]
    const ANIM = [animSessions, animDiamonds, animDanmaku, animUsers, animLikes]
    return PLACEHOLDER_CARDS.map((p, i) => {
      const targetStr = s ? fmtFull(RAW[i].value) : ''
      return {
        ...p,
        /*
         * 显示**真实数值**（千分位，不做万/亿缩写）。
         * 这五个数字是总览页的核心，原来 "1.89亿" / "46.54万" 这种缩写等于把精度藏起来，
         * 想核对具体量级还得去别处翻。缩写形式在别处（榜单卡右侧）仍然保留。
         *
         * Math.round：动画中的值是浮点，直接格式化会闪出小数点后的数字。
         */
        num: s ? fmtFull(Math.round(ANIM[i].value)) : '--',
        /*
         * 字号档位跟着**目标值**的位数走，而不是动画中的当前值 ——
         * 否则数字每长一位就换一次字号，滚动的 0.8 秒里字号跳来跳去（实测移动端跳了 3 次）。
         */
        sizeClass: targetStr ? numSizeClass(targetStr) : 'text-2xl md:text-3xl'
      }
    })
  })

  async function refreshStatus() {
    try {
      daemon.value = await fetchStatus()
      statusError.value = ''
      lastStatusAt.value = Date.now()
      staleSeconds.value = 0
    } catch (e) {
      // 保留上次数据，但必须明确告知"这份数据已经不可信了"
      // 文案走 humanizeRequestError：不再把 "Request failed with status code 500" 直接端给用户
      statusError.value = humanizeRequestError(e, '监控状态获取失败')
    }
  }

  /**
   * 数据加载时间：供 onActivated 的 30 秒节流判断用（见下面 onActivated 的说明）
   */
  let overviewLoadedAt = 0

  async function refreshOverview() {
    try {
      const ov = await fetchOverview()
      overview.value = ov
      overviewError.value = ''
      overviewLoadedAt = Date.now()
      lastOverviewAt.value = Date.now()
      overviewStaleSeconds.value = 0
      const s = ov?.summary
      if (s) {
        rawSessions.value = s.total_sessions || 0
        rawDiamonds.value = s.total_diamonds || 0
        rawDanmaku.value = s.total_danmaku || 0
        rawUsers.value = s.unique_users || 0
        rawLikes.value = s.total_likes || 0
      }
    } catch (e) {
      overviewError.value = humanizeRequestError(e, '总览数据加载失败')
    }
  }

  /** 每秒更新"数据已过期多久"，让使用者一眼看出这份状态是不是旧的 */
  let staleTimer: number | undefined
  function tickStale() {
    const now = Date.now()
    staleSeconds.value = lastStatusAt.value ? Math.floor((now - lastStatusAt.value) / 1000) : 0
    overviewStaleSeconds.value = lastOverviewAt.value
      ? Math.floor((now - lastOverviewAt.value) / 1000)
      : 0
  }

  // 录制停止（场次结束归档）时刷新历史总览数据
  let wasRecording = false
  watch(hasRecording, (recording) => {
    if (wasRecording && !recording) refreshOverview()
    wasRecording = recording
  })

  let statusTimer: number | undefined

  function stopTimers() {
    if (statusTimer) clearInterval(statusTimer)
    if (staleTimer) clearInterval(staleTimer)
    statusTimer = undefined
    staleTimer = undefined
  }

  function startTimers() {
    stopTimers()
    statusTimer = window.setInterval(() => {
      // 切到别的页面时由 onDeactivated 停表；这里再挡一层"浏览器标签页被隐藏"
      if (document.visibilityState === 'visible') refreshStatus()
    }, 10000)
    staleTimer = window.setInterval(tickStale, 1000)
  }

  // keep-alive 页：切回来刷新并恢复轮询、切走立刻停。
  // 旧版只在 onUnmounted 清定时器，而这页被缓存、根本不会 unmount ——
  // 于是停在其他页面时它仍在每 10s 偷偷请求（实测复现，见 UI-AUDIT P1-7）。
  let activatedOnce = false
  onMounted(() => {
    refreshStatus()
    refreshOverview()
    startTimers()
  })
  /*
   * 切回来时除了刷新实时状态，也要补一次**历史总览**。
   * 原来只调 refreshStatus()，而总览卡（场次数/钻石/用户/榜单）没有轮询 ——
   * 切走期间结束的场次回来根本不会出现，要手动点刷新（审计 P2-14）。
   * 30 秒节流：只在数据确实可能过期时才重新取。
   */
  onActivated(async () => {
    // 首次挂载时 mounted 与 activated 都会触发，跳过以免重复请求
    if (!activatedOnce) {
      activatedOnce = true
      return
    }
    refreshStatus()
    startTimers()
    if (Date.now() - overviewLoadedAt > 30000) {
      await refreshOverview()
      overviewLoadedAt = Date.now()
    }
  })
  onDeactivated(() => stopTimers())
  onUnmounted(() => stopTimers())
</script>

<style scoped>
  /*
   * 统计卡（.dy-stat-row / .dy-stat-card）的布局已提到全局
   * `assets/styles/custom/douyin-motion.scss`，因为状态监控页也要用同一套。
   * 别在这里重新定义 —— 否则两页会各有一套、又走回"看着像共用其实不是"的老路。
   *
   * 列表进出统一走全局 `.dy-list-*`（同上文件）：
   * 原来这里是 `transition: all 0.4s ease`，进场 translateY(10px) 而退出 translateX(-10px) ——
   * 一个纵向进、一个横向出，方向不一致，看着像"被甩出去"。现在统一纵向。
   */

  /* 「最近场次」整行可点：给出悬停与键盘焦点的可见反馈 */
  .recent-row {
    cursor: pointer;
    transition: background-color var(--dy-dur-fast) var(--dy-ease-out);
  }

  @media (hover: hover) and (pointer: fine) {
    .recent-row:hover {
      background-color: var(--art-gray-200);
    }
  }

  .recent-row:focus-visible {
    outline: 2px solid var(--theme-color);
    outline-offset: 2px;
  }

  /*
   * 数据陈旧提示条（历史总览停在多久以前）。
   * 刻意用"琥珀底 + 左边框"而不是红色：后端重启/网络抖一下很常见，
   * 红色留给"真的取不到"的 el-alert；这条只表达"数字不是最新的"。
   * 深浅色都靠主题变量，跟着 html.dark 走。
   */
  .dy-stale-bar {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 7px 12px;
    border: 1px solid rgb(245 158 11 / 35%);
    border-left: 3px solid rgb(245 158 11 / 80%);
    border-radius: 8px;
    background: rgb(245 158 11 / 10%);
    color: var(--art-gray-800, #333);
    font-size: 12.5px;
    line-height: 1.45;
  }

  .dy-stale-bar b {
    font-weight: 600;
  }
</style>
