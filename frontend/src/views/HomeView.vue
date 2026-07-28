<template>
  <div id="content" :class="{ 'content-fade-in': contentFadeIn }">
    <!-- Loading state -->
    <div v-if="contentLoading" class="loading">加载中...</div>
    <!-- Rooms view -->
    <template v-else-if="topNavTab === 'rooms'">
      <!-- Status Bar -->
      <div class="status-bar">
        <div class="status-chip status-live" id="statusLive">
          <span class="dot"></span>
          <span id="statusLiveCount">{{ connectedCount }}</span> 监控中
        </div>
        <div class="status-chip status-off" id="statusPaused">
          <span class="dot"></span>
          <span id="statusPausedCount">{{ pausedCount }}</span> 已暂停
        </div>
      </div>
      <!-- Stats Row -->
      <div class="stats-row">
        <div class="stat-card" data-stat="rooms"><div class="stat-label">直播间</div><div class="stat-value">{{ rooms.length }}</div></div>
        <div class="stat-card" data-stat="sessions"><div class="stat-label">总场次</div><div class="stat-value">{{ summary.total_sessions }}</div></div>
        <div class="stat-card" data-stat="gifts"><div class="stat-label">总礼物</div><div class="stat-value">{{ summary.total_gifts.toLocaleString() }}</div></div>
        <div class="stat-card" data-stat="diamonds"><div class="stat-label">总钻石</div><div class="stat-value">{{ summary.total_diamonds.toLocaleString() }}</div></div>
        <div class="stat-card" data-stat="danmaku"><div class="stat-label">总弹幕</div><div class="stat-value">{{ summary.total_danmaku.toLocaleString() }}</div></div>
        <div class="stat-card" data-stat="users"><div class="stat-label">独立用户</div><div class="stat-value">{{ summary.unique_users.toLocaleString() }}</div></div>
      </div>
      <!-- Room Management Section -->
      <div class="section">
        <div class="section-header">
          <div class="section-title">房间管理</div>
          <button class="btn btn-ghost btn-sm" @click="showAddRoomFn" style="border-color:var(--border-light)">+ 添加房间</button>
        </div>
        <TransitionGroup name="list" tag="div" class="host-grid" id="roomGrid">
          <div v-for="r in rooms" :key="r.room_id" class="room-card" @click="viewSessions(r.room_id)">
            <div class="room-card-top">
              <div class="host-avatar">
                <img v-if="r.avatar" :src="r.avatar" alt="" @error="(e: any) => e.target.style.display='none'">
                <div v-else style="width:100%;height:100%;display:flex;align-items:center;justify-content:center;color:var(--text-muted)">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="20" height="20"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
                </div>
                <div v-if="r.recording" class="live-dot"></div>
              </div>
              <div class="host-info">
                <div class="host-name" v-if="r.name">{{ r.name }}</div>
                <div class="host-name" v-else style="color:var(--text-muted);font-style:italic">解析中...</div>
                <div class="host-meta">
                  <span class="host-badge" :class="roomBadgeClass(r)">{{ roomBadgeText(r) }}</span>
                  <span>{{ r.session_count }} 场</span>
                </div>
              </div>
              <div class="room-card-actions">
                <button v-if="r.enabled" class="action-btn" @click.stop="pauseRoomFn(r.room_id)" title="暂停">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16" rx="1"/><rect x="14" y="4" width="4" height="16" rx="1"/></svg>
                </button>
                <button v-else class="action-btn action-btn-resume" @click.stop="resumeRoomFn(r.room_id)" title="恢复">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>
                </button>
                <button class="action-btn action-btn-del" @click.stop="confirmDeleteRoom(r.room_id, r.name)" title="删除">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                </button>
              </div>
            </div>
            <div class="room-card-footer">{{ r.room_id }}</div>
          </div>
        </TransitionGroup>
      </div>
      <div v-if="showAddRoomModal" class="modal-overlay" @click.self="closeAddRoom">
        <div class="modal">
          <div class="modal-header">
            <div class="modal-title">添加房间</div>
            <button class="modal-close" @click="closeAddRoom">✕</button>
          </div>
          <div class="modal-body">
            <div class="modal-field">
              <label>房间号 / 抖音号</label>
              <div style="display:flex;gap:8px">
                <input ref="addRoomInputEl" v-model="addRoomInput" placeholder="输入房间号或抖音号" @keydown.enter="lookupRoomFn">
                <button class="btn btn-ghost btn-sm" @click="lookupRoomFn" :disabled="lookupLoading" id="lookupBtn" style="border-color:var(--border-light)">{{ lookupLoading ? '查询中...' : '查询' }}</button>
              </div>
              <div class="modal-hint">纯数字为房间号，含字母为抖音号</div>
            </div>
            <div v-if="lookupData" id="addRoomResult">
              <div class="modal-field">
                <label>主播名称</label>
                <input v-model="addRoomName" placeholder="主播名称" style="width:100%">
              </div>
              <div class="modal-preview" id="addRoomPreview">
                <img v-if="lookupData.avatar" :src="lookupData.avatar" style="width:40px;height:40px;border-radius:50%;object-fit:cover">
                <div>
                  <div style="font-weight:500;font-size:13px" v-if="lookupData.nickname">{{ lookupData.nickname }}</div>
                  <div style="font-weight:500;font-size:13px;color:var(--text-muted);font-style:italic" v-else>待解析</div>
                  <div style="font-size:11px;color:var(--text-muted)">房间号: {{ lookupData.room_id || '未开播' }}<template v-if="lookupData.is_live"> · <span style="color:var(--green)">直播中</span></template></div>
                </div>
              </div>
            </div>
          </div>
          <div class="modal-footer">
            <button class="btn btn-ghost btn-sm" @click="closeAddRoom">取消</button>
            <button class="btn btn-ghost btn-sm" id="addRoomConfirmBtn" @click="confirmAddRoom" :disabled="!lookupData || !lookupData.room_id || addRoomSubmitting" style="border-color:var(--border-light)">{{ addRoomSubmitting ? '添加中...' : '确认添加' }}</button>
          </div>
        </div>
      </div>
    </template>
    <!-- Search view -->
    <template v-else-if="topNavTab === 'search'">
      <div class="section">
        <div class="section-header">
          <div class="section-title">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
            匿名查询
          </div>
        </div>
        <div style="font-size:12px;color:var(--text-muted);margin-bottom:12px">输入用户昵称，可选直播间/场次缩小范围，匹配 sec_uid 后查询真实信息</div>
        <div class="anon-filter">
          <div class="cs-wrap" id="anonStreamerWrap">
            <button class="cs-btn" id="anonStreamerBtn" @click="toggleCs('anonStreamer')">{{ csLabels.anonStreamer || '全部直播间' }}</button>
            <div class="cs-list" :class="{ open: csOpen === 'anonStreamer' }" id="anonStreamerList">
              <div class="cs-opt" :class="{ selected: !csState.anonStreamer }" data-val="" @click="selectCs('anonStreamer', '', '全部直播间')">全部直播间</div>
              <div v-for="s in streamers" :key="s.id" class="cs-opt" :class="{ selected: csState.anonStreamer === s.id }" :data-val="s.id" @click="selectCs('anonStreamer', s.id, s.name || s.room_id)">{{ s.name || s.room_id }}</div>
            </div>
          </div>
          <div class="cs-wrap" id="anonSessionWrap">
            <button class="cs-btn" :class="{ disabled: !csState.anonStreamer }" id="anonSessionBtn" @click="toggleCs('anonSession')">{{ csLabels.anonSession || '全部场次' }}</button>
            <div class="cs-list" :class="{ open: csOpen === 'anonSession' }" id="anonSessionList">
              <div class="cs-opt" :class="{ selected: !csState.anonSession }" data-val="" @click="selectCs('anonSession', '', '全部场次')">全部场次</div>
              <div v-for="s in anonSessions" :key="s.id" class="cs-opt" :class="{ selected: csState.anonSession === String(s.id) }" :data-val="s.id" @click="selectCs('anonSession', String(s.id), (s.started_at ? fmtTime(s.started_at) : '') + ' ' + (s.title || ''))">{{ fmtTime(s.started_at) }} {{ s.title }}</div>
            </div>
          </div>
        </div>
        <div style="display:flex;gap:8px;margin-bottom:16px">
          <input v-model="searchInput" placeholder="输入昵称关键词..." style="flex:1;padding:8px 12px;background:var(--bg-card);border:1px solid var(--border);border-radius:var(--radius);color:var(--text);font-size:13px;outline:none" @keydown.enter="doAnonymousLookup">
          <button class="btn btn-ghost btn-sm" @click="doAnonymousLookup" style="border-color:var(--border-light)">查询</button>
        </div>
        <div id="searchResults">
          <div v-if="searchLoading" class="loading" style="min-height:auto;padding:30px">查询中...</div>
          <div v-else-if="searchResults.length > 0">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">
              <span style="font-size:12px;color:var(--text-muted)">找到 <strong style="color:var(--text)">{{ searchResults.length }}</strong> 个匹配用户</span>
              <span style="font-size:11px;color:var(--text-muted)">点击查看详情</span>
            </div>
            <div style="display:flex;flex-direction:column;gap:6px">
              <div v-for="(u, idx) in searchResults" :key="idx" class="lookup-card" @click="showAnonymousDetail(idx)">
                <div class="lookup-left">
                  <div class="avatar" v-html="avatarHtml(u.db_avatar || u.api_avatar || u.avatar, getDbName(u))"></div>
                  <div class="user-info">
                    <div class="user-name">{{ getDbName(u) }}</div>
                    <div v-if="u.api_nickname && u.api_nickname !== getDbName(u)" class="user-db-name">{{ u.api_nickname }}</div>
                    <div v-else-if="u.db_nicknames && u.db_nicknames.length > 1" class="user-db-name">{{ u.db_nicknames.length }}个昵称</div>
                  </div>
                </div>
                <div class="lookup-right">
                  <span v-if="u.sessions && u.sessions.length" class="sess">{{ u.sessions[0].streamer_name }}</span>
                  <span v-if="u.latest_action" class="act">{{ actionLabel(u.latest_action.type) }}</span>
                </div>
              </div>
            </div>
          </div>
          <div v-else-if="searchSearched && searchResults.length === 0" class="empty" style="padding:30px">
            <div class="empty-icon">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="28" height="28"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
            </div>
            未找到匹配用户
          </div>
        </div>
      </div>
    </template>
    <!-- Profile view -->
    <template v-else-if="topNavTab === 'profile'">
      <div class="section">
        <div class="section-header">
          <div class="section-title">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
            用户画像
          </div>
        </div>
        <div style="display:flex;gap:8px;margin-bottom:16px">
          <input v-model="profileInput" placeholder="输入用户昵称搜索..." style="flex:1;padding:8px 12px;background:var(--bg-card);border:1px solid var(--border);border-radius:var(--radius);color:var(--text);font-size:13px;outline:none" @keydown.enter="searchProfileUser">
          <button class="btn btn-ghost btn-sm" @click="searchProfileUser" style="border-color:var(--border-light)">查询</button>
        </div>
        <div id="profileUserList">
          <div v-if="profileLoading" class="loading" style="min-height:auto;padding:30px">搜索中...</div>
          <div v-else-if="profileUsers.length > 0">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
              <span style="font-size:12px;color:var(--text-muted)">找到 <strong style="color:var(--text)">{{ profileUsers.length }}</strong> 个用户</span>
            </div>
            <div style="display:flex;flex-direction:column;gap:6px">
              <div v-for="u in profileUsers" :key="u.user_sec_uid" class="lookup-card" @click="showUserProfile(u.user_sec_uid)">
                <div class="user-cell">
                  <div class="avatar" v-html="avatarHtml(u.avatar, u.nickname)"></div>
                  <span>{{ u.nickname }}</span>
                </div>
                <div style="font-size:11px;color:var(--accent);flex-shrink:0">查看画像 →</div>
              </div>
            </div>
          </div>
          <div v-else-if="profileSearched && profileUsers.length === 0" class="empty" style="padding:20px">未找到用户</div>
        </div>
      </div>
    </template>
  </div>

  <!-- ANONYMOUS DETAIL MODAL -->
  <div id="anonDetailModal" class="anchor-modal-overlay" :class="{ show: anonDetailModalVisible }" @click.self="closeAnonDetailModal">
    <div class="anchor-modal">
      <div class="anchor-modal-header">
        <h3 id="anonDetailTitle">{{ anonDetailTitle }}</h3>
        <button class="anchor-modal-close" @click="closeAnonDetailModal">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
      </div>
      <div class="anchor-modal-body" id="anonDetailBody" v-html="anonDetailBody"></div>
    </div>
  </div>

  <!-- USER PROFILE MODAL -->
  <div id="profileModal" class="anchor-modal-overlay" :class="{ show: profileModalVisible }" @click.self="closeProfileModal">
    <div class="anchor-modal">
      <div class="anchor-modal-header">
        <h3 id="profileModalTitle">{{ profileModalTitle }}</h3>
        <button class="anchor-modal-close" @click="closeProfileModal">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
      </div>
      <div class="anchor-modal-body" id="profileModalBody" v-html="profileModalBody"></div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, nextTick, watch } from 'vue'
import { useRouter } from 'vue-router'
import { storeToRefs } from 'pinia'
import { useAppStore } from '../stores/app'
import { lookupRoom, addRoom, pauseRoom, resumeRoom, removeRoom, fetchRooms, fetchUser } from '../api'
import { esc, fmtTime, fmtSessionTime, avatarHtml, avatarHtml52, giftEmoji } from '../utils/format'
import { replaceDouyinEmoji } from '../utils/douyin-emoji'
import { useToast } from '../composables/useToast'
import { useConfirm } from '../composables/useConfirm'
import { useSearch } from '../composables/useSearch'
import { useProfile } from '../composables/useProfile'

// ============================================================
// TYPES
// ============================================================
interface Room {
  room_id: string; name: string; avatar: string; enabled: boolean
  connected: boolean; recording: boolean; session_count: number; _connecting?: boolean
}
interface LookupData { room_id: string; nickname: string; avatar: string; is_live: boolean }
interface AnonUser {
  sec_uid: string; db_nicknames: string[]; api_nickname: string
  db_avatar: string; api_avatar: string; avatar: string; nickname: string
  sessions: { streamer_name: string }[]; latest_action: { type: string } | null
}

// ============================================================
// STATE (from Pinia store)
// ============================================================
const store = useAppStore()
const router = useRouter()
const {
  contentLoading, contentFadeIn, topNavTab, viewLevel,
  rooms, connectedCount, pausedCount,
} = storeToRefs(store)
const summary = store.summary  // reactive object
const { toast } = useToast()
const { showConfirm } = useConfirm()

const API = ''

async function api(path: string) {
  const r = await fetch(API + path)
  if (!r.ok) throw new Error(`${r.status} ${r.statusText}`)
  return r.json()
}

// ============================================================
// NAVIGATION (to child routes)
// ============================================================
function viewSessions(hostId: string) {
  router.push({ name: 'sessions', params: { hostId } })
}

// ============================================================
// ROOMS VIEW
// ============================================================
function roomBadgeClass(r: Room) {
  if (r.connected) return 'badge-live'
  if (r._connecting) return 'badge-connecting'
  return r.enabled ? 'badge-idle' : 'badge-paused'
}

function roomBadgeText(r: Room) {
  if (r.connected) return '监控中'
  if (r._connecting) return '连接中'
  return r.enabled ? '已启用' : '已暂停'
}

let _viewGen = 0

async function loadRoomsView(gen?: number) {
  contentLoading.value = rooms.value.length === 0
  contentFadeIn.value = false
  try {
    const [s, r] = await Promise.all([api('/api/summary'), api('/api/rooms')])
    if (gen !== undefined && gen !== _viewGen) return
    rooms.value = r
    Object.assign(summary, s)
    contentLoading.value = false
    contentFadeIn.value = true
  } catch (e: any) {
    if (gen !== undefined && gen !== _viewGen) return
    contentLoading.value = false
    contentFadeIn.value = true
    toast('加载失败: ' + e.message, 'error')
  }
  if (gen === undefined || gen === _viewGen) startRoomStatusPoll()
}

function sortRooms() {
  rooms.value.sort((a, b) => {
    if (a.enabled !== b.enabled) return a.enabled ? -1 : 1
    if (a.connected !== b.connected) return a.connected ? -1 : 1
    return a.name.localeCompare(b.name) || a.room_id.localeCompare(b.room_id)
  })
}

let _roomStatusPollTimer: ReturnType<typeof setInterval> | null = null

async function pollRoomStatus() {
  if (topNavTab.value !== 'rooms') return
  try {
    const r = await fetchRooms()
    for (const newRoom of r) {
      const old = rooms.value.find(x => x.room_id === newRoom.room_id)
      if (old) {
        old.connected = newRoom.connected
        old.enabled = newRoom.enabled
        old.recording = newRoom.recording
        old._connecting = false
        old.session_count = newRoom.session_count
      }
    }
    sortRooms()
  } catch {}
}

function startRoomStatusPoll() {
  stopRoomStatusPoll()
  _roomStatusPollTimer = setInterval(pollRoomStatus, 15000)
}

function stopRoomStatusPoll() {
  if (_roomStatusPollTimer) { clearInterval(_roomStatusPollTimer); _roomStatusPollTimer = null }
}

// ============================================================
// ADD ROOM
// ============================================================
const showAddRoomModal = ref(false)
const addRoomInput = ref('')
const addRoomInputEl = ref<HTMLInputElement | null>(null)
const lookupData = ref<LookupData | null>(null)
const addRoomName = ref('')
const lookupLoading = ref(false)
const addRoomSubmitting = ref(false)

function showAddRoomFn() {
  lookupData.value = null
  addRoomInput.value = ''
  addRoomName.value = ''
  showAddRoomModal.value = true
  nextTick(() => { if (addRoomInputEl.value) addRoomInputEl.value.focus() })
}

function closeAddRoom() {
  showAddRoomModal.value = false
  lookupData.value = null
}

async function lookupRoomFn() {
  if (!addRoomInput.value.trim()) return
  lookupLoading.value = true
  try {
    const r = await lookupRoom(addRoomInput.value.trim())
    if (r.error) { toast(r.error, 'error'); lookupLoading.value = false; return }
    lookupData.value = r
    addRoomName.value = r.nickname || ''
  } catch (e: any) { toast('查询失败: ' + e.message, 'error') }
  lookupLoading.value = false
}

async function confirmAddRoom() {
  if (!lookupData.value || !lookupData.value.room_id) { toast('请先查询房间信息', 'error'); return }
  const name = addRoomName.value.trim() || lookupData.value.nickname
  const room_id = lookupData.value.room_id
  const avatar = lookupData.value.avatar
  addRoomSubmitting.value = true
  try {
    const r = await addRoom(room_id, name)
    toast(r.ok ? `已添加 ${name || room_id}` : (r.error || '添加失败'), r.ok ? 'success' : 'error')
    closeAddRoom()
    if (r.ok) {
      const newRoom: Room = { room_id, name: name || '', avatar, enabled: true, connected: false, recording: false, session_count: 0 }
      rooms.value.push(newRoom)
      sortRooms()
      setTimeout(pollRoomStatus, 500)
    }
  } catch (e: any) { toast('网络错误: ' + e.message, 'error') }
  finally { addRoomSubmitting.value = false }
}

async function pauseRoomFn(roomId: string) {
  if (!await showConfirm('<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16" rx="1"/><rect x="14" y="4" width="4" height="16" rx="1"/></svg>', '确定暂停这个房间的监控？')) return
  try {
    const r = await pauseRoom(roomId)
    toast(r.ok ? '已暂停' : (r.error || '操作失败'), r.ok ? 'success' : 'error')
    if (r.ok) {
      const room = rooms.value.find(r => r.room_id === roomId)
      if (room) { room.enabled = false; room.connected = false }
      sortRooms()
    }
  } catch (e: any) { toast('网络错误: ' + e.message, 'error') }
}

async function resumeRoomFn(roomId: string) {
  try {
    const r = await resumeRoom(roomId)
    toast(r.ok ? '已恢复' : (r.error || '操作失败'), r.ok ? 'success' : 'error')
    if (r.ok) {
      const room = rooms.value.find(r => r.room_id === roomId)
      if (room) { room.enabled = true; room.connected = false; room._connecting = true }
      setTimeout(pollRoomStatus, 500)
    }
  } catch (e: any) { toast('网络错误: ' + e.message, 'error') }
}

async function confirmDeleteRoom(roomId: string, name: string) {
  const confirmed = await showConfirm('🗑️', `确定删除 <strong>${esc(name || roomId)}</strong>？<br><br>将停止监控并清除所有历史数据<br>（弹幕、礼物、场次记录）<br><br>此操作不可恢复！`)
  if (!confirmed) return
  try {
    const r = await removeRoom(roomId, true)
    toast(r.ok ? '已删除' : (r.error || '删除失败'), r.ok ? 'success' : 'error')
    if (r.ok) { rooms.value = rooms.value.filter(r => r.room_id !== roomId) }
  } catch (e: any) { toast('网络错误: ' + e.message, 'error') }
}

// ============================================================
// SEARCH VIEW (from composable)
// ============================================================
const {
  streamers, csState, csLabels, csOpen, anonSessions,
  searchInput, searchResults, searchLoading, searchSearched,
  loadSearchView, toggleCs, selectCs, doAnonymousLookup,
  getDbName, actionLabel
} = useSearch(api, toast)

// ============================================================
// PROFILE VIEW (from composable)
// ============================================================
const {
  profileInput, profileUsers, profileLoading, profileSearched,
  loadProfileView, searchProfileUser
} = useProfile(api, toast)

// ============================================================
// ANON DETAIL MODAL
// ============================================================
const anonDetailModalVisible = ref(false)
const anonDetailTitle = ref('用户详情')
const anonDetailBody = ref('')
const _anonResults = ref<AnonUser[]>([])

function closeAnonDetailModal() { anonDetailModalVisible.value = false }

async function showAnonymousDetail(idx: number) {
  const u = _anonResults.value[idx] || searchResults.value[idx]
  if (!u) return
  anonDetailModalVisible.value = true
  anonDetailTitle.value = u.db_nicknames?.[0] || u.nickname || '用户详情'
  let html = ''
  html += `<div style="display:flex;align-items:center;gap:14px;padding:16px 0;border-bottom:1px solid var(--border);margin-bottom:14px">`
  html += avatarHtml52(u.api_avatar || u.avatar, u.nickname)
  html += `<div style="flex:1;min-width:0">`
  html += `<div style="font-size:16px;font-weight:600;color:var(--text)">${esc(u.nickname || '未知')}</div>`
  if (u.db_nicknames?.length > 1) html += `<div style="font-size:12px;color:var(--text-muted);margin-top:3px">库中昵称: ${u.db_nicknames.map((n: string) => esc(n)).join('、')}</div>`
  html += `</div></div>`
  if (u.latest_danmaku || u.latest_gift) {
    const giftSvg = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14" style="vertical-align:middle"><rect x="3" y="8" width="18" height="13" rx="1"/><path d="M12 8V6c0-2-1.5-4-4-4S4 4 4 6h2"/><path d="M20 6c0-2-1.5-4-4-4s-4 2-4 4h2"/><line x1="12" y1="8" x2="12" y2="21"/><line x1="3" y1="13" x2="21" y2="13"/></svg>'
    const danmakuSvg = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14" style="vertical-align:middle"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>'
    const actions: any[] = []
    if (u.latest_danmaku) actions.push({ type: 'danmaku', svg: danmakuSvg, color: 'var(--accent)', bg: 'rgba(108,140,255,0.15)', label: '弹幕', ...u.latest_danmaku })
    if (u.latest_gift) actions.push({ type: 'gift', svg: giftSvg, color: 'var(--orange)', bg: 'rgba(251,146,60,0.15)', label: '送礼', ...u.latest_gift })
    actions.sort((a: any, b: any) => (b.time || 0) - (a.time || 0))
    html += `<div style="background:var(--bg);border:1px solid var(--border);border-radius:var(--radius);padding:12px 14px;margin-bottom:14px"><div style="font-size:12px;font-weight:500;color:var(--text-secondary);margin-bottom:8px">最近动作</div>`
    for (const a of actions) {
      let detail = a.detail || (a.type === 'danmaku' ? '发了弹幕' : '送了礼物')
      if (detail.length > 40) detail = detail.slice(0, 40) + '…'
      html += `<div style="display:flex;align-items:flex-start;gap:8px;margin-bottom:6px"><div style="margin-top:2px;color:${a.color}">${a.svg}</div><div style="flex:1;min-width:0"><div style="font-size:13px;color:var(--text);line-height:1.4">${replaceDouyinEmoji(esc(detail))}</div><div style="font-size:11px;color:var(--text-muted);margin-top:4px">${a.streamer_name ? esc(a.streamer_name) : ''} ${a.time ? '· ' + fmtTime(a.time) : ''}</div></div><div style="font-size:11px;color:${a.color};flex-shrink:0;padding:2px 8px;background:${a.bg};border-radius:var(--radius-xs)">${a.label}</div></div>`
    }
    html += `</div>`
  }
  const sessionsList = u.sessions || []
  if (sessionsList.length) {
    html += `<div style="font-size:12px;font-weight:500;color:var(--text-secondary);margin-bottom:8px">活跃场次 (${sessionsList.length})</div><div style="display:flex;flex-direction:column;gap:4px">`
    sessionsList.slice(0, 5).forEach((s: any) => {
      const d = s.diamonds || 0
      html += `<div style="display:flex;align-items:center;gap:8px;padding:8px 12px;background:var(--bg-card);border:1px solid var(--border);border-radius:var(--radius-sm)"><span style="font-size:12px;color:var(--text-muted);width:72px;flex-shrink:0;font-variant-numeric:tabular-nums">${fmtSessionTime(s.start_time)}</span><span style="font-size:12px;color:var(--text);flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(s.streamer_name || '未知')}</span><span style="font-size:12px;color:${d > 0 ? 'var(--orange)' : 'var(--text-muted)'};flex-shrink:0;font-weight:600;font-variant-numeric:tabular-nums;display:inline-flex;align-items:center"><svg viewBox="0 0 24 24" width="12" height="12" style="margin-left:2px;fill:currentColor"><path d="M6 2h12l4 7-10 13L2 9z"/><path d="M2 9h20" stroke="rgba(255,255,255,0.2)" stroke-width="0.7" fill="none"/><path d="M12 22l-4-13h8z" fill="rgba(0,0,0,0.1)"/></svg>${d.toLocaleString()}</span></div>`
    })
    if (sessionsList.length > 5) html += `<div style="text-align:center;font-size:11px;color:var(--text-muted);padding:4px">还有 ${sessionsList.length - 5} 场</div>`
    html += `</div>`
  }
  anonDetailBody.value = html
  fetchUser(u.sec_uid).then(p => {
    if (!p) return
    let extra = ''
    if (p.signature) extra += `<div style="font-size:12px;color:var(--text-muted);margin-top:4px;font-style:italic">${esc(p.signature)}</div>`
    if (p.user_age || p.user_gender) extra += `<div style="font-size:11px;color:var(--text-muted);margin-top:3px">${p.user_gender ? (p.user_gender === 1 ? '♂ 男' : p.user_gender === 2 ? '♀ 女' : '') : ''}${p.user_age ? ' · ' + p.user_age + '岁' : ''}</div>`
    if (p.unique_id) extra += `<div style="font-size:11px;color:var(--text-muted);margin-top:2px">抖音号: ${esc(p.unique_id)}</div>`
    if (extra) {
      const body = document.getElementById('anonDetailBody')
      if (body) body.insertAdjacentHTML('afterbegin', extra)
    }
  }).catch(() => {})
}

// ============================================================
// PROFILE MODAL
// ============================================================
const profileModalVisible = ref(false)
const profileModalTitle = ref('用户画像')
const profileModalBody = ref('')

function closeProfileModal() { profileModalVisible.value = false }

async function showUserProfile(secUid: string) {
  profileModalVisible.value = true
  const found = profileUsers.value.find(u => u.user_sec_uid === secUid)
  const avatarUrl = found?.avatar || ''
  const nickname = found?.nickname || '用户画像'
  profileModalTitle.value = nickname
  let preHtml = `<div style="display:flex;align-items:center;gap:14px;padding:16px 0;border-bottom:1px solid var(--border);margin-bottom:14px">`
  preHtml += avatarHtml52(avatarUrl, nickname)
  preHtml += `<div><div style="font-size:16px;font-weight:600;color:var(--text)">${esc(nickname)}</div></div></div><div class="loading">加载画像...</div>`
  profileModalBody.value = preHtml
  try {
    const p = await fetchUser(secUid) as any
    profileModalTitle.value = p.nickname || '用户画像'
    let html = ''
    html += `<div style="display:flex;align-items:center;gap:14px;padding:16px 0;border-bottom:1px solid var(--border);margin-bottom:14px">`
    html += avatarHtml52(p.avatar, p.nickname)
    html += `<div><div style="font-size:16px;font-weight:600;color:var(--text)">${esc(p.nickname)}</div><div style="font-size:12px;color:var(--text-muted);margin-top:2px">活跃 ${p.activeSessionCount} 场 · 最爱 ${esc(p.favoriteStreamer)}</div></div></div>`
    html += `<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-bottom:16px">`
    html += `<div class="profile-stat"><div class="profile-stat-val orange" style="display:inline-flex;align-items:center">${(p.totalDiamonds || 0).toLocaleString()}<svg viewBox="0 0 24 24" width="14" height="14" style="margin-left:2px;fill:currentColor;opacity:0.6"><path d="M6 2h12l4 7-10 13L2 9z"/><path d="M2 9h20" stroke="rgba(255,255,255,0.2)" stroke-width="0.7" fill="none"/><path d="M12 22l-4-13h8z" fill="rgba(0,0,0,0.1)"/></svg></div><div class="profile-stat-label">总钻石</div></div>`
    html += `<div class="profile-stat"><div class="profile-stat-val">${p.totalGifts || 0}</div><div class="profile-stat-label">礼物数</div></div>`
    html += `<div class="profile-stat"><div class="profile-stat-val">${p.danmakuCount || 0}</div><div class="profile-stat-label">弹幕</div></div>`
    html += `</div>`
    if (p.activeSessions?.length) {
      html += `<div class="profile-section-title" style="margin-bottom:8px">活跃场次 (${p.activeSessions.length})</div><div style="display:flex;flex-direction:column;gap:4px">`
      p.activeSessions.slice(0, 5).forEach((s: any) => {
        const d = s.session_diamonds || 0
        html += `<div style="display:flex;align-items:center;gap:8px;padding:8px 12px;background:var(--bg-card);border:1px solid var(--border);border-radius:var(--radius-sm)"><span style="font-size:12px;color:var(--text-muted);width:72px;flex-shrink:0;font-variant-numeric:tabular-nums">${fmtSessionTime(s.start_time)}</span><span style="font-size:12px;color:var(--text);flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(s.streamer_name || '未知')}</span><span style="font-size:12px;color:${d > 0 ? 'var(--orange)' : 'var(--text-muted)'};flex-shrink:0;font-weight:600;font-variant-numeric:tabular-nums;display:inline-flex;align-items:center"><svg viewBox="0 0 24 24" width="12" height="12" style="margin-left:2px;fill:currentColor"><path d="M6 2h12l4 7-10 13L2 9z"/><path d="M2 9h20" stroke="rgba(255,255,255,0.2)" stroke-width="0.7" fill="none"/><path d="M12 22l-4-13h8z" fill="rgba(0,0,0,0.1)"/></svg>${d.toLocaleString()}</span></div>`
      })
      if (p.activeSessions.length > 5) html += `<div style="text-align:center;font-size:11px;color:var(--text-muted);padding:4px">还有 ${p.activeSessions.length - 5} 场</div>`
      html += `</div>`
    }
    if (p.hourStats?.length) {
      html += `<div class="profile-section-title" style="margin-top:14px">活跃时段</div><div class="hour-chart">`
      const hourArr = Array(24).fill(0)
      p.hourStats.forEach((h: any) => { hourArr[parseInt(h.hour)] = h.count })
      const fullMax = Math.max(...hourArr, 1)
      hourArr.forEach((cnt: number, hr: number) => {
        const pct = (cnt / fullMax * 100)
        html += `<div class="hour-bar" style="height:${Math.max(pct, 3)}%;opacity:${cnt ? 0.7 : 0.15}" title="${hr}时: ${cnt}次"></div>`
      })
      html += `</div><div class="hour-labels"><span>0</span><span>6</span><span>12</span><span>18</span><span>23</span></div>`
    }
    if (p.giftStyle || p.topStreamers?.length) {
      html += `<div class="profile-section-title" style="margin-top:14px">送礼画像</div><div style="display:flex;flex-wrap:wrap;gap:8px;margin-bottom:12px">`
      html += `<div style="padding:6px 12px;background:rgba(251,146,60,0.12);border-radius:var(--radius-sm);font-size:12px;color:var(--orange);display:inline-flex;align-items:center">${esc(p.giftStyle || '-')}</div>`
      html += `<div style="padding:6px 12px;background:var(--bg-card);border:1px solid var(--border);border-radius:var(--radius-sm);font-size:12px;color:var(--text-muted);display:inline-flex;align-items:center;gap:4px">场均 <span style="color:var(--text);font-weight:600;font-variant-numeric:tabular-nums;display:inline-flex;align-items:center"><svg viewBox="0 0 24 24" width="12" height="12" style="margin-right:2px;fill:var(--orange)"><path d="M6 2h12l4 7-10 13L2 9z"/><path d="M2 9h20" stroke="rgba(255,255,255,0.2)" stroke-width="0.7" fill="none"/><path d="M12 22l-4-13h8z" fill="rgba(0,0,0,0.1)"/></svg>${(p.avgPerSession || 0).toLocaleString()}</span></div>`
      html += `<div style="padding:6px 12px;background:var(--bg-card);border:1px solid var(--border);border-radius:var(--radius-sm);font-size:12px;color:var(--text-muted);display:inline-flex;align-items:center;gap:4px">巅峰时段 <span style="color:var(--text);font-weight:600">${esc(p.peakHour || '-')}</span></div>`
      html += `</div>`
      if (p.topStreamers?.length) {
        html += `<div style="font-size:11px;color:var(--text-secondary);margin-bottom:6px">最爱送礼主播</div><div style="display:flex;flex-direction:column;gap:3px;margin-bottom:10px">`
        p.topStreamers.slice(0, 3).forEach((s: any, i: number) => {
          html += `<div style="display:flex;align-items:center;gap:6px;padding:5px 8px;background:var(--bg-card);border:1px solid var(--border);border-radius:var(--radius-sm);font-size:12px"><span style="color:var(--orange);font-weight:700;width:16px;text-align:center;font-variant-numeric:tabular-nums">${String(i + 1).padStart(2, '0')}</span><span style="color:var(--text);flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(s.name)}</span><span style="color:var(--orange);font-weight:600;font-variant-numeric:tabular-nums"><svg viewBox="0 0 24 24" width="12" height="12" style="vertical-align:-2px;fill:currentColor"><path d="M6 2h12l4 7-10 13L2 9z"/><path d="M2 9h20" stroke="rgba(255,255,255,0.2)" stroke-width="0.7" fill="none"/><path d="M12 22l-4-13h8z" fill="rgba(0,0,0,0.1)"/></svg>${s.diamonds.toLocaleString()}</span></div>`
        })
        html += `</div>`
      }
      if (p.topGiftsByCount?.length) {
        html += `<div style="font-size:11px;color:var(--text-secondary);margin-bottom:6px">最常送礼物</div><div style="display:flex;flex-direction:column;gap:3px">`
        p.topGiftsByCount.slice(0, 3).forEach((g: any, i: number) => {
          html += `<div style="display:flex;align-items:center;gap:6px;padding:5px 8px;background:var(--bg-card);border:1px solid var(--border);border-radius:var(--radius-sm);font-size:12px"><span style="color:var(--orange);font-weight:700;width:16px;text-align:center;font-variant-numeric:tabular-nums">${String(i + 1).padStart(2, '0')}</span><span style="font-size:14px">${g.icon_url ? `<img src="${esc(g.icon_url)}" style="width:20px;height:20px;vertical-align:-4px" onerror="this.style.display='none'">` : giftEmoji(g.gift_name)}</span><span style="color:var(--text);flex:1">${esc(g.gift_name)}</span><span style="color:var(--text-muted)">×${g.count}</span><span style="color:var(--orange);font-weight:600;font-variant-numeric:tabular-nums"><svg viewBox="0 0 24 24" width="12" height="12" style="vertical-align:-2px;fill:currentColor"><path d="M6 2h12l4 7-10 13L2 9z"/><path d="M2 9h20" stroke="rgba(255,255,255,0.2)" stroke-width="0.7" fill="none"/><path d="M12 22l-4-13h8z" fill="rgba(0,0,0,0.1)"/></svg>${g.total_diamonds.toLocaleString()}</span></div>`
        })
        html += `</div>`
      }
    }
    if (p.danmakuSamples?.length || p.danmakuStyle) {
      html += `<div class="profile-section-title" style="margin-top:14px">弹幕风格</div>`
      if (p.danmakuStyle) {
        html += `<div style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:10px">`
        p.danmakuStyle.split('·').forEach((t: string) => {
          html += `<div style="padding:4px 10px;background:rgba(108,140,255,0.12);border-radius:var(--radius-sm);font-size:11px;color:var(--accent)">${esc(t)}</div>`
        })
        html += `<div style="padding:4px 10px;background:var(--bg-card);border:1px solid var(--border);border-radius:var(--radius-sm);font-size:11px;color:var(--text-muted)">共 ${p.danmakuCount || 0} 条弹幕</div></div>`
      }
      if (p.danmakuSamples?.length) {
        html += '<div style="display:flex;flex-direction:column;gap:3px">'
        p.danmakuSamples.forEach((d: any) => {
          let content = d.content || ''
          if (content.length > 60) content = content.slice(0, 60) + '…'
          const ts = fmtTime(d.create_time)
          html += `<div style="padding:5px 8px;background:var(--bg-card);border:1px solid var(--border);border-radius:var(--radius-sm);font-size:12px;display:flex;gap:8px;align-items:flex-start"><span style="color:var(--text);flex:1;line-height:1.4">${esc(content)}</span><span style="color:var(--text-muted);font-size:10px;flex-shrink:0;white-space:nowrap">${ts}</span></div>`
        })
        html += '</div>'
      }
    }
    profileModalBody.value = html
  } catch (e: any) { profileModalBody.value = `<div class="empty" style="padding:20px">加载失败: ${esc(e.message)}</div>` }
}

// ============================================================
// GLOBAL EVENT LISTENERS
// ============================================================
function handleDocClick(e: MouseEvent) {
  if (!(e.target as HTMLElement).closest('.cs-wrap')) {
    csOpen.value = ''
  }
}

// ============================================================
// WATCH: topNavTab switching (Layout triggers, HomeView loads content)
// ============================================================
watch(topNavTab, (tab) => {
  if (tab === 'rooms') loadRoomsView()
  else if (tab === 'search') loadSearchView()
  else if (tab === 'profile') loadProfileView()
})

// ============================================================
// LIFECYCLE
// ============================================================
onMounted(() => {
  // Set hosts navigation state
  viewLevel.value = 'hosts'
  store.pageTitle = '直播监控'
  store.showBackBtn = false
  store.showTopNav = true
  store.breadcrumbItems = []

  // Load initial data
  loadRoomsView()

  document.addEventListener('click', handleDocClick)
})

onUnmounted(() => {
  document.removeEventListener('click', handleDocClick)
  stopRoomStatusPoll()
})
</script>
