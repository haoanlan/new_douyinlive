/**
 * Search composable — 匿名查询逻辑
 */
import { ref, reactive } from 'vue'

interface Streamer { id: string; name: string; room_id: string }
interface Session { id: number; title: string; started_at: string }
interface AnonUser {
  user_sec_uid: string; nickname: string; db_nicknames: string[]
  latest_gift: any; latest_danmaku: any; total_diamonds: number
  api_avatar?: string; avatar?: string
}

export function useSearch(api: (path: string) => Promise<any>, toast: (msg: string, type?: string) => void) {
  const streamers = ref<Streamer[]>([])
  const csState = reactive<Record<string, string>>({ anonStreamer: '', anonSession: '' })
  const csLabels = reactive<Record<string, string>>({ anonStreamer: '全部直播间', anonSession: '全部场次' })
  const csOpen = ref('')
  const anonSessions = ref<Session[]>([])
  const searchInput = ref('')
  const searchResults = ref<AnonUser[]>([])
  const searchLoading = ref(false)
  const searchSearched = ref(false)
  const _anonResults = ref<AnonUser[]>([])

  async function loadSearchView() {
    searchResults.value = []
    searchSearched.value = false
    searchInput.value = ''
    csState.anonStreamer = ''
    csState.anonSession = ''
    csLabels.anonStreamer = '全部直播间'
    csLabels.anonSession = '全部场次'
    try {
      const s = await api('/api/streamers')
      streamers.value = s
    } catch { streamers.value = [] }
  }

  function toggleCs(name: string) {
    csOpen.value = csOpen.value === name ? '' : name
  }

  function selectCs(name: string, val: string, label: string) {
    csState[name] = val
    csLabels[name] = label
    csOpen.value = ''
    if (name === 'anonStreamer') onAnonStreamerChange(val)
  }

  async function onAnonStreamerChange(streamerId: string) {
    csState.anonSession = ''
    csLabels.anonSession = '全部场次'
    anonSessions.value = []
    if (!streamerId) return
    try {
      const sessions = await api(`/api/hosts/${streamerId}/sessions`)
      anonSessions.value = sessions
    } catch { anonSessions.value = [] }
  }

  async function doAnonymousLookup() {
    const q = searchInput.value.trim()
    if (!q) return
    searchLoading.value = true
    searchSearched.value = true
    try {
      let url = `/api/anonymous-lookup?q=${encodeURIComponent(q)}`
      if (csState.anonStreamer) url += `&streamer_id=${csState.anonStreamer}`
      if (csState.anonSession) url += `&session_id=${csState.anonSession}`
      const data = await api(url)
      searchResults.value = data.users || []
      _anonResults.value = data.users || []
      // 预加载头像
      for (const u of searchResults.value) {
        const url = u.api_avatar || u.avatar
        if (url) { const img = new Image(); img.src = url.startsWith('//') ? 'https:' + url : url }
      }
    } catch (e: any) {
      toast('查询失败: ' + e.message, 'error')
      searchResults.value = []
    }
    searchLoading.value = false
  }

  function getDbName(u: AnonUser) { return u.db_nicknames?.[0] || '未知' }
  function actionLabel(type: string) { return ({ gift: '礼物', danmaku: '弹幕', member: '进场' } as Record<string, string>)[type] || type }

  return {
    streamers, csState, csLabels, csOpen, anonSessions,
    searchInput, searchResults, searchLoading, searchSearched,
    loadSearchView, toggleCs, selectCs, doAnonymousLookup,
    getDbName, actionLabel
  }
}
