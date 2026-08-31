<template>
  <div id="content" :class="{ 'content-fade-in': contentFadeIn }">
    <!-- Loading state -->
    <div v-if="contentLoading" class="loading">加载中...</div>
    <!-- Rooms view -->
    <template v-else-if="topNavTab === 'rooms'">
      <!-- Status Bar -->
      <div class="status-bar">
        <div class="status-chip status-live" id="statusLive">
          <span class="dot"></span>
          <span id="statusLiveCount">{{ connectedCount }}</span> 监控中
        </div>
        <div class="status-chip status-off" id="statusPaused">
          <span class="dot"></span>
          <span id="statusPausedCount">{{ pausedCount }}</span> 已暂停
        </div>
      </div>
      <!-- Stats Row -->
      <div class="stats-row">
        <div class="stat-card" data-stat="rooms"><div class="stat-label">直播间</div><div class="stat-value">{{ rooms.length }}</div></div>
        <div class="stat-card" data-stat="sessions"><div class="stat-label">总场次</div><div class="stat-value">{{ summary.total_sessions }}</div></div>
        <div class="stat-card" data-stat="gifts"><div class="stat-label">总礼物</div><div class="stat-value">{{ summary.total_gifts.toLocaleString() }}</div></div>
        <div class="stat-card" data-stat="diamonds"><div class="stat-label">总钻石</div><div class="stat-value">{{ summary.total_diamonds.toLocaleString() }}</div></div>
        <div class="stat-card" data-stat="danmaku"><div class="stat-label">总弹幕</div><div class="stat-value">{{ summary.total_danmaku.toLocaleString() }}</div></div>
        <div class="stat-card" data-stat="users"><div class="stat-label">独立用户</div><div class="stat-value">{{ summary.unique_users.toLocaleString() }}</div></div>
      </div>
      <!-- Room Management Section -->
      <div class="section">
        <div class="section-header">
          <div class="section-title">房间管理</div>
          <button type="button" class="btn btn-ghost btn-sm" @click="showAddRoomFn" style="border-color:var(--border-light)">+ 添加房间</button>
        </div>
        <TransitionGroup name="list" tag="div" class="host-grid" id="roomGrid">
          <div v-for="r in rooms" :key="r.room_id" class="room-card" @click="viewSessions(r.room_id)">
            <div class="room-card-top">
              <div class="host-avatar">
                <img v-if="r.avatar" :src="r.avatar" alt="" @error="(e: any) => e.target.style.display='none'">
                <div v-else style="width:100%;height:100%;display:flex;align-items:center;justify-content:center;color:var(--text-muted)">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="20" height="20"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
                </div>
                <div v-if="r.recording" class="live-dot"></div>
              </div>
              <div class="host-info">
                <div class="host-name" v-if="r.name">{{ r.name }}</div>
                <div class="host-name" v-else style="color:var(--text-muted);font-style:italic">解析中...</div>
                <div class="host-meta">
                  <span class="host-badge" :class="roomBadgeClass(r)">{{ roomBadgeText(r) }}</span>
                  <span>{{ r.session_count }} 场</span>
                </div>
              </div>
              <div class="room-card-actions">
                <button type="button" v-if="r.enabled" class="action-btn" @click.stop="pauseRoomFn(r.room_id)" title="暂停">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16" rx="1"/><rect x="14" y="4" width="4" height="16" rx="1"/></svg>
                </button>
                <button type="button" v-else class="action-btn action-btn-resume" @click.stop="resumeRoomFn(r.room_id)" title="恢复">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>
                </button>
                <button type="button" class="action-btn action-btn-del" @click.stop="confirmDeleteRoom(r.room_id, r.name)" title="删除">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                </button>
              </div>
            </div>
            <div class="room-card-footer">{{ r.room_id }}</div>
          </div>
        </TransitionGroup>
      </div>
      <div v-if="showAddRoomModal" class="modal-overlay" @click.self="closeAddRoom">
        <div class="modal">
          <div class="modal-header">
            <div class="modal-title">添加房间</div>
            <button type="button" class="modal-close" @click="closeAddRoom">✕</button>
          </div>
          <div class="modal-body">
            <div class="modal-field">
              <label>房间号 / 抖音号</label>
              <div style="display:flex;gap:8px">
                <input ref="addRoomInputEl" v-model="addRoomInput" placeholder="输入房间号或抖音号" @keydown.enter="lookupRoomFn">
                <button type="button" class="btn btn-ghost btn-sm" @click="lookupRoomFn" :disabled="lookupLoading" id="lookupBtn" style="border-color:var(--border-light)">{{ lookupLoading ? '查询中...' : '查询' }}</button>
              </div>
              <div class="modal-hint">纯数字为房间号，含字母为抖音号</div>
            </div>
            <div v-if="lookupData" id="addRoomResult">
              <div class="modal-field">
                <label>主播名称</label>
                <input v-model="addRoomName" placeholder="主播名称" style="width:100%">
              </div>
              <div class="modal-preview" id="addRoomPreview">
                <img v-if="lookupData.avatar" :src="lookupData.avatar" style="width:40px;height:40px;border-radius:50%;object-fit:cover">
                <div>
                  <div style="font-weight:500;font-size:13px" v-if="lookupData.nickname">{{ lookupData.nickname }}</div>
                  <div style="font-weight:500;font-size:13px;color:var(--text-muted);font-style:italic" v-else>待解析</div>
                  <div style="font-size:11px;color:var(--text-muted)">房间号: {{ lookupData.room_id || '未开播' }}<template v-if="lookupData.is_live"> · <span style="color:var(--green)">直播中</span></template></div>
                </div>
              </div>
            </div>
          </div>
          <div class="modal-footer">
            <button type="button" class="btn btn-ghost btn-sm" @click="closeAddRoom">取消</button>
            <button type="button" class="btn btn-ghost btn-sm" id="addRoomConfirmBtn" @click="confirmAddRoom" :disabled="!lookupData || !lookupData.room_id || addRoomSubmitting" style="border-color:var(--border-light)">{{ addRoomSubmitting ? '添加中...' : '确认添加' }}</button>
          </div>
        </div>
      </div>
    </template>
    <!-- Search view -->
    <template v-else-if="topNavTab === 'search'">
      <div class="section">
        <div class="section-header">
          <div class="section-title">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
            匿名查询
          </div>
        </div>
        <div style="font-size:12px;color:var(--text-muted);margin-bottom:12px">输入用户昵称，可选直播间/场次缩小范围，匹配 sec_uid 后查询真实信息</div>
        <div class="anon-filter">
          <div class="cs-wrap" id="anonStreamerWrap">
            <button type="button" class="cs-btn" id="anonStreamerBtn" @click="toggleCs('anonStreamer')">{{ csLabels.anonStreamer || '全部直播间' }}</button>
            <div class="cs-list" :class="{ open: csOpen === 'anonStreamer' }" id="anonStreamerList">
              <div class="cs-opt" :class="{ selected: !csState.anonStreamer }" data-val="" @click="selectCs('anonStreamer', '', '全部直播间')">全部直播间</div>
              <div v-for="s in streamers" :key="s.id" class="cs-opt" :class="{ selected: csState.anonStreamer === s.id }" :data-val="s.id" @click="selectCs('anonStreamer', s.id, s.name || s.room_id)">{{ s.name || s.room_id }}</div>
            </div>
          </div>
          <div class="cs-wrap" id="anonSessionWrap">
            <button type="button" class="cs-btn" :class="{ disabled: !csState.anonStreamer }" id="anonSessionBtn" @click="toggleCs('anonSession')">{{ csLabels.anonSession || '全部场次' }}</button>
            <div class="cs-list" :class="{ open: csOpen === 'anonSession' }" id="anonSessionList">
              <div class="cs-opt" :class="{ selected: !csState.anonSession }" data-val="" @click="selectCs('anonSession', '', '全部场次')">全部场次</div>
              <div v-for="s in anonSessions" :key="s.id" class="cs-opt" :class="{ selected: csState.anonSession === String(s.id) }" :data-val="s.id" @click="selectCs('anonSession', String(s.id), (s.started_at ? fmtTime(s.started_at) : '') + ' ' + (s.title || ''))">{{ fmtTime(s.started_at) }} {{ s.title }}</div>
            </div>
          </div>
        </div>
        <div style="display:flex;gap:8px;margin-bottom:16px">
          <input v-model="searchInput" placeholder="输入昵称关键词..." style="flex:1;padding:8px 12px;background:var(--bg-card);border:1px solid var(--border);border-radius:var(--radius);color:var(--text);font-size:13px;outline:none" @keydown.enter="doAnonymousLookup">
          <button type="button" class="btn btn-ghost btn-sm" @click="doAnonymousLookup" style="border-color:var(--border-light)">查询</button>
        </div>
        <div id="searchResults">
          <div v-if="searchLoading" class="loading" style="min-height:auto;padding:30px">查询中...</div>
          <div v-else-if="searchResults.length > 0">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">
              <span style="font-size:12px;color:var(--text-muted)">找到 <strong style="color:var(--text)">{{ searchResults.length }}</strong> 个匹配用户</span>
              <span style="font-size:11px;color:var(--text-muted)">点击查看详情</span>
            </div>
            <div style="display:flex;flex-direction:column;gap:6px">
              <div v-for="(u, idx) in searchResults" :key="idx" class="lookup-card" @click="showAnonymousDetail(idx)">
                <div class="lookup-left">
                  <div class="avatar" v-html="avatarHtml(u.db_avatar || u.api_avatar || u.avatar, getDbName(u))"></div>
                  <div class="user-info">
                    <div class="user-name">{{ getDbName(u) }}</div>
                    <div v-if="u.api_nickname && u.api_nickname !== getDbName(u)" class="user-db-name">{{ u.api_nickname }}</div>
                    <div v-else-if="u.db_nicknames && u.db_nicknames.length > 1" class="user-db-name">{{ u.db_nicknames.length }}个昵称</div>
                  </div>
                </div>
                <div class="lookup-right">
                  <span v-if="u.sessions && u.sessions.length" class="sess">{{ u.sessions[0].streamer_name }}</span>
                  <span v-if="u.latest_action" class="act">{{ actionLabel(u.latest_action.type) }}</span>
                </div>
              </div>
            </div>
          </div>
          <div v-else-if="searchSearched && searchResults.length === 0" class="empty" style="padding:30px">
            <div class="empty-icon">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="28" height="28"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
            </div>
            未找到匹配用户
          </div>
        </div>
      </div>
    </template>
    <!-- Combine view -->
    <template v-else-if="topNavTab === 'combine'">
      <div class="section">
        <div class="section-header">
          <div class="section-title">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16"><path d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg>
            合并查看
          </div>
        </div>
        <!-- Quick select toolbar -->
        <div class="combine-toolbar">
          <div class="combine-toolbar-left">
            <span class="combine-toolbar-hint">按主播分组选择场次，合并查看数据汇总</span>
          </div>
          <div class="combine-toolbar-right">
            <button type="button" class="btn btn-ghost btn-sm" @click="combineSelectRecent(3)">最近3场</button>
            <button type="button" class="btn btn-ghost btn-sm" @click="combineSelectRecent(5)">最近5场</button>
            <button type="button" class="btn btn-ghost btn-sm" @click="combineSelectAll">全选</button>
          </div>
        </div>
        <!-- Loading -->
        <div v-if="combineViewLoading" class="loading" style="min-height:auto;padding:30px">加载场次列表...</div>
        <!-- Streamer cards -->
        <div v-else-if="combineGrouped.length > 0" class="combine-streamer-grid">
          <div v-for="group in combineGrouped" :key="group.streamer_id" class="combine-streamer-card" :class="{ expanded: combineExpanded.has(group.streamer_id) }">
            <!-- Streamer header -->
            <div class="combine-streamer-header" @click="combineToggleStreamer(group.streamer_id)">
              <div class="combine-streamer-chevron" :class="{ open: combineExpanded.has(group.streamer_id) }">
                <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 18 15 12 9 6"/></svg>
              </div>
              <div class="combine-streamer-info">
                <div class="combine-streamer-name">{{ group.streamer_name }}</div>
                <div class="combine-streamer-meta">
                  <span class="combine-meta-badge">{{ group.sessions.length }} 场</span>
                  <span class="combine-meta-diamonds">
                    <svg viewBox="0 0 24 24" width="10" height="10" style="fill:var(--orange)"><path d="M6 2h12l4 7-10 13L2 9z"/></svg>
                    {{ combineStreamerTotalDiamonds(group.streamer_id).toLocaleString() }}
                  </span>
                </div>
              </div>
              <div class="combine-streamer-actions" @click.stop>
                <span class="combine-selected-count">{{ combineStreamerSelectedCount(group.streamer_id) }}/{{ group.sessions.length }}</span>
                <button type="button" class="btn btn-ghost btn-sm combine-select-all-btn" @click="combineToggleStreamerSessions(group.streamer_id)">
                  {{ combineStreamerSelectedCount(group.streamer_id) === group.sessions.length ? '取消' : '全选' }}
                </button>
              </div>
            </div>
            <!-- Session list (expanded) -->
            <div v-show="combineExpanded.has(group.streamer_id)" class="combine-sessions-list">
              <div v-for="s in group.sessions" :key="s.id"
                   class="combine-session-card"
                   :class="{ selected: combineSelectedIds.has(s.id) }"
                   @click="combineToggleSelect(s.id)">
                <input type="checkbox" :checked="combineSelectedIds.has(s.id)" @click.stop="combineToggleSelect(s.id)" class="session-cb">
                <div class="combine-session-info">
                  <div class="combine-session-title">{{ s.room_title || '场次 #' + s.id }}</div>
                  <div class="combine-session-time">{{ fmtTime(s.started_at) }}</div>
                </div>
                <div class="combine-session-meta">
                  <span v-if="s.is_live" class="session-badge live">直播中</span>
                  <span v-else class="session-badge offline">已结束</span>
                  <span class="combine-session-diamonds">
                    <svg viewBox="0 0 24 24" width="10" height="10" style="fill:var(--orange)"><path d="M6 2h12l4 7-10 13L2 9z"/></svg>
                    {{ (s.total_diamonds || 0).toLocaleString() }}
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>
        <div v-else class="empty" style="padding:30px">暂无场次数据</div>
      </div>
      <!-- Floating action bar -->
      <div class="combine-float-bar" :class="{ show: combineSelectedIds.size > 0 }">
        <div class="combine-float-count">
          已选 <strong>{{ combineSelectedIds.size }}</strong> 场
        </div>
        <button type="button" class="btn btn-ghost btn-sm combine-float-btn" @click="mergeSessions" :disabled="combineLoading || combineSelectedIds.size < 2">
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><path d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"/></svg>
          {{ combineLoading ? '合并中...' : '查看合并' }}
        </button>
      </div>
    </template>
  </div>

  <!-- ANONYMOUS DETAIL MODAL -->
  <div id="anonDetailModal" class="anchor-modal-overlay" :class="{ show: anonDetailModalVisible }" @click.self="closeAnonDetailModal">
    <div class="anchor-modal">
      <div class="anchor-modal-header">
        <h3 id="anonDetailTitle">{{ anonDetailTitle }}</h3>
        <button type="button" class="anchor-modal-close" @click="closeAnonDetailModal">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
      </div>
      <div class="anchor-modal-body" id="anonDetailBody" v-html="anonDetailBody"></div>
    </div>
  </div>

  <!-- COMBINE MODAL -->
  <div id="combineModal" class="anchor-modal-overlay" :class="{ show: showCombineModal }" @click.self="closeCombineModal">
    <div class="anchor-modal combine-modal">
      <div class="anchor-modal-header" style="border-bottom:none;padding-bottom:0">
        <h3 style="font-size:16px">📊 合并查看结果</h3>
        <button type="button" class="anchor-modal-close" @click="closeCombineModal">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
        </button>
      </div>
      <div class="anchor-modal-body" v-if="combineResult" style="padding-top:12px">
        <!-- Summary Stats -->
        <div class="combine-stats-grid">
          <div class="combine-stat-card orange">
            <div class="combine-stat-icon">💎</div>
            <div class="combine-stat-content">
              <div class="combine-stat-value">{{ combineResult.summary.total_diamonds.toLocaleString() }}</div>
              <div class="combine-stat-label">总钻石</div>
            </div>
          </div>
          <div class="combine-stat-card">
            <div class="combine-stat-icon">🎁</div>
            <div class="combine-stat-content">
              <div class="combine-stat-value">{{ combineResult.summary.total_gifts.toLocaleString() }}</div>
              <div class="combine-stat-label">总礼物</div>
            </div>
          </div>
          <div class="combine-stat-card accent">
            <div class="combine-stat-icon">💬</div>
            <div class="combine-stat-content">
              <div class="combine-stat-value">{{ combineResult.summary.total_danmaku.toLocaleString() }}</div>
              <div class="combine-stat-label">总弹幕</div>
            </div>
          </div>
          <div class="combine-stat-card green">
            <div class="combine-stat-icon">👥</div>
            <div class="combine-stat-content">
              <div class="combine-stat-value">{{ combineResult.summary.user_count.toLocaleString() }}</div>
              <div class="combine-stat-label">独立用户</div>
            </div>
          </div>
        </div>
        <!-- Tab bar -->
        <div class="combine-tab-bar">
          <button type="button" class="combine-tab" :class="{ active: combineResultTab === 'gifts' }" @click="combineResultTab = 'gifts'">
            <span class="combine-tab-icon">🎁</span>
            <span class="combine-tab-text">礼物排行</span>
            <span v-if="combineResult.gifts" class="combine-tab-count">{{ combineResult.gifts.length }}</span>
          </button>
          <button type="button" class="combine-tab" :class="{ active: combineResultTab === 'anchors' }" @click="combineResultTab = 'anchors'">
            <span class="combine-tab-icon">🏆</span>
            <span class="combine-tab-text">主播排行</span>
            <span v-if="combineResult.anchorRanking" class="combine-tab-count">{{ combineResult.anchorRanking.length }}</span>
          </button>
          <button type="button" class="combine-tab" :class="{ active: combineResultTab === 'danmaku' }" @click="combineResultTab = 'danmaku'">
            <span class="combine-tab-icon">💬</span>
            <span class="combine-tab-text">弹幕排行</span>
            <span v-if="combineResult.danmakuRanking" class="combine-tab-count">{{ combineResult.danmakuRanking.length }}</span>
          </button>
        </div>
        <!-- Gift Ranking Tab -->
        <div v-show="combineResultTab === 'gifts'" class="combine-tab-content">
          <div v-if="combineResult.gifts && combineResult.gifts.length" class="combine-rank-list">
            <div v-for="(g, i) in combineResult.gifts.slice(0, 20)" :key="i" class="combine-rank-item" :class="{ 'top3': i < 3 }">
              <div class="combine-rank-num" :class="{ 'gold': i === 0, 'silver': i === 1, 'bronze': i === 2 }">{{ i + 1 }}</div>
              <div class="avatar" v-html="avatarHtml(g.avatar_url, g.nickname)" style="width:32px;height:32px;flex-shrink:0"></div>
              <div class="combine-rank-info">
                <div class="combine-rank-name">{{ g.nickname }}</div>
                <div class="combine-rank-meta">{{ g.gift_count }} 次赠送</div>
              </div>
              <div class="combine-rank-value orange">
                <svg viewBox="0 0 24 24" width="12" height="12" style="fill:currentColor"><path d="M6 2h12l4 7-10 13L2 9z"/></svg>
                {{ g.total_diamonds.toLocaleString() }}
              </div>
            </div>
          </div>
          <div v-else class="empty" style="padding:30px;text-align:center;color:var(--text-muted)">暂无礼物数据</div>
        </div>
        <!-- Anchor Ranking Tab -->
        <div v-show="combineResultTab === 'anchors'" class="combine-tab-content">
          <div v-if="combineResult.anchorRanking && combineResult.anchorRanking.length" class="combine-rank-list">
            <div v-for="(a, i) in combineResult.anchorRanking" :key="i" class="combine-rank-item" :class="{ 'top3': i < 3 }">
              <div class="combine-rank-num" :class="{ 'gold': i === 0, 'silver': i === 1, 'bronze': i === 2 }">{{ i + 1 }}</div>
              <div class="avatar" v-html="avatarHtml(a.anchor_avatar, a.anchor_name)" style="width:32px;height:32px;flex-shrink:0"></div>
              <div class="combine-rank-info">
                <div class="combine-rank-name">{{ a.anchor_name }}</div>
                <div class="combine-rank-meta">{{ a.user_count }} 用户 · {{ a.gift_count }} 礼物</div>
              </div>
              <div class="combine-rank-value orange">
                <svg viewBox="0 0 24 24" width="12" height="12" style="fill:currentColor"><path d="M6 2h12l4 7-10 13L2 9z"/></svg>
                {{ a.total_diamonds.toLocaleString() }}
              </div>
            </div>
          </div>
          <div v-else class="empty" style="padding:30px;text-align:center;color:var(--text-muted)">暂无主播数据</div>
        </div>
        <!-- Danmaku Ranking Tab -->
        <div v-show="combineResultTab === 'danmaku'" class="combine-tab-content">
          <div v-if="combineResult.danmakuRanking && combineResult.danmakuRanking.length" class="combine-rank-list">
            <div v-for="(d, i) in combineResult.danmakuRanking.slice(0, 20)" :key="i" class="combine-rank-item" :class="{ 'top3': i < 3 }">
              <div class="combine-rank-num" :class="{ 'gold': i === 0, 'silver': i === 1, 'bronze': i === 2 }">{{ i + 1 }}</div>
              <div class="avatar" v-html="avatarHtml(d.avatar, d.nickname)" style="width:32px;height:32px;flex-shrink:0"></div>
              <div class="combine-rank-info">
                <div class="combine-rank-name">{{ d.nickname }}</div>
              </div>
              <div class="combine-rank-value accent">
                {{ d.msg_count }} 条
              </div>
            </div>
          </div>
          <div v-else class="empty" style="padding:30px;text-align:center;color:var(--text-muted)">暂无弹幕数据</div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, nextTick, watch } from 'vue'
import { useRouter } from 'vue-router'
import { storeToRefs } from 'pinia'
import { useAppStore } from '../stores/app'
import { lookupRoom, addRoom, pauseRoom, resumeRoom, removeRoom, fetchRooms, fetchSummary, fetchUser, api } from '../api'
import type { Room } from '../api'
import { esc, fmtTime, fmtSessionTime, avatarHtml, avatarHtml52 } from '../utils/format'
import { replaceDouyinEmoji } from '../utils/douyin-emoji'
import { useToast } from '../composables/useToast'
import { useConfirm } from '../composables/useConfirm'
import { useSearch } from '../composables/useSearch'
import { useCombine } from '../composables/useCombine'

// ============================================================
// TYPES (Room imported from API layer, only UI-specific types here)
// ============================================================
interface LookupData { room_id: string; nickname: string; avatar: string; is_live: boolean }
interface AnonUser {
  sec_uid: string; db_nicknames: string[]; api_nickname: string
  db_avatar: string; api_avatar: string; avatar: string; nickname: string
  sessions: { streamer_name: string }[]; latest_action: { type: string } | null
}

// ============================================================
// STATE (from Pinia store)
// ============================================================
const store = useAppStore()
const router = useRouter()
const {
  contentLoading, contentFadeIn, topNavTab, viewLevel,
  rooms, connectedCount, pausedCount,
} = storeToRefs(store)
const summary = store.summary  // reactive object
const { toast } = useToast()
const { showConfirm } = useConfirm()

// Cache-aware: show cached data immediately (no spinner), only show loading on first visit
// rooms 由 SessionsView 加载过也算有缓存，但 summary 必须也加载过才不算"从0开始"
const _hasCache = rooms.value.length > 0 && summary.total_sessions > 0
contentLoading.value = !_hasCache
contentFadeIn.value = false

// ============================================================
// NAVIGATION (to child routes)
// ============================================================
function viewSessions(hostId: string) {
  router.push({ name: 'sessions', params: { hostId } })
}

// ============================================================
// ROOMS VIEW
// ============================================================
function roomBadgeClass(r: Room) {
  if (r.connected) return 'badge-live'
  if (r._connecting) return 'badge-connecting'
  return r.enabled ? 'badge-idle' : 'badge-paused'
}

function roomBadgeText(r: Room) {
  if (r.connected) return '监控中'
  if (r._connecting) return '连接中'
  return r.enabled ? '已启用' : '已暂停'
}

let _viewGen = 0

async function loadRoomsView(gen?: number) {
  const hasCache = rooms.value.length > 0
  if (!hasCache) {
    contentLoading.value = true
    contentFadeIn.value = false
  }
  // hasCache: silent refresh — keep showing cached data, no spinner
  try {
    const [s, r] = await Promise.all([fetchSummary(), fetchRooms()])
    if (gen !== undefined && gen !== _viewGen) return
    rooms.value = r
    Object.assign(summary, s)
    contentLoading.value = false
    if (!hasCache) contentFadeIn.value = true
  } catch (e: any) {
    if (gen !== undefined && gen !== _viewGen) return
    contentLoading.value = false
    if (!hasCache) contentFadeIn.value = true
    toast('加载失败: ' + e.message, 'error')
  }
  if (gen === undefined || gen === _viewGen) startRoomStatusPoll()
}

function sortRooms() {
  rooms.value.sort((a, b) => {
    if (a.enabled !== b.enabled) return a.enabled ? -1 : 1
    if (a.connected !== b.connected) return a.connected ? -1 : 1
    return a.name.localeCompare(b.name) || a.room_id.localeCompare(b.room_id)
  })
}

let _roomStatusPollTimer: ReturnType<typeof setInterval> | null = null

async function pollRoomStatus() {
  if (topNavTab.value !== 'rooms') return
  try {
    const r = await fetchRooms()
    for (const newRoom of r) {
      const old = rooms.value.find(x => x.room_id === newRoom.room_id)
      if (old) {
        old.connected = newRoom.connected
        old.enabled = newRoom.enabled
        old.recording = newRoom.recording
        old._connecting = false
        old.session_count = newRoom.session_count
      }
    }
    sortRooms()
  } catch {}
}

function startRoomStatusPoll() {
  stopRoomStatusPoll()
  _roomStatusPollTimer = setInterval(pollRoomStatus, 15000)
}

function stopRoomStatusPoll() {
  if (_roomStatusPollTimer) { clearInterval(_roomStatusPollTimer); _roomStatusPollTimer = null }
}

// ============================================================
// ADD ROOM
// ============================================================
const showAddRoomModal = ref(false)
const addRoomInput = ref('')
const addRoomInputEl = ref<HTMLInputElement | null>(null)
const lookupData = ref<LookupData | null>(null)
const addRoomName = ref('')
const lookupLoading = ref(false)
const addRoomSubmitting = ref(false)

function showAddRoomFn() {
  lookupData.value = null
  addRoomInput.value = ''
  addRoomName.value = ''
  showAddRoomModal.value = true
  nextTick(() => { if (addRoomInputEl.value) addRoomInputEl.value.focus() })
}

function closeAddRoom() {
  showAddRoomModal.value = false
  lookupData.value = null
}

async function lookupRoomFn() {
  if (!addRoomInput.value.trim()) return
  lookupLoading.value = true
  try {
    const r = await lookupRoom(addRoomInput.value.trim())
    if (r.error) { toast(r.error, 'error'); lookupLoading.value = false; return }
    lookupData.value = r
    addRoomName.value = r.nickname || ''
  } catch (e: any) { toast('查询失败: ' + e.message, 'error') }
  lookupLoading.value = false
}

async function confirmAddRoom() {
  if (!lookupData.value || !lookupData.value.room_id) { toast('请先查询房间信息', 'error'); return }
  const name = addRoomName.value.trim() || lookupData.value.nickname
  const room_id = lookupData.value.room_id
  const avatar = lookupData.value.avatar
  addRoomSubmitting.value = true
  try {
    const r = await addRoom(room_id, name)
    toast(r.ok ? `已添加 ${name || room_id}` : (r.error || '添加失败'), r.ok ? 'success' : 'error')
    closeAddRoom()
    if (r.ok) {
      const newRoom: Room = { room_id, name: name || '', avatar, enabled: true, connected: false, recording: false, session_count: 0 }
      rooms.value.push(newRoom)
      sortRooms()
      setTimeout(pollRoomStatus, 500)
    }
  } catch (e: any) { toast('网络错误: ' + e.message, 'error') }
  finally { addRoomSubmitting.value = false }
}

async function pauseRoomFn(roomId: string) {
  if (!await showConfirm('<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16" rx="1"/><rect x="14" y="4" width="4" height="16" rx="1"/></svg>', '确定暂停这个房间的监控？')) return
  try {
    const r = await pauseRoom(roomId)
    toast(r.ok ? '已暂停' : (r.error || '操作失败'), r.ok ? 'success' : 'error')
    if (r.ok) {
      const room = rooms.value.find(r => r.room_id === roomId)
      if (room) { room.enabled = false; room.connected = false }
      sortRooms()
    }
  } catch (e: any) { toast('网络错误: ' + e.message, 'error') }
}

async function resumeRoomFn(roomId: string) {
  try {
    const r = await resumeRoom(roomId)
    toast(r.ok ? '已恢复' : (r.error || '操作失败'), r.ok ? 'success' : 'error')
    if (r.ok) {
      const room = rooms.value.find(r => r.room_id === roomId)
      if (room) { room.enabled = true; room.connected = false; room._connecting = true }
      setTimeout(pollRoomStatus, 500)
    }
  } catch (e: any) { toast('网络错误: ' + e.message, 'error') }
}

async function confirmDeleteRoom(roomId: string, name: string) {
  const confirmed = await showConfirm('🗑️', `确定删除 <strong>${esc(name || roomId)}</strong>？<br><br>将停止监控并清除所有历史数据<br>（弹幕、礼物、场次记录）<br><br>此操作不可恢复！`)
  if (!confirmed) return
  try {
    const r = await removeRoom(roomId, true)
    toast(r.ok ? '已删除' : (r.error || '删除失败'), r.ok ? 'success' : 'error')
    if (r.ok) { rooms.value = rooms.value.filter(r => r.room_id !== roomId) }
  } catch (e: any) { toast('网络错误: ' + e.message, 'error') }
}

// ============================================================
// SEARCH VIEW (from composable)
// ============================================================
const {
  streamers, csState, csLabels, csOpen, anonSessions,
  searchInput, searchResults, searchLoading, searchSearched,
  loadSearchView, toggleCs, selectCs, doAnonymousLookup,
  getDbName, actionLabel
} = useSearch(api, toast)

// ============================================================
// COMBINE VIEW (from composable)
// ============================================================
const {
  allSessions: combineSessions, selectedIds: combineSelectedIds,
  combineLoading, viewLoading: combineViewLoading,
  combinedResult: combineResult, showCombineModal,
  groupedSessions: combineGrouped, expandedStreamers: combineExpanded,
  loadCombineView, toggleSelect: combineToggleSelect,
  toggleStreamer: combineToggleStreamer,
  toggleStreamerSessions: combineToggleStreamerSessions,
  selectRecent: combineSelectRecent, selectAll: combineSelectAll,
  mergeSessions, closeCombineModal,
} = useCombine(api, toast)

const combineResultTab = ref<'gifts' | 'anchors' | 'danmaku'>('gifts')

function combineStreamerSelectedCount(streamerId: number) {
  const group = combineGrouped.value.find((g: any) => g.streamer_id === streamerId)
  if (!group) return 0
  return group.sessions.filter((s: any) => combineSelectedIds.value.has(s.id)).length
}

function combineStreamerTotalDiamonds(streamerId: number) {
  const group = combineGrouped.value.find((g: any) => g.streamer_id === streamerId)
  if (!group) return 0
  return group.sessions.reduce((sum: number, s: any) => sum + (s.total_diamonds || 0), 0)
}

// ============================================================
// ANON DETAIL MODAL
// ============================================================
const anonDetailModalVisible = ref(false)
const anonDetailTitle = ref('用户详情')
const anonDetailBody = ref('')
const _anonResults = ref<AnonUser[]>([])

function closeAnonDetailModal() { anonDetailModalVisible.value = false }

async function showAnonymousDetail(idx: number) {
  const u = _anonResults.value[idx] || searchResults.value[idx]
  if (!u) return
  anonDetailModalVisible.value = true
  anonDetailTitle.value = u.db_nicknames?.[0] || u.nickname || '用户详情'
  let html = ''
  html += `<div style="display:flex;align-items:center;gap:14px;padding:16px 0;border-bottom:1px solid var(--border);margin-bottom:14px">`
  html += avatarHtml52(u.api_avatar || u.avatar, u.nickname)
  html += `<div style="flex:1;min-width:0">`
  html += `<div style="font-size:16px;font-weight:600;color:var(--text)">${esc(u.nickname || '未知')}</div>`
  if (u.db_nicknames?.length > 1) html += `<div style="font-size:12px;color:var(--text-muted);margin-top:3px">库中昵称: ${u.db_nicknames.map((n: string) => esc(n)).join('、')}</div>`
  html += `</div></div>`
  if (u.latest_danmaku || u.latest_gift) {
    const giftSvg = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14" style="vertical-align:middle"><rect x="3" y="8" width="18" height="13" rx="1"/><path d="M12 8V6c0-2-1.5-4-4-4S4 4 4 6h2"/><path d="M20 6c0-2-1.5-4-4-4s-4 2-4 4h2"/><line x1="12" y1="8" x2="12" y2="21"/><line x1="3" y1="13" x2="21" y2="13"/></svg>'
    const danmakuSvg = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14" style="vertical-align:middle"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>'
    const actions: any[] = []
    if (u.latest_danmaku) actions.push({ type: 'danmaku', svg: danmakuSvg, color: 'var(--accent)', bg: 'rgba(108,140,255,0.15)', label: '弹幕', ...u.latest_danmaku })
    if (u.latest_gift) actions.push({ type: 'gift', svg: giftSvg, color: 'var(--orange)', bg: 'rgba(251,146,60,0.15)', label: '送礼', ...u.latest_gift })
    actions.sort((a: any, b: any) => (b.time || 0) - (a.time || 0))
    html += `<div style="background:var(--bg);border:1px solid var(--border);border-radius:var(--radius);padding:12px 14px;margin-bottom:14px"><div style="font-size:12px;font-weight:500;color:var(--text-secondary);margin-bottom:8px">最近动作</div>`
    for (const a of actions) {
      let detail = a.detail || (a.type === 'danmaku' ? '发了弹幕' : '送了礼物')
      if (detail.length > 40) detail = detail.slice(0, 40) + '…'
      html += `<div style="display:flex;align-items:flex-start;gap:8px;margin-bottom:6px"><div style="margin-top:2px;color:${a.color}">${a.svg}</div><div style="flex:1;min-width:0"><div style="font-size:13px;color:var(--text);line-height:1.4">${replaceDouyinEmoji(esc(detail))}</div><div style="font-size:11px;color:var(--text-muted);margin-top:4px">${a.streamer_name ? esc(a.streamer_name) : ''} ${a.time ? '· ' + fmtTime(a.time) : ''}</div></div><div style="font-size:11px;color:${a.color};flex-shrink:0;padding:2px 8px;background:${a.bg};border-radius:var(--radius-xs)">${a.label}</div></div>`
    }
    html += `</div>`
  }
  const sessionsList = u.sessions || []
  if (sessionsList.length) {
    html += `<div style="font-size:12px;font-weight:500;color:var(--text-secondary);margin-bottom:8px">活跃场次 (${sessionsList.length})</div><div style="display:flex;flex-direction:column;gap:4px">`
    sessionsList.slice(0, 5).forEach((s: any) => {
      const d = s.diamonds || 0
      html += `<div style="display:flex;align-items:center;gap:8px;padding:8px 12px;background:var(--bg-card);border:1px solid var(--border);border-radius:var(--radius-sm)"><span style="font-size:12px;color:var(--text-muted);width:72px;flex-shrink:0;font-variant-numeric:tabular-nums">${fmtSessionTime(s.start_time)}</span><span style="font-size:12px;color:var(--text);flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(s.streamer_name || '未知')}</span><span style="font-size:12px;color:${d > 0 ? 'var(--orange)' : 'var(--text-muted)'};flex-shrink:0;font-weight:600;font-variant-numeric:tabular-nums;display:inline-flex;align-items:center"><svg viewBox="0 0 24 24" width="12" height="12" style="margin-left:2px;fill:currentColor"><path d="M6 2h12l4 7-10 13L2 9z"/><path d="M2 9h20" stroke="rgba(255,255,255,0.2)" stroke-width="0.7" fill="none"/><path d="M12 22l-4-13h8z" fill="rgba(0,0,0,0.1)"/></svg>${d.toLocaleString()}</span></div>`
    })
    if (sessionsList.length > 5) html += `<div style="text-align:center;font-size:11px;color:var(--text-muted);padding:4px">还有 ${sessionsList.length - 5} 场</div>`
    html += `</div>`
  }
  anonDetailBody.value = html
  fetchUser(u.sec_uid).then(p => {
    if (!p) return
    let extra = ''
    if (p.signature) extra += `<div style="font-size:12px;color:var(--text-muted);margin-top:4px;font-style:italic">${esc(p.signature)}</div>`
    if (p.user_age || p.user_gender) extra += `<div style="font-size:11px;color:var(--text-muted);margin-top:3px">${p.user_gender ? (p.user_gender === 1 ? '♂ 男' : p.user_gender === 2 ? '♀ 女' : '') : ''}${p.user_age ? ' · ' + p.user_age + '岁' : ''}</div>`
    if (p.unique_id) extra += `<div style="font-size:11px;color:var(--text-muted);margin-top:2px">抖音号: ${esc(p.unique_id)}</div>`
    if (extra) {
      const body = document.getElementById('anonDetailBody')
      if (body) body.insertAdjacentHTML('afterbegin', extra)
    }
  }).catch(() => {})
}



// ============================================================
// GLOBAL EVENT LISTENERS
// ============================================================
function handleDocClick(e: MouseEvent) {
  if (!(e.target as HTMLElement).closest('.cs-wrap')) {
    csOpen.value = ''
  }
}

// ============================================================
// WATCH: topNavTab switching (Layout triggers, HomeView loads content)
// ============================================================
watch(topNavTab, (tab) => {
  if (tab === 'rooms') loadRoomsView()
  else if (tab === 'search') loadSearchView()
  else if (tab === 'combine') loadCombineView()
})

// ============================================================
// LIFECYCLE
// ============================================================
onMounted(() => {
  // Set hosts navigation state
  viewLevel.value = 'hosts'
  store.pageTitle = '直播监控'
  store.showBackBtn = false
  store.showTopNav = true
  store.breadcrumbItems = []

  // Load initial data
  loadRoomsView()

  document.addEventListener('click', handleDocClick)
})

onUnmounted(() => {
  document.removeEventListener('click', handleDocClick)
  stopRoomStatusPoll()
})
</script>
