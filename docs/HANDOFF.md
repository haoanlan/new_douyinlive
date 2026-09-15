# 交接摘要（会话上下文过大，用于新会话续接）

> 生成时间：2026-09-15
> 原因：本会话上下文堆到 5.5MB（含多张截图），与上次导致 API 频繁失败的会话同量级。
> 新会话读这一份即可接管，**不要再重新读整份大文件、不要随便读截图**（图片 token 极贵）。

---

## 〇、先读这三个文件

| 文件 | 内容 |
| --- | --- |
| `docs/HANDOFF.md`（本文件） | 项目现状、服务启动方式、环境坑、待办 |
| `PRODUCT.md` | 产品事实与设计原则（impeccable init 的产物，重设计前必读） |
| `docs/DESIGN-REVIEW.md` | 全站 UI/UX 评审报告：8 页、平均 4.8 分、按 P0/P1/P2 分级、每条带行号与改法 |

**当前优先级：先修 `DESIGN-REVIEW.md` 的 P0 —— 那 5 条是真 bug，不修会持续误导使用者，
不要先做视觉打磨。** 摘要：

1. sessions「下载报告」是**死按钮**：`window.open` 不带 `Authorization` 头，
   而 `web-dashboard.js` 对**所有** `/api/*` 走 `checkAuth`。
2. status 危险操作无授权边界：「快速重启」一点即整体重启且无二次确认；
   「重连」实际执行的是守护进程 restart（会中断全部房间连接与正在进行的录制）。
3. **「失败」被伪装成「空」或「正常」**——6 个页面都有（dashboard 静默吞异常、
   trends 失败后蒙层永久盖住整页、sessions 无 hostId 时永久转圈、search 失败渲染成
   「没有匹配的用户」、status 数据未到就显示红色「未运行」）。
4. rooms 轮询失败每 10s 弹一次错误提示（`fetchRooms` 没关 `showErrorMessage`）。
5. rooms 搜索框写「搜索房间号或主播名」，实际只是跳转、`search` ref 从未参与过滤。

P1 是 7 条跨页系统性问题（对比度 token、数字格式、键盘可达性、长列表截断、
共用件重复实现等）——**改一处、8 页同时受益**，性价比比逐页打磨高。

---

## 一、项目现状

| 项 | 值 |
| --- | --- |
| 项目路径 | `D:\desktop\vibe coding\new_douyinlive` |
| 远程 | `origin` = https://github.com/haoanlan/new_douyinlive.git（网络经常抽，需重试） |
| 当前分支 | `vue`（已全部推送，最新 `e54474c`） |
| Go 代理源码 | `D:\desktop\vibe coding\douyinLive-proxy`（jwwsjlm/douyinLive v2.2.1） |

### 三个服务（加前端共四个进程）

| 服务 | 端口 | 启动方式 | 说明 |
| --- | --- | --- | --- |
| Go 抓取代理 | 1088 | `.\douyinLive-win-amd64.exe --config proxy-config.yaml --port 1088` | 必须**先起**，否则 worker 会尝试 spawn 它（沙箱里会 EPERM） |
| 后端 + 监控 worker | 9871 | `node web-dashboard.js` | **同一个进程**，worker 内嵌 |
| 前端 Vite | 5173 | `frontend` 目录下 `node node_modules\vite\bin\vite.js` | 需放宽沙箱（esbuild spawn） |

**浏览器访问 http://localhost:5173**（登录 admin / 123456）。
**不要开 `:9871` 看页面** —— `frontend/dist` 没构建，9871 只提供 API，打开是 404。

---

## 二、本会话做完的事（都已提交推送）

1. **`6f65768` 监控 worker 并入仪表盘进程，移除控制管道**
   原来房间增删改查走 `monitor.sock` 命名管道；受限环境建不出管道 → 四个接口全 500。
   现在同进程函数调用，管道彻底删掉。新增 `lib/worker-control.js` 作为唯一调用入口。

2. **`b21cc6e` monitor.js 按职责拆成 11 个模块**（1937 行 → 195 行）
   `lib/worker/` 下：context / logger / config / time / room-state / proxy-process /
   session / message-handler / connection / commands / lifecycle。
   函数体按 AST 精确边界逐字搬运；只有 3 个布尔值需改写（`ctx.isShuttingDown`
   / `ctx.workerRunning` / `ctx.isStandalone`）。

3. **`bc18ec3` 房间管理三处体验修复**
   添加前先预览确认、添加后立即可见、录制绿点位置偏移（`el-avatar` 基线间隙把容器
   撑高 6px，外层加 `flex` 修复）。

4. **`670ca0d` 修复两个真 bug**
   - 场次时间线聚合**一直失败**：`create_time` 是毫秒时间戳却按秒传给
     `strftime(..., 'unixepoch')` → 返回 NULL → 违反 `time TEXT NOT NULL` →
     整段预聚合回滚。实测 276540/276540 条弹幕算不出时间，**所有场次时间线都是 0 行**。
     已修复并一次性重建 66 个历史场次。
   - `/api/rooms/lookup` 受代理限流影响（实测同一房间连续请求约一半返回 503），已加重试。

5. **`4373aac` 补回 art-design-pro 重写时丢失的交互**
   暂停确认框、删除数据警告、「解析中...」占位、轮询仅在页面可见时进行 + 合并更新。

6. **`60a41e4` → `ecc72ce` 状态语义最终版**
   试过用「代理未确认开播」显示"连接中"，但会持续一分多钟、反而像卡住，
   **已按用户直觉改回**：录制中 / 监控中（WebSocket 连上）/ 连接中（未连上）/ 已暂停。

7. **`2a934f7` 添加房间时把预览查到的主播名和头像一起落库**
   原来后端只在填了主播名时才写 streamers 表、且不存头像 → 加完卡片没头像没名字。

8. **`e54474c` 修复用户画像页**
   前后端字段名**完全不匹配**（前端期望 `gift_profile`/`top_anchors`/`top_gifts`/
   `recent_actions`/`fans_count`，后端返回 `giftStyle`/`topStreamers`/
   `topGiftsByCount`/`danmakuSamples`）→ 页面只剩头像和昵称。
   已对齐字段、后端新增合并的 `recent_actions`、前端重写并补上活跃时段柱状图等。

9. **装了 21 个设计类 skill**（用户级，全局可用）
   `C:\Users\haoti\AppData\Roaming\dsh-desktop\harness\skills\`
   Impeccable（1）、UI/UX Pro Max（7）、Emil Kowalski Skills（12）、
   Taste Skill（1：`taste`，需 Playwright MCP，当前环境未配，只能用其分析框架）。
   已做安全审查（prompt injection / 危险命令 / 外传通道），命中项逐条核实**全是误报**。

---

## 三、环境坑（重要，别再踩）

1. **沙箱禁命名管道**：`monitor.sock`、git push 的凭据助手、Playwright 启动浏览器
   （`--remote-debugging-pipe`）都会失败。这三件事需要 `danger-full-access`。
2. **`bash start-all.sh` 在 Windows 上跑不通**：`pick_proxy()` 候选列表漏了
   `douyinLive-win-amd64.exe`，而仓库里存在 `douyinLive-linux-amd64`，会选中 Linux ELF。
   **分别起三个服务**才对。
3. **不要用 PowerShell 改含中文的 UTF-8 文件**（`Set-Content` 会写坏成双重编码）。
   一律用文件工具。
4. **每条 pwsh 命令的 `$env:TEMP` 是私有目录**（`dsh-XXXX`），放宽权限后又是另一个路径。
   跨命令共享的临时文件要放在工作区里。
5. **写 `DSH_HOME`（用户目录下）需要放宽沙箱**；workspace-write 只覆盖会话工作区。
6. **网络极不稳定**：GitHub 反复连接重置。`codeload` / `raw.githubusercontent.com` /
   `api.github.com` 在 shell 里基本不通（但 harness 的 web_fetch 走另一条代理，通）。
   下大仓库用 `git clone --filter=blob:none --sparse` 只拉需要的文件，成功率高得多。
7. **`Get-NetTCPConnection` 在沙箱里不可用**（CIM 被拒），探测端口要用 `TcpClient`
   或直接发 HTTP 请求。
8. **`monitor.js status` 在管道下无输出**（`process.exit(0)` 截断异步 stdout），
   看状态请用 `node scripts/service-status.js`。
9. **不要用 `read_image` 随便看截图** —— 一张图的 token 相当于几千字，是上次和这次
   上下文爆掉的直接原因。

---

## 四、待办 / 已知问题

1. **前端硬编码 `delete_data: true`**（`frontend/src/api/douyin.ts` 的 `removeRoom`）
   —— 删房间一定连历史数据一起删。目前靠删除确认框明确警告，未改成可选。
2. **暂停正在录制的房间会**结束当前场次**并丢掉约 1 分钟数据**（恢复后要等抓取代理
   重新确认开播，实测 64 秒；这段时间代理不推弹幕）。既有设计，未改。
3. **`Fire苏江009`（room_id = `sjcm009`）不是合法数字房间号**，代理永远无法确认，
   会一直显示"连接中"且不会录制。没必要的话建议删掉。
4. **`/anchor` 与 `status:batch` 被上游限流**（约一半请求失败），lookup 已加重试；
   以后若又"查不到信息"，先怀疑代理被限流。
5. **cookie 未配置** —— 弹幕/礼物链路正常（走代理 WS），但 `lib/douyin-api.js`
   那套（部分主播资料）拿不到数据。

---

## 五、常用命令

```bash
# 启服务（顺序重要，分别起）
.\douyinLive-win-amd64.exe --config proxy-config.yaml --port 1088   # 终端 A
node web-dashboard.js                                              # 终端 B
cd frontend && node node_modules\vite\bin\vite.js                   # 终端 C（需放宽沙箱）
```

| 脚本 | 用途 |
| --- | --- |
| `node scripts/service-status.js` | 状态快照（代理/监控/房间/异常）。默认打 5173，可设 `CHECK_FRONT=http://127.0.0.1:9871` |
| `node scripts/check-room-status.js` | 直接验证共享房间状态模块 |
| `node scripts/audit-auth.js` | 验证 token 伪造漏洞 |
| `node scripts/db-overview.js` / `db-diagnose.js` | 数据库概览 / 诊断 |

---

## 六、仍未修的安全问题

`web-dashboard.js` 里这几条还在：

1. token 可伪造（`lib/routes/auth.js` 发 `base64(user:timestamp)`，`web-dashboard.js`
   只取 `split(':')[0]`，不验签名/过期）
2. `/api/user/list` 免认证
3. `.db-wal` / `.db-shm` 未加入静态文件屏蔽名单
4. `serveStatic(req, res)` 是 async 却未 await/catch
5. 仪表盘侧缺全局 `uncaughtException` / `unhandledRejection` 兜底（worker 侧有）

另：`api/douyin-http.ts` 的错误拦截器已修好（会展示后端返回的真实原因，
并支持 `showErrorMessage: false`）。
