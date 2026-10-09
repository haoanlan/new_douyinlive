<!--
  状态监控 —— 版式对齐 Art Design Pro X「监控 / 缓存监控」（frontend.artd.pro/#/monitor/cache）：

    1. Hero 头卡：h1 + 说明 + 右侧操作（状态标签 / 自动刷新 / 刷新状态 / 重启全部服务），
       卡内嵌 4 个 kv 小卡（运行模式 / 监控脚本 / 监控房间 / 最近检查）
    2. 四张指标 tile：标题 + 图标块 + 大数字 + 进度条 + 底部小标签/状态词
    3. 两栏 1.38fr / 360px：左「服务明细」（kv grid + 服务行列表带操作按钮），
       右「连接健康」（进度条）+「异常提醒」（dashed 空态）
    4. 整宽「运行日志」（折叠）

  约定（改动前请先读）：
    - 状态取不到（statusError）时一律显示「状态未知」并禁用操作，不能用红色「未运行」
      冒充结论 —— 那会让人误判成服务挂了。
    - 重启类操作走 confirmDangerous 二次确认，且文案里写明影响面。
-->
<template>
  <div class="douyin-page p-4 flex flex-col gap-4">
    <!-- 状态取不到：明确说明，而不是把下面渲染成红色「未运行」 -->
    <el-alert
      v-if="statusError"
      type="error"
      :closable="false"
      show-icon
      :title="
        status
          ? '状态刷新失败，下方显示的是上一次成功获取的状态'
          : '状态检测失败，暂时无法判断服务是否正常'
      "
    >
      <div class="flex items-center gap-3 flex-wrap">
        <span class="text-xs break-all">{{ statusError }}</span>
        <el-button size="small" type="primary" plain @click="refresh({ minSpinMs: 420 })">
          <!-- 同上：不用 :loading，用固定占位的转圈图标，宽度不变 -->
          <ArtSvgIcon
            icon="ri:loader-4-line"
            class="mr-1"
            :class="loading ? 'dy-spin' : 'invisible'"
          />
          重试
        </el-button>
      </div>
    </el-alert>

    <!-- ① Hero 头卡 -->
    <section class="art-card p-5">
      <div class="flex flex-wrap items-start justify-between gap-4">
        <div class="min-w-0 flex-1">
          <h1 class="text-[20px] font-semibold tracking-tight text-g-900 m-0">状态监控</h1>
          <p class="mt-2 text-sm leading-7 text-g-600 max-w-2xl">
            聚合 Go 抓取代理、监控脚本与各房间 WebSocket
            连接的健康状态，用于快速判断当前是否在正常采集。
          </p>
        </div>
        <!--
          dy-action-row：这一行的间距统一交给 flex gap 管。
          Element Plus 会给「相邻的 el-button」再加一条 margin-left: 12px，
          叠在 gap-3(12px) 上就变成：自动刷新→刷新状态 12px、刷新状态→重启全部服务 24px，
          两个间距不一样（用户看出来了）。这里把那条 margin 归零。
        -->
        <div class="dy-action-row flex flex-wrap items-center gap-3">
          <!-- 这里原来还有一个「运行正常 / 风险 / 未知」的 chip：
               同一结论在下面指标卡里已经逐项表达（脚本运行中 / 代理健康 / Cookie 状态 / 异常提醒），
               顶部再放一个总结反而重复，按用户要求去掉。 -->
          <span class="dy-switch-btn">
            <span class="dy-switch-btn__label">自动刷新</span>
            <el-switch v-model="autoRefresh" />
          </span>
          <el-button @click="refresh({ minSpinMs: 420 })">
            <!--
              不用 el-button 的 :loading —— 它会在内容**前面再插一个**转圈图标，
              而这里已经有一个图标了，点下去按钮会变宽（用户反馈"点击大小会变"）。
              改成让原图标原地旋转：宽度恒定，反馈照样有。
            -->
            <ArtSvgIcon
              icon="ri:refresh-line"
              class="mr-1"
              :class="loading ? 'dy-spin' : ''"
            />
            刷新状态
          </el-button>
          <el-button
            type="primary"
            :disabled="Boolean(statusError) && !status"
            @click="handleRestartAll"
          >
            <ArtSvgIcon
              icon="ri:restart-line"
              class="mr-1"
              :class="busy === 'restart' ? 'dy-spin' : ''"
            />
            重启全部服务
          </el-button>
        </div>
      </div>

      <!-- hero 内嵌 kv 小卡 -->
      <div class="grid grid-cols-2 md:grid-cols-4 gap-3 mt-5">
        <div v-for="f in heroKv" :key="f.label" class="mon-kv">
          <div class="mon-kv__label">{{ f.label }}</div>
          <div class="mon-kv__value" :class="f.tone || 'text-g-900'">{{ f.value }}</div>
        </div>
      </div>
    </section>

    <!-- ② 四张指标 tile（无进度条：每张只放一组互不重复的事实） -->
    <section class="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
      <article v-for="m in tiles" :key="m.label" class="art-card p-5">
        <div class="flex items-start justify-between gap-3">
          <div class="min-w-0">
            <div class="text-sm font-medium text-g-600">{{ m.label }}</div>
            <ArtCountTo
              v-if="m.count !== null"
              class="mt-3 block truncate text-3xl font-semibold leading-none text-g-900"
              :target="m.count"
              :duration="1200"
              :suffix="m.suffix"
            />
            <div
              v-else
              class="mt-3 truncate text-3xl font-semibold leading-none"
              :class="m.textTone || 'text-g-900'"
            >
              {{ m.text }}
            </div>
          </div>
          <div class="size-9 rounded-lg flex-cc bg-theme/10 shrink-0">
            <ArtSvgIcon :icon="m.icon" class="text-base text-theme" />
          </div>
        </div>
        <div
          class="mt-4 flex items-center justify-between gap-2 border-t border-g-100 pt-3 text-xs"
        >
          <span class="min-w-0 truncate text-g-500">
            {{ m.footLabel }}
            <b class="font-medium" :class="m.footTone || 'text-g-700'">{{ m.footValue }}</b>
          </span>
          <!--
            服务的状态与重启按钮直接放在这张卡里（原来还要单独一张「服务明细」卡再铺一遍），
            想重启哪个就在哪个上点，不用往下找。aria/title 里带上具体状态说明。

            注意 loading / disabled 只对「服务动作」生效：
            它不是服务动作（查看异常、打开配置）时 act 是空串，而 busy 的初值也是空串，
            `busy === act` 会恒真 → 按钮一直转圈、点不动（用户反馈过）。
          -->
          <el-button
            v-if="m.action"
            size="small"
            plain
            class="shrink-0"
            :disabled="m.action.kind === 'service' && !statusKnown"
            :title="m.title || ''"
            @click="
              m.action.kind === 'issues'
                ? (issuesOpen = true)
                : m.action.kind === 'editor'
                  ? openEditor()
                  : actWithConfirm(m.action.act)
            "
          >
            <ArtSvgIcon
              :icon="m.action.icon"
              class="mr-1"
              :class="m.action.kind === 'service' && busy === m.action.act ? 'dy-spin' : ''"
            />
            {{ m.action.text }}
          </el-button>
        </div>
      </article>
    </section>

    <!-- 异常详情（条目多/文案长时在这里看全文，不撑变形卡片） -->
    <el-dialog v-model="issuesOpen" title="异常提醒" width="620px" class="dy-issues-dialog">
      <div v-if="issues.length" class="flex flex-col">
        <div
          v-for="(it, i) in issues"
          :key="i"
          class="flex items-start gap-2.5 py-3"
          :class="i ? 'border-t border-g-100' : ''"
        >
          <ArtSvgIcon
            :icon="it.level === 'error' ? 'ri:error-warning-line' : 'ri:alert-line'"
            class="text-base mt-0.5 shrink-0"
            :class="it.level === 'error' ? 'text-danger' : 'text-warning'"
          />
          <div class="min-w-0 flex-1">
            <div class="text-xs mb-0.5" :class="it.level === 'error' ? 'text-danger' : 'text-warning'">
              {{ it.level === 'error' ? '错误' : '警告' }}
            </div>
            <div class="text-sm leading-relaxed text-g-800 break-words">{{ it.text }}</div>
          </div>
        </div>
      </div>
      <div v-else class="py-6 text-center text-sm text-g-500">未发现异常</div>
      <template #footer>
        <el-button type="primary" @click="issuesOpen = false">知道了</el-button>
      </template>
    </el-dialog>

    <!-- ④ Go 代理配置（代理有自己一套 schema 与 Cookie 规则；可在此直接改） -->
    <article class="art-card p-5">
      <div class="flex flex-wrap items-start justify-between gap-3">
        <div class="min-w-0">
          <h3 class="text-lg font-semibold text-g-900 m-0">Go 代理配置</h3>
          <p class="mt-1 text-sm leading-6 text-g-600">
            配置源是根目录 <code class="pc-code">config.yaml</code>，代理启动时按它生成
            <code class="pc-code">proxy-config.yaml</code>；Cookie 按「临时 &gt; 房间专用 &gt; 默认 &gt;
            自动获取」取值。
          </p>
        </div>
        <div class="flex items-center gap-2 shrink-0">
          <span
            v-if="proxyCfg && !proxyCfg.inSync"
            class="pc-tag bg-warning/12 text-warning"
            title="改了 config.yaml 但代理还在用启动时的旧配置"
            >待重启生效</span
          >
          <el-button type="primary" @click="openEditor">
            <ArtSvgIcon
              icon="ri:settings-3-line"
              class="mr-1"
              :class="formLoading ? 'dy-spin' : ''"
            />
            可视化配置
          </el-button>
        </div>
      </div>

      <!--
        左右两栏（用户反馈：这样一屏内看到的东西更多、占的地方更小）。
        高度是配平的：左栏 Cookie 四格排 2×2、右栏其他配置八格排 2×4，
        两边都约 330px；运行期提示横跨两栏放在下面（文案长，需要整宽）。
      -->
      <div class="mt-5 grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1.35fr)_minmax(320px,0.65fr)]">
        <!-- 左：Cookie 规则（重点） -->
        <div class="min-w-0">
          <div class="flex items-center gap-2">
            <h4 class="text-base font-semibold text-g-900 m-0">Cookie</h4>
            <span class="pc-tag" :class="cookieBadge.cls">{{ cookieBadge.text }}</span>
          </div>

          <div class="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div v-for="f in cookieFacts" :key="f.label" class="mon-kv">
              <div class="mon-kv__label">{{ f.label }}</div>
              <div class="mon-kv__value" :class="f.tone || 'text-g-900'" :title="f.title || f.value">
                {{ f.value }}
              </div>
            </div>
          </div>

          <!--
            Cookie 档位只列"例外"：走专用 Cookie 的房间。
            房间会增减、状态本身在「房间管理」页，这里铺 5 行既会变长又没信息量 ——
            真正要看的只有"哪些房间没用默认值"。
          -->
          <div class="mt-3">
            <div class="flex items-center justify-between gap-3">
              <span class="text-sm font-medium text-g-700">Cookie 档位命中</span>
              <span class="text-xs text-g-500">{{ cookieSourceSummary }}</span>
            </div>
            <div v-if="roomsWithOwnCookie.length" class="mt-1 flex flex-col">
              <div
                v-for="(r, i) in roomsWithOwnCookie"
                :key="r.roomId"
                class="flex items-center gap-2 py-1.5"
                :class="i ? 'border-t border-g-100' : ''"
              >
                <span class="text-sm text-g-800 truncate min-w-0 flex-1" :title="r.name || r.roomId">
                  {{ r.name || r.roomId }}
                </span>
                <span class="text-xs shrink-0" :class="sourceTone(r.source, r.auth)">
                  {{ sourceText(r.source, r.auth) }}
                </span>
              </div>
            </div>
            <div v-else class="mt-1 text-xs text-g-500">
              没有房间配专用 Cookie，全部按默认 Cookie / 自动获取取值
            </div>
          </div>

          <!--
            运行期信号放在左栏（而不是横跨两栏）：
            它讲的就是 Cookie 到底能不能用，和上面的 Cookie 事实是一组；
            而且这样左栏高度 ≈ 右栏（实测两栏内容底边差 0），不会在某一栏底下留一块空白。
          -->
          <div
            v-if="cookieRuntime.length"
            class="mt-3 rounded-lg border px-3 py-2 text-xs leading-6"
            :class="
              proxyRuntime?.verificationPage || proxyRuntime?.ttwidMissing
                ? 'border-warning/30 bg-warning/10 text-warning'
                : 'border-g-200 bg-g-100/40 text-g-600'
            "
          >
            <div v-for="(line, i) in cookieRuntime" :key="i">{{ line }}</div>
          </div>
        </div>

        <!-- 右：其余配置事实（两列四行） -->
        <div class="min-w-0">
          <h4 class="text-base font-semibold text-g-900 m-0">其他配置</h4>
          <div class="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div v-for="f in proxyFacts" :key="f.label" class="mon-kv">
              <div class="mon-kv__label">{{ f.label }}</div>
              <div class="mon-kv__value" :class="f.tone || 'text-g-900'" :title="f.title || f.value">
                {{ f.value }}
              </div>
            </div>
          </div>
        </div>

        <p
          v-if="blockedSections.length"
          class="min-w-0 text-xs leading-5 text-g-500 xl:col-span-2"
        >
          当前二进制不支持的段（不写入，避免代理启动失败）：{{
            blockedSections.map((b) => b.key).join(' / ')
          }}；改完 config.yaml 需要重启代理才生效。
        </p>
        <p v-else class="min-w-0 text-xs leading-5 text-g-500 xl:col-span-2">
          改完 config.yaml 需要重启代理才生效 —— 代理只在启动时读一次配置。
        </p>
      </div>
    </article>

    <!-- 可视化配置抽屉 -->
    <el-drawer
      v-model="editorOpen"
      title="代理配置"
      size="620px"
      class="dy-proxy-drawer"
      :close-on-click-modal="false"
    >
      <div v-if="form" class="pc-drawer text-sm">
        <!-- 顶部说明条：一句话讲清"写到哪、什么时候生效" -->
        <div class="pc-note">
          <ArtSvgIcon icon="ri:information-line" class="pc-note__icon" />
          <div class="min-w-0">
            这里改的是根目录 <code class="pc-code">config.yaml</code>（代理启动时生成
            <code class="pc-code">proxy-config.yaml</code>）。
            <template v-if="proxyCfg && !proxyCfg.inSync">
              <span class="text-warning font-medium">当前有改动尚未生效，需重启代理。</span>
            </template>
            <template v-else>保存后需重启代理才生效。</template>
          </div>
        </div>

        <!-- ===== Cookie（最常改，放最前） ===== -->
        <section class="pc-section">
          <header class="pc-section__head">
            <ArtSvgIcon icon="ri:key-2-line" class="pc-section__icon" />
            <h4 class="pc-section__title">Cookie</h4>
            <span class="pc-tag" :class="draftBadge.cls">{{ draftBadge.text }}</span>
            <span class="pc-section__hint">临时 &gt; 房间专用 &gt; 默认 &gt; 自动获取</span>
          </header>

          <div class="pc-section__body">
            <div class="pc-field">
              <div class="pc-field__head">
                <label class="pc-label">默认 Cookie（cookie.douyin）</label>
                <el-button size="small" type="primary" plain @click="openQrLogin">
                  <ArtSvgIcon
                    icon="ri:qr-scan-2-line"
                    class="mr-1"
                    :class="qrStarting ? 'dy-spin' : ''"
                  />
                  扫码登录
                </el-button>
              </div>
              <el-input
                v-model="draft['cookie.douyin']"
                type="textarea"
                :rows="3"
                placeholder="ttwid=...; sessionid=...（留空 = 匿名态）"
              />
              <div class="pc-field__hint">
                浏览器登录 <code class="pc-code">live.douyin.com</code> 后从任意请求头复制完整 Cookie；含
                <code class="pc-code">sessionid</code> 才算登录态
              </div>
            </div>

            <div class="pc-switch-row">
              <div class="min-w-0">
                <div class="pc-label">使用预存 Cookie（cookie.use_stored）</div>
                <div class="pc-field__hint">关掉后预存 Cookie 被忽略，只剩代理自动获取的匿名 ttwid</div>
              </div>
              <el-switch v-model="draft['cookie.use_stored']" />
            </div>

            <div class="pc-field">
              <div class="pc-field__head">
                <label class="pc-label">房间专用 Cookie（cookie.rooms）</label>
                <el-button size="small" text type="primary" @click="addRoomCookie">
                  <ArtSvgIcon icon="ri:add-line" class="mr-1" />
                  添加
                </el-button>
              </div>
              <div class="pc-field__hint">某个直播间要用别的账号时配这里；没配的房间回退到默认 Cookie</div>

              <div v-if="roomCookieRows.length" class="pc-room-list">
                <div class="pc-room-list__head">
                  <span>直播间</span>
                  <span>该房间的 Cookie</span>
                  <span></span>
                </div>
                <div v-for="(row, i) in roomCookieRows" :key="i" class="pc-room-row">
                  <el-select
                    v-model="row.roomId"
                    filterable
                    allow-create
                    default-first-option
                    placeholder="选择或输入直播间ID"
                    class="pc-room-row__id"
                  >
                    <el-option
                      v-for="r in monitoredRooms"
                      :key="r.roomId"
                      :label="r.name || r.roomId"
                      :value="r.roomId"
                    />
                  </el-select>
                  <el-input v-model="row.cookie" placeholder="该房间的 Cookie" />
                  <el-button class="pc-room-row__del" text type="danger" @click="roomCookieRows.splice(i, 1)">
                    <ArtSvgIcon icon="ri:delete-bin-line" />
                  </el-button>
                </div>
              </div>
              <div v-else class="pc-empty">没有房间专用 Cookie，全部走默认 Cookie / 自动获取</div>
            </div>
          </div>
        </section>

        <!-- ===== 其他字段 ===== -->
        <section class="pc-section">
          <header class="pc-section__head">
            <ArtSvgIcon icon="ri:settings-3-line" class="pc-section__icon" />
            <h4 class="pc-section__title">其他</h4>
            <span class="pc-section__hint">留空即用代理默认值</span>
          </header>

          <div class="pc-section__body pc-grid">
            <div class="pc-field">
              <label class="pc-label">日志级别</label>
              <el-select v-model="draft['log.level']" class="w-full">
                <el-option v-for="o in ['debug', 'info', 'warn', 'error']" :key="o" :label="o" :value="o" />
              </el-select>
            </div>
            <div class="pc-field">
              <label class="pc-label">签名方式（sign.provider）</label>
              <el-select v-model="draft['sign.provider']" class="w-full">
                <el-option label="留空（默认 local）" value="" />
                <el-option label="local（内置）" value="local" />
                <el-option label="tikhub（在线）" value="tikhub" />
              </el-select>
            </div>
            <div class="pc-field">
              <label class="pc-label">
                TikHub Key
                <span v-if="draft['sign.provider'] === 'tikhub'" class="text-danger">必填</span>
              </label>
              <el-input
                v-model="draft['tikhub.key']"
                type="password"
                show-password
                placeholder="选 tikhub 时必须填，否则代理启动失败"
              />
            </div>
            <div class="pc-field">
              <label class="pc-label">API Key（api.key）</label>
              <el-input
                v-model="draft['api.key']"
                type="password"
                show-password
                placeholder="留空 = 接口不认证"
              />
            </div>
            <div class="pc-field">
              <label class="pc-label">未开播轮询间隔</label>
              <el-input v-model="draft['monitor.poll_interval']" placeholder="15s" />
            </div>
            <div class="pc-field">
              <label class="pc-label">状态通知间隔</label>
              <el-input v-model="draft['monitor.notify_interval']" placeholder="30s" />
            </div>
            <div class="pc-field pc-grid__full">
              <label class="pc-label">WebSocket 路径</label>
              <el-input v-model="draft['websocket.path']" placeholder="/ws" />
            </div>
          </div>

          <div v-if="blockedSections.length" class="pc-blocked">
            <div v-for="b in blockedSections" :key="b.key" class="flex items-start gap-1.5">
              <ArtSvgIcon icon="ri:forbid-2-line" class="mt-0.5 shrink-0" />
              <span>{{ b.reason }}</span>
            </div>
          </div>
        </section>

        <el-alert
          v-if="saveError"
          class="mt-4"
          type="error"
          :closable="false"
          show-icon
          :title="saveError"
        />
        <el-alert
          v-for="(w, i) in saveWarnings"
          :key="i"
          class="mt-3"
          type="warning"
          :closable="false"
          show-icon
          :title="w"
        />
      </div>

      <template #footer>
        <div class="flex items-center justify-between gap-3">
          <span class="text-xs text-g-500">
            {{ draftBadge.text === '未保存' ? '有改动未保存' : '没有未保存的改动' }}
          </span>
          <div class="flex items-center gap-2">
            <el-button @click="editorOpen = false">取消</el-button>
            <!--
              这两个按钮本身没有图标，用「固定占位的转圈图标」——
              平时不可见、转起来才出现，宽度全程不变（不然 el-button 的 :loading
              会临时插一个图标把按钮撑宽，点一下尺寸就跳）。
            -->
            <el-button @click="save(false)">
              <ArtSvgIcon
                icon="ri:loader-4-line"
                class="mr-1"
                :class="saving === 'save' ? 'dy-spin' : 'invisible'"
              />
              只保存
            </el-button>
            <el-button type="primary" @click="save(true)">
              <ArtSvgIcon
                icon="ri:loader-4-line"
                class="mr-1"
                :class="saving === 'restart' ? 'dy-spin' : 'invisible'"
              />
              保存并重启代理
            </el-button>
          </div>
        </div>
      </template>
    </el-drawer>

    <!-- ⑤ 运行日志（折叠时只留一行标题，别用两行文字占 98px） -->
    <article class="art-card p-5">
      <div class="flex flex-wrap items-center justify-between gap-3">
        <div class="flex items-baseline gap-2 min-w-0">
          <h3 class="text-lg font-semibold text-g-900 m-0">运行日志</h3>
          <span class="text-xs text-g-500">
            代理与监控脚本最近 {{ status?.logLines?.length || 0 }} 行
          </span>
        </div>
        <!-- 按钮原来写「运行日志（18 行）」，与左边的 h3 重复了一遍「运行日志」 -->
        <button
          type="button"
          class="dy-pressable inline-flex min-h-6 items-center gap-1 text-xs text-g-500 select-none hover:text-theme"
          aria-controls="dy-status-log"
          :aria-expanded="showLog"
          @click="showLog = !showLog"
        >
          {{ showLog ? '收起' : '展开' }}
          <ArtSvgIcon
            :icon="showLog ? 'ri:arrow-up-s-line' : 'ri:arrow-down-s-line'"
            class="log-caret"
            :class="showLog ? 'log-caret--open' : ''"
          />
        </button>
      </div>
      <div class="log-collapse" :class="showLog ? 'log-collapse--open' : ''">
        <div id="dy-status-log" class="log-collapse__inner">
          <div class="rounded-xl bg-g-100/50 px-4 py-3 max-h-80 overflow-auto mt-3">
            <template v-if="status?.logLines?.length">
              <div
                v-for="(l, i) in status.logLines"
                :key="i"
                class="flex gap-2 py-0.5 font-mono text-xs leading-relaxed"
              >
                <span class="shrink-0" :class="logColor(l.src)">[{{ l.src }}]</span>
                <span class="text-g-600 break-all">{{ l.text }}</span>
              </div>
            </template>
            <div v-else class="text-sm text-g-500">暂无日志输出</div>
          </div>
        </div>
      </div>
    </article>

    <!-- 操作结果 -->
    <el-dialog v-model="dialogVisible" :title="dialog.title" width="520px" class="dy-status-dialog">
      <div
        class="text-sm whitespace-pre-line leading-relaxed"
        :class="dialog.ok ? 'text-g-800' : 'text-danger'"
      >
        {{ dialog.message }}
      </div>
      <div
        v-if="dialog.logLines?.length"
        class="mt-3 rounded-xl border border-g-200/70 bg-g-100/40 px-3 py-2 max-h-52 overflow-auto font-mono text-xs text-g-600"
      >
        <div v-for="(l, i) in dialog.logLines" :key="i" class="whitespace-pre-wrap break-all">
          {{ l }}
        </div>
      </div>
      <template #footer>
        <el-button @click="dialogVisible = false">关闭</el-button>
        <el-button type="primary" @click="refresh">刷新状态</el-button>
      </template>
    </el-dialog>
    <!-- 扫码登录 -->
    <el-dialog
      v-model="qrOpen"
      title="扫码登录抖音"
      width="460px"
      class="dy-qr-dialog"
      :close-on-click-modal="false"
      @closed="onQrDialogClosed"
    >
      <div class="flex flex-col items-center text-center">
        <!--
          为什么要有这一步：抖音的扫码接口带 JS 风险指纹 + 无感验证，
          直接请求会返回 4031「检测到安全风险，已阻止此次访问」，
          无头浏览器更连二维码都拿不到 —— 只有真窗口能出码。
        -->
        <p class="text-xs leading-5 text-g-500 m-0">
          已弹出一个<strong>专用浏览器窗口</strong>（独立配置，不影响你日常浏览器）。<br />
          用抖音 App 扫码即可，登录成功后 Cookie 会自动写入 config.yaml。
        </p>

        <div class="mt-4 flex-cc rounded-xl border border-g-200 bg-white" style="width: 208px; height: 208px">
          <img v-if="qr.qr" :src="qr.qr" alt="登录二维码" style="width: 192px; height: 192px" />
          <div v-else class="text-xs text-g-500 px-4">
            {{ qrStarting ? '正在打开登录窗口并获取二维码…' : '暂无二维码' }}
          </div>
        </div>

        <div class="mt-3 flex items-center gap-2 text-sm" :class="qrTone">
          <ArtSvgIcon :icon="qrIcon" />
          <span>{{ qr.message || '准备中…' }}</span>
        </div>

        <el-checkbox v-model="qrRestartAfter" class="mt-3" :disabled="qr.state === 'saved'">
          登录成功后自动重启代理（让新 Cookie 立即生效）
        </el-checkbox>
      </div>

      <template #footer>
        <div class="flex items-center justify-end gap-2">
          <el-button v-if="!qrTerminal" @click="cancelQrLogin">取消并关闭窗口</el-button>
          <el-button type="primary" @click="qrOpen = false">{{ qrTerminal ? '关闭' : '隐藏' }}</el-button>
        </div>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
  import { computed, onActivated, onDeactivated, onMounted, onUnmounted, ref, watch } from 'vue'
  import { ElMessage, ElMessageBox } from 'element-plus'
  import {
    fetchServiceStatus,
    fetchProxyConfigForm,
    saveProxyConfig,
    startQrLogin,
    fetchQrLoginStatus,
    cancelQrLogin as cancelQrLoginApi,
    performServiceAction,
    type ProxyConfigForm,
    type QrLoginState,
    type ServiceAction,
    type ServiceStatus
  } from '@/api/douyin'
  import { fmtClock } from '@/utils/format'
  import { apiErrorMessage } from '@/utils/douyin-error'

  defineOptions({ name: 'DouyinStatus' })

  const status = ref<ServiceStatus | null>(null)
  const loading = ref(true)
  const autoRefresh = ref(true)
  const busy = ref<ServiceAction | ''>('')
  const showLog = ref(false)
  /**
   * 状态取不到时不能把下面渲染成红色「未运行」。
   * `status` 为 null 有两种完全不同的含义 ——「还在检测」与「检测失败了」，
   * 一律显示红色「未运行」会让人以为服务挂了（实际可能只是网络问题）。
   */
  const statusError = ref('')

  const dialogVisible = ref(false)
  /** 异常详情弹窗（第 4 张卡点「查看」时打开） */
  const issuesOpen = ref(false)
  const dialog = ref<{ title: string; message: string; ok: boolean; logLines?: string[] }>({
    title: '',
    message: '',
    ok: true
  })

  const proxyHealthy = computed(() => Boolean(status.value?.proxy?.healthy))
  const proxyReachable = computed(() => Boolean(status.value?.proxy?.reachable))
  const daemonRunning = computed(() => Boolean(status.value?.daemon?.running))
  const issues = computed(() => status.value?.issues || [])
  // 待处理项数 / 其中 error 级条数：第 4 张卡与下面的详情弹窗共用
  const issueCount = computed(() => issues.value.length)
  const errorCount = computed(() => issues.value.filter((i) => i.level === 'error').length)
  /**
   * 只有成功取到过、且当前没有报错，下面才表达真实状态；
   * 否则一律「状态未知」，绝不用红色「未运行」冒充结论。
   */
  const statusKnown = computed(() => Boolean(status.value) && !statusError.value)

  const configuredRooms = computed(() => status.value?.configuredRooms || 0)
  const connectedRooms = computed(() => status.value?.ws?.rooms ?? 0)


  /**
   * Hero 内嵌 kv 小卡 —— 只放「环境事实」，且全页不重复。
   *
   * 原来这四格是「运行模式 / 监控脚本 / 监控房间 / 最近检查」：
   *   - 运行模式写死「嵌入式监控」，是个常量不是数据；
   *   - 监控房间 5 个 与下面第一张 tile 完全同一个数；
   *   - 监控脚本 运行中 与「服务明细」行、tile 三处重复。
   * 现在四格各自出现在全页唯一一处。
   */
  const heroKv = computed(() => {
    const s = status.value
    const unknown = !statusKnown.value
    return [
      { label: '运行平台', value: unknown ? '—' : s?.platform || '—' },
      { label: '代理地址', value: unknown ? '—' : `127.0.0.1:${s?.proxy?.port ?? 1088}` },
      {
        // 库内房间 ≠ 已启用监控的房间：房间管理里可能有历史房间没启用，两个数都要看得见
        label: '库内房间',
        value: unknown ? '—' : `${s?.totalRooms ?? 0} 个`
      },
      {
        label: '最近检查',
        value: s?.checkedAt ? fmtClock(s.checkedAt) : '—',
        tone: 'text-g-900'
      }
    ]
  })

  /** 连接状态的数据来源（控制通道 / 监控日志 / 历史日志 / 无） */
  const dataSourceText = computed(() => {
    if (!statusKnown.value) return '—'
    const src = status.value?.ws?.source
    if (src === 'memory') return '守护进程内存'
    if (src === 'socket') return '控制通道'
    if (src === 'log') return '监控日志'
    if (src === 'log-stale') return '历史日志'
    return '无'
  })


  /** 数据新鲜度：实时来源是 0ms，日志来源会累积 */
  const freshText = computed(() => {
    const age = status.value?.ws?.ageMs
    if (!statusKnown.value) return '—'
    if (age === null || age === undefined) return '—'
    if (age < 5000) return '实时'
    const mins = Math.round(age / 60000)
    if (mins < 60) return `${mins} 分钟前`
    if (mins < 1440) return `${Math.round(mins / 60)} 小时前`
    return `${Math.round(mins / 1440)} 天前`
  })


  /**
   * 两个服务（Go 抓取代理 / 监控脚本）的当前状态与要按的动作。
   *
   * 原来是渲染成「服务明细」那张卡的一行行；那张卡已拆掉 ——
   * 状态与重启按钮上移到顶部指标卡里（想重启哪个就在哪张卡上点），
   * 这里的 stateText / detail / action 被 tile 复用，避免两份判断逻辑各写一遍。
   */
  const items = computed(() => {
    const s = status.value
    // 状态未知时不猜测：显示灰色「状态未知」，也不提供会把服务搞得更乱的操作
    const unknown = !statusKnown.value
    const tone = (ok: boolean, warn = false) =>
      unknown ? 'text-g-500' : ok ? 'text-success' : warn ? 'text-warning' : 'text-danger'
    const dot = (ok: boolean, warn = false) =>
      unknown ? 'bg-g-300' : ok ? 'bg-success' : warn ? 'bg-warning' : 'bg-danger'
    const iconTone = (ok: boolean, warn = false) =>
      unknown ? 'text-g-400' : ok ? 'text-success' : warn ? 'text-warning' : 'text-danger'

    const proxyItem = {
      key: 'proxy',
      name: 'Go 抓取代理',
      icon: 'ri:server-line',
      dotClass: dot(proxyHealthy.value, proxyReachable.value),
      tone: tone(proxyHealthy.value, proxyReachable.value),
      iconTone: iconTone(proxyHealthy.value, proxyReachable.value),
      stateText: unknown
        ? '状态未知'
        : proxyHealthy.value
          ? '正常'
          : proxyReachable.value
            ? '响应异常'
            : '未运行',
      detail: unknown
        ? '未能取到状态，无法判断代理是否正常'
        : proxyHealthy.value
          ? // 不再重复"地址 · 版本 · 健康检查通过"（地址在 Hero kv、版本是那张 tile 的数字、
            // 健康结论是它 footer），这里只说还额外验证了什么
            `端口 ${s?.proxy?.port ?? 1088} 在监听，/health 通过${
              s?.proxy?.wsProbe?.upgraded ? '，WebSocket 探测正常' : ''
            }`
          : proxyReachable.value
            ? `127.0.0.1:${s?.proxy?.port ?? 1088} 端口在监听但 /health 不通过`
            : s?.proxy?.binaryExists
              ? '进程未启动'
              : s?.proxy?.foreignBinary
                ? `${s.proxy.foreignBinary} 不是当前平台（${s.platform}）的构建`
                : '未找到代理二进制',
      /*
       * 状态取不到时不给动作按钮：
       * 那时既不知道服务在不在跑，按钮文案只能靠猜（之前会显示成「启动」），
       * 而且禁用态文字是 Element 的浅灰（实测对白底只有 2.3:1，不达 AA）。
       * 先让用户刷新/重试拿到状态，再决定点什么。
       */
      action: unknown
        ? null
        : {
            text: proxyHealthy.value ? '重启' : '启动',
            icon: proxyHealthy.value ? 'ri:restart-line' : 'ri:play-line',
            act: (proxyHealthy.value ? 'restart-proxy' : 'start-proxy') as ServiceAction
          }
    }

    const daemonItem = {
      key: 'daemon',
      name: '监控脚本',
      icon: 'ri:robot-2-line',
      dotClass: dot(daemonRunning.value, Boolean(s?.daemon?.pidStale)),
      tone: tone(daemonRunning.value, Boolean(s?.daemon?.pidStale)),
      iconTone: iconTone(daemonRunning.value, Boolean(s?.daemon?.pidStale)),
      stateText: unknown
        ? '状态未知'
        : daemonRunning.value
          ? '运行中'
          : s?.daemon?.pidStale
            ? '状态异常'
            : '未运行',
      /*
       * 运行中时不在这一行重复 PID 与「控制通道正常」：
       * PID 在「监控脚本」tile 的 footer 里，控制通道在左侧 kv 里。
       * 这里只说状态是怎么来的（实时上报 / 从日志解析）。
       */
      detail: unknown
        ? '未能取到状态，无法判断监控脚本是否在运行'
        : daemonRunning.value
          ? s?.daemon?.controlChannel
            ? '房间状态经控制通道实时上报'
            : '控制通道不可用，房间状态改从监控日志解析'
          : s?.daemon?.pidStale
            ? 'PID 文件残留（上次异常退出），重启可清理'
            : s?.configuredRooms
              ? '未运行（上次运行已退出），当前没有采集数据'
              : '未运行，且没有启用任何监控房间',
      // 同上：状态未知时不猜「启动」还是「重启」
      action: unknown
        ? null
        : {
            text: daemonRunning.value ? '重启' : '启动',
            icon: daemonRunning.value ? 'ri:restart-line' : 'ri:play-line',
            act: (daemonRunning.value ? 'restart' : 'start') as ServiceAction
          }
    }

    /*
     * 只保留两个真正的服务行。
     *
     * 原来还有第三行「WebSocket 连接」，但它的按钮执行的是 **daemon 的 restart/start**，
     * 与上一行「监控脚本」的按钮是同一个 action —— 一个动作两个入口，
     * 而且这一行讲的"连接"根本不是它能重启的东西。
     * 连接情况现在由右栏「房间连接」按房间列出，比一行聚合文字更有用。
     */
    return [proxyItem, daemonItem]
  })

  /**
   * 代理侧配置（proxy-config.yaml）。
   *
   * 为什么单独做一块：代理有自己一套 config schema，Cookie 是四级优先级
   * （WebSocket 临时 > cookie.rooms[房间] > cookie.douyin > 自动获取），
   * 而且自动获取的 ttwid 属于**匿名态** —— 官方文档明确说"has_cookie=true 不代表已有登录态"，
   * 所以这里把 Cookie 分成 未配置 / 匿名态 / 登录态 三档显示，而不是"填没填"。
   */
  const proxyCfg = computed(() => status.value?.proxyConfig || null)
  const proxyRuntime = computed(() => proxyCfg.value?.runtime || null)

  /**
   * 四张指标 tile：只看「代理 + 监控脚本」这两件事。
   *
   * 原来还有「监控房间 / 正在直播 / 正在录制」三张 —— 房间状态归「房间管理」页，
   * 而且房间会增减，放在这里既重复又要跟着变。每张卡也不再画进度条：
   * 四根条里三根是废的（连接率重复、录制率配直播文案、布尔值配进度条）。
   */
  const tiles = computed(() => {
    const s = status.value
    const unknown = !statusKnown.value
    // 服务行（含状态词、说明、该按哪个动作）复用来喂 tile，避免两份判断逻辑漂移
    const proxyItem = items.value.find((i) => i.key === 'proxy')
    const daemonItem = items.value.find((i) => i.key === 'daemon')
    const proxyCfgInfo = proxyCfg.value
    const cookieState = !proxyCfgInfo?.exists
      ? '未知'
      : !proxyCfgInfo.cookie?.default?.configured
        ? '未配置'
        : proxyCfgInfo.cookie.default.auth === 'login'
          ? '登录态'
          : '匿名态'
    return [
      {
        label: '监控脚本',
        icon: 'ri:robot-2-line',
        count: null,
        suffix: '',
        text: unknown ? '—' : daemonItem?.stateText || '—',
        textTone: unknown ? 'text-g-900' : daemonItem?.tone || 'text-g-900',
        footLabel: '监控 PID',
        footValue: unknown ? '—' : String(s?.daemon?.pid ?? '—'),
        footTone: 'text-g-700',
        title: daemonItem?.detail || '',
        action: daemonItem?.action
          ? { text: daemonItem.action.text, icon: daemonItem.action.icon, act: daemonItem.action.act, kind: 'service' }
          : null
      },
      {
        label: 'Go 抓取代理',
        icon: 'ri:server-line',
        count: null,
        suffix: '',
        text: unknown ? '—' : s?.proxy?.health?.tag || `:${s?.proxy?.port ?? 1088}`,
        textTone: unknown ? 'text-g-900' : proxyHealthy.value ? 'text-g-900' : 'text-danger',
        footLabel: '健康检查',
        footValue: unknown
          ? '—'
          : proxyHealthy.value
            ? `通过 · ${s?.proxy?.port ?? 1088}`
            : proxyReachable.value
              ? '异常'
              : '未运行',
        footTone: !unknown && proxyHealthy.value ? 'text-success' : 'text-g-700',
        title: proxyItem?.detail || '',
        action: proxyItem?.action
          ? { text: proxyItem.action.text, icon: proxyItem.action.icon, act: proxyItem.action.act, kind: 'service' }
          : null
      },
      {
        label: '代理 Cookie',
        icon: 'ri:key-2-line',
        count: null,
        suffix: '',
        text: cookieState,
        textTone:
          cookieState === '登录态' ? 'text-success' : cookieState === '未配置' ? 'text-g-500' : 'text-warning',
        footLabel: '配置是否已生效',
        footValue: !proxyCfgInfo?.exists ? '—' : proxyCfgInfo.inSync ? '已生效' : '待重启代理',
        footTone: proxyCfgInfo?.inSync === false ? 'text-warning' : 'text-g-700',
        title: 'Cookie 的取值规则与可见化配置都在下方「Go 代理配置」里',
        action: { text: '配置', icon: 'ri:settings-3-line', act: '', kind: 'editor' }
      },
      {
        /*
         * 第 4 张卡原来是「数据来源」，用户反馈"没什么意义" ——
         * 它只是把内部实现（守护进程内存/监控日志）摊出来，正常与否上面两张卡已经表达。
         * 换成「异常提醒」：大字给出待处理项数，底栏放最紧要那一条的摘要（悬停看全文），
         * 条目多时点「查看」在弹窗里看完整列表 —— 这样长文案不会把卡片撑变形。
         */
        label: '异常提醒',
        icon: errorCount.value
          ? 'ri:error-warning-line'
          : issueCount.value
            ? 'ri:alert-line'
            : 'ri:shield-check-line',
        count: null,
        suffix: '',
        text: !statusKnown.value ? '状态未知' : issueCount.value ? `${issueCount.value} 项待处理` : '无异常',
        textTone: !statusKnown.value
          ? 'text-g-500'
          : errorCount.value
            ? 'text-danger'
            : issueCount.value
              ? 'text-warning'
              : 'text-success',
        footLabel: issueCount.value ? '最紧要一项' : '巡检结论',
        footValue: !statusKnown.value
          ? '无法判断'
          : issueCount.value
            ? issues.value[0].text.slice(0, 34) + (issues.value[0].text.length > 34 ? '…' : '')
            : '代理与监控脚本均正常',
        footTone: errorCount.value ? 'text-danger' : issueCount.value ? 'text-warning' : 'text-g-700',
        title: issues.value.map((i) => i.text).join('\n') || '未发现异常',
        action: issueCount.value
          ? { text: '查看', icon: 'ri:list-check', act: '', kind: 'issues' }
          : null
      }
    ]
  })

  const cookieBadge = computed(() => {
    const d = proxyCfg.value?.cookie?.default
    if (!proxyCfg.value?.exists) return { text: '未知', cls: 'bg-g-100 text-g-600' }
    if (!d?.configured) return { text: '未配置', cls: 'bg-g-100 text-g-600' }
    if (d.auth === 'login') return { text: '登录态', cls: 'bg-success/12 text-success' }
    if (d.auth === 'anonymous') return { text: '匿名态（只有 ttwid）', cls: 'bg-warning/12 text-warning' }
    return { text: '已配置（键未识别）', cls: 'bg-warning/12 text-warning' }
  })

  /**
   * Cookie 那几格事实。
   * 固定 4 格：这样和下面「其他配置」的四列网格宽度一致，整张卡是整齐的方格，
   * 不会出现"三格撑满一行、每格都空一半"的观感。
   */
  const cookieFacts = computed(() => {
    const c = proxyCfg.value?.cookie
    const d = c?.default
    return [
      {
        label: '默认 Cookie（cookie.douyin）',
        value: !d?.configured ? '未配置' : d.auth === 'login' ? '登录态' : '匿名态',
        tone: !d?.configured ? 'text-g-500' : d.auth === 'login' ? 'text-success' : 'text-warning',
        title: d?.configured
          ? `共 ${d.keyCount} 个键，长度 ${d.length}；登录键：${d.loginKeys.join(', ') || '无'}`
          : '没配就靠代理自动获取匿名 ttwid'
      },
      {
        label: '识别到的登录键',
        value: !d?.configured ? '—' : d.loginKeys.length ? d.loginKeys.join(' / ') : '无（匿名态）',
        tone: d?.loginKeys?.length ? 'text-success' : 'text-warning',
        title: d?.anonKeys?.length ? `匿名键：${d.anonKeys.join(', ')}` : '没有识别到匿名键'
      },
      {
        label: 'cookie.use_stored',
        value: c?.useStored === false ? '已关闭' : '开启',
        tone: c?.useStored === false ? 'text-warning' : 'text-g-900',
        title:
          c?.useStored === false
            ? '关闭后预存 Cookie 被忽略，只剩匿名 ttwid'
            : '使用预存 Cookie（临时 Cookie 仍优先）'
      },
      {
        label: '房间专用 Cookie',
        value: `${c?.rooms?.count || 0} 个`,
        tone: c?.rooms?.count ? 'text-success' : 'text-g-900',
        title: (c?.rooms?.entries || []).map((e) => `${e.roomId}（${e.auth}）`).join('、') || '没有按房间单独配'
      }
    ]
  })

  /** 运行期 Cookie 信号（来自代理日志） */
  const cookieRuntime = computed(() => {
    const rt = proxyRuntime.value
    if (!rt?.logExists) return []
    const out: string[] = []
    out.push(
      `最近一次连接尝试：${rt.lastActivityAt || '—'}${rt.livePageOffline ? `（未开播轮询 ${rt.livePageOffline} 次）` : ''}`
    )
    if (rt.verificationPage) {
      const recent = rt.verificationPageRecent
      out.push(
        `拿到验证页（直播页状态不存在）${rt.verificationPage} 次，最后一次 ${
          (rt.verificationPageAt || '').slice(0, 16) || '—'
        }${
          recent
            ? recent >= rt.verificationPage
              ? ' —— 全部发生在最近 30 分钟内，正在发生'
              : ` —— 其中最近 30 分钟 ${recent} 次，正在发生`
            : ''
        }`
      )
    }
    if (rt.ttwidMissing) {
      out.push(
        `未取到 TTWID ${rt.ttwidMissing} 次，最后一次 ${(rt.ttwidMissingAt || '').slice(0, 16) || '—'}${
          rt.ttwidMissingRecent ? `（最近 30 分钟 ${rt.ttwidMissingRecent} 次）` : ''
        }`
      )
    }
    const fail = (rt.lastErrors || []).filter((e) => e.level === 'ERROR')
    if (fail.length) out.push(`最近 ${fail.length} 个房间报错，详见下方「异常提醒」`)
    return out
  })

  /** 每个房间生效的 Cookie 档位 */
  const effectiveCookies = computed(() => proxyCfg.value?.effective || [])

  /** 只列"走专用 Cookie"的房间（例外才有信息量，房间数会增减） */
  const roomsWithOwnCookie = computed(() => effectiveCookies.value.filter((r) => r.source === 'room'))

  /** 档位命中概况：专用 / 默认 / 自动各几个房间 */
  const cookieSourceSummary = computed(() => {
    const list = effectiveCookies.value
    if (!list.length) return '当前没有监控房间'
    const n = (s: string) => list.filter((r) => r.source === s).length
    const parts = []
    if (n('room')) parts.push(`专用 ${n('room')} 个`)
    if (n('default')) parts.push(`默认 ${n('default')} 个`)
    if (n('auto')) parts.push(`自动获取 ${n('auto')} 个`)
    return `共 ${list.length} 个房间：${parts.join(' · ')}`
  })

  /** 当前监控的房间（供「房间专用 Cookie」下拉选择；房间本身的管理在「房间管理」页） */
  const monitoredRooms = computed(() =>
    (status.value?.ws?.states || []).map((r) => ({ roomId: r.roomId, name: r.name || '' }))
  )

  const blockedSections = computed(() => form.value?.blockedSections || [])

  // ===== 可视化配置抽屉 =====
  const editorOpen = ref(false)
  const formLoading = ref(false)
  const saving = ref<'' | 'save' | 'restart'>('')
  const form = ref<ProxyConfigForm | null>(null)
  const draft = ref<Record<string, any>>({})
  const roomCookieRows = ref<{ roomId: string; cookie: string }[]>([])
  const saveError = ref('')
  const saveWarnings = ref<string[]>([])

  /** 草稿里的 Cookie 是什么档位（跟卡片上同一套判定，改之前就能看出效果） */
  const draftBadge = computed(() => {
    const v = String(draft.value['cookie.douyin'] || '')
    if (!v.trim()) return { text: '未配置（匿名态）', cls: 'bg-g-100 text-g-600' }
    const login = /(?:^|;\s*)(sessionid|sessionid_ss|sid_tt|uid_tt|sso_uid_tt|sid_ucp_v1|passport_assist_user)=/.test(v)
    if (login) return { text: '登录态', cls: 'bg-success/12 text-success' }
    if (/(?:^|;\s*)(ttwid|odin_tt|msToken|s_v_web_id)=/.test(v)) {
      return { text: '匿名态（只有 ttwid 这类）', cls: 'bg-warning/12 text-warning' }
    }
    return { text: '已填写（键未识别）', cls: 'bg-warning/12 text-warning' }
  })

  async function openEditor() {
    // 去掉 :loading 后按钮不再自锁，这里防重入
    if (formLoading.value) return
    editorOpen.value = true
    formLoading.value = true
    saveError.value = ''
    saveWarnings.value = []
    try {
      const f = await fetchProxyConfigForm()
      form.value = f
      draft.value = { ...(f.values || {}) }
      roomCookieRows.value = Object.entries(f.values?.['cookie.rooms'] || {}).map(([roomId, cookie]) => ({
        roomId,
        cookie: String(cookie)
      }))
    } catch (e) {
      saveError.value = apiErrorMessage(e, '读取代理配置失败')
    } finally {
      formLoading.value = false
    }
  }

  function addRoomCookie() {
    roomCookieRows.value.push({ roomId: '', cookie: '' })
  }

  // ===== 扫码登录 =====
  const qrOpen = ref(false)
  const qrStarting = ref(false)
  const qrRestartAfter = ref(true)
  const qr = ref<QrLoginState>({ ok: true, state: 'starting', message: '准备中…' })
  let qrTimer: number | undefined

  const qrTerminal = computed(() =>
    ['saved', 'error', 'cancelled', 'timeout'].includes(String(qr.value.state || ''))
  )
  const qrIcon = computed(() => {
    switch (qr.value.state) {
      case 'saved':
        return 'ri:checkbox-circle-line'
      case 'scanned':
        return 'ri:smartphone-line'
      case 'error':
      case 'timeout':
        return 'ri:error-warning-line'
      default:
        return 'ri:qr-scan-2-line'
    }
  })
  const qrTone = computed(() => {
    switch (qr.value.state) {
      case 'saved':
        return 'text-success'
      case 'scanned':
        return 'text-theme'
      case 'error':
      case 'timeout':
        return 'text-danger'
      default:
        return 'text-g-600'
    }
  })

  function stopQrPolling() {
    if (qrTimer) clearInterval(qrTimer)
    qrTimer = undefined
  }

  /** 扫码成功后：把新 Cookie 读回抽屉（后端已写入 config.yaml） */
  async function afterQrSaved() {
    stopQrPolling()
    try {
      const f = await fetchProxyConfigForm()
      form.value = f
      draft.value = { ...(draft.value), 'cookie.douyin': f.values?.['cookie.douyin'] || '' }
    } catch {
      /* 读不回来也不影响已写入的结果 */
    }
    if (qrRestartAfter.value) {
      ElMessage.success('Cookie 已写入，正在重启代理…')
      const act = await performServiceAction('restart-proxy')
      if (act?.ok) ElMessage.success(act.message || '代理已重启')
      else ElMessage.warning(act?.error || act?.message || '代理重启未成功')
      await refresh()
    } else {
      ElMessage.success('Cookie 已写入 config.yaml（重启代理后生效）')
    }
  }

  async function openQrLogin() {
    // 去掉 :loading 后按钮不再自锁，这里防重入
    if (qrStarting.value) return
    qrOpen.value = true
    qrStarting.value = true
    qr.value = { ok: true, state: 'starting', message: '正在打开登录窗口…' }
    stopQrPolling()
    try {
      const st = await startQrLogin()
      if (!st?.ok) {
        qr.value = { ok: false, state: 'error', message: st?.error || '启动扫码登录失败' }
        return
      }
      qr.value = st
      if (st.id) {
        qrTimer = window.setInterval(async () => {
          try {
            const s = await fetchQrLoginStatus(String(st.id))
            if (s?.ok) {
              qr.value = s
              if (s.state === 'saved') await afterQrSaved()
              else if (['error', 'timeout', 'cancelled'].includes(String(s.state))) stopQrPolling()
            }
          } catch {
            /* 轮询失败就等下一轮 */
          }
        }, 1500)
      }
    } catch (e) {
      qr.value = { ok: false, state: 'error', message: apiErrorMessage(e, '启动扫码登录失败') }
    } finally {
      qrStarting.value = false
    }
  }

  async function cancelQrLogin() {
    stopQrPolling()
    const id = qr.value.id
    if (id) {
      try {
        await cancelQrLoginApi(String(id))
      } catch {
        /* 窗口可能已经关了 */
      }
    }
    qr.value = { ...qr.value, state: 'cancelled', message: '已取消' }
    qrOpen.value = false
  }

  /** 关闭对话框：没走到终态就顺手把浏览器窗口关掉，避免留下孤立窗口 */
  function onQrDialogClosed() {
    stopQrPolling()
    if (!qrTerminal.value && qr.value.id) {
      cancelQrLoginApi(String(qr.value.id)).catch(() => {})
      qr.value = { ...qr.value, state: 'cancelled', message: '已取消' }
    }
  }

  /** 组装 patch：只提交表单里真正有的字段 */
  async function save(restart: boolean) {
    saving.value = restart ? 'restart' : 'save'
    saveError.value = ''
    saveWarnings.value = []
    try {
      const rooms: Record<string, string> = {}
      for (const row of roomCookieRows.value) {
        const id = String(row.roomId || '').trim()
        if (id && String(row.cookie || '').trim()) rooms[id] = String(row.cookie).trim()
      }
      const patch: Record<string, any> = {
        'log.level': draft.value['log.level'] || 'info',
        'sign.provider': draft.value['sign.provider'] ?? '',
        'tikhub.key': draft.value['tikhub.key'] || '',
        'api.key': draft.value['api.key'] || '',
        'monitor.poll_interval': draft.value['monitor.poll_interval'] || '15s',
        'monitor.notify_interval': draft.value['monitor.notify_interval'] || '30s',
        'websocket.path': draft.value['websocket.path'] || '/ws',
        'cookie.use_stored': draft.value['cookie.use_stored'] !== false,
        'cookie.douyin': draft.value['cookie.douyin'] || '',
        'cookie.rooms': rooms
      }
      const res = await saveProxyConfig(patch)
      if (!res?.ok) {
        saveError.value = res?.error || '保存失败'
        saveWarnings.value = res?.warnings || []
        return
      }
      saveWarnings.value = res?.warnings || []
      ElMessage.success(restart ? '已保存，正在重启代理…' : '已保存到 config.yaml（重启代理后生效）')
      if (restart) {
        const act = await performServiceAction('restart-proxy')
        if (act?.ok) ElMessage.success(act.message || '代理已重启')
        else ElMessage.warning(act?.error || act?.message || '代理重启未成功，请查看运行日志')
      }
      await refresh()
      editorOpen.value = false
    } catch (e) {
      saveError.value = apiErrorMessage(e, '保存失败')
    } finally {
      saving.value = ''
    }
  }

  function sourceText(source: string, auth: string): string {
    if (source === 'room') return `房间专用（${auth === 'login' ? '登录态' : '匿名态'}）`
    if (source === 'default') return `默认 Cookie（${auth === 'login' ? '登录态' : '匿名态'}）`
    return '自动获取（匿名 ttwid）'
  }

  function sourceTone(source: string, auth: string): string {
    if (auth === 'login') return 'text-success'
    if (source === 'auto') return 'text-warning'
    return 'text-g-600'
  }

  /** 右侧其它配置事实 */
  const proxyFacts = computed(() => {
    const p = proxyCfg.value
    if (!p) return []
    const domains = p.api.allowedDomains || []
    return [
      {
        label: '签名方式',
        value: p.sign.effective === 'tikhub' ? 'tikhub（在线）' : 'local（内置）',
        tone: p.sign.effective === 'tikhub' && !p.tikhub.hasKey ? 'text-danger' : 'text-g-900',
        title:
          p.sign.effective === 'tikhub' && !p.tikhub.hasKey
            ? '选了 tikhub 但没填 key，代理会启动失败'
            : `配置值：${p.sign.provider || '（留空，用默认 local）'}`
      },
      {
        label: 'API Key',
        value: p.api.hasKey ? '已配置' : '未配置',
        title: p.api.hasKey ? '接口需带 Bearer' : '/metrics 等接口无需认证'
      },
      // 监听端口不在这里重复（Hero 的「代理地址」已经是 127.0.0.1:1088），
      // 去掉之后这 8 项正好四列两行，不会有落单的第 9 格
      { label: '日志级别', value: p.logLevel || '—' },
      { label: '轮询间隔', value: p.monitor.pollInterval || '—' },
      { label: 'WebSocket 路径', value: p.websocket.path || '—' },
      { label: '允许域名', value: domains.length ? domains.join(', ') : '—' },
      // 「服务明细」卡拆掉后挪进来的两项事实
      {
        label: '代理进程',
        value: status.value?.proxy?.binaryName || '—',
        title: status.value?.proxy?.binaryPath || ''
      },
      {
        label: '连接数据来源',
        value: `${dataSourceText.value} · ${freshText.value}`,
        title: '房间连接状态由监控脚本经控制通道上报；控制通道不可用时退回解析监控日志，此时新鲜度会显示延迟'
      }
    ]
  })

  /** 日志来源着色（用语义色，深色模式下才不会看不清） */
  function logColor(src: string): string {
    if (src === 'proxy') return 'text-theme'
    if (src === 'daemon') return 'text-warning'
    return 'text-success'
  }

  /**
   * 拉一次服务状态。
   *
   * `minSpinMs`：本地接口常常 20~50ms 就返回，按钮上的转圈一闪而过，
   * 点下去"看起来没反应"（用户反馈过）—— 传了它就保证转圈至少显示这么久。
   */
  async function refresh(opts: { minSpinMs?: number } = {}) {
    // 去掉 :loading 后按钮不再自锁，这里防重复触发（自动刷新与手动点可能撞一起）
    if (loading.value) return
    const spin = opts.minSpinMs || 0
    const beganAt = Date.now()
    loading.value = true
    try {
      status.value = await fetchServiceStatus()
      statusError.value = ''
    } catch (e) {
      statusError.value = apiErrorMessage(e, '服务状态获取失败')
    } finally {
      if (spin) {
        const rest = spin - (Date.now() - beganAt)
        if (rest > 0) await new Promise((r) => setTimeout(r, rest))
      }
      loading.value = false
    }
  }

  /**
   * 二次确认：重启类操作会中断全部连接与正在进行的录制，
   * 这是本页唯一会造成数据损失的一类操作，必须有授权边界。
   */
  async function confirmDangerous(action: ServiceAction): Promise<boolean> {
    const s = status.value
    const rooms = s?.configuredRooms || 0
    const recording = s?.ws?.recording || 0
    const live = s?.ws?.live || 0

    const impact: string[] = []
    if (rooms) impact.push(`<li>${rooms} 个监控房间的连接会全部断开并重新建立</li>`)
    if (recording) {
      impact.push(
        `<li><b>正在录制的 ${recording} 个房间会中断</b>，当前场次会被结束；` +
          `恢复后要等抓取代理重新确认开播（实测约 1 分钟），这段时间的数据不会记录</li>`
      )
    } else if (live) {
      impact.push(`<li>当前有 ${live} 个房间在直播，重启期间不会记录弹幕 / 礼物</li>`)
    }
    if (!rooms && !recording && !live) impact.push('<li>所有房间连接会重新建立</li>')
    impact.push('<li>历史数据不会被删除</li>')

    const titleMap: Record<string, string> = {
      restart: '重启 Go 代理与监控脚本？',
      'restart-proxy': '重启 Go 抓取代理？',
      'start-proxy': '启动 Go 抓取代理？',
      start: '启动监控脚本？',
      stop: '停止监控脚本？'
    }

    try {
      await ElMessageBox.confirm(
        `<p>将执行：<b>${titleMap[action] || '执行该操作'}</b></p>` +
          `<p class="mt-2">影响范围：</p><ul class="mt-1 pl-5 list-disc">${impact.join('')}</ul>`,
        '确认执行',
        {
          confirmButtonText: '确认执行',
          cancelButtonText: '取消',
          type: 'warning',
          dangerouslyUseHTMLString: true
        }
      )
      return true
    } catch {
      return false
    }
  }

  /**
   * 「重启全部服务」= Go 代理 + 监控 worker，两个都要重启。
   *
   * 原来这里只调了 restart（那个动作在后端只重启监控 worker），
   * 按钮却写着"全部服务" —— 用户按完看到"监控 worker 已重启"，
   * 而 Go 代理还在用启动时的旧 config（于是页面又冒出
   * "config.yaml 与 proxy-config.yaml 不一致"的警告，新 Cookie 也没生效）。
   *
   * 现在依次调两个已经验证过的接口，并把两边结果合起来如实汇报：
   * 先重启代理（它会按 config.yaml 重新生成 proxy-config.yaml），
   * 再重启 worker（此时 1088 已在监听，worker 不会再去抢着拉一个）。
   */
  async function handleRestartAll() {
    if (busy.value) return
    const s = status.value
    const reasons: string[] = []
    if (s && !s.proxy?.binaryExists) {
      reasons.push(
        s.proxy?.foreignBinary
          ? `目录里的 ${s.proxy.foreignBinary} 不是当前平台（${s.platform}）的构建`
          : `未找到代理二进制（候选：${(s.proxy?.candidates || []).join(' / ')}）`
      )
    }
    if (s && (s.configuredRooms || 0) === 0) {
      reasons.push('还没有配置监控房间，请先在「房间管理」里添加')
    }
    if (reasons.length) {
      dialog.value = {
        title: '暂时无法重启',
        message: `请先补齐以下条件：\n\n· ${reasons.join('\n· ')}`,
        ok: false
      }
      dialogVisible.value = true
      ElMessage.warning('缺少启动条件，详情见弹窗')
      return
    }
    if (!(await confirmDangerous('restart'))) return

    busy.value = 'restart'
    const lines: string[] = []
    let allOk = true
    try {
      const p: any = await performServiceAction('restart-proxy')
      const pOk = p?.ok !== false
      allOk = allOk && pOk
      lines.push(
        pOk
          ? `① Go 抓取代理：${p?.message || '已重启'}`
          : `① Go 抓取代理重启失败：${p?.error || p?.message || '未知原因'}`
      )

      const w: any = await performServiceAction('restart')
      const wOk = w?.ok !== false
      allOk = allOk && wOk
      lines.push(
        wOk
          ? `② 监控脚本：${w?.message || '已重启'}`
          : `② 监控脚本重启失败：${w?.error || w?.message || '未知原因'}`
      )
      if (allOk) lines.push('', '两个服务都已按当前 config.yaml 重新启动。')
    } catch (e: any) {
      allOk = false
      lines.push(`请求失败：${e?.message || e}`)
    } finally {
      busy.value = ''
    }

    dialog.value = {
      title: allOk ? '重启完成' : '重启未全部成功',
      message: lines.join('\n'),
      ok: allOk
    }
    dialogVisible.value = true
    if (allOk) ElMessage.success('Go 代理与监控脚本都已重启')
    else ElMessage.warning('有服务未重启成功，详情见弹窗')
    await refresh()
  }

  async function actWithConfirm(action: ServiceAction) {
    if (!(await confirmDangerous(action))) return
    await act(action)
  }

  async function act(action: ServiceAction) {
    if (busy.value) return
    busy.value = action
    try {
      const res: any = await performServiceAction(action)
      const ok = res?.ok !== false
      const message = res?.message || res?.error || (ok ? '已完成' : '未知错误')
      dialog.value = { title: ok ? '操作成功' : '操作未完成', message, ok, logLines: res?.logLines }
      dialogVisible.value = true
      if (ok) ElMessage.success(message)
      else ElMessage.warning(message)
      setTimeout(refresh, ok ? 1500 : 300)
    } catch (e: any) {
      dialog.value = { title: '操作失败', message: e?.message || '请求失败', ok: false }
      dialogVisible.value = true
      ElMessage.error(e?.message || '请求失败')
    } finally {
      busy.value = ''
    }
  }

  let timer: number | undefined
  const startTimer = () => {
    stopTimer()
    timer = window.setInterval(() => {
      // 切走时由 onDeactivated 停表；这里再挡一层"浏览器标签页被隐藏"
      if (document.visibilityState === 'visible') refresh()
    }, 8000)
  }
  const stopTimer = () => {
    if (timer) clearInterval(timer)
    timer = undefined
  }

  watch(autoRefresh, (on) => (on ? startTimer() : stopTimer()))
  // keep-alive：这页被缓存，onUnmounted 不会触发 —— 旧版切走后仍在每 8s 请求（实测复现）
  let activatedOnce = false
  onMounted(() => {
    refresh()
    startTimer()
  })
  onActivated(() => {
    // 首次挂载时 mounted 与 activated 都会触发，跳过以免重复请求
    if (!activatedOnce) {
      activatedOnce = true
      return
    }
    refresh()
    if (autoRefresh.value) startTimer()
  })
  onDeactivated(() => stopTimer())
  onUnmounted(() => stopTimer())
</script>

<style scoped lang="scss">
  /*
   * 这份工具条样式原来只被 search 页 @use，而 status 也在用 `.dy-switch-btn`
   * （自动刷新开关的等高外框 + hover 边框）→ 那些规则根本没被加载（UI-AUDIT P2-9）。
   */
  @use '@styles/custom/douyin-toolbar.scss';

  /* ===== kv 小卡（官方 hero/面板内嵌的 label+value 卡） ===== */
  .mon-kv {
    min-width: 0;
    padding: 10px 14px;
    border: 1px solid var(--art-gray-200);
    border-radius: 8px;
  }

  .mon-kv__label {
    font-size: 12px;
    line-height: 1.4;
    color: var(--dy-text-muted);
  }

  .mon-kv__value {
    margin-top: 6px;
    font-size: 14px;
    font-weight: 600;
    line-height: 1.35;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    font-variant-numeric: tabular-nums;
  }

  /* ===== 两栏面板公共 ===== */
  .mon-panel__divider {
    height: 1px;
    background: var(--art-gray-200);
    margin: 16px 0;
  }

  /* 服务明细行 */
  .mon-service {
    display: flex;
    align-items: center;
    gap: 12px;
    min-height: 64px;
  }

  .mon-dot {
    width: 8px;
    height: 8px;
    border-radius: 9999px;
    flex-shrink: 0;
  }

  /* 房间连接行 */
  .mon-room {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 10px 0;
  }

  /* ===== Go 代理配置卡 ===== */
  .pc-code {
    padding: 1px 4px;
    border-radius: 4px;
    background: var(--art-gray-100, rgb(243 244 246));
    font-size: 12px;
  }

  /* 只留尺寸，配色走 Tailwind 的语义色工具类（bg-success/12 等，全站同一套） */
  .pc-tag {
    display: inline-flex;
    align-items: center;
    height: 20px;
    padding: 0 8px;
    border-radius: 6px;
    font-size: 12px;
    line-height: 1;
  }

  /* ===== 禁用态按钮也要能读 =====
     Element 的禁用文字是 rgb(168,171,178)，对白底只有 2.3:1（不达 AA）。
     禁用 ≠ 不可读，这里换成语义灰（约 4.6:1）。 */
  :deep(.el-button.is-disabled),
  :deep(.el-button.is-disabled:hover) {
    color: var(--art-gray-500, rgb(107 114 128)) !important;
  }

  /* ===== 按钮里的"原地转圈" =====     用它替代 el-button 的 :loading：后者会在内容前额外插一个图标把按钮撑宽，
     点一下尺寸就变；这里让按钮里原有的图标自己旋转，宽度恒定。 */
  .dy-spin {
    animation: dy-spin 800ms linear infinite;
    transform-origin: center;
  }

  @keyframes dy-spin {
    to {
      transform: rotate(360deg);
    }
  }

  /* ===== 控件行间距 =====     Element Plus 默认给相邻按钮加 margin-left: 12px。只要该行用了 flex gap，
     两个按钮之间的间距就会是 gap + 12，与"第一个控件到第一个按钮"的 gap 不一致。
     统一归零，改由 gap 单独决定，这样一行里每个间距都相等。 */
  .dy-action-row {
    :deep(.el-button + .el-button) {
      margin-left: 0;
    }
  }

  /* ===== 可视化配置抽屉 =====
     目标：分节成卡片、标签与提示层级清楚、输入框尺寸统一，
     而不是一段段裸 div 堆在一起。配色全部走语义色变量，深色模式自动跟随。 */
  .pc-drawer {
    display: flex;
    flex-direction: column;
    gap: 16px;
  }

  .pc-note {
    display: flex;
    align-items: flex-start;
    gap: 8px;
    padding: 10px 12px;
    border-radius: 10px;
    background: var(--art-gray-100, rgb(243 244 246));
    color: var(--art-gray-600, rgb(75 85 99));
    font-size: 12px;
    line-height: 20px;
  }

  .pc-note__icon {
    margin-top: 2px;
    flex-shrink: 0;
    font-size: 14px;
    color: var(--art-gray-500, rgb(107 114 128));
  }

  .pc-section {
    border: 1px solid var(--art-gray-200, rgb(229 231 235));
    border-radius: 12px;
    overflow: hidden;
  }

  .pc-section__head {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 10px 14px;
    background: var(--art-gray-100, rgb(243 244 246));
    border-bottom: 1px solid var(--art-gray-200, rgb(229 231 235));
  }

  .pc-section__icon {
    font-size: 15px;
    color: var(--art-gray-600, rgb(75 85 99));
  }

  .pc-section__title {
    margin: 0;
    font-size: 14px;
    font-weight: 600;
    color: var(--art-gray-900, rgb(17 24 39));
  }

  .pc-section__hint {
    margin-left: auto;
    font-size: 12px;
    color: var(--art-gray-500, rgb(107 114 128));
  }

  .pc-section__body {
    display: flex;
    flex-direction: column;
    gap: 14px;
    padding: 14px;
  }

  .pc-field {
    display: flex;
    flex-direction: column;
    gap: 6px;
    min-width: 0;
  }

  .pc-field__head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
    min-height: 24px;
  }

  .pc-label {
    font-size: 13px;
    color: var(--art-gray-800, rgb(31 41 55));
    display: inline-flex;
    align-items: center;
    gap: 4px;
  }

  .pc-field__hint {
    font-size: 12px;
    line-height: 18px;
    color: var(--art-gray-500, rgb(107 114 128));
  }

  .pc-switch-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding: 10px 12px;
    border-radius: 10px;
    background: var(--art-gray-100, rgb(243 244 246));
  }

  .pc-grid {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 14px;
  }

  .pc-grid__full {
    grid-column: 1 / -1;
  }

  .pc-room-list {
    display: flex;
    flex-direction: column;
    gap: 8px;
    margin-top: 2px;
  }

  .pc-room-list__head {
    display: grid;
    grid-template-columns: 180px minmax(0, 1fr) 32px;
    gap: 8px;
    padding: 0 2px;
    font-size: 12px;
    color: var(--art-gray-500, rgb(107 114 128));
  }

  .pc-room-row {
    display: grid;
    grid-template-columns: 180px minmax(0, 1fr) 32px;
    gap: 8px;
    align-items: center;
  }

  .pc-room-row__del {
    width: 32px;
    padding: 0;
  }

  .pc-empty {
    padding: 12px;
    border: 1px dashed var(--art-gray-300, rgb(209 213 219));
    border-radius: 10px;
    font-size: 12px;
    color: var(--art-gray-500, rgb(107 114 128));
    text-align: center;
  }

  .pc-blocked {
    display: flex;
    flex-direction: column;
    gap: 4px;
    margin: 0 14px 14px;
    font-size: 12px;
    line-height: 18px;
    color: var(--art-gray-500, rgb(107 114 128));
  }

  /* ===== 日志折叠 ===== */
  .log-collapse {
    display: grid;
    grid-template-rows: 0fr;
    transition: grid-template-rows var(--dy-dur-slow) var(--dy-ease-in-out);
  }

  .log-collapse--open {
    grid-template-rows: 1fr;
  }

  .log-collapse__inner {
    min-height: 0;
    overflow: hidden;
  }

  .log-caret {
    transition: transform var(--dy-dur-base) var(--dy-ease-out);
  }

  .log-caret--open {
    transform: rotate(180deg);
  }

  @media (prefers-reduced-motion: reduce) {
    .log-collapse,
    .log-caret {
      transition-duration: 1ms;
    }

    .log-caret--open {
      transform: none;
    }
  }
</style>

<!--
  弹窗在窄屏（手机查看）下不能固定 520px 撑破视口。
  el-dialog 默认 teleport 到 body，不在本组件 DOM 子树里，
  scoped style（含 :deep）选不到，必须用非 scoped 的全局样式。
-->
<style>
  .dy-status-dialog {
    max-width: calc(100vw - 32px);
  }
</style>
