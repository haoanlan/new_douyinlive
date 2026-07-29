# new_douyinlive — 抖音直播监控与数据看板

一个基于 Node.js 的抖音直播**多房间监控 + 数据分析看板**。它封装上游 Go 版 [`jwwsjlm/douyinLive`](https://github.com/jwwsjlm/douyinLive) 抓取弹幕/礼物，落地到 SQLite，并通过 Vue 3 前端提供场次管理、礼物排行、弹幕词云、用户画像、趋势分析和图片报告推送。

> 本项目面向**已开播直播间的数据记录与回看分析**，不是录播工具，不下载视频流。

---

## 架构

三个组件协作运行：

```
┌──────────────────────┐    WebSocket     ┌──────────────────────┐
│  Go 抓取代理          │  ws://127.0.0.1  │  monitor.js 守护进程  │
│  douyinLive-linux     │  :1088/ws/<room> │  (多房间常驻)          │
│  (上游, 端口 1088)     │ ◄────────────── │  解析/落地/通知/报告    │
└──────────────────────┘                  └─────────┬────────────┘
                                                    │ better-sqlite3
                                                    ▼
                                          ┌──────────────────┐
                                          │  db/douyin.db     │
                                          └──────────────────┘
                                                    ▲
┌──────────────────────┐  HTTP (port 9871) ┌────────┴───────────┐
│  浏览器 Vue 3 看板     │ ◄──────────────► │  web-dashboard.js   │
│  (frontend/dist)      │   /api/* + 静态   │  REST API + SPA     │
└──────────────────────┘                  └────────────────────┘
```

1. **Go 抓取代理** — 上游 `douyinLive` 二进制（`douyinLive-linux-amd64`），监听 `1088`，对外暴露 `ws://127.0.0.1:1088/ws/<房间标识>`，负责连接抖音直播间消息流并把 protobuf 消息转成 JSON。
2. **`monitor.js`** — Node.js 守护进程。管理 Go 代理生命周期（崩溃自动重启），为每个房间维持 WebSocket 连接，解析消息、去重、按场次写入 SQLite，并在开播/下播时触发飞书通知与图片报告。通过 Unix socket（`monitor.sock`）接收控制命令。
3. **`web-dashboard.js`** — Node.js HTTP 服务（默认端口 `9871`）。托管 Vue 前端静态文件，并提供带 Token 认证、gzip 压缩、CSV 导出的 REST API。

---

## 功能

- **多房间常驻监控**：一次配置多个直播间，开播自动开始录制，下播自动结束场次
- **全量消息记录**：弹幕、礼物、点赞、进场、关注、社交、在线人数、飘屏、星守护等
- **礼物智能处理**：连击(combo)去重、融合礼物价格匹配、固定价格表、星守护折算
- **SQLite 落地**：WAL 模式 + 索引，支持大批量弹幕/礼物写入
- **Vue 3 看板**：房间列表、场次历史、单场详情（礼物排行、弹幕词云、时间线、团播主播排名）
- **用户画像**：按 `sec_uid` 聚合送礼历史、活跃时段、送礼风格、常看主播；匿名昵称反查真实资料
- **趋势分析**：7/30/90 天的礼物钻石、弹幕、在线峰值趋势（按日/周/月聚合）
- **CSV 导出**：礼物、弹幕、场次汇总一键导出（带 BOM 兼容 Excel）
- **图片报告**：用 Playwright 把 HTML 报告渲染成 PNG，下播自动生成并通过飞书推送
- **飞书通知**：开播提醒、下播图片报告，走飞书 Open API（tenant_access_token）
- **健壮性**：session 快照防崩溃丢数据、Go 代理崩溃指数退避重启、WebSocket 指数退避重连、日志轮转
- **安全**：仪表盘 Token 认证、敏感文件访问拦截、目录遍历防护

---

## 快速开始

### 环境要求

- **Linux** 服务器（部署脚本路径为 `/opt/data/douyin-monitor`，Go 二进制为 `douyinLive-linux-amd64`）
- **Node.js** ≥ 18（使用了内置 `fetch`）
- **上游 Go 二进制** `douyinLive-linux-amd64` 放在项目根目录
- **Playwright Chromium**（仅图片报告功能需要）：`npx playwright install chromium`
- 依赖：`better-sqlite3`、`playwright`、`ws`、`xlsx`（`npm install`）

### 配置

```bash
cp config.example.yaml config.yaml      # Go 代理 + 仪表盘配置
```

编辑 `config.yaml`，至少设置：

- `dashboard.token`：仪表盘访问令牌（**强烈建议设置**，留空则无认证）
- `cookie.douyin`：抖音 Cookie（可选，不填先跑，被限流再补）

监控房间列表写在 `runtime-config.json`（由看板动态维护，也可手动编辑）：

```json
{
  "rooms": [
    { "id": "516466932480", "name": "主播名", "enabled": true }
  ],
  "check_interval_seconds": 30,
  "reconnect_delay_seconds": 10,
  "save_json": false,
  "feishu": { "open_id": "" }
}
```

飞书推送需在 `.env` 配置（参考 `feishu-send.js`）：

```
FEISHU_APP_ID=cli_xxx
FEISHU_APP_SECRET=xxx
```

### 启动

```bash
bash start.sh
```

等价于手动启动两个进程：

```bash
node monitor.js --daemon        # 守护进程（多房间监控 + 落库 + 通知）
node web-dashboard.js           # 仪表盘 HTTP 服务
```

查看状态：

```bash
bash status.sh                  # 进程/房间/数据库统计
node monitor.js status          # 命令行状态
```

访问仪表盘：`http://127.0.0.1:9871`（设置了 token 则用 `http://127.0.0.1:9871/?token=xxx`）

### 前端开发

```bash
cd frontend
npm install
npm run dev          # Vite 开发服务器（代理到后端 API）
npm run build        # 构建到 frontend/dist，由 web-dashboard.js 托管
```

---

## 配置项说明

### `config.yaml`

| 配置项 | 说明 | 默认值 |
| --- | --- | --- |
| `port` | Go 代理 WebSocket 端口 | `1088` |
| `unknown` | 是否打印未知消息类型 | `false` |
| `log.level` | Go 代理日志级别 | `info` |
| `sign.provider` | WebSocket 签名来源（`local`/`tikhub`） | `local` |
| `tikhub.key` | TikHub API Key（仅 `tikhub` 模式） | — |
| `monitor.poll_interval` | 未开播时检查间隔 | `15s` |
| `monitor.notify_interval` | 未开播状态推送间隔 | `30s` |
| `cookie.douyin` | 默认抖音 Cookie | — |
| `cookie.rooms` | 按房间单独配置 Cookie | — |
| `dashboard.token` | 仪表盘访问令牌 | — |
| `dashboard.host` | 仪表盘绑定地址 | `127.0.0.1` |
| `dashboard.port` | 仪表盘端口 | `9871` |

### 环境变量（优先级高于 config.yaml）

| 变量 | 作用 |
| --- | --- |
| `DASHBOARD_TOKEN` | 仪表盘令牌 |
| `DASHBOARD_HOST` | 仪表盘绑定地址 |
| `DASHBOARD_PORT` | 仪表盘端口 |
| `DB_SQLITE_PATH` | SQLite 数据库路径（默认 `db/douyin.db`） |
| `FEISHU_APP_ID` / `FEISHU_APP_SECRET` | 飞书应用凭证 |

### `runtime-config.json`

监控守护进程的运行时配置，支持 `fs.watch` 热加载：

- `rooms[]`：监控房间列表，每项 `{ id, name, enabled }`
- `check_interval_seconds`：状态检查间隔
- `reconnect_delay_seconds`：重连基础延迟（指数退避，上限 60s）
- `save_json`：是否同时保存 JSON 场次文件
- `feishu.open_id`：飞书通知接收人

---

## 项目结构

```text
new_douyinlive/
├── monitor.js                # 守护进程：多房间监控、消息解析、落库、通知、报告
├── web-dashboard.js          # 仪表盘 HTTP 服务（静态托管 + REST API）
├── db-sqlite.js              # SQLite 数据层（建表、CRUD、排行、词云）
├── report-image.js           # 图片报告生成（Playwright 渲染 HTML → PNG）
├── feishu-send.js            # 飞书 Open API 消息/图片推送
├── douyin-user.js            # 抖音用户资料查询（按 sec_uid）
├── config.example.yaml       # 配置示例
├── runtime-config.json       # 监控房间运行时配置（热加载）
├── start.sh / status.sh      # 启动 / 状态脚本
├── lib/
│   ├── config-reader.js      # config.yaml 统一解析（带 mtime 缓存）
│   ├── douyin-api.js         # 抖音 API 查询（直播间/用户信息）
│   ├── avatar-utils.js       # 头像查询（按 sec_uid / 昵称）
│   ├── gift-utils.js         # 礼物连击去重（comboDedupGifts）
│   └── routes/               # 仪表盘 API 路由（按域拆分）
│       ├── rooms.js          # 房间增删/暂停/恢复/查询
│       ├── sessions.js       # 场次列表/详情/删除/报告
│       ├── detail.js         # 单场完整详情（排行/词云/时间线/团播）
│       ├── gifts.js          # 礼物排行（全量/按场/按类型）
│       ├── users.js          # 用户画像/匿名反查
│       └── misc.js           # 趋势/搜索/导出/总览/状态
├── frontend/                 # Vue 3 + TS + Vite + vue-router + Pinia
│   └── src/
│       ├── views/            # HomeView / SessionsView / DetailView
│       ├── components/       # AppLayout / AvatarFallback
│       ├── composables/      # useConfirm / useToast / useSearch / useProfile ...
│       ├── stores/app.ts     # Pinia 全局状态
│       └── router/index.ts   # 路由
├── test/                     # node:test 单元测试
├── docs/websocket-fields-ref.md  # douyinLive WebSocket 消息字段参考
└── db/douyin.db              # SQLite 数据库（运行时生成）
```

---

## API 速览

所有 `/api/*` 接口需携带 Token（`?token=xxx` 或 `Authorization: Bearer xxx`），返回 JSON 支持 gzip。

### 房间
- `GET  /api/rooms` — 房间列表（含 daemon 实时连接/录制状态）
- `GET  /api/rooms/lookup?room_id=xxx` — 按房间号/抖音号查询主播信息
- `POST /api/rooms/add` `{room_id, name}` — 添加监控房间
- `POST /api/rooms/remove` `{room_id, delete_data}` — 移除房间（可选删数据）
- `POST /api/rooms/pause` `{room_id}` — 暂停房间
- `POST /api/rooms/resume` `{room_id}` — 恢复房间

### 场次
- `GET  /api/streamers` / `GET /api/hosts` — 主播列表
- `GET  /api/sessions?streamer_id=` — 场次列表
- `GET  /api/hosts/<id>/sessions` — 某主播场次聚合（含去重钻石/弹幕数）
- `GET  /api/sessions/<id>` — 场次基础信息
- `GET  /api/sessions/<id>/detail` — 单场完整详情（礼物排行/明细/团播排名/词云/时间线）
- `GET  /api/sessions/<id>/gifts` / `/danmaku` / `/online` — 分页明细
- `GET  /api/sessions/<id>/anchor-gifts?anchor=` — 团播某主播礼物明细
- `GET  /api/sessions/<id>/report` — 场次报告图片（自动生成）
- `POST /api/sessions/<id>/delete` — 删除场次（级联删数据）

### 礼物
- `GET  /api/gifts/ranking?session_id=&period=&limit=` — 礼物用户排行（全量/按场/按时段）
- `GET  /api/gifts/by-type?session_id=&limit=` — 礼物类型排行

### 用户
- `GET  /api/users/search?q=` — 按昵称搜索用户
- `GET  /api/anonymous-lookup?q=&streamer_id=` — 匿名反查（昵称 → sec_uid → API 真实资料）
- `GET  /api/users/<sec_uid>` — 用户画像（送礼历史/活跃时段/风格/常看主播）

### 其他
- `GET  /api/summary` — 总览统计
- `GET  /api/trends?range=7d&group=day` — 趋势数据
- `GET  /api/danmaku/search?q=` — 全局弹幕搜索
- `GET  /api/status` — 实时监控状态（来自 daemon 控制 socket）
- `GET  /api/export/gifts|danmaku|sessions` — CSV 导出
- `POST /api/report/generate` `{session_id}` — 生成图片报告

---

## 数据模型

SQLite（`db/douyin.db`，WAL 模式）主要表：

- `streamers` — 主播（name, room_id, avatar, sec_uid）
- `sessions` — 直播场次（标题/时间/时长/各类统计/在线峰值）
- `danmaku` — 弹幕（昵称/头像/内容/sec_uid/create_time）
- `gifts` — 礼物（送礼人/收礼人/礼物名/钻石/连击/trace_id/icon）
- `members` — 进场记录
- `online_records` — 在线人数时序
- `gift_icons` — 礼物图标库（运行时积累）

礼物统计统一走 `comboDedupGifts` 连击去重后再聚合，避免重复计算钻石。

---

## 工具脚本

| 脚本 | 作用 |
| --- | --- |
| `monitor.js` | 主守护进程，`--daemon` 多房间 / `stop` / `status` / `snapshot` / `report-image` |
| `web-dashboard.js` | 仪表盘服务 |
| `report-image.js` | 生成图片报告，支持 `--user` 生成专属榜单 |
| `feishu-send.js` | 飞书消息/图片发送 |
| `douyin-user.js` | 按 sec_uid 查抖音用户资料 |
| `lib/douyin-api.js` | 抖音 API 查询（直播间/用户，Python spider 移植） |
| `merge-sessions.js` | 合并场次 |
| `thanks-rank.js` | 答谢榜 |
| `query-user-gifts.js` | 查询用户礼物 |
| `sync-gift-icons.js` | 同步礼物图标 |
| `check-fanbadge.js` | 粉丝牌检查 |
| `ws-debug.js` | WebSocket 调试 |

运行测试：

```bash
npm test              # node --test
npm run test:watch    # 监听模式
```

---

## 致谢

- 抓取能力基于上游 Go 项目 [`jwwsjlm/douyinLive`](https://github.com/jwwsjlm/douyinLive)
- 抖音 API 查询参考 [DouYin_Spider](https://github.com/ReaJason/DouYin_Spider)
- 消息字段参考见 `docs/websocket-fields-ref.md`

---

## 许可证

见 [LICENSE](./LICENSE)。
