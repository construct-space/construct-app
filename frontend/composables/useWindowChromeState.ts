import { computed, ref } from 'vue'

const isChromeHidden = ref(false)

export function useWindowChromeState() {
  const isWindowChromeHidden = computed(() => isChromeHidden.value)

  const setWindowChromeHidden = (value: boolean) => {
    isChromeHidden.value = value
  }

  return {
    isWindowChromeHidden,
    setWindowChromeHidden,
  }
}

