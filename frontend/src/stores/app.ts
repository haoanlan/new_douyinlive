import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import type {
  Room,
  Session,
  SessionDetail,
  Summary,
  AnonymousLookup,
  Danmaku,
  GiftDetail,
} from '@/api'
import {
  fetchSummary,
  fetchRooms,
  fetchSessions,
  fetchSessionDetail,
  fetchDanmaku,
} from '@/api'

export const useAppStore = defineStore('app', () => {
  // ===================== Core State =====================
  const view = ref<string>('hosts')
  const hostId = ref<string | null>(null)
  const sessionId = ref<string | null>(null)
  const topNavTab = ref<string>('rooms')
  const tab = ref<string>('gifts')
  const _gen = ref<number>(0)

  // ===================== Data Cache =====================
  const rooms = ref<Room[]>([])
  const sessions = ref<Session[]>([])
  const summary = ref<Summary>({})
  const detailData = ref<SessionDetail | null>(null)
  const danmakuData = ref<Danmaku[]>([])

  // ===================== Breadcrumbs =====================
  interface Breadcrumb {
    label: string
    action?: () => void
  }

  const breadcrumbs = computed<Breadcrumb[]>(() => {
    const crumbs: Breadcrumb[] = []
    if (view.value === 'sessions' || view.value === 'detail') {
      crumbs.push({
        label: '房间管理',
        action: () => {
          view.value = 'hosts'
          hostId.value = null
          sessionId.value = null
        },
      })
    }
    if (view.value === 'detail') {
      crumbs.push({
        label: '场次列表',
        action: () => {
          view.value = 'sessions'
          sessionId.value = null
        },
      })
    }
    return crumbs
  })

  // ===================== Batch Selection =====================
  const batchSelected = ref<string[]>([])

  function toggleBatchSelect(sessionIdStr: string) {
    const idx = batchSelected.value.indexOf(sessionIdStr)
    if (idx >= 0) {
      batchSelected.value.splice(idx, 1)
    } else {
      batchSelected.value.push(sessionIdStr)
    }
  }

  function clearBatchSelection() {
    batchSelected.value = []
  }

  // ===================== Actions =====================
  async function loadSummary() {
    summary.value = await fetchSummary()
  }

  async function loadRooms() {
    rooms.value = await fetchRooms()
  }

  async function loadSessions(hostIdStr: string) {
    sessions.value = await fetchSessions(hostIdStr)
  }

  async function loadDetail(sessionIdStr: string) {
    detailData.value = await fetchSessionDetail(sessionIdStr)
  }

  async function loadDanmaku(sessionIdStr: string) {
    const result = await fetchDanmaku(sessionIdStr)
    danmakuData.value = result.messages || []
  }

  // ===================== Navigation =====================
  function navigateToHosts() {
    view.value = 'hosts'
    hostId.value = null
    sessionId.value = null
    topNavTab.value = 'rooms'
    tab.value = 'gifts'
  }

  function navigateToSessions(newHostId: string) {
    view.value = 'sessions'
    hostId.value = newHostId
    sessionId.value = null
    tab.value = 'gifts'
  }

  function navigateToDetail(newSessionId: string) {
    view.value = 'detail'
    sessionId.value = newSessionId
    tab.value = 'gifts'
  }

  return {
    // State
    view,
    hostId,
    sessionId,
    topNavTab,
    tab,
    _gen,
    // Data
    rooms,
    sessions,
    summary,
    detailData,
    danmakuData,
    // Computed
    breadcrumbs,
    batchSelected,
    // Actions
    toggleBatchSelect,
    clearBatchSelection,
    loadSummary,
    loadRooms,
    loadSessions,
    loadDetail,
    loadDanmaku,
    navigateToHosts,
    navigateToSessions,
    navigateToDetail,
  }
})
