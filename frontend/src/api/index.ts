const API_PREFIX = ''

/** 获取认证 token（从 URL 参数或 localStorage） */
function getAuthToken(): string | null {
  // 优先从 URL ?token=xxx 读取（首次访问）
  try {
    const params = new URLSearchParams(window.location.search)
    const urlToken = params.get('token')
    if (urlToken) {
      localStorage.setItem('dashboard_token', urlToken)
      // 清除 URL 中的 token 参数，避免泄露
      params.delete('token')
      const newUrl = window.location.pathname + (params.toString() ? '?' + params.toString() : '') + window.location.hash
      window.history.replaceState({}, '', newUrl)
      return urlToken
    }
  } catch {}
  // 从 localStorage 读取
  return localStorage.getItem('dashboard_token')
}

/** 构建带认证的 headers */
function authHeaders(): Record<string, string> {
  const token = getAuthToken()
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  }
  if (token) {
    headers['Authorization'] = `Bearer ${token}`
  }
  return headers
}

/**
 * Generic API fetch wrapper
 */
async function api<T = any>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(`${API_PREFIX}${url}`, {
    headers: authHeaders(),
    ...options,
  })
  if (response.status === 401) {
    // 认证失败，提示用户输入 token
    const token = prompt('请输入仪表盘访问令牌 (Token)：')
    if (token) {
      localStorage.setItem('dashboard_token', token)
      // 重试请求
      return api(url, options)
    }
    throw new Error('认证失败，请提供有效的 Token')
  }
  if (!response.ok) {
    throw new Error(`API Error: ${response.status} ${response.statusText}`)
  }
  return response.json()
}

// ===================== Summary =====================

export interface Summary {
  total_sessions?: number
  total_gifts?: number
  total_diamonds?: number
  total_danmaku?: number
  unique_users?: number
  total_likes?: number
  live_count?: number
  offline_count?: number
}

export function fetchSummary(): Promise<Summary> {
  return api<Summary>('/api/summary')
}

// ===================== Rooms =====================

export interface Room {
  id?: number
  room_id: string
  name: string
  avatar?: string
  session_count?: number
  total_likes?: number
  enabled: boolean
  connected: boolean
  recording: boolean
  _connecting?: boolean
}

export function fetchRooms(): Promise<Room[]> {
  return api<Room[]>('/api/rooms')
}

export interface LookupResult {
  room_id: string
  name: string
  avatar?: string
  description?: string
}

export function lookupRoom(query: string): Promise<LookupResult[]> {
  return api<LookupResult[]>(`/api/rooms/lookup?q=${encodeURIComponent(query)}`)
}

export function addRoom(roomId: string, name: string): Promise<any> {
  return api('/api/rooms/add', {
    method: 'POST',
    body: JSON.stringify({ room_id: roomId, name }),
  })
}

export function pauseRoom(roomId: string): Promise<any> {
  return api('/api/rooms/pause', {
    method: 'POST',
    body: JSON.stringify({ room_id: roomId }),
  })
}

export function resumeRoom(roomId: string): Promise<any> {
  return api('/api/rooms/resume', {
    method: 'POST',
    body: JSON.stringify({ room_id: roomId }),
  })
}

export function removeRoom(roomId: string): Promise<any> {
  return api('/api/rooms/remove', {
    method: 'POST',
    body: JSON.stringify({ room_id: roomId, delete_data: true }),
  })
}

// ===================== Sessions =====================

export interface Session {
  id: number
  title: string
  is_live: boolean
  started_at: number
  ended_at: number | null
  duration_min: number | null
  gift_count: number
  total_diamonds: number
  danmaku_count: number
  user_count: number
  stats_like: number
}

export function fetchSessions(hostId: string): Promise<Session[]> {
  return api<Session[]>(`/api/hosts/${hostId}/sessions`)
}

export function deleteSession(sessionId: string): Promise<any> {
  return api(`/api/sessions/${sessionId}/delete`, {
    method: 'POST',
  })
}

export function getReportUrl(sessionId: string): string {
  const token = getAuthToken()
  const query = token ? `?token=${encodeURIComponent(token)}` : ''
  return `${API_PREFIX}/api/sessions/${sessionId}/report${query}`
}

// ===================== Detail =====================

export interface SessionDetail {
  session: {
    id: number
    room_id?: string
    title?: string
    is_live: boolean
    start_time?: number
    end_time?: number | null
    duration_min?: number | null
    streamer_name?: string
    streamer_avatar?: string
    online_peak?: number
    stats_like?: number
    room_title?: string
  }
  summary: {
    total_diamonds?: number
    total_gifts?: number
    total_danmaku?: number
    danmaku_count?: number
    user_count?: number
    timeline?: { time: string; gifts: number; diamonds: number; danmaku: number }[]
  }
  gifts?: GiftRankItem[]
  giftDetails?: GiftDetailItem[]
  anchorRanking?: AnchorRankItem[]
  danmakuRanking?: DanmakuRankItem[]
  danmakuWords?: { content: string; cnt: number }[]
  danmaku?: DanmakuItem[]
  hasReport?: boolean
}

export interface AnchorRankItem {
  anchor_sec_uid?: string
  anchor_name: string
  anchor_avatar?: string
  total_diamonds: number
  gift_count: number
  user_count: number
}

export interface GiftRankItem {
  nickname: string
  avatar_url?: string
  user_sec_uid?: string
  total_diamonds: number
  gift_count?: number
}

export interface GiftDetailItem {
  nickname: string
  user_sec_uid?: string
  gift_name: string
  to_nickname?: string
  total_diamonds: number
  count: number
  avatar_url?: string
  gift_icon?: string
  create_time?: number
}

export interface DanmakuRankItem {
  nickname: string
  avatar?: string
  user_sec_uid?: string
  msg_count: number
}

export interface DanmakuItem {
  nickname: string
  avatar_url?: string
  content: string
  timestamp: number
  user_sec_uid?: string
}

export function fetchSessionDetail(sessionId: string): Promise<SessionDetail> {
  return api<SessionDetail>(`/api/sessions/${sessionId}/detail`)
}

export interface DanmakuFull {
  data?: DanmakuItem[]
  messages?: DanmakuItem[]
}

export function fetchDanmaku(sessionId: string, limit = 99999): Promise<DanmakuFull> {
  return api<DanmakuFull>(`/api/sessions/${sessionId}/danmaku?limit=${limit}`)
}

// ===================== Streamers =====================

export interface Streamer {
  id: string
  name: string
}

export function fetchStreamers(): Promise<Streamer[]> {
  return api<Streamer[]>('/api/streamers')
}

// ===================== Anonymous =====================

export interface AnonymousLookup {
  sec_uid: string
  nickname: string
  db_names?: string[]
  streamer_name?: string
  actions?: string[]
}

export function anonymousLookup(
  query: string,
  streamerId?: string,
  sessionId?: string
): Promise<AnonymousLookup[]> {
  const params = new URLSearchParams({ q: query })
  if (streamerId) params.set('streamer_id', streamerId)
  if (sessionId) params.set('session_id', sessionId)
  return api<AnonymousLookup[]>(`/api/anonymous-lookup?${params.toString()}`)
}

// ===================== Users =====================

export interface UserProfile {
  sec_uid: string
  nickname: string
  avatar?: string
  signature?: string
  gender?: string
  age?: number
  douyin_id?: string
  is_private?: boolean
  fans_count?: number
  following_count?: number
  ip_location?: string
  aliases?: string[]
  recent_actions?: UserAction[]
  active_sessions?: UserSession[]
  gift_profile?: {
    style?: string[]
    avg_diamonds?: number
    peak_hour?: number
  }
  top_anchors?: { name: string; diamonds: number }[]
  top_gifts?: { name: string; icon?: string; count: number }[]
  danmaku_style?: { tags?: string[]; samples?: string[] }
  activity_hours?: number[]
}

export interface UserAction {
  type: 'danmaku' | 'gift'
  content: string
  time: string
}

export interface UserSession {
  id: string
  title: string
  date: string
  diamonds?: number
}

export function fetchUser(secUid: string): Promise<UserProfile> {
  return api<UserProfile>(`/api/users/${secUid}`)
}

export function searchUser(query: string): Promise<UserProfile[]> {
  return api<UserProfile[]>(`/api/users/search?q=${encodeURIComponent(query)}`)
}
