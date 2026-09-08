import { ref } from 'vue'

// Module-level ref so any caller gets the same instance — the modal is
// mounted once in DefaultLayout and opened from the double-right-shift
// handler there. Other call sites (e.g. a future toolbar button) can flip
// this same flag without wiring extra plumbing.
const open = ref(false)

export function useModelSwitcher() {
  return {
    open,
    show: () => { open.value = true },
    hide: () => { open.value = false },
    toggle: () => { open.value = !open.value },
  }
}
