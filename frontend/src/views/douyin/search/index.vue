<template>
  <div class="p-4">
    <el-card shadow="never">
      <template #header>
        <div class="flex items-center justify-between">
          <span class="font-bold">匿名查询</span>
          <div class="flex gap-2">
            <el-input
              v-model="query"
              placeholder="输入昵称或关键词"
              class="!w-80"
              clearable
              @keyup.enter="doSearch"
            />
            <el-button type="primary" :loading="loading" @click="doSearch">查询</el-button>
          </div>
        </div>
      </template>
      <el-table :data="results" v-loading="loading">
        <el-table-column prop="nickname" label="昵称" min-width="140" />
        <el-table-column prop="db_names" label="库内别名" min-width="180">
          <template #default="{ row }">{{ row.db_names?.join(', ') || '-' }}</template>
        </el-table-column>
        <el-table-column prop="streamer_name" label="主播" width="120">
          <template #default="{ row }">{{ row.streamer_name || '-' }}</template>
        </el-table-column>
        <el-table-column prop="actions" label="行为" min-width="160">
          <template #default="{ row }">{{ row.actions?.join('、') || '-' }}</template>
        </el-table-column>
        <el-table-column label="操作" width="120" fixed="right">
          <template #default="{ row }">
            <el-button
              size="small"
              type="primary"
              @click="router.push(`/douyin/profile/${row.sec_uid}`)"
            >
              画像
            </el-button>
          </template>
        </el-table-column>
      </el-table>
      <el-empty v-if="searched && !results.length && !loading" description="未找到匹配用户" />
    </el-card>
  </div>
</template>

<script setup lang="ts">
  import { ref } from 'vue'
  import { useRouter } from 'vue-router'
  import { anonymousLookup } from '@/api/douyin'

  defineOptions({ name: 'DouyinSearch' })

  const router = useRouter()
  const query = ref('')
  const results = ref<any[]>([])
  const loading = ref(false)
  const searched = ref(false)

  async function doSearch() {
    if (!query.value.trim()) return
    loading.value = true
    searched.value = true
    try {
      results.value = await anonymousLookup(query.value.trim())
    } finally {
      loading.value = false
    }
  }
</script>
