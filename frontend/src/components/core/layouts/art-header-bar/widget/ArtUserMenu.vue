<!-- 用户菜单 -->
<template>
  <ElPopover
    ref="userMenuPopover"
    placement="bottom-end"
    :width="240"
    :hide-after="0"
    :offset="10"
    trigger="hover"
    :show-arrow="false"
    popper-class="user-menu-popover"
    popper-style="padding: 5px 16px;"
  >
    <template #reference>
      <img
        class="size-8.5 mr-5 c-p rounded-full max-sm:w-6.5 max-sm:h-6.5 max-sm:mr-[16px]"
        :src="avatarUrl"
        alt="avatar"
      />
    </template>
    <template #default>
      <div class="pt-3">
        <div class="flex-c pb-1 px-0">
          <img
            class="w-10 h-10 mr-3 ml-0 overflow-hidden rounded-full float-left"
            :src="avatarUrl"
            alt="avatar"
          />
          <div class="w-[calc(100%-60px)] h-full">
            <span class="block text-sm font-medium text-g-800 truncate">{{
              userInfo.userName
            }}</span>
            <span class="block mt-0.5 text-xs text-g-500 truncate">{{ roleLabel }}</span>
          </div>
        </div>
        <ul class="py-4 mt-3 border-t border-g-300/80">
          <li class="btn-item" @click="goPage('/douyin/account')">
            <ArtSvgIcon icon="ri:user-3-line" />
            <span>{{ $t('topBar.user.userCenter') }}</span>
          </li>
          <li class="btn-item" @click="goPage('/douyin/status')">
            <ArtSvgIcon icon="ri:pulse-line" />
            <span>状态监控</span>
          </li>
          <li class="btn-item" @click="goPage('/douyin/rooms')">
            <ArtSvgIcon icon="ri:live-line" />
            <span>房间管理</span>
          </li>
          <!-- 只有管理员有账号管理权限（路由侧也按 roles 过滤） -->
          <li v-if="isSuper" class="btn-item" @click="goPage('/account/users')">
            <ArtSvgIcon icon="ri:user-settings-line" />
            <span>用户管理</span>
          </li>
          <li class="btn-item" @click="lockScreen()">
            <ArtSvgIcon icon="ri:lock-line" />
            <span>{{ $t('topBar.user.lockScreen') }}</span>
          </li>
          <div class="w-full h-px my-2 bg-g-300/80"></div>
          <div class="log-out c-p" @click="loginOut">
            {{ $t('topBar.user.logout') }}
          </div>
        </ul>
      </div>
    </template>
  </ElPopover>
</template>

<script setup lang="ts">
  import { useI18n } from 'vue-i18n'
  import { useRouter } from 'vue-router'
  import { ElMessageBox } from 'element-plus'
  import { useUserStore } from '@/store/modules/user'
  import { mittBus } from '@/utils/sys'
  import defaultAvatar from '@imgs/user/avatar.webp'

  defineOptions({ name: 'ArtUserMenu' })

  const router = useRouter()
  const { t } = useI18n()
  const userStore = useUserStore()

  const { getUserInfo: userInfo } = storeToRefs(userStore)
  const userMenuPopover = ref()

  /**
   * 顶栏头像。
   *
   * 原来这里写死的是模板自带的 avatar.webp（不是首字母色块），个人中心换了头像它也不会变 ——
   * 现在跟个人中心共用同一份数据：userInfo.avatar 有值就用它（data URL），没有才回落到默认图。
   * 登录/刷新时路由守卫会拉一次 /api/user/info 写进 store，所以刷新后这里也是新头像。
   */
  const avatarUrl = computed(() => userInfo.value.avatar || defaultAvatar)

  /** 这个项目没有昵称/邮箱字段，原来那行显示的是空的 userInfo.email —— 改成角色 */
  const roleLabel = computed(() => {
    const role = userInfo.value.roles?.[0] || ''
    if (role === 'R_SUPER') return '管理员'
    if (role === 'R_GUEST') return '普通用户'
    return role || ''
  })

  const isSuper = computed(() => (userInfo.value.roles?.[0] || '') === 'R_SUPER')

  /**
   * 页面跳转
   * @param {string} path - 目标路径
   */
  const goPage = (path: string): void => {
    closeUserMenu()
    router.push(path)
  }

  /**
   * 打开锁屏功能
   */
  const lockScreen = (): void => {
    mittBus.emit('openLockScreen')
  }

  /**
   * 用户登出确认
   */
  const loginOut = (): void => {
    closeUserMenu()
    setTimeout(() => {
      ElMessageBox.confirm(t('common.logOutTips'), t('common.tips'), {
        confirmButtonText: t('common.confirm'),
        cancelButtonText: t('common.cancel'),
        customClass: 'login-out-dialog'
      }).then(() => {
        userStore.logOut()
      })
    }, 200)
  }

  /**
   * 关闭用户菜单弹出层
   */
  const closeUserMenu = (): void => {
    setTimeout(() => {
      userMenuPopover.value.hide()
    }, 100)
  }
</script>

<style scoped>
  @reference '@styles/core/tailwind.css';

  @layer components {
    .btn-item {
      @apply flex items-center p-2 mb-3 select-none rounded-md cursor-pointer last:mb-0;

      span {
        @apply text-sm;
      }

      .art-svg-icon {
        @apply mr-2 text-base;
      }

      &:hover {
        background-color: var(--art-gray-200);
      }
    }
  }

  .log-out {
    @apply py-1.5
    mt-5
    text-xs
    text-center
    border
    border-g-400
    rounded-md
    transition-all
    duration-200
    hover:shadow-xl;
  }
</style>
