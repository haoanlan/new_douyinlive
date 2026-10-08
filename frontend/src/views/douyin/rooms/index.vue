<template>
  <div class="douyin-page p-4">
    <!-- 工具条 -->
    <div
      class="art-card dy-toolbar room-toolbar mb-5 flex items-center justify-between gap-4 flex-wrap"
    >
      <div class="flex items-center gap-3">
        <div class="size-9 rounded-lg flex-cc bg-theme/10 shrink-0">
          <ArtSvgIcon icon="ri:live-line" class="text-base text-theme" />
        </div>
        <div>
          <div class="dy-toolbar-title">房间管理</div>
          <div class="flex items-center gap-2.5 mt-1.5 text-xs text-g-500">
            <span class="flex items-baseline gap-1">
              <b class="dy-count text-g-900">{{ rooms.length }}</b
              > 个房间
            </span>
            <span class="w-px h-3 bg-g-300" />
            <span class="flex items-baseline gap-1">
              <b class="dy-count text-success">{{ connectedCount }}</b
              >监控中
            </span>
            <span class="w-px h-3 bg-g-300" />
            <span class="flex items-baseline gap-1">
              <b class="dy-count text-warning">{{ pausedCount }}</b
              >已暂停
            </span>
            <!-- 顶部统计跟随筛选，明确说明当前是"筛选后"的口径 -->
            <template v-if="search.trim()">
              <span class="w-px h-3 bg-g-300" />
              <span class="text-g-600">已筛选出 {{ filteredRooms.length }} 个</span>
            </template>
          </div>
        </div>
      </div>
      <div class="dy-toolbar-actions">
        <!-- P0-5：文案与行为一致 —— 这是本地过滤，不是跳转查询 -->
        <el-input
          v-model="search"
          placeholder="筛选房间号或主播名"
          style="width: 220px"
          clearable
          @keyup.esc="clearSearch"
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
      <!-- 轮询/加载失败：明确说明，且不再每 10 秒弹一次 toast（P0-3/P0-4） -->
      <el-alert
        v-if="queryError"
        type="error"
        :closable="false"
        show-icon
        class="mb-5"
        title="房间列表加载失败"
      >
        <div class="flex items-center gap-3 flex-wrap">
          <span class="text-xs break-all">{{ queryError }}</span>
          <span class="text-xs">下方列表可能不是最新的。</span>
          <el-button size="small" type="primary" plain @click="refresh">重试</el-button>
        </div>
      </el-alert>

      <ElRow :gutter="20">
        <ElCol v-for="(row, idx) in filteredRooms" :key="row.room_id" :sm="24" :md="12" :lg="8">
          <div
            class="art-card room-card relative px-5 py-4 mb-5 c-p group"
            role="button"
            tabindex="0"
            :aria-label="`查看 ${displayName(row)} 的场次`"
            :style="{ animationDelay: `${Math.min(idx, 7) * 40}ms` }"
            @click="goSessions(row)"
            @keydown.enter.prevent="goSessions(row)"
            @keydown.space.prevent="goSessions(row)"
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
                  class="text-base font-medium truncate leading-snug"
                  :class="isNamePending(row) ? 'text-g-400' : 'text-g-900'"
                  :title="isNamePending(row) ? '主播名解析中（开播或解析成功后会更新）' : displayName(row)"
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
                      class="dy-pressable size-8 rounded-lg flex-cc bg-g-100/70 text-g-500 hover:bg-theme/10 hover:text-theme"
                      :aria-label="row.enabled ? '暂停监控' : '恢复监控'"
                      @click="row.enabled ? pause(row) : resume(row)"
                    >
                      <ArtSvgIcon
                        :icon="row.enabled ? 'ri:pause-line' : 'ri:play-line'"
                        class="text-base"
                      />
                    </button>
                  </el-tooltip>
                  <el-tooltip content="移除房间" placement="top" :hide-after="0">
                    <button
                      class="dy-pressable size-8 rounded-lg flex-cc bg-g-100/70 text-g-500 hover:bg-danger/10 hover:text-danger"
                      aria-label="移除房间"
                      @click.stop="openRemove(row)"
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
              <!-- 卡片主数值：与统计卡/场次页统一为 20px（原来是 22px 这个游离档位） -->
              <div class="flex items-baseline gap-1">
                <span class="text-[20px] font-medium text-g-900 leading-none">{{
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
      <!-- 空态区分「一个房间都没有」与「筛选没匹配上」（P0-5 的诚实收尾） -->
      <div v-if="!filteredRooms.length && !loading && !queryError" class="art-card px-5 py-4 mb-5">
        <el-empty
          :description="
            search.trim()
              ? `没有匹配「${search.trim()}」的房间`
              : '暂无房间，点击右上角添加'
          "
        />
        <div v-if="search.trim()" class="text-center -mt-2">
          <el-button size="small" text type="primary" @click="clearSearch">清除筛选</el-button>
        </div>
      </div>
    </div>

    <!--
      移除房间：两个动作分开呈现。
      「删除历史数据」不可逆，所以单独成一个红色按钮并再确认一次；
      「取消」永远安全。
    -->
    <el-dialog
      v-model="removeVisible"
      title="移除房间"
      width="440px"
      align-center
      @closed="removeTarget = null"
    >
      <div class="text-sm text-g-800 leading-relaxed">
        要如何处理
        <b>{{ removeTarget ? displayName(removeTarget) : '' }}</b>
        <template v-if="removeTarget?.session_count">
          （已采集 <b>{{ removeTarget.session_count }}</b> 个场次）
        </template>
        ？
      </div>
      <div class="mt-3 rounded-xl bg-g-100/60 px-3.5 py-3 text-xs text-g-600 leading-relaxed">
        仅停止监控：<b>保留全部历史数据</b>，以后可以再添加回来继续采集。<br />
        删除历史数据：连同场次、弹幕、礼物、进场记录一起删除，<b>无法恢复</b>。
      </div>
      <template #footer>
        <div class="flex items-center justify-between gap-3 flex-wrap">
          <el-button text @click="closeRemove">取消</el-button>
          <div class="flex items-center gap-2">
            <el-button type="primary" @click="removeKeepData">仅停止监控</el-button>
            <el-button type="danger" plain @click="removeWithData">删除历史数据</el-button>
          </div>
        </div>
      </template>
    </el-dialog>

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
            class="dy-pressable size-7 rounded-lg flex-cc bg-g-100/70 text-g-500 hover:bg-g-100 hover:text-g-900"
            aria-label="关闭"
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
              :placeholder="
                preview.nickname ? `留空则用「${preview.nickname}」` : '留空则自动获取'
              "
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
  import { isHttpError } from '@/utils/http/error'
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
  /** 取数失败的真实原因；非空时显示错误态而不是空列表（P0-3/P0-4） */
  const queryError = ref('')
  const showAdd = ref(false)
  const newRoomId = ref('')
  const newRoomName = ref('')
  const adding = ref(false)
  // 「添加房间」改为两步：先查询预览确认，再真正添加
  const preview = ref<LookupResult | null>(null)
  const looking = ref(false)

  /**
   * 搜索过滤（P0-5）。
   *
   * 原来输入框写着「搜索房间号或主播名」，但 `search` ref 从未参与过滤，
   * 回车只是 router.push 跳到场次页，且 sessions 接口只按 room_id 查 ——
   * 输入主播名必然查不到任何东西，承诺与行为不符。
   * 现在按本地列表真实过滤：房间号、主播名、直播间标题都能匹配。
   */
  const filteredRooms = computed(() => {
    const kw = search.value.trim().toLowerCase()
    if (!kw) return rooms.value
    return rooms.value.filter((r) => {
      const hay = [r.room_id, r.name, r.roomTitle]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
      return hay.includes(kw)
    })
  })

  /** 统计口径跟随筛选结果，避免"顶部数字与列表对不上" */
  const connectedCount = computed(() => filteredRooms.value.filter((r) => r.connected).length)
  const pausedCount = computed(() => filteredRooms.value.filter((r) => !r.enabled).length)

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
   * 状态语义（与用户直觉一致）：
   *   录制中 —— 已经开播并在记录弹幕/礼物
   *   监控中 —— WebSocket 已连上，正在盯着这个房间（连上就算监控中）
   *   连接中 —— 已启用但还没连上
   *   已暂停 —— 用户主动暂停
   * 注意：代理确认开播需要时间（实测约 1 分钟），这段时间显示"监控中"是正确的 ——
   * 它确实在监控、也确实还没开始记录；录起来会自动变成"录制中"。
   */
  function statusText(row: Room) {
    if (row.recording) return '录制中'
    if (!row.enabled) return '已暂停'
    if (row.connected) return '监控中'
    return '连接中'
  }

  function dotClass(row: Room) {
    if (row.recording) return 'bg-theme'
    if (!row.enabled) return 'bg-g-400'
    if (row.connected) return 'bg-success'
    return 'bg-warning'
  }

  /**
   * 主播名是否还没解析出来（配置里已添加，但 streamers 表还没有记录）。
   *
   * 注意：离线房间拿不到主播资料时，这个名字可能长时间解析不出来，所以界面
   * 不能只显示"解析中..." —— 那样根本认不出是哪个房间。这里照常显示房间号，
   * 只用浅色斜体 + 悬浮提示表达"名字还没出来"，保证卡片始终可辨认。
   */
  function isNamePending(row: Room) {
    return Boolean(row.pending) || !row.name || row.name === row.room_id
  }

  function displayName(row: Room) {
    return row.name || row.room_id
  }

  function avatarLetter(row: Room) {
    return (row.name || row.room_id)?.[0] || ''
  }

  function escapeHtml(s: string) {
    return String(s ?? '').replace(/[&<>"']/g, (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string
    )
  }

  /**
   * 取出后端返回的真实失败原因。
   * 请求层按 HTTP 状态码只会给出「请求失败：HTTP 409」这类通用文案，而后端 body 里
   * 有真正的原因（如「房间 X 已在监控」「监控 worker 未运行」），对用户有用得多。
   * 房间管理的写操作已在 API 层关掉自动提示，统一由这里展示。
   */
  function apiErrorMessage(e: unknown, fallback: string) {
    // 模板自带的 @/utils/http 抛的是 HttpError，后端 body 在 .data 里
    if (isHttpError(e)) {
      const data = e.data as { error?: string; message?: string } | undefined
      return data?.error || data?.message || e.message || fallback
    }
    // 抖音接口走的是 api/douyin-http，抛的是 axios 原始错误
    // （该客户端的拦截器已把后端的 error 字段挂到 backendMessage）
    const ax = e as {
      backendMessage?: string
      response?: { data?: { error?: string; message?: string } }
      message?: string
    }
    return (
      ax?.backendMessage ||
      ax?.response?.data?.error ||
      ax?.response?.data?.message ||
      ax?.message ||
      fallback
    )
  }

  function goSessions(row: Room) {
    router.push({ path: '/douyin/sessions', query: { hostId: row.room_id } })
  }

  /**
   * 拉取房间列表并**合并**进现有数据：
   * 复用已有对象的引用（配合 :key="row.room_id"），卡片不会被整体重建 —— 不闪烁、不重排。
   *
   * 轮询失败时不再弹 toast（那是每 10 秒一次的刷屏），改为记录原因、
   * 由页面上的错误条统一展示（P0-3/P0-4）。
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
      queryError.value = ''
    } catch (e) {
      queryError.value = apiErrorMessage(e, '房间列表加载失败')
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

  /**
   * 搜索框现在是**本地过滤**（见 filteredRooms），不再跳转。
   * 保留 Esc / 清空即恢复全量。
   */
  function clearSearch() {
    search.value = ''
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
    // 主播名：用户填了就用用户填的；没填就用预览已经查到的那一个。
    // 头像直接用预览查到的 —— 这样添加后卡片立刻就有头像和名字。
    const name = newRoomName.value.trim() || preview.value?.nickname || ''
    const avatar = preview.value?.avatar || ''
    // 先关弹窗：用户已经点了「确认添加」，界面要立刻响应。
    // （之前失败时 addRoom 抛异常，closeAdd() 不会执行 → 弹窗卡住、又看不到原因）
    closeAdd()
    adding.value = true
    try {
      await addRoom(id, name, avatar)
      ElMessage.success('添加成功')
    } catch (e: unknown) {
      // 常见失败：房间已在监控中（409）、房间号格式不合法（400）、worker 未运行（503）
      ElMessage.error(apiErrorMessage(e, '添加失败'))
    } finally {
      adding.value = false
      // 无论成功失败都刷新：若该房间其实已在监控中，列表里能直接看到它
      await refresh()
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
      ElMessage.error(apiErrorMessage(e, '暂停失败'))
    }
  }

  async function resume(row: Room) {
    try {
      const r = await resumeRoom(row.room_id)
      if (r && (r as { ok?: boolean }).ok === false) {
        ElMessage.error((r as { error?: string }).error || '恢复失败')
        return
      }
      ElMessage.success('已恢复')
      refresh()
    } catch (e: unknown) {
      ElMessage.error(apiErrorMessage(e, '恢复失败'))
    }
  }

  /**
   * 移除房间。
   *
   * 原来只有一条路：确认后**必定连历史数据一起删**（api 层硬编码 delete_data: true）。
   * 删除不可逆，而"仅停止监控"随时可以再添加回来 —— 两者风险差很远，
   * 不该被合并成一个按钮。所以本页弹窗提供两个明确的动作：
   *   1) 仅停止监控（保留历史数据）
   *   2) 删除房间和历史数据（红的、需要再确认一次）
   * 「取消」永远是安全的：什么都不做。
   */
  const removeVisible = ref(false)
  const removeTarget = ref<Room | null>(null)

  function openRemove(row: Room) {
    removeTarget.value = row
    removeVisible.value = true
  }

  function closeRemove() {
    removeVisible.value = false
    removeTarget.value = null
  }

  /** 仅停止监控：保留全部历史数据 */
  async function removeKeepData() {
    const row = removeTarget.value
    if (!row) return
    closeRemove()
    await doRemove(row, false)
  }

  /** 危险路径：删除房间并连同全部历史数据，必须再确认一次 */
  async function removeWithData() {
    const row = removeTarget.value
    if (!row) return
    const name = escapeHtml(displayName(row))
    const sessions = row.session_count ?? 0
    try {
      await ElMessageBox.confirm(
        `确定要删除 <b>${name}</b> 及其<b>全部历史数据</b>吗？`
          + (sessions ? `<br><br>这包含 <b>${sessions} 个场次</b>的弹幕、礼物与进场记录。` : '')
          + '<br><br><b>删除后无法恢复。</b>',
        '删除房间及历史数据',
        {
          confirmButtonText: '删除房间和历史数据',
          cancelButtonText: '取消',
          type: 'warning',
          dangerouslyUseHTMLString: true
        }
      )
    } catch {
      return // 取消：留在原弹窗，什么都不做
    }
    closeRemove()
    await doRemove(row, true)
  }

  async function doRemove(row: Room, deleteData: boolean) {
    try {
      const r = await removeRoom(row.room_id, deleteData)
      if (r && (r as { ok?: boolean }).ok === false) {
        ElMessage.error((r as { error?: string }).error || '移除失败')
        return
      }
      ElMessage.success(deleteData ? '已删除房间及历史数据' : '已停止监控（历史数据已保留）')
      refresh()
    } catch (e: unknown) {
      ElMessage.error(apiErrorMessage(e, '移除失败'))
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

  // keep-alive 场景：切回本页时刷新并恢复轮询，切走时停掉。
  // 首次挂载时 mounted 与 activated 都会触发，所以用 activatedOnce 跳过重复刷新
  // —— 否则首屏 /api/rooms 会连发两次（UI-AUDIT P2-29）
  let activatedOnce = false
  onActivated(() => {
    if (!activatedOnce) {
      activatedOnce = true
      return
    }
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
  /*
   * 房间卡片：整张卡可点，进房间场次。
   *
   * 原来写的是 `transition-all duration-300 hover:shadow-lg hover:-translate-y-0.5`：
   *   - transition-all 会连带过渡一堆属性（含触发布局的），鼠标划过就掉帧
   *   - 300ms 偏慢，且用内置 ease，悬停会"飘"一下才到位
   * 现在只过渡阴影/位移/描边（都是合成器友好的），并用统一的动效 token。
   */
  .room-card {
    transition:
      box-shadow var(--dy-dur-base) var(--dy-ease-out),
      transform var(--dy-dur-base) var(--dy-ease-out),
      border-color var(--dy-dur-fast) ease;
  }

  /*
   * 卡片进场：一次淡入 + 轻微上移，逐张错开 40ms。
   * 6 张卡同时"啪"地出现会显得机械；错开一点点就有层次感。
   * 只做 opacity/transform（GPU），并且只跑一次，不阻塞交互。
   *
   * 注意：延迟用**行内 style 按索引**设置（见模板 :style），不要用 :nth-child ——
   * 每张卡都是各自 ElCol 里的唯一子元素，nth-child 永远命中第 1 个，
   * 结果是所有卡片延迟都是 0ms（这个坑已经踩过一次）。
   */
  /*
   * 注意：这里**不能**再叫 `dy-card-in` —— 全局 douyin-motion.scss 里已有同名 keyframes，
   * 本地重定义会覆盖它，而两处值不同（本地 6px/both，全局 8px/backwards），
   * 改一处忘另一处就漂移。改名独立 + 值与全局对齐。
   */
  .room-card {
    animation: dy-room-card-in var(--dy-dur-slow) var(--dy-ease-out) backwards;
  }

  @keyframes dy-room-card-in {
    from {
      opacity: 0;
    }
  }

  /* 悬停/按下只在真指针设备上启用：触屏点按会误触发 hover，
     表现成"点一下卡片先浮起来再跳走"。 */
  @media (hover: hover) and (pointer: fine) {
    .room-card:hover {
      transform: translateY(-2px);
      box-shadow: 0 10px 24px -10px rgb(0 0 0 / 16%);
      border-color: color-mix(in srgb, var(--theme-color) 28%, transparent);
    }
  }

  .room-card:active {
    transform: scale(0.995);
  }

  .room-card:focus-visible {
    outline: none;
    /* !important 不能省：模板在 border-mode 下给 .art-card 写死了
       box-shadow: none !important，不加会被整个压掉（实测焦点环为 none）。 */
    box-shadow:
      0 0 0 2px #fff,
      0 0 0 4px var(--theme-color) !important;
  }

  @media (prefers-reduced-motion: reduce) {
    .room-card {
      animation: none;
    }

    .room-card:hover,
    .room-card:active {
      transform: none;
    }
  }

  /* 工具条控件圆角与卡片统一（卡片 16px，控件默认仅 6px） */
  :deep(.room-toolbar .el-input__wrapper) {
    border-radius: 10px;
    background: var(--art-gray-100);
    box-shadow: none;
    transition: box-shadow var(--dy-dur-fast) ease;
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
