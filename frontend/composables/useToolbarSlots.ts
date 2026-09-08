/**
 * useToolbarSlots — registry for ToolbarSlot content.
 *
 * Replaces the Teleport-based approach. The previous design teleported slot
 * content into DOM divs inside the rotating cube — the cube's 3D rotation
 * would hide the slot's face, so navigating between pages left toolbar
 * content stale until a full refresh.
 *
 * Pages now mount <ToolbarSlot name="…">…</ToolbarSlot>, which registers
 * the default slot function here. Toolbar3D renders these via a tiny
 * render helper, in a fixed overlay outside the rotating wrapper, so
 * the content is always visible and updates as the source page changes.
 *
 * Ownership: each ToolbarSlot instance gets a Symbol on mount and only
 * clears the registry on unmount if it is the current owner. This avoids
 * the unmount of the outgoing page wiping content the newly-mounted page
 * just registered.
 */
import { shallowRef, type Slot } from 'vue'

type SlotName = 'left' | 'center' | 'right'

const slots: Record<SlotName, ReturnType<typeof shallowRef<Slot | null>>> = {
  left: shallowRef<Slot | null>(null),
  center: shallowRef<Slot | null>(null),
  right: shallowRef<Slot | null>(null),
}

const owners: Record<SlotName, symbol | null> = {
  left: null,
  center: null,
  right: null,
}

export function registerToolbarSlot(name: SlotName, owner: symbol, slot: Slot | null) {
  owners[name] = owner
  slots[name].value = slot
}

export function unregisterToolbarSlot(name: SlotName, owner: symbol) {
  if (owners[name] === owner) {
    owners[name] = null
    slots[name].value = null
  }
}

export function clearToolbarSlots() {
  for (const name of ['left', 'center', 'right'] as const) {
    owners[name] = null
    slots[name].value = null
  }
}

export function useToolbarSlots() {
  return {
    slotLeft: slots.left,
    slotCenter: slots.center,
    slotRight: slots.right,
  }
}
