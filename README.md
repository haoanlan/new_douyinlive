# 🎥 douyin-live — 抖音直播数据采集与可视化看板

> 🤖 抖音直播间多房间数据采集与可视化分析工具。后台守护进程持续运行，自动检测开播/下播，采集弹幕/礼物/进场数据落地 SQLite，并通过 Vue 3 Web 看板提供场次管理、礼物排行、用户画像、趋势分析与图片报告推送。
>
> **⚠️ 本项目仅供学习和研究使用，请勿用于任何商业或非法用途。使用者应遵守相关法律法规及平台规则。**

[![Node](https://img.shields.io/badge/node-%3E%3D18-brightgreen)](https://nodejs.org)
[![Platform](https://img.shields.io/badge/platform-linux%20%7C%20amd64-blue)](#)
[![Vue](https://img.shields.io/badge/vue-3-42b883)](#)
[![SQLite](https://img.shields.io/badge/sqlite-better--sqlite3-003b57)](#)
[![License](https://img.shields.io/badge/license-MIT-green)](./LICENSE)

---

## 功能

- **多房间实时监控** — 一次配置多个直播间，WebSocket 连接 douyinLive 代理，监听弹幕/礼物/进场/在线人数
- **自动录制** — 检测到开播自动开始记录，下播 30 秒确认后自动保存场次
- **Web 看板** — Vue 3 + vue-router + Pinia 单页应用，房间列表 / 场次历史 / 单场详情（礼物排行、弹幕词云、时间线、团播主播排名）
- **数据持久化** — SQLite（WAL 模式 + 索引），弹幕、礼物、进场、在线人数完整记录
- **图片报告** — Playwright 截图生成可视化直播报告，下播自动生成
- **飞书推送** — 开播提醒 + 下播报告通过飞书 Open API（tenant_access_token）自动推送
- **用户画像** — 按 sec_uid 聚合送礼历史、活跃时段、送礼风格；匿名昵称反查真实资料
- **连击去重** — 智能识别抖音礼物连击帧，去重后统计真实送礼数据
- **趋势分析** — 7/30/90 天礼物钻石、弹幕、在线峰值趋势（按日/周/月聚合）
- **CSV 导出** — 礼物、弹幕、场次汇总一键导出（带 BOM 兼容 Excel）
- **任意切换房间** — 看板内增删房间，或改配置重启即可切换监控目标

## 架构

```
抖音直播间 ←WebSocket→ douyinLive代理(Go二进制, 1088端口)
                               ↓ ws://127.0.0.1:1088/ws/<room>
                    monitor.js (常驻守护进程, 多房间)
                    ├─ 消息解析 → 增量刷写 SQLite
                    │   ├─ streamers       主播信息
                    │   ├─ sessions        直播场次/统计
                    │   ├─ danmaku         弹幕（含飘屏弹幕）
                    │   ├─ gifts           礼物（含连击元数据、星守护、融合定价）
                    │   ├─ members         进场记录
                    │   ├─ online_records  在线人数时序
                    │   └─ gift_icons      礼物图标库（运行时积累）
                    │
                    ├─ 开播/下播 → feishu-send.js → 飞书（tenant_access_token）
                    └─ 下播后 → report-image.js (Playwright截图)
                                        └── feishu-send.js → 飞书群

                    web-dashboard.js (HTTP, 9871端口)
                    ├─ 托管 frontend/dist (Vue 3 SPA)
                    └─ REST API /api/* (Token认证 + gzip)
                            ↑ 控制 socket (monitor.sock)
                            └─ 增删/暂停/恢复房间, 实时状态
```

## 快速开始

### 前置条件

- Node.js ≥ 18（使用内置 `fetch`）
- Go 抓取代理二进制 `douyinLive-linux-amd64`（放在项目根目录）
- Chromium（report-image.js 截图用，Playwright 自动安装）

### 安装

```bash
# 克隆仓库
git clone https://github.com/haoanlan/new_douyinlive.git
cd new_douyinlive

# 安装依赖
npm install

# 安装 Playwright 浏览器
npx playwright install chromium

# 构建前端
cd frontend && npm install && npm run build && cd ..
```

### 配置

#### 1. douyin cookie + 仪表盘

复制 `config.example.yaml` 为 `config.yaml`，填入抖音 cookie 和仪表盘令牌：

```yaml
cookie:
  douyin: "你的抖音登录cookie"
port: "1088"
monitor:
  poll_interval: 15s
  notify_interval: 30s
dashboard:
  token: "你的仪表盘访问令牌"   # 强烈建议设置，留空则无认证
  host: "127.0.0.1"            # 0.0.0.0 允许外部访问
  port: "9871"
```

> cookie 获取方式：浏览器登录抖音网页版 → F12 → Application → Cookies → 复制完整 cookie 字符串

#### 2. 环境变量

复制 `.env.example` 为 `.env`，填入飞书应用凭证（推送功能需要）：

```
FEISHU_APP_ID=cli_xxx
FEISHU_APP_SECRET=xxx
```

> 表结构会在首次启动时自动创建。`.env` 已加入 `.gitignore`，不会被提交。
>
> 仪表盘也可用环境变量覆盖配置：`DASHBOARD_TOKEN`、`DASHBOARD_HOST`、`DASHBOARD_PORT`、`DB_SQLITE_PATH`。

#### 3. 房间号

编辑 `runtime-config.json`（也可在看板内动态增删，支持热加载）：

```json
{
  "rooms": [
    { "id": "516466932480", "name": "主播名", "enabled": true }
  ],
  "check_interval_seconds": 30,
  "reconnect_delay_seconds": 10,
  "save_json": false,
  "feishu": { "open_id": "ou_xxx" }
}
```

| 字段 | 说明 |
| --- | --- |
| `rooms[]` | 监控房间列表，每项 `{ id, name, enabled }` |
| `save_json` | 是否同时保存 JSON 场次文件（默认 false，纯 SQLite） |
| `feishu.open_id` | 飞书用户 open_id，推送到私聊 |
| `feishu.chat_id` | 飞书群 chat_id，推送到群聊（与 open_id 二选一） |

> ✅ **所有代码中不包含任何硬编码的个人 ID/房间名/主播名**。换房间只需改 `runtime-config.json` 或在看板内操作。
>
> - 仪表盘配置走 `config.yaml` 的 `dashboard` 段或环境变量
> - 飞书推送目标从 `runtime-config.json` 读取
> - 主播名统计从每场礼物数据的收礼人字段动态提取

## 使用

### 启动

```bash
# 一键启动守护进程 + 仪表盘
bash start.sh

# 或手动分别启动
node monitor.js --daemon      # 守护进程（多房间监控 + 落库 + 通知）
node web-dashboard.js         # 仪表盘 HTTP 服务

# 查看状态
bash status.sh
node monitor.js status
```

访问仪表盘：`http://127.0.0.1:9871`（设置了 token 则用 `?token=xxx`）

### 守护进程命令

```bash
node monitor.js                  # 启动守护
node monitor.js stop             # 停止守护
node monitor.js status           # 查看所有房间状态
node monitor.js snapshot         # 手动快照（防崩溃丢数据）
node monitor.js report-image     # 生成图片报告发飞书
```

### 前端开发

```bash
cd frontend
npm run dev          # Vite 开发服务器（代理到后端 API）
npm run build        # 构建到 frontend/dist，由 web-dashboard.js 托管
npm run type-check   # 类型检查
```

### 报告生成

```bash
# 生成当前 session 报告 → 保存到本地
node report-image.js --output

# 指定 session ID
node report-image.js --session 265 --output

# 生成某用户的送礼明细
node report-image.js --user "用户名" --output

# 生成送给某人的礼物榜单
node report-image.js --to "主播名" --output
```

> 下播后报告自动通过飞书 Open API（tenant_access_token）推送到飞书群，无需手动操作。

### 用户查询

```bash
# 按 sec_uid 查抖音用户资料
node douyin-user.js <secUid>
```

身份信息包含：头像 + 昵称 + 抖音号 + 粉丝/关注 + 签名 + IP 属地。

### 其他工具

```bash
# 合并多场 session 数据（编辑顶部 sessionIds 数组）
node merge-sessions.js

# WS 消息调试
node ws-debug.js <room_id>

# 同步礼物图标 / 检查粉丝牌 / 查询用户礼物
node sync-gift-icons.js
node check-fanbadge.js
node query-user-gifts.js
```

## 消息处理

| 消息类型 | 处理方式 |
| --- | --- |
| `WebcastChatMessage` | 弹幕 → `danmaku` 表 |
| `WebcastGiftMessage` | 礼物 → `gifts` 表（含连击元数据、融合定价） |
| `WebcastMemberMessage` | 进场 → `members` 表 |
| `WebcastLikeMessage` | 点赞计数 |
| `WebcastSocialMessage` | 关注计数 |
| `WebcastRoomStatsMessage` | 在线人数时序 → `online_records` |
| `WebcastScreenChatMessage` | 飘屏弹幕 → `danmaku` 表（`[飘屏]` 前缀） |
| `WebcastPrivilegeScreenChatMessage` | 特权飘屏 → `danmaku` 表（`[飘屏]` 前缀） |
| `WebcastFansclubMessage` | action=7 星守护 → 转为礼物记录（1280钻/月 / 12个月）；其他 action 不记录 |
| `WebcastResidentGuestMessage` | 团播主播信息 → 更新场次标题/主播名/头像 |

## 数据表

### gifts（礼物记录）

| 字段 | 说明 |
| --- | --- |
| session_id | 关联 sessions |
| nickname | 送礼人昵称 |
| avatar | 送礼人头像 URL |
| user_sec_uid | 送礼人 secUid |
| gift_name | 礼物名 |
| diamond_count | 单价（钻） |
| repeat_count | 数量 |
| total_diamonds | 总价 = 单价 × 数量 |
| to_nickname | 收礼人 |
| to_user_sec_uid | 收礼人 secUid |
| combo_count | 当前帧连击数 |
| repeat_end | 连击终结帧标记（1=终结） |
| send_type | 发送类型（1/4=连击 5=单次） |
| trace_id | 连击追踪 ID |
| icon | 礼物图标 URL |
| create_time | 时间戳（毫秒） |

> ⚠️ 送礼统计必须用 `comboDedupGifts()` 去重，不能直接 SUM。去重 key：`(user_sec_uid, gift_name, to_user_sec_uid)` 三分组。

### danmaku（弹幕记录）

| 字段 | 说明 |
| --- | --- |
| nickname | 用户名 |
| content | 弹幕内容（飘屏弹幕带 `[飘屏]` 前缀） |
| user_sec_uid | 用户 secUid |
| create_time | 时间戳 |

### sessions（直播场次）

| 字段 | 说明 |
| --- | --- |
| streamer_id | 关联 streamers |
| room_title | 直播间标题 |
| start_time / end_time | 开播/下播时间 |
| duration_seconds | 时长（秒） |
| stats_danmaku/gift/like/member/follow | 各类统计 |
| online_peak | 在线峰值 |
| archived | 是否已归档 |

## 连击去重逻辑

礼物入库时**全量写入**（所有 WebSocket 帧都进 SQLite），在**加载数据时**做 combo 去重：

- 函数 `comboDedupGifts(gifts)`（位于 `lib/gift-utils.js`）
- 按 `(user_sec_uid || nickname, gift_name, to_user_sec_uid || to_nickname)` 三分组
- `comboCount` 连续递增(1→2→3) → 同一连击
- 同值 + `repeatEnd` → 归入该组
- 帧序错乱时（如 combo 4 在 3 之前到达）→ 按 combo_count 排序取最高
- 每组只保留 comboCount 最大的那条

## 礼物定价

部分礼物抖音下发的 `diamondCount` 不准或为 0，monitor.js 内置价格修正：

- **融合礼物** — 工坊宝箱类按关键词组合匹配档位价格（1~4 阶）
- **固定价格表** — 闪烁星河/钻石跑车/豪华邮轮等高价值礼物固定钻数
- **星守护** — 按 1280钻/月、12个月 15360钻 折算

## 切换房间

```bash
# 方式一：看板内增删（推荐，无需重启）
# 访问 http://127.0.0.1:9871 → 房间管理 → 添加/暂停/删除

# 方式二：改配置重启
node monitor.js stop
# 编辑 runtime-config.json 修改 rooms
node monitor.js --daemon
```

## 守护进程自愈

- **Go 代理崩溃** — 自动重启，指数退避（5s 起，上限 60s），最多重试 10 次
- **WebSocket 断开** — 指数退避重连（10s 起，上限 60s）；录制中 code=1000 快速重连
- **session 快照** — 内存数据定时写临时文件，进程重启可恢复
- **下播确认** — `live=false` 后 30 秒再次校验，避免团播切主播误判下播
- **日志轮转** — 单文件 10MB，保留 3 个备份；错误日志每分钟限 50 条

## API 速览

所有 `/api/*` 接口需携带 Token（`?token=xxx` 或 `Authorization: Bearer xxx`），返回 JSON 支持 gzip。

| 域 | 主要接口 |
| --- | --- |
| 房间 | `GET /api/rooms` · `GET /api/rooms/lookup` · `POST /api/rooms/add\|remove\|pause\|resume` |
| 场次 | `GET /api/sessions` · `GET /api/sessions/<id>/detail` · `GET /api/sessions/<id>/gifts\|danmaku\|online\|report` |
| 礼物 | `GET /api/gifts/ranking` · `GET /api/gifts/by-type` |
| 用户 | `GET /api/users/<sec_uid>` · `GET /api/anonymous-lookup` · `GET /api/users/search` |
| 其他 | `GET /api/summary` · `GET /api/trends` · `GET /api/status` · `GET /api/export/*` |

## 致谢

- [douyinLive](https://github.com/jwwsjlm/douyinLive) — WebSocket 抓取代理二进制
- [DouYin_Spider](https://github.com/ReaJason/DouYin_Spider) — 抖音 API 查询灵感参考

## License

This project is licensed under the MIT License — see the [LICENSE](./LICENSE) file for details.
