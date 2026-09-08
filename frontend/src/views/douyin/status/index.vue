<template>
  <div class="p-4">
    <el-row :gutter="16" class="mb-4">
      <el-col :span="8">
        <el-card shadow="never">
          <template #header>守护进程 (monitor.js)</template>
          <div class="flex items-center gap-3">
            <el-tag :type="daemonRunning ? 'success' : 'danger'">
              {{ daemonRunning ? '运行中' : '未运行' }}
            </el-tag>
            <span class="text-sm text-gray-400">PID: {{ daemon?.data?.pid ?? '-' }}</span>
          </div>
          <el-alert
            v-if="!daemonRunning"
            class="mt-3"
            type="warning"
            :closable="false"
            title="守护进程未运行，请执行 node monitor.js --daemon"
          />
        </el-card>
      </el-col>
      <el-col :span="8">
        <el-card shadow="never">
          <template #header>WebSocket 连接</template>
          <div class="text-2xl font-bold">{{ connectedCount }}</div>
          <div class="text-sm text-gray-400">已连接房间数</div>
        </el-card>
      </el-col>
      <el-col :span="8">
        <el-card shadow="never">
          <template #header>录制中</template>
          <div class="text-2xl font-bold">{{ recordingCount }}</div>
          <div class="text-sm text-gray-400">正在录制的房间数</div>
        </el-card>
      </el-col>
    </el-row>

    <el-card shadow="never">
      <template #header>
        <div class="flex items-center justify-between">
          <span>房间实时状态</span>
          <el-button size="small" @click="refresh">刷新</el-button>
        </div>
      </template>
      <el-table :data="roomStatusRows" v-loading="loading">
        <el-table-column prop="roomId" label="房间ID" width="160" />
        <el-table-column label="WS 连接" width="110">
          <template #default="{ row }">
            <el-tag :type="row.connected ? 'success' : 'danger'" size="small">
              {{ row.connected ? '已连接' : '断开' }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="录制" width="90">
          <template #default="{ row }">
            <el-tag :type="row.recording ? 'warning' : 'info'" size="small">
              {{ row.recording ? '录制中' : '空闲' }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="直播状态" width="120">
          <template #default="{ row }">{{ row.liveStatus || '-' }}</template>
        </el-table-column>
        <el-table-column label="实时统计" min-width="200">
          <template #default="{ row }">
            <span v-if="row.stats" class="text-sm text-gray-500">
              弹幕 {{ row.stats.danmaku ?? 0 }} · 礼物 {{ row.stats.gift ?? 0 }}
            </span>
            <span v-else class="text-sm text-gray-300">-</span>
          </template>
        </el-table-column>
      </el-table>
      <el-empty v-if="!roomStatusRows.length && !loading" description="守护进程未运行或无房间" />
    </el-card>
  </div>
</template>

<script setup lang="ts">
  import { computed, onMounted, onUnmounted, ref } from 'vue'
  import { fetchStatus, type DaemonStatus, type RoomStatus } from '@/api/douyin'

  defineOptions({ name: 'DouyinStatus' })

  const daemon = ref<DaemonStatus | null>(null)
  const loading = ref(true)

  const daemonRunning = computed(() => Boolean(daemon.value?.data?.running))
  const roomStatusRows = computed(() => {
    const rooms = daemon.value?.data?.rooms || {}
    return Object.entries(rooms).map(([roomId, s]) => ({ roomId, ...(s as RoomStatus) }))
  })
  const connectedCount = computed(() => roomStatusRows.value.filter((r) => r.connected).length)
  const recordingCount = computed(() => roomStatusRows.value.filter((r) => r.recording).length)

  async function refresh() {
    const isFirst = !daemon.value
    if (isFirst) loading.value = true
    try {
      daemon.value = await fetchStatus()
    } finally {
      loading.value = false
    }
  }

  let timer: number | undefined
  onMounted(() => {
    refresh()
    timer = window.setInterval(refresh, 10000)
  })
  onUnmounted(() => clearInterval(timer))
</script>
