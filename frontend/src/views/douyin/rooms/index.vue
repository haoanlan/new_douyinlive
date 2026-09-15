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
        <el-button v-if="isAdmin" type="primary" @click="openAdd">
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
              <!-- 头像（flex 消除 el-avatar 作为 inline 元素的基线间隙：
                   否则外层容器会比头像高 6px，导致录制绿点下坠到头像之外） -->
              <div class="relative shrink-0 flex">
                <el-avatar :size="48" :src="row.avatar">{{ avatarLetter(row) }}</el-avatar>
                <span
                  v-if="row.recording"
                  class="absolute -bottom-0.5 -right-0.5 size-3 rounded-full bg-success ring-2 ring-white"
                />
              </div>

              <!-- 主播名 + 状态 -->
              <div class="flex-1 min-w-0">
                <div
                  class="text-[17px] font-medium truncate leading-snug"
                  :class="isNamePending(row) ? 'text-g-400 italic' : 'text-g-900'"
                >
                  {{ displayName(row) }}
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
                    :content="row.enabled ? '暂停监控' : '恢复监控'"
                    placement="top"
                    :hide-after="0"
                  >
                    <button
                      class="size-8 rounded-lg flex-cc bg-g-100/70 text-g-500 hover:bg-theme/10 hover:text-theme transition-colors"
                      @click="row.enabled ? pause(row) : resume(row)"
                    >
                      <ArtSvgIcon
                        :icon="row.enabled ? 'ri:pause-line' : 'ri:play-line'"
                        class="text-base"
                      />
                    </button>
                  </el-tooltip>
                  <el-tooltip content="删除房间（含历史数据）" placement="top" :hide-after="0">
                    <button
                      class="size-8 rounded-lg flex-cc bg-g-100/70 text-g-500 hover:bg-danger/10 hover:text-danger transition-colors"
                      @click.stop="remove(row)"
                    >
                      <ArtSvgIcon icon="ri:delete-bin-7-line" class="text-base" />
                    </button>
                  </el-tooltip>
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
            @click="closeAdd"
          >
            <ArtSvgIcon icon="ri:close-line" class="text-base" />
          </button>
        </div>

        <!-- 步骤 1：输入房间号 -->
        <div v-if="!preview" class="mb-3">
          <label class="block text-sm text-g-700 mb-1.5">
            房间号 <span class="text-danger">*</span>
          </label>
          <el-input
            v-model="newRoomId"
            placeholder="请输入抖音房间号或抖音号"
            clearable
            @keyup.enter="doLookup"
          >
            <template #prefix>
              <ArtSvgIcon icon="ri:live-line" class="text-g-400" />
            </template>
          </el-input>
          <div class="mt-1.5 text-xs text-g-500">纯数字为房间号，含字母为抖音号</div>
        </div>

        <!-- 步骤 2：预览确认（避免加错房间） -->
        <div v-else class="mb-3">
          <div class="rounded-xl border border-t-d px-3.5 py-3">
            <div class="flex items-center gap-3">
              <div class="relative shrink-0 flex">
                <el-avatar :size="44" :src="preview.avatar">{{
                  (preview.nickname || preview.room_id)?.[0]
                }}</el-avatar>
              </div>
              <div class="flex-1 min-w-0">
                <div class="font-medium text-g-900 truncate">
                  {{ preview.nickname || '未获取到主播名' }}
                </div>
                <div class="flex items-center gap-1.5 mt-1">
                  <span class="size-1.5 rounded-full shrink-0" :class="previewDotClass" />
                  <span class="text-xs text-g-600">{{ previewStatusText }}</span>
                </div>
              </div>
            </div>
            <div class="mt-3 pt-3 border-t border-dashed border-t-d text-xs space-y-1.5">
              <div class="flex justify-between gap-3">
                <span class="text-g-500 shrink-0">房间号</span>
                <span class="text-g-900 font-mono truncate">{{ preview.room_id }}</span>
              </div>
              <div v-if="preview.room_title" class="flex justify-between gap-3">
                <span class="text-g-500 shrink-0">直播间标题</span>
                <span class="text-g-900 truncate">{{ preview.room_title }}</span>
              </div>
            </div>
          </div>
          <el-alert
            v-if="preview.already_monitored"
            type="warning"
            :closable="false"
            class="mt-2.5"
            title="该房间已在监控列表中，继续添加会提示重复"
          />
          <el-alert
            v-else-if="!preview.nickname && preview.room_status !== 'offline'"
            type="warning"
            :closable="false"
            class="mt-2.5"
            title="上游暂时无法确认该房间，请再确认房间号是否正确"
          />
          <div v-else-if="!preview.nickname" class="mt-2 text-xs text-g-500">
            该房间当前未开播，暂时拿不到主播资料；添加后开播会自动补全
          </div>
          <div class="mt-3">
            <label class="block text-sm text-g-700 mb-1.5">
              主播名 <span class="text-g-400">（选填）</span>
            </label>
            <el-input
              v-model="newRoomName"
              :placeholder="preview.nickname || '留空则自动获取'"
              clearable
            >
              <template #prefix>
                <ArtSvgIcon icon="ri:user-line" class="text-g-400" />
              </template>
            </el-input>
          </div>
        </div>

        <!-- 按钮 -->
        <div class="flex justify-end gap-2">
          <el-button @click="closeAdd">{{ preview ? '返回修改' : '取消' }}</el-button>
          <el-button
            v-if="!preview"
            type="primary"
            :loading="looking"
            :disabled="!newRoomId.trim()"
            @click="doLookup"
          >
            查询房间
          </el-button>
          <el-button v-else type="primary" :loading="adding" @click="add">确认添加</el-button>
        </div>
      </div>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
  import { computed, onActivated, onDeactivated, onMounted, onUnmounted, ref } from 'vue'
  import { useRoute, useRouter } from 'vue-router'
  import { ElMessage, ElMessageBox } from 'element-plus'
  import {
    fetchRooms,
    addRoom,
    pauseRoom,
    resumeRoom,
    removeRoom,
    lookupRoom,
    type Room,
    type LookupResult,
  } from '@/api/douyin'
  import { useUserStore } from '@/store/modules/user'
  import { fmtTime } from '@/utils/format'

  defineOptions({ name: 'DouyinRooms' })

  const userStore = useUserStore()
  const isAdmin = computed(() => userStore.info.roles?.includes('R_SUPER') ?? false)

  const router = useRouter()
  const route = useRoute()
  const rooms = ref<Room[]>([])
  const loading = ref(true)
  const search = ref('')
  const showAdd = ref(false)
  const newRoomId = ref('')
  const newRoomName = ref('')
  const adding = ref(false)
  // 「添加房间」改为两步：先查询预览确认，再真正添加
  const preview = ref<LookupResult | null>(null)
  const looking = ref(false)

  const connectedCount = computed(() => rooms.value.filter((r) => r.connected).length)
  const pausedCount = computed(() => rooms.value.filter((r) => !r.enabled).length)

  const previewStatusText = computed(() => {
    const p = preview.value
    if (!p) return ''
    if (p.is_live) return '直播中'
    if (p.room_status === 'offline') return '未开播'
    return '状态暂时无法确认'
  })

  const previewDotClass = computed(() => {
    const p = preview.value
    if (!p) return 'bg-g-400'
    if (p.is_live) return 'bg-success'
    if (p.room_status === 'offline') return 'bg-g-400'
    return 'bg-warning'
  })

  /**
   * 判断「已连接但抓取代理还没确认开播」的过渡态。
   *
   * 这段时间 WebSocket 是连上的（所以后端 connected=true、旧逻辑会显示"监控中"），
   * 但代理还没判定出直播状态，因此不会推弹幕、也不会开始录制 —— 实测重新确认
   * 开播要约 1 分钟。若显示"监控中"，用户会以为正在正常录制。
   *
   * 完全依据后端状态码判断（不依赖前端本地标记）：
   *   代理已给出明确结论（ONLINE/OFFLINE/ENDED）→ 不是过渡态
   *   否则（null 或 ROOM_STATUS_UNKNOWN）→ 连接中
   * 好处：刷新页面、换设备、从别的客户端恢复，判断都一样准确。
   */
  const CONCLUSIVE_STATUS = new Set(['ROOM_ONLINE', 'ROOM_OFFLINE', 'ROOM_ENDED'])

  function isConnecting(row: Room) {
    if (row.recording) return false // 已在录制，状态由"录制中"接管
    if (!row.enabled) return false // 已被暂停，状态由"已暂停"接管
    if (!row.connected) return false // 还没连上，交给后面的分支
    return !CONCLUSIVE_STATUS.has(String(row.statusCode || ''))
  }

  /** 主播名还在解析中（配置里已添加，但 streamers 表还没有记录） */
  function isNamePending(row: Room) {
    return Boolean(row.pending) || !row.name || row.name === row.room_id
  }

  function displayName(row: Room) {
    return isNamePending(row) ? '解析中...' : row.name
  }

  function avatarLetter(row: Room) {
    return isNamePending(row) ? '' : (row.name || row.room_id)?.[0] || ''
  }

  function escapeHtml(s: string) {
    return String(s ?? '').replace(/[&<>"']/g, (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string
    )
  }

  function statusText(row: Room) {
    if (row.recording) return '录制中'
    if (!row.enabled) return '已暂停' // 已暂停优先于任何连接状态
    if (isConnecting(row)) return '连接中'
    if (row.connected) return '监控中'
    return '连接中' // 已启用但尚未连接
  }

  function dotClass(row: Room) {
    if (row.recording) return 'bg-theme'
    if (!row.enabled) return 'bg-g-400'
    if (isConnecting(row)) return 'bg-warning'
    if (row.connected) return 'bg-success'
    return 'bg-warning'
  }

  function goSessions(row: Room) {
    router.push({ path: '/douyin/sessions', query: { hostId: row.room_id } })
  }

  /**
   * 拉取房间列表并**合并**进现有数据：
   * 复用已有对象的引用（配合 :key="row.room_id"），卡片不会被整体重建 —— 不闪烁、不重排。
   */
  async function refresh() {
    const isFirst = !rooms.value.length
    if (isFirst) loading.value = true
    try {
      const incoming = await fetchRooms()
      const prev = new Map(rooms.value.map((r) => [String(r.room_id), r]))
      const merged: Room[] = incoming.map((n) => {
        const old = prev.get(String(n.room_id))
        if (!old) return n
        Object.assign(old, n)
        return old
      })
      rooms.value = merged
    } finally {
      loading.value = false
    }
  }

  /**
   * 只在页面真正可见时轮询：
   * 切到别的页签、或浏览器标签页被隐藏时都不发请求（旧版就是这个策略，省资源）
   */
  function isPageActive() {
    return route.name === 'DouyinRooms' && document.visibilityState === 'visible'
  }

  function pollTick() {
    if (!isPageActive()) return
    refresh()
  }

  function doSearch() {
    router.push({ path: '/douyin/sessions', query: { hostId: search.value } })
  }

  function openAdd() {
    showAdd.value = true
    preview.value = null
    newRoomId.value = ''
    newRoomName.value = ''
  }

  function closeAdd() {
    showAdd.value = false
    preview.value = null
    newRoomId.value = ''
    newRoomName.value = ''
  }

  /** 第一步：查询房间信息让用户确认（无副作用，不写入任何东西） */
  async function doLookup() {
    const id = newRoomId.value.trim()
    if (!id) return
    looking.value = true
    try {
      preview.value = await lookupRoom(id)
    } catch (e) {
      // 查询失败不阻断流程：允许直接添加，主播名交给后端自己解析
      ElMessage.warning('查询房间信息失败，可直接确认添加')
      preview.value = {
        ok: true,
        room_id: id,
        nickname: '',
        avatar: '',
        room_title: '',
        is_live: false,
        room_status: 'unknown',
        has_room: false,
        already_monitored: false,
        name_source: 'none',
      }
    } finally {
      looking.value = false
    }
  }

  /** 第二步：确认后真正添加 */
  async function add() {
    const id = newRoomId.value.trim()
    if (!id) return
    adding.value = true
    try {
      await addRoom(id, newRoomName.value.trim())
      ElMessage.success('添加成功，正在等待代理确认开播…')
      closeAdd()
      await refresh()
    } finally {
      adding.value = false
    }
  }

  async function pause(row: Room) {
    const recording = row.recording
    const html = recording
      ? '该房间<b>正在录制</b>，暂停会立即结束当前场次，并停止记录弹幕 / 礼物 / 进场。'
        + '<br><br>恢复后需要等抓取代理重新确认开播（实测约 1 分钟），这段时间的数据不会记录。'
        + '<br><br>历史数据不会被删除。'
      : '暂停后将停止监控该房间。<br><br>历史数据会保留，随时可以恢复监控。'
    try {
      await ElMessageBox.confirm(html, recording ? '暂停正在录制的房间？' : '确认暂停监控', {
        confirmButtonText: '暂停监控',
        cancelButtonText: '取消',
        type: recording ? 'warning' : 'info',
        dangerouslyUseHTMLString: true,
      })
    } catch {
      return // 用户取消
    }
    try {
      const r = await pauseRoom(row.room_id)
      if (r && (r as { ok?: boolean }).ok === false) {
        ElMessage.error((r as { error?: string }).error || '暂停失败')
        return
      }
      ElMessage.success('已暂停')
      refresh()
    } catch (e: unknown) {
      ElMessage.error((e as Error)?.message || '暂停失败')
    }
  }

  async function resume(row: Room) {
    try {
      const r = await resumeRoom(row.room_id)
      if (r && (r as { ok?: boolean }).ok === false) {
        ElMessage.error((r as { error?: string }).error || '恢复失败')
        return
      }
      ElMessage.success('已恢复，正在等待代理确认开播…')
      refresh()
    } catch (e: unknown) {
      ElMessage.error((e as Error)?.message || '恢复失败')
    }
  }

  async function remove(row: Room) {
    try {
      await ElMessageBox.confirm(
        `确定删除 <b>${escapeHtml(displayName(row))}</b>？`
          + '<br><br><b>会同时删除该房间的全部历史数据</b>（场次、弹幕、礼物、进场记录），'
          + '<b>删除后无法恢复</b>。'
          + '<br><br>如果只想停止监控、保留历史数据，请改用「暂停」。',
        '删除房间及历史数据',
        {
          confirmButtonText: '删除房间和历史数据',
          cancelButtonText: '取消',
          type: 'warning',
          dangerouslyUseHTMLString: true,
        }
      )
    } catch {
      return // 用户取消
    }
    try {
      const r = await removeRoom(row.room_id)
      if (r && (r as { ok?: boolean }).ok === false) {
        ElMessage.error((r as { error?: string }).error || '删除失败')
        return
      }
      ElMessage.success('已删除')
      refresh()
    } catch (e: unknown) {
      ElMessage.error((e as Error)?.message || '删除失败')
    }
  }

  let timer: number | undefined
  let onVisibility: (() => void) | undefined

  function startPolling() {
    stopPolling()
    timer = window.setInterval(pollTick, 10000)
  }

  function stopPolling() {
    if (timer) {
      clearInterval(timer)
      timer = undefined
    }
  }

  onMounted(() => {
    refresh()
    startPolling()
    // 浏览器标签页切回来时立即补一次刷新
    onVisibility = () => {
      if (document.visibilityState === 'visible') refresh()
    }
    document.addEventListener('visibilitychange', onVisibility)
  })

  // keep-alive 场景：切回本页时刷新并恢复轮询，切走时停掉
  onActivated(() => {
    refresh()
    startPolling()
  })

  onDeactivated(() => stopPolling())

  onUnmounted(() => {
    stopPolling()
    if (onVisibility) document.removeEventListener('visibilitychange', onVisibility)
  })
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
