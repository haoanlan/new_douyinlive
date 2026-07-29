<template>
  <div class="avatar-fallback" :style="{ width: size + 'px', height: size + 'px', fontSize: size * 0.45 + 'px' }">
    <img v-if="src && !imgError" :src="src" :alt="alt" @error="imgError = true" class="avatar-img">
    <span v-else class="avatar-text">{{ fallback }}</span>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'

const props = defineProps<{
  src?: string
  alt?: string
  name?: string
  size?: number
}>()

const imgError = ref(false)
const fallback = ref((props.name || '?')[0] || '?')
const size = props.size || 32
</script>

<style scoped>
.avatar-fallback {
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  background: var(--bg-card);
  color: var(--text-muted);
  overflow: hidden;
  flex-shrink: 0;
}
.avatar-img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.avatar-text {
  font-weight: 600;
}
</style>
