/**
 * Profile composable — 用户画像逻辑
 */
import { ref } from 'vue'

interface ProfileUser { user_sec_uid: string; nickname: string; avatar: string }

export function useProfile(api: (path: string) => Promise<any>, toast: (msg: string, type?: string) => void) {
  const profileInput = ref('')
  const profileUsers = ref<ProfileUser[]>([])
  const profileLoading = ref(false)
  const profileSearched = ref(false)

  function loadProfileView() {
    profileInput.value = ''
    profileUsers.value = []
    profileSearched.value = false
  }

  async function searchProfileUser() {
    const q = profileInput.value.trim()
    if (!q) return
    profileLoading.value = true
    profileSearched.value = true
    try {
      const users = await api(`/api/users/search?q=${encodeURIComponent(q)}`)
      profileUsers.value = users
    } catch (e: any) {
      toast('搜索失败: ' + e.message, 'error')
      profileUsers.value = []
    }
    profileLoading.value = false
  }

  return {
    profileInput, profileUsers, profileLoading, profileSearched,
    loadProfileView, searchProfileUser
  }
}
