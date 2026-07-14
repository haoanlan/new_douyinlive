<template>
  <div class="app">
    <!-- HEADER -->
    <div class="header">
      <div style="display:flex;align-items:center;gap:14px">
        <button class="back-btn" :class="{ show: showBackBtn }" @click="goBack">
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2"><path d="M10 3L5 8l5 5"/></svg>
          返回
        </button>
        <h1 id="pageTitle">{{ pageTitle }}</h1>
      </div>
      <div class="header-meta" id="headerMeta"></div>
    </div>

    <!-- BREADCRUMB -->
    <div class="breadcrumb" :class="{ show: breadcrumbItems.length > 0 }">
      <template v-for="(item, i) in breadcrumbItems" :key="i">
        <span v-if="item.onClick" class="breadcrumb-item" @click="item.onClick">{{ item.label }}</span>
        <span v-if="item.onClick" class="breadcrumb-sep">›</span>
        <span v-if="!item.onClick" class="breadcrumb-current">{{ item.label }}</span>
      </template>
    </div>

    <!-- TOP NAV (hosts level only) -->
    <div class="top-nav" :class="{ visible: showTopNav }">
      <button class="top-nav-btn" :class="{ active: topNavTab === 'rooms' }" @click="switchTopNav('rooms')">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>
        房间管理
      </button>
      <button class="top-nav-btn" :class="{ active: topNavTab === 'search' }" @click="switchTopNav('search')">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
        匿名查询
      </button>
      <button class="top-nav-btn" :class="{ active: topNavTab === 'profile' }" @click="switchTopNav('profile')">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
        用户画像
      </button>
    </div>

    <!-- CONTENT -->
    <div id="content" :class="{ 'content-fade-in': contentFadeIn }">
      <!-- Loading state -->
      <div v-if="contentLoading" class="loading">加载中...</div>
      <!-- Rooms view -->
      <template v-else-if="topNavTab === 'rooms' && viewLevel === 'hosts'">
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
            <button class="btn btn-ghost btn-sm" @click="showAddRoomFn" style="border-color:var(--border-light)">+ 添加房间</button>
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
                  <div class="host-name" v-html="r.name || '<span style=&quot;color:var(--text-muted);font-style:italic&quot;>解析中...</span>'"></div>
                  <div class="host-meta">
                    <span class="host-badge" :class="roomBadgeClass(r)">{{ roomBadgeText(r) }}</span>
                    <span>{{ r.session_count }} 场</span>
                  </div>
                </div>
                <div class="room-card-actions">
                  <button v-if="r.enabled" class="action-btn" @click.stop="pauseRoomFn(r.room_id)" title="暂停">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16" rx="1"/><rect x="14" y="4" width="4" height="16" rx="1"/></svg>
                  </button>
                  <button v-else class="action-btn action-btn-resume" @click.stop="resumeRoomFn(r.room_id)" title="恢复">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>
                  </button>
                  <button class="action-btn action-btn-del" @click.stop="confirmDeleteRoom(r.room_id, r.name)" title="删除">
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
              <button class="modal-close" @click="closeAddRoom">✕</button>
            </div>
            <div class="modal-body">
              <div class="modal-field">
                <label>房间号 / 抖音号</label>
                <div style="display:flex;gap:8px">
                  <input ref="addRoomInputEl" v-model="addRoomInput" placeholder="输入房间号或抖音号" @keydown.enter="lookupRoomFn">
                  <button class="btn btn-ghost btn-sm" @click="lookupRoomFn" :disabled="lookupLoading" id="lookupBtn" style="border-color:var(--border-light)">{{ lookupLoading ? '查询中...' : '查询' }}</button>
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
                    <div style="font-weight:500;font-size:13px" v-html="lookupData.nickname ? esc(lookupData.nickname) : '<span style=&quot;color:var(--text-muted);font-style:italic&quot;>待解析</span>'"></div>
                    <div style="font-size:11px;color:var(--text-muted)">房间号: {{ lookupData.room_id || '未开播' }}<template v-if="lookupData.is_live"> · <span style="color:var(--green)">直播中</span></template></div>
                  </div>
                </div>
              </div>
            </div>
            <div class="modal-footer">
              <button class="btn btn-ghost btn-sm" @click="closeAddRoom">取消</button>
              <button class="btn btn-ghost btn-sm" id="addRoomConfirmBtn" @click="confirmAddRoom" :disabled="!lookupData || !lookupData.room_id || addRoomSubmitting" style="border-color:var(--border-light)">{{ addRoomSubmitting ? '添加中...' : '确认添加' }}</button>
            </div>
          </div>
        </div>
      </template>
      <!-- Sessions view -->
      <template v-else-if="viewLevel === 'sessions' && topNavTab === 'rooms'">
        <div class="stats-row">
          <div class="stat-card"><div class="stat-label">场次</div><div class="stat-value">{{ sessions.length }}</div></div>
          <div class="stat-card"><div class="stat-label">礼物</div><div class="stat-value">{{ sessionsTotalGifts.toLocaleString() }}</div></div>
          <div class="stat-card"><div class="stat-label">钻石</div><div class="stat-value">{{ sessionsTotalDiamonds.toLocaleString() }}</div></div>
          <div class="stat-card"><div class="stat-label">弹幕</div><div class="stat-value">{{ sessionsTotalDanmaku.toLocaleString() }}</div></div>
          <div class="stat-card"><div class="stat-label">用户</div><div class="stat-value">{{ sessionsTotalUsers.toLocaleString() }}</div></div>
          <div class="stat-card"><div class="stat-label">点赞</div><div class="stat-value">{{ sessionsTotalLikes.toLocaleString() }}</div></div>
        </div>
        <div class="section">
          <div class="section-header"><div class="section-title">场次列表</div></div>
          <div class="filter-bar">
            <label><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="12" height="12" style="vertical-align:-2px"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg> 日期</label>
            <div class="dp-input" id="dpFrom" @click="dpOpen('from')">
              <span v-if="!dpData.from" class="dp-ph">开始日期</span>
              <span v-else class="dp-val">{{ dpData.from }}</span>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
            </div>
            <span class="filter-sep">~</span>
            <div class="dp-input" id="dpTo" @click="dpOpen('to')">
              <span v-if="!dpData.to" class="dp-ph">结束日期</span>
              <span v-else class="dp-val">{{ dpData.to }}</span>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
            </div>
            <button class="filter-btn" @click="clearDateFilter">清除</button>
          </div>
          <div style="overflow-x:auto">
            <table class="session-table">
              <thead>
                <tr>
                  <th style="width:36px;padding-left:8px"><input type="checkbox" class="session-cb" id="selectAll" :checked="selectedSessionIds.length === sessions.length && sessions.length > 0" @change="toggleSelectAll"></th>
                  <th>场次</th><th>状态</th><th>开始时间</th><th>结束时间</th><th>时长</th><th>礼物</th><th>钻石</th><th>弹幕</th><th>用户</th><th style="width:80px">操作</th>
                </tr>
              </thead>
              <tbody id="sessionTbody">
                <tr v-for="s in filteredSessions" :key="s.id" :data-id="s.id" :data-start="s.started_at || ''" @click="viewDetail(s.id)">
                  <td data-label="" @click.stop style="padding-left:8px"><input type="checkbox" class="session-cb" :value="s.id" :checked="selectedSessionIds.includes(s.id)" @change="toggleSessionCheckbox(s.id, $event)"></td>
                  <td data-label="场次" style="font-weight:500">{{ s.title || '未命名' }}</td>
                  <td data-label="状态"><span class="session-badge" :class="s.is_live ? 'live' : 'offline'">{{ s.is_live ? '直播中' : '已结束' }}</span></td>
                  <td data-label="开始" style="color:var(--text-secondary)">{{ fmtTime(s.started_at) }}</td>
                  <td data-label="结束" style="color:var(--text-secondary)"><span v-if="!s.ended_at" style="color:var(--green)">进行中</span><span v-else>{{ fmtTime(s.ended_at) }}</span></td>
                  <td data-label="时长" style="color:var(--text-secondary)">{{ s.duration_min != null ? formatDuration(s.duration_min) : '-' }}</td>
                  <td data-label="礼物"><span style="display:inline-flex;align-items:center"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="12" height="12" style="margin-right:2px"><rect x="3" y="8" width="18" height="13" rx="1"/><path d="M12 8V6c0-2-1.5-4-4-4S4 4 4 6h2"/><path d="M20 6c0-2-1.5-4-4-4s-4 2-4 4h2"/><line x1="12" y1="8" x2="12" y2="21"/><line x1="3" y1="13" x2="21" y2="13"/></svg> {{ s.gift_count.toLocaleString() }}</span></td>
                  <td data-label="钻石" class="diamonds"><span style="display:inline-flex;align-items:center"><svg viewBox="0 0 24 24" width="12" height="12" style="margin-right:2px;fill:currentColor"><path d="M6 2h12l4 7-10 13L2 9z"/><path d="M2 9h20" stroke="rgba(255,255,255,0.2)" stroke-width="0.7" fill="none"/><path d="M12 22l-4-13h8z" fill="rgba(0,0,0,0.1)"/></svg> {{ s.total_diamonds.toLocaleString() }}</span></td>
                  <td data-label="弹幕">{{ s.danmaku_count.toLocaleString() }}</td>
                  <td data-label="用户">{{ s.user_count.toLocaleString() }}</td>
                  <td data-label="" @click.stop>
                    <div style="display:flex;gap:4px">
                      <button class="action-btn" title="下载报告" @click.stop="downloadReport(s.id)">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" width="14" height="14"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                      </button>
                      <button class="action-btn action-btn-del" title="删除" @click.stop="deleteSessionFromList(s.id)">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" width="14" height="14"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                      </button>
                    </div>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </template>
      <!-- Detail view -->
      <template v-else-if="viewLevel === 'detail' && topNavTab === 'rooms'">
        <div v-if="detailData" class="detail-view">
          <!-- Stats -->
          <div class="stats-row">
            <div class="stat-card"><div class="stat-label">峰值在线</div><div class="stat-value">{{ (detailData.session?.online_peak || 0).toLocaleString() }}</div></div>
            <div class="stat-card"><div class="stat-label">总钻石</div><div class="stat-value">{{ detailData.summary?.total_diamonds?.toLocaleString() || 0 }}</div></div>
            <div class="stat-card"><div class="stat-label">点赞</div><div class="stat-value">{{ (detailData.session?.stats_like || 0).toLocaleString() }}</div></div>
            <div class="stat-card"><div class="stat-label">弹幕</div><div class="stat-value">{{ detailData.summary?.danmaku_count?.toLocaleString() || 0 }}</div></div>
            <div class="stat-card"><div class="stat-label">用户</div><div class="stat-value">{{ detailData.summary?.user_count?.toLocaleString() || 0 }}</div></div>
            <div class="stat-card"><div class="stat-label">时长</div><div class="stat-value">{{ detailData.session?.duration_min != null ? formatDuration(detailData.session.duration_min) : '进行中' }}</div></div>
          </div>
          <!-- Tab Bar -->
          <div class="tab-bar" id="tabBar">
            <button v-if="detailData.anchorRanking && detailData.anchorRanking.length > 1" class="tab-btn" :class="{ active: detailTab === 'anchors' }" @click="switchDetailTab('anchors')">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
              主播排名
            </button>
            <button class="tab-btn" :class="{ active: detailTab === 'gifts' }" @click="switchDetailTab('gifts')">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/></svg>
              礼物榜单
            </button>
            <button class="tab-btn" :class="{ active: detailTab === 'danmaku' }" @click="switchDetailTab('danmaku')">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
              弹幕
            </button>
            <button class="tab-btn" :class="{ active: detailTab === 'anon' }" @click="switchDetailTab('anon')">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>
              信息查询
            </button>
            <button v-if="detailData.hasReport" class="tab-btn" :class="{ active: detailTab === 'report' }" @click="switchDetailTab('report')">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/></svg>
              报告
            </button>
          </div>
          <!-- Live refresh bar -->
          <div v-if="detailData.session?.is_live" style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px">
            <div style="font-size:11px;color:var(--text-muted);display:flex;align-items:center;gap:4px"><span class="dot" style="width:6px;height:6px;border-radius:50%;background:var(--green);display:inline-block;animation:pulse 2s infinite"></span> 直播中 · 每15秒自动刷新</div>
            <button class="btn btn-ghost btn-sm" @click="manualRefresh" :disabled="refreshing" style="font-size:12px;padding:4px 10px;display:flex;align-items:center;gap:4px;min-width:72px;justify-content:center">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="12" height="12" :class="{ spin: refreshing }"><path d="M23 4v6h-6"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>
              刷新
            </button>
          </div>
          <!-- Anchors tab -->
          <div v-if="detailTab === 'anchors'" class="tab-panel active">
            <template v-if="detailData.anchorRanking && detailData.anchorRanking.length > 0">
              <div style="font-size:13px;font-weight:600;color:var(--text);margin-bottom:10px;display:flex;align-items:center;gap:6px">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
                主播排名
              </div>
              <div class="anchor-grid">
                <div v-for="(a, idx) in detailData.anchorRanking" :key="a.anchor_name || idx" class="anchor-card" @click="openAnchorModal(a.anchor_name, detailData.session.id)">
                  <div class="anchor-card-rank">{{ String(idx + 1).padStart(2, '0') }}</div>
                  <div class="anchor-card-header">
                    <div class="anchor-card-avatar">
                      <AvatarFallback :src="a.anchor_avatar" :name="a.anchor_name" size="32" />
                    </div>
                    <div class="anchor-card-name">{{ a.anchor_name }}</div>
                  </div>
                  <div class="anchor-card-stats">
                    <div class="stat"><svg viewBox="0 0 24 24" width="12" height="12" style="vertical-align:-2px;fill:currentColor"><path d="M6 2h12l4 7-10 13L2 9z"/><path d="M2 9h20" stroke="rgba(255,255,255,0.2)" stroke-width="0.7" fill="none"/><path d="M12 22l-4-13h8z" fill="rgba(0,0,0,0.1)"/></svg> <span class="stat-val">{{ a.total_diamonds.toLocaleString() }}</span></div>
                    <div class="stat"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="12" height="12" style="vertical-align:-2px"><rect x="3" y="8" width="18" height="13" rx="1"/><path d="M12 8V6c0-2-1.5-4-4-4S4 4 4 6h2"/><path d="M20 6c0-2-1.5-4-4-4s-4 2-4 4h2"/><line x1="12" y1="8" x2="12" y2="21"/><line x1="3" y1="13" x2="21" y2="13"/></svg> <span class="stat-val">{{ a.gift_count.toLocaleString() }}</span></div>
                    <div class="stat"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="12" height="12" style="vertical-align:-2px"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg> <span class="stat-val">{{ a.user_count }}</span></div>
                  </div>
                </div>
              </div>
            </template>
            <div v-else class="empty" style="padding:40px"><div class="empty-icon">—</div>暂无主播数据</div>
          </div>
          <!-- Gifts tab -->
          <div v-if="detailTab === 'gifts'" class="tab-panel active">
            <template v-if="detailData.gifts && detailData.gifts.length > 0">
              <div style="font-size:13px;font-weight:600;color:var(--text);margin-bottom:10px;display:flex;align-items:center;gap:6px">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/></svg>
                礼物榜单
              </div>
              <div class="gift-rank-grid">
                <div v-for="(g, idx) in detailData.gifts" :key="g.user_sec_uid || idx" class="gift-rank-card" @click="showGiftDetail(g.nickname, g.user_sec_uid || '')">
                  <div class="gift-rank-card-top">
                    <span class="gift-rank-num">{{ String(idx + 1).padStart(2, '0') }}</span>
                    <div class="user-cell">
                      <div class="avatar" v-html="avatarHtml(g.avatar_url, g.nickname)"></div>
                      <span>{{ g.nickname }}</span>
                    </div>
                    <div class="diamonds"><svg viewBox="0 0 24 24" width="12" height="12" style="vertical-align:-2px;margin-right:2px;fill:currentColor"><path d="M6 2h12l4 7-10 13L2 9z"/><path d="M2 9h20" stroke="rgba(255,255,255,0.2)" stroke-width="0.7" fill="none"/><path d="M12 22l-4-13h8z" fill="rgba(0,0,0,0.1)"/></svg> {{ g.total_diamonds.toLocaleString() }}</div>
                  </div>
                </div>
              </div>
            </template>
            <div v-else class="empty" style="padding:40px"><div class="empty-icon">—</div>暂无礼物数据</div>
          </div>
          <!-- Danmaku tab -->
          <div v-if="detailTab === 'danmaku'" class="tab-panel active">
            <div class="detail-section">
              <div id="danmakuGrid" style="display:grid;grid-template-columns:340px 1fr;gap:14px;align-items:start">
                <!-- Left: rank -->
                <div ref="danmakuLeftEl" id="danmakuLeft" style="min-width:0">
                  <div style="font-size:13px;font-weight:600;color:var(--text);margin-bottom:10px;display:flex;align-items:center;gap:6px">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
                    弹幕排行
                  </div>
                  <div class="danmaku-user-rank-list">
                    <template v-if="detailData.danmakuRanking && detailData.danmakuRanking.length > 0">
                      <div v-for="(d, idx) in detailData.danmakuRanking.slice(0, 10)" :key="d.nickname || idx" class="danmaku-user-rank" :class="{ 'rank-flash': _rankChanged.has(d.nickname) }">
                        <span class="rank-num" :class="{ top3: idx < 3 }">{{ String(idx + 1).padStart(2, '0') }}</span>
                        <div class="user-cell">
                          <div class="avatar" v-html="avatarHtml(d.avatar, d.nickname)"></div>
                          <span style="font-size:13px">{{ d.nickname }}</span>
                        </div>
                        <div class="msg-count"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="12" height="12" style="vertical-align:middle;margin-right:2px"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg> {{ d.msg_count.toLocaleString() }}条</div>
                      </div>
                    </template>
                    <div v-else class="empty" style="padding:20px">暂无弹幕数据</div>
                  </div>
                </div>
                <!-- Right: wordcloud + danmaku list -->
                <div ref="danmakuRightEl" id="danmakuRight" style="display:flex;flex-direction:column;min-width:0">
                  <div style="margin-bottom:14px">
                    <div style="font-size:13px;font-weight:600;color:var(--text);margin-bottom:10px;display:flex;align-items:center;gap:6px">
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><path d="M18 10h-1.26A8 8 0 1 0 9 20h9a5 5 0 0 0 0-10z"/></svg>
                      弹幕词云
                    </div>
                    <canvas id="wordcloudCanvas" class="wordcloud-canvas"></canvas>
                  </div>
                  <div style="flex:1;min-height:0;display:flex;flex-direction:column">
                    <div id="dmTotalBadge" style="font-size:13px;font-weight:600;color:var(--text);margin-bottom:10px;display:flex;align-items:center;gap:6px">
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><path d="M22 12h-4l-3 9L9 3l-3 9H2"/></svg>
                      最新动态
                    </div>
                    <div style="display:flex;gap:6px;align-items:center;margin-bottom:8px;flex-shrink:0;flex-wrap:wrap">
                      <div class="search-wrap" style="flex:1;min-width:120px;margin-bottom:0">
                        <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="7" cy="7" r="5"/><path d="M11 11l3 3"/></svg>
                        <input id="danmakuSearch" placeholder="搜索弹幕或礼物..." v-model="danmakuSearchQuery" @input="onDanmakuSearchInput">
                      </div>
                      <div class="dm-limit-select" @click.stop="dmLimitOpen = !dmLimitOpen">
                        <span>{{ danmakuDisplayLimit === 0 ? '全部' : danmakuDisplayLimit + '条' }}</span>
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="12" height="12"><path d="M6 9l6 6 6-6"/></svg>
                        <div v-if="dmLimitOpen" class="dm-limit-dropdown">
                          <div v-for="opt in [{v:50,l:'50条'},{v:100,l:'100条'},{v:200,l:'200条'},{v:0,l:'全部'}]" :key="opt.v" class="dm-limit-option" :class="{ active: danmakuDisplayLimit === opt.v }" @click.stop="danmakuDisplayLimit = opt.v; dmLimitOpen = false">{{ opt.l }}</div>
                        </div>
                      </div>
                    </div>
                    <div id="rtDanmakuWrap" class="rt-danmaku-wrap" style="flex:1;display:flex;flex-direction:column;overflow:hidden;position:relative">
                      <!-- 初始加载 & 条数切换 loading -->
                      <div v-if="anonLoading || dmSwitchLoading" class="loading" style="position:absolute;inset:0;z-index:10;min-height:0;padding:0"></div>
                      <div id="rtDanmakuList" class="rt-danmaku-list" style="flex:1;overflow-y:auto;overflow-x:hidden">
                        <template v-if="displayedDanmaku.length > 0">
                          <div v-for="(d, idx) in displayedDanmaku" :key="d._key" class="anon-result-item dm-item" style="padding:6px 0">
                            <div style="flex-shrink:0;min-width:0" v-html="avatarHtml(d.avatar_url || d.avatar, d.nickname)"></div>
                            <div style="flex:1;min-width:0;overflow:hidden">
                              <div style="display:flex;align-items:center;gap:6px;margin-bottom:1px;min-width:0">
                                <span style="font-size:13px;font-weight:600;color:var(--text);flex-shrink:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:140px">{{ d.nickname || '匿名' }}</span>
                                <span v-if="d._type === 'gift'" style="font-size:10px;padding:1px 5px;border-radius:var(--radius-xs);background:rgba(255,107,157,0.15);color:#FF6B9D;flex-shrink:0">{{ fmtTime(d.timestamp) }}</span>
                                <span v-else style="font-size:11px;padding:1px 6px;border-radius:var(--radius-xs);background:rgba(108,140,255,0.15);color:var(--accent);flex-shrink:0">{{ fmtTime(d.timestamp) }}</span>
                              </div>
                              <div v-if="d._type === 'gift'" style="font-size:12px;color:#FF6B9D;word-break:break-all;line-height:1.5">
                                送了
                                <img v-if="d.gift_icon" :src="d.gift_icon" style="width:16px;height:16px;vertical-align:-3px;margin:0 2px;border-radius:var(--radius-xs)">
                                <svg v-else viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14" style="vertical-align:-2px;margin:0 2px"><rect x="3" y="8" width="18" height="13" rx="1"/><path d="M12 8V6c0-2-1.5-4-4-4S4 4 4 6h2"/><path d="M20 6c0-2-1.5-4-4-4s-4 2-4 4h2"/><line x1="12" y1="8" x2="12" y2="21"/><line x1="3" y1="13" x2="21" y2="13"/></svg>
                                <span style="font-weight:600">{{ d.gift_name }}</span>
                                <span v-if="d.to_nickname" style="margin-left:4px">→ {{ d.to_nickname }}</span>
                                <span v-if="d.total_diamonds" style="margin-left:6px;font-weight:600;color:var(--orange)">
                                  <svg viewBox="0 0 24 24" width="12" height="12" style="vertical-align:-2px;fill:currentColor"><path d="M6 2h12l4 7-10 13L2 9z"/><path d="M2 9h20" stroke="rgba(255,255,255,0.2)" stroke-width="0.7" fill="none"/></svg>
                                  {{ d.total_diamonds.toLocaleString() }}
                                </span>
                              </div>
                              <div v-else style="font-size:12px;color:var(--text-muted);word-break:break-all;line-height:1.5" :title="d.content" v-html="replaceDouyinEmoji(esc(d.content))"></div>
                            </div>
                          </div>
                        </template>
                        <div v-else class="empty" style="padding:40px 20px;display:flex;flex-direction:column;align-items:center;justify-content:center;width:100%;flex:1;min-height:180px">
                          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" width="32" height="32" style="margin-bottom:10px;opacity:0.3"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
                          <div style="color:var(--text-muted);font-size:13px">{{ danmakuSearchQuery ? '无匹配结果' : '暂无动态' }}</div>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
          <!-- Anon query tab -->
          <div v-if="detailTab === 'anon'" class="tab-panel active">
            <div class="detail-section">
              <div style="font-size:13px;font-weight:600;color:var(--text);margin-bottom:10px;display:flex;align-items:center;gap:6px">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>
                信息查询
              </div>
              <div style="font-size:12px;color:var(--text-muted);margin-bottom:14px">输入关键词，查询本场次相关的送礼或弹幕记录</div>
              <div class="anon-input-row">
                <input id="anonInput" v-model="anonQuery" placeholder="输入关键词（昵称/礼物名/弹幕内容）..." @keydown.enter="queryAnonymous">
                <button class="btn btn-ghost btn-sm" @click="queryAnonymous" style="border-color:var(--border)">查询</button>
              </div>
              <div id="anonResult" class="anon-result" style="display:none" :style="anonMatches.length > 0 || anonSearched ? {display:'block'} : {}">
                <div v-if="anonMatches.length === 0 && anonSearched" class="empty" style="padding:20px">未找到匹配 "{{ anonQuery }}" 的记录</div>
                <div v-if="anonLoading" class="loading" style="padding:20px;min-height:0"></div>
                <div v-if="anonMatches.length > 0" style="font-size:12px;color:var(--text-muted);margin-bottom:10px">找到 <strong style="color:var(--text)">{{ anonMatches.length }}</strong> 条匹配记录</div>
                <div v-for="(m, idx) in anonMatches" :key="idx" class="anon-result-item" style="animation:fadeIn .3s ease">
                  <div style="flex-shrink:0">
                    <img v-if="m.avatar" :src="m.avatar" class="avatar" style="width:32px;height:32px" @error="$event.target.style.display='none'">
                    <div v-else class="avatar" style="width:32px;height:32px;display:flex;align-items:center;justify-content:center;font-size:13px;color:var(--text-muted)">{{ (m.nickname || '?')[0] }}</div>
                  </div>
                  <div style="flex:1;min-width:0">
                    <div style="display:flex;align-items:center;gap:8px;margin-bottom:2px">
                      <span style="font-size:13px;font-weight:600;color:var(--text)">{{ m.nickname || '匿名' }}</span>
                      <span style="font-size:11px;padding:1px 6px;border-radius:var(--radius-xs)" :style="{ background: m.type === '礼物' ? 'rgba(251,146,60,0.15)' : 'rgba(108,140,255,0.15)', color: m.type === '礼物' ? 'var(--orange)' : 'var(--accent)' }">{{ m.type }}</span>
                    </div>
                    <div style="font-size:12px;color:var(--text-muted);line-height:1.6" :title="m.content || ''">
                      <template v-if="m.type === '礼物'">
                        <img v-if="m.giftIcon" :src="m.giftIcon" style="width:16px;height:16px;vertical-align:-3px;margin-right:2px;border-radius:var(--radius-xs)">
                        <svg v-else viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14" style="vertical-align:-2px;margin-right:2px"><rect x="3" y="8" width="18" height="13" rx="1"/><path d="M12 8V6c0-2-1.5-4-4-4S4 4 4 6h2"/><path d="M20 6c0-2-1.5-4-4-4s-4 2-4 4h2"/><line x1="12" y1="8" x2="12" y2="21"/><line x1="3" y1="13" x2="21" y2="13"/></svg>
                        <span style="color:var(--text)">{{ m.displayText }}</span>
                        <span v-if="m.diamonds" style="margin-left:6px;font-weight:600;color:var(--orange)">
                          <svg viewBox="0 0 24 24" width="12" height="12" style="vertical-align:-2px;fill:currentColor"><path d="M6 2h12l4 7-10 13L2 9z"/><path d="M2 9h20" stroke="rgba(255,255,255,0.2)" stroke-width="0.7" fill="none"/><path d="M12 22l-4-13h8z" fill="rgba(0,0,0,0.1)"/></svg>
                          {{ m.diamonds.toLocaleString() }}
                        </span>
                        <span v-if="m.to_nickname" style="margin-left:6px;color:var(--accent)">→ {{ m.to_nickname }}</span>
                      </template>
                      <template v-else>
                        <span>{{ m.displayText }}</span>
                      </template>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
          <!-- Report tab -->
          <div v-if="detailTab === 'report'" class="tab-panel active" style="text-align:center;padding:20px">
            <img :src="`/api/sessions/${detailData.session?.id}/report`" style="max-width:100%;border-radius:var(--radius);box-shadow:var(--shadow-lg)">
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
              <button class="cs-btn" id="anonStreamerBtn" @click="toggleCs('anonStreamer')">{{ csLabels.anonStreamer || '全部直播间' }}</button>
              <div class="cs-list" :class="{ open: csOpen === 'anonStreamer' }" id="anonStreamerList">
                <div class="cs-opt" :class="{ selected: !csState.anonStreamer }" data-val="" @click="selectCs('anonStreamer', '', '全部直播间')">全部直播间</div>
                <div v-for="s in streamers" :key="s.id" class="cs-opt" :class="{ selected: csState.anonStreamer === s.id }" :data-val="s.id" @click="selectCs('anonStreamer', s.id, s.name || s.room_id)">{{ s.name || s.room_id }}</div>
              </div>
            </div>
            <div class="cs-wrap" id="anonSessionWrap">
              <button class="cs-btn" :class="{ disabled: !csState.anonStreamer }" id="anonSessionBtn" @click="toggleCs('anonSession')">{{ csLabels.anonSession || '全部场次' }}</button>
              <div class="cs-list" :class="{ open: csOpen === 'anonSession' }" id="anonSessionList">
                <div class="cs-opt" :class="{ selected: !csState.anonSession }" data-val="" @click="selectCs('anonSession', '', '全部场次')">全部场次</div>
                <div v-for="s in anonSessions" :key="s.id" class="cs-opt" :class="{ selected: csState.anonSession === String(s.id) }" :data-val="s.id" @click="selectCs('anonSession', String(s.id), (s.started_at ? fmtTime(s.started_at) : '') + ' ' + (s.title || ''))">{{ fmtTime(s.started_at) }} {{ s.title }}</div>
              </div>
            </div>
          </div>
          <div style="display:flex;gap:8px;margin-bottom:16px">
            <input v-model="searchInput" placeholder="输入昵称关键词..." style="flex:1;padding:8px 12px;background:var(--bg-card);border:1px solid var(--border);border-radius:var(--radius);color:var(--text);font-size:13px;outline:none" @keydown.enter="doAnonymousLookup">
            <button class="btn btn-ghost btn-sm" @click="doAnonymousLookup" style="border-color:var(--border-light)">查询</button>
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
      <!-- Profile view -->
      <template v-else-if="topNavTab === 'profile'">
        <div class="section">
          <div class="section-header">
            <div class="section-title">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
              用户画像
            </div>
          </div>
          <div style="display:flex;gap:8px;margin-bottom:16px">
            <input v-model="profileInput" placeholder="输入用户昵称搜索..." style="flex:1;padding:8px 12px;background:var(--bg-card);border:1px solid var(--border);border-radius:var(--radius);color:var(--text);font-size:13px;outline:none" @keydown.enter="searchProfileUser">
            <button class="btn btn-ghost btn-sm" @click="searchProfileUser" style="border-color:var(--border-light)">查询</button>
          </div>
          <div id="profileUserList">
            <div v-if="profileLoading" class="loading" style="min-height:auto;padding:30px">搜索中...</div>
            <div v-else-if="profileUsers.length > 0">
              <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
                <span style="font-size:12px;color:var(--text-muted)">找到 <strong style="color:var(--text)">{{ profileUsers.length }}</strong> 个用户</span>
              </div>
              <div style="display:flex;flex-direction:column;gap:6px">
                <div v-for="u in profileUsers" :key="u.user_sec_uid" class="lookup-card" @click="showUserProfile(u.user_sec_uid)">
                  <div class="user-cell">
                    <div class="avatar" v-html="avatarHtml(u.avatar, u.nickname)"></div>
                    <span>{{ u.nickname }}</span>
                  </div>
                  <div style="font-size:11px;color:var(--accent);flex-shrink:0">查看画像 →</div>
                </div>
              </div>
            </div>
            <div v-else-if="profileSearched && profileUsers.length === 0" class="empty" style="padding:20px">未找到用户</div>
          </div>
        </div>
      </template>
    </div>
  </div>

  <!-- TOAST -->
  <div class="toast" :class="toastClasses">{{ toastMsg }}</div>

  <!-- CONFIRM MODAL -->
  <div id="confirmModal" class="modal-overlay confirm-modal" :style="{ display: confirmVisible ? 'flex' : 'none' }">
    <div class="modal">
      <div class="modal-body">
        <div class="confirm-icon" id="confirmIcon" v-html="confirmIcon"></div>
        <div class="confirm-text" id="confirmText" v-html="confirmText"></div>
      </div>
      <div class="modal-footer">
        <button class="btn btn-ghost btn-sm" @click="confirmResolve(false)">取消</button>
        <button class="btn btn-ghost btn-sm" id="confirmOkBtn" @click="confirmResolve(true)" style="border-color:var(--border-light)">确认</button>
      </div>
    </div>
  </div>

  <!-- BATCH FLOAT BAR -->
  <div id="batchFloat" class="batch-float" :class="{ show: selectedSessionIds.length > 0 && viewLevel === 'sessions' }">
    <span class="batch-count">已选 <strong id="batchCount">{{ selectedSessionIds.length }}</strong> 场</span>
    <div class="batch-divider"></div>
    <div class="batch-actions">
      <button class="batch-btn batch-btn-accent" @click="downloadSelectedReports">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
        下载报告
      </button>
      <button class="batch-btn batch-btn-del" @click="deleteSelectedSessions">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
        删除
      </button>
    </div>
  </div>

  <!-- ANCHOR GIFTS MODAL -->
  <div id="anchorModal" class="anchor-modal-overlay" :class="{ show: anchorModalVisible }" @click.self="closeAnchorModal">
    <div class="anchor-modal">
      <div class="anchor-modal-header">
        <h3 id="anchorModalTitle">{{ anchorModalTitle }}</h3>
        <button class="anchor-modal-close" @click="closeAnchorModal">
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><path d="M4 4l8 8M12 4l-8 8"/></svg>
        </button>
      </div>
      <div class="anchor-modal-body" id="anchorModalBody" v-html="anchorModalBody"></div>
    </div>
  </div>

  <!-- GIFT DETAIL MODAL -->
  <div id="giftDetailModal" class="anchor-modal-overlay" :class="{ show: giftDetailModalVisible }" @click.self="closeGiftDetailModal">
    <div class="anchor-modal">
      <div class="anchor-modal-header">
        <h3 id="giftDetailTitle">{{ giftDetailTitle }}</h3>
        <button class="anchor-modal-close" @click="closeGiftDetailModal">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
      </div>
      <div class="anchor-modal-body" id="giftDetailBody" v-html="giftDetailBody"></div>
    </div>
  </div>

  <!-- ANONYMOUS DETAIL MODAL -->
  <div id="anonDetailModal" class="anchor-modal-overlay" :class="{ show: anonDetailModalVisible }" @click.self="closeAnonDetailModal">
    <div class="anchor-modal">
      <div class="anchor-modal-header">
        <h3 id="anonDetailTitle">{{ anonDetailTitle }}</h3>
        <button class="anchor-modal-close" @click="closeAnonDetailModal">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
      </div>
      <div class="anchor-modal-body" id="anonDetailBody" v-html="anonDetailBody"></div>
    </div>
  </div>

  <!-- USER PROFILE MODAL -->
  <div id="profileModal" class="anchor-modal-overlay" :class="{ show: profileModalVisible }" @click.self="closeProfileModal">
    <div class="anchor-modal">
      <div class="anchor-modal-header">
        <h3 id="profileModalTitle">{{ profileModalTitle }}</h3>
        <button class="anchor-modal-close" @click="closeProfileModal">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
      </div>
      <div class="anchor-modal-body" id="profileModalBody" v-html="profileModalBody"></div>
    </div>
  </div>

  <!-- DATE PICKER OVERLAY -->
  <div id="dpOverlay" class="dp-overlay" :class="{ show: dpOverlayVisible }" @click.self="dpClose">
    <div class="dp-calendar">
      <div class="dp-head">
        <button @click="dpNav(-1)">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16"><polyline points="15 18 9 12 15 6"/></svg>
        </button>
        <span class="dp-title" id="dpTitle">{{ dpTitleText }}</span>
        <button @click="dpNav(1)">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16"><polyline points="9 18 15 12 9 6"/></svg>
        </button>
      </div>
      <div class="dp-weekdays"><span>日</span><span>一</span><span>二</span><span>三</span><span>四</span><span>五</span><span>六</span></div>
      <div class="dp-days" id="dpDays" v-html="dpDaysHtml"></div>
      <div class="dp-foot">
        <button @click="dpClear">清除</button>
        <button class="dp-confirm" @click="dpConfirm">确定</button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, computed, onMounted, onUnmounted, nextTick, watch, provide } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { storeToRefs } from 'pinia'
import { useAppStore } from '../stores/app'
import { lookupRoom, addRoom, pauseRoom, resumeRoom, removeRoom, deleteSession, fetchSessionDetail, fetchDanmaku, fetchRooms, fetchSessions, fetchUser } from '../api'
import { esc, fmtTime, fmtSessionTime, formatDuration, fmtNum, avatarHtml, avatarHtml52, giftEmoji } from '../utils/format'
import { useToast } from '../composables/useToast'
import { useConfirm } from '../composables/useConfirm'
import { useDatePicker } from '../composables/useDatePicker'
import { renderWordCloud } from '../utils/wordcloud'
import AvatarFallback from '../components/AvatarFallback.vue'
import { useSearch } from '../composables/useSearch'
import { useProfile } from '../composables/useProfile'

// ============================================================
// TYPES
// ============================================================
interface Room {
  room_id: string
  name: string
  avatar: string
  enabled: boolean
  connected: boolean
  recording: boolean
  session_count: number
  _connecting?: boolean
}

interface Summary {
  total_sessions: number
  total_gifts: number
  total_diamonds: number
  total_danmaku: number
  unique_users: number
}

interface Session {
  id: number
  title: string
  is_live: boolean
  started_at: string
  ended_at: string
  duration_min: number
  gift_count: number
  total_diamonds: number
  danmaku_count: number
  user_count: number
  stats_like: number
}

interface Streamer {
  id: string
  name: string
  room_id: string
}

interface AnonUser {
  sec_uid: string
  db_nicknames: string[]
  api_nickname: string
  db_avatar: string
  api_avatar: string
  avatar: string
  nickname: string
  sessions: { streamer_name: string }[]
  latest_action: { type: string } | null
}

interface ProfileUser {
  user_sec_uid: string
  nickname: string
  avatar: string
}

interface LookupData {
  room_id: string
  nickname: string
  avatar: string
  is_live: boolean
}

// ============================================================
// STATE (from Pinia store)
// ============================================================
const store = useAppStore()
const router = useRouter()
const route = useRoute()
const {
  contentLoading, contentFadeIn, topNavTab, viewLevel,
  rooms, sessions, currentHostId, currentSessionId,
  pageTitle, showBackBtn, showTopNav, breadcrumbItems,
  detailData, _danmaku, _giftDetails, detailTab,
  danmakuSearchQuery, displayedDanmaku, _newDanmakuCount, danmakuDisplayLimit, dmSwitchLoading,
  anonQuery, anonMatches, anonSearched, anonLoading,
  selectedSessionIds,
  connectedCount, pausedCount,
} = storeToRefs(store)
const summary = store.summary  // reactive object, not ref

// filteredSessions depends on dpData (from useDatePicker), so compute locally
const filteredSessions = computed(() => {
  const from = dpData.from
  const to = dpData.to
  if (!from && !to) return sessions.value
  return sessions.value.filter(s => {
    const d = (s.started_at || '').substring(0, 10)
    if (!d) return true
    if (from && d < from) return false
    if (to && d > to) return false
    return true
  })
})

// Toast & Confirm (from composables — singleton, shared across all components)
const { toastMsg, toastType, toastClasses, toast } = useToast()
const { confirmVisible, confirmIcon, confirmText, showConfirm, confirmResolve } = useConfirm()


// Navigation
let _lastBackTime = 0
function goBack() {
  const now = Date.now()
  if (now - _lastBackTime < 300) return
  _lastBackTime = now
  history.back()
}

function updateBreadcrumb() {
  breadcrumbItems.value = []
  showBackBtn.value = false
  pageTitle.value = '直播监控'
  showTopNav.value = true

  if (viewLevel.value === 'sessions') {
    const host = rooms.value.find(h => h.room_id === currentHostId.value)
    breadcrumbItems.value = [
      { label: topNavTab.value === 'search' ? '匿名查询' : topNavTab.value === 'profile' ? '用户画像' : '房间管理', onClick: () => viewHosts() },
      { label: host?.name || '' }
    ]
    showBackBtn.value = true
    pageTitle.value = host?.name || ''
    showTopNav.value = false
  } else if (viewLevel.value === 'detail') {
    const host = rooms.value.find(h => h.room_id === currentHostId.value)
    const sess = sessions.value.find(s => s.id === currentSessionId.value)
    // 兼容直接带URL参数进入：sessions可能为空，从detailData中获取标题
    const sessionTitle = sess?.title || detailData.value?.session?.room_title || '场次详情'
    breadcrumbItems.value = [
      { label: '房间管理', onClick: () => viewHosts() },
      { label: host?.name || '', onClick: () => viewSessions(currentHostId.value!) },
      { label: sessionTitle }
    ]
    showBackBtn.value = true
    pageTitle.value = sessionTitle
    showTopNav.value = false
  }
}


// ============================================================
// API
// ============================================================
const API = ''
async function api(path: string) {
  const r = await fetch(API + path)
  if (!r.ok) throw new Error(`${r.status} ${r.statusText}`)
  return r.json()
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

async function viewHosts(fromPopState = false, replaceCurrent = false) {
  const gen = ++_viewGen  // 竞态防护
  stopAutoRefresh()
  viewLevel.value = 'hosts'
  currentHostId.value = null
  currentSessionId.value = null
  if (!fromPopState) {
    router.push({ name: 'hosts' })
  }
  updateBreadcrumb()
  if (topNavTab.value === 'rooms') loadRoomsView(gen)
  else if (topNavTab.value === 'search') loadSearchView()
  else if (topNavTab.value === 'profile') loadProfileView()
}

async function loadRoomsView(gen?: number) {
  contentLoading.value = rooms.value.length === 0
  contentFadeIn.value = false
  try {
    const [s, r] = await Promise.all([api('/api/summary'), api('/api/rooms')])
    if (gen !== undefined && gen !== _viewGen) return  // 过期请求丢弃
    rooms.value = r
    Object.assign(summary, s)
    contentLoading.value = false
  } catch (e: any) {
    if (gen !== undefined && gen !== _viewGen) return
    contentLoading.value = false
    toast('加载失败: ' + e.message, 'error')
  }
  if (gen === undefined || gen === _viewGen) startRoomStatusPoll()
}

function sortRooms() {
  rooms.value.sort((a, b) => {
    if (a.connected !== b.connected) return a.connected ? -1 : 1
    return a.name.localeCompare(b.name)
  })
}

let _roomStatusPollTimer: ReturnType<typeof setInterval> | null = null

async function pollRoomStatus() {
  if (viewLevel.value !== 'hosts' || topNavTab.value !== 'rooms') return
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
  nextTick(() => {
    if (addRoomInputEl.value) addRoomInputEl.value.focus()
  })
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
  } catch (e: any) {
    toast('查询失败: ' + e.message, 'error')
  }
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

// Room actions
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
      // 立即 poll 一次获取真实 connected 状态
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
    if (r.ok) {
      rooms.value = rooms.value.filter(r => r.room_id !== roomId)
    }
  } catch (e: any) { toast('网络错误: ' + e.message, 'error') }
}

// ============================================================
// TOP NAV SWITCH
// ============================================================
function switchTopNav(tab: 'rooms' | 'search' | 'profile') {
  stopAutoRefresh()
  stopDanmakuPoll()
  topNavTab.value = tab
  if (tab === 'rooms') loadRoomsView()
  else if (tab === 'search') loadSearchView()
  else if (tab === 'profile') loadProfileView()
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
// PROFILE VIEW (from composable)
// ============================================================
const {
  profileInput, profileUsers, profileLoading, profileSearched,
  loadProfileView, searchProfileUser
} = useProfile(api, toast)

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
  anonDetailBody.value = '<div class="loading">加载中...</div>'
  anonDetailTitle.value = u.db_nicknames?.[0] || u.nickname || '用户详情'
  try {
    const profile = await fetchUser(u.sec_uid).catch(() => null)
    const p = profile || {} as any
    let html = ''
    // Avatar + basic info
    html += `<div style="display:flex;align-items:center;gap:14px;padding:16px 0;border-bottom:1px solid var(--border);margin-bottom:14px">`
    html += avatarHtml52(u.api_avatar || u.avatar, u.nickname)
    html += `<div style="flex:1;min-width:0">`
    html += `<div style="font-size:16px;font-weight:600;color:var(--text)">${esc(u.nickname || '未知')}</div>`
    if (u.db_nicknames?.length > 1) html += `<div style="font-size:12px;color:var(--text-muted);margin-top:3px">库中昵称: ${u.db_nicknames.map((n: string) => esc(n)).join('、')}</div>`
    if (u.signature) html += `<div style="font-size:12px;color:var(--text-muted);margin-top:4px;font-style:italic">${esc(u.signature)}</div>`
    if (u.user_age || u.user_gender) html += `<div style="font-size:11px;color:var(--text-muted);margin-top:3px">${u.user_gender ? (u.user_gender === 1 ? '♂ 男' : u.user_gender === 2 ? '♀ 女' : '') : ''}${u.user_age ? ' · ' + u.user_age + '岁' : ''}</div>`
    if (u.unique_id) html += `<div style="font-size:11px;color:var(--text-muted);margin-top:2px">抖音号: ${esc(u.unique_id)}</div>`
    if (u.is_private) html += `<div style="display:inline-block;font-size:10px;color:var(--orange);background:rgba(255,152,0,0.1);padding:2px 6px;border-radius:var(--radius-xs);margin-top:4px">私密账号</div>`
    html += `</div></div>`
    // Stats
    if (u.follower_count || u.following_count || u.ip_location) {
      html += `<div style="display:flex;gap:12px;margin-bottom:14px">`
      html += `<div style="text-align:center;flex:1"><div style="font-size:16px;font-weight:700;color:var(--text)">${fmtNum(u.follower_count)}</div><div style="font-size:11px;color:var(--text-muted)">粉丝</div></div>`
      html += `<div style="text-align:center;flex:1"><div style="font-size:16px;font-weight:700;color:var(--text)">${fmtNum(u.following_count)}</div><div style="font-size:11px;color:var(--text-muted)">关注</div></div>`
      html += `<div style="text-align:center;flex:1"><div style="font-size:14px;font-weight:600;color:var(--accent)">${esc((u.ip_location || '未知').replace(/^IP属地[：:]\s*/, ''))}</div><div style="font-size:11px;color:var(--text-muted)">IP属地</div></div>`
      html += `</div>`
    }
    // Latest actions
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
        html += `<div style="display:flex;align-items:flex-start;gap:8px;margin-bottom:6px"><div style="margin-top:2px;color:${a.color}">${a.svg}</div><div style="flex:1;min-width:0"><div style="font-size:13px;color:var(--text);line-height:1.4">${esc(detail)}</div><div style="font-size:11px;color:var(--text-muted);margin-top:4px">${a.streamer_name ? esc(a.streamer_name) : ''} ${a.time ? '· ' + fmtTime(a.time) : ''}</div></div><div style="font-size:11px;color:${a.color};flex-shrink:0;padding:2px 8px;background:${a.bg};border-radius:var(--radius-xs)">${a.label}</div></div>`
      }
      html += `</div>`
    }
    // Active sessions
    const sessionsList = u.sessions?.length ? u.sessions : p.activeSessions?.map((s: any) => ({ streamer_name: s.streamer_name, start_time: s.start_time, diamonds: s.session_diamonds || 0 })) || []
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
  } catch { anonDetailBody.value = '<div class="empty" style="padding:20px">加载失败</div>' }
}

// ============================================================
// PROFILE MODAL
// ============================================================
const profileModalVisible = ref(false)
const profileModalTitle = ref('用户画像')
const profileModalBody = ref('')

function closeProfileModal() { profileModalVisible.value = false }

async function showUserProfile(secUid: string) {
  profileModalVisible.value = true
  profileModalBody.value = '<div class="loading">加载用户画像...</div>'
  try {
    const p = await fetchUser(secUid) as any
    profileModalTitle.value = p.nickname || '用户画像'
    let html = ''
    html += `<div style="display:flex;align-items:center;gap:14px;padding:16px 0;border-bottom:1px solid var(--border);margin-bottom:14px">`
    html += avatarHtml52(p.avatar, p.nickname)
    html += `<div><div style="font-size:16px;font-weight:600;color:var(--text)">${esc(p.nickname)}</div><div style="font-size:12px;color:var(--text-muted);margin-top:2px">活跃 ${p.activeSessionCount} 场 · 最爱 ${esc(p.favoriteStreamer)}</div></div></div>`
    html += `<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-bottom:16px">`
    html += `<div class="profile-stat"><div class="profile-stat-val orange" style="display:inline-flex;align-items:center">${(p.totalDiamonds || 0).toLocaleString()}<svg viewBox="0 0 24 24" width="14" height="14" style="margin-left:2px;fill:currentColor;opacity:0.6"><path d="M6 2h12l4 7-10 13L2 9z"/><path d="M2 9h20" stroke="rgba(255,255,255,0.2)" stroke-width="0.7" fill="none"/><path d="M12 22l-4-13h8z" fill="rgba(0,0,0,0.1)"/></svg></div><div class="profile-stat-label">总钻石</div></div>`
    html += `<div class="profile-stat"><div class="profile-stat-val">${p.totalGifts || 0}</div><div class="profile-stat-label">礼物数</div></div>`
    html += `<div class="profile-stat"><div class="profile-stat-val">${p.danmakuCount || 0}</div><div class="profile-stat-label">弹幕</div></div>`
    html += `</div>`
    if (p.activeSessions?.length) {
      html += `<div class="profile-section-title" style="margin-bottom:8px">活跃场次 (${p.activeSessions.length})</div><div style="display:flex;flex-direction:column;gap:4px">`
      p.activeSessions.slice(0, 5).forEach((s: any) => {
        const d = s.session_diamonds || 0
        html += `<div style="display:flex;align-items:center;gap:8px;padding:8px 12px;background:var(--bg-card);border:1px solid var(--border);border-radius:var(--radius-sm)"><span style="font-size:12px;color:var(--text-muted);width:72px;flex-shrink:0;font-variant-numeric:tabular-nums">${fmtSessionTime(s.start_time)}</span><span style="font-size:12px;color:var(--text);flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(s.streamer_name || '未知')}</span><span style="font-size:12px;color:${d > 0 ? 'var(--orange)' : 'var(--text-muted)'};flex-shrink:0;font-weight:600;font-variant-numeric:tabular-nums;display:inline-flex;align-items:center"><svg viewBox="0 0 24 24" width="12" height="12" style="margin-left:2px;fill:currentColor"><path d="M6 2h12l4 7-10 13L2 9z"/><path d="M2 9h20" stroke="rgba(255,255,255,0.2)" stroke-width="0.7" fill="none"/><path d="M12 22l-4-13h8z" fill="rgba(0,0,0,0.1)"/></svg>${d.toLocaleString()}</span></div>`
      })
      if (p.activeSessions.length > 5) html += `<div style="text-align:center;font-size:11px;color:var(--text-muted);padding:4px">还有 ${p.activeSessions.length - 5} 场</div>`
      html += `</div>`
    }
    if (p.hourStats?.length) {
      html += `<div class="profile-section-title" style="margin-top:14px">活跃时段</div><div class="hour-chart">`
      const hourArr = Array(24).fill(0)
      p.hourStats.forEach((h: any) => { hourArr[parseInt(h.hour)] = h.count })
      const fullMax = Math.max(...hourArr, 1)
      hourArr.forEach((cnt: number, hr: number) => {
        const pct = (cnt / fullMax * 100)
        html += `<div class="hour-bar" style="height:${Math.max(pct, 3)}%;opacity:${cnt ? 0.7 : 0.15}" title="${hr}时: ${cnt}次"></div>`
      })
      html += `</div><div class="hour-labels"><span>0</span><span>6</span><span>12</span><span>18</span><span>23</span></div>`
    }
    if (p.giftStyle || p.topStreamers?.length) {
      html += `<div class="profile-section-title" style="margin-top:14px">送礼画像</div><div style="display:flex;flex-wrap:wrap;gap:8px;margin-bottom:12px">`
      html += `<div style="padding:6px 12px;background:rgba(251,146,60,0.12);border-radius:var(--radius-sm);font-size:12px;color:var(--orange);display:inline-flex;align-items:center">${esc(p.giftStyle || '-')}</div>`
      html += `<div style="padding:6px 12px;background:var(--bg-card);border:1px solid var(--border);border-radius:var(--radius-sm);font-size:12px;color:var(--text-muted);display:inline-flex;align-items:center;gap:4px">场均 <span style="color:var(--text);font-weight:600;font-variant-numeric:tabular-nums;display:inline-flex;align-items:center"><svg viewBox="0 0 24 24" width="12" height="12" style="margin-right:2px;fill:var(--orange)"><path d="M6 2h12l4 7-10 13L2 9z"/><path d="M2 9h20" stroke="rgba(255,255,255,0.2)" stroke-width="0.7" fill="none"/><path d="M12 22l-4-13h8z" fill="rgba(0,0,0,0.1)"/></svg>${(p.avgPerSession || 0).toLocaleString()}</span></div>`
      html += `<div style="padding:6px 12px;background:var(--bg-card);border:1px solid var(--border);border-radius:var(--radius-sm);font-size:12px;color:var(--text-muted);display:inline-flex;align-items:center;gap:4px">巅峰时段 <span style="color:var(--text);font-weight:600">${esc(p.peakHour || '-')}</span></div>`
      html += `</div>`
      if (p.topStreamers?.length) {
        html += `<div style="font-size:11px;color:var(--text-secondary);margin-bottom:6px">最爱送礼主播</div><div style="display:flex;flex-direction:column;gap:3px;margin-bottom:10px">`
        p.topStreamers.slice(0, 3).forEach((s: any, i: number) => {
          html += `<div style="display:flex;align-items:center;gap:6px;padding:5px 8px;background:var(--bg-card);border:1px solid var(--border);border-radius:var(--radius-sm);font-size:12px"><span style="color:var(--orange);font-weight:700;width:16px;text-align:center;font-variant-numeric:tabular-nums">${String(i + 1).padStart(2, '0')}</span><span style="color:var(--text);flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(s.name)}</span><span style="color:var(--orange);font-weight:600;font-variant-numeric:tabular-nums"><svg viewBox="0 0 24 24" width="12" height="12" style="vertical-align:-2px;fill:currentColor"><path d="M6 2h12l4 7-10 13L2 9z"/><path d="M2 9h20" stroke="rgba(255,255,255,0.2)" stroke-width="0.7" fill="none"/><path d="M12 22l-4-13h8z" fill="rgba(0,0,0,0.1)"/></svg>${s.diamonds.toLocaleString()}</span></div>`
        })
        html += `</div>`
      }
      if (p.topGiftsByCount?.length) {
        html += `<div style="font-size:11px;color:var(--text-secondary);margin-bottom:6px">最常送礼物</div><div style="display:flex;flex-direction:column;gap:3px">`
        p.topGiftsByCount.slice(0, 3).forEach((g: any, i: number) => {
          html += `<div style="display:flex;align-items:center;gap:6px;padding:5px 8px;background:var(--bg-card);border:1px solid var(--border);border-radius:var(--radius-sm);font-size:12px"><span style="color:var(--orange);font-weight:700;width:16px;text-align:center;font-variant-numeric:tabular-nums">${String(i + 1).padStart(2, '0')}</span><span style="font-size:14px">${g.icon_url ? `<img src="${esc(g.icon_url)}" style="width:20px;height:20px;vertical-align:-4px" onerror="this.style.display='none'">` : giftEmoji(g.gift_name)}</span><span style="color:var(--text);flex:1">${esc(g.gift_name)}</span><span style="color:var(--text-muted)">×${g.count}</span><span style="color:var(--orange);font-weight:600;font-variant-numeric:tabular-nums"><svg viewBox="0 0 24 24" width="12" height="12" style="vertical-align:-2px;fill:currentColor"><path d="M6 2h12l4 7-10 13L2 9z"/><path d="M2 9h20" stroke="rgba(255,255,255,0.2)" stroke-width="0.7" fill="none"/><path d="M12 22l-4-13h8z" fill="rgba(0,0,0,0.1)"/></svg>${g.total_diamonds.toLocaleString()}</span></div>`
        })
        html += `</div>`
      }
    }
    if (p.danmakuSamples?.length || p.danmakuStyle) {
      html += `<div class="profile-section-title" style="margin-top:14px">弹幕风格</div>`
      if (p.danmakuStyle) {
        html += `<div style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:10px">`
        p.danmakuStyle.split('·').forEach((t: string) => {
          html += `<div style="padding:4px 10px;background:rgba(108,140,255,0.12);border-radius:var(--radius-sm);font-size:11px;color:var(--accent)">${esc(t)}</div>`
        })
        html += `<div style="padding:4px 10px;background:var(--bg-card);border:1px solid var(--border);border-radius:var(--radius-sm);font-size:11px;color:var(--text-muted)">共 ${p.danmakuCount || 0} 条弹幕</div></div>`
      }
      if (p.danmakuSamples?.length) {
        html += '<div style="display:flex;flex-direction:column;gap:3px">'
        p.danmakuSamples.forEach((d: any) => {
          let content = d.content || ''
          if (content.length > 60) content = content.slice(0, 60) + '…'
          const ts = fmtTime(d.create_time)
          html += `<div style="padding:5px 8px;background:var(--bg-card);border:1px solid var(--border);border-radius:var(--radius-sm);font-size:12px;display:flex;gap:8px;align-items:flex-start"><span style="color:var(--text);flex:1;line-height:1.4">${esc(content)}</span><span style="color:var(--text-muted);font-size:10px;flex-shrink:0;white-space:nowrap">${ts}</span></div>`
        })
        html += '</div>'
      }
    }
    profileModalBody.value = html
  } catch (e: any) { profileModalBody.value = `<div class="empty" style="padding:20px">加载失败: ${esc(e.message)}</div>` }
}

// ============================================================
// ANCHOR MODAL
// ============================================================
const anchorModalVisible = ref(false)
const anchorModalTitle = ref('主播榜')
const anchorModalBody = ref('')

function closeAnchorModal() { anchorModalVisible.value = false }

function openAnchorModal(anchorName: string, sessionId: number) {
  anchorModalTitle.value = anchorName
  const allGifts = (_giftDetails.value || []).filter((g: any) => g.to_nickname === anchorName)
  if (!allGifts.length) {
    anchorModalBody.value = '<div class="empty" style="padding:20px">暂无礼物数据</div>'
    anchorModalVisible.value = true
    return
  }
  const aggMap: Record<string, any> = {}
  allGifts.forEach((g: any) => {
    const uid = g.user_sec_uid || g.nickname
    if (!aggMap[uid]) aggMap[uid] = { nickname: g.nickname, avatar_url: g.avatar_url, total_diamonds: 0, gift_count: 0 }
    if (g.nickname && !g.nickname.startsWith('神秘人')) { aggMap[uid].nickname = g.nickname; if (g.avatar_url) aggMap[uid].avatar_url = g.avatar_url }
    aggMap[uid].total_diamonds += g.total_diamonds
    aggMap[uid].gift_count += g.count
  })
  const gifts = Object.values(aggMap).sort((a: any, b: any) => b.total_diamonds - a.total_diamonds)
  const totalD = gifts.reduce((s: number, g: any) => s + g.total_diamonds, 0)
  let html = `<div class="anchor-modal-summary"><span><svg viewBox="0 0 24 24" width="12" height="12" style="vertical-align:-2px;fill:var(--orange)"><path d="M6 2h12l4 7-10 13L2 9z"/><path d="M2 9h20" stroke="rgba(255,255,255,0.2)" stroke-width="0.7" fill="none"/><path d="M12 22l-4-13h8z" fill="rgba(0,0,0,0.1)"/></svg> <span class="sv">${totalD.toLocaleString()}</span></span><span><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="12" height="12" style="vertical-align:-2px"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg> <span class="sv">${gifts.length}</span> 人</span></div>`
  html += '<div class="gift-list-card">'
  gifts.forEach((g: any, i: number) => {
    html += `<div class="gift-list-item"><span class="gift-rank-num">${String(i + 1).padStart(2, '0')}</span><div class="user-cell">${avatarHtml(g.avatar_url, g.nickname)}<span>${esc(g.nickname)}</span></div><div class="diamonds"><svg viewBox="0 0 24 24" width="12" height="12" style="vertical-align:-2px;margin-right:2px;fill:currentColor"><path d="M6 2h12l4 7-10 13L2 9z"/><path d="M2 9h20" stroke="rgba(255,255,255,0.2)" stroke-width="0.7" fill="none"/><path d="M12 22l-4-13h8z" fill="rgba(0,0,0,0.1)"/></svg> ${g.total_diamonds.toLocaleString()}</div></div>`
  })
  html += '</div>'
  anchorModalBody.value = html
  anchorModalVisible.value = true
}

// ============================================================
// GIFT DETAIL MODAL
// ============================================================
const giftDetailModalVisible = ref(false)
const giftDetailTitle = ref('礼物明细')
const giftDetailBody = ref('')

function closeGiftDetailModal() { giftDetailModalVisible.value = false }

function showGiftDetail(nickname: string, secUid: string) {
  const details = (_giftDetails.value || []).filter((d: any) => secUid ? d.user_sec_uid === secUid : d.nickname === nickname)
  if (!details.length) return
  const totalD = details.reduce((s: number, d: any) => s + d.total_diamonds, 0)
  giftDetailTitle.value = nickname + ' 的礼物'
  let html = `<div class="anchor-modal-summary"><span><svg viewBox="0 0 24 24" width="12" height="12" style="vertical-align:-2px;fill:var(--orange)"><path d="M6 2h12l4 7-10 13L2 9z"/><path d="M2 9h20" stroke="rgba(255,255,255,0.2)" stroke-width="0.7" fill="none"/><path d="M12 22l-4-13h8z" fill="rgba(0,0,0,0.1)"/></svg> <span class="sv">${totalD.toLocaleString()}</span></span><span>${details.length} 种礼物</span></div>`
  html += '<div style="display:flex;flex-direction:column;gap:6px">'
  details.forEach((d: any) => {
    const icon = d.gift_icon ? `<img src="${esc(d.gift_icon)}" class="gdi-icon">` : '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="gdi-icon" style="padding:2px;box-sizing:border-box"><rect x="3" y="8" width="18" height="13" rx="1"/><path d="M12 8V6c0-2-1.5-4-4-4S4 4 4 6h2"/><path d="M20 6c0-2-1.5-4-4-4s-4 2-4 4h2"/><line x1="12" y1="8" x2="12" y2="21"/><line x1="3" y1="13" x2="21" y2="13"/></svg>'
    const to = d.to_nickname ? `<span class="gdi-to">→ ${esc(d.to_nickname)}</span>` : ''
    html += `<div class="gift-detail-item">${icon}<span class="gdi-name">${esc(d.gift_name)} ×${d.count}</span>${to}<span class="gdi-diamonds"><svg viewBox="0 0 24 24" width="12" height="12" style="margin-right:2px;fill:currentColor"><path d="M6 2h12l4 7-10 13L2 9z"/><path d="M2 9h20" stroke="rgba(255,255,255,0.2)" stroke-width="0.7" fill="none"/><path d="M12 22l-4-13h8z" fill="rgba(0,0,0,0.1)"/></svg>${d.total_diamonds.toLocaleString()}</span></div>`
  })
  html += '</div>'
  giftDetailBody.value = html
  giftDetailModalVisible.value = true
}

// ============================================================
// SESSIONS VIEW
// ============================================================

function toggleSelectAll(e: Event) {
  const checked = (e.target as HTMLInputElement).checked
  if (checked) selectedSessionIds.value = sessions.value.map(s => s.id)
  else selectedSessionIds.value = []
}

function toggleSessionCheckbox(id: number, e: Event) {
  const checked = (e.target as HTMLInputElement).checked
  const tr = (e.target as HTMLElement).closest('tr')
  if (checked) {
    if (!selectedSessionIds.value.includes(id)) selectedSessionIds.value.push(id)
    if (tr) tr.classList.add('selected')
  } else {
    selectedSessionIds.value = selectedSessionIds.value.filter(i => i !== id)
    if (tr) tr.classList.remove('selected')
  }
}

async function viewSessions(hostId: string, fromPopState = false) {
  const gen = ++_viewGen  // 竞态防护
  stopAutoRefresh()
  viewLevel.value = 'sessions'
  currentHostId.value = hostId
  currentSessionId.value = null
  selectedSessionIds.value = []
  sessions.value = []  // 清空旧数据，防止切换房间时闪现上一个房间的场次
  if (!fromPopState) router.push({ name: 'sessions', params: { hostId } })
  updateBreadcrumb()
  contentLoading.value = true
  try {
    const data = await fetchSessions(hostId)
    if (gen !== _viewGen) return  // 过期请求丢弃
    sessions.value = data
    contentLoading.value = false
  } catch (e: any) {
    if (gen !== _viewGen) return  // 过期请求丢弃
    contentLoading.value = false
    toast('加载失败: ' + e.message, 'error')
  }
}

// Sessions computed stats
const sessionsTotalGifts = computed(() => sessions.value.reduce((s, x) => s + x.gift_count, 0))
const sessionsTotalDiamonds = computed(() => sessions.value.reduce((s, x) => s + x.total_diamonds, 0))
const sessionsTotalDanmaku = computed(() => sessions.value.reduce((s, x) => s + x.danmaku_count, 0))
const sessionsTotalUsers = computed(() => sessions.value.reduce((s, x) => s + x.user_count, 0))
const sessionsTotalLikes = computed(() => sessions.value.reduce((s, x) => s + (x.stats_like || 0), 0))

function downloadReport(sessionId: number) {
  window.open(`${API}/api/sessions/${sessionId}/report`, '_blank')
}

async function deleteSessionFromList(sessionId: number) {
  const confirmed = await showConfirm('🗑️', '确定删除这场直播数据？<br><br>弹幕、礼物、在线记录将一并清除<br>此操作不可恢复！')
  if (!confirmed) return
  try {
    const r = await deleteSession(String(sessionId))
    toast(r.ok ? '场次已删除' : (r.error || '删除失败'), r.ok ? 'success' : 'error')
    if (r.ok && currentHostId.value) viewSessions(currentHostId.value)
  } catch (e: any) { toast('网络错误: ' + e.message, 'error') }
}

function downloadSelectedReports() {
  const ids = selectedSessionIds.value
  if (ids.length === 0) { toast('请先选择场次', 'error'); return }
  ids.forEach((id, i) => { setTimeout(() => window.open(`${API}/api/sessions/${id}/report`, '_blank'), i * 500) })
  toast(`正在生成 ${ids.length} 份报告...`, 'success')
}

async function deleteSelectedSessions() {
  const ids = selectedSessionIds.value
  if (ids.length === 0) { toast('请先选择场次', 'error'); return }
  const confirmed = await showConfirm('🗑️', `确定删除选中的 <strong>${ids.length}</strong> 场数据？<br><br>弹幕、礼物、在线记录将一并清除<br>此操作不可恢复！`)
  if (!confirmed) return
  let ok = 0, fail = 0
  for (const id of ids) {
    try { const r = await deleteSession(String(id)); r.ok ? ok++ : fail++ } catch { fail++ }
  }
  toast(`已删除 ${ok} 场${fail ? `，${fail} 场失败` : ''}`, ok > 0 ? 'success' : 'error')
  if (currentHostId.value) viewSessions(currentHostId.value)
}

// ============================================================
// DETAIL VIEW
// ============================================================
let _viewGen = 0  // SPA竞态防护：取消pending请求

// Danmaku search
let _dmSearchTimer: ReturnType<typeof setTimeout> | null = null

function onDanmakuSearchInput() {
  if (_dmSearchTimer) clearTimeout(_dmSearchTimer)
  _dmSearchTimer = setTimeout(() => filterDanmaku(), 200)
}

// 监听显示数量变化
watch(danmakuDisplayLimit, async () => {
  dmSwitchLoading.value = true
  await nextTick()
  filterDanmaku()
  setTimeout(() => { dmSwitchLoading.value = false }, 200)
})

// 下拉框开关
const dmLimitOpen = ref(false)

// 点击外部关闭下拉框
onMounted(() => {
  document.addEventListener('click', () => { dmLimitOpen.value = false })
})

const _rankChanged = ref(new Set<string>())
const danmakuLeftEl = ref<HTMLElement | null>(null)
const danmakuRightEl = ref<HTMLElement | null>(null)
// 排行变动检测：对比前后排名，变动的项加动画
let _prevRanking: string[] = []
watch(() => detailData.value?.danmakuRanking, (newRank) => {
  if (!newRank || !newRank.length) return
  const newOrder = newRank.slice(0, 10).map((d: any) => d.nickname)
  const changed = new Set<string>()
  if (_prevRanking.length > 0) {
    newOrder.forEach((name: string, idx: number) => {
      const oldIdx = _prevRanking.indexOf(name)
      if (oldIdx === -1 || oldIdx !== idx) changed.add(name)
    })
  }
  _prevRanking = newOrder
  if (changed.size > 0) {
    _rankChanged.value = changed
    setTimeout(() => { _rankChanged.value = new Set() }, 600)
  }
}, { deep: true })

function filterDanmaku() {
  const q = danmakuSearchQuery.value.toLowerCase()
  const list = document.getElementById('rtDanmakuList')
  const wasAtLatest = list ? list.scrollTop < 30 : false

  // 合并弹幕和礼物，统一格式
  const allItems: any[] = []
  ;(_danmaku.value || []).forEach((d: any) => {
    const ts = Number(d.timestamp || d.create_time) || 0
    allItems.push({
      _type: 'danmaku',
      _key: 'dm_' + ts + '_' + d.nickname,
      _ts: ts > 1e12 ? ts : ts * 1000,
      nickname: d.nickname,
      avatar_url: d.avatar_url || d.avatar,
      content: d.content || '',
      timestamp: d.timestamp || d.create_time,
    })
  })
  ;(_giftDetails.value || []).forEach((g: any) => {
    const ts = Number(g.create_time || g.timestamp) || 0
    allItems.push({
      _type: 'gift',
      _key: 'gf_' + ts + '_' + g.nickname + '_' + g.gift_name,
      _ts: ts > 1e12 ? ts : ts * 1000,
      nickname: g.nickname,
      avatar_url: g.avatar || g.avatar_url,
      gift_name: g.gift_name || '',
      total_diamonds: g.total_diamonds || 0,
      to_nickname: g.to_nickname || '',
      gift_icon: g.gift_icon || null,
      timestamp: g.create_time || g.timestamp,
    })
  })

  // 按时间正序（最早在上）
  allItems.sort((a, b) => a._ts - b._ts)

  let result: any[]
  if (q) {
    // 搜索模式：搜索全部数据，不受数量限制
    result = allItems.filter((d: any) => {
      const content = d._type === 'gift' ? d.gift_name : (d.content || '')
      return content.toLowerCase().includes(q) || (d.nickname || '').toLowerCase().includes(q)
    })
  } else {
    // 正常模式：取最新的N条
    const limit = danmakuDisplayLimit.value
    result = limit ? allItems.slice(-limit) : allItems
  }

  displayedDanmaku.value = result
  // 多条数据时默认在底部（最新消息）
  if (list) {
    nextTick(() => { list.scrollTop = list.scrollHeight })
  }
}

function replaceDouyinEmoji(s: string) {
  if (!s) return ''
  return s.replace(/\[([^\]]+)\]/g, (m, name) => {
    const url = _douyinEmojiMap[name]
    if (url) return `<img src="${url}" style="width:16px;height:16px;vertical-align:-3px;margin:0 1px">`
    return m
  })
}

async function queryAnonymous() {
  const q = anonQuery.value.trim()
  if (!q) return
  anonSearched.value = false
  anonLoading.value = false
  anonMatches.value = []
  if (!currentSessionId.value || !detailData.value) {
    anonSearched.value = true
    return
  }
  if (!_danmaku.value || !_danmaku.value.length) {
    anonLoading.value = true
    try {
      const dmData = await fetchDanmaku(String(currentSessionId.value))
      const raw = dmData.data || dmData || []
      _danmaku.value = raw.map((d: any) => ({
        ...d,
        timestamp: d.timestamp || d.create_time,
        avatar_url: d.avatar_url || d.avatar
      }))
    } catch (e) { /* ignore */ }
    anonLoading.value = false
  }
  const qLower = q.toLowerCase()
  const matches: any[] = []
  // Search danmaku
  ;(_danmaku.value || []).forEach((d: any) => {
    const name = (d.nickname || '').toLowerCase()
    const content = (d.content || '').toLowerCase()
    if (name.includes(qLower) || content.includes(qLower)) {
      matches.push({
        type: '弹幕', nickname: d.nickname, content: d.content,
        time: d.timestamp, avatar: d.avatar_url,
        diamonds: 0, giftIcon: null, to_nickname: '', displayText: (d.content || '').substring(0, 60)
      })
    }
  })
  // Search gifts
  ;(detailData.value.giftDetails || []).forEach((g: any) => {
    const nameLower = (g.nickname || '').toLowerCase()
    const giftLower = (g.gift_name || '').toLowerCase()
    if (nameLower.includes(qLower) || giftLower.includes(qLower)) {
      matches.push({
        type: '礼物', nickname: g.nickname,
        content: (g.gift_name || '礼物') + ' ×' + g.count,
        time: null, avatar: g.avatar_url,
        diamonds: g.total_diamonds || 0,
        giftIcon: g.gift_icon || null,
        to_nickname: g.to_nickname || '',
        displayText: (g.gift_name || '礼物') + ' ×' + g.count
      })
    }
  })
  anonSearched.value = true
  anonMatches.value = matches
}


function switchDetailTab(tab: string) {
  detailTab.value = tab
  if ((tab === 'danmaku' || tab === 'anon') && (!_danmaku.value || !_danmaku.value.length)) {
    loadDanmakuData()
  }
  if (tab === 'danmaku') startDanmakuPoll()
  else stopDanmakuPoll()
}

async function loadDanmakuData() {
  if (!currentSessionId.value) return
  anonLoading.value = true
  try {
    const dmData = await fetchDanmaku(String(currentSessionId.value))
    const raw = dmData.data || dmData || []
    _danmaku.value = raw.map((d: any) => ({
      ...d,
      timestamp: d.timestamp || d.create_time,
      avatar_url: d.avatar_url || d.avatar
    }))
    filterDanmaku()
  } catch (e) { _danmaku.value = [] }
  anonLoading.value = false
}

const _douyinEmojiMap: Record<string, string> = {"微笑": "https://p3-pc-sign.douyinpic.com/obj/tos-cn-i-tsj2vxp0zn/54a0f69dc150401a85ba8c20c1a05db1?lk3s=343af0a2&x-expires=2098918800&x-signature=oizDyMonC0G8yNjrHg3cbS24fcw%3D&from=876277922", "色": "https://p3-pc-sign.douyinpic.com/obj/tos-cn-i-tsj2vxp0zn/27a1d35dea9748ac8c14f6c2c9829965?lk3s=343af0a2&x-expires=2098918800&x-signature=K%2Fm7hwxlkXZInDbnOXiA0lVgMfc%3D&from=876277922", "发呆": "https://p3-pc-sign.douyinpic.com/obj/tos-cn-i-tsj2vxp0zn/88ebe7b3f2e24729aa4de3ff33ae5731?lk3s=343af0a2&x-expires=2098918800&x-signature=hErZkmKnIFHhwCZ1POlbrCwcN1c%3D&from=876277922", "酷拽": "https://p3-pc-sign.douyinpic.com/obj/tos-cn-i-tsj2vxp0zn/0fac43466165409a805b3b6e3547ccef?lk3s=343af0a2&x-expires=2098918800&x-signature=1kwgOuVC4HT%2FABUYzPf5VMYliSI%3D&from=876277922", "抠鼻": "https://p3-pc-sign.douyinpic.com/obj/tos-cn-i-tsj2vxp0zn/accde8fa9fe04c5e8fa3f25d1ddb5584?lk3s=343af0a2&x-expires=2098918800&x-signature=46YMU05ICnylK6ZbZjGZ%2Fp7afbc%3D&from=876277922", "流泪": "https://p3-pc-sign.douyinpic.com/obj/tos-cn-i-tsj2vxp0zn/2d8dc1e2bb8a417cab4130df2d10e478?lk3s=343af0a2&x-expires=2098918800&x-signature=NA%2B4Lk4x0vaVkkUEKd%2BW3CIg9Rg%3D&from=876277922", "捂脸": "https://p3-pc-sign.douyinpic.com/obj/tos-cn-i-tsj2vxp0zn/357ac72b9b6449f7bd3005ff66678822?lk3s=343af0a2&x-expires=2098918800&x-signature=yu4P0U%2F83Fe%2B5d1QVpBgCQo2WNM%3D&from=876277922", "发怒": "https://p3-pc-sign.douyinpic.com/obj/tos-cn-i-tsj2vxp0zn/156352b6879b4b5f96fd80434ff72c8e?lk3s=343af0a2&x-expires=2098918800&x-signature=hRbHBvFrr68Mwcp4fExWBXe3CYA%3D&from=876277922", "呲牙": "https://p3-pc-sign.douyinpic.com/obj/tos-cn-i-tsj2vxp0zn/17bc9c4501784279b8e7d886832b0f28?lk3s=343af0a2&x-expires=2098918800&x-signature=zGviV0ETJbvMPs%2FBrVWSQ%2FDRojU%3D&from=876277922", "尬笑": "https://p3-pc-sign.douyinpic.com/obj/tos-cn-i-tsj2vxp0zn/96744c9a302345d1b14d7e0a9951c7b9?lk3s=343af0a2&x-expires=2098918800&x-signature=nraKT%2FjmiMUvDRXugWaUkKipYfg%3D&from=876277922", "害羞": "https://p3-pc-sign.douyinpic.com/obj/tos-cn-i-tsj2vxp0zn/d05cee2608fe4f998fef3f90de9466df?lk3s=343af0a2&x-expires=2098918800&x-signature=87a8MSD%2FmKT0hui%2FeaAelaFa9Hk%3D&from=876277922", "调皮": "https://p3-pc-sign.douyinpic.com/obj/tos-cn-i-tsj2vxp0zn/a921fa28653043c1bbf162abe017c99a?lk3s=343af0a2&x-expires=2098918800&x-signature=pxD0saUdzmajjw2%2FYIAK2ku0%2Fy0%3D&from=876277922", "舔屏": "https://p3-pc-sign.douyinpic.com/obj/tos-cn-i-tsj2vxp0zn/d99bd102d422484188b98e8889c0c330?lk3s=343af0a2&x-expires=2098918800&x-signature=JbMwNnTvqQLPAxlbH%2FkfoYQW7ro%3D&from=876277922", "看": "https://p3-pc-sign.douyinpic.com/obj/tos-cn-i-tsj2vxp0zn/87c2ae45679c4cc4a35bd7182fd76935?lk3s=343af0a2&x-expires=2098918800&x-signature=anQ59b6P5ylRn9TkerC1emaBau0%3D&from=876277922", "爱心": "https://p3-pc-sign.douyinpic.com/obj/tos-cn-i-tsj2vxp0zn/427b632213784532a4076c3b0ab269fb?lk3s=343af0a2&x-expires=2098918800&x-signature=kIFiThCNCERtel2tQImwMjCdVHc%3D&from=876277922", "比心": "https://p3-pc-sign.douyinpic.com/obj/tos-cn-i-tsj2vxp0zn/75b4e7e2405447959578f54d87811e35?lk3s=343af0a2&x-expires=2098918800&x-signature=OMMxdM8%2FUgmirKAPfCNxTy0ZGS4%3D&from=876277922", "赞": "https://p3-pc-sign.douyinpic.com/obj/tos-cn-i-tsj2vxp0zn/1a09f79a0e7e433eb2bc143c9f026d65?lk3s=343af0a2&x-expires=2098918800&x-signature=1%2FVmjwPCUDeN1%2B%2Ba0vZylFOKLB4%3D&from=876277922", "鼓掌": "https://p3-pc-sign.douyinpic.com/obj/tos-cn-i-tsj2vxp0zn/15d1258bec8e4c9ea9687f1134bd5f65?lk3s=343af0a2&x-expires=2098918800&x-signature=yYm6HDwYc9zgBMohJrsRTwvCLuc%3D&from=876277922", "感谢": "https://p3-pc-sign.douyinpic.com/obj/tos-cn-i-tsj2vxp0zn/fabab8b14ec64f669283287a4b7041cb?lk3s=343af0a2&x-expires=2098918800&x-signature=5x7oNfDmesXpRRIHZjiC5%2Fn91j4%3D&from=876277922", "抱抱你": "https://p3-pc-sign.douyinpic.com/obj/tos-cn-i-tsj2vxp0zn/299f50b8f96640d5b349cc6cb4a76030?lk3s=343af0a2&x-expires=2098918800&x-signature=J32acanAevfjiz0VhXFKTR5ZL4E%3D&from=876277922", "玫瑰": "https://p3-pc-sign.douyinpic.com/obj/tos-cn-i-tsj2vxp0zn/683fcd46faf148af99c90e36ccc4c013?lk3s=343af0a2&x-expires=2098918800&x-signature=pcYWwTwv0IwRJ%2FKFlH33lT4yYg4%3D&from=876277922", "尴尬流汗": "https://p3-pc-sign.douyinpic.com/obj/tos-cn-i-tsj2vxp0zn/160eca1320584e2e87122e7d7ba72a53?lk3s=343af0a2&x-expires=2098918800&x-signature=8Y3psZr9u53dbeExI3zDEIayIXM%3D&from=876277922", "戳手手": "https://p3-pc-sign.douyinpic.com/obj/tos-cn-i-tsj2vxp0zn/4268c0b885ec4eae8e95dab8635ca215?lk3s=343af0a2&x-expires=2098918800&x-signature=zBGzFck%2FXf11py0z4jUheXiq2hU%3D&from=876277922", "星星眼": "https://p3-pc-sign.douyinpic.com/obj/tos-cn-i-tsj2vxp0zn/007064f99b694041a1890e52ff8c5768?lk3s=343af0a2&x-expires=2098918800&x-signature=yRL4oH%2BZ3Eeg%2B6y9U%2BIU8t252R4%3D&from=876277922", "杀马特": "https://p3-pc-sign.douyinpic.com/obj/tos-cn-i-tsj2vxp0zn/ed5fb68598cf4741b3e7f2affd825650?lk3s=343af0a2&x-expires=2098918800&x-signature=G2wwBC4CsQqR1ketF59agNy90W8%3D&from=876277922", "黄脸干杯": "https://p3-pc-sign.douyinpic.com/obj/tos-cn-i-tsj2vxp0zn/a0a1e35991334532b142572d93f38ac5?lk3s=343af0a2&x-expires=2098918800&x-signature=T6AjK945S2zt3Erj3ZmmAICeRbQ%3D&from=876277922", "抱紧自己": "https://p3-pc-sign.douyinpic.com/obj/tos-cn-i-tsj2vxp0zn/c0cf6b7d6a144b68b6045fd92bfe9fe2?lk3s=343af0a2&x-expires=2098918800&x-signature=kx7JISk2090zo7xaoZMsMyhSaEI%3D&from=876277922", "拜拜": "https://p3-pc-sign.douyinpic.com/obj/tos-cn-i-tsj2vxp0zn/36cf73734e9c49d48b3e9a5bbe2affaf?lk3s=343af0a2&x-expires=2098918800&x-signature=e6JaTTgNDJijbIICcuFHmuwJY0U%3D&from=876277922", "热化了": "https://p3-pc-sign.douyinpic.com/obj/tos-cn-i-tsj2vxp0zn/2cffc18234074d20acb0c6334c76f04a?lk3s=343af0a2&x-expires=2098918800&x-signature=OHkfhKQ7d8WOUQ4UF2OeBo4k8iA%3D&from=876277922", "黄脸祈祷": "https://p3-pc-sign.douyinpic.com/obj/tos-cn-i-tsj2vxp0zn/3f67722d0c694372b7023deda01bd91c?lk3s=343af0a2&x-expires=2098918800&x-signature=2n%2FaRkpefzF8aMf0n5otRScRpMo%3D&from=876277922", "懵": "https://p3-pc-sign.douyinpic.com/obj/tos-cn-i-tsj2vxp0zn/dbd68a1183b344648759f5971cbc6238?lk3s=343af0a2&x-expires=2098918800&x-signature=jmisKtuVNlyyI82S%2Bh1yyk4dPms%3D&from=876277922", "举手": "https://p3-pc-sign.douyinpic.com/obj/tos-cn-i-tsj2vxp0zn/3c34da0d65db47c6933e6b66cc17e5aa?lk3s=343af0a2&x-expires=2098918800&x-signature=o4kieOMV6UiXW%2FhJWIBP6GQ90tI%3D&from=876277922", "加功德": "https://p3-pc-sign.douyinpic.com/obj/tos-cn-i-tsj2vxp0zn/49b00fcf022d4c36ba86bb19c7358ec6?lk3s=343af0a2&x-expires=2098918800&x-signature=cuefGP8i937EXgi0DfmJrVy1Y7g%3D&from=876277922", "摊手": "https://p3-pc-sign.douyinpic.com/obj/tos-cn-i-tsj2vxp0zn/6ffc70d8850b4e5eb6c7a5aa9e7b1782?lk3s=343af0a2&x-expires=2098918800&x-signature=lLvj%2BjwIXLuApfG95jxEg%2BVs1Xs%3D&from=876277922", "无语流汗": "https://p3-pc-sign.douyinpic.com/obj/tos-cn-i-tsj2vxp0zn/67f5a31e2895499dbfff97ff81efb0f8?lk3s=343af0a2&x-expires=2098918800&x-signature=4pP%2BnV8G4agtbnCeLh2Z0Y3lrI0%3D&from=876277922", "续火花吧": "https://p3-pc-sign.douyinpic.com/obj/tos-cn-i-tsj2vxp0zn/1da1cd2598ba48a78cf07dc7eea09338?lk3s=343af0a2&x-expires=2098918800&x-signature=TX8oGFsiV7kl581xrZb5r01Xu%2F8%3D&from=876277922", "点火": "https://p3-pc-sign.douyinpic.com/obj/tos-cn-i-tsj2vxp0zn/3bb9834bd95d4a5ba305ca2d788bd62e?lk3s=343af0a2&x-expires=2098918800&x-signature=UCFz9YWW9nx7AmHfAUaD1vskBAA%3D&from=876277922", "哭哭": "https://p3-pc-sign.douyinpic.com/obj/tos-cn-i-tsj2vxp0zn/c380b32e707b43a2967ee7b492771c0f?lk3s=343af0a2&x-expires=2098918800&x-signature=XBvsf88EMAsPa1bXYCQT1HGa%2Fkc%3D&from=876277922", "吐舌小狗": "https://p3-pc-sign.douyinpic.com/obj/tos-cn-i-tsj2vxp0zn/e4fb11ce2e2b432483ef58e058be6e0d?lk3s=343af0a2&x-expires=2098918800&x-signature=FwUn57CvKS9X%2FyWC57k5gHqQkkY%3D&from=876277922", "送花": "https://p3-pc-sign.douyinpic.com/obj/tos-cn-i-tsj2vxp0zn/ff736698b03446d19ae05cbd6cc45256?lk3s=343af0a2&x-expires=2098918800&x-signature=tXNFfHIFqOj%2Fl0QBXt0CLsqS6yA%3D&from=876277922", "爱心手": "https://p3-pc-sign.douyinpic.com/obj/tos-cn-i-tsj2vxp0zn/7f50f1d4d0c74571b1a60eba9b41a4d7?lk3s=343af0a2&x-expires=2098918800&x-signature=CCXi3vQkY7tPRNvKJzWsHVgitPw%3D&from=876277922", "贴贴": "https://p3-pc-sign.douyinpic.com/obj/tos-cn-i-tsj2vxp0zn/c3dee11223784da3a2ed524d94bb2ce8?lk3s=343af0a2&x-expires=2098918800&x-signature=LSoOH3O3zSDoWiCzlKpytp6orDo%3D&from=876277922", "灵机一动": "https://p3-pc-sign.douyinpic.com/obj/tos-cn-i-tsj2vxp0zn/801127f060844405b0f5e00bd01cb8ba?lk3s=343af0a2&x-expires=2098918800&x-signature=6zfXvq4%2FGTgJAatn9BkugQ2C%2BXI%3D&from=876277922", "耶": "https://p3-pc-sign.douyinpic.com/obj/tos-cn-i-tsj2vxp0zn/f00c1c8054ff41768994256236d305b1?lk3s=343af0a2&x-expires=2098918800&x-signature=vYPqj67qVZg0Ux14E7CdopO9u3k%3D&from=876277922", "打脸": "https://p3-pc-sign.douyinpic.com/obj/tos-cn-i-tsj2vxp0zn/d00f39c3d5d54144a395ad4d7f8d4489?lk3s=343af0a2&x-expires=2098918800&x-signature=OaZaHzdF%2Bs%2BKRTwzWIT4nvM0iTQ%3D&from=876277922", "大笑": "https://p3-pc-sign.douyinpic.com/obj/tos-cn-i-tsj2vxp0zn/ce993ad237174993a2ed8de550a63772?lk3s=343af0a2&x-expires=2098918800&x-signature=Y03S3O5X8NwCGlcf6enFyBUfs0c%3D&from=876277922", "机智": "https://p3-pc-sign.douyinpic.com/obj/tos-cn-i-tsj2vxp0zn/ca113e21412d4609ae38032b3befddb9?lk3s=343af0a2&x-expires=2098918800&x-signature=I4bpnReiEPQTbOgM4%2BEWrQ%2FnQ28%3D&from=876277922", "送心": "https://p3-pc-sign.douyinpic.com/obj/tos-cn-i-tsj2vxp0zn/72211d3eadb64791a967f43ab340a55a?lk3s=343af0a2&x-expires=2098918800&x-signature=Tyi1ykC%2FKE9T1r1bUtKH8emQSTk%3D&from=876277922", "666": "https://p3-pc-sign.douyinpic.com/obj/tos-cn-i-tsj2vxp0zn/11a083f1a213461f859370ccbce074df?lk3s=343af0a2&x-expires=2098918800&x-signature=Bgyn0jDX4jKQXlVBs0Bdg5cyG9I%3D&from=876277922", "闭嘴": "https://p3-pc-sign.douyinpic.com/obj/tos-cn-i-tsj2vxp0zn/d32f14b5edfd4489a4ea736a8ad39741?lk3s=343af0a2&x-expires=2098918800&x-signature=jLYp9poz0drVeRCQfzyYPfcbOjE%3D&from=876277922", "来看我": "https://p3-pc-sign.douyinpic.com/obj/tos-cn-i-tsj2vxp0zn/27059cc0891649a8b2b0860b5b08f540?lk3s=343af0a2&x-expires=2098918800&x-signature=%2FjGxtl7kdL6uP72tIcZItsF4bGs%3D&from=876277922", "一起加油": "https://p3-pc-sign.douyinpic.com/obj/tos-cn-i-tsj2vxp0zn/632214f7625a41ec8b558961929153f8?lk3s=343af0a2&x-expires=2098918800&x-signature=04D3Ib0PuO0Ed261Pb%2B%2B%2FJq%2BgkQ%3D&from=876277922", "哈欠": "https://p3-pc-sign.douyinpic.com/obj/tos-cn-i-tsj2vxp0zn/8ef4e9f6ef36449dab4c5ecde36f7d6b?lk3s=343af0a2&x-expires=2098918800&x-signature=kBtKo%2FW0NzLBd38eMcQ8imlZq6g%3D&from=876277922", "震惊": "https://p3-pc-sign.douyinpic.com/obj/tos-cn-i-tsj2vxp0zn/7181d20e807f4c5787f484531d1d8468?lk3s=343af0a2&x-expires=2098918800&x-signature=o%2BnsTtH9mgV09cP2eqdNFJRpGOg%3D&from=876277922", "晕": "https://p3-pc-sign.douyinpic.com/obj/tos-cn-i-tsj2vxp0zn/2af8cb49d2854197b7dd9b87f9dd106b?lk3s=343af0a2&x-expires=2098918800&x-signature=Ge8sn8JDMZjT%2Ffo7RfJzVRSeirA%3D&from=876277922", "衰": "https://p3-pc-sign.douyinpic.com/obj/tos-cn-i-tsj2vxp0zn/aa5c7f4a1d0c430a94934287cacd3c17?lk3s=343af0a2&x-expires=2098918800&x-signature=%2BWZFAA1KPmmW3BD4KhNq0Kc64Wo%3D&from=876277922", "困": "https://p3-pc-sign.douyinpic.com/obj/tos-cn-i-tsj2vxp0zn/23cdce75a6d64bd8bb7ff87037db1be0?lk3s=343af0a2&x-expires=2098918800&x-signature=4pwawhV3%2FVwk84Rr4cpniu%2FO%2Fxg%3D&from=876277922", "疑问": "https://p3-pc-sign.douyinpic.com/obj/tos-cn-i-tsj2vxp0zn/9ea78ef420fa4bf1b7e544a01e75b830?lk3s=343af0a2&x-expires=2098918800&x-signature=PKU%2FZjPW9deoUsXnzteUD8FKCK4%3D&from=876277922", "泣不成声": "https://p3-pc-sign.douyinpic.com/obj/tos-cn-i-tsj2vxp0zn/7fb67c323a0d410ea5573d4825e347eb?lk3s=343af0a2&x-expires=2098918800&x-signature=yRplGhZ6gqRFUMkpeoY8SWIb3UM%3D&from=876277922", "小鼓掌": "https://p3-pc-sign.douyinpic.com/obj/tos-cn-i-tsj2vxp0zn/8f19f0db21324c7f9ce7b2dca984a309?lk3s=343af0a2&x-expires=2098918800&x-signature=tye3GUJedxHSByl41pZ2SJ58V9Q%3D&from=876277922", "大金牙": "https://p3-pc-sign.douyinpic.com/obj/tos-cn-i-tsj2vxp0zn/b94090121f3e4549a3bee84e00515ed0?lk3s=343af0a2&x-expires=2098918800&x-signature=tqez%2BT8pVHtooIwBWg7WIUg2Nas%3D&from=876277922", "偷笑": "https://p3-pc-sign.douyinpic.com/obj/tos-cn-i-tsj2vxp0zn/817c931baafa4d06a120a8d67973b6f0?lk3s=343af0a2&x-expires=2098918800&x-signature=t31KT6X2PwrBH0I5fH9uxi8R5UI%3D&from=876277922", "石化": "https://p3-pc-sign.douyinpic.com/obj/tos-cn-i-tsj2vxp0zn/88746458dcbd47b1aa801e3823e6c9a2?lk3s=343af0a2&x-expires=2098918800&x-signature=h1bqXqo%2F9B%2FPMdjSGpfIXGdwaLI%3D&from=876277922", "思考": "https://p3-pc-sign.douyinpic.com/obj/tos-cn-i-tsj2vxp0zn/c3e345069adf42f58036c349ecc20a00?lk3s=343af0a2&x-expires=2098918800&x-signature=CP9dMAykkWgUxHuy5ikz8GJQ5FA%3D&from=876277922", "吐血": "https://p3-pc-sign.douyinpic.com/obj/tos-cn-i-tsj2vxp0zn/331299e25af844a38800ec75d8dd0a16?lk3s=343af0a2&x-expires=2098918800&x-signature=4YYhSEhVy1P1xTjDd1Px2P0Hk9s%3D&from=876277922", "可怜": "https://p3-pc-sign.douyinpic.com/obj/tos-cn-i-tsj2vxp0zn/1369a30daa7d45d6b3fa5ab241938fd2?lk3s=343af0a2&x-expires=2098918800&x-signature=qNNMU2HAG7JDwr27T6RXMO3ekmU%3D&from=876277922", "嘘": "https://p3-pc-sign.douyinpic.com/obj/tos-cn-i-tsj2vxp0zn/7c02d77ba7b44cfda223941529ccb2e6?lk3s=343af0a2&x-expires=2098918800&x-signature=iVVg2ZsaW06%2FdAxf5kYPu%2FidtTw%3D&from=876277922", "撇嘴": "https://p3-pc-sign.douyinpic.com/obj/tos-cn-i-tsj2vxp0zn/784ef77ac9de4e4990a607166856cd38?lk3s=343af0a2&x-expires=2098918800&x-signature=%2Bzm4wXNrR4z8xL64lo2e60x1Bx4%3D&from=876277922", "笑哭": "https://p3-pc-sign.douyinpic.com/obj/tos-cn-i-tsj2vxp0zn/e4f0c86449754bab8ae2cefe6317ceee?lk3s=343af0a2&x-expires=2098918800&x-signature=7u6%2FGFOVBIYkCesiEf9haIANEk4%3D&from=876277922", "奸笑": "https://p3-pc-sign.douyinpic.com/obj/tos-cn-i-tsj2vxp0zn/6ac6247beb3a41d9b9e0e982e0225506?lk3s=343af0a2&x-expires=2098918800&x-signature=qrAhFGlKmCYj4C60OALhB42r%2BZ0%3D&from=876277922", "得意": "https://p3-pc-sign.douyinpic.com/obj/tos-cn-i-tsj2vxp0zn/b1b52b6e940a4ef8907819eb8e871c21?lk3s=343af0a2&x-expires=2098918800&x-signature=cORSQgwZxrpWAIXK%2FosDs51jPwg%3D&from=876277922", "憨笑": "https://p3-pc-sign.douyinpic.com/obj/tos-cn-i-tsj2vxp0zn/fceeae50c04b4343b44055ba9f9bb1a3?lk3s=343af0a2&x-expires=2098918800&x-signature=RurR1HwN0Q7buXfWBVM6P2D8Vjs%3D&from=876277922", "坏笑": "https://p3-pc-sign.douyinpic.com/obj/tos-cn-i-tsj2vxp0zn/eab59a94674f40358b412586f148aac6?lk3s=343af0a2&x-expires=2098918800&x-signature=eWlyCYmnGMWa10ysbSLZuLf8TO8%3D&from=876277922", "抓狂": "https://p3-pc-sign.douyinpic.com/obj/tos-cn-i-tsj2vxp0zn/e7ffd9db28e3455195872ebf666d2c66?lk3s=343af0a2&x-expires=2098918800&x-signature=9lwRyW69qhTBh8U2BXysbCYsnEk%3D&from=876277922", "泪奔": "https://p3-pc-sign.douyinpic.com/obj/tos-cn-i-tsj2vxp0zn/20dbe8334dd64d028f943abc2ccde4d9?lk3s=343af0a2&x-expires=2098918800&x-signature=2tSZYhNYPOKJ8SsPlHywwfVh0Sg%3D&from=876277922", "钱": "https://p3-pc-sign.douyinpic.com/obj/tos-cn-i-tsj2vxp0zn/9a45bb9c0b8a4963b858846b079cfe2f?lk3s=343af0a2&x-expires=2098918800&x-signature=3fOVdB8DenbKZTAFGrFkmmUIy%2FU%3D&from=876277922", "恐惧": "https://p3-pc-sign.douyinpic.com/obj/tos-cn-i-tsj2vxp0zn/c12d025f50a047c2b064ce5f1a196f94?lk3s=343af0a2&x-expires=2098918800&x-signature=Zm8N95SNC45FFpHYk9GNj%2BbSNhU%3D&from=876277922", "愉快": "https://p3-pc-sign.douyinpic.com/obj/tos-cn-i-tsj2vxp0zn/62266cefe5fe4422aceaeaeed9072b3b?lk3s=343af0a2&x-expires=2098918800&x-signature=Tj4dLmJ34t7aRar28QF2iUEy4sE%3D&from=876277922", "快哭了": "https://p3-pc-sign.douyinpic.com/obj/tos-cn-i-tsj2vxp0zn/79df79563eaf424e9eb7a26558236ff7?lk3s=343af0a2&x-expires=2098918800&x-signature=h9P4oeqoQYRpvk060GsS0E%2FLmZ0%3D&from=876277922", "翻白眼": "https://p3-pc-sign.douyinpic.com/obj/tos-cn-i-tsj2vxp0zn/0e40da06368145848f7585edc937f34e?lk3s=343af0a2&x-expires=2098918800&x-signature=tfWWPR1i0fSlI1y9ezrZBhB%2Fpwc%3D&from=876277922", "互粉": "https://p3-pc-sign.douyinpic.com/obj/tos-cn-i-tsj2vxp0zn/cb46843009fe47808953af2c9ab2fb9a?lk3s=343af0a2&x-expires=2098918800&x-signature=nlUbL30vnqgV6xaESV9JwSr7gjE%3D&from=876277922", "我想静静": "https://p3-pc-sign.douyinpic.com/obj/tos-cn-i-tsj2vxp0zn/95d5d919b99c43f29d2fbc660ec873f0?lk3s=343af0a2&x-expires=2098918800&x-signature=efvSkYJjxid%2FpN5O5omeBeHoNLY%3D&from=876277922", "委屈": "https://p3-pc-sign.douyinpic.com/obj/tos-cn-i-tsj2vxp0zn/2f7509f2cbe248889f279d19ea3fd649?lk3s=343af0a2&x-expires=2098918800&x-signature=N1L3Hu%2Bgy4cJ9QUWvH9FuB%2Fz%2FXw%3D&from=876277922", "鄙视": "https://p3-pc-sign.douyinpic.com/obj/tos-cn-i-tsj2vxp0zn/5c13cbb44f334122a9cd7cf4bcc6598e?lk3s=343af0a2&x-expires=2098918800&x-signature=jGY558Vn3Ve%2BuyWELHqUeFrcbzY%3D&from=876277922", "飞吻": "https://p3-pc-sign.douyinpic.com/obj/tos-cn-i-tsj2vxp0zn/6dcb7560c1c84d45b4abe2cb37ae7afb?lk3s=343af0a2&x-expires=2098918800&x-signature=ajACUaiebxzgDpQjbKNhugd8go0%3D&from=876277922", "再见": "https://p3-pc-sign.douyinpic.com/obj/tos-cn-i-tsj2vxp0zn/cae63f89c3eb478f8d1cca893b1b1a0c?lk3s=343af0a2&x-expires=2098918800&x-signature=SOYMqIZyo0TL5OR8QCec7uL9po4%3D&from=876277922", "紫薇别走": "https://p3-pc-sign.douyinpic.com/obj/tos-cn-i-tsj2vxp0zn/1d921b6eff48473f872fa7d278d26926?lk3s=343af0a2&x-expires=2098918800&x-signature=EI29RnwrvnoWndOx1CZ%2BKTLLi00%3D&from=876277922", "听歌": "https://p3-pc-sign.douyinpic.com/obj/tos-cn-i-tsj2vxp0zn/82bed7a3182b4c6db21ca39417359fa1?lk3s=343af0a2&x-expires=2098918800&x-signature=pxIvO%2FVBuB4Y1a6HVIZxRCplRd0%3D&from=876277922", "求抱抱": "https://p3-pc-sign.douyinpic.com/obj/tos-cn-i-tsj2vxp0zn/de99b54c6be24f73a5aaef8366a55e99?lk3s=343af0a2&x-expires=2098918800&x-signature=%2B8SiVRjXqgC%2FV2ir%2Fv5Sjrw7xfk%3D&from=876277922", "绝望的凝视": "https://p3-pc-sign.douyinpic.com/obj/tos-cn-i-tsj2vxp0zn/19f6a9449e714d85bb393794daaf6d58?lk3s=343af0a2&x-expires=2098918800&x-signature=qXtap088hWDrKZDgJLXfWcy%2FvV8%3D&from=876277922", "不失礼貌的微笑": "https://p3-pc-sign.douyinpic.com/obj/tos-cn-i-tsj2vxp0zn/b7b842ba92e14fb8a8f328f25db91276?lk3s=343af0a2&x-expires=2098918800&x-signature=EnHGT83acoqBFSOz80YsEMwj1WM%3D&from=876277922", "不看": "https://p3-pc-sign.douyinpic.com/obj/tos-cn-i-tsj2vxp0zn/626f19e473d94e95b21b67f098599281?lk3s=343af0a2&x-expires=2098918800&x-signature=Sm2EPI%2BCYXjnIhvR5Olhh8phYYA%3D&from=876277922", "裂开": "https://p3-pc-sign.douyinpic.com/obj/tos-cn-i-tsj2vxp0zn/e8c40bd4201e4afda065c55688971a2f?lk3s=343af0a2&x-expires=2098918800&x-signature=DTY0LfIOf6nyB3BLKV%2FOlbRmO60%3D&from=876277922", "干饭人": "https://p3-pc-sign.douyinpic.com/obj/tos-cn-i-tsj2vxp0zn/0b0adfdffaea4c62a73302ae44d67a66?lk3s=343af0a2&x-expires=2098918800&x-signature=37P0XyWqt0TsokLqZ9COgfak5Ls%3D&from=876277922", "庆祝": "https://p3-pc-sign.douyinpic.com/obj/tos-cn-i-tsj2vxp0zn/9c1325e3650a4a4d96d8e299406d9d68?lk3s=343af0a2&x-expires=2098918800&x-signature=yPCCR13g92Gdda6V4tQYRQySf4M%3D&from=876277922", "吐舌": "https://p3-pc-sign.douyinpic.com/obj/tos-cn-i-tsj2vxp0zn/e577535321324e68a0cc8fcff1a2f421?lk3s=343af0a2&x-expires=2098918800&x-signature=tesvDr8PzhkBSrg0c%2F7G1QjuAYQ%3D&from=876277922", "呆无辜": "https://p3-pc-sign.douyinpic.com/obj/tos-cn-i-tsj2vxp0zn/98c368cc39b74b94bf7923b6d9c479b9?lk3s=343af0a2&x-expires=2098918800&x-signature=mWRi9xZV70GkJsxYUEcuIcV11l8%3D&from=876277922", "白眼": "https://p3-pc-sign.douyinpic.com/obj/tos-cn-i-tsj2vxp0zn/a9d1ba597042412f9275369807147bee?lk3s=343af0a2&x-expires=2098918800&x-signature=7TOQogpOcREDi10cIHSN5HKb0g0%3D&from=876277922", "猪头": "https://p3-pc-sign.douyinpic.com/obj/tos-cn-i-tsj2vxp0zn/4296ea156ee6479e9ad5c1381ec73cca?lk3s=343af0a2&x-expires=2098918800&x-signature=dS2EiD%2FQwDv7p9l7z3VtVTXTB4Y%3D&from=876277922", "冷漠": "https://p3-pc-sign.douyinpic.com/obj/tos-cn-i-tsj2vxp0zn/ba1d020f28a749e388fb1d15e52ac4ae?lk3s=343af0a2&x-expires=2098918800&x-signature=SZuMAYVD%2BVegQkxgVJvgEIXG3MY%3D&from=876277922", "暗中观察": "https://p3-pc-sign.douyinpic.com/obj/tos-cn-i-tsj2vxp0zn/3cf77301823a4e969cc4c0a04d245f3d?lk3s=343af0a2&x-expires=2098918800&x-signature=NvmOB10i3CmqF%2BBmV0c8PATDNOk%3D&from=876277922", "二哈": "https://p3-pc-sign.douyinpic.com/obj/tos-cn-i-tsj2vxp0zn/2ddc8ae48fae4a4fb3767f666bb79d95?lk3s=343af0a2&x-expires=2098918800&x-signature=hli7qn5p1ET20%2BSbvIaJIXvIyXA%3D&from=876277922", "菜狗": "https://p3-pc-sign.douyinpic.com/obj/tos-cn-i-tsj2vxp0zn/62baecf5a0084194ac383d3d199ab597?lk3s=343af0a2&x-expires=2098918800&x-signature=GYfwB31HVEih8gWYyexvcPo2k7E%3D&from=876277922", "黑脸": "https://p3-pc-sign.douyinpic.com/obj/tos-cn-i-tsj2vxp0zn/b96c76ac689f44d09537583ca2357672?lk3s=343af0a2&x-expires=2098918800&x-signature=omK1bqqwAMqpmGZD3royGmtjIiY%3D&from=876277922", "展开说说": "https://p3-pc-sign.douyinpic.com/obj/tos-cn-i-tsj2vxp0zn/30f0c01ef9d24144a8ae05351485fe18?lk3s=343af0a2&x-expires=2098918800&x-signature=cHEUzsixrz1hgNiPeUy6k%2FTO1VI%3D&from=876277922", "蜜蜂狗": "https://p3-pc-sign.douyinpic.com/obj/tos-cn-i-tsj2vxp0zn/d336f83b827b407d872bc48861a44c70?lk3s=343af0a2&x-expires=2098918800&x-signature=D5TcOL1KqasMPVP%2FpcyOkLV4ons%3D&from=876277922", "柴犬": "https://p3-pc-sign.douyinpic.com/obj/tos-cn-i-tsj2vxp0zn/764a5db2a67242c189f5fdabb1c75648?lk3s=343af0a2&x-expires=2098918800&x-signature=JV%2Bdktr0IYRnNL1Lo0hK1atcikA%3D&from=876277922", "摸头": "https://p3-pc-sign.douyinpic.com/obj/tos-cn-i-tsj2vxp0zn/10790e118cbc4d13b48cdc19c1eecb96?lk3s=343af0a2&x-expires=2098918800&x-signature=hJPu2oReJ0q4U04uY6ZMEmSVAjw%3D&from=876277922", "皱眉": "https://p3-pc-sign.douyinpic.com/obj/tos-cn-i-tsj2vxp0zn/d143738426054c9f88657ee97b779643?lk3s=343af0a2&x-expires=2098918800&x-signature=EqYSufnYzEbYxG0%2B3lwXNzKDt1U%3D&from=876277922", "擦汗": "https://p3-pc-sign.douyinpic.com/obj/tos-cn-i-tsj2vxp0zn/0f7be11419c44d1ab158bbafa666101c?lk3s=343af0a2&x-expires=2098918800&x-signature=70xVWmCcYSJ0yuelVXV2v2y76XM%3D&from=876277922", "红脸": "https://p3-pc-sign.douyinpic.com/obj/tos-cn-i-tsj2vxp0zn/15efff0277f74e5b9e2b12c984eac159?lk3s=343af0a2&x-expires=2098918800&x-signature=1F%2FVyXrsgQmEzIlN5kcTY0eEVno%3D&from=876277922", "做鬼脸": "https://p3-pc-sign.douyinpic.com/obj/tos-cn-i-tsj2vxp0zn/e8d099b1dc5b41b0b8535b47747a94f4?lk3s=343af0a2&x-expires=2098918800&x-signature=58vVnWMpMA2RJ6XaF8hvqJ%2FEyik%3D&from=876277922", "强": "https://p3-pc-sign.douyinpic.com/obj/tos-cn-i-tsj2vxp0zn/0b815bcdb647471b9281e3105d8d6c8e?lk3s=343af0a2&x-expires=2098918800&x-signature=DJSDbyDo5RryFda3%2FDrZGqQcZJE%3D&from=876277922", "如花": "https://p3-pc-sign.douyinpic.com/obj/tos-cn-i-tsj2vxp0zn/dd44ccdacbe6444a9515bdca3fb56d5f?lk3s=343af0a2&x-expires=2098918800&x-signature=aWQlntDceFMHbXZxQUq4kk8Y7YU%3D&from=876277922", "吐": "https://p3-pc-sign.douyinpic.com/obj/tos-cn-i-tsj2vxp0zn/c0157bfb1fc548d097933c039d6952ae?lk3s=343af0a2&x-expires=2098918800&x-signature=nBypWwzPtjbFevz8bzrQJioZuQI%3D&from=876277922", "惊喜": "https://p3-pc-sign.douyinpic.com/obj/tos-cn-i-tsj2vxp0zn/e718e4d7913c4bcf9c49560ff96386e9?lk3s=343af0a2&x-expires=2098918800&x-signature=KrFVrUbUBOkhwyqbSM%2FH6lQP%2B70%3D&from=876277922", "敲打": "https://p3-pc-sign.douyinpic.com/obj/tos-cn-i-tsj2vxp0zn/8067eb30b0d74ad29c15a8c5c7b11230?lk3s=343af0a2&x-expires=2098918800&x-signature=jq%2FkvThj1kXTGXkh9B2QYSI3KDQ%3D&from=876277922", "奋斗": "https://p3-pc-sign.douyinpic.com/obj/tos-cn-i-tsj2vxp0zn/fb3fb08ab5204f2a83086d782944882d?lk3s=343af0a2&x-expires=2098918800&x-signature=rybA1CGiIeHYEA41ibOL4Oqukms%3D&from=876277922", "吐彩虹": "https://p3-pc-sign.douyinpic.com/obj/tos-cn-i-tsj2vxp0zn/0878b09fe3fa4d4a8f47c63748cf7762?lk3s=343af0a2&x-expires=2098918800&x-signature=XNlRQYDif%2BQWpOvuri4PG4HlRXM%3D&from=876277922", "大哭": "https://p3-pc-sign.douyinpic.com/obj/tos-cn-i-tsj2vxp0zn/53246f7d51fa42e5b48b99c8074ca607?lk3s=343af0a2&x-expires=2098918800&x-signature=AYgbRWgUHCOEmRG6n3ZHvEsOYv8%3D&from=876277922", "嘿哈": "https://p3-pc-sign.douyinpic.com/obj/tos-cn-i-tsj2vxp0zn/af4e2e63b51f4d66a060ff0a42d0098b?lk3s=343af0a2&x-expires=2098918800&x-signature=hl%2BIP5%2FvV9n9h0v5ewzwTWoseSA%3D&from=876277922", "惊恐": "https://p3-pc-sign.douyinpic.com/obj/tos-cn-i-tsj2vxp0zn/fd2f5745edbd4dadb6014096965d1c6c?lk3s=343af0a2&x-expires=2098918800&x-signature=flEevfb7v9GDkoXoPxIozNDOGMw%3D&from=876277922", "囧": "https://p3-pc-sign.douyinpic.com/obj/tos-cn-i-tsj2vxp0zn/4cd5a1e2c43341a9b4ac95ace6ed913e?lk3s=343af0a2&x-expires=2098918800&x-signature=X1o4O5TTnb2uv4AE5nMgPvOgHx4%3D&from=876277922", "难过": "https://p3-pc-sign.douyinpic.com/obj/tos-cn-i-tsj2vxp0zn/697dc91cd453495d988628058582fed3?lk3s=343af0a2&x-expires=2098918800&x-signature=ZPNIo%2FMH4Xre0mdq%2FrewHTI%2FA2g%3D&from=876277922", "斜眼": "https://p3-pc-sign.douyinpic.com/obj/tos-cn-i-tsj2vxp0zn/63a00ad586eb4f9e81369a7e693b778b?lk3s=343af0a2&x-expires=2098918800&x-signature=vxz%2Bxb3XedstYJyt0kI0L6avONc%3D&from=876277922", "阴险": "https://p3-pc-sign.douyinpic.com/obj/tos-cn-i-tsj2vxp0zn/628bc8956092489399730d0c8178de5b?lk3s=343af0a2&x-expires=2098918800&x-signature=6Bdl%2FRwtFaxIPqyPxnCRJMUEKDk%3D&from=876277922", "悠闲": "https://p3-pc-sign.douyinpic.com/obj/tos-cn-i-tsj2vxp0zn/989818a338bd4d718f0afc47f7c76a4c?lk3s=343af0a2&x-expires=2098918800&x-signature=I6HzpZkh2jK3KXo%2B8cmxzvnSg6o%3D&from=876277922", "咒骂": "https://p3-pc-sign.douyinpic.com/obj/tos-cn-i-tsj2vxp0zn/44802ec1a8bd4ff2aac38cfcf97201cb?lk3s=343af0a2&x-expires=2098918800&x-signature=1JTI2pxemY0buvDX8TYKTzf711c%3D&from=876277922", "吃瓜群众": "https://p3-pc-sign.douyinpic.com/obj/tos-cn-i-tsj2vxp0zn/2e2059714acb489483735cbe63ff7dbc?lk3s=343af0a2&x-expires=2098918800&x-signature=dV%2F2SMna6iQ4vlbEV5EYSyxDVIM%3D&from=876277922", "绿帽子": "https://p3-pc-sign.douyinpic.com/obj/tos-cn-i-tsj2vxp0zn/d23e058bab744349ac636c45e9a3687f?lk3s=343af0a2&x-expires=2098918800&x-signature=i4bjV9ixmtpHcw%2FMTRRFVOg9XkM%3D&from=876277922", "敢怒不敢言": "https://p3-pc-sign.douyinpic.com/obj/tos-cn-i-tsj2vxp0zn/38b34096e69c41119b8d50cfd3a66882?lk3s=343af0a2&x-expires=2098918800&x-signature=jP67a3ThKA%2B9WPSsxlXdFGUm0cw%3D&from=876277922", "求求了": "https://p3-pc-sign.douyinpic.com/obj/tos-cn-i-tsj2vxp0zn/3b99deef770044d79182c18a854f4f27?lk3s=343af0a2&x-expires=2098918800&x-signature=INk96%2BavaZEgb4pBZS0igLGOiIo%3D&from=876277922", "眼含热泪": "https://p3-pc-sign.douyinpic.com/obj/tos-cn-i-tsj2vxp0zn/daf0e01ed3404b8e88898f690533bb76?lk3s=343af0a2&x-expires=2098918800&x-signature=I6ELd6UkZOjyrOlDfgOzfMlme90%3D&from=876277922", "叹气": "https://p3-pc-sign.douyinpic.com/obj/tos-cn-i-tsj2vxp0zn/d7c541c323de4272acf862f77bb8b8a2?lk3s=343af0a2&x-expires=2098918800&x-signature=Qkd7Cygc4XamCp36h%2BHTWOWcc28%3D&from=876277922", "好开心": "https://p3-pc-sign.douyinpic.com/obj/tos-cn-i-tsj2vxp0zn/9b931359a63a42f693fdabe5934e95a9?lk3s=343af0a2&x-expires=2098918800&x-signature=deV9uk6q2lo2X9evQOJvnvmJEf4%3D&from=876277922", "不是吧": "https://p3-pc-sign.douyinpic.com/obj/tos-cn-i-tsj2vxp0zn/a854fc87af894fddb1e36f97867c8169?lk3s=343af0a2&x-expires=2098918800&x-signature=HCcnVfgUEzQ1yAOulb1qUFQlFyc%3D&from=876277922", "鞠躬": "https://p3-pc-sign.douyinpic.com/obj/tos-cn-i-tsj2vxp0zn/93ffc02b07174d15a0d602b7a4cbb87f?lk3s=343af0a2&x-expires=2098918800&x-signature=26T%2FdUC3tZe0yQXysOSOCnUogWU%3D&from=876277922", "躺平": "https://p3-pc-sign.douyinpic.com/obj/tos-cn-i-tsj2vxp0zn/25625ce0678448fc9c556bd1ebcf638c?lk3s=343af0a2&x-expires=2098918800&x-signature=S%2FInMDIo2kIDv3hsjzz1olUPgiw%3D&from=876277922", "九转大肠": "https://p3-pc-sign.douyinpic.com/obj/tos-cn-i-tsj2vxp0zn/ea89e25c77dd423d8403d20740f23bb7?lk3s=343af0a2&x-expires=2098918800&x-signature=WBNsku5cN73EaDw2ol1Ro7i4cbQ%3D&from=876277922", "不你不想": "https://p3-pc-sign.douyinpic.com/obj/tos-cn-i-tsj2vxp0zn/b4845baf417a404488e955464208cc3c?lk3s=343af0a2&x-expires=2098918800&x-signature=I5bI7WL6YXUAlETlB9Qcag%2FDi%2BY%3D&from=876277922", "一头乱麻": "https://p3-pc-sign.douyinpic.com/obj/tos-cn-i-tsj2vxp0zn/db393c6b9bba40f3b37d4e079d1cbf1e?lk3s=343af0a2&x-expires=2098918800&x-signature=sJg5%2FBs5ZIXMMF9dJUHEnaYLf1I%3D&from=876277922", "kisskiss": "https://p3-pc-sign.douyinpic.com/obj/tos-cn-i-tsj2vxp0zn/f971f6f859b24829a15196c5a0738df1?lk3s=343af0a2&x-expires=2098918800&x-signature=adV%2Fp%2BPPJqzkmbv2pNcCyEqAX50%3D&from=876277922", "你不大行": "https://p3-pc-sign.douyinpic.com/obj/tos-cn-i-tsj2vxp0zn/0f2d07ea48a94bf0a57818056392bb42?lk3s=343af0a2&x-expires=2098918800&x-signature=eOyFF4WbZIipK3jH2snRuPXN52A%3D&from=876277922", "噢买尬": "https://p3-pc-sign.douyinpic.com/obj/tos-cn-i-tsj2vxp0zn/af75834bf58e44c88b1825f85d50b7da?lk3s=343af0a2&x-expires=2098918800&x-signature=jw22yvlqpT0AHaWsJyQTBSH0QAk%3D&from=876277922", "宕机": "https://p3-pc-sign.douyinpic.com/obj/tos-cn-i-tsj2vxp0zn/561341b97e7844148b6f040241357122?lk3s=343af0a2&x-expires=2098918800&x-signature=n9%2BSKmKiY7UgxKtbCVVbdQpShsE%3D&from=876277922", "苦涩": "https://p3-pc-sign.douyinpic.com/obj/tos-cn-i-tsj2vxp0zn/e72ce46a6ab640b38c7686f4b77fb7e4?lk3s=343af0a2&x-expires=2098918800&x-signature=iIMKpqtuPh7sFXehSbyV7YsQQvA%3D&from=876277922", "逞强落泪": "https://p3-pc-sign.douyinpic.com/obj/tos-cn-i-tsj2vxp0zn/67b9bcd2e1d64888bf57fa433e5b4717?lk3s=343af0a2&x-expires=2098918800&x-signature=7gpAGQbKvhvFi541utblZ9H1dao%3D&from=876277922", "求机位-黄脸": "https://p3-pc-sign.douyinpic.com/obj/tos-cn-i-tsj2vxp0zn/66e8109018b64af1b87ce68ff2bfc18e?lk3s=343af0a2&x-expires=2098918800&x-signature=bSJ46Q92IN%2FHMQ02mnXXcf9Anoo%3D&from=876277922", "求机位3": "https://p3-pc-sign.douyinpic.com/obj/tos-cn-i-tsj2vxp0zn/ec3d99650c114cb49f22cda9ce06d25f?lk3s=343af0a2&x-expires=2098918800&x-signature=rh1FcvauyskiV76IyIpl7d6BFiw%3D&from=876277922", "点赞": "https://p3-pc-sign.douyinpic.com/obj/tos-cn-i-tsj2vxp0zn/8e7e1b35d32b4623a0240552dc784b0f?lk3s=343af0a2&x-expires=2098918800&x-signature=0DJ%2FqgGcLdphvrJQS8SxYtxXRvg%3D&from=876277922", "精选": "https://p3-pc-sign.douyinpic.com/obj/tos-cn-i-tsj2vxp0zn/8d72402dd91a4a3a8cf4591b266ddb14?lk3s=343af0a2&x-expires=2098918800&x-signature=zE5h6K4THViiUNJjhtGTiFI%2BtzY%3D&from=876277922", "强壮": "https://p3-pc-sign.douyinpic.com/obj/tos-cn-i-tsj2vxp0zn/41a493d326e7475fb8f1ef0c614dbf25?lk3s=343af0a2&x-expires=2098918800&x-signature=hswoMjpiejgrTWa51iRL1%2Fpvq%2BU%3D&from=876277922", "碰拳": "https://p3-pc-sign.douyinpic.com/obj/tos-cn-i-tsj2vxp0zn/2bba2a8b361e467288d796c1581fec60?lk3s=343af0a2&x-expires=2098918800&x-signature=iIqHun%2BKrIS1fVtJjzF2NnG%2FrOo%3D&from=876277922", "OK": "https://p3-pc-sign.douyinpic.com/obj/tos-cn-i-tsj2vxp0zn/28dd2b330ea74d4cac2388f617177fe1?lk3s=343af0a2&x-expires=2098918800&x-signature=tHtrXdbVcWPKzEliuRb1AndeVoc%3D&from=876277922", "击掌": "https://p3-pc-sign.douyinpic.com/obj/tos-cn-i-tsj2vxp0zn/d3f83268e073468fbe8759638beb42ef?lk3s=343af0a2&x-expires=2098918800&x-signature=5%2BeNKeJU9w8ZV1C6OzbvN4SQTK4%3D&from=876277922", "左上": "https://p3-pc-sign.douyinpic.com/obj/tos-cn-i-tsj2vxp0zn/cf670dd2a4c2487181ee834aa0b048fa?lk3s=343af0a2&x-expires=2098918800&x-signature=rvasqWJoZhfZVjyP3ZIyMKu2gJA%3D&from=876277922", "握手": "https://p3-pc-sign.douyinpic.com/obj/tos-cn-i-tsj2vxp0zn/4550a48b841144d7b37fff3d02ec8a25?lk3s=343af0a2&x-expires=2098918800&x-signature=2TAwGiUkU4Pu59k%2BG%2BZuNhl2Z%2BM%3D&from=876277922", "抱拳": "https://p3-pc-sign.douyinpic.com/obj/tos-cn-i-tsj2vxp0zn/5c6a7e331b7441ecb615e0adab43935a?lk3s=343af0a2&x-expires=2098918800&x-signature=6iorAq%2B3Obenh6XJbstCjc74Ixc%3D&from=876277922", "勾引": "https://p3-pc-sign.douyinpic.com/obj/tos-cn-i-tsj2vxp0zn/6db49f314c1d4754a8205c3231edd396?lk3s=343af0a2&x-expires=2098918800&x-signature=04PblgBYblxlVT%2Baq7bugFYlm3A%3D&from=876277922", "拳头": "https://p3-pc-sign.douyinpic.com/obj/tos-cn-i-tsj2vxp0zn/5bede8c4134b4be798c924faee784650?lk3s=343af0a2&x-expires=2098918800&x-signature=Lxqr0PWp9oH46yOjt1uhIBBrnuE%3D&from=876277922", "弱": "https://p3-pc-sign.douyinpic.com/obj/tos-cn-i-tsj2vxp0zn/5028f8d3638a488b987008c384745afc?lk3s=343af0a2&x-expires=2098918800&x-signature=pielIDjM%2BUDyOiZChGZ12%2BaJdeI%3D&from=876277922", "胜利": "https://p3-pc-sign.douyinpic.com/obj/tos-cn-i-tsj2vxp0zn/85abaf2fa4b940879a7b3bfdb45c3299?lk3s=343af0a2&x-expires=2098918800&x-signature=1KYd%2FQAXSlspeGGPhntr4KizCmU%3D&from=876277922", "右边": "https://p3-pc-sign.douyinpic.com/obj/tos-cn-i-tsj2vxp0zn/11aadc9ed7b643279c38f94e8ed347c0?lk3s=343af0a2&x-expires=2098918800&x-signature=nvu4i2bXSJgR5blOxWAUZmzGJlA%3D&from=876277922", "左边": "https://p3-pc-sign.douyinpic.com/obj/tos-cn-i-tsj2vxp0zn/bed344e70c214bf281db6a7944ef909a?lk3s=343af0a2&x-expires=2098918800&x-signature=3dQpQHkcrMwv7lKz81HmnuaNjM8%3D&from=876277922", "嘴唇": "https://p3-pc-sign.douyinpic.com/obj/tos-cn-i-tsj2vxp0zn/b1b3824e7b6c482b8d52b1c3b5577849?lk3s=343af0a2&x-expires=2098918800&x-signature=FEDgjHKw4HtYQY%2BoALuephSQT5w%3D&from=876277922", "心碎": "https://p3-pc-sign.douyinpic.com/obj/tos-cn-i-tsj2vxp0zn/371bb866809f454597ef538f604bd25a?lk3s=343af0a2&x-expires=2098918800&x-signature=Fn2jiIN4FSrDcCda3iWFuy1fElM%3D&from=876277922", "凋谢": "https://p3-pc-sign.douyinpic.com/obj/tos-cn-i-tsj2vxp0zn/c93a47ad594b4be3a8c288aff0d7543b?lk3s=343af0a2&x-expires=2098918800&x-signature=DAyEm9a8bjeSzekyL2nYPkNaC38%3D&from=876277922", "愤怒": "https://p3-pc-sign.douyinpic.com/obj/tos-cn-i-tsj2vxp0zn/6dd1d010b5fd4f5197c1ecad3ce6796b?lk3s=343af0a2&x-expires=2098918800&x-signature=XVlpgLs0RRku5x5XYJQO0w90LPo%3D&from=876277922", "垃圾": "https://p3-pc-sign.douyinpic.com/obj/tos-cn-i-tsj2vxp0zn/d7d09280091445aabfd912bcca4d9a89?lk3s=343af0a2&x-expires=2098918800&x-signature=vrCCbzKgy5NO51yCBOY1%2B9%2Bs71g%3D&from=876277922", "啤酒": "https://p3-pc-sign.douyinpic.com/obj/tos-cn-i-tsj2vxp0zn/a8ae1c4c2e0f467dbff1ba0964e0175d?lk3s=343af0a2&x-expires=2098918800&x-signature=1u6weitGxQoS2F2G5gfdV6cUzAw%3D&from=876277922", "咖啡": "https://p3-pc-sign.douyinpic.com/obj/tos-cn-i-tsj2vxp0zn/dcbcf5d7ca07490a950a37ff66a5be74?lk3s=343af0a2&x-expires=2098918800&x-signature=DMoTNWjf9sax%2BnJ%2FhIJ86T%2FS4KE%3D&from=876277922", "蛋糕": "https://p3-pc-sign.douyinpic.com/obj/tos-cn-i-tsj2vxp0zn/1153a12fbb514977b3a5349d3dcc509b?lk3s=343af0a2&x-expires=2098918800&x-signature=PRNWB4RKBimOk7NlauWpYuMgTQA%3D&from=876277922", "礼物": "https://p3-pc-sign.douyinpic.com/obj/tos-cn-i-tsj2vxp0zn/e8e086e0f6544f9b87117abebd96e840?lk3s=343af0a2&x-expires=2098918800&x-signature=%2FBo2DISvVliSQ3ownPqST944Bqk%3D&from=876277922", "撒花": "https://p3-pc-sign.douyinpic.com/obj/tos-cn-i-tsj2vxp0zn/8cefd1b8c16b412298657b6e1d81f8ab?lk3s=343af0a2&x-expires=2098918800&x-signature=tJU3qL2jum56NATbYlQlAa1H7Hc%3D&from=876277922", "加一": "https://p3-pc-sign.douyinpic.com/obj/tos-cn-i-tsj2vxp0zn/496076e82fd74be793ab16d2940e8f8c?lk3s=343af0a2&x-expires=2098918800&x-signature=3NhXthicc8SIeH1IZYUS8lKGbeA%3D&from=876277922", "减一": "https://p3-pc-sign.douyinpic.com/obj/tos-cn-i-tsj2vxp0zn/ffc25006163e4ecfa70968744d1be61e?lk3s=343af0a2&x-expires=2098918800&x-signature=dOiK1lOd%2FGBvnIFeWPdgksxRblo%3D&from=876277922", "okk": "https://p3-pc-sign.douyinpic.com/obj/tos-cn-i-tsj2vxp0zn/9309aa3f9bed475b88538346f56fc6e6?lk3s=343af0a2&x-expires=2098918800&x-signature=qw%2BqmM1ft4OIytAjxi40ZhvuLiA%3D&from=876277922", "V5": "https://p3-pc-sign.douyinpic.com/obj/tos-cn-i-tsj2vxp0zn/cddffb522b2d421d81eb9da0f7f3cbb1?lk3s=343af0a2&x-expires=2098918800&x-signature=CQdRUP50MkAaXhWTX%2BWqVBgwoB0%3D&from=876277922", "绝": "https://p3-pc-sign.douyinpic.com/obj/tos-cn-i-tsj2vxp0zn/f1e1a02468b7420c841733c780ec2576?lk3s=343af0a2&x-expires=2098918800&x-signature=mHvqrp9S6VbFrbwaWXl1HiGfMI8%3D&from=876277922", "给力": "https://p3-pc-sign.douyinpic.com/obj/tos-cn-i-tsj2vxp0zn/5387fc1361634b579946fbac7c4ea5f4?lk3s=343af0a2&x-expires=2098918800&x-signature=w9IXoEu6fad9WTNzFKjzzFz3kCo%3D&from=876277922", "红包": "https://p3-pc-sign.douyinpic.com/obj/tos-cn-i-tsj2vxp0zn/3e78d79aa4964404bb78b445f34c78fd?lk3s=343af0a2&x-expires=2098918800&x-signature=YJt%2F1I%2Bsl9sXZA5ZsFHE%2FHkw0Hg%3D&from=876277922", "屎": "https://p3-pc-sign.douyinpic.com/obj/tos-cn-i-tsj2vxp0zn/eae0730620d644bdbb91985bd9cfff4e?lk3s=343af0a2&x-expires=2098918800&x-signature=BFosl1AC%2BeXEo7hyYG31RTqYYjw%3D&from=876277922", "发": "https://p3-pc-sign.douyinpic.com/obj/tos-cn-i-tsj2vxp0zn/ee4f3e944a62429e8e963bd187d00536?lk3s=343af0a2&x-expires=2098918800&x-signature=gZumGYrc0jlOGFd%2F7pcUiQesICk%3D&from=876277922", "18禁": "https://p3-pc-sign.douyinpic.com/obj/tos-cn-i-tsj2vxp0zn/40724dd5538c474693ec54d34a14c613?lk3s=343af0a2&x-expires=2098918800&x-signature=nyqMsiz0gedPm6j5aDG7CtsYj9A%3D&from=876277922", "炸弹": "https://p3-pc-sign.douyinpic.com/obj/tos-cn-i-tsj2vxp0zn/a309a1e9a10049d88b1c9848f5f7b287?lk3s=343af0a2&x-expires=2098918800&x-signature=cbZiKxl6l7Kk150%2BqhtTMIQRagQ%3D&from=876277922", "西瓜": "https://p3-pc-sign.douyinpic.com/obj/tos-cn-i-tsj2vxp0zn/39ca333313da4187bd5651a5404aed26?lk3s=343af0a2&x-expires=2098918800&x-signature=5Q0ZOVZWhZRxhIEmV9%2F%2FnNu4LnI%3D&from=876277922", "加鸡腿": "https://p3-pc-sign.douyinpic.com/obj/tos-cn-i-tsj2vxp0zn/1391aac43d004af986f2202f43253f94?lk3s=343af0a2&x-expires=2098918800&x-signature=2ERb8U0Ajds%2FYNev5HuVBObSVS0%3D&from=876277922", "握爪": "https://p3-pc-sign.douyinpic.com/obj/tos-cn-i-tsj2vxp0zn/966210d6153146e8b58686aa1cc763ca?lk3s=343af0a2&x-expires=2098918800&x-signature=lJWUMfX1aH04qydNv9xSPT6Jiow%3D&from=876277922", "太阳": "https://p3-pc-sign.douyinpic.com/obj/tos-cn-i-tsj2vxp0zn/5c9e5b67fc524f14b4ae49b5977afd9d?lk3s=343af0a2&x-expires=2098918800&x-signature=P2IxTSNxM7z7bu0R5sUMnAgTACM%3D&from=876277922", "月亮": "https://p3-pc-sign.douyinpic.com/obj/tos-cn-i-tsj2vxp0zn/cfa03e7f7b534eb2a9bc16fec54ed23f?lk3s=343af0a2&x-expires=2098918800&x-signature=nBacGaLV%2BznTJFIBG3pFCx0Ic54%3D&from=876277922", "给跪了": "https://p3-pc-sign.douyinpic.com/obj/tos-cn-i-tsj2vxp0zn/21d2a8bbe630496d88c03fa9179b17cb?lk3s=343af0a2&x-expires=2098918800&x-signature=LyQB5a513JmfQezmAeVeiypIFM4%3D&from=876277922", "蕉绿": "https://p3-pc-sign.douyinpic.com/obj/tos-cn-i-tsj2vxp0zn/ac2d04da5bf54c8bb12628510d8718ba?lk3s=343af0a2&x-expires=2098918800&x-signature=R0YD9M6vE4ujCTgIADEzv%2FzrdlI%3D&from=876277922", "扎心": "https://p3-pc-sign.douyinpic.com/obj/tos-cn-i-tsj2vxp0zn/e6121879b6de4bd08d35a312574f6563?lk3s=343af0a2&x-expires=2098918800&x-signature=BxTZOn6jv%2B9G1bY%2FT%2Fb4KH8Qbq4%3D&from=876277922", "胡瓜": "https://p3-pc-sign.douyinpic.com/obj/tos-cn-i-tsj2vxp0zn/5f3bb76347cd49e4935300b507353f68?lk3s=343af0a2&x-expires=2098918800&x-signature=N1XrFNaWr9qIQBSSIwdDCB8IWF0%3D&from=876277922", "打call": "https://p3-pc-sign.douyinpic.com/obj/tos-cn-i-tsj2vxp0zn/31a1efcf7c97414fae43d1d08058b0ee?lk3s=343af0a2&x-expires=2098918800&x-signature=bslpaM%2F2IIRzLxmtcGZ3Bwd1Zs8%3D&from=876277922", "栓Q": "https://p3-pc-sign.douyinpic.com/obj/tos-cn-i-tsj2vxp0zn/a948fa11ae344a1d91276235ab6bf70b?lk3s=343af0a2&x-expires=2098918800&x-signature=VRx%2BwWZPINth%2FV9pni6N5bXGB6c%3D&from=876277922", "雪花": "https://p3-pc-sign.douyinpic.com/obj/tos-cn-i-tsj2vxp0zn/5144febc02ad42c082b83980d9159e13?lk3s=343af0a2&x-expires=2098918800&x-signature=3rhV13CxlkvBaUF0QEq9cNl71Jk%3D&from=876277922", "圣诞树": "https://p3-pc-sign.douyinpic.com/obj/tos-cn-i-tsj2vxp0zn/9d3184f19a0042f2886922fd6d1b6823?lk3s=343af0a2&x-expires=2098918800&x-signature=EJmH96DJS8EBPEK%2FlcbPnKZVCOA%3D&from=876277922", "平安果": "https://p3-pc-sign.douyinpic.com/obj/tos-cn-i-tsj2vxp0zn/0855a7b63f1f437db4eaa3519d5dd4d5?lk3s=343af0a2&x-expires=2098918800&x-signature=6KxuhJJGI6gEqBA%2FiAK6YOizHzo%3D&from=876277922", "圣诞帽": "https://p3-pc-sign.douyinpic.com/obj/tos-cn-i-tsj2vxp0zn/71d0ea5435d443519eafc2d72eee07c7?lk3s=343af0a2&x-expires=2098918800&x-signature=Mb6hvD960KUd%2BDPMphO647ER6%2Fo%3D&from=876277922", "气球": "https://p3-pc-sign.douyinpic.com/obj/tos-cn-i-tsj2vxp0zn/2eb779c7734345979bd3f866989a167f?lk3s=343af0a2&x-expires=2098918800&x-signature=b6So23FCFaVkWqZ%2ByJ6V1s8Ngh8%3D&from=876277922", "烟花": "https://p3-pc-sign.douyinpic.com/obj/tos-cn-i-tsj2vxp0zn/e679017985b54d19b23668fc3437a1a1?lk3s=343af0a2&x-expires=2098918800&x-signature=aNUIdSvedWFC72PLDdYVBtL67rA%3D&from=876277922", "福": "https://p3-pc-sign.douyinpic.com/obj/tos-cn-i-tsj2vxp0zn/c5dd439d89754e4aa6c553a244aacc4b?lk3s=343af0a2&x-expires=2098918800&x-signature=OpxkOe4CD9qxWbEp2tAdJQHfM%2Fc%3D&from=876277922", "candy": "https://p3-pc-sign.douyinpic.com/obj/tos-cn-i-tsj2vxp0zn/cce110c8f9f74a898a21ab413fb6cc63?lk3s=343af0a2&x-expires=2098918800&x-signature=hstOxn49j0FHheepgNNN29otvH8%3D&from=876277922", "糖葫芦": "https://p3-pc-sign.douyinpic.com/obj/tos-cn-i-tsj2vxp0zn/f99e62388e6c4553974f1fe44f602456?lk3s=343af0a2&x-expires=2098918800&x-signature=dywAUdcQonenwrDTlHL%2BZ0D5s%2Bw%3D&from=876277922", "鞭炮": "https://p3-pc-sign.douyinpic.com/obj/tos-cn-i-tsj2vxp0zn/237a828fd0964b2b9510c15de33383ad?lk3s=343af0a2&x-expires=2098918800&x-signature=JVd9fYEzY6Wu%2FR72URptL8chpfs%3D&from=876277922", "元宝": "https://p3-pc-sign.douyinpic.com/obj/tos-cn-i-tsj2vxp0zn/6c0ebb50021a4b9e84cb5908be4eb5ef?lk3s=343af0a2&x-expires=2098918800&x-signature=aaYjZW7APExJadKmLrS06D3L5ck%3D&from=876277922", "灯笼": "https://p3-pc-sign.douyinpic.com/obj/tos-cn-i-tsj2vxp0zn/a7a43e8805fc425990fed26d8be5b7b6?lk3s=343af0a2&x-expires=2098918800&x-signature=gqcIAquv2BJKvnZvDEWVAX81uns%3D&from=876277922", "锦鲤": "https://p3-pc-sign.douyinpic.com/obj/tos-cn-i-tsj2vxp0zn/f88e3e8d639b438aaa084549086fbb46?lk3s=343af0a2&x-expires=2098918800&x-signature=gP%2BY8krYrJbZqdtIOFJ7%2BD8TINY%3D&from=876277922", "巧克力": "https://p3-pc-sign.douyinpic.com/obj/tos-cn-i-tsj2vxp0zn/c6db9180292c47779624a865d80f67e7?lk3s=343af0a2&x-expires=2098918800&x-signature=bE2yAJlQf4YCmZG5RTOKDiPMYfM%3D&from=876277922", "戒指": "https://p3-pc-sign.douyinpic.com/obj/tos-cn-i-tsj2vxp0zn/f8eb6c5b5d6640cc82de8ecd4acd33d0?lk3s=343af0a2&x-expires=2098918800&x-signature=Gl%2FS7iRJv735ZREx%2B6dKWo4BWI4%3D&from=876277922", "棒棒糖": "https://p3-pc-sign.douyinpic.com/obj/tos-cn-i-tsj2vxp0zn/38fd079e306a40e4953bdf4a5d8a16db?lk3s=343af0a2&x-expires=2098918800&x-signature=%2B6otU7w9i92VgYG0NExmTrg8Bms%3D&from=876277922", "纸飞机": "https://p3-pc-sign.douyinpic.com/obj/tos-cn-i-tsj2vxp0zn/c0e6de9ee9d646d0a0d01831f3870787?lk3s=343af0a2&x-expires=2098918800&x-signature=Z6TAEdsuFTJwEp15yg8KQyL0BkM%3D&from=876277922", "粽子": "https://p3-pc-sign.douyinpic.com/obj/tos-cn-i-tsj2vxp0zn/ce5e59e1376d440b98bb738c90e1a6e1?lk3s=343af0a2&x-expires=2098918800&x-signature=%2Be8nd%2Bw4c0zGocvpJyyEML8xSF8%3D&from=876277922"}

async function viewDetail(sessionId: number, fromPopState = false) {
  const gen = ++_viewGen  // 竞态防护
  stopAutoRefresh()
  viewLevel.value = 'detail'
  currentSessionId.value = sessionId
  detailTab.value = 'gifts'
  detailData.value = null  // 清空旧数据，防止闪现上一个场次的内容
  _danmaku.value = []
  danmakuSearchQuery.value = ''
  anonQuery.value = ''
  anonMatches.value = []; anonSearched.value = false; anonLoading.value = false
  if (!fromPopState) router.push({ name: 'detail', params: { sessionId: String(sessionId) } })
  updateBreadcrumb()
  contentLoading.value = true
  try {
    const data = await fetchSessionDetail(String(sessionId))
    if (gen !== _viewGen) return  // 过期请求丢弃
    detailData.value = data
    _giftDetails.value = data.giftDetails || []
    filterDanmaku()  // 数据就绪后刷新列表
    // 从session数据中提取hostId，用于面包屑导航
    if (data.session?.room_id && !currentHostId.value) {
      currentHostId.value = data.session.room_id
      updateBreadcrumb()
    }
    // Set initial tab
    const hasMultiAnchor = data.anchorRanking && data.anchorRanking.length > 1
    detailTab.value = hasMultiAnchor ? 'anchors' : 'gifts'
    if (data.session.is_live) startAutoRefresh()
    contentLoading.value = false
  } catch (e: any) {
    if (gen !== _viewGen) return  // 过期请求丢弃
    contentLoading.value = false
    toast('加载失败: ' + e.message, 'error')
  }
}

async function manualRefresh() {
  if (!currentSessionId.value || refreshing.value) return
  refreshing.value = true
  try {
    const data = await fetchSessionDetail(String(currentSessionId.value))
    detailData.value = data
    _giftDetails.value = data.giftDetails || []
    filterDanmaku()
    if (!data.session.is_live) stopAutoRefresh()
  } catch { /* silent */ }
  refreshing.value = false
}

// ============================================================
// AUTO-REFRESH (live sessions)
// ============================================================
let _refreshTimer: ReturnType<typeof setInterval> | null = null
const refreshing = ref(false)

let _danmakuPollTimer: ReturnType<typeof setInterval> | null = null
let _dmLastIds = new Set<string>()

function startDanmakuPoll() {
  stopDanmakuPoll()
  _dmLastIds = new Set((_danmaku.value || []).map((d: any) => d.timestamp + '_' + d.nickname))

  _danmakuPollTimer = setInterval(async () => {
    if (viewLevel.value !== 'detail' || detailTab.value !== 'danmaku' || !currentSessionId.value) return
    // 搜索模式下暂停实时更新
    if (danmakuSearchQuery.value) return
    try {
      const dmData = await fetchDanmaku(String(currentSessionId.value), 99999)
      const raw = (dmData.data || dmData || []).map((d: any) => ({
        ...d,
        timestamp: d.timestamp || d.create_time,
        avatar_url: d.avatar_url || d.avatar
      }))
      if (raw.length > 0) {
        const newItems = raw.filter((d: any) => !_dmLastIds.has(d.timestamp + '_' + d.nickname))
        if (newItems.length > 0) {
          // 更新已知 ID 集合
          newItems.forEach((d: any) => _dmLastIds.add(d.timestamp + '_' + d.nickname))
          _danmaku.value = raw  // 用完整列表替换
          filterDanmaku()      // 统一过滤逻辑
        }
      }
    } catch (e) { /* silent */ }
  }, 3000)
}

// 辅助：将原始数据转为统一格式
function buildAllItems(rawDanmaku: any[]): any[] {
  const items: any[] = []
  ;(rawDanmaku || []).forEach((d: any) => {
    items.push({
      _type: 'danmaku',
      _key: 'dm_' + (d.timestamp || d.create_time) + '_' + d.nickname,
      _ts: Number(d.timestamp || d.create_time) || 0,
      nickname: d.nickname,
      avatar_url: d.avatar_url || d.avatar,
      content: d.content || '',
      timestamp: d.timestamp || d.create_time,
      _isNew: false,
      _delay: 0,
    })
  })
  ;(_giftDetails.value || []).forEach((g: any) => {
    items.push({
      _type: 'gift',
      _key: 'gf_' + (g.create_time || g.timestamp) + '_' + g.nickname + '_' + g.gift_name,
      _ts: Number(g.create_time || g.timestamp) || 0,
      nickname: g.nickname,
      avatar_url: g.avatar || g.avatar_url,
      gift_name: g.gift_name || '',
      total_diamonds: g.total_diamonds || 0,
      to_nickname: g.to_nickname || '',
      gift_icon: g.gift_icon || null,
      timestamp: g.create_time || g.timestamp,
      _isNew: false,
      _delay: 0,
    })
  })
  items.sort((a, b) => b._ts - a._ts)
  return items
}

function stopDanmakuPoll() {
  if (_danmakuPollTimer) { clearInterval(_danmakuPollTimer); _danmakuPollTimer = null }
}

function startAutoRefresh() {
  stopAutoRefresh()
  _refreshTimer = setInterval(async () => {
    if (viewLevel.value !== 'detail' || !currentSessionId.value || refreshing.value) return
    await refreshDetail()
  }, 15000)
}

function stopAutoRefresh() {
  if (_refreshTimer) { clearInterval(_refreshTimer); _refreshTimer = null }
  stopRoomStatusPoll()
}

async function refreshDetail() {
  if (!currentSessionId.value || refreshing.value) return
  refreshing.value = true
  try {
    const data = await fetchSessionDetail(String(currentSessionId.value))
    detailData.value = data
    _giftDetails.value = data.giftDetails || []
    filterDanmaku()
    if (!data.session.is_live) stopAutoRefresh()
  } catch { /* silent */ }
  refreshing.value = false
}

// ============================================================
// DATE PICKER (from composable)
// ============================================================
const {
  dpOverlayVisible, dpData, dpTitleText, dpDaysHtml,
  dpOpen, dpClose, dpNav, dpConfirm, dpClear, clearDateFilter
} = useDatePicker()

// ============================================================
// HELPERS
// ============================================================
// ============================================================
// GLOBAL EVENT LISTENERS
// ============================================================
function handleDocClick(e: MouseEvent) {
  if (!(e.target as HTMLElement).closest('.cs-wrap')) {
    csOpen.value = ''
  }
}

// ============================================================
// INIT
// ============================================================
// Watch detailTab to render wordcloud when switching to danmaku
watch(detailTab, (tab) => {
  if (tab === "danmaku" && detailData.value) {
    nextTick(() => {
      renderWordCloud(detailData.value?.danmakuWords || [])
      // 以左侧高度为基准，右侧设置等高
      if (danmakuLeftEl.value && danmakuRightEl.value && window.innerWidth > 768) {
        danmakuRightEl.value.style.height = danmakuLeftEl.value.offsetHeight + 'px'
      }
    })
  }
})
// 监听路由变化（同一组件复用时）
watch(() => route.params, async (params) => {
  const sessionId = params.sessionId as string
  const hostId = params.hostId as string
  if (sessionId && viewLevel.value !== 'detail') {
    try { if (!rooms.value.length) rooms.value = await fetchRooms() } catch { /* ignore */ }
    viewDetail(Number(sessionId), true)
  } else if (hostId && viewLevel.value !== 'sessions') {
    try { if (!rooms.value.length) rooms.value = await fetchRooms() } catch { /* ignore */ }
    viewSessions(hostId, true)
  } else if (!sessionId && !hostId && viewLevel.value !== 'hosts') {
    viewHosts(true)
  }
})
onMounted(async () => {
  document.addEventListener('click', handleDocClick)
  // 根据路由参数导航到正确页面
  const sessionId = route.params.sessionId as string
  const hostId = route.params.hostId as string
  if (sessionId) {
    try { rooms.value = await fetchRooms() } catch { /* ignore */ }
    viewDetail(Number(sessionId), true)
  } else if (hostId) {
    try { rooms.value = await fetchRooms() } catch { /* ignore */ }
    viewSessions(hostId, true)
  } else {
    viewHosts(true)
  }
})

onUnmounted(() => {
  document.removeEventListener('click', handleDocClick)
  stopAutoRefresh()
  stopDanmakuPoll()
})

// Expose methods for child components
defineExpose({
  viewHosts,
  viewSessions,
  viewDetail,
  showConfirm,
  toast,
  openAnchorModal,
  showGiftDetail,
  esc,
  fmtTime,
  fmtNum,
  avatarHtml,
  giftEmoji,
  detailData,
  _giftDetails,
  _danmaku,
  rooms,
  summary,
  sessions,
  currentHostId,
  currentSessionId,
  viewLevel,
  topNavTab,
})
</script>
