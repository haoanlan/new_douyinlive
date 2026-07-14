/**
 * Confirm modal composable — 单例模式，任何组件可直接调用
 * 用法：const { showConfirm } = useConfirm(); const ok = await showConfirm('🗑️', '确定删除？')
 */
import { ref } from 'vue'

const confirmVisible = ref(false)
const confirmIcon = ref('')
const confirmText = ref('')
let _cb: ((val: boolean) => void) | null = null

function showConfirm(icon: string, html: string): Promise<boolean> {
  return new Promise(resolve => {
    _cb = resolve
    confirmIcon.value = icon
    confirmText.value = html
    confirmVisible.value = true
  })
}

function confirmResolve(val: boolean) {
  confirmVisible.value = false
  if (_cb) { _cb(val); _cb = null }
}

export function useConfirm() {
  return { confirmVisible, confirmIcon, confirmText, showConfirm, confirmResolve }
}
