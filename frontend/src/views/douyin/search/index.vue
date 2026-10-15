<!-- 信息查询（原「匿名查询」）—— 按总览页卡片风格重做 -->
<template>
  <div class="douyin-page dy-stagger p-4">
    <!-- 顶部工具条 -->
    <div class="art-card dy-toolbar mb-5 flex items-center justify-between gap-4 flex-wrap">
      <!--
        左侧标题块保持原来的 flex（basis auto）。
        注意**不能**改成 flex-1/basis-0：那样在 1024 附近左侧块会被挤到接近 0 宽，
        统计行折成一竖条，反而更糟。真正的解法是把统计行压短（见下面去掉「列出前 N 个」），
        让它任何状态下都只占一行 —— 工具的抖动来自"这一行从 1 行变 2 行"。
      -->
      <div class="flex items-center gap-3 min-w-0">
        <div class="size-9 rounded-lg flex-cc bg-theme/10 shrink-0">
          <ArtSvgIcon icon="ri:user-search-line" class="text-base text-theme" />
        </div>
        <div class="min-w-0">
          <div class="dy-toolbar-title">信息查询</div>
          <!--
            全页唯一一处结果汇总：多少人有匹配、列出前几个、参与场次、累计钻石。
            原来结果区上方还单独有一行「共 N 个匹配用户 · 显示前 K」，和这里同一个数
            出现两次（用户反馈），已合并到这一行。
          -->
          <!-- 结果汇总行见工具条末尾的 .dy-result-stats（独占一整行，见那里的注释） -->
        </div>
      </div>

      <div class="dy-toolbar-actions">
        <!--
          查询范围：默认「全部直播间」；选中某个直播间时把 streamer_id 传给后端，
          SQL 只扫该直播间的场次，命中的用户变少 → 抖音接口补全调用量同步下降。
        -->
        <el-select
          v-model="scopeId"
          clearable
          filterable
          placeholder="全部直播间"
          style="width: 140px"
          popper-class="dy-select-popper"
          @change="onScopeChanged"
        >
          <el-option label="全部直播间" value="" />
          <el-option v-for="s in scopeOptions" :key="s.id" :label="s.name" :value="s.id" />
        </el-select>
        <!--
          场次范围：与「直播间」配合缩小范围 —— **必须先选直播间**才有场次可选
          （未选时禁用；实测搜「神秘人」库里命中 2,266 人，靠关键词本身无法收敛）。
        -->
        <el-select
          v-model="sessionId"
          clearable
          filterable
          :disabled="!scopeId"
          :placeholder="scopeId ? '全部场次' : '请先选择直播间'"
          style="width: 200px"
          popper-class="dy-select-popper"
          :loading="sessionLoading"
          @change="onSessionChanged"
        >
          <el-option
            v-for="s in sessionOptions"
            :key="s.id"
            :label="sessionLabel(s)"
            :value="s.id"
          />
        </el-select>
        <!--
          宽度 240px：placeholder「输入昵称关键词，回车查询」实测需要 234px 的**输入区**宽度
          （文本 168 + 放大镜前缀 22 + 清除后缀 22 + 内外边距 22），
          而 el-input 的装饰会吃掉 66px，所以外层至少要 234px。
          原来写 200px（输入区只剩 134px）→ 文案在「回车」处被截断（用户反馈）。
          窄屏不受影响：≤800px 时 douyin-mobile.scss 会把工具条控件统一拉成整行 100%。
        -->
        <el-input
          v-model="query"
          placeholder="输入昵称关键词，回车查询"
          style="width: 240px"
          clearable
          @keyup.enter="onQueryEnter"
          @clear="onQueryClear"
        >
          <template #prefix>
            <ArtSvgIcon icon="ri:search-line" class="text-g-400" />
          </template>
        </el-input>
        <!-- 固定宽度：`loading` 会插入转圈图标，不固定就会在点击后变宽（用户反馈） -->
        <el-button
          type="primary"
          :loading="loading"
          style="width: 88px"
          class="shrink-0"
          @click="doSearch"
        >
          <ArtSvgIcon v-if="!loading" icon="ri:search-line" class="mr-1" />
          查询
        </el-button>
      </div>

      <!--
        结果汇总行：**独占一整行**（basis-full），不参与上面那一行的宽度竞争。
        用户反馈"匹配用户等信息会变动导致排版难看、模块大小抖动"。
        实测根因：这一行会随结果变长（275 → 451px），把右侧控件组（704px）
        挤到第二行 —— 工具条高度 88 → 140px、控件组从 y=146 掉到 y=201。
        试过把它压短（去掉与 ⓘ 重复的「列出前 N 个」）让 1440 放得下：只差 12px，
        这种"差一点"的布局会随数据长度反复摇摆，不能算修好。
        独占一行后：这一行永远只占一行，控件组永远在第一行，任何屏宽/任何数据都不再抖。
        min-h-5（20px）固定一行高：加载态的「查询中…」只有 16px，不固定会让工具条差 4px。
        另外数字用等宽数位（.dy-count），计数更新时宽度也不变。
      -->
      <div
        class="dy-result-stats flex basis-full min-h-5 items-center gap-2.5 mt-3 text-xs text-g-500 flex-wrap min-w-0"
      >
        <!-- 加载中/失败时不显示（也不残留）上一轮的统计数字 -->
        <span v-if="loading">查询中…</span>
        <span v-else-if="queryError" class="text-danger">查询失败</span>
        <template v-else>
          <span class="flex items-baseline gap-1 shrink-0">
            <b class="dy-count text-g-900">{{ searched ? resultTotal : 0 }}</b>个匹配用户
          </span>
          <!--
            这里原来还有一段「· 列出前 N 个」，已去掉：
              1) 与 ⓘ 里的说明重复（toolbarTip 已写明"参与场次/累计钻石只统计本次列出的 N 人"）；
              2) 它把这一行从 275px 拉到 451px，是抖动的直接来源。
          -->
          <span class="w-px h-3 bg-g-300 shrink-0" />
          <span class="flex items-baseline gap-1 shrink-0">
            <b class="dy-count text-g-900">{{ totalSessions }}</b>个参与场次
          </span>
          <span class="w-px h-3 bg-g-300 shrink-0" />
          <span class="flex items-baseline gap-1 shrink-0">
            <b class="dy-count text-theme">{{ fmtNum(totalDiamonds) }}</b>累计钻石
          </span>
          <!-- 口径说明 + 明细都收进这一个 ⓘ（原来口径挂在 title 上、明细在结果区另一个 ⓘ） -->
          <el-tooltip placement="top" :show-after="100">
            <span
              class="inline-flex items-center justify-center size-5 shrink-0 rounded-full c-p hover:bg-g-100/70"
              role="img"
              aria-label="查询结果说明"
            >
              <ArtSvgIcon icon="ri:information-line" class="text-sm text-g-400" />
            </span>
            <template #content>
              <div class="max-w-[320px] leading-relaxed">{{ toolbarTip }}</div>
            </template>
          </el-tooltip>
        </template>
      </div>
    </div>

    <!--
      首次进入的引导。
      用户前后反馈过两次"难看"：
        第一版：卡片 620px 高而内容只占 350px（上下空一大片），两栏是"标签 + 裸内容"，
                关键词还被 JS 硬切成「萱萱🍋🍋🟩…」（emoji 切在中间）；
        第二版（把两块装进灰面板）仍然不好看 —— 两个带边框的盒子套在大卡片里，
                内容横向铺满 1400px，稀疏内容被拉得很散，整体像一张说明文档。
      本版：**居中窄列的空状态**（大图标 + 标题 + 说明 + 药丸标签），是这类页面最稳的做法：
        · 内容集中在 max-width 560px 的居中列里，不再横铺整屏；
        · 「怎么用」三步压成一行短提示（信息不丢，但不再占半屏文字）；
        · ⓘ 里只有结果口径说明，不含操作流程，所以这行提示必须保留。
      数据与文案都来自真实来源（真实主播名 + 真实可查范围），不放装饰性插画。
    -->
    <div v-if="!searched" class="art-card dy-search-guide dy-search-fill p-5">
      <div class="dy-search-guide__hero">
        <div class="dy-search-guide__icon">
          <ArtSvgIcon icon="ri:user-search-line" />
        </div>
        <h4 class="dy-search-guide__title">开始查询</h4>
        <p class="dy-search-guide__desc">
          支持昵称模糊匹配，数据来自本库的弹幕、礼物与进场记录
        </p>

        <div class="dy-search-guide__chips">
          <button
            v-for="kw in hotKeywords"
            :key="kw"
            class="dy-search-guide__chip dy-pressable"
            :title="kw"
            @click="quickSearch(kw)"
          >
            {{ kw }}
          </button>
        </div>

        <p class="dy-search-guide__hint">
          点标签直接查询，也可以输入关键词后回车；结果里点头像或昵称可进入用户画像
        </p>
        <p class="dy-search-guide__hint">
          查询会调用抖音接口补全用户资料，人数较多时会分批请求，请稍候
        </p>
      </div>

      <!-- 真实可查范围（来自已加载的主播/场次数据，不是写死的文案） -->
      <div v-if="scopeOptions.length" class="dy-search-guide__foot">
        可查范围：{{ scopeOptions.length }} 个直播间 · {{ scopeSessionTotal }} 场直播
      </div>
    </div>

    <div v-else>
      <!--
        加载态不再用 v-loading 大面积遮罩：
        那会在结果区盖一块白板（用户反馈"遮罩下有大片矩形空白，不是无感"）。
        改成——首次查询显示与卡片同形的骨架屏；已有结果时保留旧结果并轻微变淡，
        由工具条上的「查询中…」提示进度，视觉上几乎没有跳变。
      -->
      <div v-if="loading && !sortedUsers.length" class="grid grid-cols-1 xl:grid-cols-2 gap-5">
        <div v-for="i in 4" :key="i" class="art-card p-5">
          <div class="flex items-center gap-4">
            <el-skeleton-item variant="circle" style="width: 56px; height: 56px" />
            <div class="flex-1 min-w-0">
              <el-skeleton-item variant="h3" style="width: 40%" />
              <el-skeleton-item variant="text" style="width: 70%; margin-top: 8px" />
            </div>
          </div>
          <el-skeleton :rows="3" animated class="mt-4" />
        </div>
      </div>

      <!--
        失败：与「没有结果」明确区分（P0-3）。
        同样占满内容区（.dy-search-fill）—— 引导态 / 失败态 / 空结果态三种非结果状态高度一致，
        不会出现"一种占满屏、另一种只有一小条"的情况。
        QueryErrorState 用在自己内部是紧凑卡片（其它页也用它），这里只在本页加类，不影响别处。
      -->
      <QueryErrorState
        v-else-if="!loading && queryError"
        class="dy-search-fill"
        :message="queryError"
        :retrying="loading"
        @retry="doSearch"
      />

      <!-- 空结果：只有查询真的成功且确实没人时才显示 -->
      <!--
        占满内容区（.dy-search-fill）：原来只是一条矮卡片，和「开始查询」引导态观感不一致
        （用户反馈"没有匹配的这个窗口没有占满全屏"）。图例尺寸同步放大到 96，撑得住整块高度。
      -->
      <div v-else-if="!loading && !sortedUsers.length" class="art-card dy-search-fill p-5">
        <el-empty :description="`没有匹配「${lastQuery}」的用户`" :image-size="96">
          <template #description>
            <p class="dy-search-empty__title">没有匹配「{{ lastQuery }}」的用户</p>
            <p class="dy-search-empty__hint">
              换一个关键词，或先在右上角选一个直播间 / 场次缩小范围再查
            </p>
          </template>
        </el-empty>
      </div>

      <!-- 结果卡片（重新查询时保留上一批并轻微变淡，避免"整块白板一闪"） -->
      <template v-else>
        <!--
          结果区不再有汇总行：「多少人有匹配 / 列出前几个」都在上方工具条那一行里，
          明细在它的 ⓘ 里（原来这里单独一行 + 另一个 ⓘ，同一条信息出现两次）。
        -->
        <ElRow
          :key="`${lastQuery}|${lastScope}|${resultTotal}|${returnedCount}`"
          :gutter="20"
          class="dy-fade-in"
          :class="loading ? 'opacity-60 transition-opacity duration-200' : 'transition-opacity duration-200'"
        >
          <ElCol
            v-for="u in sortedUsers"
            :key="u.sec_uid || u.nickname"
            :sm="24"
            :md="12"
            :lg="12"
            class="mb-5"
          >
            <!--
              间距放在 el-col 上、卡片 h-full 撑满列高：同一行里内容行数不同的卡片才不会高低不齐。
              卡片本身是纵向 flex，底部「最近参与」用 mt-auto 贴底 ——
              否则同一行里内容多的那张卡片分隔线在底部、内容少的悬在中间，两条线错开很扎眼。
            -->
            <div class="art-card relative px-5 py-4 h-full flex flex-col">
              <!-- 头部：头像 + 昵称 + 别名 -->
              <div class="flex items-start gap-3.5">
                <el-avatar :size="48" :src="u.avatar" class="shrink-0">
                  {{ (u.nickname || '?')[0] }}
                </el-avatar>
                <div class="flex-1 min-w-0">
                  <div class="flex items-center gap-2">
                    <span class="text-base font-medium text-g-900 truncate leading-snug">
                      {{ u.nickname || '未知用户' }}
                    </span>
                    <el-tag v-if="u.unique_id" size="small" effect="plain" class="shrink-0">
                      ID {{ u.unique_id }}
                    </el-tag>
                  </div>
                  <div class="flex items-center gap-1.5 mt-1 flex-wrap min-h-[20px]">
                    <span
                      v-if="u.ip_location"
                      class="inline-flex items-center gap-1 text-xs text-g-500"
                    >
                      <ArtSvgIcon icon="ri:map-pin-line" class="text-g-400" />{{ u.ip_location }}
                    </span>
                    <span v-if="u.user_gender" class="text-xs text-g-500">
                      {{ u.user_gender === 1 ? '男' : '女' }}
                    </span>
                    <span v-if="u.is_private" class="text-xs text-warning">私密账号</span>
                    <span v-if="!u.sec_uid" class="text-xs text-g-400">库里没有用户标识</span>
                    <!--
                      兜底信息：这个用户的抖音资料没取到时（没有 ip/性别/私密），
                      这一行原来会留成一条空白（为卡片等高预留的 min-h）。
                      填上"库内记录数 + 首次出现"既不留白，也顺带回答了"数据全不全"。
                    -->
                    <span
                      v-if="
                        u.sec_uid &&
                        u.total_records &&
                        !u.ip_location &&
                        !u.user_gender &&
                        !u.is_private
                      "
                      class="text-xs text-g-500 truncate"
                    >
                      库内 {{ u.total_records }} 条记录 · 首次 {{ fmtDate(u.first_seen) }}
                    </span>
                  </div>

                  <!--
                    库内别名：跟在昵称下面（同属"这个人的身份信息"）。
                    一个人可能有一二十个名字，其中绝大多数是抖音给未登录访客生成的 douXXXXXXX
                    （实测样本 30 个名字里 28 个是这种）——全铺出来非常吵。
                    所以只内联"像真名"的（最近 2 个 + 最早 1 个），游客名压成一个入口，点开看全部；
                    名字长时可以换行（不截断），最少占一行。
                  -->
                  <!--
                    名字长时**换行**而不是截断。
                    原来写的是 `max-w-[220px] truncate` —— 与注释相反，而且
                    el-tag 的文字在**内层 span**（.el-tag__content）里，
                    外层 truncate 拦不住它：长名字会溢出标签、压到旁边的字上
                    （用户反馈的"库内别名存在被截断的遮挡"）。
                    现在放开高度、允许断行：!h-auto + whitespace-normal + break-all。
                  -->
                  <div class="flex flex-wrap items-center gap-1.5 mt-2 min-w-0 min-h-[22px]">
                    <span class="text-xs text-g-400 shrink-0">库内别名</span>
                    <el-tag
                      v-for="n in aliasNames(u)"
                      :key="n"
                      size="small"
                      effect="plain"
                      type="info"
                      class="!h-auto max-w-full whitespace-normal break-all leading-5 !py-0.5"
                      :title="n"
                    >
                      {{ n }}
                    </el-tag>
                    <el-popover
                      v-if="tempAliases(u).length"
                      placement="top"
                      :width="300"
                      trigger="click"
                    >
                      <template #reference>
                        <button class="dy-pressable text-xs text-theme shrink-0">
                          另有 {{ tempAliases(u).length }} 个游客名
                        </button>
                      </template>
                      <div class="text-xs text-g-500 mb-2">
                        抖音自动生成的游客/匿名名字（不在卡片上展示）：
                      </div>
                      <div class="max-h-[220px] overflow-auto flex flex-wrap gap-1.5">
                        <el-tag
                          v-for="a in tempAliases(u)"
                          :key="a.nickname"
                          size="small"
                          effect="plain"
                          type="info"
                        >
                          {{ a.nickname }}
                        </el-tag>
                      </div>
                    </el-popover>
                    <span v-if="!aliasList(u).length" class="text-xs text-g-400">—</span>
                  </div>
                </div>
                <el-button
                  v-if="u.sec_uid"
                  size="small"
                  type="primary"
                  class="shrink-0"
                  @click="router.push(`/douyin/profile/${u.sec_uid}`)"
                >
                  画像
                </el-button>
              </div>

              <!-- 仅进场用户：三个空格子降噪成一行（占结果的大多数，满屏虚线格最扎眼） -->
              <div
                v-if="isEntryOnly(u)"
                class="mt-3.5 pt-3 border-t border-g-100/80 flex items-center gap-3 flex-wrap text-sm"
              >
                <span class="inline-flex items-center gap-1.5 text-g-500">
                  <ArtSvgIcon icon="ri:door-open-line" class="text-g-400" />
                  仅进场
                </span>
                <span class="text-g-600">
                  参与 <b class="text-g-900 font-medium">{{ u.sessions?.length || 0 }}</b> 场
                </span>
                <span class="text-g-400 text-xs">
                  没有弹幕与送礼<template v-if="!hasSessions(u)">
                    （查询只取最近 200 条匹配记录）</template
                  >
                </span>
              </div>

              <template v-else>
                <!-- 统计格：套官方 today-sales 的 tile 语言（实线框 + 图标块 + 数字上标签下） -->
                <div class="grid grid-cols-3 gap-2.5 mt-4">
                  <div class="dy-stat-tile flex items-center gap-3 px-4 py-3 border border-g-300/85 rounded-xl">
                    <div class="size-9 rounded-lg flex-cc bg-theme/10 shrink-0">
                      <ArtSvgIcon icon="ri:live-line" class="text-base text-theme" />
                    </div>
                    <div class="min-w-0">
                      <div
                        class="text-xl font-medium leading-none truncate"
                        :class="hasSessions(u) ? 'text-g-900' : 'text-g-400'"
                        :title="hasSessions(u) ? String(participatedSessions(u)) : ''"
                      >
                        {{ hasSessions(u) ? fmtNum(participatedSessions(u)) : '—' }}
                      </div>
                      <div class="text-xs text-g-500 mt-1.5">参与场次</div>
                    </div>
                  </div>
                  <div class="dy-stat-tile flex items-center gap-3 px-4 py-3 border border-g-300/85 rounded-xl">
                    <div class="size-9 rounded-lg flex-cc bg-theme/10 shrink-0">
                      <ArtSvgIcon icon="ri:diamond-line" class="text-base text-theme" />
                    </div>
                    <div class="min-w-0">
                      <div
                        class="text-xl font-medium leading-none truncate"
                        :class="u.total_diamonds ? 'text-theme' : 'text-g-400'"
                        :title="u.total_diamonds ? fmtTitle(u.total_diamonds) : ''"
                      >
                        {{ u.total_diamonds ? fmtNum(u.total_diamonds) : '—' }}
                      </div>
                      <div class="text-xs text-g-500 mt-1.5">累计钻石</div>
                    </div>
                  </div>
                  <div class="dy-stat-tile flex items-center gap-3 px-4 py-3 border border-g-300/85 rounded-xl">
                    <div class="size-9 rounded-lg flex-cc bg-theme/10 shrink-0">
                      <ArtSvgIcon icon="ri:chat-3-line" class="text-base text-theme" />
                    </div>
                    <div class="min-w-0">
                      <div
                        class="text-xl font-medium leading-none truncate"
                        :class="u.danmaku_count ? 'text-g-900' : 'text-g-400'"
                        :title="u.danmaku_count ? fmtTitle(u.danmaku_count) : ''"
                      >
                        {{ u.danmaku_count ? fmtNum(u.danmaku_count) : '—' }}
                      </div>
                      <div class="text-xs text-g-500 mt-1.5">弹幕数</div>
                    </div>
                  </div>
                </div>
              </template>

              <!--
                最近三条动作：显示这个用户**最近做的三件事**（弹幕/送礼/进场混合、按时间倒序），
                不是"三种动作各一条" —— 后者会把"最近连发三条弹幕、礼物是五天前"显示错。
                数据来自后端 recent（≤3 条）；不足 3 条用占位补齐，保持三行固定高度、卡片等高。
              -->
              <!--
                固定两行：最近一次弹幕 / 最近一次礼物。
                不再有"三条动作"与进场行（进场记录只在画像页的近期行为里，并带上直播间）。
                取值优先用后端 recent（它已按时间倒序且做过连击礼物去重，连击只留 ×N 那条），
                没有 recent 时回退到 latest_danmaku / latest_gift。
              -->
              <div class="flex flex-col gap-2 mt-4 pt-3 border-t border-g-100/80">
                <div v-if="latestOf(u, 'danmaku')" class="flex items-center gap-2 text-xs">
                  <span class="px-1.5 py-0.5 rounded-md bg-blue-50 text-blue-500 shrink-0">弹幕</span>
                  <span
                    class="flex-1 min-w-0 truncate text-g-700"
                    v-html="emojiHtml(latestOf(u, 'danmaku').detail)"
                  ></span>
                  <span class="text-g-400 shrink-0">{{ fmtTime(latestOf(u, 'danmaku').time) }}</span>
                </div>
                <div v-else class="flex items-center gap-2 text-xs">
                  <span class="px-1.5 py-0.5 rounded-md bg-blue-50/60 text-blue-400 shrink-0">弹幕</span>
                  <span class="flex-1 min-w-0 text-g-400">无记录</span>
                </div>

                <div v-if="latestOf(u, 'gift')" class="flex items-center gap-2 text-xs">
                  <span class="px-1.5 py-0.5 rounded-md bg-amber-50 text-amber-600 shrink-0">礼物</span>
                  <span
                    class="flex-1 min-w-0 truncate text-g-600"
                    v-html="emojiHtml(latestOf(u, 'gift').detail)"
                  ></span>
                  <span class="text-g-400 shrink-0">{{ fmtTime(latestOf(u, 'gift').time) }}</span>
                </div>
                <div v-else class="flex items-center gap-2 text-xs">
                  <span class="px-1.5 py-0.5 rounded-md bg-amber-50/60 text-amber-500 shrink-0">礼物</span>
                  <span class="flex-1 min-w-0 text-g-400">无记录</span>
                </div>
              </div>

              <!-- 贴底占位：mt-auto 把剩余高度吃掉，底部分隔线上方仍保留固定的 12px 间隙 -->
              <div class="mt-auto" aria-hidden="true"></div>

              <!-- 底部：参与场次入口（恒定渲染、强制单行：只放最近 1 场，多的用"还有 N 场"，
                   否则长主播名会把这一行折成两行、卡片高度又不一致） -->
              <div
                class="flex items-center gap-2 mt-3 pt-3 border-t border-g-100/80 text-xs text-g-600 min-w-0"
              >
                <ArtSvgIcon icon="ri:time-line" class="text-g-400 shrink-0" />
                <span class="shrink-0">最近参与</span>
                <template v-if="u.sessions?.length">
                  <button
                    class="dy-pressable px-2 h-6 rounded-md bg-g-100/70 text-g-700 hover:bg-theme/10 hover:text-theme truncate max-w-[220px]"
                    @click="router.push(`/douyin/detail/${u.sessions[0].id}`)"
                  >
                    {{ u.sessions[0].streamer_name || '场次 #' + u.sessions[0].id }} ·
                    {{ fmtSessionTime(u.sessions[0].start_time) }}
                  </button>
                  <span v-if="u.sessions.length > 1" class="text-g-400 shrink-0">
                    还有 {{ u.sessions.length - 1 }} 场
                  </span>
                </template>
                <span v-else class="text-g-400">暂无参与场次</span>
              </div>
            </div>
          </ElCol>
        </ElRow>
      </template>
    </div>
  </div>
</template>

<script setup lang="ts">
  import { computed, onActivated, onMounted, ref, watch } from 'vue'
  import { useRouter } from 'vue-router'
  import {
    anonymousLookup,
    fetchStreamers,
    fetchSessions,
    type Streamer,
    type Session
  } from '@/api/douyin'
  import { fmtNum, fmtTime, fmtTitle, fmtSessionTime, fmtDate } from '@/utils/format'
  import { emojiHtml } from '@/utils/douyin-emoji'
  import { ElMessage } from 'element-plus'
  import { apiErrorMessage } from '@/utils/douyin-error'

  defineOptions({ name: 'DouyinSearch' })

  const router = useRouter()

  const query = ref('')
  const lastQuery = ref('')
  /** 上一次查询实际使用的范围（展示的是"当时查了什么"，不是当前下拉的值） */
  const lastScope = ref('')
  const results = ref<any[]>([])
  const loading = ref(false)
  const searched = ref(false)
  /** 查询失败的真实原因；非空时显示错误态而不是「没有匹配的用户」（P0-3） */
  const queryError = ref('')
  /**
   * 场次范围（与「直播间」配合缩小范围）。
   * 后端 anonymous-lookup 早就支持 session_id 过滤，这里把它露出来：
   * 搜「神秘人」这类高频词时，库里真实命中 2,266 人，光靠关键词无法收敛。
   */
  const sessionId = ref<number | string>('')
  const sessionOptions = ref<Session[]>([])
  const sessionLoading = ref(false)

  /** 本次查询的真实规模（后端返回，不受"返回条数上限"影响） */
  const resultTotal = ref(0)
  const returnedCount = ref(0)
  const orphanRecords = ref(0)
  /** 库内命中的记录总条数（真实规模，不是本页卡片数） */
  const totalRecords = ref(0)
  const truncated = computed(
    () => returnedCount.value > 0 && resultTotal.value > returnedCount.value
  )

  /**
   * 查询范围（默认全部直播间）。
   * 选中具体直播间时会把 streamer_id 传给后端做 SQL 缩圈 ——
   * 命中用户少了，抖音接口补全的调用量也随之下降。
   */
  const scopeId = ref<number | string>('')
  const scopeOptions = ref<Streamer[]>([])

  async function loadScopeOptions() {
    try {
      const list = await fetchStreamers()
      scopeOptions.value = [...list].sort((a, b) => (b.session_count ?? 0) - (a.session_count ?? 0))
    } catch {
      // 范围下拉是增强能力，拿不到就只剩「全部直播间」，不打断查询
    }
  }

  /**
   * 场次下拉：选了直播间就列该直播间的场次，否则列全部场次（只取最近 300 场，避免下拉过长）。
   *
   * 注意字段名：`/api/hosts/:id/sessions` 返回的是 `started_at`，
   * 而 `/api/sessions` 返回原始行的 `start_time` —— 两种都要兼容，
   * 否则选了直播间之后每项都渲染成「主播名 ·」（时间为空）。
   */
  function sessionTime(s: any): string {
    return String(s?.start_time || s?.started_at || '')
  }

  let sessionSeq = 0

  async function loadSessionOptions() {
    const my = ++sessionSeq
    sessionLoading.value = true
    try {
      // 场次必须先选直播间：未选时清空选项、不发请求（用户要求）
      const scoped = scopeId.value !== '' && scopeId.value != null
      if (!scoped) {
        sessionOptions.value = []
        return
      }
      const list = await fetchSessions(String(scopeId.value))
      if (my !== sessionSeq) return // 连点两个直播间时，丢弃先发的响应
      sessionOptions.value = [...list].sort((a, b) => sessionTime(b).localeCompare(sessionTime(a)))
    } catch {
      // 场次下拉是增强能力，拿不到就只剩「全部场次」，不打断查询
      if (my === sessionSeq) sessionOptions.value = []
    } finally {
      if (my === sessionSeq) sessionLoading.value = false
    }
  }

  /** 直播间变了：重载场次列表并清掉已选场次；已经查过就按新范围重查 */
  async function onScopeChanged() {
    sessionId.value = ''
    await loadSessionOptions()
    if (searched.value && query.value.trim()) doSearch()
  }

  /** 场次变了：已经查过就按新范围重查 */
  function onSessionChanged() {
    if (searched.value && query.value.trim()) doSearch()
  }

  function sessionLabel(s: any): string {
    return `${s.streamer_name || '未知主播'} · ${sessionTime(s).slice(0, 16)}`
  }

  /** 按 id 取场次的展示名（查询时用；查不到就退化成 #id，不隐藏已选范围） */
  function sessionLabelById(id: string | number): string {
    const s = sessionOptions.value.find((x) => String(x.id) === String(id))
    return s ? sessionLabel(s) : `#${id}`
  }

  onMounted(() => {
    loadScopeOptions()
    loadSessionOptions()
  })

  /**
   * keepAlive 页面：切走再回来时刷新两个下拉（新增/改名的直播间、新场次），
   * 但不动 query / results —— 用户回来的第一诉求是"我的结果还在"。
   * 其余 5 个抖音页也有 onActivated，这里原来漏了。
   */
  onActivated(() => {
    loadScopeOptions()
    loadSessionOptions()
  })

  /**
   * 示例关键词：从**真实的主播名**里取（按场次数排序后的前 4 个）+「神秘人」。
   *
   * 原来是写死的 ['无限','苏江','林语巷','神秘人'] —— 直播间一换这几个词就搜不到东西了，
   * 用户点了会得到空结果（比没有示例更糟：看起来像查询坏了）。
   * 「神秘人」保留：这是匿名用户的昵称前缀，库里一定有。
   */
  const hotKeywords = computed(() => {
    const names = scopeOptions.value
      .map((s) => (s.name || '').trim())
      .filter((n) => n && !n.includes('神秘人'))
      .slice(0, 4)
    return [...names, '神秘人']
  })

  /** 可查范围里的场次总数（真实数据，来自已加载的主播列表） */
  const scopeSessionTotal = computed(() =>
    scopeOptions.value.reduce((sum, s) => sum + (s.session_count ?? 0), 0)
  )

  const users = computed(() => results.value || [])

  const totalDiamonds = computed(() =>
    users.value.reduce((sum, u) => sum + (u.total_diamonds || 0), 0)
  )
  const totalSessions = computed(
    // 去重统计：同一场次里有多个匹配用户时只算一场（原来是把各人的场次数相加，得到的是"人次"）
    () => new Set(users.value.flatMap((u) => (u.sessions || []).map((s: any) => s.id))).size
  )

  /** 「仅进场记录」= 没弹幕没送礼 —— 排序时整体沉底（用户决定：照常展示仅靠后） */
  function isEntryOnly(u: any): boolean {
    return !u.danmaku_count && !u.total_diamonds
  }

  const sortedUsers = computed(() => {
    const num = (v: any) => (typeof v === 'number' ? v : 0)
    // 用后端"取前 limit 个"的同一个键排序（命中记录的最后出现时间）：
    // 原来按 latest_action（全库、且弹幕/送礼优先于进场）重排，会出现
    // "被截掉的人比页面上的人更活跃"，顺序也解释不通。
    const list = [...users.value].sort(
      (a, b) => num(b.matched_last_time) - num(a.matched_last_time)
    )
    // 「仅进场」整体挪到最后（组内相对顺序不变）
    return [...list.filter((u) => !isEntryOnly(u)), ...list.filter(isEntryOnly)]
  })

  /** 结果里「仅进场」的数量（结果头与卡片降噪共用同一口径） */
  const entryCount = computed(
    // 排除"无用户标识"的条目：它们是按昵称聚合的匿名记录组，不是用户实体
    () => users.value.filter((u) => u.sec_uid && isEntryOnly(u)).length
  )

  /** 本次查询的统计全部归零（切换查询/失败时必须调用，否则工具栏挂着上一轮的数字） */
  function resetStats() {
    resultTotal.value = 0
    returnedCount.value = 0
    orphanRecords.value = 0
    totalRecords.value = 0
  }

  /**
   * 请求序号：连续切换直播间/场次会连发多个请求，慢的先发响应可能后到并覆盖新结果，
   * 造成"下拉是新的、卡片是旧的"。每次请求领一个号，回来时对不上就直接丢弃。
   */
  let searchSeq = 0

  /**
   * 信息查询。
   *
   * P0-3 修复点：原来 catch 里直接 `results.value = []` ——
   * 网络失败/后端 500 被渲染成「没有匹配『xxx』的用户」，
   * 与「确实查不到这个人」在界面上**完全一样**，
   * 使用者会以为这个人没送过礼，而真相是这次查询根本没成功。
   * 现在失败单独进入错误态（带重试），空结果只在真的查成功且为空时出现。
   */
  async function doSearch() {
    const q = query.value.trim()
    if (!q) {
      // 空关键词：说一句，而不是静默无反应（禁用态按钮在浅色模式下对比度只有 1.74:1，已回退）
      ElMessage.info('请先输入昵称关键词')
      return
    }
    const my = ++searchSeq
    loading.value = true
    searched.value = true
    lastQuery.value = q
    queryError.value = ''
    // 加载中不展示上一轮的数字（结果头特意做了同样处理，工具栏这里原来漏了）
    resetStats()
    // 记录本次查询的真实范围（展示口径以"当时查的"为准）
    const scoped = scopeId.value !== '' && scopeId.value != null
    const scopeName = scoped
      ? scopeOptions.value.find((s) => String(s.id) === String(scopeId.value))?.name || ''
      : ''
    // 场次参数直接用选中的值：不要依赖 sessionOptions 查得到，
    // 否则下拉重载失败/被 slice 截断时，界面显示"已选场次"但请求其实没带 session_id
    const sess = sessionId.value !== '' && sessionId.value != null ? String(sessionId.value) : ''
    lastScope.value =
      (scoped ? `范围：${scopeName}的直播间` : '范围：全部直播间') +
      (sess ? ` · 场次 ${sessionLabelById(sess)}` : '')
    try {
      const res: any = await anonymousLookup(
        q,
        scoped ? String(scopeId.value) : undefined,
        sess || undefined
      )
      if (my !== searchSeq) return // 已经有更新的查询发出，丢弃这次的结果
      results.value = res?.users || (Array.isArray(res) ? res : [])
      resultTotal.value = Number(res?.total_users ?? results.value.length)
      returnedCount.value = Number(res?.returned_users ?? res?.returned ?? results.value.length)
      orphanRecords.value = Number(res?.orphan_records || 0)
      totalRecords.value = Number(res?.total_records || 0)
      queryError.value = ''
    } catch (e) {
      if (my !== searchSeq) return
      results.value = []
      resetStats()
      queryError.value = apiErrorMessage(e, '查询失败')
    } finally {
      if (my === searchSeq) loading.value = false
    }
  }

  function quickSearch(kw: string) {
    query.value = kw
    doSearch()
  }

  /**
   * 回车查询：中文输入法用回车"上屏候选词"时也会触发 keyup.enter，
   * 那会拿半成品关键词发一次查询（还白耗一次抖音接口调用）。
   */
  function onQueryEnter(e: KeyboardEvent) {
    if (e.isComposing) return
    doSearch()
  }

  /**
   * 工具条 ⓘ 的内容：口径说明（哪些数字是"本次列出的人"的口径）+ 明细。
   * 两段原来分别挂在工具条的 title 和结果区的另一个 ⓘ 上，现在合成一个提示。
   */
  const toolbarTip = computed(() => {
    const parts = []
    if (truncated.value) {
      parts.push(`「匹配用户」是库内全量；「参与场次 / 累计钻石」只统计本次列出的 ${returnedCount.value} 人`)
    }
    parts.push(detailTip.value)
    return parts.join('。')
  })

  /** 结果头的明细说明（悬浮提示用）：原来这些直接铺在页面上，一行两百多字没重点 */
  const detailTip = computed(() => {
    const parts = [`库内命中 ${fmtNum(totalRecords.value)} 条记录`]
    if (truncated.value) {
      parts.push(
        `按命中记录的最后出现时间排序，本次只显示前 ${returnedCount.value} 个 —— 可用上方「直播间 / 场次」缩小范围`
      )
    }
    if (entryCount.value) parts.push(`其中仅进场 ${entryCount.value} 个，排在最后`)
    if (orphanRecords.value) {
      parts.push(
        `另有 ${orphanRecords.value} 条记录没有用户标识` +
          (truncated.value ? '（本次未列出）' : '（单列在最后）')
      )
    }
    return parts.join('；')
  })

  /**
   * 卡片上「最近一次弹幕 / 最近一次礼物」的取值。
   * 优先用后端 `recent`（按时间倒序 + 已做连击礼物去重，连击只保留 ×N 那条），
   * 回退到 latest_danmaku / latest_gift —— 这样连击礼物不会显示成 ×1/×2/×3 三行。
   */
  function latestOf(u: any, type: 'danmaku' | 'gift'): any {
    const hit = (Array.isArray(u?.recent) ? u.recent : []).find((a: any) => a.type === type)
    if (hit) return hit
    return type === 'danmaku' ? u?.latest_danmaku || null : u?.latest_gift || null
  }

  /** 清空输入框：回到"未查询"引导态。
   * 原来只有 clearable 没有 @clear —— 点 ✕ 后卡片和「共 N 个匹配用户」还在、
   * 标签还是旧词，而按回车/点查询毫无反应（doSearch 里 `if (!q) return`）。
   */
  function onQueryClear() {
    searchSeq++ // 作废在途请求，避免清空后旧响应又灌回来
    query.value = ''
    searched.value = false
    results.value = []
    queryError.value = ''
    lastQuery.value = ''
    lastScope.value = ''
    resetStats()
  }

  /**
   * 手工把关键词删到空（不是点 ✕）时同样复位：
   * 实测两种"变空"的路径只会触发其中一种事件，只挂 @clear 会漏掉手动删除。
   */
  watch(query, (v) => {
    if (!String(v).trim() && searched.value) onQueryClear()
  })

  function hasSessions(u: any): boolean {
    return Boolean(u?.sessions?.length)
  }

  /**
   * 参与场次：优先用后端给的 `session_count`（COUNT 查询，与画像页同一口径）。
   *
   * 原来这里用 `u.sessions.length` —— 那个数组来自 collectNameHistory 的
   * **≤5000 行**历史，活跃用户会被截断，于是卡片数字比画像页小一大截
   * （用户反馈的"信息查询卡片参与场次、弹幕数和画像页不一致"）。
   * `sessions` 仍然保留给"最近场次入口"用，只是不再拿它的长度当统计值。
   */
  function participatedSessions(u: any): number {
    const n = Number(u?.session_count)
    return Number.isFinite(n) && n > 0 ? n : (u?.sessions?.length ?? 0)
  }

  /**
   * 库内别名：一个 sec_uid 在库里出现过的**所有名字**（按出现次数降序）。
   *
   * 后端 /api/anonymous-lookup 现在按 sec_uid 做全库聚合，返回 `nickname_stats`；
   * 一个人改过名时可能有一二十个名字（其中大量是抖音给游客生成的 douXXXXXXX），
   * 卡片上只内联"像真名"的几个，其余走 popover —— 见 realAliases / tempAliases。
   */
  /** 一个名字在库里的出现情况（first/last 是毫秒时间戳，用来挑"最近 2 个 + 最早 1 个"） */
  interface AliasStat {
    nickname: string
    count: number
    first?: number
    last?: number
    /** 是否为抖音自动生成的名字（douxxx / 神秘人…），由后端判定 */
    generated?: boolean
  }

  function aliasList(u: any): AliasStat[] {
    if (Array.isArray(u?.nickname_stats) && u.nickname_stats.length) {
      // 注意：这里必须把 first/last/generated 一起带出来，
      // 否则 aliasNames 的"最近/最早"排序拿不到时间、generated 判定也失效
      return u.nickname_stats.map((s: any) => ({
        nickname: s.nickname,
        count: s.count || 0,
        first: s.first || 0,
        last: s.last || 0,
        generated: !!s.generated
      }))
    }
    return (u?.db_nicknames || []).map((n: string) => ({ nickname: n, count: 0 }))
  }

  /*
   * 原来这里有一份本地的日期格式化 fmtDay()（毫秒/秒时间戳 → 2026/06/25）。
   * 它与 utils/format.ts 的 fmtSessionTime() 输出完全一致 —— 属于"同一件事两套代码"，
   * 而且空值行为已经不一致（这里 '—'、那边空串）。
   * 现在统一用共享的 fmtDate()（默认兜底就是 '—'，与本页原来一致），解析逻辑只维护一处。
   */

  /**
   * 是否为自动生成的名字：优先用后端给的 generated 字段（判定规则只维护一处），
   * 正则仅作兜底（例如后端未返回该字段时）。
   */
  const GENERATED_ALIAS_RE = /^(dou\d+|神秘人)/i

  function isGeneratedAlias(a: AliasStat): boolean {
    return typeof a.generated === 'boolean' ? a.generated : GENERATED_ALIAS_RE.test(a.nickname)
  }

  /** 真实昵称（不含自动生成的游客名），按出现次数降序（aliasList 已排好序） */
  function realAliases(u: any): AliasStat[] {
    return aliasList(u).filter((a) => !isGeneratedAlias(a))
  }

  /**
   * 卡片上展示的真名：最多 3 个 —— **最近用过的 2 个 + 最早用过的 1 个**（用户定的规则）。
   * 依据 nickname_stats 里的 first/last 时间戳；不足 3 个就全显示。
   * 「最近 2 个」反映现在叫什么，「最早 1 个」保留最初认识他时的名字。
   */
  function aliasNames(u: any): string[] {
    const list = realAliases(u)
    if (!list.length) return []
    // 展示顺序统一按规则来（不因名字个数而变）：最近的 2 个在前，最早的 1 个在后
    const recent = [...list].sort((a, b) => (b.last || 0) - (a.last || 0)).slice(0, 2)
    const earliest = [...list].sort((a, b) => (a.first || 0) - (b.first || 0))[0]
    const out = recent.map((a) => a.nickname)
    if (earliest && !out.includes(earliest.nickname)) out.push(earliest.nickname)
    // 不足 3 个（例如只有 1~2 个真名）时按出现次数补足
    for (const a of list) {
      if (out.length >= 3) break
      if (!out.includes(a.nickname)) out.push(a.nickname)
    }
    return out.slice(0, 3)
  }

  /** 自动生成的游客名，收进 popover 里"点开看全部" */
  function tempAliases(u: any): AliasStat[] {
    return aliasList(u).filter((a) => isGeneratedAlias(a))
  }

  /**
   * 弹幕/动作文本里的抖音表情代码（[比心]、[捂脸]）交给 emojiHtml 渲染成图。
   *
   * 原来这里先用一个正则把开头的方括号段删掉，注释说是"去掉后端带的 [礼物] 前缀"——
   * 但后端从来不产生这种前缀，而弹幕内容**本身就是** [xxx] 形式的表情代码，
   * 于是整条弹幕是 [比心] 时会被整段删掉，卡片上那行变成空白（用户反馈）。
   * 表情代码是内容的一部分，不能当噪音剥掉。
   */
</script>

<style scoped lang="scss">
  /* 工具条控件圆角/间距与卡片统一（与状态监控页同一套） */
  @use '@styles/custom/douyin-toolbar.scss';

  /*
   * 首次进入的引导：占满可视区，别让页面看起来"没加载完"。
   *
   * 高度用 clamp 而不是写死：不同窗口高度下都要正好填到视口底部附近的留白，
   * 又不能在小窗口里撑出滚动条（那还不如原来矮卡片）。
   * 上限 620px 是按 1440×900 实测的可用高度（视口 900 − 顶栏/标签栏/工具条/间距 ≈ 620）。
   */
  /*
   * 注意选择器写成 `.art-card.dy-search-guide`（两个类）：
   * 库里的 `.art-card` 也是单类权重，**.art-card 的样式在这个 scoped 块之后注入**，
   * 单写 `.dy-search-guide` 会被它的 display/justify-content 盖掉（实测 justify-content 无效）。
   */
  /*
   * 统计数字用**等宽数位**：数字从 0 → 1,234 → 855.44万 变化时，
   * 每个数字占宽一致，更新/计数时不会左右抖。
   */
  .dy-count {
    font-variant-numeric: tabular-nums;
  }

  /*
   * 占满内容区的空态卡：「开始查询」引导 与「没有匹配」空结果 共用。
   * 用户反馈空结果那张卡片只有一小条、没占满屏，和引导态观感不一致。
   * 选择器必须写满两个类：库里 `.art-card` 也是单类权重、且在本 scoped 块之后注入，
   * 单写 `.dy-search-fill` 会被它的 display/justify-content 盖掉。
   * min-height 不裁剪：内容更高时卡片自己长高，小窗口也不会出滚动条。
   */
  .art-card.dy-search-fill {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    min-height: clamp(420px, calc(100vh - 330px), 720px);
  }

  .dy-search-guide {
    text-align: center;
  }

  /* 空结果：主文案 + 一行可操作建议（原来只有 el-empty 自带的一行灰字） */
  .dy-search-empty__title {
    margin: 0;
    font-size: 15px;
    font-weight: 500;
    color: var(--art-gray-900);
  }

  .dy-search-empty__hint {
    margin: 6px 0 0;
    font-size: 12px;
    line-height: 1.7;
    /* gray-500 对白底只有 2.68:1（AA 小字要 4.5），所以用 gray-700 */
    color: var(--art-gray-700);
  }

  /*
   * 居中窄列：空状态内容不铺满整屏宽度。
   * 上一版两栏横向铺满 1400px，稀疏内容被拉得很散，整体像一张说明文档。
   * 600px 是实测值：5 个关键词药丸（含最长的「苏江巅峰之夜王者赛道」）正好排成一行。
   */
  .dy-search-guide__hero {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 8px;
    width: 100%;
    max-width: 600px;
  }

  /* 图标块：与工具条里那个 36px 的图标方框同一套语言，空状态里放大到 60px */
  .dy-search-guide__icon {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 60px;
    height: 60px;
    margin-bottom: 8px;
    font-size: 28px;
    color: var(--theme-color);
    background: color-mix(in srgb, var(--theme-color) 14%, transparent);
    border-radius: 18px;
  }

  .dy-search-guide__title {
    margin: 0;
    font-size: 20px;
    font-weight: 600;
    color: var(--art-gray-900);
  }

  .dy-search-guide__desc {
    margin: 0;
    font-size: 13px;
    line-height: 1.7;
    color: var(--art-gray-700);
    /*
     * 居中排版下"最后一行只剩一个字"特别显眼（窄屏实测把「…进场记录」挤成「…进场记」+「录」）。
     * pretty 会让浏览器自己平衡断行，避免孤字。桌面一行时无副作用。
     */
    text-wrap: pretty;
  }

  .dy-search-guide__chips {
    display: flex;
    flex-wrap: wrap;
    justify-content: center;
    gap: 8px;
    margin-top: 14px;
  }

  /*
   * 关键词药丸：CSS 省略号（按字形簇截断），不再用 JS 硬切。
   * 原来是 `kw.slice(0, 10) + '…'` —— 会把 emoji 的代理对/组合序列切在中间，
   * 渲染成「萱萱🍋🍋🟩…」这种半截字符（用户截图里的样子）。
   * 底色用 gray-200 而不是 gray-100：卡片本身是白的，gray-100（#f9fafb）几乎看不出是标签。
   */
  .dy-search-guide__chip {
    display: block;
    max-width: 200px;
    height: 32px;
    padding: 0 14px;
    overflow: hidden;
    font-size: 12px;
    line-height: 32px;
    color: var(--art-gray-800);
    text-overflow: ellipsis;
    white-space: nowrap;
    cursor: pointer;
    background: var(--art-gray-200);
    border: 1px solid transparent;
    border-radius: 999px;
    transition:
      color 0.15s,
      background-color 0.15s,
      border-color 0.15s;
  }

  .dy-search-guide__chip:hover {
    color: var(--theme-color);
    background: color-mix(in srgb, var(--theme-color) 12%, transparent);
    border-color: color-mix(in srgb, var(--theme-color) 30%, transparent);
  }

  .dy-search-guide__hint {
    margin: 12px 0 0;
    font-size: 12px;
    line-height: 1.7;
    /* 同 .dy-search-guide__desc：避免居中排版下的孤字断行 */
    text-wrap: pretty;
    /* 原来这里是 text-g-500：白底 2.68:1 不达 AA（小字要 4.5）；gray-700 是 6.4:1 */
    color: var(--art-gray-700);
  }

  /* 第二行提示紧贴第一行，作为一个整体段落 */
  .dy-search-guide__hint + .dy-search-guide__hint {
    margin-top: 2px;
  }

  .dy-search-guide__foot {
    /* 居中列里要让分割线占满卡片宽度，不能随内容收缩 */
    width: 100%;
    /*
     * 这里**不能**用 margin-top: auto 顶到底部：
     * flexbox 里 auto margin 会先于 justify-content 吃掉全部自由空间（实测吃掉 290px），
     * 结果是内容被顶到卡片顶部、居中失效。让它跟着一起居中即可。
     */
    margin-top: 20px;
    padding-top: 14px;
    border-top: 1px solid var(--art-card-border);
    font-size: 12px;
    /* 同上：gray-500 在白底上只有 2.68:1，AA 不达标 */
    color: var(--art-gray-700);
  }

  @media (max-width: 900px) {
    /*
     * 选择器必须写满两个类：上面 `.art-card.dy-search-guide` 是两类的权重，
     * 原来这里只写 `.dy-search-guide`（一类）**压不动**，min-height 一直没真正清零。
     */
    .art-card.dy-search-guide {
      min-height: 0;
    }

    .dy-search-guide__hero {
      max-width: 100%;
    }

    /*
     * 窄屏说明压到 12px：13px 时整行 338px，比卡片内宽（393 屏下 321px）宽一点，
     * 会折出「记录」两个字的孤行。12px 时 312px，正好一行放下。
     */
    .dy-search-guide__desc {
      font-size: 12px;
    }
  }
</style>
