<template>
  <div>
    <!-- Stats Row -->
    <div class="stats-row" v-if="data">
      <div class="stat-card">
        <div class="stat-label">峰值在线</div>
        <div class="stat-value">{{ (data.session.online_peak || 0).toLocaleString() }}</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">总钻石</div>
        <div class="stat-value">{{ data.summary.total_diamonds.toLocaleString() }}</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">点赞</div>
        <div class="stat-value">{{ (data.session.stats_like || 0).toLocaleString() }}</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">弹幕</div>
        <div class="stat-value">{{ data.summary.danmaku_count.toLocaleString() }}</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">用户</div>
        <div class="stat-value">{{ data.summary.user_count.toLocaleString() }}</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">时长</div>
        <div class="stat-value">{{ data.session.duration_min != null ? formatDuration(data.session.duration_min) : '进行中' }}</div>
      </div>
    </div>

    <!-- Tab Bar -->
    <div class="tab-bar" id="tabBar" v-if="data">
      <button
        v-if="hasMultiAnchor"
        class="tab-btn"
        :class="{ active: activeTab === 'anchors' }"
        @click="switchTab('anchors')"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14">
          <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/>
          <circle cx="9" cy="7" r="4"/>
          <path d="M23 21v-2a4 4 0 0 0-3-3.87"/>
          <path d="M16 3.13a4 4 0 0 1 0 7.75"/>
        </svg>
        主播排名
      </button>
      <button
        class="tab-btn"
        :class="{ active: activeTab === 'gifts' }"
        @click="switchTab('gifts')"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14">
          <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/>
        </svg>
        礼物榜单
      </button>
      <button
        class="tab-btn"
        :class="{ active: activeTab === 'danmaku' }"
        @click="switchTab('danmaku')"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14">
          <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
        </svg>
        弹幕
      </button>
      <button
        class="tab-btn"
        :class="{ active: activeTab === 'anon' }"
        @click="switchTab('anon')"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14">
          <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
        </svg>
        信息查询
      </button>
      <button
        v-if="data.has_report"
        class="tab-btn"
        :class="{ active: activeTab === 'report' }"
        @click="switchTab('report')"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14">
          <rect x="3" y="3" width="18" height="18" rx="2"/>
          <circle cx="8.5" cy="8.5" r="1.5"/>
          <path d="M21 15l-5-5L5 21"/>
        </svg>
        报告
      </button>
    </div>

    <!-- Live Refresh Button -->
    <div v-if="data && data.session.is_live" style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px">
      <div style="font-size:11px;color:var(--text-muted);display:flex;align-items:center;gap:4px">
        <span class="dot" style="width:6px;height:6px;border-radius:50%;background:var(--green);display:inline-block;animation:pulse 2s infinite"></span>
        直播中 · 每15秒自动刷新
      </div>
      <button ref="refreshBtnEl" class="btn btn-ghost btn-sm" @click="manualRefresh" :disabled="refreshing" style="font-size:12px;padding:4px 10px;display:flex;align-items:center;gap:4px;min-width:72px;justify-content:center">
        <svg ref="refreshSvgEl" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="12" height="12">
          <path d="M23 4v6h-6"/>
          <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/>
        </svg>
        刷新
      </button>
    </div>

    <!-- Tab Panels -->
    <template v-if="data">
      <!-- Anchors Panel -->
      <div class="tab-panel" :class="{ active: activeTab === 'anchors' }" id="panel-anchors">
        <div v-if="!data.anchorRanking || data.anchorRanking.length === 0" class="empty" style="padding:40px">
          <div class="empty-icon">—</div>
          暂无主播数据
        </div>
        <template v-else>
          <div style="font-size:13px;font-weight:600;color:var(--text);margin-bottom:10px;display:flex;align-items:center;gap:6px">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14">
              <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/>
              <circle cx="9" cy="7" r="4"/>
              <path d="M23 21v-2a4 4 0 0 0-3-3.87"/>
              <path d="M16 3.13a4 4 0 0 1 0 7.75"/>
            </svg>
            主播排名
          </div>
          <div class="anchor-grid">
            <div
              v-for="(a, i) in data.anchorRanking"
              :key="i"
              class="anchor-card"
              @click="openAnchorModal(a.anchor_name)"
            >
              <div class="anchor-card-rank">{{ String(i + 1).padStart(2, '0') }}</div>
              <div class="anchor-card-header">
                <div class="anchor-card-avatar">
                  <img v-if="a.anchor_avatar" :src="a.anchor_avatar" alt="" @error="e => e.target.style.display='none'">
                  <svg v-else viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="18" height="18">
                    <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/>
                    <circle cx="9" cy="7" r="4"/>
                  </svg>
                </div>
                <div class="anchor-card-name">{{ a.anchor_name }}</div>
              </div>
              <div class="anchor-card-stats">
                <div class="stat">
                  <svg viewBox="0 0 24 24" width="12" height="12" style="vertical-align:-2px;fill:currentColor">
                    <path d="M6 2h12l4 7-10 13L2 9z"/>
                    <path d="M2 9h20" stroke="rgba(255,255,255,0.2)" stroke-width="0.7" fill="none"/>
                    <path d="M12 22l-4-13h8z" fill="rgba(0,0,0,0.1)"/>
                  </svg>
                  <span class="stat-val">{{ a.total_diamonds.toLocaleString() }}</span>
                </div>
                <div class="stat">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="12" height="12" style="vertical-align:-2px">
                    <rect x="3" y="8" width="18" height="13" rx="1"/>
                    <path d="M12 8V6c0-2-1.5-4-4-4S4 4 4 6h2"/>
                    <path d="M20 6c0-2-1.5-4-4-4s-4 2-4 4h2"/>
                    <line x1="12" y1="8" x2="12" y2="21"/>
                    <line x1="3" y1="13" x2="21" y2="13"/>
                  </svg>
                  <span class="stat-val">{{ a.gift_count.toLocaleString() }}</span>
                </div>
                <div class="stat">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="12" height="12" style="vertical-align:-2px">
                    <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/>
                    <circle cx="12" cy="7" r="4"/>
                  </svg>
                  <span class="stat-val">{{ a.user_count }}</span>
                </div>
              </div>
            </div>
          </div>
        </template>
      </div>

      <!-- Gifts Panel -->
      <div class="tab-panel" :class="{ active: activeTab === 'gifts' }" id="panel-gifts">
        <div v-if="!data.gifts || data.gifts.length === 0" class="empty" style="padding:40px">
          <div class="empty-icon">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="12" height="12" style="vertical-align:-2px">
              <rect x="3" y="8" width="18" height="13" rx="1"/>
              <path d="M12 8V6c0-2-1.5-4-4-4S4 4 4 6h2"/>
              <path d="M20 6c0-2-1.5-4-4-4s-4 2-4 4h2"/>
              <line x1="12" y1="8" x2="12" y2="21"/>
              <line x1="3" y1="13" x2="21" y2="13"/>
            </svg>
          </div>
          暂无礼物数据
        </div>
        <template v-else>
          <div style="font-size:13px;font-weight:600;color:var(--text);margin-bottom:10px;display:flex;align-items:center;gap:6px">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14">
              <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/>
            </svg>
            礼物榜单
          </div>
          <div class="gift-rank-grid">
            <div
              v-for="(g, i) in data.gifts"
              :key="i"
              class="gift-rank-card"
              @click="showGiftDetail(g.nickname, g.user_sec_uid)"
            >
              <div class="gift-rank-card-top">
                <span class="gift-rank-num">{{ String(i + 1).padStart(2, '0') }}</span>
                <div class="user-cell">
                  <template v-if="g.avatar_url">
                    <div class="avatar">
                      <img :src="g.avatar_url" alt="" @error="e => e.target.parentElement.innerHTML = (g.nickname || '?')[0]">
                    </div>
                  </template>
                  <template v-else>
                    <div class="avatar" style="display:flex;align-items:center;justify-content:center;font-size:13px;color:var(--text-muted)">
                      {{ (g.nickname || '?')[0] }}
                    </div>
                  </template>
                  <span>{{ g.nickname }}</span>
                </div>
                <div class="diamonds">
                  <svg viewBox="0 0 24 24" width="12" height="12" style="vertical-align:-2px;margin-right:2px;fill:currentColor">
                    <path d="M6 2h12l4 7-10 13L2 9z"/>
                    <path d="M2 9h20" stroke="rgba(255,255,255,0.2)" stroke-width="0.7" fill="none"/>
                    <path d="M12 22l-4-13h8z" fill="rgba(0,0,0,0.1)"/>
                  </svg>
                  {{ g.total_diamonds.toLocaleString() }}
                </div>
              </div>
            </div>
          </div>
        </template>
      </div>

      <!-- Danmaku Panel -->
      <div class="tab-panel" :class="{ active: activeTab === 'danmaku' }" id="panel-danmaku">
        <div class="detail-section">
          <div id="danmakuGrid" style="display:grid;grid-template-columns:340px 1fr;gap:14px;align-items:start">
            <!-- Left: rank -->
            <div ref="danmakuLeftEl" style="min-width:0">
              <div style="font-size:13px;font-weight:600;color:var(--text);margin-bottom:10px;display:flex;align-items:center;gap:6px">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14">
                  <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/>
                  <circle cx="9" cy="7" r="4"/>
                  <path d="M23 21v-2a4 4 0 0 0-3-3.87"/>
                  <path d="M16 3.13a4 4 0 0 1 0 7.75"/>
                </svg>
                弹幕排行
              </div>
              <div class="danmaku-user-rank-list">
                <div v-if="!data.danmakuRanking || data.danmakuRanking.length === 0" class="empty" style="padding:20px">
                  暂无弹幕数据
                </div>
                <div
                  v-for="(d, i) in (data.danmakuRanking || []).slice(0, 10)"
                  :key="i"
                  class="danmaku-user-rank"
                >
                  <span class="rank-num" :class="{ top3: i < 3 }">{{ String(i + 1).padStart(2, '0') }}</span>
                  <div class="user-cell">
                    <template v-if="d.avatar">
                      <div class="avatar">
                        <img :src="d.avatar" alt="" @error="e => e.target.parentElement.innerHTML = (d.nickname || '?')[0]">
                      </div>
                    </template>
                    <template v-else>
                      <div class="avatar" style="display:flex;align-items:center;justify-content:center;font-size:13px;color:var(--text-muted)">
                        {{ (d.nickname || '?')[0] }}
                      </div>
                    </template>
                    <span style="font-size:13px">{{ d.nickname }}</span>
                  </div>
                  <div class="msg-count">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="12" height="12" style="vertical-align:middle;margin-right:2px">
                      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
                    </svg>
                    {{ d.msg_count.toLocaleString() }}条
                  </div>
                </div>
              </div>
            </div>

            <!-- Right: wordcloud + danmaku list -->
            <div ref="danmakuRightEl" style="display:flex;flex-direction:column;min-width:0">
              <div style="margin-bottom:14px">
                <div style="font-size:13px;font-weight:600;color:var(--text);margin-bottom:10px;display:flex;align-items:center;gap:6px">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14">
                    <path d="M18 10h-1.26A8 8 0 1 0 9 20h9a5 5 0 0 0 0-10z"/>
                  </svg>
                  弹幕词云
                </div>
                <canvas ref="wordcloudCanvas" class="wordcloud-canvas"></canvas>
              </div>
              <div style="flex:1;min-height:0;display:flex;flex-direction:column">
                <div id="dmTotalBadge" style="font-size:13px;font-weight:600;color:var(--text);margin-bottom:10px;display:flex;align-items:center;gap:6px">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14">
                    <path d="M22 12h-4l-3 9L9 3l-3 9H2"/>
                  </svg>
                  {{ danmakuBadge }}
                </div>
                <div class="search-wrap" style="margin-bottom:8px;flex-shrink:0">
                  <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5">
                    <circle cx="7" cy="7" r="5"/>
                    <path d="M11 11l3 3"/>
                  </svg>
                  <input
                    v-model="danmakuSearchText"
                    placeholder="搜索弹幕内容或用户..."
                    @input="onDanmakuSearch"
                  >
                </div>
                <div id="rtDanmakuWrap" class="rt-danmaku-wrap" style="flex:1;display:flex;flex-direction:column;overflow:hidden">
                  <div id="rtDanmakuList" class="rt-danmaku-list" style="flex:1;min-height:315px;overflow-y:auto;overflow-x:hidden">
                    <div v-if="danmakuLoading" class="empty" style="padding:40px 20px;display:flex;flex-direction:column;align-items:center;justify-content:center;height:100%;min-height:180px">
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" width="32" height="32" style="margin-bottom:10px;opacity:0.3">
                        <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
                      </svg>
                      <div style="color:var(--text-muted);font-size:13px">加载中...</div>
                    </div>
                    <div v-else-if="filteredDanmaku.length === 0" class="empty" style="padding:40px 20px;display:flex;flex-direction:column;align-items:center;justify-content:center;width:100%;flex:1;min-height:180px">
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" width="32" height="32" style="margin-bottom:10px;opacity:0.3">
                        <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
                      </svg>
                      <div style="color:var(--text-muted);font-size:13px">{{ danmakuSearchText ? '无匹配弹幕' : '暂时没有弹幕' }}</div>
                    </div>
                    <template v-else>
                      <div
                        v-for="(d, i) in filteredDanmaku"
                        :key="i"
                        class="anon-result-item"
                        style="padding:6px 0;animation:fadeIn .3s ease"
                      >
                        <div style="flex-shrink:0;min-width:0">
                          <template v-if="d.avatar_url">
                            <div class="avatar">
                              <img :src="d.avatar_url" alt="" @error="e => e.target.parentElement.innerHTML = (d.nickname || '?')[0]">
                            </div>
                          </template>
                          <template v-else>
                            <div class="avatar" style="display:flex;align-items:center;justify-content:center;font-size:13px;color:var(--text-muted)">
                              {{ (d.nickname || '?')[0] }}
                            </div>
                          </template>
                        </div>
                        <div style="flex:1;min-width:0;overflow:hidden">
                          <div style="display:flex;align-items:center;gap:6px;margin-bottom:1px;min-width:0">
                            <span style="font-size:13px;font-weight:600;color:var(--text);flex-shrink:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:140px">{{ d.nickname || '匿名' }}</span>
                            <span style="font-size:11px;padding:1px 6px;border-radius:var(--radius-xs);background:rgba(108,140,255,0.15);color:var(--accent);flex-shrink:0">{{ fmtTime(d.timestamp) }}</span>
                          </div>
                          <div style="font-size:12px;color:var(--text-muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap" :title="d.content" v-html="replaceDouyinEmoji(esc(d.content))"></div>
                        </div>
                      </div>
                    </template>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- Anon Panel -->
      <div class="tab-panel" :class="{ active: activeTab === 'anon' }" id="panel-anon">
        <div class="detail-section">
          <div style="font-size:13px;font-weight:600;color:var(--text);margin-bottom:10px;display:flex;align-items:center;gap:6px">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14">
              <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
            </svg>
            信息查询
          </div>
          <div style="font-size:12px;color:var(--text-muted);margin-bottom:14px">输入关键词，查询本场次相关的送礼或弹幕记录</div>
          <div class="anon-input-row">
            <input
              v-model="anonQuery"
              placeholder="输入关键词（昵称/礼物名/弹幕内容）..."
              @keydown.enter="queryAnonymous"
            >
            <button class="btn btn-ghost btn-sm" @click="queryAnonymous" style="border-color:var(--border)">查询</button>
          </div>
          <div ref="anonResultEl">
            <!-- Anon results rendered here -->
          </div>
        </div>
      </div>

      <!-- Report Panel -->
      <div v-if="data.has_report" class="tab-panel" :class="{ active: activeTab === 'report' }" id="panel-report">
        <div style="text-align:center;padding:20px">
          <img :src="`/api/sessions/${data.session.id}/report`" style="max-width:100%;border-radius:var(--radius);box-shadow:var(--shadow-lg)">
        </div>
      </div>
    </template>

    <!-- Loading -->
    <div v-if="loading" class="loading">加载中...</div>
    <div v-if="error" class="empty">
      <div class="empty-icon">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="28" height="28">
          <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
          <line x1="12" y1="9" x2="12" y2="13"/>
          <line x1="12" y1="17" x2="12.01" y2="17"/>
        </svg>
      </div>
      加载失败: {{ error }}
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, onBeforeUnmount, watch, nextTick } from 'vue'

const props = defineProps({
  sessionId: { type: String, required: true }
})

const emit = defineEmits(['toast', 'confirm', 'openAnchorModal', 'showGiftDetail'])

const API = ''

// State
const data = ref(null)
const loading = ref(true)
const error = ref('')
const activeTab = ref('gifts')
const refreshing = ref(false)

// Danmaku state
const danmakuData = ref([])
const danmakuLoading = ref(false)
const danmakuSearchText = ref('')
let danmakuSearchTimer = null



// Anon query
const anonQuery = ref('')

// Auto-refresh
let refreshTimer = null

// Template refs
const danmakuLeftEl = ref(null)
const danmakuRightEl = ref(null)
const anonResultEl = ref(null)
const refreshBtnEl = ref(null)
const refreshSvgEl = ref(null)

// Wordcloud
const wordcloudCanvas = ref(null)

// Computed
const hasMultiAnchor = computed(() => data.value && data.value.anchorRanking && data.value.anchorRanking.length > 1)

const filteredDanmaku = computed(() => {
  const q = danmakuSearchText.value.toLowerCase()
  const all = danmakuData.value
  const items = q ? all.filter(d =>
    (d.content || '').toLowerCase().includes(q) ||
    (d.nickname || '').toLowerCase().includes(q)
  ) : all.slice(0, 80)
  return items
})

const danmakuBadge = computed(() => {
  const total = danmakuData.value.length
  const q = danmakuSearchText.value
  if (q) {
    return `搜索结果: ${filteredDanmaku.value.length} 条`
  }
  return total > 80 ? `显示前 80 / 共 ${total.toLocaleString()} 条` : ''
})

// Helpers
function formatDuration(min) {
  if (min < 60) return min + '分钟'
  const h = Math.floor(min / 60)
  const m = min % 60
  return m > 0 ? `${h}h ${m}m` : `${h}h`
}

function fmtTime(ts) {
  if (!ts) return '-'
  let d
  if (typeof ts === 'number' || (typeof ts === 'string' && /^\d+$/.test(ts.trim()))) {
    const n = Number(ts)
    d = new Date(n > 1e12 ? n : n * 1000)
  } else {
    d = new Date(ts)
  }
  return d.toLocaleString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
}

// Tab switch
function switchTab(tab) {
  activeTab.value = tab
  if (tab === 'danmaku' || tab === 'anon') {
    loadDanmaku()
  }
  if (tab === 'danmaku') {
    // 进弹幕tab滚到底部看最新
    nextTick(() => {
      setTimeout(() => {
        const el = document.getElementById('rtDanmakuList')
        if (el) el.scrollTop = el.scrollHeight
      }, 200)
    })
    nextTick(() => {
      renderWordCloud()
      // Match left/right height
      if (danmakuLeftEl.value && danmakuRightEl.value && window.innerWidth > 768) {
        danmakuRightEl.value.style.height = danmakuLeftEl.value.offsetHeight + 'px'
      }
    })
  }
}

// Danmaku
async function loadDanmaku() {
  if (danmakuData.value.length > 0) return
  if (danmakuLoading.value) return
  danmakuLoading.value = true
  try {
    const resp = await fetch(`${API}/api/sessions/${props.sessionId}/danmaku?limit=99999`)
    const raw = await resp.json()
    const items = raw.data || raw.danmaku || []
    danmakuData.value = items.map(d => ({
      ...d,
      timestamp: d.timestamp || d.create_time,
      avatar_url: d.avatar_url || d.avatar
    }))
  } catch(e) {
    // silent
  } finally {
    danmakuLoading.value = false
    setTimeout(() => {
      const el = document.getElementById('rtDanmakuList')
      if (el) el.scrollTop = el.scrollHeight
    }, 100)
  }
}

function onDanmakuSearch() {
  clearTimeout(danmakuSearchTimer)
  danmakuSearchTimer = setTimeout(() => {
    if (danmakuData.value.length === 0) {
      loadDanmaku()
    }
  }, 200)
}

// Word cloud
function renderWordCloud() {
  const canvas = wordcloudCanvas.value
  if (!canvas) return
  const words = data.value?.danmakuWords || []
  if (!words.length) return

  const ctx = canvas.getContext('2d')
  const dpr = window.devicePixelRatio || 1
  const rect = canvas.getBoundingClientRect()
  canvas.width = rect.width * dpr
  canvas.height = rect.height * dpr
  ctx.scale(dpr, dpr)
  const W = rect.width, H = rect.height
  ctx.clearRect(0, 0, W, H)

  // Build word frequency
  const wordFreq = {}
  words.forEach(w => {
    const text = w.content?.trim()
    if (!text || text.length < 2 || text.length > 12) return
    if (!/[\u4e00-\u9fa5a-zA-Z0-9]/.test(text)) return
    const clean = text.replace(/[^\u4e00-\u9fa5a-zA-Z0-9]/g, '')
    if (clean.length >= 2 && clean.length <= 10) {
      wordFreq[clean] = (wordFreq[clean] || 0) + w.cnt
    }
    if (text.length <= 8 && text !== clean) {
      wordFreq[text] = (wordFreq[text] || 0) + w.cnt
    }
  })

  const sorted = Object.entries(wordFreq).sort((a, b) => b[1] - a[1])
  const finalWords = []
  const used = new Set()
  for (const [word, freq] of sorted) {
    if (finalWords.length >= 40) break
    if (used.has(word)) continue
    let isSubstring = false
    for (const usedWord of used) {
      if (usedWord.includes(word) && usedWord.length > word.length) { isSubstring = true; break }
    }
    if (isSubstring) continue
    finalWords.push([word, freq])
    used.add(word)
  }

  if (!finalWords.length) {
    ctx.fillStyle = '#6b7084'
    ctx.font = '14px sans-serif'
    ctx.textAlign = 'center'
    ctx.fillText('暂无词频数据', W / 2, H / 2)
    return
  }

  const maxFreq = finalWords[0][1]
  const minFreq = finalWords[finalWords.length - 1][1]
  const colors = ['#6c8cff', '#a78bfa', '#fb923c', '#4ade80', '#f87171', '#facc15', '#f472b6', '#38bdf8', '#c084fc', '#34d399']

  const placed = []
  const padding = 4
  const cx = W / 2, cy = H / 2

  finalWords.forEach(([word, freq], idx) => {
    const ratio = maxFreq > minFreq ? (freq - minFreq) / (maxFreq - minFreq) : 0.5
    const fontSize = 13 + ratio * 24
    ctx.font = `bold ${fontSize}px "PingFang SC", "Microsoft YaHei", sans-serif`
    const metrics = ctx.measureText(word)
    const tw = metrics.width + padding * 2
    const th = fontSize + padding * 2

    for (let t = 0; t < 800; t++) {
      const angle = t * 0.3
      const radius = t * 0.8
      const x = cx + radius * Math.cos(angle) - tw / 2
      const y = cy + radius * Math.sin(angle) - th / 2
      if (x < -10 || x + tw > W + 10 || y < -10 || y + th > H + 10) continue
      let collision = false
      for (const p of placed) {
        if (x < p.x + p.w + padding && x + tw + padding > p.x && y < p.y + p.h + padding && y + th + padding > p.y) {
          collision = true; break
        }
      }
      if (!collision) {
        ctx.fillStyle = colors[idx % colors.length]
        ctx.globalAlpha = 0.55 + ratio * 0.45
        ctx.fillText(word, x + padding, y + th - fontSize * 0.3)
        ctx.globalAlpha = 1
        placed.push({ x, y, w: tw, h: th })
        break
      }
    }
  })
}

// Anon query
async function queryAnonymous() {
  const q = anonQuery.value.trim()
  const resultEl = anonResultEl.value
  if (!q || !resultEl) return

  const detailData = data.value
  if (!detailData) return

  // Ensure danmaku loaded
  if (danmakuData.value.length === 0) {
    resultEl.innerHTML = '<div class="loading">加载弹幕数据...</div>'
    await loadDanmaku()
  }

  const matches = []
  const qLower = q.toLowerCase()

  // Search danmaku
  danmakuData.value.forEach(d => {
    const name = (d.nickname || '').toLowerCase()
    const content = (d.content || '').toLowerCase()
    if (name.includes(qLower) || content.includes(qLower)) {
      matches.push({ type: '弹幕', nickname: d.nickname, content: d.content, time: d.timestamp, avatar: d.avatar_url })
    }
  })

  // Search gifts
  ;(detailData.giftDetails || []).forEach(g => {
    const nameLower = (g.nickname || '').toLowerCase()
    const giftLower = (g.gift_name || '').toLowerCase()
    if (nameLower.includes(qLower) || giftLower.includes(qLower)) {
      matches.push({
        type: '礼物',
        nickname: g.nickname,
        content: `${g.gift_name || '礼物'} ×${g.count}`,
        time: null,
        avatar: g.avatar_url,
        diamonds: g.total_diamonds,
        giftIcon: g.gift_icon || null,
        to_nickname: g.to_nickname || ''
      })
    }
  })

  if (matches.length === 0) {
    resultEl.innerHTML = `<div class="anon-result"><div class="empty" style="padding:20px">未找到匹配 "${q}" 的记录</div></div>`
    return
  }

  let html = '<div class="anon-result">'
  html += `<div style="font-size:13px;color:var(--text-muted);margin-bottom:12px">找到 ${matches.length} 条匹配记录</div>`
  matches.forEach(m => {
    const avatarHtml = m.avatar
      ? `<div class="avatar"><img src="${m.avatar}" alt="" onerror="this.parentElement.innerHTML='${(m.nickname||'?')[0]}'"></div>`
      : `<div class="avatar" style="display:flex;align-items:center;justify-content:center;font-size:13px;color:var(--text-muted)">${(m.nickname||'?')[0]}</div>`

    html += `<div class="anon-result-item">
      <div style="flex-shrink:0">${avatarHtml}</div>
      <div style="flex:1;min-width:0">
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:2px">
          <span style="font-size:13px;font-weight:600;color:var(--text)">${esc(m.nickname || '匿名')}</span>
          <span style="font-size:11px;padding:1px 6px;border-radius:var(--radius-xs);background:${m.type === '礼物' ? 'rgba(251,146,60,0.15)' : 'rgba(108,140,255,0.15)'};color:${m.type === '礼物' ? 'var(--orange)' : 'var(--accent)'}">${m.type}</span>
          ${m.diamonds ? `<span style="font-size:12px;font-weight:600;color:var(--orange)"><svg viewBox="0 0 24 24" width="12" height="12" style="vertical-align:-2px;fill:currentColor"><path d="M6 2h12l4 7-10 13L2 9z"/><path d="M2 9h20" stroke="rgba(255,255,255,0.2)" stroke-width="0.7" fill="none"/><path d="M12 22l-4-13h8z" fill="rgba(0,0,0,0.1)"/></svg>${m.diamonds.toLocaleString()}</span>` : ''}
        </div>
        <div style="font-size:12px;color:var(--text-muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${esc(m.content)}">
          ${m.type === '礼物' ? (m.giftIcon ? `<img src="${esc(m.giftIcon)}" style="width:16px;height:16px;vertical-align:-3px;margin-right:2px;border-radius:var(--radius-xs)">` : '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14" style="vertical-align:-2px;margin-right:2px;flex-shrink:0"><rect x="3" y="8" width="18" height="13" rx="1"/><path d="M12 8V6c0-2-1.5-4-4-4S4 4 4 6h2"/><path d="M20 6c0-2-1.5-4-4-4s-4 2-4 4h2"/><line x1="12" y1="8" x2="12" y2="21"/><line x1="3" y1="13" x2="21" y2="13"/></svg>') : ''}${esc((m.content || '').substring(0, 60))}${m.to_nickname ? ` <span style="color:var(--accent)">→ ${esc(m.to_nickname)}</span>` : ''}
        </div>
      </div>
    </div>`
  })
  html += '</div>'
  resultEl.innerHTML = html
}

function esc(s) {
  if (!s) return ''
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#039;')
}
import { replaceDouyinEmoji } from '../utils/douyin-emoji'

// Anchor modal
function openAnchorModal(anchorName) {
  emit('openAnchorModal', anchorName)
}

// Gift detail
function showGiftDetail(nickname, secUid) {
  emit('showGiftDetail', nickname, secUid)
}

// Auto-refresh
function startAutoRefresh() {
  stopAutoRefresh()
  refreshTimer = setInterval(async () => {
    if (!data.value || !data.value.session.is_live) return
    await refreshDetail()
  }, 15000)
}

function stopAutoRefresh() {
  if (refreshTimer) { clearInterval(refreshTimer); refreshTimer = null }
}

async function refreshDetail() {
  if (refreshing.value) return
  refreshing.value = true
  try {
    const r = await fetch(`${API}/api/sessions/${props.sessionId}/detail`)
    const newData = await r.json()
    smoothUpdateDetail(newData)
    if (!newData.session.is_live) stopAutoRefresh()
  } catch(e) {
    // silent
  } finally {
    refreshing.value = false
  }
}

async function manualRefresh() {
  refreshing.value = true
  if (refreshSvgEl.value) refreshSvgEl.value.style.animation = 'spin .6s linear infinite'
  try {
    const r = await fetch(`${API}/api/sessions/${props.sessionId}/detail`)
    const newData = await r.json()
    smoothUpdateDetail(newData)
    if (!newData.session.is_live) stopAutoRefresh()
  } catch(e) {
    // silent
  } finally {
    refreshing.value = false
    if (refreshSvgEl.value) refreshSvgEl.value.style.animation = ''
  }
}

function animateNumber(el, newVal) {
  if (!el) return
  const oldText = el.textContent.replace(/[^\d]/g, '')
  const oldVal = parseInt(oldText) || 0
  if (oldVal === newVal) return
  const diff = newVal - oldVal
  const steps = 20
  const stepTime = 300 / steps
  let step = 0
  const tick = () => {
    step++
    const progress = step / steps
    const eased = 1 - Math.pow(1 - progress, 3)
    const current = Math.round(oldVal + diff * eased)
    el.textContent = current.toLocaleString()
    if (step < steps) setTimeout(tick, stepTime)
    else el.textContent = newVal.toLocaleString()
  }
  tick()
}

let _lastAnchorCount = 0
function smoothUpdateDetail(newData) {
  const oldData = data.value

  // Dynamic anchor tab toast
  const anchorCount = newData.anchorRanking ? newData.anchorRanking.length : 0
  if (anchorCount > 1 && _lastAnchorCount <= 1) {
    const toast = document.createElement('div')
    toast.style.cssText = 'position:fixed;top:20px;left:50%;transform:translateX(-50%);background:var(--accent-bg);color:var(--accent);padding:8px 16px;border-radius:var(--radius);font-size:13px;z-index:999;animation:flipFadeIn .4s ease'
    toast.textContent = '🎯 检测到多位主播，已自动添加主播排名tab'
    document.body.appendChild(toast)
    setTimeout(() => toast.remove(), 3000)
  }
  _lastAnchorCount = anchorCount

  // Save old stat values for animation
  const statEls = document.querySelectorAll('.stats-row .stat-card .stat-value')
  const oldStatVals = Array.from(statEls).map(el => {
    const n = el.textContent.replace(/[^\d]/g, '')
    return parseInt(n) || 0
  })

  // Save old ranking positions for FLIP
  const savePositions = (sel) => {
    const container = document.querySelector(sel)
    if (!container) return null
    const items = container.querySelectorAll('[class*="rank-card"], [class*="user-rank"], [class*="anchor-card"]')
    const map = new Map()
    items.forEach(el => {
      map.set(el.textContent.trim().substring(0, 30), el.getBoundingClientRect())
    })
    return map
  }
  const oldGiftPos = savePositions('#panel-gifts .gift-rank-grid')
  const oldDanmakuPos = savePositions('#panel-danmaku .danmaku-user-rank-list')
  const oldAnchorPos = savePositions('#panel-anchors .anchor-grid')

  // Update data (Vue reactivity re-renders)
  data.value = newData

  // After Vue re-renders, animate numbers and FLIP rankings
  nextTick(() => {
    // Animate numbers
    const newStatEls = document.querySelectorAll('.stats-row .stat-card .stat-value')
    const newStats = [
      newData.session.online_peak || 0,
      newData.summary.total_diamonds,
      newData.session.stats_like || 0,
      newData.summary.danmaku_count,
      newData.summary.user_count,
      null
    ]
    newStatEls.forEach((el, i) => {
      if (i < newStats.length && newStats[i] != null) {
        const num = typeof newStats[i] === 'number' ? newStats[i] : parseInt(newStats[i])
        if (!isNaN(num)) animateNumber(el, num)
      }
    })

    // FLIP helper
    const flipAnimate = (sel, oldMap) => {
      const container = document.querySelector(sel)
      if (!container || !oldMap) return
      const items = container.querySelectorAll('[class*="rank-card"], [class*="user-rank"], [class*="anchor-card"]')
      items.forEach(el => {
        const key = el.textContent.trim().substring(0, 30)
        const oldRect = oldMap.get(key)
        if (!oldRect) { el.classList.add('flip-new'); return }
        const newRect = el.getBoundingClientRect()
        const dy = oldRect.top - newRect.top
        if (Math.abs(dy) < 1) return
        el.style.transform = `translateY(${dy}px)`
        el.style.transition = 'none'
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            el.style.transition = ''
            el.style.transform = ''
          })
        })
      })
    }
    flipAnimate('#panel-gifts .gift-rank-grid', oldGiftPos)
    flipAnimate('#panel-danmaku .danmaku-user-rank-list', oldDanmakuPos)
    flipAnimate('#panel-anchors .anchor-grid', oldAnchorPos)
  })
}

// FLIP animation
function flipAnimate(container, selector, updateFn) {
  if (!container) return
  const items = container.querySelectorAll(selector)
  const oldRects = new Map()
  const oldKeys = new Map()
  items.forEach(el => {
    oldRects.set(el, el.getBoundingClientRect())
    oldKeys.set(el, el.textContent.trim().substring(0, 30))
  })
  updateFn()
  const newItems = container.querySelectorAll(selector)
  const oldByKey = new Map()
  oldKeys.forEach((key, el) => oldByKey.set(key, oldRects.get(el)))

  newItems.forEach(el => {
    const newKey = el.textContent.trim().substring(0, 30)
    const oldRect = oldByKey.get(newKey)
    if (!oldRect) {
      el.classList.add('flip-new')
      return
    }
    const newRect = el.getBoundingClientRect()
    const dy = oldRect.top - newRect.top
    if (Math.abs(dy) < 1) return
    el.style.transform = `translateY(${dy}px)`
    el.style.transition = 'none'
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        el.style.transition = ''
        el.style.transform = ''
      })
    })
  })
}

// Data fetching
async function fetchDetail() {
  loading.value = true
  error.value = ''
  try {
    const r = await fetch(`${API}/api/sessions/${props.sessionId}/detail`)
    const result = await r.json()
    data.value = result
    // Set default active tab
    activeTab.value = hasMultiAnchor.value ? 'anchors' : 'gifts'
    // Pre-render anon tab
    // Start auto-refresh if live
    if (result.session.is_live) startAutoRefresh()
  } catch(e) {
    error.value = e.message
  } finally {
    loading.value = false
  }
}

// Watch for session changes
watch(() => props.sessionId, () => {
  stopAutoRefresh()
  danmakuData.value = []
  danmakuSearchText.value = ''
  anonQuery.value = ''
  fetchDetail()
}, { immediate: true })

onBeforeUnmount(() => {
  stopAutoRefresh()
  clearTimeout(danmakuSearchTimer)
})
</script>
