import request from './douyin-http'

/**
 * 抖音监控后端 API 层
 *
 * 对接 web-dashboard.js 的 REST API（9871 端口），所有接口返回裸 JSON。
 * 类型定义与旧前端 frontend/src/api/index.ts 保持一致。
 */

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

export interface LookupResult {
  room_id: string
  name: string
  avatar?: string
  description?: string
}

// ===================== Sessions =====================

export interface Session {
  id: number
  title: string
  streamer_avatar?: string
  streamer_name?: string
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

export interface SessionDetail {
  session: {
    id: number
    streamer_id?: number
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

export interface DanmakuFull {
  data?: DanmakuItem[]
  messages?: DanmakuItem[]
}

// ===================== Streamers =====================

export interface Streamer {
  id: string
  name: string
}

// ===================== Anonymous =====================

export interface AnonymousLookup {
  sec_uid: string
  nickname: string
  db_names?: string[]
  streamer_name?: string
  actions?: string[]
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

// ===================== Trends =====================

export interface Trends {
  giftTrend: { date: string; total_diamonds: number; gift_count: number; sender_count: number }[]
  danmakuTrend: { date: string; danmaku_count: number; sender_count: number }[]
  onlineTrend: { date: string; peak_online: number | null }[]
}

// ===================== Status =====================

export interface RoomStatus {
  connected: boolean
  recording: boolean
  liveStatus: string | null
  stats: Record<string, number> | null
}

export interface DaemonStatus {
  ok?: boolean
  error?: string
  data?: {
    running: boolean
    pid: number
    rooms: Record<string, RoomStatus>
  }
}

// ===================== API 函数 =====================

export function fetchSummary() {
  return request.get<Summary>({ url: '/api/summary' })
}

export function fetchRooms() {
  return request.get<Room[]>({ url: '/api/rooms' })
}

export function lookupRoom(query: string) {
  return request.get<LookupResult[]>({ url: `/api/rooms/lookup?q=${encodeURIComponent(query)}` })
}

export function addRoom(roomId: string, name: string) {
  return request.post<{ ok: boolean; message?: string }>({
    url: '/api/rooms/add',
    data: { room_id: roomId, name }
  })
}

export function pauseRoom(roomId: string) {
  return request.post<{ ok: boolean }>({ url: '/api/rooms/pause', data: { room_id: roomId } })
}

export function resumeRoom(roomId: string) {
  return request.post<{ ok: boolean }>({ url: '/api/rooms/resume', data: { room_id: roomId } })
}

export function removeRoom(roomId: string) {
  return request.post<{ ok: boolean }>({
    url: '/api/rooms/remove',
    data: { room_id: roomId, delete_data: true }
  })
}

export function fetchSessions(hostId: string) {
  return request.get<Session[]>({ url: `/api/hosts/${hostId}/sessions` })
}

export function deleteSession(sessionId: string) {
  return request.post<{ ok: boolean }>({ url: `/api/sessions/${sessionId}/delete` })
}

export function getReportUrl(sessionId: string): string {
  return `/api/sessions/${sessionId}/report`
}

export function fetchSessionDetail(sessionId: string) {
  return request.get<SessionDetail>({ url: `/api/sessions/${sessionId}/detail` })
}

export function fetchDanmaku(sessionId: string, limit = 99999) {
  return request.get<DanmakuFull>({
    url: `/api/sessions/${sessionId}/danmaku?limit=${limit}`
  })
}

export function fetchStreamers() {
  return request.get<Streamer[]>({ url: '/api/streamers' })
}

export function anonymousLookup(query: string, streamerId?: string, sessionId?: string) {
  const params = new URLSearchParams({ q: query })
  if (streamerId) params.set('streamer_id', streamerId)
  if (sessionId) params.set('session_id', sessionId)
  return request.get<AnonymousLookup[]>({ url: `/api/anonymous-lookup?${params.toString()}` })
}

export function fetchUser(secUid: string) {
  return request.get<UserProfile>({ url: `/api/users/${secUid}` })
}

export function searchUser(query: string) {
  return request.get<UserProfile[]>({
    url: `/api/users/search?q=${encodeURIComponent(query)}`
  })
}

export function fetchTrends(range = '7d', group = 'day') {
  return request.get<Trends>({ url: `/api/trends?range=${range}&group=${group}` })
}

// ===================== Overview（总览页聚合） =====================

export interface OverviewData {
  summary: {
    total_sessions: number
    total_likes: number
    total_danmaku: number
    unique_users: number
    peak_online: number
    total_gifts: number
    total_diamonds: number
    offline_count: number
  }
  streamers: {
    id: number
    name: string
    avatar?: string
    sessions: number
    diamonds: number
    danmaku: number
    peak_online: number
  }[]
  topGifts: { name: string; icon?: string; count: number; diamonds: number }[]
  topUsers: {
    nickname: string
    avatar?: string
    sec_uid: string
    diamonds: number
    count: number
  }[]
  topDanmaku: { nickname: string; avatar?: string; count: number }[]
  peakSessions: {
    id: number
    room_title: string | null
    online_peak: number
    start_time: string
    streamer: string | null
    streamer_avatar?: string
  }[]
  recentSessions: {
    id: number
    room_title: string | null
    streamer: string | null
    streamer_avatar?: string
    start_time: string
    online_peak: number
    diamonds: number
    danmaku: number
    users: number
  }[]
}

export function fetchOverview() {
  return request.get<OverviewData>({ url: '/api/overview' })
}

export function fetchStatus() {
  return request.get<DaemonStatus>({ url: '/api/status' })
}
