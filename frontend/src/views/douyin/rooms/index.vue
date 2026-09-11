<template>
  <div class="p-4">
    <!-- 工具条 -->
    <div
      class="art-card room-toolbar px-5 py-4 mb-5 flex items-center justify-between gap-4 flex-wrap"
    >
      <div class="flex items-center gap-3">
        <div class="size-10 rounded-lg flex-cc bg-theme/10 shrink-0">
          <ArtSvgIcon icon="ri:live-line" class="text-lg text-theme" />
        </div>
        <div>
          <div class="font-bold text-g-900 leading-tight">房间管理</div>
          <div class="flex items-center gap-2.5 mt-1.5 text-xs text-g-500">
            <span class="flex items-baseline gap-1">
              <b class="text-[13px] font-semibold text-g-900">{{ rooms.length }}</b
              >房间
            </span>
            <span class="w-px h-3 bg-g-300" />
            <span class="flex items-baseline gap-1">
              <b class="text-[13px] font-semibold text-success">{{ connectedCount }}</b
              >监控中
            </span>
            <span class="w-px h-3 bg-g-300" />
            <span class="flex items-baseline gap-1">
              <b class="text-[13px] font-semibold text-warning">{{ pausedCount }}</b
              >已暂停
            </span>
          </div>
        </div>
      </div>
      <div class="flex gap-2">
        <el-input
          v-model="search"
          placeholder="搜索房间号或主播名"
          style="width: 220px"
          clearable
          @keyup.enter="doSearch"
        >
          <template #prefix>
            <ArtSvgIcon icon="ri:search-line" class="text-g-400" />
          </template>
        </el-input>
        <el-button v-if="isAdmin" type="primary" @click="showAdd = true">
          <ArtSvgIcon icon="ri:add-line" class="mr-1" />
          添加房间
        </el-button>
      </div>
    </div>

    <div v-loading="loading">
      <ElRow :gutter="20">
        <ElCol v-for="row in rooms" :key="row.room_id" :sm="24" :md="12" :lg="8">
          <div
            class="art-card relative px-5 py-4 mb-5 c-p group transition-all duration-300 hover:shadow-lg hover:-translate-y-0.5"
            @click="goSessions(row)"
          >
            <div class="flex items-center gap-3.5">
              <!-- 头像 -->
              <div class="relative shrink-0">
                <el-avatar :size="48" :src="row.avatar">{{
                  (row.name || row.room_id)?.[0]
                }}</el-avatar>
                <span
                  v-if="row.recording"
                  class="absolute -bottom-0.5 -right-0.5 size-3 rounded-full bg-success ring-2 ring-white"
                />
              </div>

              <!-- 主播名 + 状态 -->
              <div class="flex-1 min-w-0">
                <div class="text-[17px] font-medium text-g-900 truncate leading-snug">
                  {{ row.name || row.room_id }}
                </div>
                <div class="flex items-center gap-1.5 mt-1">
                  <span class="size-1.5 rounded-full shrink-0" :class="dotClass(row)" />
                  <span class="text-xs text-g-600">{{ statusText(row) }}</span>
                </div>
              </div>

              <!-- 操作 -->
              <div class="flex items-center gap-1.5 shrink-0" @click.stop>
                <template v-if="isAdmin">
                  <el-tooltip
                    :content="row.connected ? '暂停监控' : '恢复监控'"
                    placement="top"
                    :hide-after="0"
                  >
                    <button
                      class="size-8 rounded-lg flex-cc bg-g-100/70 text-g-500 hover:bg-theme/10 hover:text-theme transition-colors"
                      @click="row.connected ? pause(row) : resume(row)"
                    >
                      <ArtSvgIcon
                        :icon="row.connected ? 'ri:pause-line' : 'ri:play-line'"
                        class="text-base"
                      />
                    </button>
                  </el-tooltip>
                  <el-popconfirm title="确认删除该房间及数据？" @confirm="remove(row)">
                    <template #reference>
                      <button
                        class="size-8 rounded-lg flex-cc bg-g-100/70 text-g-500 hover:bg-danger/10 hover:text-danger transition-colors"
                        @click.stop
                      >
                        <ArtSvgIcon icon="ri:delete-bin-7-line" class="text-base" />
                      </button>
                    </template>
                  </el-popconfirm>
                </template>
              </div>
            </div>

            <!-- 数据区 -->
            <div
              class="flex items-center justify-between mt-4 pt-3.5 border-t border-dashed border-t-d"
            >
              <div class="flex items-baseline gap-1">
                <span class="text-[22px] font-medium text-g-900 leading-none">{{
                  row.session_count ?? 0
                }}</span>
                <span class="text-xs text-g-500">场次</span>
              </div>
              <span class="text-xs text-g-500 truncate">
                {{ row.last_session_time ? '最近 ' + fmtTime(row.last_session_time) : '暂无直播' }}
              </span>
            </div>
          </div>
        </ElCol>
      </ElRow>
      <div v-if="!rooms.length && !loading" class="art-card px-5 py-4 mb-5">
        <el-empty description="暂无房间，点击右上角添加" />
      </div>
    </div>

    <!-- 添加房间弹窗 -->
    <el-dialog
      v-model="showAdd"
      :show-header="false"
      :show-close="false"
      width="420"
      class="add-room-dialog"
      align-center
    >
      <div class="px-5 py-4">
        <!-- 头部 -->
        <div class="flex items-center justify-between mb-3.5">
          <span class="font-bold text-g-900">添加房间</span>
          <button
            class="size-7 rounded-lg flex-cc bg-g-100/70 text-g-500 hover:bg-g-100 hover:text-g-900 transition-colors"
            @click="showAdd = false"
          >
            <ArtSvgIcon icon="ri:close-line" class="text-base" />
          </button>
        </div>

        <!-- 表单 -->
        <div class="mb-3">
          <label class="block text-sm text-g-700 mb-1.5">
            房间号 <span class="text-danger">*</span>
          </label>
          <el-input
            v-model="newRoomId"
            placeholder="请输入抖音房间号或抖音号"
            clearable
            @keyup.enter="add"
          >
            <template #prefix>
              <ArtSvgIcon icon="ri:live-line" class="text-g-400" />
            </template>
          </el-input>
          <div class="mt-1.5 text-xs text-g-500">纯数字为房间号，含字母为抖音号</div>
        </div>
        <div class="mb-4">
          <label class="block text-sm text-g-700 mb-1.5">
            主播名 <span class="text-g-400">（选填）</span>
          </label>
          <el-input v-model="newRoomName" placeholder="留空则自动获取" clearable>
            <template #prefix>
              <ArtSvgIcon icon="ri:user-line" class="text-g-400" />
            </template>
          </el-input>
        </div>

        <!-- 按钮 -->
        <div class="flex justify-end gap-2">
          <el-button @click="showAdd = false">取消</el-button>
          <el-button type="primary" :loading="adding" :disabled="!newRoomId.trim()" @click="add">
            确认添加
          </el-button>
        </div>
      </div>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
  import { computed, onMounted, onUnmounted, ref } from 'vue'
  import { useRouter } from 'vue-router'
  import { ElMessage } from 'element-plus'
  import { fetchRooms, addRoom, pauseRoom, resumeRoom, removeRoom, type Room } from '@/api/douyin'
  import { useUserStore } from '@/store/modules/user'
  import { fmtTime } from '@/utils/format'

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

  function statusText(row: Room) {
    if (row.recording) return '录制中'
    if (row.connected) return '监控中'
    if (row.enabled) return '连接中'
    return '已暂停'
  }

  function dotClass(row: Room) {
    if (row.recording) return 'bg-theme'
    if (row.connected) return 'bg-success'
    if (row.enabled) return 'bg-warning'
    return 'bg-g-400'
  }

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
    const id = newRoomId.value.trim()
    if (!id) return
    adding.value = true
    try {
      await addRoom(id, newRoomName.value.trim())
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

<style>
  /* 覆盖模板全局 .el-dialog__body 的 25px 内边距与 dialog 自身内边距，由内容自行控制间距 */
  .el-dialog.add-room-dialog {
    --el-dialog-padding-primary: 0px;
  }

  .el-dialog.add-room-dialog .el-dialog__body {
    padding: 0 !important;
  }
</style>

<style scoped>
  /* 工具条控件圆角与卡片统一（卡片 16px，控件默认仅 6px） */
  :deep(.room-toolbar .el-input__wrapper) {
    border-radius: 10px;
    background: var(--art-gray-100);
    box-shadow: none;
    transition: box-shadow 0.2s ease;
  }

  :deep(.room-toolbar .el-input__wrapper:hover) {
    box-shadow: 0 0 0 1px var(--art-gray-400) inset;
  }

  :deep(.room-toolbar .el-input__wrapper.is-focus) {
    box-shadow: 0 0 0 1px var(--theme-color) inset;
  }

  :deep(.room-toolbar .el-button) {
    border-radius: 10px;
  }
</style>
