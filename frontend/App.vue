<script setup lang="ts">
import { shallowRef, onMounted, type Component } from 'vue'
import { resolveWindowType } from '@/lib/window/windowType'
import MainShell from '@/shells/MainShell.vue'
import SpacePreviewShell from '@/shells/SpacePreviewShell.vue'
import WebPreviewShell from '@/shells/WebPreviewShell.vue'
import DetachShell from '@/shells/DetachShell.vue'

const shells: Partial<Record<string, Component>> = {
  main: MainShell,
  'space-preview': SpacePreviewShell,
  'web-preview': WebPreviewShell,
  detach: DetachShell,
}

const shell = shallowRef<Component | null>(null)

// Default to MainShell so the app never renders blank if window-type
// detection is slow or fails. Per-window overrides happen below in onMounted.
shell.value = MainShell

onMounted(async () => {
  // Remove HTML splash (#splash in index.html) up-front. Splash visibility
  // must NOT depend on window-type detection (which awaits a Tauri call
  // that can hang) — the Vue splash inside MainShell takes over the
  // boot-progress UX from here.
  const splash = document.getElementById('splash')
  if (splash) {
    splash.style.transition = 'opacity 0.2s ease'
    splash.style.opacity = '0'
    setTimeout(() => splash.remove(), 200)
  }

  // Resolve actual window type. If detection hangs or throws, MainShell is
  // already mounted (set above) and the user sees the proper boot path.
  try {
    const type = await resolveWindowType()
    const next = shells[type]
    if (next && next !== shell.value) shell.value = next
  } catch {
    // Stay on MainShell.
  }
})
</script>

<template>
  <component :is="shell" v-if="shell" />
</template>
