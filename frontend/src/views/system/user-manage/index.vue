<!-- 用户管理（仅管理员可见） -->
<template>
  <div class="douyin-page dy-stagger p-4">
    <article class="art-card p-5">
      <div class="flex flex-wrap items-start justify-between gap-3">
        <div class="min-w-0">
          <h3 class="text-lg font-semibold text-g-900 m-0">用户管理</h3>
          <p class="mt-1 text-sm leading-6 text-g-600">
            仪表盘账号存在 <code class="pc-code">db/douyin.db</code> 的
            <code class="pc-code">dashboard_users</code> 表里；登录令牌每次启动重新签发，
            所以这里的改动（禁用 / 改密码）对**下一次登录**生效。
          </p>
        </div>
        <el-button type="primary" @click="openCreate">
          <ArtSvgIcon icon="ri:user-add-line" class="mr-1" />
          新增用户
        </el-button>
      </div>

      <div class="mt-4 flex flex-wrap items-center gap-3">
        <el-input
          v-model="keyword"
          placeholder="按用户名搜索"
          clearable
          class="!w-[240px]"
          @keyup.enter="load()"
          @clear="load()"
        >
          <template #prefix><ArtSvgIcon icon="ri:search-line" /></template>
        </el-input>
        <el-button @click="load()">
          <ArtSvgIcon icon="ri:refresh-line" class="mr-1" :class="loading ? 'dy-spin' : ''" />
          刷新
        </el-button>
        <span class="text-xs text-g-500">共 {{ total }} 个账号</span>
      </div>

      <el-table :data="rows" class="mt-4" v-loading="loading" empty-text="没有账号">
        <el-table-column label="用户名" min-width="160">
          <template #default="{ row }">
            <span class="font-medium text-g-900">{{ row.userName }}</span>
            <el-tag v-if="row.id === myId" size="small" effect="plain" class="ml-2">当前登录</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="角色" width="150">
          <template #default="{ row }">
            <el-select
              :model-value="row.userRoles?.[0]"
              size="small"
              class="!w-[120px]"
              @change="(v: string) => onRoleChange(row, v)"
            >
              <el-option label="管理员" value="R_SUPER" />
              <el-option label="普通用户" value="R_GUEST" />
            </el-select>
          </template>
        </el-table-column>
        <el-table-column label="状态" width="110">
          <template #default="{ row }">
            <el-switch
              :model-value="row.status === '1'"
              :disabled="row.id === myId"
              @change="(v: boolean) => onToggle(row, v)"
            />
          </template>
        </el-table-column>
        <el-table-column label="创建时间" width="180">
          <template #default="{ row }">
            <span class="text-xs text-g-600">{{ row.createTime || '—' }}</span>
          </template>
        </el-table-column>
        <el-table-column label="上次登录" width="180">
          <template #default="{ row }">
            <span class="text-xs text-g-600">{{ row.updateTime || '—' }}</span>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="190" align="right">
          <template #default="{ row }">
            <el-button size="small" plain @click="openReset(row)">重置密码</el-button>
            <el-button
              size="small"
              plain
              type="danger"
              :disabled="row.id === myId"
              @click="onDelete(row)"
            >
              删除
            </el-button>
          </template>
        </el-table-column>
      </el-table>
    </article>

    <!-- 新增用户 -->
    <el-dialog v-model="createOpen" title="新增用户" width="460px" :close-on-click-modal="false">
      <el-form ref="createRef" :model="createForm" :rules="createRules" label-position="top">
        <el-form-item label="用户名" prop="userName">
          <el-input v-model.trim="createForm.userName" placeholder="2~32 位，字母数字与 _ . @ -" />
        </el-form-item>
        <el-form-item label="密码" prop="password">
          <el-input v-model="createForm.password" type="password" show-password placeholder="至少 6 位" />
        </el-form-item>
        <el-form-item label="角色" prop="role">
          <el-select v-model="createForm.role" class="w-full">
            <el-option label="管理员（可配置代理与监控、管理账号）" value="R_SUPER" />
            <el-option label="普通用户（只读）" value="R_GUEST" />
          </el-select>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="createOpen = false">取消</el-button>
        <el-button type="primary" :loading="saving" @click="submitCreate">创建</el-button>
      </template>
    </el-dialog>

    <!-- 重置密码 -->
    <el-dialog v-model="resetOpen" title="重置密码" width="440px" :close-on-click-modal="false">
      <p class="m-0 text-sm text-g-700">
        为 <b>{{ resetTarget?.userName }}</b> 设置新密码（对方下次登录时使用）。
      </p>
      <el-form ref="resetRef" :model="resetForm" :rules="resetRules" label-position="top" class="mt-4">
        <el-form-item label="新密码" prop="newPassword">
          <el-input v-model="resetForm.newPassword" type="password" show-password placeholder="至少 6 位" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="resetOpen = false">取消</el-button>
        <el-button type="primary" :loading="saving" @click="submitReset">重置</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
  import { ElMessage, ElMessageBox, type FormInstance, type FormRules } from 'element-plus'
  import { useUserStore } from '@/store/modules/user'
  import {
    fetchUserList,
    createUser,
    updateUser,
    resetUserPassword,
    deleteUser,
    type UserListResult
  } from '@/api/auth-douyin'

  defineOptions({ name: 'UserManage' })

  const userStore = useUserStore()
  const myId = computed(() => Number(userStore.getUserInfo?.userId) || -1)

  const rows = ref<UserListResult['records']>([])
  const total = ref(0)
  const keyword = ref('')
  const loading = ref(false)
  const saving = ref(false)

  async function load() {
    if (loading.value) return
    loading.value = true
    try {
      const res = await fetchUserList({ current: 1, size: 100, userName: keyword.value })
      rows.value = res.records || []
      total.value = res.total || 0
    } finally {
      loading.value = false
    }
  }

  /* ---------- 新增 ---------- */
  const createOpen = ref(false)
  const createRef = ref<FormInstance>()
  const createForm = reactive({ userName: '', password: '', role: 'R_GUEST' })
  const createRules: FormRules = {
    userName: [
      { required: true, message: '请输入用户名', trigger: 'blur' },
      { min: 2, max: 32, message: '长度 2~32 位', trigger: 'blur' }
    ],
    password: [
      { required: true, message: '请输入密码', trigger: 'blur' },
      { min: 6, max: 64, message: '密码 6~64 位', trigger: 'blur' }
    ],
    role: [{ required: true, message: '请选择角色', trigger: 'change' }]
  }

  function openCreate() {
    createForm.userName = ''
    createForm.password = ''
    createForm.role = 'R_GUEST'
    createOpen.value = true
  }

  async function submitCreate() {
    const valid = await createRef.value?.validate().catch(() => false)
    if (!valid) return
    saving.value = true
    try {
      const r = await createUser({ ...createForm })
      ElMessage.success(r?.message || '已创建')
      createOpen.value = false
      await load()
    } catch {
      /* 原因由拦截器提示（例如"用户名已存在"） */
    } finally {
      saving.value = false
    }
  }

  /* ---------- 状态 / 角色 ---------- */
  async function onToggle(row: UserListResult['records'][number], enabled: boolean) {
    try {
      const r = await updateUser({ id: row.id, enabled })
      ElMessage.success(r?.message || '已更新')
    } catch {
      /* 失败时重载列表，把开关拨回真实状态 */
    }
    await load()
  }

  async function onRoleChange(row: UserListResult['records'][number], role: string) {
    try {
      const r = await updateUser({ id: row.id, role })
      ElMessage.success(r?.message || '已更新')
    } catch {
      /* 失败由拦截器提示 */
    }
    await load()
  }

  /* ---------- 重置密码 ---------- */
  const resetOpen = ref(false)
  const resetRef = ref<FormInstance>()
  const resetTarget = ref<UserListResult['records'][number] | null>(null)
  const resetForm = reactive({ newPassword: '' })
  const resetRules: FormRules = {
    newPassword: [
      { required: true, message: '请输入新密码', trigger: 'blur' },
      { min: 6, max: 64, message: '密码 6~64 位', trigger: 'blur' }
    ]
  }

  function openReset(row: UserListResult['records'][number]) {
    resetTarget.value = row
    resetForm.newPassword = ''
    resetOpen.value = true
  }

  async function submitReset() {
    const valid = await resetRef.value?.validate().catch(() => false)
    if (!valid || !resetTarget.value) return
    saving.value = true
    try {
      const r = await resetUserPassword({
        id: resetTarget.value.id,
        newPassword: resetForm.newPassword
      })
      ElMessage.success(r?.message || '已重置')
      resetOpen.value = false
    } catch {
      /* 由拦截器提示 */
    } finally {
      saving.value = false
    }
  }

  /* ---------- 删除 ---------- */
  async function onDelete(row: UserListResult['records'][number]) {
    try {
      await ElMessageBox.confirm(
        `删除账号 <b>${row.userName}</b>？删除后该账号无法再登录。`,
        '确认删除',
        {
          confirmButtonText: '删除',
          cancelButtonText: '取消',
          type: 'warning',
          dangerouslyUseHTMLString: true
        }
      )
    } catch {
      return
    }
    try {
      const r = await deleteUser({ id: row.id })
      ElMessage.success(r?.message || '已删除')
    } catch {
      /* 由拦截器提示（例如"最后一个管理员不能删除"） */
    }
    await load()
  }

  onMounted(load)
</script>
