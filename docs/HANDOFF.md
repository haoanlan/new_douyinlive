# 交接摘要（会话上下文过大，用于新会话续接）

> 生成时间：2026-09-14
> 原因：原会话累计上下文 4.4MB（含十几张截图），DeepSeek API 调用频繁失败、重试延迟升高。
> 新会话读这一份即可接管，**不要再重新读整份大文件**。

---

## 一、项目现状（已完成并验证）

### 仓库与分支

| 项 | 值 |
| --- | --- |
| 项目路径 | `D:\desktop\vibe coding\new_douyinlive` |
| 远程 | `origin` = https://github.com/haoanlan/new_douyinlive.git（直连可用，TLS 偶发重置需重试） |
| 当前分支 | `vue`（已推送到远程，commit `51850f5`） |
| 默认分支 | `master` |
| 另一分支 | `refactor/pinia-vue-router`（同样推了 `51850f5`） |
| Go 代理源码 | `D:\desktop\vibe coding\douyinLive-proxy`（jwwsjlm/douyinLive v2.2.1） |

**推送注意**：`git push` 需要放宽沙箱（凭据助手 `gh` 需要命名管道，workspace-write 下报 `couldn't create signal pipe`）。

### 三个服务都能跑

| 服务 | 端口 | 启动方式 | 当前状态 |
| --- | --- | --- | --- |
| Go 抓取代理 | 1088 | `./douyinLive-win-amd64.exe --config proxy-config.yaml --port 1088` | ✅ v2.2.1，`/health` 正常 |
| 监控脚本 | 无 | `node monitor.js --daemon` | ✅ 3 个房间已连接 |
| 仪表盘 | 9871 | `node web-dashboard.js` | ✅ |
| 前端 Vite | 5173 | `npm run dev`（需放宽沙箱，esbuild spawn） | ✅ |

一键启动脚本：`bash start-all.sh`（start/stop/status）。

### 关键事实（踩过的坑，别再重复踩）

1. **cookie 不是必须的**：Go 代理匿名即可解析房间、查直播状态、拿主播资料
   （`/api/v1/rooms/{id}/status`、`/api/v1/rooms/{id}/anchor`、`POST /api/v1/rooms/status:batch`）。
   WebSocket 也连得上。cookie 只影响弹幕/礼物消息流，**尚未验证**（需要房间开播）。
2. **代理配置必须独立**：Go 代理 schema 与 Node 端不同，不能共用 `config.yaml`
   （会报 `field dashboard not found`）。项目自动生成 `proxy-config.yaml`（含 cookie 同步）。
3. **`monitor.sock` 在 DSH 沙箱内建不出来**（`listen EACCES`，禁命名管道）。
   导致「房间管理」的增删/暂停/恢复、页面「快速重启」在本环境不可用，
   **在用户自己的终端里运行则正常**。
4. **前端 `.env` 必须有 `VITE_ACCESS_MODE = frontend`**，否则登录后请求
   `/api/v3/system/menus`（后端没有）→ 路由守卫跳 500 页面。
5. **不要用 PowerShell 改 UTF-8 中文文件**（`Set-Content` 默认 ANSI 会写坏），一律用文件工具。

---

## 二、代码审查结论（已完成，未修复）

### 🔴 严重（已实测验证）

1. **token 可伪造 = 认证形同虚设**
   `lib/routes/auth.js:20` 发 `base64(userName:Date.now())`，无签名；
   `web-dashboard.js:48` 只取 `split(':')[0]` 查库，**不验时间戳、不验过期**。
   实测：`Authorization: Bearer YWRtaW46MQ==`（= base64("admin:1")）→ **200 + 全部数据**。
   验证脚本：`node scripts/audit-auth.js`
2. **`/api/user/list` 完全免认证**（`web-dashboard.js:45` 直接放行），泄露账号列表。
3. **没有全局异常兜底**：`web-dashboard.js` 无 `uncaughtException`/`unhandledRejection`。
   之前那次 500 崩溃（未构建前端时请求 `/` 触发 readStream ENOENT）只是症状，根因还在；
   且 `web-dashboard.js:272` 的 `serveStatic(req, res)` 是 async 却未 await/catch。
4. **`.db-wal` / `.db-shm` 可被下载**：屏蔽名单 `['.yaml','.yml','.bak','.db','.db-journal','.jsonl']`
   漏了这两个。实测 `GET /db/douyin.db-wal` → 200。

### 🟠 中等

5. `/api/summary` 与 `/api/overview` **口径不同**（前者只算有活动的场次，后者算所有已结束场次），实测 120 vs 121。
6. overview 缓存 300s 无主动失效（`lib/routes/overview.js:6`），下播落库后总览最长滞后 5 分钟。
7. `monitor.js` 代理崩溃计数**只增不减**（`:1022` 自增，`:1047` 的重置已成死代码），累计 10 次后永久放弃自愈。
8. 密码无盐 sha256（`auth.js:3`）、登录无限流、token 存 localStorage。
9. `/api/rooms/lookup` 未配 cookie 时返回 500（应为 4xx）。
10. 图片报告功能依赖 Playwright 浏览器但未安装，该接口每次 500（死功能）。
11. 数据库 2 行 `start_time = "1781281920.0"`（带小数点的秒串），JS 解析为 `Invalid Date`。

### 📌 未跑通的验证

- **弹幕/礼物落库链路**：需要一个房间真正开播才能验证（当前 5 个房间全 offline）。

---

## 三、最近一次改动（房间状态逻辑归并）

用户指出「房间状态原来的代码就有相关逻辑（改用 art-design 前）」，核实属实：

- **老前端**（`87be3e7^:frontend/src/views/HomeView.vue`）的 `pollRoomStatus()` 每 15s 调
  `fetchRooms()` 轮询，房间状态来自后端 `/api/rooms`
- 而 `/api/rooms` 只从 `monitor.sock` 取状态，**socket 不可用时返回 `{}`**，导致所有房间显示未连接

**已做的修正**：抽出唯一实现 `lib/room-status.js`
（socket 优先 + daemon 日志兜底 + 逐房间新鲜度判定，超 5 分钟视为陈旧），
`/api/rooms` 与 `/api/service/status` 共用。

验证：`node scripts/check-room-status.js` → `source=log rooms=3`，3 个房间 `connected=true` 且带真实房间标题。

**待办**：把这次改动提交（尚未 commit）。

---

## 四、建议的下一步

1. 提交房间状态归并的改动
2. 修 🔴 四条安全问题（每条都很短，不动核心功能）
3. 等有房间开播，验证弹幕/礼物落库（那时才知道 cookie 到底需不需要）
4. 在用户自己终端跑 `bash start-all.sh`，验证 socket 相关功能（房间增删/暂停）

---

## 五、常用脚本（scripts/ 目录，共 40 个）

| 脚本 | 用途 |
| --- | --- |
| `service-status.js` | 打印状态快照（代理/监控/房间/异常） |
| `check-room-status.js` | 直接验证共享房间状态模块 |
| `rooms-dump.js` / `rooms-ranked.js` | 房间列表 / 按场次排序 |
| `probe-proxy-anon.js` | 探测代理匿名能力边界 |
| `probe-rooms-live.js` | 批量查房间是否在播 |
| `audit-auth.js` | 验证 token 伪造漏洞 |
| `db-overview.js` / `db-diagnose.js` / `db-recover.js` | 数据库概览 / 诊断 / 恢复 |
| `e2e-dom-assert.js` | 26 项页面结构断言 |
| `e2e-toolbar-align.js` / `e2e-size-audit.js` | 尺寸与对齐体检 |
| `fetch-proxy-binary.js` | 下载官方代理二进制（走镜像） |
