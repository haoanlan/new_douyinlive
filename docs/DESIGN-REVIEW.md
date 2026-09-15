# 全站 UI/UX 评审报告

> 评审时间：2026-09-15
> 方法：`impeccable` 技能（Operate 模式 + critique 参考），4 个隔离子 agent 并行评审，仅读代码未改文件。
> 未经浏览器渲染验证的结论已标注「未验证」。

## 评分总览（8 页，平均 4.8/10）

| 页面 | 评分 | 一句话结论 |
| --- | --- | --- |
| rooms 房间管理 | 6.5 | 相对最好，但轮询失败会 toast 刷屏、搜索框是假的 |
| dashboard 总览 | 5.5 | 骨架对了，但「现在正常吗/哪出问题/数据多新」三个问题都答不上 |
| detail 场次详情 | 5.0 | 维度齐全，但最关键的最新动态在「全部」模式下列表重叠不可读 |
| search 匿名查询 | 5.0 | 「查失败」和「没结果」长得一模一样 |
| sessions 场次历史 | 4.5 | 下载报告按钮不可能成功、hostId 为空时永久转圈 |
| trends 趋势分析 | 4.0 | 图表配置干净，但无标题/单位/空态，且失败会永久蒙层 |
| profile 用户画像 | 4.0 | 丢掉了接口已返回的两个最有价值结论 |
| status 状态监控 | 4.0 | 破坏性操作无授权边界，深色下关键状态文字对比度 1.7–3.1:1 |

---

## P0 —— 会造成真实问题，优先修

### 1. sessions「下载报告」是死按钮（功能 bug，已由源码验证）
`getReportUrl` 指向 `/api/sessions/{id}/report`，但页面用 `window.open` 打开，
**不带 `Authorization` 头**；而 `web-dashboard.js:274-277` 对**所有** `/api/*` 走 `checkAuth`
（只认 Bearer 头）→ 新标签只会显示 `{"error":"未授权，请先登录"}`。
单条下载与批量下载都如此。
→ 改为前端带 token 取 blob 再触发下载，或为报告接口改用一次性签名 URL。

### 2. status 危险操作无授权边界（唯一会造成数据损失的一类）
- 顶栏「快速重启」是 **primary** 按钮，一点即对 Go 代理 + 监控守护进程整体 restart，
  **无二次确认**，未说明「全部房间连接与正在进行的录制会中断」。
- WebSocket 行的「**重连**」实际执行守护进程的 restart/start，**副作用远超重连**。
- 「部分断开」意味着有房间未采集数据（场次不会入库），却用中性词 + warning 色 + 普通小按钮。
→ 重启类操作加 `ElMessageBox.confirm` 并写明影响面；「重连」改名为「重启监控脚本（含重连）」
或后端提供真正的仅重连动作；「部分断开」改红色系并补影响说明。

### 3. 「失败」被伪装成「空」或「正常」（出现在几乎所有页面）
| 页面 | 具体表现 |
| --- | --- |
| dashboard | `catch {}` 静默吞异常；后端挂了仍显示最后一次成功数据，且「正常/运行中」标签照常显示 |
| trends | `loading.value=false` 只在 `nextTick` 里 → 请求失败则**蒙层永久盖住整页** |
| sessions | `refresh()` 在 `finally` 之前 `return` → hostId 为空时**永久转圈**，空态永不出现 |
| search | `catch` 把任何失败写成空数组 → 网络失败渲染成「没有匹配的用户」 |
| status | 数据未到就把三行渲染成红色「未运行」 |
| detail/profile | refresh 失败无任何提示 |
→ 统一模式：`queryError` 状态 + `el-alert`/`el-result` + 重试按钮；轮询失败要区分
「自动刷新中/已暂停/上次更新于 N 秒前」。

### 4. rooms 轮询失败 toast 刷屏
`fetchRooms()` 没关 `showErrorMessage`，拦截器每 10s 弹一条错误；`lookupRoom` 同样没关
→ 一次查询失败弹两条（违反 `api/douyin.ts` 自己写的注释「不会弹两次」）。
两页 `refresh()` 均无 `catch`。
→ 读接口同样传 `showErrorMessage: false`，由调用方统一展示。

### 5. rooms 搜索框承诺与行为不符
占位符写「搜索房间号或主播名」，实际只是 `router.push` 跳转，且 `search` ref
**从未参与过滤**（输入主播名必然查不到，sessions 接口只按 room_id 查）。
→ 要么实现真实过滤，要么改成明确的「跳转查询」按钮并改文案。

---

## P1 —— 系统性问题（改一处，8 页同时受益）

### 6. 对比度：12px 辅助文字大面积不达标
按 `tailwind.css` 实际色值计算（白底）：
`text-g-400` = `#dbdfe1` → **1.3:1**（几乎不可见，profile 的「首次/最近活跃」在用）
`text-g-500` = `#949eb7` → **3.0:1**
`text-g-600` = `#7987a1` → **3.55:1**
`text-theme` = `#5D87FF` → **3.41:1**（用在 14px 处也不达标）
status 页写死 Tailwind 浅色值，深色下（底色 `#161618`）：`emerald-600` **1.88:1**、
`amber-500` 3.32:1、`red-500` 3.06:1。
→ token 层收口：12px 辅助文字用 `text-g-700`（`#4d5875`，7.0:1）；状态色统一走
`text-success`/`text-warning`/`text-danger`（别直接拿 `--art-success #00D99E` 写正文，白底仅 2.86:1）。

### 7. 数字格式化三套口径并存
同一页内 `fmtNum()`（1.23万）、`toLocaleString()`（12,345）、原始整数混用。
`fmtNum` 的缩写还会让「1.23万 / 1.24万」无法区分。
→ 统一走 `@/utils/format`，数值加 `:title="原值"`；大数值考虑千分位而非「万」缩写。

### 8. 无键盘 / 屏幕阅读器通路（几乎全部页面）
裸 `div @click`（detail 榜单、rooms 卡片、sessions 行）、icon-only 28px `<button>` 无
`aria-label`、用 `title` 当图表提示（profile 柱图每根仅约 4.5px 宽）、多个文件
`tabindex`/`role`/`aria-*` 出现 **0 次**。
→ 抽 `IconActionButton` 共用件；可点区域加 `role="button"` + `tabindex="0"` +
`@keydown.enter/space` + `focus-visible:ring-2`。

### 9. 长列表只有硬截断，没有渐进披露
- detail：「最新动态」默认展示的是**最旧的 200 条**（`slice(-limit)` 作用在升序数组上）；
  「全部」模式的虚拟滚动写死行高 64px，而弹幕可换行 2-3 行、礼物行更高 → **必然重叠不可读**；
  弹幕一次拉 5 万条并在主线程同步过滤，输入掉帧。
- detail 三张榜各 320-360px 内滚，48px 行高只露 6 行，标题写死「Top 20」与实际不符。
- profile 两处 `.slice(0, 8)` 静默截断，与顶部「活跃场次 37」**自相矛盾**。
→ 统一「前 N 条 + 查看全部 / 分页」，或标注「Top N / 共 M」。

### 10. 破坏性默认值
`api/douyin.ts` 的 `removeRoom` 硬编码 `delete_data: true` → 删房间必定连历史数据一起删
（目前只靠确认框警告）。→ 改成可选。

---

## P2 —— 各页要点（打磨）

- **dashboard**：「Go 代理」与「监控脚本」两张卡共用同一个 `daemonRunning`，代理单独崩溃仍
  显示「正常」（**假状态，会误导值班**）——`api/douyin.ts` 里已有未使用的
  `fetchServiceStatus`/`ServiceStatus` 可以做成真的；4 张实时卡与 6 张历史 Top5 卡视觉权重相同，
  应给状态区加强调条并 sticky；只有顶部 5 张卡有加载态，下方 5 个区块在返回前是空卡片，
  会被误读成「真没数据」；无手动刷新。
- **trends**：三张图**无标题、无单位**，单系列图的 legend 无信息；两组 `el-radio-group` 并排
  无标签（不知第二组是聚合粒度）；无空态；`Trends.sender_count` 已返回却未消费
  （判断「少数大户 vs 广泛参与」的关键指标）；图表 `h-72` 无 resize 监听；筛选不写 URL。
- **detail**：时间线 echarts `setOption` 缺 `notMerge=true` → 15s 刷新后旧数据点残留；
  两个 `el-dialog` 无标题、`show-close=false`、自绘关闭按钮 28px 无 `aria-label`；
  搜索激活时条数上限被旁路但 select 仍显示旧值；统计卡 `truncate` 会截断数值且无 tooltip。
- **profile**：`avgPerSession`（场均消费）与 `favoriteStreamer`（最爱主播）接口已返回但
  **零渲染** —— 画像页最核心的两个结论缺失；24 小时柱图把**零活跃渲染成可见柱条**
  （`count === 0 ? 2`）且与真数据同色 → 读图结论被污染；错误态把 50 字符 sec_uid 抛给用户；
  无面包屑/返回（路由 `isHideTab: true`，唯一入口在 search 页）。
- **search**：主播筛选只过滤列表，顶栏汇总不随之更新，同屏两个「用户数」口径；
  合法的 0 被显示成「—」；`AnonymousLookup` 类型与真实返回完全不符（页面用 `any[]` 绕开）；
  主体几乎全是 12px，层级扁平。
- **sessions**：日期筛选其实**是对的**（评审 A 的结论被驳回）；`hostId` 为空永久转圈见 P0。
- **rooms**：`refresh()` 无 catch；轮询失败刷屏见 P0。
- **status**：运行日志默认展开且 320px 高，把更重要的「异常提醒」挤出首屏；
  「运行日志」折叠头是手写 `role="button"`，无 `aria-expanded`/焦点环；弹窗固定 520px 无 max-width。

---

## 复用点（改一次=改三处 的根因）

已经存在但被复刻的东西——重设计时应先抽共用件：
- `frontend/src/assets/styles/custom/douyin-toolbar.scss`：**已抽好的公共工具栏样式**，
  但 rooms/sessions 各自复刻了 19 行等价 `:deep()`；且已出现「卡片圆角 16px vs 10px」口径分裂
  （`app.scss:92` 实为 `calc(var(--custom-radius) + 4px)`，而 `--custom-radius` 是用户可调主题项）。
- 待抽：`IconActionButton`（键盘可达的图标按钮）、`usePolling`（统一轮询 + 失败状态）、
  `apiErrorMessage`（rooms 里已有一份，应提到公共层）、`fmtNum` 统一入口。
- 未被消费的既有能力：`fetchServiceStatus`/`ServiceStatus`、`Trends.sender_count`、
  `DaemonStatus.rooms` 的 key（可用于列出具体掉线房间名）、`fmtAgo`。

---

## 方法与盲区说明

- **确定性检测器返回 0 findings**（`impeccable detect --json`，exit 0）—— 这是**覆盖盲区而非质量合格证明**：
  它没报出 5 个裸 `<button>`、5 个可点 `div`、纯色状态信号。
- **本轮评审未取得浏览器视觉证据**（子 agent 沙箱无浏览器能力，且路由会重定向到 /login）。
  所有运行时观感（ECharts 标签重叠、v-loading 闪烁、实际折行像素、深色模式观感）均**未验证**。
- 设计 token 取值来自 `frontend/src/assets/styles/core/tailwind.css` 与 `config/index.ts`，
  对比度为按实际 hex 计算，非印象判断。
