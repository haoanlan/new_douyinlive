<template>
  <div class="p-4">
    <!-- 面包屑导航 -->
    <el-breadcrumb class="mb-5" separator="/">
      <el-breadcrumb-item :to="{ path: '/douyin/rooms' }">
        <ArtSvgIcon icon="ri:home-4-line" class="text-sm text-g-500" /> 房间管理
      </el-breadcrumb-item>
      <el-breadcrumb-item>场次历史</el-breadcrumb-item>
    </el-breadcrumb>

    <!-- 顶部汇总 -->
    <ElRow :gutter="20">
      <ElCol v-for="card in summaryCards" :key="card.label" :xs="12" :sm="8" :md="8" :lg="4">
        <div class="art-card flex items-center justify-between h-20 px-5 mb-5">
          <div class="min-w-0">
            <div class="text-xs text-g-500">{{ card.label }}</div>
            <div class="text-[20px] font-medium text-g-900 mt-1 leading-none truncate">
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
      class="art-card session-toolbar px-5 py-4 mb-5 flex items-center justify-between gap-4 flex-wrap"
    >
      <div class="flex items-center gap-2.5">
        <span class="font-bold text-g-900">场次历史</span>
        <span class="text-xs text-g-500">
          共 {{ filteredSessions.length }} 场<template v-if="dateRange">（已筛选）</template>
        </span>
      </div>
      <div class="flex items-center gap-2">
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
        <el-dropdown v-if="isAdmin && selectedIds.length" trigger="click" @command="onBatchCommand">
          <el-button type="primary">
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

    <!-- 场次列表 -->
    <div class="art-card p-5 mb-5">
      <div v-loading="loading" class="flex flex-col gap-2.5">
        <TransitionGroup name="row" tag="div" class="flex flex-col gap-2.5" appear>
          <div
            v-for="row in pageSessions"
            :key="row.id"
            class="rounded-xl bg-g-100/50 px-4 py-3 c-p group transition-colors hover:bg-g-100"
            @click="router.push(`/douyin/detail/${row.id}`)"
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
                <div class="text-xs text-g-500 truncate mt-0.5">{{ fmtTime(row.started_at) }}</div>
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
                    class="size-8 rounded-lg flex-cc bg-g-100/70 text-g-500 hover:bg-theme/10 hover:text-theme transition-colors"
                    @click="downloadReport(row.id)"
                  >
                    <ArtSvgIcon icon="ri:download-line" class="text-base" />
                  </button>
                </el-tooltip>
                <button
                  v-if="isAdmin"
                  class="size-8 rounded-lg flex-cc bg-g-100/70 text-g-500 hover:bg-danger/10 hover:text-danger transition-colors"
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
        <el-empty v-if="!filteredSessions.length && !loading" description="该主播暂无场次" />
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
  import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
  import { useRoute, useRouter } from 'vue-router'
  import { ElMessage, ElMessageBox } from 'element-plus'
  import { fetchSessions, deleteSession, getReportUrl, type Session } from '@/api/douyin'
  import { useUserStore } from '@/store/modules/user'
  import { fmtTime, fmtNum } from '@/utils/format'

  defineOptions({ name: 'DouyinSessions' })

  const route = useRoute()
  const router = useRouter()
  const userStore = useUserStore()
  const isAdmin = computed(() => userStore.info.roles?.includes('R_SUPER') ?? false)

  const sessions = ref<Session[]>([])
  const hostId = ref((route.query.hostId as string) || '')
  const loading = ref(true)
  const selectedIds = ref<number[]>([])
  const dateRange = ref<[string, string] | null>(null)
  const page = ref(1)
  const pageSize = 10

  const summaryCards = computed(() => [
    { label: '场次', icon: 'ri:live-line', value: fmtNum(sessions.value.length) },
    {
      label: '总礼物',
      icon: 'ri:gift-2-line',
      value: fmtNum(sessions.value.reduce((s, x) => s + (x.gift_count || 0), 0))
    },
    {
      label: '总钻石',
      icon: 'ri:diamond-line',
      value: fmtNum(sessions.value.reduce((s, x) => s + (x.total_diamonds || 0), 0))
    },
    {
      label: '总弹幕',
      icon: 'ri:chat-3-line',
      value: fmtNum(sessions.value.reduce((s, x) => s + (x.danmaku_count || 0), 0))
    },
    {
      label: '总用户',
      icon: 'ri:user-3-line',
      value: fmtNum(sessions.value.reduce((s, x) => s + (x.user_count || 0), 0))
    },
    {
      label: '总点赞',
      icon: 'ri:thumb-up-line',
      value: fmtNum(sessions.value.reduce((s, x) => s + (x.stats_like || 0), 0))
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

  async function refresh() {
    if (!hostId.value) return
    const isFirst = !sessions.value.length
    if (isFirst) loading.value = true
    try {
      sessions.value = await fetchSessions(hostId.value)
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

  function downloadReport(id: number) {
    window.open(getReportUrl(String(id)), '_blank')
  }

  function downloadSelectedReports() {
    const ids = selectedIds.value
    ids.forEach((id, i) =>
      setTimeout(() => window.open(getReportUrl(String(id)), '_blank'), i * 500)
    )
    ElMessage.success(`正在生成 ${ids.length} 份报告...`)
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
    await deleteSession(String(row.id))
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
    for (const id of ids) {
      try {
        await deleteSession(String(id))
        ok++
      } catch {
        /* ignore */
      }
    }
    ElMessage.success(`已删除 ${ok} 场`)
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
  onMounted(() => {
    refresh()
    timer = window.setInterval(refresh, 15000)
  })
  onUnmounted(() => clearInterval(timer))
</script>

<style scoped>
  /* 工具条控件圆角与卡片统一 */
  :deep(.session-toolbar .el-input__wrapper) {
    border-radius: 10px;
    background: var(--art-gray-100);
    box-shadow: none;
    transition: box-shadow 0.2s ease;
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

  .row-enter-active,
  .row-leave-active {
    transition: all 0.35s ease;
  }

  .row-enter-from {
    opacity: 0;
    transform: translateY(8px);
  }

  .row-leave-to {
    opacity: 0;
    transform: scale(0.98);
  }

  .row-move {
    transition: transform 0.35s ease;
  }
</style>
