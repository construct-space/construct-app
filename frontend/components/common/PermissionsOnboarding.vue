<script setup lang="ts">
/**
 * PermissionsOnboarding — first-run macOS permissions primer.
 *
 * Shown once per user, right after sign-in (before the guided tour),
 * only inside the Tauri desktop build. Lists every OS permission
 * Construct relies on and why.
 *
 * Notifications are the only permission we can request up-front with a
 * real OS prompt (via plugin-notification's `requestPermission`); the
 * row exposes a Grant button and reflects live status. Microphone,
 * speech recognition, camera, and folder access can't be pre-granted on
 * macOS — the system only shows its consent dialog when the API is first
 * invoked — so those rows are explanatory: they tell the user when the
 * prompt will appear and that it's optional. This matches Apple's HIG
 * (don't request hardware you're not about to use).
 *
 * The matching usage-description strings + entitlements live in
 * desktop/Info.plist and desktop/Entitlements.plist.
 */

import { ref, onMounted } from 'vue'
import { Bell, Mic, Camera, FolderOpen, Check } from 'lucide-vue-next'
import {
  isPermissionGranted,
  requestPermission,
} from '@tauri-apps/plugin-notification'

const emit = defineEmits<{
  /** User dismissed the primer (Done / close). Parent flips the seen flag. */
  done: []
}>()

const open = ref(true)

type NotifState = 'unknown' | 'granted' | 'denied' | 'requesting'
const notifState = ref<NotifState>('unknown')

onMounted(async () => {
  try {
    if (await isPermissionGranted()) notifState.value = 'granted'
  } catch {
    /* plugin unavailable — leave unknown, Grant button still tries */
  }
})

async function grantNotifications() {
  if (notifState.value === 'granted' || notifState.value === 'requesting') return
  notifState.value = 'requesting'
  try {
    const result = await requestPermission()
    notifState.value = result === 'granted' ? 'granted' : 'denied'
  } catch {
    notifState.value = 'denied'
  }
}

function finish() {
  open.value = false
  emit('done')
}
</script>

<template>
  <Modal v-model:open="open" :prevent-close="true" :close-on-click-outside="false">
    <template #header>
      <div class="flex items-center gap-3">
        <div class="flex h-9 w-9 items-center justify-center rounded-lg bg-[var(--app-accent)]/10">
          <Icon name="i-lucide-shield-check" class="h-5 w-5 text-[var(--app-accent)]" />
        </div>
        <div>
          <h3 class="text-base font-semibold text-[var(--app-foreground)]">Permissions</h3>
          <p class="text-xs text-[var(--app-muted)]">A quick look at what Construct uses on your Mac.</p>
        </div>
      </div>
    </template>

    <template #body>
      <div class="space-y-2.5">
        <!-- Notifications — the one permission we can request now. -->
        <div class="flex items-start gap-3 rounded-lg border border-[var(--app-border)] bg-[var(--app-background)] p-3">
          <div class="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-[var(--app-surface)]">
            <Bell class="h-4 w-4 text-[var(--app-foreground)]" />
          </div>
          <div class="min-w-0 flex-1">
            <p class="text-sm font-medium text-[var(--app-foreground)]">Notifications</p>
            <p class="text-xs text-[var(--app-muted)]">Mentions, replies, and updates appear as system banners and a dock badge.</p>
          </div>
          <div class="shrink-0 self-center">
            <span
              v-if="notifState === 'granted'"
              class="inline-flex items-center gap-1 rounded-md bg-green-500/10 px-2 py-1 text-xs font-medium text-green-600 dark:text-green-400"
            >
              <Check class="h-3.5 w-3.5" /> Granted
            </span>
            <span
              v-else-if="notifState === 'denied'"
              class="text-xs text-[var(--app-muted)]"
            >
              Enable in System Settings
            </span>
            <Button
              v-else
              size="sm"
              variant="outline"
              :loading="notifState === 'requesting'"
              @click="grantNotifications"
            >
              Grant
            </Button>
          </div>
        </div>

        <!-- The rest are TCC-on-use; explain only. -->
        <div class="flex items-start gap-3 rounded-lg border border-[var(--app-border)] bg-[var(--app-background)] p-3">
          <div class="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-[var(--app-surface)]">
            <Mic class="h-4 w-4 text-[var(--app-foreground)]" />
          </div>
          <div class="min-w-0 flex-1">
            <p class="text-sm font-medium text-[var(--app-foreground)]">Microphone &amp; speech</p>
            <p class="text-xs text-[var(--app-muted)]">For voice input in chat. macOS asks the first time you start a voice message.</p>
          </div>
          <span class="shrink-0 self-center text-xs text-[var(--app-muted)]">When used</span>
        </div>

        <div class="flex items-start gap-3 rounded-lg border border-[var(--app-border)] bg-[var(--app-background)] p-3">
          <div class="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-[var(--app-surface)]">
            <Camera class="h-4 w-4 text-[var(--app-foreground)]" />
          </div>
          <div class="min-w-0 flex-1">
            <p class="text-sm font-medium text-[var(--app-foreground)]">Camera</p>
            <p class="text-xs text-[var(--app-muted)]">Optional, for capturing images. macOS asks the first time you use it.</p>
          </div>
          <span class="shrink-0 self-center text-xs text-[var(--app-muted)]">When used</span>
        </div>

        <div class="flex items-start gap-3 rounded-lg border border-[var(--app-border)] bg-[var(--app-background)] p-3">
          <div class="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-[var(--app-surface)]">
            <FolderOpen class="h-4 w-4 text-[var(--app-foreground)]" />
          </div>
          <div class="min-w-0 flex-1">
            <p class="text-sm font-medium text-[var(--app-foreground)]">Files &amp; folders</p>
            <p class="text-xs text-[var(--app-muted)]">Desktop, Documents, and Downloads — for managing projects. macOS asks on first access.</p>
          </div>
          <span class="shrink-0 self-center text-xs text-[var(--app-muted)]">When used</span>
        </div>

        <p class="px-1 pt-1 text-xs text-[var(--app-muted)]">
          You can change any of these later in <span class="text-[var(--app-foreground)]">System Settings &rsaquo; Privacy &amp; Security</span>.
        </p>
      </div>
    </template>

    <template #footer>
      <div class="flex justify-end">
        <Button color="primary" @click="finish">Continue</Button>
      </div>
    </template>
  </Modal>
</template>
