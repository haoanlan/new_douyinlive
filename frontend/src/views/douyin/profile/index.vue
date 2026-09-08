<template>
  <div class="p-4">
    <el-card shadow="never" class="mb-4" v-loading="loading">
      <div class="flex items-center gap-4">
        <el-avatar :size="56" :src="profile?.avatar" />
        <div>
          <div class="text-lg font-bold">{{ profile?.nickname }}</div>
          <div class="text-sm text-gray-400">{{ profile?.signature || '无签名' }}</div>
          <div class="text-sm mt-1">
            粉丝 {{ profile?.fans_count ?? '-' }} · 关注 {{ profile?.following_count ?? '-' }} ·
            {{ profile?.ip_location || '未知属地' }}
          </div>
        </div>
      </div>
    </el-card>

    <el-row :gutter="16">
      <el-col :span="12">
        <el-card shadow="never" class="mb-4">
          <template #header>送礼风格</template>
          <div>{{ profile?.gift_profile?.style?.join('、') || '-' }}</div>
          <div class="text-sm text-gray-400 mt-2">
            平均 {{ profile?.gift_profile?.avg_diamonds ?? '-' }} 钻 · 活跃高峰
            {{ profile?.gift_profile?.peak_hour ?? '-' }} 点
          </div>
        </el-card>
        <el-card shadow="never">
          <template #header>近期行为</template>
          <el-timeline>
            <el-timeline-item
              v-for="(a, i) in profile?.recent_actions || []"
              :key="i"
              :timestamp="a.time"
            >
              <el-tag size="small" :type="a.type === 'gift' ? 'warning' : 'info'" class="mr-2">
                {{ a.type === 'gift' ? '礼物' : '弹幕' }}
              </el-tag>
              {{ a.content }}
            </el-timeline-item>
          </el-timeline>
          <el-empty
            v-if="!profile?.recent_actions?.length"
            description="暂无行为"
            :image-size="60"
          />
        </el-card>
      </el-col>

      <el-col :span="12">
        <el-card shadow="never" class="mb-4">
          <template #header>常送主播</template>
          <el-table :data="profile?.top_anchors || []" size="small">
            <el-table-column prop="name" label="主播" />
            <el-table-column prop="diamonds" label="钻石" width="100" />
          </el-table>
          <el-empty v-if="!profile?.top_anchors?.length" description="暂无数据" :image-size="60" />
        </el-card>
        <el-card shadow="never">
          <template #header>常用礼物</template>
          <el-table :data="profile?.top_gifts || []" size="small">
            <el-table-column label="礼物" min-width="120">
              <template #default="{ row }">
                <div class="flex items-center gap-2">
                  <el-image
                    v-if="row.icon"
                    :src="row.icon"
                    :preview-src-list="[row.icon]"
                    fit="contain"
                    class="!w-6 !h-6"
                  />
                  <span>{{ row.name }}</span>
                </div>
              </template>
            </el-table-column>
            <el-table-column prop="count" label="次数" width="100" />
          </el-table>
          <el-empty v-if="!profile?.top_gifts?.length" description="暂无数据" :image-size="60" />
        </el-card>
      </el-col>
    </el-row>
  </div>
</template>

<script setup lang="ts">
  import { onMounted, ref } from 'vue'
  import { useRoute } from 'vue-router'
  import { fetchUser, type UserProfile } from '@/api/douyin'

  defineOptions({ name: 'DouyinProfile' })

  const route = useRoute()
  const secUid = String(route.params.secUid)
  const profile = ref<UserProfile | null>(null)
  const loading = ref(false)

  onMounted(async () => {
    loading.value = true
    try {
      profile.value = await fetchUser(secUid)
    } finally {
      loading.value = false
    }
  })
</script>
