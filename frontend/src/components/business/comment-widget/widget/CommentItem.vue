<template>
  <li>
    <div>
      <div class="flex-c">
        <div
          class="size-5 mr-2.5 text-xs font-medium rounded-full flex-cc"
          :style="{ background: avatarColor(comment.author), color: avatarTextColor(comment.author) }"
        >
          {{ comment.author.substring(0, 1) }}
        </div>
        <strong class="block text-sm font-medium">{{ comment.author }}</strong>
      </div>
      <span class="block mt-2.5 text-sm text-g-700">{{ comment.content }}</span>
      <div class="flex-c mt-2.5">
        <span class="text-xs text-g-700">{{ formatDate(comment.timestamp) }}</span>
        <div
          class="ml-5 text-xs text-g-700 c-p select-none hover:text-theme"
          @click="toggleReply(comment.id)"
        >
          回复
        </div>
      </div>
    </div>

    <ul class="pl-2.5" v-if="comment.replies.length > 0">
      <CommentItem
        v-for="reply in comment.replies"
        :key="reply.id"
        :comment="reply"
        :show-reply-form="showReplyForm"
        @toggle-reply="toggleReply"
        @add-reply="addReply"
        class="mt-5"
      />
    </ul>

    <ElForm v-if="showReplyForm === comment.id" @submit.prevent="handleSubmit" class="mt-4">
      <ElFormItem prop="author">
        <ElInput v-model="replyAuthor" placeholder="你的名称" clearable />
      </ElFormItem>
      <ElFormItem prop="content">
        <ElInput
          v-model="replyContent"
          placeholder="你的回复..."
          type="textarea"
          :rows="3"
          clearable
        />
      </ElFormItem>
      <ElFormItem>
        <div class="flex justify-end gap-2 w-full">
          <ElButton @click="toggleReply(comment.id)">取消</ElButton>
          <ElButton type="primary" @click="handleSubmit">发布</ElButton>
        </div>
      </ElFormItem>
    </ElForm>
  </li>
</template>

<script setup lang="ts">
  import AppConfig from '@/config'
  import { ref } from 'vue'

  interface Comment {
    id: number
    author: string
    content: string
    timestamp: string
    replies: Comment[]
  }

  const props = defineProps<{
    comment: Comment
    showReplyForm: number | null
  }>()

  const emit = defineEmits<{
    (event: 'toggle-reply', commentId: number): void
    (event: 'add-reply', commentId: number, replyAuthor: string, replyContent: string): void
  }>()

  const replyAuthor = ref('')
  const replyContent = ref('')

  const toggleReply = (commentId: number) => {
    emit('toggle-reply', commentId)
  }

  const addReply = (commentId: number, author: string, content: string) => {
    emit('add-reply', commentId, author, content)
    replyAuthor.value = ''
    replyContent.value = ''
  }
  const handleSubmit = () => {
    if (!replyAuthor.value.trim() || !replyContent.value.trim()) {
      return
    }
    emit('add-reply', props.comment.id, replyAuthor.value, replyContent.value)
    replyAuthor.value = ''
    replyContent.value = ''
  }

  const formatDate = (timestamp: string) => {
    const date = new Date(timestamp)
    return date.toLocaleString()
  }

  /**
   * 头像底色：按作者名做**稳定哈希**取色。
   *
   * 原来模板里直接调用 `randomColor()` —— 在渲染期掷骰子，于是任何一次重渲染
   * （例如新发一条评论）都会让**所有**已存在的头像换色；而且主题色板偏亮，
   * 配 `text-white` 实测约 2:1。现在颜色绑定到人，不在渲染期产生副作用。
   */
  const avatarColor = (name: string) => {
    const palette = AppConfig.systemMainColor
    let hash = 0
    for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) % 100000
    return palette[hash % palette.length]
  }

  /** 底色偏亮时用深字，保证徽标里的首字母看得清 */
  const avatarTextColor = (name: string) => {
    const c = avatarColor(name)
    const r = parseInt(c.slice(1, 3), 16)
    const g = parseInt(c.slice(3, 5), 16)
    const b = parseInt(c.slice(5, 7), 16)
    const lum = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255
    return lum > 0.62 ? '#1f2937' : '#ffffff'
  }
</script>
