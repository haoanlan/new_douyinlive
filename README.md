# 🎥 抖音直播监控 — 数据采集与可视化看板

> 抖音直播间多房间采集与可视化分析工具。一个进程内跑守护进程 + Web 看板：
> 自动检测开播/下播，采集弹幕 / 礼物 / 进场 / 在线人数落地 SQLite，
> 看板提供场次管理、礼物排行、用户画像、趋势分析、状态监控与图片报告推送。
>
> **⚠️ 本项目仅供学习和研究使用，请勿用于任何商业或非法用途。使用者应遵守相关法律法规及平台规则。**

[![Node](https://img.shields.io/badge/node-%3E%3D20.19-brightgreen)](https://nodejs.org)
[![Platform](https://img.shields.io/badge/platform-windows%20%7C%20linux%20%7C%20macos-blue)](#)
[![Vue](https://img.shields.io/badge/vue-3-42b883)](#)
[![SQLite](https://img.shields.io/badge/sqlite-better--sqlite3-003b57)](#)
[![License](https://img.shields.io/badge/license-MIT-green)](./LICENSE)

---

## 功能

- **多房间实时监控** — 一次配置多个直播间，通过 douyinLive 代理（Go 二进制，默认 1088 端口）监听弹幕 / 礼物 / 进场 / 在线人数
- **自动录制与归档** — 检测到开播自动开始记录，确认下播后保存场次并算好聚合数据
- **Web 看板**（Vue 3 + TS + Element Plus + Pinia + hash 路由）：
  | 页面 | 说明 |
  | --- | --- |
  | 总览 | 累计数字卡 + 榜单（热门礼物 / 送礼榜 / 弹幕活跃 / 主播贡献等） |
  | 房间管理 | 增删改房间、暂停/恢复监控、按房间进详情 |
  | 场次历史 | 按直播间筛选的历史场次（时间、时长、礼物/钻石/弹幕数），进单场详情 |
  | 趋势分析 | 同一房间跨场次的钻石 / 弹幕 / 在线峰值走势（支持多房间叠加对比） |
  | 信息查询 | 按昵称模糊匹配用户，查看 TA 的弹幕、礼物与场次 |
  | 状态监控 | 守护进程 / Go 代理 / WebSocket 连接 / 录制中 的实时健康与动作 |
  | 场次详情 | 单场统计、礼物排行、团播主播排名、弹幕排行、弹幕词云、最新动态（弹幕+礼物时间线） |
  | 用户画像 | 按 sec_uid 聚合送礼历史、活跃时段、常用昵称与场次 |
  | 个人中心 | 当前账号信息与密码修改 |
- **数据持久化** — SQLite（WAL + 索引），弹幕 / 礼物 / 进场 / 在线人数 / 场次完整记录
- **预聚合** — 场次结束时算好各维度汇总（见下方"数据表"），总览页与各榜单读汇总而非每次扫明细
- **图片报告** — Playwright 截图生成可视化直播报告，下播自动生成
- **飞书推送** — 开播提醒 + 下播报告（tenant_access_token），可选
- **账号与权限** — 用户名/密码登录（scrypt + 随机盐，兼容旧无盐 sha256 并在登录时自动升级）、
  角色（超级管理员 / 管理员 / 普通用户）、登录失败限速（5 次 → 429 限 2 分钟）、
  高风险接口按角色拦截
- **导出** — `/api/export/*` 导出 CSV，单次上限 2 万行（超出会带 `X-Export-Truncated` 头并在文件尾注明）
- **加载体验** — 各页首屏同形骨架（不白屏、不跳动）、登录后空闲预取路由分包、
  页面切换"退场瞬时 + 进场只位移"

## 架构

```
抖音直播间 ←WebSocket→ douyinLive 代理（Go 二进制，默认 1088）
                              ↓ ws://127.0.0.1:1088/ws/<room_id>
                 进程内监控 worker（monitor.js，多房间）
                 ├─ 消息解析 → 增量刷写 SQLite（lib/worker/*）
                 │   ├─ streamers / sessions / danmaku / gifts / members / online_records
                 │   └─ 场次结束时：算 agg_* + 预聚合表（session_*）
                 ├─ 开播 / 下播 → feishu-send.js（可选）
                 └─ 下播后 → report-image.js（Playwright 截图，可选）

                 web-dashboard.js（HTTP，默认 9871）
                 ├─ 托管 frontend/dist（Vue 3 SPA）
                 ├─ REST API /api/*（lib/routes/*，登录令牌 + gzip）
                 └─ 同一个进程里启动上面的 worker（"嵌入仪表盘"模式）
```

> `monitor.js` 支持两种运行模式：**独立进程** 或 **嵌入仪表盘**（默认，`node web-dashboard.js` 一把起）。
> 代理二进制按平台自动选择：Windows 用 `douyinLive-win-amd64.exe`，Linux 用 `douyinLive-linux-amd64`（见 `lib/proxy-binary.js`）。

## 快速开始

### 前置条件

- **Node.js ≥ 20.19**（前端要求；根目录实测 22.x）
- **Go 抓取代理二进制**：放到项目根目录，Windows 用 `douyinLive-win-amd64.exe`，Linux 用 `douyinLive-linux-amd64`
- **Chromium**（仅"图片报告"需要，`npx playwright install chromium`）

### 安装

```bash
git clone https://github.com/haoanlan/new_douyinlive.git
cd new_douyinlive

# 后端依赖
npm install

# 前端依赖 + 构建（构建会先跑 vue-tsc 类型检查）
cd frontend && npm install && npm run build && cd ..

# 可选：图片报告用的浏览器
npx playwright install chromium
```

### 配置

#### 1. 抖音 cookie

复制 `config.example.yaml` 为 `config.yaml`，填入抖音 cookie：

```yaml
cookie:
  douyin: "你的抖音登录cookie"
port: "1088"
monitor:
  poll_interval: 15s
  notify_interval: 30s
dashboard:
  port: "9871"
  host: "127.0.0.1"       # 0.0.0.0 允许外部访问
```

> cookie 获取：浏览器登录抖音网页版 → F12 → Application → Cookies → 复制完整 cookie 字符串。
> **注意**：Go 代理只支持监听 `0.0.0.0/::`，没有 `--host/--bind` 参数；需要限制访问请用防火墙规则。

#### 2. 环境变量（可选，飞书推送用）

```
FEISHU_APP_ID=cli_xxx
FEISHU_APP_SECRET=xxx
# 仪表盘也可用环境变量覆盖：DASHBOARD_TOKEN / DASHBOARD_HOST / DASHBOARD_PORT / DB_SQLITE_PATH
```

#### 3. 房间

编辑 `runtime-config.json`，或直接在看板的「房间管理」里增删（支持热加载）：

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

### 启动

```bash
# 推荐：一个进程同时起 worker 与看板（worker 嵌入其中）
node web-dashboard.js
# → 打开 http://127.0.0.1:9871
```

```bash
# 也可以拆开跑：先起守护进程，再起看板（脚本仅 Linux）
./start-all.sh          # 或 ./start.sh / ./status.sh
node monitor.js         # 独立模式的监控进程
```

**默认账号**：`admin` / `123456`（首次启动自动创建，请尽快改掉）。
忘记密码时在**运行仪表盘的那台机器**上执行：

```bash
node scripts/reset-dashboard-password.js 新密码
```

> 登录令牌只在本次运行期间有效 —— **每次重启仪表盘后都需要重新登录**。
> 登录后在「个人中心」可自行改密；其它账号由管理员在账号相关接口处理。

### 前端开发

```bash
cd frontend
npm run dev             # 5173，/api 代理到 9871
npm run build           # vue-tsc --noEmit && vite build
```

## 数据表（16 张）

| 类别 | 表 |
| --- | --- |
| 基础明细 | `streamers` `sessions` `danmaku` `gifts` `members` `online_records` |
| 礼物图标库 | `gift_icons`（运行时积累 + `sync-gift-icons.js` 同步） |
| 账号 | `dashboard_users` |
| 场次预聚合（结束时写入） | `session_gift_ranking` `session_anchor_ranking` `session_danmaku_ranking` `session_gift_details` `session_timeline` |
| 总览用全量汇总（不截断） | `session_user_gift_totals` `session_user_danmaku_totals` `session_gift_type_totals` |

## 口径与约定（容易踩的点）

### 弹窗 / 抽屉

- **右上角统一用 Element 标准 X**（内容放 `#header` 插槽，不要自绘关闭按钮 ——
  自制按钮的位置、尺寸、悬停态都和别处不一样，看着像两个产品）。
- **弹窗保留「取消」**：footer 左侧「取消」（`text` 样式）+ 右侧主操作，与 X 等价，
  但符合表单/确认弹窗的使用习惯。**抽屉不放「取消」**（关抽屉有 X 就够了，
  配置抽屉按此约定）。
- 按钮要"转圈不跳宽度"，用 Element 自己的 `:loading` + 固定 `min-width`；
  **不要**塞一个 `class="invisible"` 的图标来占位 —— 那会在文字左边留一段空白
  （实测用户一眼就看出"两个按钮有空白占位"）。
- 遮罩点击统一禁用（`close-on-click-modal="false"`），避免误触把表单关掉；Esc 可关闭。
- 不要为了自绘布局去覆盖 `--el-dialog-padding-primary` / `.el-dialog__body` 内边距：
  实测那样会把 header 压成 24px 高，而标准 X 是 48px，X 会有 24px 压进 body（点不中）。

### 数据

- **礼物连击去重按"场次"分组**：分组键是 `(用户, 礼物名, 收礼人, **场次**)`。
  不带场次时，同一个人在不同场次送同一礼物会被判成"同一段连击"而少算（实测差 0.057%）。
  调用方若做**跨场次**查询，`SELECT` 里必须带 `session_id`，否则分组会退化成旧的跨场次合并。
- **粒度保留**：只到日的地方用 `fmtDate`（`2026/10/14`），到分钟的地方用 `fmtTime`（`2026/10/14 12:00`）——
  两者是刻意分开的两种粒度，只是共用同一份解析实现。
- **总览页读预聚合**：`/api/overview` 由"已结束场次 SUM(agg_*) + 直播中场次实时补算"得出，
  不再每次扫全量明细（原来是 41 万行 / 约 5.5 秒的同步计算）。
- **场次详情接口拆分**：`/api/sessions/:id/detail` 只带"最新 200 条"礼物（供动态时间线），
  全量明细（实测 7000+ 条 / 3MB+）走 `/api/sessions/:id/gift-details`，只在打开明细弹窗时拉取。

## API 速览

所有 `/api/*` 接口需携带登录令牌（`Authorization: Bearer <token>`），返回 JSON 支持 gzip。

| 域 | 主要接口 |
| --- | --- |
| 认证 | `POST /api/auth/login` |
| 房间 | `GET /api/rooms` · `GET /api/rooms/lookup` · `POST /api/rooms/add\|remove\|pause\|resume` |
| 场次 | `GET /api/sessions` · `GET /api/sessions/<id>/detail` · `GET /api/sessions/<id>/gift-details` · `GET /api/sessions/<id>/gifts\|danmaku\|online\|report` |
| 总览 | `GET /api/overview` · `GET /api/summary` · `GET /api/trends` |
| 礼物 | `GET /api/gifts/ranking` · `GET /api/gifts/by-type` |
| 用户 | `GET /api/users/<sec_uid>` · `GET /api/users/search` · `GET /api/anonymous-lookup` |
| 状态 / 运维 | `GET /api/status` · `POST /api/service/action`（按角色）· `GET /api/export/*` |

## 自检脚本

改完代码可以按需跑这些（都需要相应服务已启动）：

```bash
node scripts/sfc-check.js          # 所有 .vue 的模板编译（标签配平、指令语法；比 build 快得多）
node scripts/vite-module-check.js   # 前端模块编译（205+ 源文件）
node scripts/import-check.js        # 所有 import 目标是否存在
node scripts/ui-regression.js       # 桌面回归 10 项（含浅色模式 AA 对比度全量采样）
node scripts/mobile-check.js        # 移动端巡检（溢出、挤压、触控目标）
node scripts/anim-check.js          # 数字滚动动画：不超目标值、字号不跳档
node scripts/transition-check.js    # 页面切换：无"白纱"、无两页交叠
```

> `sfc-check.js` 是必需的：`vue-tsc --noEmit` **不检查模板结构** ——
> 实测删掉一层 `<div>` 却留下 `</div>` 时，类型检查仍然 0 错误，而 Vite 直接编译失败
> （页面被错误遮罩盖住）。类型检查通过 ≠ 页面能跑。

`scripts/` 下另有 50 余个诊断/审计脚本（数据库体检、接口断言、页面截图对比等），按需取用。

## 致谢

- [douyinLive](https://github.com/jwwsjlm/douyinLive) — WebSocket 抓取代理二进制
- [DouYin_Spider](https://github.com/ReaJason/DouYin_Spider) — 抖音 API 查询灵感参考
- 前端基于 [art-design-pro](https://github.com/Daymychen/art-design-pro) 二次开发（品牌与页面已按本项目重做）

## License

This project is licensed under the MIT License — see the [LICENSE](./LICENSE) file for details.
