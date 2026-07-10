const API_PREFIX = ''

/**
 * Generic API fetch wrapper
 */
async function api<T = any>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(`${API_PREFIX}${url}`, {
    headers: {
      'Content-Type': 'application/json',
    },
    ...options,
  })
  if (!response.ok) {
    throw new Error(`API Error: ${response.status} ${response.statusText}`)
  }
  return response.json()
}

// ===================== Summary =====================

export interface Summary {
  total_rooms?: number
  total_sessions?: number
  total_gifts?: number
  total_diamonds?: number
  total_danmaku?: number
  total_users?: number
  total_likes?: number
  live_count?: number
  paused_count?: number
}

export function fetchSummary(): Promise<Summary> {
  return api<Summary>('/api/summary')
}

// ===================== Rooms =====================

export interface Room {
  id: string
  room_id: string
  name: string
  avatar?: string
  status: 'live' | 'idle' | 'paused'
  session_count?: number
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
  id: string
  title: string
  status: 'live' | 'offline'
  start_time: number
  end_time?: number
  duration?: number
  total_gifts?: number
  total_diamonds?: number
  total_danmaku?: number
  total_users?: number
  total_likes?: number
  has_report?: boolean
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
  return `${API_PREFIX}/api/sessions/${sessionId}/report`
}

// ===================== Detail =====================

export interface SessionDetail {
  id: string
  title: string
  is_live: boolean
  has_report: boolean
  peak_online?: number
  total_diamonds?: number
  total_likes?: number
  total_danmaku?: number
  total_users?: number
  duration?: number
  anchors?: Anchor[]
  gifts?: GiftRank[]
  danmaku?: Danmaku[]
}

export interface Anchor {
  id: string
  name: string
  avatar?: string
  diamonds?: number
  gifts?: number
  users?: number
}

export interface GiftRank {
  rank: number
  user_name: string
  avatar?: string
  sec_uid?: string
  diamonds?: number
  gifts?: GiftDetail[]
}

export interface GiftDetail {
  name: string
  icon?: string
  count: number
  diamonds: number
  to_anchor?: string
}

export interface Danmaku {
  time: string
  user: string
  text: string
  avatar?: string
}

export function fetchSessionDetail(sessionId: string): Promise<SessionDetail> {
  return api<SessionDetail>(`/api/sessions/${sessionId}/detail`)
}

export interface DanmakuFull {
  messages: Danmaku[]
}

export function fetchDanmaku(sessionId: string): Promise<DanmakuFull> {
  return api<DanmakuFull>(`/api/sessions/${sessionId}/danmaku?limit=99999`)
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
