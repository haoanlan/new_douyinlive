/**
 * DatePicker composable — 日期选择器逻辑
 * 模板保留在 HomeView 中，这里只管状态和函数
 */
import { ref, reactive, computed, nextTick } from 'vue'

export function useDatePicker() {
  const dpOverlayVisible = ref(false)
  const dpState = reactive({ type: '' as string, year: 0, month: 0, day: 0, temp: null as string | null })
  const dpData = reactive({ from: null as string | null, to: null as string | null })

  const dpTitleText = computed(() => {
    const months = ['1月', '2月', '3月', '4月', '5月', '6月', '7月', '8月', '9月', '10月', '11月', '12月']
    return `${dpState.year}年 ${months[dpState.month]}`
  })

  const dpDaysHtml = computed(() => {
    const { year, month } = dpState
    const firstDay = new Date(year, month, 1).getDay()
    const daysInMonth = new Date(year, month + 1, 0).getDate()
    const today = new Date()
    const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`
    const selectedStr = dpState.temp

    let html = ''
    const prevDays = new Date(year, month, 0).getDate()
    for (let i = firstDay - 1; i >= 0; i--) {
      html += `<button class="dp-day other" disabled>${prevDays - i}</button>`
    }
    for (let d = 1; d <= daysInMonth; d++) {
      const ds = `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`
      const cls = [ds === todayStr ? 'today' : '', ds === selectedStr ? 'selected' : ''].filter(Boolean).join(' ')
      html += `<button class="dp-day ${cls}" data-date="${ds}">${d}</button>`
    }
    const total = firstDay + daysInMonth
    const remaining = total % 7 === 0 ? 0 : 7 - (total % 7)
    for (let i = 1; i <= remaining; i++) {
      html += `<button class="dp-day other" disabled>${i}</button>`
    }
    return html
  })

  function dpOpen(type: string) {
    dpState.type = type
    const val = dpData[type as keyof typeof dpData]
    const now = val ? new Date(val + 'T00:00:00') : new Date()
    dpState.year = now.getFullYear()
    dpState.month = now.getMonth()
    dpState.day = val ? now.getDate() : 0
    dpState.temp = val
    dpOverlayVisible.value = true
    nextTick(() => {
      const dpDays = document.getElementById('dpDays')
      if (dpDays) {
        dpDays.querySelectorAll('.dp-day:not(.other):not(:disabled)').forEach(btn => {
          btn.addEventListener('click', () => {
            dpState.temp = (btn as HTMLElement).dataset.date || null
          })
        })
      }
    })
  }

  function dpClose() { dpOverlayVisible.value = false }

  function dpNav(dir: number) {
    dpState.month += dir
    if (dpState.month > 11) { dpState.month = 0; dpState.year++ }
    if (dpState.month < 0) { dpState.month = 11; dpState.year-- }
  }

  function dpConfirm() {
    const type = dpState.type
    const val = dpState.temp
    dpData[type as keyof typeof dpData] = val
    dpClose()
  }

  function dpClear() { dpState.temp = null }

  function clearDateFilter() {
    dpData.from = null
    dpData.to = null
  }

  return {
    dpOverlayVisible, dpData, dpTitleText, dpDaysHtml,
    dpOpen, dpClose, dpNav, dpConfirm, dpClear, clearDateFilter
  }
}
