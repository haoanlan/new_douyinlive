/**
 * App Store — 核心状态集中管理
 * HomeView 通过 storeToRefs 访问响应式状态
 */
import { defineStore } from 'pinia'
import { ref, reactive, computed } from 'vue'
import type { Room, Summary, Session, SessionDetail } from '../api'

export const useAppStore = defineStore('app', () => {
  // ===================== View State =====================
  const contentLoading = ref(true)
  const contentFadeIn = ref(false)
  const topNavTab = ref<'rooms' | 'search' | 'combine'>('rooms')
  const viewLevel = ref<'hosts' | 'sessions' | 'detail'>('hosts')

  // ===================== Navigation =====================
  const currentHostId = ref<string | null>(null)
  const currentSessionId = ref<number | null>(null)
  const pageTitle = ref('直播监控')
  const showBackBtn = ref(false)
  const showTopNav = ref(true)
  const breadcrumbItems = ref<{ label: string; onClick?: () => void }[]>([])

  // ===================== Data =====================
  const rooms = ref<Room[]>([])
  const summary = reactive<Summary>({
    total_sessions: 0, total_gifts: 0, total_diamonds: 0,
    total_danmaku: 0, unique_users: 0
  })
  const sessions = ref<Session[]>([])

  // ===================== Detail =====================
  const detailData = ref<SessionDetail | null>(null)
  const _danmaku = ref<any[]>([])
  const _giftDetails = ref<any[]>([])
  const detailTab = ref('gifts')

  // ===================== Danmaku =====================
  const danmakuSearchQuery = ref('')
  const displayedDanmaku = ref<any[]>([])
  const _newDanmakuCount = ref(0)
  const danmakuDisplayLimit = ref(50)
  const dmSwitchLoading = ref(false)
  const danmakuLoading = ref(false)

  // ===================== Anonymous Query =====================
  const anonQuery = ref('')
  const anonMatches = ref<any[]>([])
  const anonSearched = ref(false)
  const anonLoading = ref(false)

  // ===================== Batch Selection =====================
  const selectedSessionIds = ref<number[]>([])

  // ===================== Computed =====================
  const connectedCount = computed(() => rooms.value.filter(r => r.connected).length)
  const pausedCount = computed(() => rooms.value.filter(r => !r.enabled).length)

  return {
    // View
    contentLoading, contentFadeIn, topNavTab, viewLevel,
    // Navigation
    currentHostId, currentSessionId, pageTitle, showBackBtn, showTopNav, breadcrumbItems,
    // Data
    rooms, summary, sessions,
    // Detail
    detailData, _danmaku, _giftDetails, detailTab,
    // Danmaku
    danmakuSearchQuery, displayedDanmaku, _newDanmakuCount, danmakuDisplayLimit, dmSwitchLoading, danmakuLoading,
    // Anonymous
    anonQuery, anonMatches, anonSearched, anonLoading,
    // Selection
    selectedSessionIds,
    // Computed
    connectedCount, pausedCount,
  }
})
