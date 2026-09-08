<script lang="ts">
import { defineComponent, type Slot, type PropType } from 'vue'

/**
 * Renders a slot function (registered via useToolbarSlots).
 *
 * Implemented as an explicit render component instead of `<component :is>`
 * so it has a stable identity — Vue does not remount it when the parent
 * re-renders. Calls the slot function during render; reactivity in the
 * source component flows through normally.
 */
export default defineComponent({
  name: 'ToolbarSlotRenderer',
  props: {
    // Named slotFn (not `slot`) — a bare `slot` prop trips
    // vue/no-deprecated-slot-attribute even when bound.
    slotFn: {
      type: Function as unknown as PropType<Slot | null | undefined>,
      default: null,
    },
  },
  setup(props) {
    return () => (props.slotFn ? props.slotFn() : null)
  },
})
</script>
