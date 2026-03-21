import { computed, ref, watch } from 'vue'
import { IS_DEV_INSTANCE } from '@/lib/appPaths'

const DISABLE_UPDATES_KEY = 'construct_disable_updates'

const disableUpdates = ref(localStorage.getItem(DISABLE_UPDATES_KEY) === 'true')

watch(disableUpdates, (val) => {
  localStorage.setItem(DISABLE_UPDATES_KEY, String(val))
})

export function useDevMode() {
  /** True when running as dev instance (compile-time or --dev flag) */
  const isDevInstance = IS_DEV_INSTANCE

  /** True when updater should be disabled */
  const updaterDisabled = computed(() => IS_DEV_INSTANCE.value || import.meta.env.DEV || disableUpdates.value)

  return {
    isDevInstance,
    disableUpdates,
    updaterDisabled,
  }
}
