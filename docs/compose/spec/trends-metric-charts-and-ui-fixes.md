---
feature: trends-metric-charts-and-ui-fixes
status: in-progress
updated: 2026-09-29
branch: vue
commits: 832dbea.. # in progress
---

# 趋势页非默认指标图 + 两项低优先级 UI 修复

## Report

## [S1] Problem

来自 `docs/HANDOFF.md` 第 9.4 节，共三项：

1. **（最高优先级）趋势分析页勾选非默认指标后图表不渲染。**
   `/douyin/trends` 默认勾选的峰值在线/钻石/弹幕三张图正常；勾选如"钻/时"等
   非默认指标后，`activeMetrics` 状态正确、标签显示选中，但对应图表容器
   `clientWidth === 0` 而 `display === block`（矛盾组合，指向祖孙链上有元素塌陷
   或容器是游离节点）。已试过 `flush:'post'`、`requestAnimationFrame` 轮询均无效。
2. **房间管理页下方约 450px 纯空白**（5 张卡占上半屏，下半屏全空）。
3. **P1-8 键盘可达未全铺开**：rows/sessions/detail 三处可点行已补
   `role="button"`+`tabindex`+Enter/Space+`focus-visible`，但 detail 榜单行、
   profile 表格等尚未覆盖。

## [S2] Design

### S2.1 趋势页图表渲染修复

- 根因定位方法（HANDOFF 9.4 建议 + 实测）：在 `redraw()` / `waitVisible()` 内
  打印容器的**祖先链**逐层 `tagName/class/display/clientWidth`，并检查容器是否
  `isConnected`，找到第一个塌陷层；修法以实测根因为准。
- 验收行为：在 `/douyin/trends` 选择有数据的房间，勾选任意非默认指标
  （钻/时、弹幕/千人、礼物数、参与用户、时长），对应图表在 ≤1s 内渲染出曲线；
  取消勾选后再勾选仍能渲染；切换 X 轴粒度、刷新数据后仍正常。
- 回归保护：默认三图不回归；`node scripts/ui-regression.js` 8/8 保持通过。
- 若修复涉及样式，必须用 `getComputedStyle` 实测实际值验证（HANDOFF 第九节约束）。

### S2.2 房间管理页下方空白 —— 已决定不修（2026-09-29）

- 先截图（Playwright）确认现状，不靠数值猜。实测：工具条+5 卡在 ~430px 结束，
  `.douyin-page` min-height=881px（100vh-119），各层背景全透明 → 下方 ~450px 纯白。
- 曾按"内容补位"实现过「最近场次」板块（现成 `GET /api/sessions?limit=6`，纯前端），
  **用户明确不要往房间页加内容，已全部回退**。
- 其余候选（卡片拉伸 / 内容区灰底）经用户确认后**放弃本条待办，保持现状**。
  记录仅作背景：以后若重开此题，纯 CSS 方案只剩这两条，且都已评估过代价。

### S2.3 P1-8 键盘可达铺开

- 范围：`DESIGN-REVIEW.md` P1-8 尚未覆盖的可点行/可点元素（detail 榜单行、
  profile 表格行等），与已铺开的三处保持同一模式：
  `role="button"`（或语义等价）+ `tabindex="0"` + Enter/Space 激活 +
  `:focus-visible` 焦点环（样式类改动必须实测 `getComputedStyle`）。
- 验收：纯键盘 Tab 可到达上述可点元素并触发操作；焦点环可见。

### 通用约束（HANDOFF 第九节）

- 改 UI 前先截图看，不靠数值猜。
- 样式类改动必须验证 `getComputedStyle` 实际值。
- 已知陷阱：`.art-card` 在 border-mode 下 `box-shadow: none !important`；
  无 `scoped` 的 `<style>` 里 `:deep()` 无效；element-plus 原生选择器特异性更高。
- 每完成一块就提交，不堆积改动。
- 数据侧：直播间趋势用 `/api/hosts/trends`，不用 `/api/trends`。

## [S3] Out of Scope

- 不改 `/api/trends` 旧接口本身、不动数据模型（1:1 关系）。
- 不做 `.db-wal`/`.db-shm` 静态屏蔽等安全清单项（HANDOFF 第六节）。
- 不做状态监控页图表（HANDOFF 8.7）。
- 不 push、不合并（除非用户另行要求）。

## Tasks

- [x] T1: 三服务起来 + ui-regression 基线 8/8 — acceptance: 三端口可访问，
  `node scripts/ui-regression.js` 报 8/8 通过（covers: S2.1 前置）
- [x] T2: 祖先链定位趋势图容器塌陷根因并修复 — acceptance: 浏览器勾选非默认
  指标 ≤1s 渲染曲线，反复勾选/取消、切 X 轴、刷新均正常；默认三图不回归；
  ui-regression 8/8；已提交（covers: S2.1）
- [ ] T3: ~~修复房间管理页下方纯空白~~ — 按用户决定放弃（S2.2），不实现
- [x] T4: P1-8 键盘可达铺开到 detail 榜单行 / profile 表格 — acceptance:
  键盘 Tab 可达并激活，焦点环经 getComputedStyle 实测存在；已提交（covers: S2.3）
  —— 盘点后发现该说的"未铺开"已过时（detail 行早已补全、profile 表格不可点）；
  真正的问题是房间卡焦点环被 `box-shadow:none !important` 压掉，已修；
  回归沉淀为 `scripts/kbd-regression.js`（5/5）。
- [ ] T5: 全量验证 + 独立评审 — acceptance: ui-regression 全量通过、相关检查
  通过，评审子代理结论无 critical（covers: S2.1/S2.3; depends: T2,T4）
