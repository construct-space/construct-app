/**
 * useDropdownPosition
 * Detects available space around a trigger element and decides whether a
 * dropdown should open downward (default) or upward.
 *
 * Usage:
 *   const triggerRef = ref<HTMLElement>()
 *   const { openAbove, recalculate } = useDropdownPosition(triggerRef, 280)
 *   // call recalculate() just before opening the dropdown
 *   // bind :class="openAbove ? 'bottom-full mb-1' : 'top-full mt-1'" on the panel
 */
export function useDropdownPosition(
  triggerRef: Ref<HTMLElement | null | undefined>,
  dropdownHeight = 280,
) {
  const openAbove = ref(false)

  function recalculate() {
    const el = triggerRef.value
    if (!el) { openAbove.value = false; return }

    const rect = el.getBoundingClientRect()
    const spaceBelow = window.innerHeight - rect.bottom
    const spaceAbove = rect.top

    // Open above only when there isn't enough room below AND there's more room above
    openAbove.value = spaceBelow < dropdownHeight && spaceAbove > spaceBelow
  }

  return { openAbove, recalculate }
}
