<template>
  <div id="content" :class="{ 'content-fade-in': contentFadeIn }">
    <div v-if="contentLoading" class="loading">加载中...</div>
    <div v-else-if="detailData" class="detail-view">
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
        <button type="button" v-if="detailData.anchorRanking && detailData.anchorRanking.length > 1" class="tab-btn" :class="{ active: detailTab === 'anchors' }" @click="switchDetailTab('anchors')">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
          主播排名
        </button>
        <button type="button" class="tab-btn" :class="{ active: detailTab === 'gifts' }" @click="switchDetailTab('gifts')">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/></svg>
          礼物榜单
        </button>
        <button type="button" class="tab-btn" :class="{ active: detailTab === 'danmaku' }" @click="switchDetailTab('danmaku')">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
          弹幕
        </button>
        <button type="button" class="tab-btn" :class="{ active: detailTab === 'anon' }" @click="switchDetailTab('anon')">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>
          信息查询
        </button>
      </div>
      <!-- Live refresh bar -->
      <div v-if="detailData.session?.is_live" style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px">
        <div style="font-size:11px;color:var(--text-muted);display:flex;align-items:center;gap:4px"><span class="dot" style="width:6px;height:6px;border-radius:50%;background:var(--green);display:inline-block;animation:pulse 2s infinite"></span> 直播中 · 每15秒自动刷新</div>
        <button type="button" class="btn btn-ghost btn-sm" @click="manualRefresh" :disabled="refreshing" style="font-size:12px;padding:4px 10px;display:flex;align-items:center;gap:4px;min-width:72px;justify-content:center">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="12" height="12" :class="{ spin: refreshing }"><path d="M23 4v6h-6"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>
          刷新
        </button>
      </div>
      <!-- Anchors tab -->
      <div v-show="detailTab === 'anchors'" class="tab-panel active">
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
      <div v-show="detailTab === 'gifts'" class="tab-panel active">
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
      <div v-show="detailTab === 'danmaku'" class="tab-panel active">
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
                    <input id="danmakuSearch" aria-label="搜索弹幕" placeholder="搜索弹幕或礼物..." v-model="danmakuSearchQuery" @input="onDanmakuSearchInput">
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
                  <div v-if="danmakuLoading" style="position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;z-index:10;gap:8px;background:var(--bg)">
                    <div style="width:24px;height:24px;border:2.5px solid var(--border);border-top-color:var(--accent);border-radius:50%;animation:spin .6s linear infinite"></div>
                    <div style="font-size:12px;color:var(--text-muted)">加载中...</div>
                  </div>
                  <div id="rtDanmakuList" class="rt-danmaku-list" style="flex:1;overflow-y:auto;overflow-x:hidden" @scroll="onVsScroll">
                    <template v-if="displayedDanmaku.length > 0">
                      <template v-if="!isVscroll">
                        <div v-for="(d, idx) in displayedDanmaku" :key="d._key" class="anon-result-item dm-item" style="padding:6px 0">
                          <div style="flex-shrink:0;min-width:0" v-html="avatarHtml(d.avatar_url || d.avatar, d.nickname)"></div>
                          <div style="flex:1;min-width:0;overflow:hidden">
                            <div style="display:flex;align-items:center;gap:6px;margin-bottom:1px;min-width:0">
                              <span style="font-size:13px;font-weight:600;color:var(--text);flex-shrink:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:140px">{{ d.nickname || '匿名' }}</span>
                              <span v-if="d._type === 'gift'" style="font-size:10px;padding:1px 5px;border-radius:var(--radius-xs);background:rgba(255,107,157,0.15);color:#FF6B9D;flex-shrink:0">{{ fmtTime(d.timestamp) }}</span>
                              <span v-else style="font-size:11px;padding:1px 6px;border-radius:var(--radius-xs);background:rgba(108,140,255,0.15);color:var(--accent);flex-shrink:0">{{ fmtTime(d.timestamp) }}</span>
                            </div>
                            <div v-if="d._type === 'gift'" class="dm-gift-text">
                              送了
                              <img v-if="d.gift_icon" :src="d.gift_icon" alt="礼物图标" style="width:16px;height:16px;vertical-align:-3px;margin:0 2px;border-radius:var(--radius-xs)">
                              <svg v-else viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14" style="vertical-align:-2px;margin:0 2px"><rect x="3" y="8" width="18" height="13" rx="1"/><path d="M12 8V6c0-2-1.5-4-4-4S4 4 4 6h2"/><path d="M20 6c0-2-1.5-4-4-4s-4 2-4 4h2"/><line x1="12" y1="8" x2="12" y2="21"/><line x1="3" y1="13" x2="21" y2="13"/></svg>
                              <span style="font-weight:600">{{ d.gift_name }}</span>
                              <span v-if="d.count > 1" style="font-weight:600;margin-left:2px">×{{ d.count }}</span>
                              <span v-if="d.to_nickname" style="margin-left:4px">→ {{ d.to_nickname }}</span>
                              <span v-if="d.total_diamonds" style="margin-left:6px;font-weight:600;color:var(--orange)">
                                <svg viewBox="0 0 24 24" width="12" height="12" style="vertical-align:-2px;fill:currentColor"><path d="M6 2h12l4 7-10 13L2 9z"/><path d="M2 9h20" stroke="rgba(255,255,255,0.2)" stroke-width="0.7" fill="none"/></svg>
                                {{ d.total_diamonds.toLocaleString() }}
                              </span>
                            </div>
                            <div v-else class="dm-danmaku-text" :title="d.content" v-html="replaceDouyinEmoji(esc(d.content))"></div>
                          </div>
                        </div>
                      </template>
                      <template v-else>
                        <div :style="{ height: vsTotalH + 'px', position: 'relative', minHeight: '100%' }">
                          <div v-for="d in vsVisible" :key="d._key" class="anon-result-item dm-item"
                               :style="{ position: 'absolute', top: d._vTop + 'px', left: '8px', right: '8px', padding: '6px 0' }">
                            <div style="flex-shrink:0;min-width:0" v-html="avatarHtml(d.avatar_url || d.avatar, d.nickname)"></div>
                            <div style="flex:1;min-width:0;overflow:hidden">
                              <div style="display:flex;align-items:center;gap:6px;margin-bottom:1px;min-width:0">
                                <span style="font-size:13px;font-weight:600;color:var(--text);flex-shrink:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:140px">{{ d.nickname || '匿名' }}</span>
                                <span v-if="d._type === 'gift'" style="font-size:10px;padding:1px 5px;border-radius:var(--radius-xs);background:rgba(255,107,157,0.15);color:#FF6B9D;flex-shrink:0">{{ fmtTime(d.timestamp) }}</span>
                                <span v-else style="font-size:11px;padding:1px 6px;border-radius:var(--radius-xs);background:rgba(108,140,255,0.15);color:var(--accent);flex-shrink:0">{{ fmtTime(d.timestamp) }}</span>
                              </div>
                              <div v-if="d._type === 'gift'" class="dm-gift-text">
                                送了
                                <img v-if="d.gift_icon" :src="d.gift_icon" alt="礼物图标" style="width:16px;height:16px;vertical-align:-3px;margin:0 2px;border-radius:var(--radius-xs)">
                                <svg v-else viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14" style="vertical-align:-2px;margin:0 2px"><rect x="3" y="8" width="18" height="13" rx="1"/><path d="M12 8V6c0-2-1.5-4-4-4S4 4 4 6h2"/><path d="M20 6c0-2-1.5-4-4-4s-4 2-4 4h2"/><line x1="12" y1="8" x2="12" y2="21"/><line x1="3" y1="13" x2="21" y2="13"/></svg>
                                <span style="font-weight:600">{{ d.gift_name }}</span>
                                <span v-if="d.count > 1" style="font-weight:600;margin-left:2px">×{{ d.count }}</span>
                                <span v-if="d.to_nickname" style="margin-left:4px">→ {{ d.to_nickname }}</span>
                                <span v-if="d.total_diamonds" style="margin-left:6px;font-weight:600;color:var(--orange)">
                                  <svg viewBox="0 0 24 24" width="12" height="12" style="vertical-align:-2px;fill:currentColor"><path d="M6 2h12l4 7-10 13L2 9z"/><path d="M2 9h20" stroke="rgba(255,255,255,0.2)" stroke-width="0.7" fill="none"/></svg>
                                  {{ d.total_diamonds.toLocaleString() }}
                                </span>
                              </div>
                              <div v-else class="dm-danmaku-text" :title="d.content" v-html="replaceDouyinEmoji(esc(d.content))"></div>
                            </div>
                          </div>
                        </div>
                      </template>
                    </template>
                    <div v-else-if="!danmakuLoading" class="empty" style="padding:40px 20px;display:flex;flex-direction:column;align-items:center;justify-content:center;width:100%;flex:1;min-height:180px">
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
      <div v-show="detailTab === 'anon'" class="tab-panel active">
        <div class="detail-section">
          <div style="font-size:13px;font-weight:600;color:var(--text);margin-bottom:10px;display:flex;align-items:center;gap:6px">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>
            信息查询
          </div>
          <div style="font-size:12px;color:var(--text-muted);margin-bottom:14px">输入关键词，查询本场次相关的送礼或弹幕记录</div>
          <div class="anon-input-row">
            <input id="anonInput" aria-label="匿名查询" v-model="anonQuery" placeholder="输入关键词（昵称/礼物名/弹幕内容）..." @keydown.enter="queryAnonymous">
            <button type="button" class="btn btn-ghost btn-sm" @click="queryAnonymous" style="border-color:var(--border)">查询</button>
          </div>
          <div id="anonResult" class="anon-result" style="display:none" :style="anonMatches.length > 0 || anonSearched ? {display:'block'} : {}">
            <div v-if="anonMatches.length === 0 && anonSearched" class="empty" style="padding:20px">未找到匹配 "{{ anonQuery }}" 的记录</div>
            <div v-if="anonLoading" class="loading" style="padding:20px;min-height:0"></div>
            <div v-if="anonMatches.length > 0" style="font-size:12px;color:var(--text-muted);margin-bottom:10px">找到 <strong style="color:var(--text)">{{ anonMatches.length }}</strong> 条匹配记录</div>
            <div v-for="(m, idx) in anonMatches" :key="idx" class="anon-result-item" style="animation:fadeIn .3s ease">
              <div style="flex-shrink:0">
                <img v-if="m.avatar" :src="m.avatar" alt="用户头像" class="avatar" style="width:32px;height:32px" @error="$event.target.style.display='none'">
                <div v-else class="avatar" style="width:32px;height:32px;display:flex;align-items:center;justify-content:center;font-size:13px;color:var(--text-muted)">{{ (m.nickname || '?')[0] }}</div>
              </div>
              <div style="flex:1;min-width:0">
                <div style="display:flex;align-items:center;gap:8px;margin-bottom:2px">
                  <span style="font-size:13px;font-weight:600;color:var(--text)">{{ m.nickname || '匿名' }}</span>
                  <span style="font-size:11px;padding:1px 6px;border-radius:var(--radius-xs)" :style="{ background: m.type === '礼物' ? 'rgba(251,146,60,0.15)' : 'rgba(108,140,255,0.15)', color: m.type === '礼物' ? 'var(--orange)' : 'var(--accent)' }">{{ m.type }}</span>
                </div>
                <div style="font-size:12px;color:var(--text-muted);line-height:1.6" :title="m.content || ''">
                  <template v-if="m.type === '礼物'">
                    <img v-if="m.giftIcon" :src="m.giftIcon" alt="礼物图标" style="width:16px;height:16px;vertical-align:-3px;margin-right:2px;border-radius:var(--radius-xs)">
                    <svg v-else viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14" style="vertical-align:-2px;margin-right:2px"><rect x="3" y="8" width="18" height="13" rx="1"/><path d="M12 8V6c0-2-1.5-4-4-4S4 4 4 6h2"/><path d="M20 6c0-2-1.5-4-4-4s-4 2-4 4h2"/><line x1="12" y1="8" x2="12" y2="21"/><line x1="3" y1="13" x2="21" y2="13"/></svg>
                    <span style="color:var(--text)">{{ m.displayText }}</span>
                    <span v-if="m.diamonds" style="margin-left:6px;font-weight:600;color:var(--orange)">
                      <svg viewBox="0 0 24 24" width="12" height="12" style="vertical-align:-2px;fill:currentColor"><path d="M6 2h12l4 7-10 13L2 9z"/><path d="M2 9h20" stroke="rgba(255,255,255,0.2)" stroke-width="0.7" fill="none"/><path d="M12 22l-4-13h8z" fill="rgba(0,0,0,0.1)"/></svg>
                      {{ m.diamonds.toLocaleString() }}
                    </span>
                    <span v-if="m.to_nickname" style="margin-left:6px;color:var(--accent)">→ {{ m.to_nickname }}</span>
                  </template>
                  <template v-else>
                    <span v-html="replaceDouyinEmoji(esc(m.displayText))"></span>
                  </template>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>

  <!-- ANCHOR GIFTS MODAL -->
  <div id="anchorModal" class="anchor-modal-overlay" :class="{ show: anchorModalVisible }" @click.self="closeAnchorModal">
    <div class="anchor-modal">
      <div class="anchor-modal-header">
        <h3 id="anchorModalTitle">{{ anchorModalTitle }}</h3>
        <button type="button" class="anchor-modal-close" @click="closeAnchorModal">
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
        <button type="button" class="anchor-modal-close" @click="closeGiftDetailModal">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
      </div>
      <div class="anchor-modal-body" id="giftDetailBody" v-html="giftDetailBody"></div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, nextTick, watch } from 'vue'
import { useRouter, useRoute, onBeforeRouteUpdate } from 'vue-router'
import { storeToRefs } from 'pinia'
import { useAppStore } from '../stores/app'
import { fetchSessionDetail, fetchDanmaku, fetchRooms } from '../api'
import { esc, fmtTime, formatDuration, avatarHtml, giftEmoji } from '../utils/format'
import { replaceDouyinEmoji } from '../utils/douyin-emoji'
import { useToast } from '../composables/useToast'
import { useConfirm } from '../composables/useConfirm'
import { renderWordCloud } from '../utils/wordcloud'
import AvatarFallback from '../components/AvatarFallback.vue'

const store = useAppStore()
const router = useRouter()
const route = useRoute()
const {
  contentLoading, contentFadeIn, viewLevel,
  detailData, _danmaku, _giftDetails, detailTab,
  danmakuSearchQuery, displayedDanmaku, danmakuDisplayLimit, danmakuLoading,
  anonQuery, anonMatches, anonSearched, anonLoading,
  currentSessionId, currentHostId, rooms, sessions,
} = storeToRefs(store)
const { toast } = useToast()
const { showConfirm } = useConfirm()

// Prevent 0-flash: set loading + reset data before first render (onMounted runs after first paint)
contentLoading.value = true
contentFadeIn.value = false
detailData.value = null

// ============================================================
// LOCAL STATE
// ============================================================
const refreshing = ref(false)
const dmLimitOpen = ref(false)
const anchorModalVisible = ref(false)
const anchorModalTitle = ref('主播榜')
const anchorModalBody = ref('')
const giftDetailModalVisible = ref(false)
const giftDetailTitle = ref('礼物明细')
const giftDetailBody = ref('')

// Virtual scroll
const isVscroll = computed(() => danmakuDisplayLimit.value === 0)
const VS_ITEM_H = 52
const VS_BUFFER = 10
const vsScrollTop = ref(0)
const vsContainerH = ref(500)
const vsTotalH = computed(() => isVscroll.value ? displayedDanmaku.value.length * VS_ITEM_H : 0)
const vsVisible = computed(() => {
  if (!isVscroll.value) return []
  const items = displayedDanmaku.value
  if (!items.length) return []
  const start = Math.max(0, Math.floor(vsScrollTop.value / VS_ITEM_H) - VS_BUFFER)
  const visCount = Math.ceil(vsContainerH.value / VS_ITEM_H)
  const end = Math.min(items.length, start + visCount + VS_BUFFER * 2)
  return items.slice(start, end).map((item: any, i: number) => ({
    ...item,
    _vTop: (start + i) * VS_ITEM_H
  }))
})

const _rankChanged = ref(new Set<string>())
const danmakuLeftEl = ref<HTMLElement | null>(null)
const danmakuRightEl = ref<HTMLElement | null>(null)
let _prevRanking: string[] = []

// Timers
let _refreshTimer: ReturnType<typeof setInterval> | null = null
let _danmakuPollTimer: ReturnType<typeof setInterval> | null = null
let _dmLastIds = new Set<string>()
let _dmNewQueue: any[] = []
let _dmFlushTimer: ReturnType<typeof setInterval> | null = null
let _dmSearchTimer: ReturnType<typeof setTimeout> | null = null
let _resizeObs: ResizeObserver | null = null

// ============================================================
// NAVIGATION
// ============================================================
function setupNav() {
  const sessionId = currentSessionId.value
  const host = rooms.value.find(h => h.room_id === currentHostId.value)
  const sess = sessions.value.find(s => s.id === sessionId)
  const sessionTitle = sess?.title || detailData.value?.session?.room_title || `场次 ${sessionId}`
  const hostName = host?.name || ''

  viewLevel.value = 'detail'
  store.pageTitle = sessionTitle
  store.showBackBtn = true
  store.showTopNav = false
  store.breadcrumbItems = [
    { label: '房间管理', onClick: () => router.push({ name: 'hosts' }) },
    { label: hostName, onClick: () => currentHostId.value && router.push({ name: 'sessions', params: { hostId: currentHostId.value } }) },
    { label: sessionTitle }
  ]
}

// ============================================================
// TAB SWITCHING
// ============================================================
function switchDetailTab(tab: string) {
  detailTab.value = tab
  if ((tab === 'danmaku' || tab === 'anon') && (!_danmaku.value || !_danmaku.value.length)) {
    loadDanmakuData().then(() => {
      if (tab === 'danmaku') startDanmakuPoll()
    })
  } else if (tab === 'danmaku') {
    startDanmakuPoll()
  } else stopDanmakuPoll()
}

// ============================================================
// DANMAKU
// ============================================================
function onDanmakuSearchInput() {
  if (_dmSearchTimer) clearTimeout(_dmSearchTimer)
  _dmSearchTimer = setTimeout(() => filterDanmaku(), 200)
}

watch(danmakuDisplayLimit, () => {
  displayedDanmaku.value = []
  danmakuLoading.value = true
  setTimeout(() => {
    filterDanmaku()
    danmakuLoading.value = false
  }, 200)
})

function onVsScroll(e: Event) {
  if (!isVscroll.value) return
  vsScrollTop.value = (e.target as HTMLElement).scrollTop
}

function measureVsContainer() {
  const el = document.getElementById('rtDanmakuList')
  if (el) vsContainerH.value = el.clientHeight
}

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
  _dmNewQueue = []
  if (_dmFlushTimer) { clearInterval(_dmFlushTimer); _dmFlushTimer = null }
  const q = danmakuSearchQuery.value.toLowerCase()

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
      count: g.count || 0,
      total_diamonds: g.total_diamonds || 0,
      to_nickname: g.to_nickname || '',
      gift_icon: g.gift_icon || null,
      timestamp: g.create_time || g.timestamp,
    })
  })

  allItems.sort((a, b) => a._ts - b._ts)

  let result: any[]
  if (q) {
    result = allItems.filter((d: any) => {
      const content = d._type === 'gift' ? d.gift_name : (d.content || '')
      return content.toLowerCase().includes(q) || (d.nickname || '').toLowerCase().includes(q)
    })
  } else {
    const limit = danmakuDisplayLimit.value
    result = limit ? allItems.slice(-limit) : allItems
  }

  displayedDanmaku.value = result
  if (isVscroll.value) {
    const totalH = result.length * VS_ITEM_H
    vsScrollTop.value = Math.max(0, totalH - vsContainerH.value)
    nextTick(() => {
      measureVsContainer()
      const list = document.getElementById('rtDanmakuList')
      if (list) {
        vsScrollTop.value = Math.max(0, list.scrollHeight - list.clientHeight)
        list.scrollTop = list.scrollHeight
      }
    })
  } else {
    const list = document.getElementById('rtDanmakuList')
    if (list) {
      requestAnimationFrame(() => { list.scrollTop = list.scrollHeight })
    }
  }
}

async function loadDanmakuData() {
  if (!currentSessionId.value) return
  displayedDanmaku.value = []
  danmakuLoading.value = true
  try {
    const dmData = await fetchDanmaku(String(currentSessionId.value))
    const raw = dmData.data || dmData || []
    _danmaku.value = raw.map((d: any) => ({
      ...d,
      timestamp: d.timestamp || d.create_time,
      avatar_url: d.avatar_url || d.avatar
    }))
    filterDanmaku()
  } catch { _danmaku.value = [] }
  danmakuLoading.value = false
}

// ============================================================
// ANON QUERY (detail tab)
// ============================================================
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
    } catch { /* ignore */ }
    anonLoading.value = false
  }
  const qLower = q.toLowerCase()
  const matches: any[] = []
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

// ============================================================
// MODALS
// ============================================================
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

function closeGiftDetailModal() { giftDetailModalVisible.value = false }

function showGiftDetail(nickname: string, secUid: string) {
  const details = (_giftDetails.value || []).filter((d: any) => secUid ? d.user_sec_uid === secUid : d.nickname === nickname)
  if (!details.length) return
  const totalD = details.reduce((s: number, d: any) => s + d.total_diamonds, 0)
  giftDetailTitle.value = nickname + ' 的礼物'
  let html = `<div class="anchor-modal-summary"><span><svg viewBox="0 0 24 24" width="12" height="12" style="vertical-align:-2px;fill:var(--orange)"><path d="M6 2h12l4 7-10 13L2 9z"/><path d="M2 9h20" stroke="rgba(255,255,255,0.2)" stroke-width="0.7" fill="none"/><path d="M12 22l-4-13h8z" fill="rgba(0,0,0,0.1)"/></svg> <span class="sv">${totalD.toLocaleString()}</span></span><span>${details.length} 种礼物</span></div>`
  html += '<div style="display:flex;flex-direction:column;gap:6px">'
  details.forEach((d: any) => {
    const icon = d.gift_icon ? `<img src="${esc(d.gift_icon)}" alt="礼物图标" class="gdi-icon">` : '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="gdi-icon" style="padding:2px;box-sizing:border-box"><rect x="3" y="8" width="18" height="13" rx="1"/><path d="M12 8V6c0-2-1.5-4-4-4S4 4 4 6h2"/><path d="M20 6c0-2-1.5-4-4-4s-4 2-4 4h2"/><line x1="12" y1="8" x2="12" y2="21"/><line x1="3" y1="13" x2="21" y2="13"/></svg>'
    const to = d.to_nickname ? `<span class="gdi-to">→ ${esc(d.to_nickname)}</span>` : ''
    html += `<div class="gift-detail-item">${icon}<span class="gdi-name">${esc(d.gift_name)} ×${d.count}</span>${to}<span class="gdi-diamonds"><svg viewBox="0 0 24 24" width="12" height="12" style="margin-right:2px;fill:currentColor"><path d="M6 2h12l4 7-10 13L2 9z"/><path d="M2 9h20" stroke="rgba(255,255,255,0.2)" stroke-width="0.7" fill="none"/><path d="M12 22l-4-13h8z" fill="rgba(0,0,0,0.1)"/></svg>${d.total_diamonds.toLocaleString()}</span></div>`
  })
  html += '</div>'
  giftDetailBody.value = html
  giftDetailModalVisible.value = true
}

// ============================================================
// AUTO-REFRESH (live sessions)
// ============================================================
function startAutoRefresh() {
  stopAutoRefresh()
  _refreshTimer = setInterval(async () => {
    if (!currentSessionId.value || refreshing.value) return
    await refreshDetail()
  }, 15000)
}

function stopAutoRefresh() {
  if (_refreshTimer) { clearInterval(_refreshTimer); _refreshTimer = null }
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

async function manualRefresh() {
  if (!currentSessionId.value || refreshing.value) return
  refreshing.value = true
  try {
    const data = await fetchSessionDetail(String(currentSessionId.value))
    const avatars: string[] = []
    if (data.anchorRanking) data.anchorRanking.forEach((a: any) => { if (a.anchor_avatar) avatars.push(a.anchor_avatar) })
    if (data.gifts) data.gifts.forEach((g: any) => { if (g.avatar_url) avatars.push(g.avatar_url) })
    if (data.danmakuRanking) data.danmakuRanking.forEach((d: any) => { if (d.avatar) avatars.push(d.avatar) })
    await Promise.all(avatars.map(url => new Promise<void>(resolve => {
      const img = new Image()
      img.onload = img.onerror = () => resolve()
      img.src = url
    })))
    detailData.value = data
    _giftDetails.value = data.giftDetails || []
    filterDanmaku()
    if (!data.session.is_live) stopAutoRefresh()
  } catch { /* silent */ }
  refreshing.value = false
}

// ============================================================
// DANMAKU POLLING
// ============================================================
function _flushDanmakuQueue() {
  if (!_dmNewQueue.length) { if (_dmFlushTimer) { clearInterval(_dmFlushTimer); _dmFlushTimer = null }; return }
  const item = _dmNewQueue.shift()!
  displayedDanmaku.value = [...displayedDanmaku.value, item]
  const list = document.getElementById('rtDanmakuList')
  if (list) {
    const atBottom = list.scrollHeight - list.scrollTop - list.clientHeight < 100
    if (atBottom) requestAnimationFrame(() => { list.scrollTop = list.scrollHeight })
  }
}

function startDanmakuPoll() {
  stopDanmakuPoll()
  _dmLastIds = new Set((_danmaku.value || []).map((d: any) => d.timestamp + '_' + d.nickname))
  _danmakuPollTimer = setInterval(async () => {
    if (detailTab.value !== 'danmaku' || !currentSessionId.value) return
    if (danmakuSearchQuery.value) return
    if (_dmNewQueue.length > 0) return
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
          newItems.forEach((d: any) => _dmLastIds.add(d.timestamp + '_' + d.nickname))
          _danmaku.value = raw
          _dmNewQueue.push(...newItems)
          if (!_dmFlushTimer) _dmFlushTimer = setInterval(_flushDanmakuQueue, 200)
        }
      }
    } catch { /* ignore */ }
  }, 10000)
}

function stopDanmakuPoll() {
  if (_danmakuPollTimer) { clearInterval(_danmakuPollTimer); _danmakuPollTimer = null }
  if (_dmFlushTimer) { clearInterval(_dmFlushTimer); _dmFlushTimer = null }
  _dmNewQueue = []
}

// ============================================================
// LAYOUT HELPERS
// ============================================================
function syncDanmakuHeight() {
  if (danmakuLeftEl.value && danmakuRightEl.value && window.innerWidth > 768) {
    danmakuRightEl.value.style.height = danmakuLeftEl.value.offsetHeight + 'px'
  }
}

function handleDocClick(e: MouseEvent) {
  if (!(e.target as HTMLElement).closest('.dm-limit-select')) {
    dmLimitOpen.value = false
  }
}

// ============================================================
// WATCHES
// ============================================================
watch(detailTab, (tab) => {
  if (tab === "danmaku" && detailData.value) {
    nextTick(() => {
      renderWordCloud(detailData.value?.danmakuWords || [])
      syncDanmakuHeight()
    })
  }
})

watch(displayedDanmaku, () => {
  if (detailTab.value === 'danmaku' && window.innerWidth > 768) {
    nextTick(syncDanmakuHeight)
  }
})

watch(detailTab, (tab) => {
  if (tab === 'danmaku' && window.innerWidth > 768) {
    nextTick(() => {
      if (_resizeObs) _resizeObs.disconnect()
      if (danmakuLeftEl.value) {
        _resizeObs = new ResizeObserver(() => syncDanmakuHeight())
        _resizeObs.observe(danmakuLeftEl.value)
      }
    })
  } else if (_resizeObs) {
    _resizeObs.disconnect()
    _resizeObs = null
  }
}, { immediate: true })

// ============================================================
// LIFECYCLE
// ============================================================
// FIX: 提取数据加载逻辑，供 onMounted 和 onBeforeRouteUpdate 复用
async function loadDetail(sessionId: number) {
  // Reset state
  detailTab.value = 'gifts'
  detailData.value = null
  _danmaku.value = []
  displayedDanmaku.value = []
  danmakuSearchQuery.value = ''
  danmakuDisplayLimit.value = 50
  anonQuery.value = ''
  anonMatches.value = []; anonSearched.value = false; anonLoading.value = false; danmakuLoading.value = false
  stopAutoRefresh()
  stopDanmakuPoll()

  // Ensure rooms loaded (for breadcrumb host name)
  if (!rooms.value.length) {
    try { rooms.value = await fetchRooms() } catch { /* ignore */ }
  }

  setupNav()
  contentLoading.value = true
  contentFadeIn.value = false
  try {
    const data = await fetchSessionDetail(String(sessionId))
    // Preload avatars
    const avatars: string[] = []
    if (data.anchorRanking) data.anchorRanking.forEach((a: any) => { if (a.anchor_avatar) avatars.push(a.anchor_avatar) })
    if (data.gifts) data.gifts.forEach((g: any) => { if (g.avatar_url) avatars.push(g.avatar_url) })
    if (data.danmakuRanking) data.danmakuRanking.forEach((d: any) => { if (d.avatar) avatars.push(d.avatar) })
    await Promise.all(avatars.map(url => new Promise<void>(resolve => {
      const img = new Image()
      img.onload = img.onerror = () => resolve()
      img.src = url
    })))
    detailData.value = data
    _giftDetails.value = data.giftDetails || []
    filterDanmaku()
    // Extract hostId from session data for breadcrumb
    if (data.session?.room_id) {
      currentHostId.value = data.session.room_id
      setupNav()
    }
    const hasMultiAnchor = data.anchorRanking && data.anchorRanking.length > 1
    detailTab.value = hasMultiAnchor ? 'anchors' : 'gifts'
    if (data.session.is_live) startAutoRefresh()
    contentLoading.value = false
    contentFadeIn.value = true
  } catch (e: any) {
    contentLoading.value = false
    contentFadeIn.value = true
    toast('加载失败: ' + e.message, 'error')
  }
}

onMounted(async () => {
  const sessionId = Number(route.params.sessionId)
  currentSessionId.value = sessionId
  await loadDetail(sessionId)

  document.addEventListener('click', handleDocClick)
  nextTick(() => measureVsContainer())
})

// FIX: 同路由不同参数切换时重新加载数据（如 /detail/123 → /detail/456）
// 没有此钩子时，组件复用不会重新触发 onMounted，导致数据不刷新
onBeforeRouteUpdate(async (to) => {
  const sessionId = Number(to.params.sessionId)
  currentSessionId.value = sessionId
  await loadDetail(sessionId)
})

onUnmounted(() => {
  document.removeEventListener('click', handleDocClick)
  stopAutoRefresh()
  stopDanmakuPoll()
  if (_resizeObs) { _resizeObs.disconnect(); _resizeObs = null }
})
</script>

<style scoped>
.dm-gift-text {
  font-size: 12px;
  color: #FF6B9D;
  word-break: break-all;
  line-height: 1.5;
}
.dm-danmaku-text {
  font-size: 12px;
  color: var(--text-muted);
  word-break: break-all;
  line-height: 1.5;
  overflow: hidden;
  text-overflow: ellipsis;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
}
</style>
