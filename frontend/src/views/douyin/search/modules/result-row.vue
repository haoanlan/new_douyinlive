<!--
  信息查询 · 结果行（信息流的一行，替代原来的整块卡片）
  结构：头像 | 身份行 + 指标行 + 最近行为 + 最近参与 | 画像按钮
-->
<template>
  <div class="result-row flex gap-4 px-5 py-4 border-b border-g-100/80 last:border-b-0">
    <el-avatar :size="44" :src="user.avatar" class="shrink-0">
      {{ (user.nickname || '?')[0] }}
    </el-avatar>

    <div class="flex-1 min-w-0">
      <!-- 身份行 -->
      <div class="flex items-center gap-2 flex-wrap">
        <span class="text-base font-medium text-g-900 truncate leading-snug">
          {{ user.nickname || '未知用户' }}
        </span>
        <el-tag v-if="user.unique_id" size="small" effect="plain" class="shrink-0">
          ID {{ user.unique_id }}
        </el-tag>
        <span v-if="user.ip_location" class="inline-flex items-center gap-1 text-xs text-g-500">
          <ArtSvgIcon icon="ri:map-pin-line" class="text-g-400" />{{ user.ip_location }}
        </span>
        <span v-if="user.user_gender" class="text-xs text-g-500">
          {{ user.user_gender === 1 ? '男' : '女' }}
        </span>
        <span v-if="user.is_private" class="text-xs text-warning">私密账号</span>
        <span v-if="!user.sec_uid" class="text-xs text-g-400">库里无 sec_uid</span>
      </div>

      <!-- 库内别名（去掉与当前昵称相同的一条） -->
      <div v-if="otherNicknames.length" class="flex items-center gap-1.5 mt-1.5 flex-wrap">
        <span class="text-xs text-g-400 shrink-0">库内别名</span>
        <el-tag
          v-for="n in otherNicknames.slice(0, 3)"
          :key="n"
          size="small"
          effect="plain"
          type="info"
        >
          {{ n }}
        </el-tag>
        <span v-if="otherNicknames.length > 3" class="text-xs text-g-400">
          +{{ otherNicknames.length - 3 }}
        </span>
      </div>

      <!-- 指标行：一行文本指标，替代原来的三个虚线格子 -->
      <div class="flex items-center gap-4 mt-2.5 text-sm text-g-600 flex-wrap">
        <span class="inline-flex items-center gap-1.5">
          <ArtSvgIcon icon="ri:live-line" class="text-g-400" />
          参与
          <b class="font-medium" :class="sessionCount ? 'text-g-900' : 'text-g-400'">
            {{ sessionCount }}
          </b>
          场
        </span>
        <span class="inline-flex items-center gap-1.5">
          <ArtSvgIcon icon="ri:diamond-line" class="text-g-400" />
          钻
          <b
            class="font-medium"
            :class="user.total_diamonds ? 'text-theme' : 'text-g-400'"
            :title="user.total_diamonds ? fmtTitle(user.total_diamonds) : ''"
          >
            {{ user.total_diamonds ? fmtNum(user.total_diamonds) : '—' }}
          </b>
        </span>
        <span class="inline-flex items-center gap-1.5">
          <ArtSvgIcon icon="ri:chat-3-line" class="text-g-400" />
          弹幕
          <b
            class="font-medium"
            :class="user.danmaku_count ? 'text-g-900' : 'text-g-400'"
            :title="user.danmaku_count ? fmtTitle(user.danmaku_count) : ''"
          >
            {{ user.danmaku_count ? fmtNum(user.danmaku_count) : '—' }}
          </b>
        </span>
      </div>

      <!-- 最近行为（最多两行） -->
      <div class="flex flex-col gap-1.5 mt-2.5 text-xs">
        <div v-if="user.latest_action" class="flex items-center gap-2">
          <span
            class="px-1.5 py-0.5 rounded-md shrink-0"
            :class="actionClass(user.latest_action.type)"
          >
            {{ actionLabel(user.latest_action.type) }}
          </span>
          <span class="flex-1 min-w-0 truncate text-g-700">
            {{ cleanText(user.latest_action.detail) }}
          </span>
          <span class="text-g-400 shrink-0">{{ fmtAgo(user.latest_action.time) }}</span>
        </div>
        <div v-if="user.latest_danmaku" class="flex items-center gap-2">
          <span class="px-1.5 py-0.5 rounded-md bg-blue-50 text-blue-500 shrink-0">弹幕</span>
          <span class="flex-1 min-w-0 truncate text-g-600">
            {{ cleanText(user.latest_danmaku.detail) }}
          </span>
          <span class="text-g-400 shrink-0">{{ fmtAgo(user.latest_danmaku.time) }}</span>
        </div>
        <div v-if="user.latest_gift" class="flex items-center gap-2">
          <span class="px-1.5 py-0.5 rounded-md bg-amber-50 text-amber-600 shrink-0">礼物</span>
          <span class="flex-1 min-w-0 truncate text-g-600">
            {{ cleanText(user.latest_gift.detail) }}
          </span>
          <span class="text-g-400 shrink-0">{{ fmtAgo(user.latest_gift.time) }}</span>
        </div>
        <div
          v-if="!user.latest_action && !user.latest_danmaku && !user.latest_gift"
          class="text-xs text-g-400"
        >
          暂无行为记录
        </div>
      </div>

      <!-- 最近参与 -->
      <div
        v-if="user.sessions?.length"
        class="flex items-center gap-2 mt-2.5 text-xs text-g-600 flex-wrap"
      >
        <ArtSvgIcon icon="ri:time-line" class="text-g-400" />
        <span class="shrink-0">最近参与</span>
        <button
          v-for="s in user.sessions.slice(0, 2)"
          :key="s.id"
          class="dy-pressable px-2 h-6 rounded-md bg-g-100/70 text-g-700 hover:bg-theme/10 hover:text-theme"
          @click="emit('open-session', s.id)"
        >
          {{ s.streamer_name || '场次 #' + s.id }} · {{ fmtSessionTime(s.start_time) }}
        </button>
        <span v-if="user.sessions.length > 2" class="text-g-400">
          还有 {{ user.sessions.length - 2 }} 场
        </span>
      </div>
    </div>

    <el-button
      v-if="user.sec_uid"
      type="primary"
      class="shrink-0 self-start"
      @click="emit('open-profile')"
    >
      画像
    </el-button>
  </div>
</template>

<script setup lang="ts">
  import { computed } from 'vue'
  import { fmtAgo, fmtNum, fmtSessionTime, fmtTitle } from '@/utils/format'

  const props = defineProps<{ user: any }>()
  const emit = defineEmits<{
    (e: 'open-profile'): void
    (e: 'open-session', id: number): void
  }>()

  const sessionCount = computed(() => props.user?.sessions?.length || 0)

  /** 库内别名去掉与当前显示昵称相同的那条（否则昵称旁边会贴一个一模一样的标签） */
  const otherNicknames = computed(() => {
    const cur = props.user?.nickname || ''
    return (props.user?.db_nicknames || []).filter((n: string) => n && n !== cur)
  })

  /** 后端 detail 里带 [礼物] 前缀与表情，去掉多余前后缀让行更干净 */
  function cleanText(s?: string | null): string {
    if (!s) return ''
    return String(s)
      .replace(/^\[[^\]]+\]\s*/, '')
      .trim()
  }

  function actionLabel(type?: string): string {
    if (type === 'gift') return '礼物'
    if (type === 'danmaku') return '弹幕'
    if (type === 'member') return '进场'
    return '行为'
  }

  function actionClass(type?: string): string {
    if (type === 'gift') return 'bg-amber-50 text-amber-600'
    if (type === 'danmaku') return 'bg-blue-50 text-blue-500'
    return 'bg-emerald-50 text-emerald-600'
  }
</script>

<style scoped>
  /* 行悬停：只做底色反馈（不起浮 —— 信息流的行不该跳） */
  .result-row {
    transition: background-color var(--dy-dur-fast, 0.16s) ease;
  }

  @media (hover: hover) and (pointer: fine) {
    .result-row:hover {
      background-color: color-mix(in srgb, var(--theme-color) 3%, transparent);
    }
  }
</style>
