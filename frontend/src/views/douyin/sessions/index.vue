<template>
  <div class="p-4">
    <!-- 面包屑导航 -->
    <el-breadcrumb class="mb-5" separator="/">
      <el-breadcrumb-item :to="{ path: '/douyin/rooms' }">
        <ArtSvgIcon icon="ri:home-4-line" class="text-sm text-g-500" /> 房间管理
      </el-breadcrumb-item>
      <el-breadcrumb-item>场次历史</el-breadcrumb-item>
    </el-breadcrumb>

    <!-- 顶部实时汇总（当前主播全部场次） -->
    <div class="flex flex-wrap gap-5 mb-5">
      <div
        v-for="card in summaryCards"
        :key="card.label"
        class="art-card relative flex-1 min-w-[150px] flex flex-col justify-center h-24 px-5"
      >
        <div class="flex items-center justify-between pr-2">
          <span class="text-g-700 text-sm">{{ card.label }}</span>
          <div class="size-9 rounded-lg flex-cc bg-theme/10 shrink-0">
            <ArtSvgIcon :icon="card.icon" class="text-base text-theme" />
          </div>
        </div>
        <span class="text-[22px] font-bold text-g-900 leading-tight mt-1">{{ card.value }}</span>
      </div>
    </div>

    <!-- 场次列表 -->
    <div class="art-card p-5 mb-5">
      <div class="flex items-center justify-between flex-wrap gap-3 px-1 pb-4 border-b border-t-d">
        <div class="flex items-center gap-3">
          <span class="font-bold text-g-900">场次历史</span>
          <span class="text-sm text-g-500">{{ filteredSessions.length }} 场</span>
        </div>
        <div class="flex items-center gap-3">
          <el-date-picker
            v-model="dateRange"
            type="daterange"
            range-separator="~"
            start-placeholder="开始日期"
            end-placeholder="结束日期"
            value-format="YYYY-MM-DD"
            size="default"
            class="!w-64"
            @change="onDateChange"
          />
          <el-button v-if="dateRange" size="small" @click="clearDate">清除</el-button>
          <template v-if="isAdmin">
            <el-dropdown v-if="selectedIds.length" trigger="click" @command="onBatchCommand">
              <el-button size="small" type="primary" plain>
                批量 ({{ selectedIds.length }})
                <el-icon class="ml-1"><ri:arrow-down-s-line /></el-icon>
              </el-button>
              <template #dropdown>
                <el-dropdown-menu>
                  <el-dropdown-item command="download">下载报告</el-dropdown-item>
                  <el-dropdown-item command="delete" class="text-danger">删除</el-dropdown-item>
                </el-dropdown-menu>
              </template>
            </el-dropdown>
          </template>
        </div>
      </div>

      <div v-loading="loading" class="flex flex-col gap-2.5 mt-4">
        <div
          v-for="row in pageSessions"
          :key="row.id"
          class="flex items-center gap-3 rounded-xl bg-g-100/50 px-3 py-2.5 c-p group hover:bg-g-100/70 transition-colors"
          @click="router.push(`/douyin/detail/${row.id}`)"
        >
          <el-checkbox
            v-if="isAdmin"
            :model-value="selectedIds.includes(row.id)"
            class="-ml-1 shrink-0"
            @click.stop
            @change="toggleSelect(row.id)"
          />
          <el-avatar :size="34" :src="row.streamer_avatar" class="shrink-0">{{
            row.streamer_name?.[0] || '场'
          }}</el-avatar>
          <div class="flex-1 min-w-0">
            <div class="font-medium text-sm truncate text-g-900">{{
              row.title || '场次 #' + row.id
            }}</div>
            <div class="text-xs text-g-500 truncate">{{ fmtTime(row.started_at) }}</div>
          </div>
          <el-tag
            :type="row.is_live ? 'danger' : 'info'"
            size="small"
            effect="light"
            class="shrink-0"
          >
            {{ row.is_live ? '直播中' : '已结束' }}
          </el-tag>
          <span class="flex items-center gap-1 text-xs text-g-600 shrink-0">
            <ArtSvgIcon icon="ri:diamond-line" class="text-g-400" />{{ fmtNum(row.total_diamonds) }}
          </span>
          <span class="flex items-center gap-1 text-xs text-g-600 shrink-0">
            <ArtSvgIcon icon="ri:gift-2-line" class="text-g-400" />{{ fmtNum(row.gift_count) }}
          </span>
          <span class="flex items-center gap-1 text-xs text-g-600 shrink-0">
            <ArtSvgIcon icon="ri:chat-3-line" class="text-g-400" />{{ fmtNum(row.danmaku_count) }}
          </span>
          <span class="flex items-center gap-1 text-xs text-g-600 shrink-0">
            <ArtSvgIcon icon="ri:user-3-line" class="text-g-400" />{{ fmtNum(row.user_count) }}
          </span>
          <el-tooltip content="下载报告" placement="top" :hide-after="0">
            <el-button
              text
              size="small"
              class="!p-0 !border-none !bg-transparent h-7 shrink-0"
              @click.stop="downloadReport(row.id)"
              ><span class="flex-cc size-7 rounded-lg bg-success/15 text-success"
                ><ArtSvgIcon icon="ri:download-line" class="text-base" /></span
            ></el-button>
          </el-tooltip>
          <el-button
            v-if="isAdmin"
            text
            size="small"
            class="!p-0 !border-none !bg-transparent h-7 shrink-0"
            @click.stop="remove(row)"
            ><span class="flex-cc size-7 rounded-lg bg-danger/15 text-danger"
              ><ArtSvgIcon icon="ri:delete-bin-7-line" class="text-base" /></span
          ></el-button>
        </div>
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
  import { computed, onMounted, ref } from 'vue'
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

  onMounted(() => {
    refresh()
  })
</script>
