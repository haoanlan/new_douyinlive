<template>
  <div class="douyin-page p-4">
    <!-- 面包屑导航 -->
    <el-breadcrumb class="mb-5" separator="/">
      <el-breadcrumb-item :to="{ path: '/douyin/rooms' }">
        <ArtSvgIcon icon="ri:home-4-line" class="text-sm text-g-500" /> 房间管理
      </el-breadcrumb-item>
      <el-breadcrumb-item>场次历史</el-breadcrumb-item>
    </el-breadcrumb>

    <!-- 顶部汇总 -->
    <ElRow :gutter="20">
      <!-- 6 张卡保持一行（lg 用 span 4 = 每行 6 张）。
           曾经为了防 1280 下数值被截断改成 span 6（每行 4 张），结果变成 4+2 两行、
           右上大片空白 —— 用户明确要求一行。截断风险靠 :title 与 fmtNum 缩写来兜。 -->
      <ElCol v-for="card in summaryCards" :key="card.label" :xs="12" :sm="8" :md="8" :lg="4">
        <div class="art-card flex items-center justify-between h-20 px-5 mb-5">
          <div class="min-w-0">
            <div class="text-xs text-g-500">{{ card.label }}</div>
            <div
              class="text-[20px] font-medium text-g-900 mt-1 leading-none truncate"
              :title="card.title"
            >
              {{ card.value }}
            </div>
          </div>
          <div class="size-9 rounded-lg flex-cc bg-theme/10 shrink-0">
            <ArtSvgIcon :icon="card.icon" class="text-base text-theme" />
          </div>
        </div>
      </ElCol>
    </ElRow>

    <!-- 工具条 -->
    <div
      class="art-card dy-toolbar session-toolbar mb-5 flex items-center justify-between gap-4 flex-wrap"
    >
      <div class="flex items-center gap-2.5">
        <span class="font-bold text-g-900">场次历史</span>
        <span class="text-xs text-g-500">
          共 {{ filteredSessions.length }} 场<template v-if="dateRange">（已筛选）</template>
        </span>
      </div>
      <div class="dy-toolbar-actions">
        <el-date-picker
          v-model="dateRange"
          type="daterange"
          range-separator="~"
          start-placeholder="开始日期"
          end-placeholder="结束日期"
          value-format="YYYY-MM-DD"
          style="width: 260px"
          @change="onDateChange"
        />
        <el-button v-if="dateRange" @click="clearDate">清除</el-button>
        <el-dropdown
          v-if="isAdmin && selectedIds.length"
          trigger="click"
          @command="onBatchCommand"
        >
          <el-button type="primary" :loading="batchDownloading">
            <ArtSvgIcon icon="ri:check-double-line" class="mr-1" />
            批量 ({{ selectedIds.length }})
            <ArtSvgIcon icon="ri:arrow-down-s-line" class="ml-1" />
          </el-button>
          <template #dropdown>
            <el-dropdown-menu>
              <el-dropdown-item command="download">
                <ArtSvgIcon icon="ri:download-line" class="mr-1.5" />下载报告
              </el-dropdown-item>
              <el-dropdown-item command="delete" class="text-danger">
                <ArtSvgIcon icon="ri:delete-bin-7-line" class="mr-1.5" />删除
              </el-dropdown-item>
            </el-dropdown-menu>
          </template>
        </el-dropdown>
      </div>
    </div>

    <!--
      缺参 / 失败 两个整块状态原来嵌在下面那张「列表卡」内部，成了卡中卡
      （双层描边 + 额外内缩）。见 UI-AUDIT P2-16。
    -->
    <div v-if="!hostId && !loading" class="art-card px-5 py-8 mb-5">
      <div class="flex flex-col items-center text-center">
        <div class="size-11 rounded-full flex-cc bg-theme/10 mb-3">
          <ArtSvgIcon icon="ri:live-line" class="text-xl text-theme" />
        </div>
        <div class="text-sm font-medium text-g-900">请先选择要查看的主播</div>
        <p class="mt-1.5 text-xs text-g-600">
          场次历史按主播查询，请从「房间管理」点进某个房间查看它的场次。
        </p>
        <el-button class="mt-4" type="primary" plain @click="router.push('/douyin/rooms')">
          <ArtSvgIcon icon="ri:arrow-left-line" class="mr-1" />
          去房间管理
        </el-button>
      </div>
    </div>

    <!-- 失败：明确区别于「没有数据」，并给重试入口（P0-3） -->
    <QueryErrorState
      v-else-if="queryError"
      class="mb-5"
      :message="queryError"
      :retrying="loading"
      @retry="refresh"
    />

    <!-- 场次列表 -->
    <div class="art-card p-5 mb-5">
      <div v-loading="loading" class="flex flex-col gap-2.5">
        <TransitionGroup name="dy-list" tag="div" class="flex flex-col gap-2.5" appear>
          <div
            v-for="row in pageSessions"
            :key="row.id"
            class="session-row rounded-xl bg-g-100/50 px-4 py-3 c-p group"
            role="button"
            tabindex="0"
            :aria-label="`查看场次 #${row.id} 详情`"
            @click="router.push(`/douyin/detail/${row.id}`)"
            @keydown.enter.prevent="router.push(`/douyin/detail/${row.id}`)"
            @keydown.space.prevent="router.push(`/douyin/detail/${row.id}`)"
          >
            <!-- 主行 -->
            <div class="flex items-center gap-3">
              <el-checkbox
                v-if="isAdmin"
                :model-value="selectedIds.includes(row.id)"
                class="-ml-1 shrink-0"
                @click.stop
                @change="toggleSelect(row.id)"
              />
              <el-avatar :size="36" :src="row.streamer_avatar" class="shrink-0">{{
                row.streamer_name?.[0] || '场'
              }}</el-avatar>
              <div class="flex-1 min-w-0">
                <div class="font-medium text-sm truncate text-g-900">{{
                  row.title || '场次 #' + row.id
                }}</div>
                <!-- 已结束的场次要能看到结束时间与时长；直播中则明确写"进行中" -->
                <div class="text-xs text-g-500 truncate mt-0.5">
                  {{ fmtSessionRange(row.started_at, row.ended_at) }}
                  <template v-if="row.duration_min"> · {{ formatDuration(row.duration_min) }}</template>
                  <template v-if="row.is_live"> · 进行中</template>
                </div>
              </div>
              <el-tag
                :type="row.is_live ? 'danger' : 'info'"
                size="small"
                effect="light"
                class="shrink-0 !border-none"
              >
                {{ row.is_live ? '直播中' : '已结束' }}
              </el-tag>
              <div class="flex items-center gap-1.5 shrink-0" @click.stop>
                <el-tooltip content="下载报告" placement="top" :hide-after="0">
                  <button
                    class="dy-pressable size-8 rounded-lg flex-cc bg-g-100/70 text-g-500 hover:bg-theme/10 hover:text-theme disabled:opacity-50 disabled:cursor-not-allowed"
                    :disabled="downloadingId !== null"
                    aria-label="下载报告"
                    @click="downloadReport(row.id)"
                  >
                    <ArtSvgIcon
                      :icon="downloadingId === row.id ? 'ri:loader-4-line' : 'ri:download-line'"
                      class="text-base"
                      :class="downloadingId === row.id ? 'animate-spin' : ''"
                    />
                  </button>
                </el-tooltip>
                <button
                  v-if="isAdmin"
                  class="dy-pressable size-8 rounded-lg flex-cc bg-g-100/70 text-g-500 hover:bg-danger/10 hover:text-danger"
                  aria-label="删除场次"
                  @click="remove(row)"
                >
                  <ArtSvgIcon icon="ri:delete-bin-7-line" class="text-base" />
                </button>
              </div>
            </div>
            <!-- 数据行 -->
            <div
              class="flex items-center gap-4 mt-2.5 pt-2.5 border-t border-dashed border-t-d text-xs text-g-600 flex-wrap"
            >
              <span class="flex items-center gap-1">
                <ArtSvgIcon icon="ri:diamond-line" class="text-g-400" />{{
                  fmtNum(row.total_diamonds)
                }}
              </span>
              <span class="flex items-center gap-1">
                <ArtSvgIcon icon="ri:gift-2-line" class="text-g-400" />{{ fmtNum(row.gift_count) }}
              </span>
              <span class="flex items-center gap-1">
                <ArtSvgIcon icon="ri:chat-3-line" class="text-g-400" />{{
                  fmtNum(row.danmaku_count)
                }}
              </span>
              <span class="flex items-center gap-1">
                <ArtSvgIcon icon="ri:user-3-line" class="text-g-400" />{{ fmtNum(row.user_count) }}
              </span>
            </div>
          </div>
        </TransitionGroup>
        <!-- 只有真的选了主播才谈"这个主播没有场次"：没有 hostId 时上面那张引导卡已经说明原因 -->
        <el-empty
          v-if="hostId && !filteredSessions.length && !loading"
          :description="dateRange ? '该时间段内没有场次' : '该主播暂无场次'"
        />
      </div>

      <div v-if="filteredSessions.length" class="flex justify-end mt-4">
        <el-pagination
          v-model:current-page="page"
          :page-size="pageSize"
          :total="filteredSessions.length"
          layout="prev, pager, next"
          background
        />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
  import { computed, onActivated, onDeactivated, onMounted, onUnmounted, ref, watch } from 'vue'
  import { useRoute, useRouter } from 'vue-router'
  import { ElMessage, ElMessageBox } from 'element-plus'
  import { fetchSessions, deleteSession, type Session } from '@/api/douyin'
  import { useUserStore } from '@/store/modules/user'
  import { fmtNum, fmtFull, fmtSessionRange, formatDuration } from '@/utils/format'
  import { apiErrorMessage } from '@/utils/douyin-error'
  import { downloadWithAuth } from '@/utils/download'

  defineOptions({ name: 'DouyinSessions' })

  const route = useRoute()
  const router = useRouter()
  const userStore = useUserStore()
  const isAdmin = computed(() => userStore.info.roles?.includes('R_SUPER') ?? false)

  const sessions = ref<Session[]>([])
  const hostId = ref((route.query.hostId as string) || '')
  const loading = ref(true)
  /** 取数失败的真实原因；非空时页面显示错误态而不是空态（P0-3） */
  const queryError = ref('')
  const selectedIds = ref<number[]>([])
  const dateRange = ref<[string, string] | null>(null)
  const page = ref(1)
  /** 正在生成/下载的报告 id，用于禁用重复点击 */
  const downloadingId = ref<number | null>(null)
  const batchDownloading = ref(false)
  const pageSize = 10

  const summaryCards = computed(() => [
    {
      label: '场次',
      icon: 'ri:live-line',
      value: fmtNum(sessions.value.length),
      title: `${sessions.value.length} 场`
    },
    {
      label: '总礼物',
      icon: 'ri:gift-2-line',
      value: fmtNum(sessions.value.reduce((s, x) => s + (x.gift_count || 0), 0)),
      title: fmtFull(sessions.value.reduce((s, x) => s + (x.gift_count || 0), 0))
    },
    {
      label: '总钻石',
      icon: 'ri:diamond-line',
      value: fmtNum(sessions.value.reduce((s, x) => s + (x.total_diamonds || 0), 0)),
      title: fmtFull(sessions.value.reduce((s, x) => s + (x.total_diamonds || 0), 0))
    },
    {
      label: '总弹幕',
      icon: 'ri:chat-3-line',
      value: fmtNum(sessions.value.reduce((s, x) => s + (x.danmaku_count || 0), 0)),
      title: fmtFull(sessions.value.reduce((s, x) => s + (x.danmaku_count || 0), 0))
    },
    {
      label: '总用户',
      icon: 'ri:user-3-line',
      value: fmtNum(sessions.value.reduce((s, x) => s + (x.user_count || 0), 0)),
      title: fmtFull(sessions.value.reduce((s, x) => s + (x.user_count || 0), 0))
    },
    {
      label: '总点赞',
      icon: 'ri:thumb-up-line',
      value: fmtNum(sessions.value.reduce((s, x) => s + (x.stats_like || 0), 0)),
      title: fmtFull(sessions.value.reduce((s, x) => s + (x.stats_like || 0), 0))
    }
  ])

  const filteredSessions = computed(() => {
    const from = dateRange.value?.[0]
    const to = dateRange.value?.[1]
    if (!from && !to) return sessions.value
    return sessions.value.filter((s) => {
      const d = String(s.started_at || '').substring(0, 10)
      if (!d) return true
      if (from && d < from) return false
      if (to && d > to) return false
      return true
    })
  })

  const pageSessions = computed(() => {
    const start = (page.value - 1) * pageSize
    return filteredSessions.value.slice(start, start + pageSize)
  })

  function onDateChange() {
    page.value = 1
  }

  function clearDate() {
    dateRange.value = null
    page.value = 1
  }

  /**
   * 拉取场次列表。
   *
   * P0-3 修复点：原来第一行是 `if (!hostId.value) return`，
   * 而 `loading` 初值为 true、只在 refresh 的 finally 里被置 false ——
   * 于是「直接打开 /douyin/sessions（没有 hostId）」时页面**永久转圈**，
   * 空态永远不会出现，看起来像一直在加载。
   *
   * 现在：没有 hostId 就明确进入「缺参数」空态并结束 loading；
   * 请求失败则进入错误态（带重试），而不是静默显示空列表。
   */
  async function refresh() {
    if (!hostId.value) {
      sessions.value = []
      queryError.value = ''
      loading.value = false
      return
    }
    const isFirst = !sessions.value.length
    if (isFirst) loading.value = true
    try {
      sessions.value = await fetchSessions(hostId.value)
      queryError.value = ''
    } catch (e) {
      queryError.value = apiErrorMessage(e, '场次列表加载失败')
    } finally {
      loading.value = false
    }
  }

  function toggleSelect(id: number) {
    if (selectedIds.value.includes(id)) {
      selectedIds.value = selectedIds.value.filter((x) => x !== id)
    } else {
      selectedIds.value = [...selectedIds.value, id]
    }
  }

  /**
   * 下载单场报告图片。
   *
   * P0-1 修复点：原来用 `window.open(getReportUrl(id))` —— 浏览器导航不带
   * Authorization 头，而后端对所有 /api/* 都要求 Bearer 认证，新标签只会显示
   * {"error":"未授权，请先登录"}，这个按钮永远不可能成功。
   * 现在改为带 token 取 blob 再触发保存。
   */
  async function downloadReport(id: number) {
    if (downloadingId.value !== null) return
    downloadingId.value = id
    try {
      // 报告可能由后端现生成（要渲染截图），耗时较长，加载态给足提示
      const name = await downloadWithAuth(
        getReportUrl(String(id)),
        `report_${id}.jpg`
      )
      ElMessage.success(`已保存 ${name}`)
    } catch (e) {
      ElMessage.error(apiErrorMessage(e, '报告下载失败'))
    } finally {
      downloadingId.value = null
    }
  }

  async function downloadSelectedReports() {
    const ids = [...selectedIds.value]
    if (!ids.length || batchDownloading.value) return
    batchDownloading.value = true
    let ok = 0
    const failed: string[] = []
    try {
      // 串行下载：并发打开多个保存对话框会被浏览器拦截，
      // 且后端每个报告都要渲染截图，串行也更稳。
      for (const id of ids) {
        try {
          await downloadWithAuth(getReportUrl(String(id)), `report_${id}.jpg`)
          ok++
        } catch (e) {
          failed.push(`#${id}（${apiErrorMessage(e, '失败')}）`)
        }
      }
    } finally {
      batchDownloading.value = false
    }
    if (ok) ElMessage.success(`已下载 ${ok} 份报告`)
    if (failed.length) {
      ElMessage.error(`${failed.length} 份下载失败：${failed.join('、')}`)
    }
  }

  function onBatchCommand(cmd: string) {
    if (cmd === 'download') downloadSelectedReports()
    else if (cmd === 'delete') removeSelected()
  }

  async function remove(row: Session) {
    try {
      await ElMessageBox.confirm(`确定删除场次 #${row.id} 及全部数据？`, '删除确认', {
        type: 'warning'
      })
    } catch {
      return
    }
    try {
      await deleteSession(String(row.id))
    } catch (e) {
      // 失败必须说清楚：以前这里是裸 await，异常逃逸后界面还会提示「已删除」（UI-AUDIT P1-12）
      ElMessage.error(apiErrorMessage(e, '删除失败'))
      return
    }
    ElMessage.success('已删除')
    selectedIds.value = selectedIds.value.filter((x) => x !== row.id)
    refresh()
  }

  async function removeSelected() {
    const ids = selectedIds.value
    if (!ids.length) return
    try {
      await ElMessageBox.confirm(`确定删除选中的 ${ids.length} 场数据？`, '删除确认', {
        type: 'warning'
      })
    } catch {
      return
    }
    let ok = 0
    const failed: string[] = []
    for (const id of ids) {
      try {
        await deleteSession(String(id))
        ok++
      } catch (e) {
        failed.push(`#${id} ${apiErrorMessage(e, '失败')}`)
      }
    }
    if (ok) ElMessage.success(`已删除 ${ok} 场`)
    if (failed.length) {
      ElMessage.error(
        `${failed.length} 场删除失败：${failed.slice(0, 3).join('、')}${failed.length > 3 ? ' 等' : ''}`
      )
    }
    selectedIds.value = []
    refresh()
  }

  watch(
    () => route.query.hostId,
    (val) => {
      hostId.value = (val as string) || ''
      selectedIds.value = []
      page.value = 1
      refresh()
    }
  )

  let timer: number | undefined

  function stopPolling() {
    if (timer) clearInterval(timer)
    timer = undefined
  }

  function startPolling() {
    stopPolling()
    timer = window.setInterval(() => {
      // 切走时由 onDeactivated 停表；这里再挡一层"浏览器标签页被隐藏"
      if (document.visibilityState === 'visible') refresh()
    }, 15000)
  }

  // keep-alive：切回来刷新并恢复轮询、切走停止。
  // 旧版只在 onUnmounted 清定时器，而这页被缓存（且 isHideTab，标签关不掉）→
  // 停在任何其他页面时它都还在每 15s 请求（实测复现，UI-AUDIT P1-7）。
  let activatedOnce = false
  onMounted(() => {
    refresh()
    startPolling()
  })
  onActivated(() => {
    // 首次挂载时 mounted 与 activated 都会触发，跳过以免重复请求
    if (!activatedOnce) {
      activatedOnce = true
      return
    }
    refresh()
    startPolling()
  })
  onDeactivated(() => stopPolling())
  onUnmounted(() => stopPolling())
</script>

<style scoped>
  /* 工具条控件圆角与卡片统一 */
  :deep(.session-toolbar .el-input__wrapper) {
    border-radius: 10px;
    background: var(--art-gray-100);
    box-shadow: none;
    transition: box-shadow var(--dy-dur-fast) ease;
  }

  :deep(.session-toolbar .el-input__wrapper:hover) {
    box-shadow: 0 0 0 1px var(--art-gray-400) inset;
  }

  :deep(.session-toolbar .el-input__wrapper.is-focus) {
    box-shadow: 0 0 0 1px var(--theme-color) inset;
  }

  :deep(.session-toolbar .el-button),
  :deep(.session-toolbar .el-date-editor) {
    border-radius: 10px;
  }

  /*
   * 场次行：可点进行详情。
   * 进出场用全局 `.dy-list-*`（见 assets/styles/custom/douyin-motion.scss），
   * 原来这里是 `transition: all 0.35s ease` —— transition-all 会过渡到布局属性上，
   * 而且退出用 scale(0.98)、进场用 translateY(8px)，方向不一致会显得"散"。
   */
  .session-row {
    transition: background-color var(--dy-dur-fast) ease;
  }

  @media (hover: hover) and (pointer: fine) {
    .session-row:hover {
      background-color: var(--art-gray-100);
    }
  }

  .session-row:active {
    background-color: var(--art-gray-100);
  }

  .session-row:focus-visible {
    outline: none;
    box-shadow:
      0 0 0 2px #fff,
      0 0 0 4px var(--theme-color);
  }
</style>
