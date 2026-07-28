<template>
  <div id="content" :class="{ 'content-fade-in': contentFadeIn }">
    <div v-if="contentLoading" class="loading">加载中...</div>
    <template v-else>
      <!-- Stats Row -->
      <div class="stats-row">
        <div class="stat-card"><div class="stat-label">场次</div><div class="stat-value">{{ sessions.length }}</div></div>
        <div class="stat-card"><div class="stat-label">礼物</div><div class="stat-value">{{ sessionsTotalGifts.toLocaleString() }}</div></div>
        <div class="stat-card"><div class="stat-label">钻石</div><div class="stat-value">{{ sessionsTotalDiamonds.toLocaleString() }}</div></div>
        <div class="stat-card"><div class="stat-label">弹幕</div><div class="stat-value">{{ sessionsTotalDanmaku.toLocaleString() }}</div></div>
        <div class="stat-card"><div class="stat-label">用户</div><div class="stat-value">{{ sessionsTotalUsers.toLocaleString() }}</div></div>
        <div class="stat-card"><div class="stat-label">点赞</div><div class="stat-value">{{ sessionsTotalLikes.toLocaleString() }}</div></div>
      </div>
      <div class="section">
        <div class="section-header"><div class="section-title">场次列表</div></div>
        <div class="filter-bar">
          <label><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="12" height="12" style="vertical-align:-2px"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg> 日期</label>
          <div class="dp-input" id="dpFrom" @click="dpOpen('from')">
            <span v-if="!dpData.from" class="dp-ph">开始日期</span>
            <span v-else class="dp-val">{{ dpData.from }}</span>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
          </div>
          <span class="filter-sep">~</span>
          <div class="dp-input" id="dpTo" @click="dpOpen('to')">
            <span v-if="!dpData.to" class="dp-ph">结束日期</span>
            <span v-else class="dp-val">{{ dpData.to }}</span>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
          </div>
          <button class="filter-btn" @click="clearDateFilter">清除</button>
        </div>
        <div style="overflow-x:auto">
          <table class="session-table">
            <thead>
              <tr>
                <th style="width:36px;padding-left:8px"><input type="checkbox" class="session-cb" id="selectAll" :checked="selectedSessionIds.length === sessions.length && sessions.length > 0" @change="toggleSelectAll"></th>
                <th>场次</th><th>状态</th><th>开始时间</th><th>结束时间</th><th>时长</th><th>礼物</th><th>钻石</th><th>弹幕</th><th>用户</th><th style="width:80px">操作</th>
              </tr>
            </thead>
            <tbody id="sessionTbody">
              <tr v-for="s in filteredSessions" :key="s.id" :data-id="s.id" :data-start="s.started_at || ''" @click="viewDetail(s.id)">
                <td data-label="" @click.stop style="padding-left:8px"><input type="checkbox" class="session-cb" :value="s.id" :checked="selectedSessionIds.includes(s.id)" @change="toggleSessionCheckbox(s.id, $event)"></td>
                <td data-label="场次" style="font-weight:500">{{ s.title || '未命名' }}</td>
                <td data-label="状态"><span class="session-badge" :class="s.is_live ? 'live' : 'offline'">{{ s.is_live ? '直播中' : '已结束' }}</span></td>
                <td data-label="开始" style="color:var(--text-secondary)">{{ fmtTime(s.started_at) }}</td>
                <td data-label="结束" style="color:var(--text-secondary)"><span v-if="!s.ended_at" style="color:var(--green)">进行中</span><span v-else>{{ fmtTime(s.ended_at) }}</span></td>
                <td data-label="时长" style="color:var(--text-secondary)">{{ s.duration_min != null ? formatDuration(s.duration_min) : '-' }}</td>
                <td data-label="礼物"><span style="display:inline-flex;align-items:center"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="12" height="12" style="margin-right:2px"><rect x="3" y="8" width="18" height="13" rx="1"/><path d="M12 8V6c0-2-1.5-4-4-4S4 4 4 6h2"/><path d="M20 6c0-2-1.5-4-4-4s-4 2-4 4h2"/><line x1="12" y1="8" x2="12" y2="21"/><line x1="3" y1="13" x2="21" y2="13"/></svg> {{ s.gift_count.toLocaleString() }}</span></td>
                <td data-label="钻石" class="diamonds"><span style="display:inline-flex;align-items:center"><svg viewBox="0 0 24 24" width="12" height="12" style="margin-right:2px;fill:currentColor"><path d="M6 2h12l4 7-10 13L2 9z"/><path d="M2 9h20" stroke="rgba(255,255,255,0.2)" stroke-width="0.7" fill="none"/><path d="M12 22l-4-13h8z" fill="rgba(0,0,0,0.1)"/></svg> {{ s.total_diamonds.toLocaleString() }}</span></td>
                <td data-label="弹幕">{{ s.danmaku_count.toLocaleString() }}</td>
                <td data-label="用户">{{ s.user_count.toLocaleString() }}</td>
                <td data-label="" @click.stop>
                  <div style="display:flex;gap:4px">
                    <button class="action-btn" title="下载报告" @click.stop="downloadReport(s.id)">
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" width="14" height="14"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                    </button>
                    <button class="action-btn action-btn-del" title="删除" @click.stop="deleteSessionFromList(s.id)">
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" width="14" height="14"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                    </button>
                  </div>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </template>
  </div>

  <!-- BATCH FLOAT BAR -->
  <div id="batchFloat" class="batch-float" :class="{ show: selectedSessionIds.length > 0 }">
    <span class="batch-count">已选 <strong id="batchCount">{{ selectedSessionIds.length }}</strong> 场</span>
    <div class="batch-divider"></div>
    <div class="batch-actions">
      <button class="batch-btn batch-btn-accent" @click="downloadSelectedReports">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
        下载报告
      </button>
      <button class="batch-btn batch-btn-del" @click="deleteSelectedSessions">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
        删除
      </button>
    </div>
  </div>

  <!-- DATE PICKER OVERLAY -->
  <div id="dpOverlay" class="dp-overlay" :class="{ show: dpOverlayVisible }" @click.self="dpClose">
    <div class="dp-calendar">
      <div class="dp-head">
        <button @click="dpNav(-1)">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16"><polyline points="15 18 9 12 15 6"/></svg>
        </button>
        <span class="dp-title" id="dpTitle">{{ dpTitleText }}</span>
        <button @click="dpNav(1)">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16"><polyline points="9 18 15 12 9 6"/></svg>
        </button>
      </div>
      <div class="dp-weekdays"><span>日</span><span>一</span><span>二</span><span>三</span><span>四</span><span>五</span><span>六</span></div>
      <div class="dp-days" id="dpDays" v-html="dpDaysHtml"></div>
      <div class="dp-foot">
        <button @click="dpClear">清除</button>
        <button class="dp-confirm" @click="dpConfirm">确定</button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { storeToRefs } from 'pinia'
import { useAppStore } from '../stores/app'
import { fetchSessions, fetchRooms, deleteSession } from '../api'
import { fmtTime, formatDuration } from '../utils/format'
import { useToast } from '../composables/useToast'
import { useConfirm } from '../composables/useConfirm'
import { useDatePicker } from '../composables/useDatePicker'

interface Session {
  id: number; title: string; is_live: boolean; started_at: string; ended_at: string
  duration_min: number; gift_count: number; total_diamonds: number
  danmaku_count: number; user_count: number; stats_like: number
}

const store = useAppStore()
const router = useRouter()
const route = useRoute()
const { contentLoading, contentFadeIn, sessions, currentHostId, selectedSessionIds, rooms, viewLevel } = storeToRefs(store)
const { toast } = useToast()
const { showConfirm } = useConfirm()
const {
  dpOverlayVisible, dpData, dpTitleText, dpDaysHtml,
  dpOpen, dpClose, dpNav, dpConfirm, dpClear, clearDateFilter
} = useDatePicker()

const API = ''

// Prevent 0-flash: set loading before first render (onMounted runs after first paint)
contentLoading.value = true
contentFadeIn.value = false

// Filtered sessions (depends on date picker)
const filteredSessions = computed(() => {
  const from = dpData.from
  const to = dpData.to
  if (!from && !to) return sessions.value
  return sessions.value.filter(s => {
    const d = (s.started_at || '').substring(0, 10)
    if (!d) return true
    if (from && d < from) return false
    if (to && d > to) return false
    return true
  })
})

// Sessions computed stats
const sessionsTotalGifts = computed(() => sessions.value.reduce((s, x) => s + x.gift_count, 0))
const sessionsTotalDiamonds = computed(() => sessions.value.reduce((s, x) => s + x.total_diamonds, 0))
const sessionsTotalDanmaku = computed(() => sessions.value.reduce((s, x) => s + x.danmaku_count, 0))
const sessionsTotalUsers = computed(() => sessions.value.reduce((s, x) => s + x.user_count, 0))
const sessionsTotalLikes = computed(() => sessions.value.reduce((s, x) => s + (x.stats_like || 0), 0))

// Navigate to detail
function viewDetail(sessionId: number) {
  router.push({ name: 'detail', params: { sessionId: String(sessionId) } })
}

// Batch selection
function toggleSelectAll(e: Event) {
  const checked = (e.target as HTMLInputElement).checked
  if (checked) selectedSessionIds.value = sessions.value.map(s => s.id)
  else selectedSessionIds.value = []
}

function toggleSessionCheckbox(id: number, e: Event) {
  const checked = (e.target as HTMLInputElement).checked
  const tr = (e.target as HTMLElement).closest('tr')
  if (checked) {
    if (!selectedSessionIds.value.includes(id)) selectedSessionIds.value.push(id)
    if (tr) tr.classList.add('selected')
  } else {
    selectedSessionIds.value = selectedSessionIds.value.filter(i => i !== id)
    if (tr) tr.classList.remove('selected')
  }
}

// Session actions
function downloadReport(sessionId: number) {
  window.open(`${API}/api/sessions/${sessionId}/report`, '_blank')
}

async function deleteSessionFromList(sessionId: number) {
  const confirmed = await showConfirm('🗑️', '确定删除这场直播数据？<br><br>弹幕、礼物、在线记录将一并清除<br>此操作不可恢复！')
  if (!confirmed) return
  try {
    const r = await deleteSession(String(sessionId))
    toast(r.ok ? '场次已删除' : (r.error || '删除失败'), r.ok ? 'success' : 'error')
    if (r.ok) await loadSessions()
  } catch (e: any) { toast('网络错误: ' + e.message, 'error') }
}

function downloadSelectedReports() {
  const ids = selectedSessionIds.value
  if (ids.length === 0) { toast('请先选择场次', 'error'); return }
  ids.forEach((id, i) => { setTimeout(() => window.open(`${API}/api/sessions/${id}/report`, '_blank'), i * 500) })
  toast(`正在生成 ${ids.length} 份报告...`, 'success')
}

async function deleteSelectedSessions() {
  const ids = selectedSessionIds.value
  if (ids.length === 0) { toast('请先选择场次', 'error'); return }
  const confirmed = await showConfirm('🗑️', `确定删除选中的 <strong>${ids.length}</strong> 场数据？<br><br>弹幕、礼物、在线记录将一并清除<br>此操作不可恢复！`)
  if (!confirmed) return
  let ok = 0, fail = 0
  for (const id of ids) {
    try { const r = await deleteSession(String(id)); r.ok ? ok++ : fail++ } catch { fail++ }
  }
  toast(`已删除 ${ok} 场${fail ? `，${fail} 场失败` : ''}`, ok > 0 ? 'success' : 'error')
  await loadSessions()
}

// Data loading
async function loadSessions() {
  const hostId = currentHostId.value
  if (!hostId) return
  selectedSessionIds.value = []
  sessions.value = []
  contentLoading.value = true
  try {
    const data = await fetchSessions(hostId)
    sessions.value = data
    contentLoading.value = false
    contentFadeIn.value = true
  } catch (e: any) {
    contentLoading.value = false
    contentFadeIn.value = true
    toast('加载失败: ' + e.message, 'error')
  }
}

// Set navigation state for breadcrumb
function setupNav() {
  const hostId = currentHostId.value!
  const host = rooms.value.find(h => h.room_id === hostId)
  const hostName = host?.name || ''
  viewLevel.value = 'sessions'
  store.pageTitle = hostName
  store.showBackBtn = true
  store.showTopNav = false
  store.breadcrumbItems = [
    { label: '房间管理', onClick: () => router.push({ name: 'hosts' }) },
    { label: hostName }
  ]
}

onMounted(async () => {
  const hostId = route.params.hostId as string
  currentHostId.value = hostId
  currentSessionId.value = null

  // Ensure rooms loaded (needed for breadcrumb host name)
  if (!rooms.value.length) {
    try { rooms.value = await fetchRooms() } catch { /* ignore */ }
  }

  setupNav()
  await loadSessions()
})

// Need currentSessionId from store for cleanup
const { currentSessionId } = storeToRefs(store)
</script>
