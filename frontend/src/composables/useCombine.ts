/**
 * Combine composable — 合并场次查看逻辑
 */
import { ref } from 'vue'

interface CombineSession {
  id: number
  title: string
  streamer_name: string
  streamer_id: string
  started_at: number
  ended_at: number | null
  gift_count: number
  total_diamonds: number
  danmaku_count: number
  user_count: number
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

export function useCombine(api: (path: string) => Promise<any>, toast: (msg: string, type?: string) => void) {
  const allSessions = ref<CombineSession[]>([])
  const selectedIds = ref<Set<number>>(new Set())
  const combineLoading = ref(false)
  const viewLoading = ref(false)
  const combinedResult = ref<CombinedResult | null>(null)
  const showCombineModal = ref(false)

  async function loadCombineView() {
    selectedIds.value = new Set()
    combinedResult.value = null
    viewLoading.value = true
    try {
      const streamers = await api('/api/streamers')
      const sessionArrays = await Promise.all(
        streamers.map((s: { id: string; name: string }) =>
          api(`/api/hosts/${s.id}/sessions`).then((sessions: any[]) =>
            sessions.map((sess: any) => ({
              ...sess,
              streamer_name: s.name,
              streamer_id: s.id,
            }))
          )
        )
      )
      // flatten and sort by started_at descending
      const flat = sessionArrays.flat()
      flat.sort((a: CombineSession, b: CombineSession) => {
        const ta = typeof a.started_at === 'number' ? a.started_at : new Date(a.started_at).getTime() / 1000
        const tb = typeof b.started_at === 'number' ? b.started_at : new Date(b.started_at).getTime() / 1000
        return tb - ta
      })
      allSessions.value = flat
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

  function toggleSelectAll() {
    if (selectedIds.value.size === allSessions.value.length) {
      selectedIds.value = new Set()
    } else {
      selectedIds.value = new Set(allSessions.value.map(s => s.id))
    }
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
    combinedResult, showCombineModal,
    loadCombineView, toggleSelect, toggleSelectAll,
    mergeSessions, closeCombineModal,
  }
}
