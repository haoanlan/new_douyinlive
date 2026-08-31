<template>
  <div class="app">
    <!-- HEADER -->
    <div class="header">
      <div style="display:flex;align-items:center;gap:14px">
        <button type="button" class="back-btn" :class="{ show: showBackBtn }" @click="goBack">
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
      <button type="button" class="top-nav-btn" :class="{ active: topNavTab === 'rooms' }" @click="switchTopNav('rooms')">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>
        房间管理
      </button>
      <button type="button" class="top-nav-btn" :class="{ active: topNavTab === 'search' }" @click="switchTopNav('search')">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
        匿名查询
      </button>
      <button type="button" class="top-nav-btn" :class="{ active: topNavTab === 'combine' }" @click="switchTopNav('combine')">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><path d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"/></svg>
        合并查看
      </button>
    </div>

    <!-- CONTENT (child route renders here) -->
    <router-view />

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
          <button type="button" class="btn btn-ghost btn-sm" @click="confirmResolve(false)">取消</button>
          <button type="button" class="btn btn-ghost btn-sm" id="confirmOkBtn" @click="confirmResolve(true)" style="border-color:var(--border-light)">确认</button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { storeToRefs } from 'pinia'
import { useRouter, useRoute } from 'vue-router'
import { watch } from 'vue'
import { useAppStore } from '../stores/app'
import { useToast } from '../composables/useToast'
import { useConfirm } from '../composables/useConfirm'

const store = useAppStore()
const router = useRouter()
const route = useRoute()
const { pageTitle, showBackBtn, showTopNav, breadcrumbItems, topNavTab, viewLevel } = storeToRefs(store)
const { toastMsg, toastType, toastClasses, toast } = useToast()
const { confirmVisible, confirmIcon, confirmText, showConfirm, confirmResolve } = useConfirm()

// 从路由 meta 同步静态导航状态（仅 hosts 层级由 meta 管理，其他层级由子组件接管）
watch(() => route.meta, (meta) => {
  if (meta.viewLevel === 'hosts') {
    viewLevel.value = 'hosts'
    showBackBtn.value = false
    showTopNav.value = true
    store.pageTitle = '直播监控'
    store.breadcrumbItems = []
  }
}, { immediate: true })

// Navigation: back button (debounced)
let _lastBackTime = 0
function goBack() {
  const now = Date.now()
  if (now - _lastBackTime < 300) return
  _lastBackTime = now
  router.back()
}

// Top nav tab switching — top nav 仅在 hosts 层级显示（showTopNav 控制）
function switchTopNav(tab: 'rooms' | 'search' | 'combine') {
  if (topNavTab.value === tab) return
  topNavTab.value = tab
}
</script>
