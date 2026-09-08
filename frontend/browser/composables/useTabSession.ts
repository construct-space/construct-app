import { ref, computed } from 'vue'

export interface ClosedTabEntry {
  url: string
  title: string
}

export function useTabSession() {
  const closedTabs = ref<ClosedTabEntry[]>([])
  const MAX_CLOSED = 10

  function pushClosed(tab: ClosedTabEntry) {
    closedTabs.value.unshift(tab)
    if (closedTabs.value.length > MAX_CLOSED) {
      closedTabs.value = closedTabs.value.slice(0, MAX_CLOSED)
    }
  }

  function popClosed(): ClosedTabEntry | null {
    return closedTabs.value.shift() || null
  }

  function canReopen(): boolean {
    return closedTabs.value.length > 0
  }

  function clear() {
    closedTabs.value = []
  }

  return {
    closedTabs: computed(() => closedTabs.value),
    pushClosed,
    popClosed,
    canReopen,
    clear,
  }
}
