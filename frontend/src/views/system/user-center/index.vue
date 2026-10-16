<!-- 个人中心页面 -->
<template>
  <div class="douyin-page dy-stagger w-full h-full p-0 bg-transparent border-none shadow-none">
    <!--
      窄屏堆叠用 .dy-stack-mobile（全局、无 layer，见 styles/custom/douyin-mobile.scss）。
      原来写的是 max-md:block —— 它和 .flex-b 同在 Tailwind 的 utilities 层里，
      而自定义类写在生成产物之后，同层里后者胜出，display 一直是 flex，
      右栏被压成宽度 0：手机上"账号信息 / 更改密码"整块看不见。
    -->
    <div class="relative flex-b mt-2.5 dy-stack-mobile">
      <!-- 左：账号卡片（全部是真实数据，原来这里是模板的假资料） -->
      <div class="w-112 mr-5 max-md:w-full max-md:mr-0">
        <div class="art-card-sm relative p-9 pb-6 overflow-hidden text-center">
          <!--
            头像（可换）。
            原来这里是个不能点、也没有任何入口的首字母色块 —— 页面上根本改不了头像。
            现在外面套一层 el-upload，只借它弹文件选择框：
            :auto-upload="false" 意味着 before-upload **不会**被调用（组件只在 autoUpload
            为真时才走 upload()），所以真正的处理放在 :on-change 里自己走
            （canvas 等比缩放 + 居中裁剪 + 上传，见 onAvatarPick）。
          -->
          <div class="uc-avatar-wrap relative z-10 w-24 h-24 mt-8 mx-auto">
            <ElUpload
              ref="avatarUploadRef"
              class="uc-avatar-upload"
              :auto-upload="false"
              :show-file-list="false"
              :disabled="avatarSaving"
              accept="image/png,image/jpeg,image/webp"
              :on-change="onAvatarPick"
            >
              <div
                class="uc-avatar c-p"
                :class="{ 'is-saving': avatarSaving }"
                title="点击更换头像"
              >
                <ElAvatar :size="96" :src="avatarUrl || undefined" class="uc-avatar__img">
                  {{ avatarText }}
                </ElAvatar>
                <!-- 常显的小相机角标：桌面端不 hover 也能看出这里可点 -->
                <div class="uc-avatar__badge">
                  <ArtSvgIcon icon="ri:camera-line" />
                </div>
                <div class="uc-avatar__mask">
                  <ArtSvgIcon
                    :icon="avatarSaving ? 'ri:loader-4-line' : 'ri:camera-line'"
                    :class="['text-xl', { 'uc-spin': avatarSaving }]"
                  />
                  <span class="mt-1 text-xs">{{ avatarSaving ? '上传中…' : '更换头像' }}</span>
                </div>
              </div>
            </ElUpload>
          </div>
          <h2 class="mt-5 text-xl font-medium text-g-900">{{ userInfo.userName || '—' }}</h2>
          <p class="mt-2 text-sm text-g-500">{{ roleLabel }}</p>

          <!--
            这里原来又铺了一遍 accountFacts（用户名/角色/创建时间/上次登录）——
            和右侧「账号信息」卡里的是**同一个数组**，同一屏出现两遍
            （实测：左卡 4 条 + 右栏 4 条 = 8 行）。而且它是一个左对齐的 300px 块
            塞在居中卡片里，缩进和上面的名字/角色都对不齐。
            现在左卡只做"身份摘要"：头像 + 用户名 + 角色 + 退出；完整资料只在右边列一次。
          -->
          <div class="mt-8 border-t border-g-300 pt-5">
            <ElButton class="w-full" plain @click="handleLogout">退出登录</ElButton>
          </div>
        </div>
      </div>

      <div class="flex-1 overflow-hidden max-md:w-full max-md:mt-3.5">
        <!-- 账号信息（只读：这些字段由后端账号表决定，不能在这里改） -->
        <div class="art-card-sm">
          <h1 class="px-5 py-4 text-xl font-normal border-b border-g-300">账号信息</h1>
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
              账号只有用户名 / 角色 / 密码 / 头像：<b>密码</b>在下方修改，<b>头像</b>点左边卡片上的头像即可更换。
            </p>
          </div>
        </div>

        <!-- 更改密码（真接口） -->
        <div class="art-card-sm my-5">
          <h1 class="px-5 py-4 text-xl font-normal border-b border-g-300">更改密码</h1>

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
  import {
    changePassword,
    fetchGetUserInfo,
    updateAvatar,
    type UserInfo
  } from '@/api/auth-douyin'
  import {
    ElMessage,
    ElMessageBox,
    type FormInstance,
    type FormRules,
    type UploadFile,
    type UploadInstance
  } from 'element-plus'

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

  /*
   * 头像 data URL。
   * 优先用页面自己拉的那份（detail，服务器最新），退回 store 里登录时那份 ——
   * 只读 store 的话，改完头像刷新前顶栏会不一致。
   */
  const avatarUrl = computed(() => String(detail.value.avatar || userInfo.value.avatar || ''))

  const avatarUploadRef = ref<UploadInstance>()
  const avatarSaving = ref(false)

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

  /**
   * 把用户选的图片等比缩放 + 居中裁剪成 size×size，导出 JPEG data URL。
   *
   * 为什么必须先在前端缩：后端存的是 data URL 原串，而手机直出的照片动辄 3~8MB，
   * base64 之后还要再涨 1/3 —— 既会被后端 300KB 上限直接拒掉，也会把库撑大。
   * 统一缩到 256×256 / JPEG 0.85：实测普通照片在这个尺寸下 15~40KB。
   *
   * 用 createObjectURL 而不是 FileReader：不必先把原图读成 base64，省一份内存。
   */
  function shrinkToSquareDataUrl(file: File, size: number): Promise<string> {
    return new Promise((resolve, reject) => {
      const objectUrl = URL.createObjectURL(file)
      const img = new Image()
      img.onload = () => {
        try {
          const canvas = document.createElement('canvas')
          canvas.width = size
          canvas.height = size
          const c = canvas.getContext('2d')
          if (!c) throw new Error('canvas 2d 不可用')
          // 居中裁剪：以原图较短边为边长，从中心取正方形再铺满画布
          const side = Math.min(img.naturalWidth, img.naturalHeight)
          const sx = (img.naturalWidth - side) / 2
          const sy = (img.naturalHeight - side) / 2
          // 有透明通道的图（PNG/WebP）先铺白底：JPEG 不支持透明，
          // 不铺的话透明区在 canvas 里是黑色，导出来就是一张黑边头像
          c.fillStyle = '#fff'
          c.fillRect(0, 0, size, size)
          c.drawImage(img, sx, sy, side, side, 0, 0, size, size)
          resolve(canvas.toDataURL('image/jpeg', 0.85))
        } catch (err) {
          reject(err)
        } finally {
          URL.revokeObjectURL(objectUrl)
        }
      }
      img.onerror = () => {
        URL.revokeObjectURL(objectUrl)
        reject(new Error('图片解码失败'))
      }
      img.src = objectUrl
    })
  }

  /** 选好图片 → 本地缩放 → 上传；成功后就地更新页面与 store，失败给明确提示 */
  async function onAvatarPick(file: UploadFile) {
    const raw = file?.raw
    // 无论成败都要清掉内部 fileList：:auto-upload="false" 不会自己清，
    // 攒着会让"再选一次同一张图"被当成同一份文件
    const cleanup = () => {
      avatarUploadRef.value?.clearFiles()
      avatarSaving.value = false
    }
    if (!raw) {
      cleanup()
      return
    }
    if (!/^image\/(png|jpeg|webp)$/.test(raw.type)) {
      ElMessage.error('只支持 PNG / JPG / WebP 格式的图片')
      cleanup()
      return
    }

    avatarSaving.value = true
    let dataUrl = ''
    try {
      dataUrl = await shrinkToSquareDataUrl(raw, 256)
    } catch {
      // 本地处理失败（解码失败、canvas 被禁用等）—— 拦截器管不到，必须自己提示
      ElMessage.error('这张图片处理失败了，请换一张重试')
      cleanup()
      return
    }

    try {
      const res = await updateAvatar(dataUrl)
      const saved = res?.avatar || dataUrl
      detail.value = { ...detail.value, avatar: saved }
      // store 是持久化（localStorage）的那份，顶栏头像读的就是它 —— 同步过去，
      // 否则改完头像顶栏要等下次刷新才变
      userStore.setUserInfo({ ...userInfo.value, avatar: saved } as Api.Auth.UserInfo)
      ElMessage.success('头像已更新')
    } catch {
      // 失败原因（体积超限、格式不支持等）已由 HTTP 拦截器弹出后端原文，这里不再重复提示
    } finally {
      cleanup()
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

<style scoped>
  /*
   * 头像这一块的样式（页面级，写在自己的 <style scoped> 里，不动全局的 douyin-mobile.scss）。
   * 颜色只用项目现有变量：--main-color（主题色）、--art-gray-300（灰阶）、--default-box-color（卡片底色），
   * 过渡时间 0.2s 与卡片 hover 一致，不引入新的圆角/阴影/动效体系，也不加插画。
   */
  .uc-avatar-wrap :deep(.el-upload) {
    display: block;
  }

  .uc-avatar {
    position: relative;
    width: 96px;
    height: 96px;
    border-radius: 50%;
    /* 没设头像时，底下就是原来那个主题色 + 首字母的颜色 */
    background: var(--main-color);
    transition: box-shadow 0.2s;
  }
  /*
   * 这里**不能**给 .uc-avatar 加 overflow:hidden。
   * 加了以后右下角的相机角标会被圆形裁成一个月牙（实测截图里就是这样），
   * 圆形裁剪交给 el-avatar 自己做（它自带 border-radius:50% + overflow:hidden 管住图片），
   * 遮罩再单独设成圆形即可。
   */

  /* 96×96：桌面端是 hover 反馈，同时也满足移动端巡检"方形控件 ≥40px"的口径 */
  .uc-avatar:hover,
  .uc-avatar:focus-visible {
    box-shadow: 0 0 0 3px var(--art-gray-300);
  }

  .uc-avatar :deep(.el-avatar) {
    --el-avatar-bg-color: var(--main-color);
    width: 100%;
    height: 100%;
    font-size: 30px;
    color: #fff;
    overflow: hidden;
    border-radius: 50%;
  }

  .uc-avatar__mask {
    position: absolute;
    inset: 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    color: #fff;
    background: rgba(0, 0, 0, 0.45);
    border-radius: 50%;
    opacity: 0;
    transition: opacity 0.2s;
  }

  .uc-avatar:hover .uc-avatar__mask,
  .uc-avatar.is-saving .uc-avatar__mask {
    opacity: 1;
  }
  /*
   * 触屏没有 hover：遮罩不常显（常显会把头像一直压暗），靠右下角的相机角标提示可点 ——
   * 点一下直接弹文件框，入口本身没丢；上传中仍然会亮出遮罩当 loading。
   */

  .uc-avatar__badge {
    position: absolute;
    right: -2px;
    bottom: -2px;
    display: flex;
    align-items: center;
    justify-content: center;
    width: 28px;
    height: 28px;
    font-size: 15px;
    color: #fff;
    background: var(--main-color);
    border-radius: 50%;
    /* 用卡片底色描一圈：角标压在头像边缘上也有分隔，浅色/深色模式都成立 */
    box-shadow: 0 0 0 2px var(--default-box-color);
  }

  /* 上传中的 loading 反馈（与遮罩里的"上传中…"配合） */
  .uc-spin {
    animation: uc-spin 1s linear infinite;
  }

  @keyframes uc-spin {
    to {
      transform: rotate(360deg);
    }
  }
</style>
