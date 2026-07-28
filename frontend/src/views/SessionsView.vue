<template>
  <div class="app-container">
    <!-- Header -->
    <header class="top-bar">
      <button class="back-btn" @click="goBack" title="返回">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="18" height="18">
          <polyline points="15 18 9 12 15 6"/>
        </svg>
      </button>
      <h1 class="page-title">场次列表</h1>
    </header>

    <!-- Stats Row -->
    <div class="stats-row">
      <div class="stat-card">
        <div class="stat-label">场次</div>
        <div class="stat-value">{{ sessions.length }}</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">礼物</div>
        <div class="stat-value">{{ totalGifts.toLocaleString() }}</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">钻石</div>
        <div class="stat-value">{{ totalDiamonds.toLocaleString() }}</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">弹幕</div>
        <div class="stat-value">{{ totalDanmaku.toLocaleString() }}</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">用户</div>
        <div class="stat-value">{{ totalUsers.toLocaleString() }}</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">点赞</div>
        <div class="stat-value">{{ totalLikes.toLocaleString() }}</div>
      </div>
    </div>

    <!-- Section: 场次列表 -->
    <div class="section">
      <div class="section-header">
        <div class="section-title">场次列表</div>
      </div>

      <!-- Filter Bar -->
      <div class="filter-bar">
        <label>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="12" height="12" style="vertical-align:-2px">
            <rect x="3" y="4" width="18" height="18" rx="2"/>
            <line x1="16" y1="2" x2="16" y2="6"/>
            <line x1="8" y1="2" x2="8" y2="6"/>
            <line x1="3" y1="10" x2="21" y2="10"/>
          </svg>
          日期
        </label>
        <div class="dp-input" id="dpFrom" @click="dpOpen('from')">
          <span v-if="!dpData.from" class="dp-ph">开始日期</span>
          <span v-else class="dp-val">{{ dpData.from }}</span>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <rect x="3" y="4" width="18" height="18" rx="2"/>
            <line x1="16" y1="2" x2="16" y2="6"/>
            <line x1="8" y1="2" x2="8" y2="6"/>
            <line x1="3" y1="10" x2="21" y2="10"/>
          </svg>
        </div>
        <span class="filter-sep">~</span>
        <div class="dp-input" id="dpTo" @click="dpOpen('to')">
          <span v-if="!dpData.to" class="dp-ph">结束日期</span>
          <span v-else class="dp-val">{{ dpData.to }}</span>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <rect x="3" y="4" width="18" height="18" rx="2"/>
            <line x1="16" y1="2" x2="16" y2="6"/>
            <line x1="8" y1="2" x2="8" y2="6"/>
            <line x1="3" y1="10" x2="21" y2="10"/>
          </svg>
        </div>
        <button class="filter-btn" @click="clearDateFilter">清除</button>
      </div>

      <!-- Session Table -->
      <div style="overflow-x:auto">
        <table class="session-table">
          <thead>
            <tr>
              <th style="width:36px;padding-left:8px">
                <input
                  type="checkbox"
                  class="session-cb"
                  :checked="allSelected"
                  @change="toggleSelectAll"
                >
              </th>
              <th>场次</th>
              <th>状态</th>
              <th>开始时间</th>
              <th>结束时间</th>
              <th>时长</th>
              <th>礼物</th>
              <th>钻石</th>
              <th>弹幕</th>
              <th>用户</th>
              <th style="width:80px">操作</th>
            </tr>
          </thead>
          <tbody id="sessionTbody">
            <TransitionGroup name="list" tag="template">
              <tr
              v-for="s in filteredSessions"
              :key="s.id"
              :data-id="s.id"
              :data-start="s.started_at || ''"
              :class="{ selected: selectedIds.has(s.id) }"
            >
              <td data-label="" style="padding-left:8px" @click.stop>
                <input
                  type="checkbox"
                  class="session-cb"
                  :value="s.id"
                  :checked="selectedIds.has(s.id)"
                  @change="toggleRow(s.id)"
                >
              </td>
              <td data-label="场次" @click="viewDetail(s.id)" style="font-weight:500">
                {{ s.title || '未命名' }}
              </td>
              <td data-label="状态" @click="viewDetail(s.id)">
                <span class="session-badge" :class="s.is_live ? 'live' : 'offline'">
                  {{ s.is_live ? '直播中' : '已结束' }}
                </span>
              </td>
              <td data-label="开始" @click="viewDetail(s.id)" style="color:var(--text-secondary)">
                {{ fmtTime(s.started_at) }}
              </td>
              <td data-label="结束" @click="viewDetail(s.id)" style="color:var(--text-secondary)">
                <template v-if="s.ended_at">{{ fmtTime(s.ended_at) }}</template>
                <span v-else style="color:var(--green)">进行中</span>
              </td>
              <td data-label="时长" @click="viewDetail(s.id)" style="color:var(--text-secondary)">
                {{ s.duration_min != null ? formatDuration(s.duration_min) : '-' }}
              </td>
              <td data-label="礼物" @click="viewDetail(s.id)">
                <span style="display:inline-flex;align-items:center">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="12" height="12" style="margin-right:2px">
                    <rect x="3" y="8" width="18" height="13" rx="1"/>
                    <path d="M12 8V6c0-2-1.5-4-4-4S4 4 4 6h2"/>
                    <path d="M20 6c0-2-1.5-4-4-4s-4 2-4 4h2"/>
                    <line x1="12" y1="8" x2="12" y2="21"/>
                    <line x1="3" y1="13" x2="21" y2="13"/>
                  </svg>
                  {{ s.gift_count.toLocaleString() }}
                </span>
              </td>
              <td data-label="钻石" @click="viewDetail(s.id)" class="diamonds">
                <span style="display:inline-flex;align-items:center">
                  <svg viewBox="0 0 24 24" width="12" height="12" style="margin-right:2px;fill:currentColor">
                    <path d="M6 2h12l4 7-10 13L2 9z"/>
                    <path d="M2 9h20" stroke="rgba(255,255,255,0.2)" stroke-width="0.7" fill="none"/>
                    <path d="M12 22l-4-13h8z" fill="rgba(0,0,0,0.1)"/>
                  </svg>
                  {{ s.total_diamonds.toLocaleString() }}
                </span>
              </td>
              <td data-label="弹幕" @click="viewDetail(s.id)">
                {{ s.danmaku_count.toLocaleString() }}
              </td>
              <td data-label="用户" @click="viewDetail(s.id)">
                {{ s.user_count.toLocaleString() }}
              </td>
              <td data-label="" @click.stop>
                <div style="display:flex;gap:4px">
                  <button class="action-btn" title="下载报告" @click="downloadReport(s.id)">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
                      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                      <polyline points="7 10 12 15 17 10"/>
                      <line x1="12" y1="15" x2="12" y2="3"/>
                    </svg>
                  </button>
                  <button class="action-btn action-btn-del" title="删除" @click="deleteSessionFromList(s.id)">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
                      <line x1="18" y1="6" x2="6" y2="18"/>
                      <line x1="6" y1="6" x2="18" y2="18"/>
                    </svg>
                  </button>
                </div>
              </td>
            </tr>
            </TransitionGroup>
          </tbody>
        </table>
      </div>
    </div>

    <!-- Batch Float Bar -->
    <div class="batch-float" :class="{ show: selectedIds.size > 0 }">
      <span class="batch-count">已选 <strong>{{ selectedIds.size }}</strong> 场</span>
      <div class="batch-divider"></div>
      <div class="batch-actions">
        <button class="batch-btn batch-btn-accent" @click="downloadSelectedReports">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
            <polyline points="7 10 12 15 17 10"/>
            <line x1="12" y1="15" x2="12" y2="3"/>
          </svg>
          下载报告
        </button>
        <button class="batch-btn batch-btn-del" @click="deleteSelectedSessions">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="3 6 5 6 21 6"/>
            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
          </svg>
          删除
        </button>
      </div>
    </div>

    <!-- Date Picker Overlay -->
    <div class="dp-overlay" :class="{ show: dpVisible }" @click.self="dpClose">
      <div class="dp-calendar">
        <div class="dp-head">
          <button @click="dpNav(-1)">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16">
              <polyline points="15 18 9 12 15 6"/>
            </svg>
          </button>
          <span class="dp-title">{{ dpTitle }}</span>
          <button @click="dpNav(1)">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16">
              <polyline points="9 18 15 12 9 6"/>
            </svg>
          </button>
        </div>
        <div class="dp-weekdays">
          <span>日</span><span>一</span><span>二</span><span>三</span><span>四</span><span>五</span><span>六</span>
        </div>
        <div class="dp-days">
          <button
            v-for="(day, i) in dpDays"
            :key="i"
            class="dp-day"
            :class="{
              other: day.other,
              today: day.isToday,
              selected: day.isSelected
            }"
            :disabled="day.other"
            @click="!day.other && dpPick(day.dateStr)"
          >
            {{ day.num }}
          </button>
        </div>
        <div class="dp-foot">
          <button @click="dpClear">清除</button>
          <button class="dp-confirm" @click="dpConfirm">确定</button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { fmtTime, formatDuration } from '../utils/format'
import { useToast } from '../composables/useToast'
import { useConfirm } from '../composables/useConfirm'
import { fetchSessions, deleteSession, getReportUrl } from '../api'

const props = defineProps({
  hostId: { type: String, required: true }
})

const router = useRouter()
const { toast } = useToast()
const { showConfirm } = useConfirm()

function goBack() {
  router.push({ name: 'hosts' })
}

const API = ''

// State
const sessions = ref([])
const loading = ref(true)
const error = ref('')
const selectedIds = ref(new Set())

// Date picker state
const dpVisible = ref(false)
const dpType = ref(null)
const dpYear = ref(0)
const dpMonth = ref(0)
const dpDay = ref(0)
const dpTemp = ref(null)
const dpData = ref({ from: null, to: null })

// Computed
const totalGifts = computed(() => sessions.value.reduce((s, x) => s + x.gift_count, 0))
const totalDiamonds = computed(() => sessions.value.reduce((s, x) => s + x.total_diamonds, 0))
const totalDanmaku = computed(() => sessions.value.reduce((s, x) => s + x.danmaku_count, 0))
const totalUsers = computed(() => sessions.value.reduce((s, x) => s + x.user_count, 0))
const totalLikes = computed(() => sessions.value.reduce((s, x) => s + (x.stats_like || 0), 0))

const allSelected = computed(() => {
  return sessions.value.length > 0 && selectedIds.value.size === sessions.value.length
})

const filteredSessions = computed(() => {
  const from = dpData.value.from
  const to = dpData.value.to
  if (!from && !to) return sessions.value
  return sessions.value.filter(s => {
    const start = s.started_at || ''
    const d = start.substring(0, 10)
    if (from && d < from) return false
    if (to && d > to) return false
    return true
  })
})

const months = ['1月','2月','3月','4月','5月','6月','7月','8月','9月','10月','11月','12月']

const dpTitle = computed(() => `${dpYear.value}年 ${months[dpMonth.value]}`)

const dpDays = computed(() => {
  const { year, month } = { year: dpYear.value, month: dpMonth.value }
  const firstDay = new Date(year, month, 1).getDay()
  const daysInMonth = new Date(year, month + 1, 0).getDate()
  const today = new Date()
  const todayStr = `${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,'0')}-${String(today.getDate()).padStart(2,'0')}`
  const selectedStr = dpTemp.value

  const days = []
  // Previous month padding
  const prevDays = new Date(year, month, 0).getDate()
  for (let i = firstDay - 1; i >= 0; i--) {
    days.push({ num: prevDays - i, other: true, isToday: false, isSelected: false, dateStr: '' })
  }
  // Current month
  for (let d = 1; d <= daysInMonth; d++) {
    const ds = `${year}-${String(month+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`
    days.push({
      num: d,
      other: false,
      isToday: ds === todayStr,
      isSelected: ds === selectedStr,
      dateStr: ds
    })
  }
  // Next month padding
  const total = firstDay + daysInMonth
  const remaining = total % 7 === 0 ? 0 : 7 - (total % 7)
  for (let i = 1; i <= remaining; i++) {
    days.push({ num: i, other: true, isToday: false, isSelected: false, dateStr: '' })
  }
  return days
})

// Helpers (imported from utils/format)

// Selection
function toggleSelectAll(e) {
  const checked = e.target.checked
  if (checked) {
    selectedIds.value = new Set(sessions.value.map(s => s.id))
  } else {
    selectedIds.value = new Set()
  }
}

function toggleRow(id) {
  const newSet = new Set(selectedIds.value)
  if (newSet.has(id)) {
    newSet.delete(id)
  } else {
    newSet.add(id)
  }
  selectedIds.value = newSet
}

// Date picker
function dpOpen(type) {
  dpType.value = type
  const val = dpData.value[type]
  const now = val ? new Date(val + 'T00:00:00') : new Date()
  dpYear.value = now.getFullYear()
  dpMonth.value = now.getMonth()
  dpDay.value = val ? now.getDate() : 0
  dpTemp.value = val
  dpVisible.value = true
}

function dpClose() {
  dpVisible.value = false
}

function dpNav(dir) {
  dpMonth.value += dir
  if (dpMonth.value > 11) { dpMonth.value = 0; dpYear.value++ }
  if (dpMonth.value < 0) { dpMonth.value = 11; dpYear.value-- }
}

function dpPick(dateStr) {
  dpTemp.value = dateStr
}

function dpConfirm() {
  const type = dpType.value
  const val = dpTemp.value
  dpData.value[type] = val
  dpClose()
}

function dpClear() {
  dpTemp.value = null
}

function clearDateFilter() {
  dpData.value.from = null
  dpData.value.to = null
}

// Actions
function viewDetail(id: number) {
  router.push({ name: 'detail', params: { sessionId: String(id) } })
}

function downloadReport(id: number) {
  window.open(getReportUrl(id), '_blank')
}

function downloadSelectedReports() {
  const ids = [...selectedIds.value]
  if (ids.length === 0) {
    toast('请先选择场次', 'error')
    return
  }
  ids.forEach((id, i) => {
    setTimeout(() => window.open(getReportUrl(id), '_blank'), i * 500)
  })
  toast(`正在生成 ${ids.length} 份报告...`, 'success')
}

async function deleteSessionFromList(sessionId: number) {
  const confirmed = await showConfirm('🗑️', '确定删除这场直播数据？<br><br>弹幕、礼物、在线记录将一并清除<br>此操作不可恢复！')
  if (!confirmed) return
  try {
    const r = await deleteSession(String(sessionId))
    toast(r.ok ? '场次已删除' : (r.error || '删除失败'), r.ok ? 'success' : 'error')
    if (r.ok) fetchSessionsList()
  } catch(e) {
    toast('网络错误: ' + e.message, 'error')
  }
}

async function deleteSelectedSessions() {
  const ids = [...selectedIds.value]
  if (ids.length === 0) {
    toast('请先选择场次', 'error')
    return
  }
  const confirmed = await showConfirm('🗑️', `确定删除选中的 <strong>${ids.length}</strong> 场数据？<br><br>弹幕、礼物、在线记录将一并清除<br>此操作不可恢复！`)
  if (!confirmed) return
  let ok = 0, fail = 0
  for (const id of ids) {
    try {
      const r = await deleteSession(String(id))
      r.ok ? ok++ : fail++
    } catch(e) { fail++ }
  }
  toast(`已删除 ${ok} 场${fail ? `，${fail} 场失败` : ''}`, ok > 0 ? 'success' : 'error')
  fetchSessionsList()
}

// Data fetching
async function fetchSessionsList() {
  loading.value = true
  error.value = ''
  try {
    sessions.value = await fetchSessions(props.hostId)
  } catch(e) {
    error.value = e.message
  } finally {
    loading.value = false
  }
}

onMounted(() => {
  fetchSessionsList()
})
</script>
