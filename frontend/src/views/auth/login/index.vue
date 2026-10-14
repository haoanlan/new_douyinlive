<!-- 登录页面 -->
<template>
  <div class="flex w-full h-screen">
    <LoginLeftView />

    <div class="relative flex-1">
      <AuthTopBar />

      <div class="auth-right-wrap">
        <div class="form">
          <h3 class="title">{{ $t('login.title') }}</h3>
          <p class="sub-title">{{ $t('login.subTitle') }}</p>
          <ElForm
            ref="formRef"
            :model="formData"
            :rules="rules"
            :key="formKey"
            @keyup.enter="handleSubmit"
            style="margin-top: 25px"
          >
            <ElFormItem prop="username">
              <ElInput
                class="custom-height"
                :placeholder="$t('login.placeholder.username')"
                v-model.trim="formData.username"
                autocomplete="username"
              />
            </ElFormItem>
            <ElFormItem prop="password">
              <ElInput
                class="custom-height"
                :placeholder="$t('login.placeholder.password')"
                v-model.trim="formData.password"
                type="password"
                autocomplete="off"
                show-password
              />
            </ElFormItem>

            <!-- 推拽验证 -->
            <div class="relative pb-5 mt-6">
              <div
                class="relative z-[2] overflow-hidden select-none rounded-lg border border-transparent tad-300"
                :class="{ '!border-[#FF4E4F]': !isPassing && isClickPass }"
              >
                <ArtDragVerify
                  ref="dragVerify"
                  v-model:value="isPassing"
                  :text="$t('login.sliderText')"
                  textColor="var(--art-gray-700)"
                  :successText="$t('login.sliderSuccessText')"
                  progressBarBg="var(--main-color)"
                  :background="isDark ? '#26272F' : '#F1F1F4'"
                  handlerBg="var(--default-box-color)"
                />
              </div>
              <p
                class="absolute top-0 z-[1] px-px mt-2 text-xs text-[#f56c6c] tad-300"
                :class="{ 'translate-y-10': !isPassing && isClickPass }"
              >
                {{ $t('login.placeholder.slider') }}
              </p>
            </div>

            <div class="flex-cb mt-2 text-sm">
              <!-- 密码不做任何记住（令牌每次启动都会失效），这里只说明用户名已带出来 -->
              <span class="text-xs text-g-500">{{
                formData.username ? `已带出上次登录的用户名：${formData.username}` : '请输入用户名与密码'
              }}</span>
              <button
                type="button"
                class="dy-link-reset text-xs text-g-700 c-p"
                @click="showResetHelp = !showResetHelp"
              >
                忘记密码？
              </button>
            </div>

            <div style="margin-top: 30px">
              <ElButton
                class="w-full custom-height"
                type="primary"
                @click="handleSubmit"
                :loading="loading"
                v-ripple
              >
                {{ $t('login.btnText') }}
              </ElButton>
            </div>

            <!--
              登录页说明。
              原来这里是三行平铺的灰字，其中最后一行是 **运维指令**
              （`node scripts/reset-dashboard-password.js 新密码`）——
              登录页是**未登录**就能看到的页面，把服务端命令摊在这里，
              等于向任何打开页面的人暴露内部脚本路径；对普通使用者也没有意义。
              现在：面向使用者的说明（令牌策略）保持常显，
              面向管理员的重置方法收进上面的「忘记密码？」点击展开 ——
              需要它的人正是在登录页进不来的时候，够得着；不需要的人不会被它干扰。
            -->
            <div class="mt-5 text-xs leading-5 text-g-600">
              <p class="m-0 flex items-start gap-1.5">
                <ArtSvgIcon icon="ri:information-line" class="mt-0.5 shrink-0" />
                <span>
                  登录令牌只在本次运行期间有效，因此<b>每次启动仪表盘后都需要重新登录</b>。
                </span>
              </p>

              <div v-if="showResetHelp" class="dy-reset-help mt-2.5">
                <p class="m-0">忘记密码时，在<b>运行仪表盘的那台机器</b>的项目目录执行：</p>
                <code class="pc-code">node scripts/reset-dashboard-password.js 新密码</code>
                <p class="m-0 mt-1.5">
                  执行后立即生效、无需重启；账号名为 <b>admin</b>（其它账号可在登录后的
                  「账号管理」里重置）。
                </p>
              </div>
            </div>
          </ElForm>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
  import AppConfig from '@/config'
  import { useUserStore } from '@/store/modules/user'
  import { useI18n } from 'vue-i18n'
  import { fetchLogin } from '@/api/auth-douyin'
  import { ElMessage, ElNotification, type FormInstance, type FormRules } from 'element-plus'
  import { useSettingStore } from '@/store/modules/setting'

  defineOptions({ name: 'Login' })

  const settingStore = useSettingStore()
  const { isDark } = storeToRefs(settingStore)
  const { t, locale } = useI18n()
  const formKey = ref(0)

  // 监听语言切换，重置表单
  watch(locale, () => {
    formKey.value++
  })

  const dragVerify = ref()

  const userStore = useUserStore()
  const router = useRouter()
  const route = useRoute()
  const isPassing = ref(false)
  const isClickPass = ref(false)

  const systemName = AppConfig.systemInfo.name
  const formRef = ref<FormInstance>()

  /**
   * 登录表单。
   *
   * 原来这里有个「管理员 / 游客」下拉，把 admin/123456 直接预填进表单 ——
   * 等于把默认口令写在页面上，谁点一下都能进。已去掉，改成手输用户名密码。
   */
  const formData = reactive({
    username: '',
    password: ''
  })

  /** 上次登录的用户名（只记用户名，不记密码） */
  const LAST_USER_KEY = 'douyin-dashboard-last-user'

  const rules = computed<FormRules>(() => ({
    username: [{ required: true, message: t('login.placeholder.username'), trigger: 'blur' }],
    password: [{ required: true, message: t('login.placeholder.password'), trigger: 'blur' }]
  }))

  const loading = ref(false)

  /**
   * 「忘记密码？」展开状态。
   * 重置口令的命令属于**运维指令**，默认不摊在登录页上（未登录页面不该暴露服务端内部命令），
   * 但忘记密码的人正是在这个页面进不来 —— 所以做成点击展开，够得着又不打扰。
   */
  const showResetHelp = ref(false)

  onMounted(() => {
    // 清除残留的旧登录态（仅清状态，不跳转，避免守卫循环）
    if (userStore.isLogin) {
      userStore.setLoginStatus(false)
      userStore.setToken('')
      userStore.setUserInfo({} as any)
    }
    // 带出上次登录的用户名，省得每次手打（密码不记住）
    try {
      const last = localStorage.getItem(LAST_USER_KEY)
      if (last) formData.username = last
    } catch {
      /* 隐私模式下 localStorage 可能不可用 */
    }
  })

  // 登录
  const handleSubmit = async () => {
    if (!formRef.value) return

    try {
      // 表单验证
      const valid = await formRef.value.validate()
      if (!valid) return

      // 拖拽验证
      if (!isPassing.value) {
        isClickPass.value = true
        return
      }

      loading.value = true

      // 真实登录接口（401 由拦截器统一处理）
      const { token, refreshToken, roles, userId, userName } = await fetchLogin({
        userName: formData.username,
        password: formData.password
      })

      // 存储 token 和登录状态
      userStore.setToken(token, refreshToken)
      userStore.setUserInfo({ userId, userName, roles } as any)
      userStore.setLoginStatus(true)

      // 记住用户名（只记用户名）
      try {
        localStorage.setItem(LAST_USER_KEY, userName)
      } catch {
        /* 忽略 */
      }

      // 登录成功处理
      showLoginSuccessNotice()

      // 获取 redirect 参数，如果存在则跳转到指定页面，否则跳转到首页
      // （只认站内、且不指向登录页本身的目标，避免 redirect 套娃把自己转回来）
      const raw = String(route.query.redirect || '')
      const redirect = raw && !raw.startsWith('/auth/login') ? raw : '/'
      router.push(redirect)
    } catch (error) {
      /*
       * 原来这里把错误吞掉了（只在 HttpError 分支写了句注释），
       * 密码输错时页面毫无反应，用户不知道是错在哪。
       * 现在把后端给的真实原因显出来。
       */
      const beMsg = (error as { backendMessage?: string })?.backendMessage
      const status = (error as { response?: { status?: number } })?.response?.status
      if (status === 401 && !beMsg) {
        ElMessage.error('用户名或密码错误')
      } else if (!beMsg) {
        ElMessage.error((error as Error)?.message || '登录失败，请稍后重试')
      }
      // 失败时把滑块复位，避免"验证通过"的假象
      isPassing.value = false
      resetDragVerify()
    } finally {
      loading.value = false
      if (isPassing.value) resetDragVerify()
    }
  }

  // 重置拖拽验证
  const resetDragVerify = () => {
    dragVerify.value.reset()
  }

  // 登录成功提示
  const showLoginSuccessNotice = () => {
    setTimeout(() => {
      ElNotification({
        title: t('login.success.title'),
        type: 'success',
        duration: 2500,
        zIndex: 10000,
        message: `${t('login.success.message')}, ${systemName}!`
      })
    }, 1000)
  }
</script>

<style scoped>
  @import './style.css';
</style>

<style lang="scss" scoped>
  :deep(.el-select__wrapper) {
    height: 40px !important;
  }

  /* 「忘记密码？」：做成链接观感（下划线只在 hover 出现，避免和正文抢注意力） */
  .dy-link-reset {
    padding: 0;
    border: 0;
    background: none;
    text-decoration: none;
    transition: color 150ms ease;
  }

  .dy-link-reset:hover,
  .dy-link-reset:focus-visible {
    color: var(--theme-color);
    text-decoration: underline;
  }

  /* 展开的重置说明：浅底 + 左边框，和常显的说明行区分开，一眼看出这是"另一类信息" */
  .dy-reset-help {
    padding: 10px 12px;
    border-left: 3px solid var(--theme-color);
    border-radius: 6px;
    background: var(--art-gray-100);
    line-height: 1.7;
  }

  .dy-reset-help .pc-code {
    display: inline-block;
    margin-top: 6px;
    word-break: break-all;
  }
</style>
