<!-- 个人中心页面 -->
<template>
  <div class="douyin-page dy-stagger w-full h-full p-0 bg-transparent border-none shadow-none">
    <div class="relative flex-b mt-2.5 max-md:block max-md:mt-1">
      <!-- 左：账号卡片（全部是真实数据，原来这里是模板的假资料） -->
      <div class="w-112 mr-5 max-md:w-full max-md:mr-0">
        <div class="art-card-sm relative p-9 pb-6 overflow-hidden text-center">
          <div
            class="relative z-10 w-20 h-20 mt-8 mx-auto rounded-full flex-cc text-2xl font-medium text-white"
            style="background: var(--main-color)"
          >
            {{ avatarText }}
          </div>
          <h2 class="mt-5 text-xl font-normal">{{ userInfo.userName || '—' }}</h2>
          <p class="mt-2 text-sm text-g-500">{{ roleLabel }}</p>

          <div class="w-75 mx-auto mt-7.5 text-left">
            <div v-for="f in accountFacts" :key="f.label" class="flex items-start gap-2 mt-3">
              <ArtSvgIcon :icon="f.icon" class="text-g-700 mt-0.5 shrink-0" />
              <span class="min-w-0 flex-1">
                <span class="block text-xs text-g-500">{{ f.label }}</span>
                <span class="block text-sm break-all">{{ f.value }}</span>
              </span>
            </div>
          </div>

          <div class="mt-8">
            <ElButton class="w-full" @click="handleLogout">退出登录</ElButton>
          </div>
        </div>
      </div>

      <div class="flex-1 overflow-hidden max-md:w-full max-md:mt-3.5">
        <!-- 账号信息（只读：这些字段由后端账号表决定，不能在这里改） -->
        <div class="art-card-sm">
          <h1 class="p-4 text-xl font-normal border-b border-g-300">账号信息</h1>
          <div class="p-5">
            <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div v-for="f in accountFacts" :key="f.label" class="mon-kv">
                <div class="mon-kv__label">{{ f.label }}</div>
                <div class="mon-kv__value text-g-900" :title="f.value">{{ f.value }}</div>
              </div>
            </div>

            <el-alert
              class="mt-4"
              type="info"
              :closable="false"
              show-icon
              :title="tokenPolicy"
            />

            <p class="mt-3 mb-0 text-xs leading-5 text-g-500">
              账号只有用户名 / 角色 / 密码三项，没有昵称、邮箱、头像这些资料 ——
              所以这里不做"保存资料"的表单（原来那个表单填了也不会存到任何地方）。
            </p>
          </div>
        </div>

        <!-- 更改密码（真接口） -->
        <div class="art-card-sm my-5">
          <h1 class="p-4 text-xl font-normal border-b border-g-300">更改密码</h1>

          <ElForm
            ref="pwdFormRef"
            :model="pwdForm"
            :rules="pwdRules"
            class="box-border p-5"
            label-width="86px"
            label-position="top"
          >
            <ElFormItem label="当前密码" prop="oldPassword">
              <ElInput
                v-model="pwdForm.oldPassword"
                type="password"
                show-password
                autocomplete="current-password"
                placeholder="登录时用的密码"
              />
            </ElFormItem>

            <ElFormItem label="新密码" prop="newPassword">
              <ElInput
                v-model="pwdForm.newPassword"
                type="password"
                show-password
                autocomplete="new-password"
                placeholder="至少 6 位"
              />
            </ElFormItem>

            <ElFormItem label="确认新密码" prop="confirmPassword">
              <ElInput
                v-model="pwdForm.confirmPassword"
                type="password"
                show-password
                autocomplete="new-password"
                placeholder="再输一次"
              />
            </ElFormItem>

            <div class="flex-c justify-end">
              <ElButton type="primary" :loading="saving" @click="submitPassword">
                保存新密码
              </ElButton>
            </div>
          </ElForm>

          <p class="px-5 pb-5 -mt-2 mb-0 text-xs leading-5 text-g-500">
            改完需要<b>用新密码重新登录</b>（登录令牌与本次运行绑定，改密码后旧会话一并作废）。
          </p>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
  import { useUserStore } from '@/store/modules/user'
  import { changePassword, fetchGetUserInfo, type UserInfo } from '@/api/auth-douyin'
  import { ElMessage, ElMessageBox, type FormInstance, type FormRules } from 'element-plus'

  defineOptions({ name: 'UserCenter' })

  const userStore = useUserStore()
  const userInfo = computed(() => userStore.getUserInfo)

  /** 页面自己再拉一次用户信息：store 里的是登录时那份，可能没有创建时间/上次登录 */
  const detail = ref<Partial<UserInfo>>({})

  const roleLabel = computed(() => {
    const role = detail.value.role || userInfo.value.roles?.[0] || ''
    if (role === 'R_SUPER') return '管理员（可配置代理与监控）'
    if (role === 'R_GUEST') return '普通用户（只读）'
    return role || '—'
  })

  const avatarText = computed(() => {
    const name = String(userInfo.value.userName || '?')
    return name.slice(0, 1).toUpperCase()
  })

  const tokenPolicy = computed(
    () =>
      detail.value.tokenPolicy ||
      '仪表盘每次启动后都需要重新登录（登录令牌只在本次运行期间有效）'
  )

  const accountFacts = computed(() => [
    { label: '用户名', value: userInfo.value.userName || '—', icon: 'ri:user-3-line' },
    { label: '角色', value: roleLabel.value, icon: 'ri:shield-user-line' },
    { label: '创建时间', value: detail.value.createTime || '—', icon: 'ri:calendar-line' },
    { label: '上次登录', value: detail.value.lastLoginTime || '—', icon: 'ri:history-line' }
  ])

  const pwdFormRef = ref<FormInstance>()
  const saving = ref(false)
  const pwdForm = reactive({ oldPassword: '', newPassword: '', confirmPassword: '' })

  const pwdRules = computed<FormRules>(() => ({
    oldPassword: [{ required: true, message: '请输入当前密码', trigger: 'blur' }],
    newPassword: [
      { required: true, message: '请输入新密码', trigger: 'blur' },
      { min: 6, max: 64, message: '新密码 6~64 位', trigger: 'blur' },
      {
        validator: (_r: unknown, v: string, cb: (e?: Error) => void) =>
          v && v === pwdForm.oldPassword ? cb(new Error('新密码不能与当前密码相同')) : cb(),
        trigger: 'blur'
      }
    ],
    confirmPassword: [
      { required: true, message: '请再输一次新密码', trigger: 'blur' },
      {
        validator: (_r: unknown, v: string, cb: (e?: Error) => void) =>
          v === pwdForm.newPassword ? cb() : cb(new Error('两次输入的新密码不一致')),
        trigger: 'blur'
      }
    ]
  }))

  async function loadDetail() {
    try {
      detail.value = await fetchGetUserInfo()
    } catch {
      /* 401 由拦截器处理；这里不额外提示 */
    }
  }

  async function submitPassword() {
    if (!pwdFormRef.value) return
    const valid = await pwdFormRef.value.validate().catch(() => false)
    if (!valid) return
    saving.value = true
    try {
      const res = await changePassword({
        oldPassword: pwdForm.oldPassword,
        newPassword: pwdForm.newPassword
      })
      ElMessage.success(res?.message || '密码已修改')
      pwdForm.oldPassword = ''
      pwdForm.newPassword = ''
      pwdForm.confirmPassword = ''
      // 令牌与旧密码无关，但为了不留旧会话，统一退出重登
      setTimeout(() => userStore.logOut(), 800)
    } catch {
      // 失败原因已由 HTTP 拦截器提示（例如"当前密码不正确"），这里只吞掉拒绝避免未捕获错误
    } finally {
      saving.value = false
    }
  }

  async function handleLogout() {
    try {
      await ElMessageBox.confirm('退出后需要重新输入用户名密码登录。', '确认退出登录？', {
        confirmButtonText: '退出登录',
        cancelButtonText: '取消',
        type: 'warning'
      })
    } catch {
      return
    }
    userStore.logOut()
  }

  onMounted(loadDetail)
  onActivated(loadDetail)
</script>
