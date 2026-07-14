/**
 * Toast composable — 单例模式，任何组件可直接调用
 * 用法：const { toast } = useToast(); toast('操作成功', 'success')
 */
import { ref, computed } from 'vue'

const toastMsg = ref('')
const toastType = ref('')
const toastClasses = computed(() => ({
  show: toastMsg.value !== '',
  success: toastType.value === 'success',
  error: toastType.value === 'error'
}))

let _timer: ReturnType<typeof setTimeout> | null = null

function toast(msg: string, type = '') {
  toastMsg.value = msg
  toastType.value = type
  if (_timer) clearTimeout(_timer)
  _timer = setTimeout(() => { toastMsg.value = ''; toastType.value = '' }, 3000)
}

export function useToast() {
  return { toastMsg, toastType, toastClasses, toast }
}
