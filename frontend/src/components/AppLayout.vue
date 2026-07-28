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
          <button class="btn btn-ghost btn-sm" @click="confirmResolve(false)">取消</button>
          <button class="btn btn-ghost btn-sm" id="confirmOkBtn" @click="confirmResolve(true)" style="border-color:var(--border-light)">确认</button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { storeToRefs } from 'pinia'
import { useRouter } from 'vue-router'
import { useAppStore } from '../stores/app'
import { useToast } from '../composables/useToast'
import { useConfirm } from '../composables/useConfirm'

const store = useAppStore()
const router = useRouter()
const { pageTitle, showBackBtn, showTopNav, breadcrumbItems, topNavTab } = storeToRefs(store)
const { toastMsg, toastType, toastClasses, toast } = useToast()
const { confirmVisible, confirmIcon, confirmText, showConfirm, confirmResolve } = useConfirm()

// Navigation: back button (debounced)
let _lastBackTime = 0
function goBack() {
  const now = Date.now()
  if (now - _lastBackTime < 300) return
  _lastBackTime = now
  history.back()
}

// Top nav tab switching — only relevant at hosts level (top-nav hidden otherwise)
function switchTopNav(tab: 'rooms' | 'search' | 'profile') {
  if (topNavTab.value === tab) return
  topNavTab.value = tab
  // If somehow not on hosts route, navigate back
  if (router.currentRoute.value.name !== 'hosts') {
    router.push({ name: 'hosts' })
  }
}
</script>
