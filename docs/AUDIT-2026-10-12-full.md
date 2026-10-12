# 全项目自查报告（2026-10-12）

范围：后端 `web-dashboard.js` + `lib/**`、前端 `frontend/src/**`、UI/深色模式/窄屏、架构与死代码。
方法：4 条独立审计线并行（前端逻辑 / 后端接口契约 / 架构死代码 / UI 一致性），
每条结论都要求给证据（file:line 或实测输出）；**P0 与安全类结论由我逐条复现**后才写进本报告。
本轮已修的 5 项见第 1 节；其余按 P0 / P1 / P2 分级列出，第 5 节是"查过没问题"的清单（避免重复排查）。

标记约定：
- `[自测]` = 我本人复现过（命令/HTTP/浏览器实测）
- `[子代理]` = 审计线报告，含 file:line 证据但未由我逐步复现
- `[存疑]` = 证据不足或已发现是误报，明确标注

---

## 1. 本轮已修复并验证（commit `1f26582`）

| # | 级别 | 问题 | 证据 | 修复与验证 |
|---|---|---|---|---|
| 1 | P0 安全 | 静态服务未认证泄露：`/db/douyin.db-wal`、`/db/douyin.DB`、`/.git/config`、`/.qrlogin-profile/...` 全部 200 | `[自测]` 逐个 HTTP 探测 | 改白名单扩展名 + 拒绝点目录 + 拒 `/db`；**11 项敏感路径全部 403**，`/runtime-config.json` 仍 200，SPA 路由不再被误拦 |
| 2 | P0 | 场次列表「下载报告」必抛 `ReferenceError: getReportUrl is not defined`（`sessions/index.vue:221` 未导入，365/387 在用） | `[自测]` grep + `vue-tsc` | 补 import；`vue-tsc` 中该文件错误清零 |
| 3 | P0 | 「可视化配置」读取失败时抽屉空白仍可保存，会以空 patch 覆盖 `config.yaml`（清空预存 Cookie/API Key/房间 Cookie） | `[自测]` 拦截 GET 复现 | 先取配置再开抽屉 + `save()` 判空与防重入 + 按钮 disabled；**实测失败路径抽屉不打开、按钮 disabled、POST=0** |
| 4 | P1 | 趋势页卸载 `disposeCharts` 必抛 `TypeError: chartEls.forEach is not a function`（`trends:384` 是对象，562 行当数组用） | `[自测]` 浏览器控制台巡检抓到 | 改 `Object.values(...)`；离开该页无报错 |
| 5 | P2 | `db/`（995MB）、`team/`（17.5MB）未被 gitignore，`git add -A` 会吞进版本库 | `[自测]` `git check-ignore` 无匹配 | `.gitignore` 增 `db/`、`team/`、`reports/`、`scripts/tmp-*` |

---

## 2. P0（建议尽快修）

### 2.1 安全（后端）

1. **默认口令 `admin/123456` 仍在生效，且口令是无盐 sha256** `[子代理+自测部分]`
   - 证据：`db-sqlite.js:260-266` 种子里写死；只读查库两行 password 均为 `8d969eef…c6c92`（= `sha256('123456')`）；`lib/routes/auth.js:4` 无盐。
   - 影响：能连到 9871 的人直接拿到完整后台；无盐哈希可彩虹表秒破；admin/guest 同口令哈希相同。
   - 修法：换 bcrypt/scrypt/argon2 + salt；首启强制改密或从环境变量注入；删 guest 种子；加登录失败限速。

2. **高危运维接口只校验"已登录"不校验角色** `[子代理]`
   - 证据：`web-dashboard.js:58-73` 只查 `enabled=1`；`status.js:453`（写 config.yaml）、`status.js:485`（start/stop/restart/restart-proxy，含 `taskkill /F`）、`douyin-login.js:19`（spawn 浏览器扫码）都没有 `requireSuper`（`auth.js:21-32` 只用在账号管理上）。
   - 影响：guest（口令同样是 123456）可停采集、杀代理、覆写 Cookie 配置 — 权限提升。
   - 修法：这些接口全加 `requireSuper`。

3. **Go 代理监听 `0.0.0.0:1088` 且 `api.key` 为空** `[自测]`
   - 证据：`netstat` 显示 `::`/`0.0.0.0:1088 LISTENING`（仪表盘 9871 是 127.0.0.1，正确）；`proxy-config.yaml` 里 `api.key: ""`；子代理实测从局域网 IP 请求 `/api/v1/rooms/.../anchor` → 200 并返回真实主播信息。
   - 影响：同网段任何人可驱动抓取、枚举房间、读主播身份。
   - 修法：代理绑 127.0.0.1 或写 `api.key` + Node 侧带 key；再用防火墙限制入站。

4. **`/api/export/*` 与 `/api/overview` 同步全表查询，阻塞与 HTTP 同进程的采集 worker** `[子代理]`
   - 证据：`misc.js:143-171` 未筛选时 `SELECT *` 无 LIMIT；只读实测 `SELECT * FROM danmaku ORDER BY create_time DESC` = **16.7s / 464,568 行**，gifts = **15.0s / 415,386 行**；`overview.js:24-31,148` 在请求线程里同步扫 415k 行 + JS 连击去重 ≈ **7.4s、heapUsed 541MB**（`web-dashboard.js:293-300` 启动即预热）。
   - 影响：这段时间 WS 心跳/消息处理停摆 → **可能丢弹幕与礼物**；并发几次可 OOM。
   - 修法：导出强制时间范围/session_id + 游标分页流式写；overview 改 SQL 侧预聚合或物化累计表；预热挪到子进程 + 并发守卫。

5. **重启 dashboard 后不会自动拉起监控 worker（stale PID 文件），采集静默停止** `[自测]`
   - 证据：我杀掉并重启 dashboard 后，`/api/service/status` 返回 `pidStale: true, running: false, error: "PID 文件存在但进程已不存在"`，而 dashboard 启动时没有自愈；`/api/status` 一直 503，状态页显示"监控 worker 未运行"。用应用自身 `POST /api/service/action {restart}` 才恢复（新 PID 29400、`controlChannel: true`、6 个房间已连接）。
   - 影响：一次异常退出后，采集会**静默停掉**直到有人手动点"重启"；期间状态页一直报错。
   - 修法：启动时检测 stale PID 并清理 + 自动拉起 worker（或至少在 UI 上给一键恢复入口）。
   - 关联：审计第 2.2 节第 4 条（`stopWorker` 杀不掉代理）。

### 2.2 功能（前端）

6. **窄屏 `el-table` 横向滚动失效：末列操作不可达，且表头与表体错位** `[子代理，证据充分]`
   - 证据：390×844 `#/account/users` 实测 `bodyWrapper` clientWidth=330 / **scrollWidth=330**（无滚动内容），横向滚动条 thumb 0×0，`scrollLeft=200` 后仍是 0 → 「重置密码/删除」不可见不可点；滚轮后 `headerScrollLeft=300` 而 `bodyScrollLeft=0`，`thLefts=[-120,40,…]` vs `tdLefts=[30,190,…]`（表头标注与列内容完全不对应）。`#/douyin/trends` 同因：末列「详情」右边界 980px（390 视口）永远够不到 → **窄屏无法进入场次详情**。
   - 修法：窄屏给表格外层 `overflow-x:auto` + `min-width`，或改用卡片列表；至少 `scrollbar-always-on` 并保证 body/header 同步。

---

## 3. P1

### 后端

1. **`limit=-1` 绕过 2000 上限**：`sessions.js:81-83` 只做 `Math.min(..., MAX_LIMIT)` 没有下限，SQLite 里 `LIMIT -1` = 不限行数；实测 `LIMIT -1` 返回全部 464,568 行 `[子代理]`。修法：`Math.max(1, …)`；`sessions.js:61`、`misc.js:104` 同样收口。
2. **分页参数非数字 → NaN → 500 且回显内部错误**：`sessions.js:27-28` 直接 `parseInt` 入参；`web-dashboard.js:162-166` 把 `e.message` 原样回给客户端 `[子代理]`。修法：统一 `intParam()`（非法 400），catch 只回显白名单文案。
3. **`stopWorker` 杀不掉 Go 代理**：`proxy-process.js:47` 的 `binaryProcess` 是对象字面量（没有 `kill`），`:90-94` 调 `.kill()` 抛 TypeError 被空 catch 吞；`watchTimer`/重启 `setTimeout` 无句柄、从不清理 `[子代理]`（我在重启 dashboard 时实测 1088 代理确实仍存活）。
4. **`db-sqlite.js:388` `require('../../douyin-user')` 解析到项目外**（实测 `D:\desktop\douyin-user.js` 不存在），且整段包在空 catch 里 → 主播头像回填静默失效 `[子代理]`。修法：改 `./douyin-user`，空 catch 加日志。
5. **`init()` 建库不完整**：全项目无 `CREATE TABLE gift_icons`、`streamers` 无 `sec_uid` 列，但 `insertGifts`/`upsertStreamer` 在用（现网库里这两个对象是历史 ALTER 的产物）→ **换机/重建库会丢礼物与场次且不报警** `[子代理，静态交叉验证]`。
6. **删除场次先删库后删报告图**：`sessions.js:333-343` `unlinkSync` 无 try/catch，Windows 占用时抛错 → 前端看到"删除失败"但数据已不可逆删除 `[子代理]`。
7. **`/api/streamers` 返回 `avatar`，趋势页读 `avatar_url`** → 趋势页主播头像恒空 `[子代理]`。修法：前端改读 `avatar`（另见 3.4 节第 11 条类型处）。
8. **WS 消息 catch 里引用 TDZ 变量 `data`**（`connection.js:55-56` vs `:229-232`）→ 非 JSON 帧时抛 `ReferenceError` 掩盖真实错误 `[子代理]`。
9. **CORS 白名单形同虚设**：预检做 origin 判定，但所有实际响应无条件写 `Access-Control-Allow-Origin: *` `[子代理]`。

### 前端逻辑（逻辑类，均 `[子代理]` 且证据到行）

10. **直播中 15s 轮询会覆盖搜索结果**：`detail:800` 不 await 且无 catch，`812-814` 每 15s `refresh()` 用「最新 2000 条」重建 feed，而 `550-560` 又本地过滤 → 列表被悄悄换掉，标题仍显示"全量命中 N 条"；接口失败产生 unhandled rejection。
11. **状态页 `save()` 无防重入** → 双击发两次配置写 + 两次重启代理（本轮已顺带加防重入，见第 1 节第 3 条）。
12. **扫码登录轮询离页不停**：`qrTimer` 只在弹窗关闭时清，`onDeactivated/onUnmounted` 不碰它 → 用返回键离开后仍每 1.5s 轮询，甚至在已保存时自动重启代理。
13. **房间管理 refresh 无请求序号守卫**（10s 轮询 + visibilitychange + onActivated 三处并发）→ 慢响应可把新状态写成旧的；暂停/恢复/移除按钮无 loading/disabled。
14. **KeepAlive 返回不刷新**：趋势页 `onActivated` 只 resize、总览只刷状态 → 离开期间结束的场次不会出现。
15. **`rooms` 页自带一份 `apiErrorMessage`**，与 `utils/douyin-error.ts` 行为不同（不能解 Blob 错误体）→ 同一错误两套文案。

### UI / 可访问性

16. **总览错误告警条浅色对比 2.18:1（需 4.5）**：`el-alert--error` 的标题色 `rgb(250,137,107)` 配 `rgb(255,243,240)`；深色 4.31:1 也偏低 `[子代理+自测]`（我的回归脚本在 worker 挂掉时也报了这一条）。修法：别继承 `--el-color-error-light-*`，改用 `--art-danger` 实色。
17. **用户管理「删除」禁用态深色 2.03:1 / 浅色 1.65:1** `[子代理]`。
18. **状态页长警告被父级 `truncate` 静默截断 140px 且无省略号**（内联元素上 `text-overflow` 不生效）：390 视口下 `scrollWidth=398 / clientWidth=258`，诊断文案读不全 `[子代理+自测]`（我看到的正是"控制通道不可用（monitor.sock…）"被切）。修法：`truncate` 移到内联 span 或改 `line-clamp-2` + `title`。
19. **趋势页 x 轴日期标签窄屏重叠糊在一起** `[子代理，截图]`。修法：窄屏 `axisLabel.interval` 自适应或只显 `MM/DD`。
20. **构建（`pnpm build`）当前过不去**：`build` 先跑 `vue-tsc --noEmit`，实测 **53 条类型错误** `[子代理+自测]`；分布 `api/douyin.ts`×16（`showErrorMessage` 不在 `AxiosRequestConfig` 上）、模板组件（art-search-bar×10、art-form×7、art-table、SidebarSubmenu、`utils/http/index.ts:52`）、`user-manage`×5、`trends`×4、`profile`×4、`status`×2、`detail`×2、`router/index.ts`×2。这不是本次改动引入的（改动前就红）。修法：先定义 `DouyinRequestConfig extends AxiosRequestConfig`（消 16 条），再逐个收口。

---

## 4. P2（清理与打磨，按类归并）

**架构 / 死代码** `[子代理]`
1. 36 个 core 组件在模板中零引用（判据：kebab + Pascal 全局搜标签名；自动按需引入不影响该判据）。含全部图表封装（art-bar/line/ring/radar/map/scatter/k-line/h-bar/dual-bar）、art-stats-card、art-*-card、art-table、art-form、art-search-bar、art-wang-editor、art-video-player、art-cutter-img、art-excel-*、art-screen-lock 等。建议分"模板基线保留 / 本项目删除"两档处理。
2. `one-dark-pro.scss` 零引用（81 行 highlight.js 主题永不生效）。
3. `.mon-chip` 系列样式（`douyin-motion.scss:335-356`）已无模板引用，但 `scripts/ui-audit-dark.js:253` 还在按它取色 → 取到 null，误导后续回归。
4. 19 个僵尸路由（后端实现、前端无调用方），其中 `/api/export/*`、`/api/trends`、`/api/gifts/ranking`、`/api/overview/warmup` 都是第 2.1.4 节那类全表同步重查询 = 无人使用的 DoS 面。
5. 重复实现：HTML 转义 3 份（`format.ts:7`、`douyin-emoji.ts:292`、`rooms:478`，其中 `format.ts` 那份零调用）；时间格式化 profile/search 各一份；`apiErrorMessage` 两份；"参与场次/累计钻石"口径在 rooms/sessions（`COUNT(*)`）、users（`COUNT(DISTINCT session_id)`）、前端兜底（数组长度）三处不同。
6. `package.json` 两条脚本指向不存在目标：`clean:dev` → `frontend/scripts/clean-dev.ts`（无该目录）、`prepare` → `husky`（无 `.husky`）。
7. `vite.config.ts` 死别名 `@icons`/`@stores`（全项目 0 命中）；`resolvePath` 在 `"type":"module"` 下用 `__dirname`（当前未走到，属定时炸弹）。
8. `optimizeDeps.include` 预构建 `xlsx/xgplayer/crypto-js/file-saver/vue-img-cutter` —— 只有第 1 条那些死组件用。

**前后端契约** `[子代理]`
9. `api/douyin.ts:205-211` 的 `AnonymousLookup` 声明 `db_names/actions/streamer_name`，后端一个都不返回（真实是 `db_nicknames/nickname_stats/recent/...`）→ 类型过期，业务页因此大量 `any`。
10. `Session.started_at/ended_at` 声明成 `number`，实际是 TEXT 日期（靠 `fmtTime` 宽松解析碰巧正确）。
11. `/api/service/status` 声明的 `nameToId` 后端不返回（当前无消费者，暂不炸）。
12. `/api/role/list`、`/api/v3/system/menus` 前端有调用、后端不存在（后者只在 `VITE_ACCESS_MODE=backend` 分支，实际两个 env 都是 `frontend`，当前不触发）。

**配置 / 运维** `[子代理]`
13. `config.yaml` 的 `dashboard.username/password/token` 是死配置（认证实际走 DB）；启动告警"未设置 DASHBOARD_TOKEN，仪表盘无认证保护"与事实不符（实测未登录 `401`）。
14. 嵌入模式下 `lifecycle.js:176` 把**仪表盘自身 PID** 写进 `monitor.pid` → `node monitor.js stop` 会关掉整个后台。
15. `frontend/.env.production` 的 `VITE_API_URL=https://m1.apifoxmock.com/...`（模板基线遗留，已被 git 跟踪）。**影响范围已核实**：只影响模板遗留的 `@/utils/http`（`api/system-manage.ts`）；抖in 业务层 `api/douyin-http.ts:12-16` 硬编码 `baseURL: '/'`，生产构建仍打本地后端 —— 不会"上线全空"，但建议改成同源或移出仓库。
16. 每请求重新 `prepare` 同一条 SQL（`web-dashboard.js:65`、`auth.js:203`、`users.js:331`、`detail.js:105`）；`sendError` 不 await 异步 `sendJSON`；`bodyParse` 无 `aborted/error` 收敛（半途断开的 POST 留下悬挂 promise）。

**UI 打磨** `[子代理]`
17. 小于 12px 的正文：`.mon-kv__label` 11px、榜单日期与名次徽标 10.5px（本项目 Tailwind 基准 14px，`text-xs` = 10.5px）。建议 ≥11.5px 或加 `font-medium`。
18. 主按钮圆角两套（detail/rooms 为 10px，status/search 为 6px）。
19. 同一张榜卡内数值口径混用（第 1 行 `5.00万`，其余 `8,400 / 6,000`）。
20. 深色 404 插图海军蓝块 2.4:1 几乎融进纯黑底（`theme-svg/index.vue:35-43` 映射到 `primary-dark-2`）。
21. 深色下仍写死白色焦点环 `0 0 0 2px #fff`（`douyin-motion.scss:54`、`rooms:857`、`detail:854`、`sessions:548`）。
22. 紧凑行高标题（`leading-none` 使 30px 字号配 30px 行高）。
23. 状态监控深色次要文字 3.26:1。
24. 表格可横滚时无任何可见提示（滚动条 thumb 0×0）。

---

## 5. 已确认没问题（查过，不必重复排查）

- **SQL 注入**：逐条核查所有拼接 SQL，无可注入点（`${where}` 只来自字面量；`IN (?,?)` 用占位符 + `Number()`；LIKE 通配符已转义 `ESCAPE '\'`）。`users.js:86` 的 `LIMIT ${...}` 经 `Number()` 且调用点固定，当前不可注入。
- **路径穿越**：`/../config.yaml`、`/..%2f`、`/%2e%2e/`、`/db/../config.yaml` 实测全部 403（`path.resolve` + `startsWith` 生效）。本轮修的是同目录白名单缺失，不是穿越。
- **命令注入**：所有 `child_process` 调用点无用户输入拼接（`spawn` 用参数数组、`execFile` 无 shell）。
- **鉴权覆盖面**：未带 token 的 `/api/summary`、`/api/overview` 实测 401；只有 `/api/auth/login` 免认证。
- **令牌实现**：HMAC-SHA256 按进程签发 + `timingSafeEqual` + 12h TTL（旧的 `base64(用户名:时间戳)` 可伪造问题已修）。
- **监听地址**：仪表盘实测 `127.0.0.1:9871`（正确）；暴露只有 Go 代理 1088。
- **数据库单例 / WAL / 外键级联**：`getDb()` 惰性单例；`journal_mode=WAL`、`foreign_keys=ON`；删除场次靠 CASCADE 连带清理，顺序正确。
- **worker 侧定时器**：`lifecycle.js:44-46` 清理并置 null 三个 interval，可重复调用；`connection.js:281-286` 重连排队期二次校验，"删除房间不复活"正确。
- **进程级兜底与优雅退出**：`unhandledRejection`/`uncaughtException` 均注册；shutdown 先停 worker 再关 server，有 3s `unref` 兜底且幂等；`res.headersSent || writableEnded` 守卫修掉了"响应后再追加 404"。
- **前端 loading 初值与竞态**：status/search 用 `ref(false)`；其余页在 finally 复位不会永久转圈；search 有 `searchSeq/sessionSeq` 序号守卫；sessions 切主播有 watch 重置。
- **路由兜底**：有 404 catch-all；缺参数的 `/douyin/detail` 走 404；无 hostId 的场次页有引导卡。
- **危险操作确认**：移除房间（含删历史数据勾选）、暂停、删场次（单个/批量）、重启代理/全部服务都有二次确认。（例外：抽屉里的"保存并重启代理"绕过了 `confirmDangerous` —— 见 P2 待办。）
- **XSS**：`emojiHtml` 先转义再替换表情代码，`detail:329` 也显式转义，未发现注入路径。
- **死文件**：`frontend/src/views/**` 18 个 `.vue` 全部可达（路由 + 菜单同源）。
- **`dy-*` 类**：对 51 个样式文件里的 `dy-*` 逐个反查，**没有死样式**；模板里用到但全局未定义的 `dy-*` 均由各页 scoped 样式提供，属正常分层。
- **深色模式**：9 个页面 × 3 个视口逐页采样对比度**零不达标**；无写死浅底；弹窗/抽屉/图表深色正常。
- **窄屏正向项**：页面级横向溢出 0；无嵌套滚动；无竖排单字文本；无弹窗超视口；空态/加载态/错误态组件同源一致。
- **一致性正向项**：统计卡统一 80px 高/16px 圆角/数值 20px/标签 12px；卡片与工具条统一 16px 圆角 + 20px 内边距；页面主标题统一 `text-[20px] font-semibold`。
- **前端无硬编码本机绝对路径**；抖音视图无 `console.log` 残留；无 TODO/FIXME 型技术债（唯一 TODO 在模板的 register 页）。

### 已发现是误报

- 「中文注释文件编码错乱（GBK 当 UTF-8）」：`.gitignore` 前 4 字节实测 `35,32,230,149` —— `0xE6` 是 UTF-8 三字节序列开头，文件本身是合法 UTF-8，mojibake 是读取端编码造成的显示假象，无需处理。

---

## 6. 建议的修复顺序

1. **安全三件套**（半小时级）：`requireSuper` 加到 `/api/service/*` 与 `/api/douyin/qrlogin/*`；Go 代理绑 127.0.0.1（或写入 `api.key`）；口令改 bcrypt + 首启强制改密。
2. **采集可靠性**（1 小时级）：dashboard 启动清理 stale PID 并自动拉起 worker；`stopWorker` 真正杀掉代理 + 清理定时器；`init()` 补 `gift_icons` 表与 `streamers.sec_uid` 列。
3. **窄屏表格不可达**（1–2 小时）：用户管理 + 趋势明细表，窄屏改整行可点或加横滚容器。
4. **重查询与导出**（半天级）：导出分页 + 并发闸门；overview 预聚合/挪子进程。
5. **前端逻辑四条**（半天级）：详情轮询覆盖搜索、扫码轮询离页、房间刷新竞态、KeepAlive 不刷新。
6. **类型与构建**（1 天级）：`DouyinRequestConfig` 消 16 条 → 逐个收口 53 条类型错误 → 把 `type-check` 纳入提交前必过。
7. **清理类**（随时）：僵尸路由、死组件/死样式、重复实现、脚本与别名、`.env.production`、仓库卫生。
8. **UI 打磨**（随时）：告警条/禁用按钮对比度、长警告截断、x 轴标签重叠、圆角与数值口径统一、深色焦点环与 404 插图。
