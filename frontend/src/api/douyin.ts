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
  /** /api/sessions（原始行）返回的是这个字段，而 /api/hosts/:id/sessions 返回 started_at */
  start_time?: string
  end_time?: string
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

/**
 * 主播（= 被监控的直播间），来自 `/api/streamers`。
 *
 * 注意 `id` 是 **streamer 主键**（数字），趋势/场次接口都按它查；
 * `sec_uid` 是真正的抖音 sec_uid（字符串，可能为空），别拿它当 id 用。
 */
export interface Streamer {
  /** streamer 主键 */
  id: number | string
  name: string
  room_id?: string
  avatar?: string | null
  /** 兼容部分调用方读 avatar_url 的写法 */
  avatar_url?: string | null
  /** 该主播有多少场直播（趋势页用来排序/判断可选性） */
  session_count?: number
  /** 真正的抖音 sec_uid（可能为空字符串） */
  sec_uid?: string
  total_gifts?: number
  total_danmaku?: number
  created_at?: string
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

/**
 * 用户画像（对应后端 GET /api/users/{sec_uid} 的真实返回）
 * 注意：字段名必须与后端一致 —— 之前这里写的是一套理想化字段名
 * （fans_count / gift_profile / top_anchors …），后端一个都没返回，
 * 导致画像页除了头像和昵称全是空的。
 */
export interface UserProfile {
  nickname: string
  avatar?: string
  /**
   * 库里出现过的全部名字（按出现次数降序），含抖音自动生成的游客名。
   * generated=true 表示 douxxx / 神秘人… 这类自动生成的名字。
   */
  nicknames?: {
    nickname: string
    count: number
    first?: number
    last?: number
    generated?: boolean
  }[]
  /** 累计钻石 */
  total_diamonds?: number
  /** 累计送礼次数（连击去重后） */
  gift_count?: number
  gift_types_count?: number
  /** 逗号分隔的礼物名串 */
  gift_types?: string
  /** 送礼风格判定，如「重度粉丝（专注型）」 */
  giftStyle?: string
  /** 场均消费钻石 */
  avgPerSession?: number
  /** 活跃高峰时段，如「21:00」 */
  peakHour?: string
  danmakuCount?: number
  /** 弹幕风格标签，如「表情丰富·热情互动」 */
  danmakuStyle?: string
  danmakuSamples?: { content: string; create_time: number | string }[]
  favoriteStreamer?: string
  activeSessionCount?: number
  activeSessions?: {
    id: number
    start_time: string
    end_time: string | null
    streamer_name?: string
    session_diamonds?: number
  }[]
  /** 各小时送礼次数 */
  hourStats?: { hour: string; count: number }[]
  /** 礼物明细（按钻石降序） */
  giftBreakdown?: { gift_name: string; total_diamonds: number; count: number }[]
  /** 常送主播（按钻石降序 top5） */
  topStreamers?: { name: string; diamonds: number; count: number }[]
  /** 常用礼物（按次数降序 top5，含图标） */
  topGiftsByCount?: {
    gift_name: string
    total_diamonds: number
    count: number
    icon_url?: string | null
  }[]
  /** 近期行为（弹幕+送礼合并，按时间倒序） */
  recent_actions?: UserAction[]
  /** 首次/末次送礼时间（毫秒时间戳或原值） */
  firstSeen?: number | string
  lastSeen?: number | string
}

export interface UserAction {
  type: 'danmaku' | 'gift' | 'member'
  content: string
  time: string
  /** 该动作发生在哪个直播间（进场记录靠它写明"进了哪个直播间"） */
  streamer?: string
}

export interface UserSession {
  id: string
  title: string
  date: string
  diamonds?: number
}

// ===================== Trends =====================

/**
 * 旧的「全站总和」趋势。
 * @deprecated 只有时间维度、把所有房间加总，对单个直播间的判断没有意义。
 * 已由 {@link fetchHostTrends} 取代（按房间的每一场给出数据点）。
 */
export interface Trends {
  giftTrend: { date: string; total_diamonds: number; gift_count: number; sender_count: number }[]
  danmakuTrend: { date: string; danmaku_count: number; sender_count: number }[]
  onlineTrend: { date: string; peak_online: number | null }[]
}

/** 一场直播在趋势图上的一个数据点 */
export interface HostTrendPoint {
  sessionId: number
  /** 开播时间，用于 X 轴与区分"一天多场" */
  startAt: string
  /** 是否已结束（未结束的是直播中那场） */
  ended: boolean
  durationMinutes: number
  peakOnline: number
  diamonds: number
  danmaku: number
  gifts: number
  users: number
  likes: number
  members: number
  /** 派生指标：跨场次/跨房间比"效率"时比原始量更有意义 */
  diamondsPerHour: number
  danmakuPerThousand: number
  /** 这一场的预聚合数据是否可信；false 时不应被读成"业绩为 0" */
  hasData: boolean
}

export interface HostTrendSummary {
  sessions: number
  sessionsWithData: number
  avgPeakOnline: number
  maxPeakOnline: number
  avgDiamonds: number
  totalDiamonds: number
  avgDanmaku: number
  totalDanmaku: number
  avgDurationMinutes: number
  avgDiamondsPerHour: number
  avgUsers: number
}

export interface HostTrendSeries {
  hostId: number
  roomId: string
  name: string
  avatar: string | null
  points: HostTrendPoint[]
  summary: HostTrendSummary
  /** 上一个等长周期的汇总，用于判断"涨了还是跌了"；无确定范围时为 null */
  prevSummary: Pick<
    HostTrendSummary,
    'sessions' | 'avgPeakOnline' | 'avgDiamonds' | 'avgDanmaku' | 'avgDurationMinutes'
  > | null
}

export interface HostTrends {
  range: string
  series: HostTrendSeries[]
}

/** 可选的趋势指标 */
export type TrendMetricKey =
  | 'peakOnline'
  | 'diamonds'
  | 'danmaku'
  | 'gifts'
  | 'durationMinutes'
  | 'users'
  | 'diamondsPerHour'
  | 'danmakuPerThousand'

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

/**
 * 房间列表。
 *
 * P0-4：原来没关 showErrorMessage，而本页每 10 秒轮询一次 ——
 * 后端一挂，拦截器就每 10 秒弹一条错误提示，页面无法使用。
 * 读接口统一改为不自动弹窗，由调用方展示持久、可重试的错误态。
 */
export function fetchRooms() {
  return request.get<Room[]>({ url: '/api/rooms', showErrorMessage: false })
}

/** 预览某个房间号的信息（添加房间前确认用，不产生任何副作用） */
export function lookupRoom(roomId: string) {
  return request.get<LookupResult>({
    url: `/api/rooms/lookup?room_id=${encodeURIComponent(roomId)}`,
    // 同样关掉自动提示：调用方已经有自己的失败文案，
    // 否则失败时会「自动提示 + 调用方提示」弹两次
    showErrorMessage: false
  })
}

/**
 * 房间管理这几个写操作统一关掉请求层的自动错误提示（showErrorMessage: false）。
 * 原因：请求层只会按 HTTP 状态码给出「请求失败：HTTP 409」这类通用文案，
 * 而后端返回的 body 里有真正的原因（如「房间 X 已在监控」「监控 worker 未运行」）。
 * 关掉自动提示后，由调用方用 isHttpError(e).data.error 展示真实原因，且不会弹两次。
 */
export function addRoom(roomId: string, name: string, avatar = '') {
  return request.post<{ ok: boolean; message?: string }>({
    url: '/api/rooms/add',
    // 把预览已经查到的昵称/头像一起交给后端落库，
    // 否则添加后卡片只能显示房间号、没有头像（预览查到的东西白查了）
    data: { room_id: roomId, name, avatar },
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

/**
 * 移除房间。
 *
 * `deleteData` 必须由调用方显式传入（原来这里硬编码 `delete_data: true`）——
 * 也就是"删房间"必定连历史数据一起删，而这是**唯一不可逆**的操作，
 * 却长得和普通按钮一样。历史数据（场次/弹幕/礼物/进场）删了无法恢复，
 * 所以把选择权交给调用点，由它在界面上让用户明确决定。
 *
 * @param roomId 房间号
 * @param deleteData true=同时删除该房间的全部历史数据；false=只停止监控、保留数据
 */
export function removeRoom(roomId: string, deleteData: boolean) {
  return request.post<{ ok: boolean }>({
    url: '/api/rooms/remove',
    data: { room_id: roomId, delete_data: deleteData },
    showErrorMessage: false
  })
}

/**
 * 某主播的场次列表。
 * 本页每 15 秒轮询一次，失败必须由页面展示（错误态 + 重试），
 * 不能靠拦截器每 15 秒弹一条 toast（与 P0-4 同一个根因）。
 */
export function fetchSessions(hostId: string) {
  return request.get<Session[]>({
    url: `/api/hosts/${hostId}/sessions`,
    showErrorMessage: false
  })
}

/**
 * 全部场次（用于信息查询页的「场次」筛选：没选直播间时列出所有场次）。
 * 只取最近 300 场 —— 后端 /api/sessions 支持 limit，不传会把全部场次都拉回来。
 */
export function fetchAllSessions() {
  return request.get<Session[]>({ url: '/api/sessions?limit=300', showErrorMessage: false })
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

/**
 * 某场次的弹幕。
 *
 * 注意 limit 会被后端收到 2000（MAX_LIMIT）—— 实测一次拉 5 万条要 19 秒 / 22MB，
 * 主线程还要同步处理 5 万条，页面直接卡死。要看更早的内容请用 `q` 让**服务端**检索。
 *
 * @param limit 单次条数（后端上限 2000）
 * @param q     关键字（同时匹配弹幕内容与昵称），由 SQL 在服务端过滤全量数据
 */
export function fetchDanmaku(sessionId: string, limit = 2000, q = '') {
  const params = new URLSearchParams({ limit: String(limit) })
  if (q) params.set('q', q)
  return request.get<DanmakuFull>({
    url: `/api/sessions/${sessionId}/danmaku?${params.toString()}`
  })
}

export function fetchStreamers() {
  return request.get<Streamer[]>({ url: '/api/streamers', showErrorMessage: false })
}

/**
 * 匿名查询（信息查询页）。
 *
 * 返回的是**对象**（users + 真实规模统计），不是数组 —— 类型原来是 `AnonymousLookup[]`，
 * 导致页面里 `Array.isArray(res) ? res : []` 的分支永远是死代码。
 * 这里也关掉自动错误 toast：页面自己有 QueryErrorState（P0-4 的约定）。
 *
 * @param limit 返回人数上限（后端 clamp 到 [1,500]，默认 100）。每人要查全库 + 调抖音接口，
 *              人数越多越慢；宽泛关键词建议传小一点。
 */
export function anonymousLookup(
  query: string,
  streamerId?: string,
  sessionId?: string,
  limit?: number
) {
  const params = new URLSearchParams({ q: query })
  if (streamerId) params.set('streamer_id', streamerId)
  if (sessionId) params.set('session_id', sessionId)
  if (limit) params.set('limit', String(limit))
  return request.get<AnonymousLookupResponse>({
    url: `/api/anonymous-lookup?${params.toString()}`,
    showErrorMessage: false
  })
}

/** /api/anonymous-lookup 的返回形状 */
export interface AnonymousLookupResponse {
  users: AnonymousLookup[]
  /** 库里真实的匹配人数（不受返回条数上限影响） */
  total_users: number
  /** 库里命中的记录总条数 */
  total_records: number
  /** 无用户标识（无法归到某个人）的记录条数 */
  orphan_records: number
  /** 本次返回的条目数（含无标识条目） */
  returned: number
  /** 本次返回的真实用户数（不含无标识条目） */
  returned_users: number
  limit: number
}

export function fetchUser(secUid: string) {
  return request.get<UserProfile>({ url: `/api/users/${secUid}` })
}

export function searchUser(query: string) {
  return request.get<UserProfile[]>({
    url: `/api/users/search?q=${encodeURIComponent(query)}`
  })
}

/** @deprecated 用 fetchHostTrends 取代（见该函数说明） */
export function fetchTrends(range = '7d', group = 'day') {
  return request.get<Trends>({ url: `/api/trends?range=${range}&group=${group}` })
}

/**
 * 单房间（主播）的**跨场次**趋势。
 *
 * 与旧的 /api/trends 的区别：那个只有时间维度、把所有房间加总，
 * 得到的是"全站总和的日曲线"；这个按**每一场直播**给数据点，
 * 同一房间自己和自己比，才看得出"这次比上次好还是差"。
 *
 * @param hostIds 主播 id 列表。传多个即"多房间对比"，各自作为独立序列。
 * @param range   7d / 30d / 90d / all
 */
export function fetchHostTrends(hostIds: (number | string)[], range = '30d') {
  const hosts = hostIds.join(',')
  return request.get<HostTrends>({
    url: `/api/hosts/trends?hosts=${hosts}&range=${range}`,
    showErrorMessage: false
  })
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
  return request.get<OverviewData>({ url: '/api/overview', showErrorMessage: false })
}

/** 守护进程/房间实时状态。每 10 秒轮询，失败由页面统一展示（P0-3/P0-4）。 */
export function fetchStatus() {
  return request.get<DaemonStatus>({ url: '/api/status', showErrorMessage: false })
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

/** 状态监控页每 8 秒轮询此项，失败由页面展示错误态而非反复弹 toast（P0-3/P0-4）。 */
export function fetchServiceStatus() {
  return request.get<ServiceStatus>({
    url: '/api/service/status',
    showErrorMessage: false
  })
}

export function performServiceAction(action: ServiceAction) {
  return request.post<ServiceActionResult>({ url: '/api/service/action', data: { action } })
}
