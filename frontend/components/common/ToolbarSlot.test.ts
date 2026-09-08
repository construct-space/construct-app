// @vitest-environment jsdom
/* eslint-disable vue/one-component-per-file -- inline defineComponent test
   harnesses, one per test case; the SFC rule doesn't apply here. */
import { beforeEach, describe, expect, it } from 'vitest'
import { defineComponent, nextTick, ref } from 'vue'
import { mount } from '@vue/test-utils'
import ToolbarSlot from './ToolbarSlot.vue'
import ToolbarSlotRenderer from './ToolbarSlotRenderer.vue'
import {
  clearToolbarSlots,
  useToolbarSlots,
} from '@/composables/useToolbarSlots'

function resetToolbarSlots() {
  clearToolbarSlots()
}

describe('ToolbarSlot', () => {
  beforeEach(() => {
    resetToolbarSlots()
  })

  it('renders registered page content through the host renderer', async () => {
    const Harness = defineComponent({
      components: { ToolbarSlot, ToolbarSlotRenderer },
      setup() {
        const { slotRight } = useToolbarSlots()
        return { slotRight }
      },
      template: `
        <ToolbarSlot name="right">
          <button class="probe">Run</button>
        </ToolbarSlot>
        <ToolbarSlotRenderer :slot-fn="slotRight" />
      `,
    })

    const wrapper = mount(Harness)
    await nextTick()

    expect(wrapper.find('.probe').text()).toBe('Run')
    wrapper.unmount()
  })

  it('does not let an outgoing page clear a newer owner for the same slot', async () => {
    const Harness = defineComponent({
      components: { ToolbarSlot, ToolbarSlotRenderer },
      setup() {
        const { slotRight } = useToolbarSlots()
        const showOld = ref(true)
        const showNew = ref(false)
        return { slotRight, showOld, showNew }
      },
      template: `
        <ToolbarSlot v-if="showOld" name="right">
          <span class="old-slot">Old</span>
        </ToolbarSlot>
        <ToolbarSlot v-if="showNew" name="right">
          <span class="new-slot">New</span>
        </ToolbarSlot>
        <ToolbarSlotRenderer :slot-fn="slotRight" />
      `,
    })

    const wrapper = mount(Harness)
    await nextTick()
    expect(wrapper.find('.old-slot').exists()).toBe(true)

    ;(wrapper.vm as unknown as { showNew: boolean }).showNew = true
    await nextTick()
    expect(wrapper.find('.new-slot').exists()).toBe(true)

    ;(wrapper.vm as unknown as { showOld: boolean }).showOld = false
    await nextTick()
    expect(wrapper.find('.new-slot').exists()).toBe(true)
    expect(wrapper.find('.old-slot').exists()).toBe(false)

    wrapper.unmount()
  })

  it('clears all registered slot content on route-level reset', async () => {
    const Harness = defineComponent({
      components: { ToolbarSlot, ToolbarSlotRenderer },
      setup() {
        const { slotCenter, slotRight } = useToolbarSlots()
        return { slotCenter, slotRight, clearToolbarSlots }
      },
      template: `
        <ToolbarSlot name="center"><span class="center-slot">Center</span></ToolbarSlot>
        <ToolbarSlot name="right"><span class="right-slot">Right</span></ToolbarSlot>
        <ToolbarSlotRenderer :slot-fn="slotCenter" />
        <ToolbarSlotRenderer :slot-fn="slotRight" />
        <button class="clear" @click="clearToolbarSlots()">Clear</button>
      `,
    })

    const wrapper = mount(Harness)
    await nextTick()
    expect(wrapper.find('.center-slot').exists()).toBe(true)
    expect(wrapper.find('.right-slot').exists()).toBe(true)

    await wrapper.find('.clear').trigger('click')
    await nextTick()

    expect(wrapper.find('.center-slot').exists()).toBe(false)
    expect(wrapper.find('.right-slot').exists()).toBe(false)
    wrapper.unmount()
  })
})
