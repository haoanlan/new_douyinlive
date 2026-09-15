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
  id?: number | null
  room_id: string
  name: string
  avatar?: string
  session_count?: number
  total_likes?: number
  last_session_time?: string | null
  enabled: boolean
  connected: boolean
  recording: boolean
  /** 代理对直播状态的判定：true=直播中 / false=未开播 / null=上游尚未确认 */
  liveStatus?: boolean | null
  /**
   * 代理对「本次连接」的状态判定码：
   * ROOM_ONLINE / ROOM_OFFLINE / ROOM_ENDED / ROOM_STATUS_UNKNOWN，null = 刚连上还没结论
   */
  statusCode?: string | null
  /** 直播间标题 */
  roomTitle?: string
  /** true = 配置里已添加但 streamers 表还没记录，主播名仍在解析中 */
  pending?: boolean
  /** 运行状态来源：memory / socket / log */
  statusSource?: string
  /** 前端本地标记：恢复/添加后等待代理确认开播的过渡态 */
  _connecting?: boolean
}

/** 「添加房间」预览查询的返回（后端 /api/rooms/lookup 返回单个对象） */
export interface LookupResult {
  ok: boolean
  room_id: string
  real_room_id?: string
  /** 主播昵称（可能为空：未开播且本地库里没有该房间） */
  nickname: string
  avatar: string
  room_title: string
  is_live: boolean
  /** online=直播中 / offline=未开播 / unknown=上游暂时无法确认 */
  room_status: 'online' | 'offline' | 'unknown'
  /** 是否能确认该房间存在 */
  has_room: boolean
  /** 是否已经在监控列表里 */
  already_monitored: boolean
  /** 昵称来源，便于页面提示信息可信度 */
  name_source: 'proxy' | 'db' | 'douyin-api' | 'search' | 'none'
  unique_id?: string
  sec_uid?: string
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

/** 预览某个房间号的信息（添加房间前确认用，不产生任何副作用） */
export function lookupRoom(roomId: string) {
  return request.get<LookupResult>({
    url: `/api/rooms/lookup?room_id=${encodeURIComponent(roomId)}`
  })
}

/**
 * 房间管理这几个写操作统一关掉请求层的自动错误提示（showErrorMessage: false）。
 * 原因：请求层只会按 HTTP 状态码给出「请求失败：HTTP 409」这类通用文案，
 * 而后端返回的 body 里有真正的原因（如「房间 X 已在监控」「监控 worker 未运行」）。
 * 关掉自动提示后，由调用方用 isHttpError(e).data.error 展示真实原因，且不会弹两次。
 */
export function addRoom(roomId: string, name: string) {
  return request.post<{ ok: boolean; message?: string }>({
    url: '/api/rooms/add',
    data: { room_id: roomId, name },
    showErrorMessage: false
  })
}

export function pauseRoom(roomId: string) {
  return request.post<{ ok: boolean }>({
    url: '/api/rooms/pause',
    data: { room_id: roomId },
    showErrorMessage: false
  })
}

export function resumeRoom(roomId: string) {
  return request.post<{ ok: boolean }>({
    url: '/api/rooms/resume',
    data: { room_id: roomId },
    showErrorMessage: false
  })
}

export function removeRoom(roomId: string) {
  return request.post<{ ok: boolean }>({
    url: '/api/rooms/remove',
    data: { room_id: roomId, delete_data: true },
    showErrorMessage: false
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

// ===================== 服务状态（Go 代理 / 守护进程 / WS / 一键启停） =====================

export interface ServiceIssue {
  level: 'error' | 'warn'
  text: string
}

export interface ServiceStatus {
  ok: boolean
  checkedAt: number
  platform: string
  proxy: {
    port: number
    reachable: boolean
    healthy: boolean
    health: {
      status?: string
      tag?: string
      commit?: string
      signProvider?: string
    } | null
    wsProbe: { upgraded: boolean; status?: number; error?: string } | null
    binaryName: string
    binaryPath: string | null
    binaryExists: boolean
    foreignBinary: string | null
    candidates: string[]
  }
  daemon: {
    pid: number | null
    pidFile: number | null
    pidStale: boolean
    running: boolean
    responsive: boolean
    controlChannel: boolean
    error: string | null
    data: DaemonStatus['data'] | null
  }
  ws: {
    rooms: number
    connected: number
    recording: number
    live: number
    connectedIds: string[]
    /** socket = 来自控制通道；log = 控制通道不可用时取自监控日志 */
    source: 'socket' | 'log' | 'none'
    states: {
      roomId: string
      name: string
      connected: boolean | null
      recording: boolean | null
      liveStatus: boolean | null
      statusCode: string | null
      title: string | null
    }[]
  }
  checks: {
    binary: boolean
    configYaml: boolean
    runtimeConfig: boolean
    cookie: boolean
  }
  /** 已启用监控的房间数（来自 runtime-config.json） */
  configuredRooms: number
  /** 数据库里登记的房间总数（「房间管理」页看到的就是这些） */
  totalRooms: number
  /** 房间名 → 房间号 */
  nameToId: Record<string, string>
  issues: ServiceIssue[]
  logLines: { src: 'monitor' | 'proxy' | 'daemon'; text: string }[]
}

export interface ServiceActionResult {
  ok: boolean
  message?: string
  error?: string
  pid?: number
  alreadyRunning?: boolean
  logLines?: string[]
}

export type ServiceAction = 'start' | 'stop' | 'restart' | 'start-proxy' | 'restart-proxy'

export function fetchServiceStatus() {
  return request.get<ServiceStatus>({ url: '/api/service/status' })
}

export function performServiceAction(action: ServiceAction) {
  return request.post<ServiceActionResult>({ url: '/api/service/action', data: { action } })
}
