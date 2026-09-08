<template>
  <div class="p-4">
    <!-- 工具条 -->
    <div class="art-card relative px-5 py-4 mb-5 flex items-center justify-between gap-3 flex-wrap">
      <div class="flex items-center gap-3">
        <span class="font-bold text-g-900">房间管理</span>
        <el-tag :type="connectedCount > 0 ? 'success' : 'info'" size="small">
          {{ connectedCount }} 监控中
        </el-tag>
        <el-tag type="warning" size="small">{{ pausedCount }} 已暂停</el-tag>
      </div>
      <div class="flex gap-2">
        <el-input
          v-model="search"
          placeholder="房间号或主播名"
          class="!w-56"
          clearable
          @keyup.enter="doSearch"
        />
        <el-button v-if="isAdmin" type="success" @click="showAdd = true">添加房间</el-button>
      </div>
    </div>

    <div v-loading="loading">
      <ElRow :gutter="20">
        <ElCol v-for="row in rooms" :key="row.room_id" :sm="24" :md="12" :lg="8">
          <div
            class="art-card relative p-4 mb-5 c-p group transition-shadow hover:shadow-md"
            @click="goSessions(row)"
          >
            <div class="flex items-center gap-3">
              <div class="relative shrink-0">
                <el-avatar :size="48" :src="row.avatar">{{
                  row.name?.[0] || row.room_id?.[0]
                }}</el-avatar>
                <div
                  v-if="row.recording"
                  class="absolute -bottom-0.5 -right-0.5 size-3 rounded-full bg-success border-2 border-white"
                />
              </div>
              <div class="flex-1 min-w-0">
                <div class="font-medium truncate text-g-900">{{ row.name || row.room_id }}</div>
                <div class="flex items-center gap-2 mt-0.5">
                  <el-tag
                    :type="
                      row.connected
                        ? row.recording
                          ? 'primary'
                          : 'success'
                        : row.enabled
                          ? 'warning'
                          : 'info'
                    "
                    size="small"
                    effect="light"
                    class="!border-none"
                  >
                    {{
                      row.connected
                        ? row.recording
                          ? '录制中'
                          : '监控中'
                        : row.enabled
                          ? '已暂停'
                          : '离线'
                    }}
                  </el-tag>
                  <span class="text-xs text-g-500">{{ row.session_count ?? 0 }} 场</span>
                </div>
              </div>
              <div class="flex items-center gap-1.5 shrink-0" @click.stop>
                <template v-if="isAdmin">
                  <el-button
                    text
                    size="small"
                    class="!p-0 !border-none !bg-transparent h-7"
                    @click="row.connected ? pause(row) : resume(row)"
                  >
                    <span
                      class="flex-cc size-7 rounded-lg"
                      :class="
                        row.connected ? 'bg-warning/15 text-warning' : 'bg-success/15 text-success'
                      "
                    >
                      <ArtSvgIcon
                        :icon="row.connected ? 'ri:pause-line' : 'ri:play-line'"
                        class="text-base"
                      />
                    </span>
                  </el-button>
                  <el-popconfirm title="确认删除该房间及数据？" @confirm="remove(row)">
                    <template #reference>
                      <el-button
                        text
                        size="small"
                        class="!p-0 !border-none !bg-transparent h-7"
                        @click.stop
                      >
                        <span class="flex-cc size-7 rounded-lg bg-danger/15 text-danger">
                          <ArtSvgIcon icon="ri:close-line" class="text-base" />
                        </span>
                      </el-button>
                    </template>
                  </el-popconfirm>
                </template>
              </div>
            </div>
          </div>
        </ElCol>
      </ElRow>
      <el-empty v-if="!rooms.length && !loading" description="暂无房间" />
    </div>

    <el-dialog v-model="showAdd" title="添加房间" width="460">
      <el-form label-width="80px">
        <el-form-item label="房间号">
          <el-input v-model="newRoomId" placeholder="抖音房间号" />
          <div class="text-xs text-gray-400 mt-1">纯数字为房间号，含字母为抖音号</div>
        </el-form-item>
        <el-form-item label="主播名">
          <el-input v-model="newRoomName" placeholder="选填，可留空" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="showAdd = false">取消</el-button>
        <el-button type="primary" :loading="adding" @click="add">确定</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
  import { computed, onMounted, onUnmounted, ref } from 'vue'
  import { useRouter } from 'vue-router'
  import { ElMessage } from 'element-plus'
  import { fetchRooms, addRoom, pauseRoom, resumeRoom, removeRoom, type Room } from '@/api/douyin'
  import { useUserStore } from '@/store/modules/user'

  defineOptions({ name: 'DouyinRooms' })

  const userStore = useUserStore()
  const isAdmin = computed(() => userStore.info.roles?.includes('R_SUPER') ?? false)

  const router = useRouter()
  const rooms = ref<Room[]>([])
  const loading = ref(true)
  const search = ref('')
  const showAdd = ref(false)
  const newRoomId = ref('')
  const newRoomName = ref('')
  const adding = ref(false)

  const connectedCount = computed(() => rooms.value.filter((r) => r.connected).length)
  const pausedCount = computed(() => rooms.value.filter((r) => !r.enabled).length)

  function goSessions(row: Room) {
    router.push({ path: '/douyin/sessions', query: { hostId: row.room_id } })
  }

  async function refresh() {
    const isFirst = !rooms.value.length
    if (isFirst) loading.value = true
    try {
      rooms.value = await fetchRooms()
    } finally {
      loading.value = false
    }
  }

  function doSearch() {
    router.push({ path: '/douyin/sessions', query: { hostId: search.value } })
  }

  async function add() {
    if (!newRoomId.value) return
    adding.value = true
    try {
      await addRoom(newRoomId.value, newRoomName.value)
      ElMessage.success('添加成功')
      showAdd.value = false
      newRoomId.value = ''
      newRoomName.value = ''
      refresh()
    } finally {
      adding.value = false
    }
  }

  async function pause(row: Room) {
    await pauseRoom(row.room_id)
    ElMessage.success('已暂停')
    refresh()
  }

  async function resume(row: Room) {
    await resumeRoom(row.room_id)
    ElMessage.success('已恢复')
    refresh()
  }

  async function remove(row: Room) {
    await removeRoom(row.room_id)
    ElMessage.success('已删除')
    refresh()
  }

  let timer: number | undefined
  onMounted(() => {
    refresh()
    timer = window.setInterval(refresh, 10000)
  })
  onUnmounted(() => clearInterval(timer))
</script>
