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
6. ~~**图片报告功能是死的**~~ —— **已修**，见下方「七、本次会话（P0 修复）」。
   原记录：运行时报 `Failed to launch chromium because executable doesn't exist at
   /opt/data/home/.agent-browser/browsers/chrome-<ver>/chrome`，即 `report-image.js`
   在 Windows 上找 Linux 绝对路径。现已改为按平台解析（`lib/browser-path.js`）。

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

---

## 七、本次会话（2026-09-15 晚）—— DESIGN-REVIEW 的 P0 五条已修完

### 最重要的发现：P0-1「下载报告」有**两层**原因，评审只发现了第一层

1. **第一层（评审已写）**：`window.open` 不带 `Authorization` 头 → 401。
2. **第二层（本次新发现，真 bug）**：`lib/routes/sessions.js` 报告分支最后是裸
   `return;`，而 `web-dashboard.js` 的 `handleAPI` 靠**返回值**判断路由是否命中 ——
   `undefined` 被当成"没命中"，于是继续往后走，在**响应已经 pipe 出去之后**
   又追加一个 `404 {"error":"API 不存在"}`。
   现象极具误导性：报告**能**生成，但只要生成成功就必然 404；
   而生成失败时反而返回干净的 500。所以「下载报告」永远不可能成功。
   已改为 `return true`，并在 `handleAPI` 加了 `res.headersSent || res.writableEnded`
   防御（同类隐患一次堵住）。

顺带修好了同一件事的第三个障碍：`report-image.js` 写死 Linux 的 Chromium 绝对路径，
已抽成 `lib/browser-path.js` 按平台解析（env → 系统 Chrome/Edge → 线上旧路径 → playwright 自带）。

### 其余四条

| # | 修法 |
| --- | --- |
| P0-2 | 「快速重启」改名「重启全部服务」，与行内按钮统一走 `ElMessageBox.confirm`，确认框**动态列出真实影响面**（N 个房间连接断开 / 正在录制的 M 个房间会中断并结束当前场次）。「重连」→「重启监控脚本」 |
| P0-3 | 新增共用件 `QueryErrorState` + 6 处错误态：dashboard（两个 `catch{}` 静默吞异常 → 错误条 + 数据过期秒数 + 状态未知标签）、trends（蒙层永久盖住 → `finally` 必关，并加空态）、sessions（无 hostId 永久转圈 → 明确引导）、search（失败＝空 → 两者分开）、status（数据未到显示红色"未运行" → "状态未知" + 中性灰点）、rooms |
| P0-4 | 轮询类读接口统一 `showErrorMessage: false`（`fetchRooms`/`lookupRoom`/`fetchStatus`/`fetchServiceStatus`/`fetchSessions`/`fetchOverview`），改由页面持久展示 + 重试，不再每 10 秒弹 toast |
| P0-5 | 搜索框改为**真实本地过滤**（房间号/主播名/直播间标题），顶部统计跟随筛选并显示"已筛选出 N 个"，文案改「筛选」，空态区分"没有房间"与"筛选没匹配" |

共用件：`frontend/src/utils/douyin-error.ts`（错误原因提取，从 rooms 提到公共层）、
`frontend/src/utils/download.ts`（带认证的 blob 下载）、
`frontend/src/components/business/query-error-state/`。

### 验证方式与结果

用 Playwright（**需 `danger-full-access`**，Chrome 的 `--remote-debugging-pipe` 被沙箱拦）
跑了 23 条断言，**22 条通过、控制台零错误**：

- 报告接口：登录态取到 `HTTP 200` + 真 JPEG 字节（80–93KB）且 `FF D8` 头正确；不带 token 仍 401
- rooms 过滤：`before=6 → after=0`（无匹配）、输入「林语巷」`matched=2`
- sessions 无 hostId：`loading masks=0`，显示「请先选择要查看的主播」
- status：确认框弹出且文案含影响面，取消后未执行重启
- trends：`masks=0`、`canvas=4`

唯一未通过的 1 条是**验证脚本自身的断言写法问题**（点击下载按钮后拦截 `download` 事件，
无头环境下事件时序不稳），不是功能问题 —— 报告接口已用浏览器内 fetch 证明可用。

### 环境备注（新踩的坑）

- **后端进程本身也要能启动 Chrome**：报告图片由后端渲染，所以 `node web-dashboard.js`
  必须跑在能 `spawn` Chrome 的权限下，否则接口返回 `spawn EPERM`。
- 停后端请用 `netstat -ano | findstr :9871` 找**监听** PID 再杀；按时间批量杀 node
  会误伤/漏杀（本次踩过，已恢复）。
- 起服务时若 :9871 已有进程，`web-dashboard.js` 会拒绝双启（保护写库），
  这不是故障，是预期行为。

---

## 八、后续会话：打磨与 P1（DESIGN-REVIEW 的 P1 基本清完）

### 8.1 动效与交互态（原来完全没有规范）

新增 `frontend/src/assets/styles/custom/douyin-motion.scss` 作为**唯一的动效与语义色来源**：

- `--dy-ease-*` / `--dy-dur-*`：曲线与时长档位（原来同一件事有 0.4s/0.35s/300ms 三套）
- `.dy-pressable`：按下 `scale(.97)` + `focus-visible` 焦点环 + 触屏不误触发 hover
- `.dy-list-*`：列表进出统一过渡（原来 dashboard 纵向进、横向出，方向都不一致）
- `.dy-toolbar` / `.dy-toolbar-title` / `.dy-count`：工具条容器与标题、计数口径
- `.dy-stat-row` / `.dy-stat-card`：统计卡一排（**原写在 dashboard 的 scoped style 里，
  别的页引用类名却拿不到布局** —— 这是"看着像共用其实不是"的典型，已提到全局）
- `.dy-tone-*` / `--dy-text-*` / `--dy-tag-*`：语义色（见 8.2）

### 8.2 对比度（P1-6）—— 实测 38 处不达标 → 0

关键判断：**没有直接改 `--art-gray-*` 色板**（那是全局模板 token，图表填充/边框/图标都在用，
压深会把整个模板改掉）。改为加一层**按用途命名**的文字色，页面照旧写 `text-g-500`，
由 `.douyin-page` 作用域统一解析。

实测发现两个评审没提的组件层问题：

| 问题 | 实测 | 原因 |
| --- | --- | --- |
| `el-tag` 文字 | **1.62:1** | 模板把亮色填充 `#13DEB9` 直接当**文字色**用 |
| 主按钮 / 选中态 | **3.29:1** | 白字配 `#5D87FF` 不够深（压深为 `#4568f5` = 4.61:1） |
| `dy-switch-btn` | 深色 **2.27:1** | `douyin-toolbar.scss` 里写死 `background: #fff` |

结果：**浅色 415 处采样 0 未达标**，深色单独复核也 0。

### 8.3 数字口径（P1-7）

`fmtNum`（万/亿）与 `toLocaleString`（千分位）同页混用 → 统一走 `fmtNum`，
新增 `fmtFull` / `fmtTitle` 用于精确值与悬浮提示。

### 8.4 detail 长列表（P1-9）—— 两个真 bug

1. `items.slice(-limit)` 作用在**升序**数组上 → "最新动态"默认展示的是**最旧的** 200 条。
2. "全部"模式用**固定行高 64px** 的虚拟滚动，而弹幕换行 2–3 行 → 行与行**必然重叠**。
   改为渐进披露（最新 N 条 + 加载更多），从根上不存在重叠。实测 200 行 0 重叠。

### 8.5 破坏性默认值（P1-10）

`api/douyin.ts` 的 `removeRoom` 硬编码 `delete_data: true` → 删房间**必定**连历史数据一起删。
已改为必传参数，rooms 页弹窗提供两个明确动作：
**仅停止监控（保留数据）** / **删除历史数据（红色 + 再确认一次）**，取消永远安全。

### 8.6 状态监控页重做

版式参照 Art Design Pro 的 `monitor/overview`（操作条 + 总体状态条 + 4 张数据卡 + 两栏详情）。
数据卡是「浅色方块图标 + 小标题 + 大数字（`ArtCountTo`）+ 下带横线的两列小指标」。

**教训（重要）**：这一页来回改了五版才定。中间犯的错是——用户给了 artd.pro 的地址让我
"模仿这个页面风格"，而那个地址需登录、快照只能拿到 `Art Design Pro X` 一行文本，
我却拿本地模板组件去**反推**，结果连错三次（hero 大卡 → 合并 → 自造卡片），
每次都被指出"更丑了"。**正确做法是当时就停下等截图。** 拿到截图后一次就对了。

同理：早期那批"对比度/字号/动效"改动是**在没看过页面的情况下靠数值推的**，
后来看到图才发现判断有偏差。**改 UI 前先截图看，不要靠数值猜。**

### 8.7 仍未做

- **P1-8 键盘可达**：rows / sessions / detail 三处的可点行已补
  `role="button"` + `tabindex` + Enter/Space + `focus-visible`；
  但 detail 里的榜单行、profile 的表格等**还没全铺开**。
- **`.db-wal` / `.db-shm` 静态屏蔽**（第六节安全清单第 3 条）仍未加。
- 状态监控页的图表类内容（趋势图）没做——参考图里的「登录安全走势」在这套数据下没有对应物。

---

## 九、后续会话（打磨轮）：趋势分析重做 + 卡面质感

两个提交：
- `f651150` fix: 修掉 P0 级真 bug 并统一各页视觉口径（25 文件，+3762/-692）
- `60efc44` feat: 趋势分析改为按房间跨场次 + 卡面质感（6 文件，+1024/-116）

### 9.1 趋势分析：从"全站总和"改成"单房间自己和自己比"

**原来的逻辑为什么没意义**（这是用户直接指出的）：
后端 `/api/trends` 只有时间维度一个条件（`WHERE create_time >= ...`），
把所有房间的礼物/弹幕按日期加总 —— 那是"全站总和的日曲线"。
各房间基线差几十倍（单场平均钻石 1.9 万 ~ 99 万），加总后的起伏主要反映
"今天一共开了几场"，而不是任何一个直播间变好或变差。

**新接口 `/api/hosts/trends`**（在 `lib/routes/sessions.js`）：
- 参数 `hosts=21,34,3`（最多 4 个）+ `range=7d|30d|90d|all`
- 按**每一场直播**给数据点（`sessions` 表按 `start_time` 升序）
- 数据源用 `sessions` 的预聚合列（`agg_*` / `stats_*` / `online_peak`）——
  已核对与 gifts/danmaku 明细**完全一致**，且不必扫 27 万行
- 返回 `summary`（平均每场，比总和更适合跨房间比）+ `prevSummary`（上一等长周期，用于涨跌）
- 派生指标 `diamondsPerHour` / `danmakuPerThousand`：跨房间比"效率"时比原始量有意义

**数据事实**（探查过，别再查一遍）：
- `streamers` 5 行 / `sessions` 125 行 / `gifts` 232680 / `danmaku` 278296
- **当前数据里「直播间」与「主播」是 1:1**（每个 streamer 只对应 1 个 room_id，反之亦然）。
  数据模型分开了 `streamer_id` / `room_id`，将来若变多对多，两个维度可各自生效。
- `/api/streamers` → `{ id, name, room_id, avatar, session_count, sec_uid(真 sec_uid), ... }`
- `/api/rooms` → 只含**已监控**房间（会漏掉部分主播），键是 `room_id`
- 用 `/api/streamers` 的 `id` 当 hostId；**别拿 `sec_uid` 当 id**（那是真 sec_uid 字符串）
- `stats_social` 全 0，别用；其余 7 个指标都有数据

### 9.2 卡面质感（"廉价感"的修复）

根因：模板 `.art-card` 只有 `border: 1px solid` + 极弱阴影，**没有过渡、没有悬停反馈**，
卡片像印在背景上的色块。在 `.douyin-page` 作用域内补三层（不动模板、不影响其它页）：
- 顶部 1px 高光内描边（伪元素，不占盒模型、不挤动内容）
- 悬停 `translateY(-2px)` + 层次阴影 + 主题色描边
- 进场依次上浮淡入（步进 40ms，上限 8 张）

**取值刻意克制：位移 ≤2px、阴影透明度 ≤10%。** 大位移和大阴影本身就是廉价感来源。
保留 `prefers-reduced-motion` 降级（已验证 `animation-name: none`）。

### 9.3 本次会话踩到的坑（都是"看着对、实际没生效"）

1. **`:deep()` 在无 `scoped` 的 `<style>` 块里无效**
   详情页的 `<style>` 是**全局**的（没写 `scoped`），在里面写 `:deep()` 不会
   被 Vue 转换，而是原样输出成 CSS —— 浏览器不认识 `:deep()`，整条规则被丢弃。
   **症状：样式写了完全没生效，且 CSSOM 里搜不到该规则。**
   修法：移到 `custom/douyin-motion.scss`，用类名限定（全局块里不能写裸的
   `.el-input__wrapper`，会泄漏到全站）。

2. **模板在 `border-mode` 下写死了 `box-shadow: none !important`**
   `app.scss` 用 `@include art-card-base(var(--art-card-border), none, 4px)`。
   悬停阴影不加 `!important` 会被整个压掉（实测只有位移生效、卡片依然是平的）。

3. **element-plus 原生选择器特异性常常更高**
   `.el-check-tag.el-check-tag--primary.is-checked` 是 (0,3,0)；
   只写 `.douyin-page .el-check-tag.is-checked`（0,2,0）盖不住。
   **修法：把修饰类也写进选择器**，不要动辄上 `!important`。

4. **`getComputedStyle().display` 对 flex 子项会报 `block`（误报陷阱）**
   我为"礼物标签是否独占一行"查了半天，最后是靠几何量排除的：
   标签 `32x16`、父行高仅 `19.5px`、与昵称 `sameRowAsName=true`。
   **经验：判断 flex 布局要看盒尺寸/位置，不要只看 display 的值。**

5. **`el-check-tag` 的 change 事件传出的是「新值」**（内部已做 `!checked`）。
   再按当前状态取反一次，两个反相抵消 → 表现是"点了没反应"。

6. **旧的僵死后端会占住 9871，导致新后端拒绝双启直接退出**
   （日志有 `已有守护进程在运行`）。症状：端口 OPEN 但所有接口超时。
   **修法：`netstat -ano | findstr :9871` 找到 PID → 确认 CommandLine 是
   `web-dashboard.js` → 杀掉再起。** 不要用按时间过滤的批量 kill。

### 9.4 仍未做 / 已知问题

- ~~**趋势页：勾选非默认指标后图表不渲染**~~ —— **已修**（见 9.6 根因）。
  原记录：状态层正确但容器 `clientWidth===0` 且 `display===block`（矛盾组合），
  `flush:'post'`、rAF 轮询都无效。
- **房间管理页下方约 450px 纯空白**（5 张卡占上半屏，下面全空）。
- P1-8 键盘可达未全铺开；`.db-wal`/`.db-shm` 静态屏蔽未加（见第八节）。

### 9.5 验证方式（已沉淀成可重复脚本）

`scripts/ui-regression.js` —— 9 项检查，**改动后跑它**：
```bash
node scripts/ui-regression.js
```
覆盖：浅色对比度 AA、数字口径、工具条内边距、统计卡高度、字号档位、
detail 动态列表无重叠、detail 底部齐平、trends 勾选非默认指标后图表渲染、无本地 5xx/JS 报错。

两个已经踩过的**测试自身缺陷**（已修，别改回去）：
- 采样时机：原来只等 loading 蒙层，网络慢时会测到骨架态/空状态占位
  （采样数从 412 掉到 172，报出 9 处"未达标"却全是中间态）。
  现在依次等：根容器出现 → 蒙层消失 → 所有动画结束。
- 量尺寸前必须**移开鼠标并清零 animation/transition/transform**，
  否则卡片悬停的 `translateY(-2px)` 会被量成"底部不齐"（实测误报 2px）。

浏览器验证需要 `danger-full-access`（Chrome 走 named pipe，沙箱会拦成 `spawn EPERM`）。

### 9.6 趋势页 v-show 失效的根因（已修，模式级知识）

**症状**：勾选非默认指标，状态层全对（标签选中、`activeMetrics` 已含），
但卡片 `display` 停在 `none`、`clientWidth=0`；而子节点 `.h-72` 是
`display:block` + `clientWidth=0` —— HANDOFF 原以为"祖先链塌了"，
**实际父卡片一直是 `display:none`，量的子节点只是继承了不可见**（9.3.4 的陷阱再犯）。

**根因（Vue 编译期优化 + 运行时 patch 跳过）**：
1. `allMetrics` 是 `<script setup>` 的 `const` → binding 为 `setup-const` →
   编译器把该 v-for 判成 `isStableFragment` → fragment patchFlag **64 (STABLE_FRAGMENT)**，
   item 编译成 **patchFlag 0 的裸元素**（无 bindingMetadata 时编出来是 128 KEYED，会误判成"代码没问题"）。
2. 收集规则：patchFlag>0 或组件才进 `dynamicChildren`；纯静态 item **不进 dc**。
3. 运行时 `processFragment` 对 STABLE_FRAGMENT 且两边 dc 等长时**只 patchBlockChildren**，
   静态 item 永远不走 `patchElement` → **`vShow.updated` 永不执行**。
4. dev 下 `traverseStaticChildren` 会更新 `el.__vnode`（dirs.value 已是 true）——
   **"vnode 里 value=true 但 DOM 没变"的假象来源，别再被它骗**。
5. 标签（el-check-tag）能更新是因为**组件 vnode 无条件进 dc**（shapeFlag 规则）。

**修法**：给卡片加动态 prop `:data-metric="m.key"`（pf=8 PROPS）→ item 进 dc →
正常 patchElement → 指令钩子执行。模板注释里有完整说明。
**通用教训**：v-for 列表源是 setup-const 时，item 上的运行时指令（v-show 等）
需要 item 自身是动态的；排查时 `el.__vnode` 不可信，要看 MutationObserver 或
`getComputedStyle` 的实际值。

