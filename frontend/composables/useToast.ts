import { ref } from 'vue'

export interface Toast {
  id: string
  title: string
  description?: string
  color?: 'success' | 'error' | 'warning' | 'info'
  duration?: number
  action?: { label: string; onClick: () => void }
}

const toasts = ref<Toast[]>([])

let idCounter = 0

function add(toast: Omit<Toast, 'id'>) {
  const id = `toast-${++idCounter}-${Date.now()}`
  const duration = toast.duration ?? 5000

  toasts.value.push({ ...toast, id })

  if (duration > 0) {
    setTimeout(() => {
      remove(id)
    }, duration)
  }

  return id
}

function remove(id: string) {
  const index = toasts.value.findIndex((t) => t.id === id)
  if (index !== -1) {
    toasts.value.splice(index, 1)
  }
}

function clear() {
  toasts.value.splice(0, toasts.value.length)
}

export function useToast() {
  return {
    toasts,
    // Nuxt UI compat: expose add/remove/clear directly
    add,
    remove,
    clear,
    // Also keep nested toast object
    toast: { add, remove, clear },
  }
}
