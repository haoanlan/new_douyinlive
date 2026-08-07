/**
 * Combine composable — 合并场次查看逻辑
 */
import { ref, computed } from 'vue'

interface CombineSession {
  id: number
  room_title: string | null
  streamer_name: string
  streamer_id: number
  start_time: string
  end_time: string | null
  agg_gifts: number | null
  agg_diamonds: number | null
  agg_danmaku: number | null
}

interface CombinedResult {
  session_ids: number[]
  summary: {
    total_gifts: number
    total_diamonds: number
    total_danmaku: number
    user_count: number
  }
  gifts: {
    nickname: string
    avatar_url?: string
    user_sec_uid?: string
    total_diamonds: number
    gift_count: number
  }[]
  anchorRanking: {
    anchor_name: string
    anchor_avatar?: string
    total_diamonds: number
    gift_count: number
    user_count: number
  }[]
  danmakuRanking: {
    nickname: string
    avatar?: string
    user_sec_uid?: string
    msg_count: number
  }[]
}

interface StreamerGroup {
  streamer_id: number
  streamer_name: string
  sessions: CombineSession[]
}

export function useCombine(api: (path: string) => Promise<any>, toast: (msg: string, type?: string) => void) {
  const allSessions = ref<CombineSession[]>([])
  const selectedIds = ref<Set<number>>(new Set())
  const combineLoading = ref(false)
  const viewLoading = ref(false)
  const combinedResult = ref<CombinedResult | null>(null)
  const showCombineModal = ref(false)
  const expandedStreamers = ref<Set<number>>(new Set())

  // 按主播分组
  const groupedSessions = computed<StreamerGroup[]>(() => {
    const map = new Map<number, StreamerGroup>()
    for (const s of allSessions.value) {
      if (!map.has(s.streamer_id)) {
        map.set(s.streamer_id, { streamer_id: s.streamer_id, streamer_name: s.streamer_name, sessions: [] })
      }
      map.get(s.streamer_id)!.sessions.push(s)
    }
    return Array.from(map.values()).sort((a, b) => a.streamer_name.localeCompare(b.streamer_name))
  })

  async function loadCombineView() {
    selectedIds.value = new Set()
    combinedResult.value = null
    expandedStreamers.value = new Set()
    viewLoading.value = true
    try {
      const streamers = await api('/api/streamers')
      const sessionArrays = await Promise.all(
        streamers.map((s: { id: number; name: string }) =>
          api(`/api/hosts/${s.id}/sessions`).then((sessions: any[]) =>
            sessions.map((sess: any) => ({
              ...sess,
              streamer_name: s.name,
              streamer_id: s.id,
            }))
          )
        )
      )
      allSessions.value = sessionArrays.flat()
    } catch (e: any) {
      toast('加载场次列表失败: ' + e.message, 'error')
      allSessions.value = []
    }
    viewLoading.value = false
  }

  function toggleSelect(id: number) {
    const s = new Set(selectedIds.value)
    if (s.has(id)) s.delete(id)
    else s.add(id)
    selectedIds.value = s
  }

  function toggleStreamer(streamerId: number) {
    const s = new Set(expandedStreamers.value)
    if (s.has(streamerId)) s.delete(streamerId)
    else s.add(streamerId)
    expandedStreamers.value = s
  }

  function toggleStreamerSessions(streamerId: number) {
    const group = groupedSessions.value.find(g => g.streamer_id === streamerId)
    if (!group) return
    const allSelected = group.sessions.every(s => selectedIds.value.has(s.id))
    const s = new Set(selectedIds.value)
    for (const sess of group.sessions) {
      if (allSelected) s.delete(sess.id)
      else s.add(sess.id)
    }
    selectedIds.value = s
  }

  function selectRecent(n: number) {
    const sorted = [...allSessions.value].sort((a, b) => {
      const ta = new Date(a.start_time).getTime()
      const tb = new Date(b.start_time).getTime()
      return tb - ta
    })
    selectedIds.value = new Set(sorted.slice(0, n).map(s => s.id))
  }

  async function mergeSessions() {
    if (selectedIds.value.size < 2) {
      toast('请至少选择2个场次', 'error')
      return
    }
    combineLoading.value = true
    try {
      const ids = Array.from(selectedIds.value).join(',')
      const result = await api(`/api/sessions/combined?ids=${ids}`)
      combinedResult.value = result
      showCombineModal.value = true
    } catch (e: any) {
      toast('合并查询失败: ' + e.message, 'error')
    }
    combineLoading.value = false
  }

  function closeCombineModal() {
    showCombineModal.value = false
  }

  return {
    allSessions, selectedIds, combineLoading, viewLoading,
    combinedResult, showCombineModal, groupedSessions, expandedStreamers,
    loadCombineView, toggleSelect, toggleStreamer, toggleStreamerSessions,
    selectRecent, mergeSessions, closeCombineModal,
  }
}
