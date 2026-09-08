<script setup lang="ts">
import { onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { Bell, BellOff, Check, X } from 'lucide-vue-next'
import { Button, Card, Empty, Switch } from '@construct-space/ui'
import { isPermissionGranted, requestPermission } from '@tauri-apps/plugin-notification'
import { isTauriEnv } from '@/utils/tauri'
import { useNotifications, type AppNotification } from '@/composables/useNotifications'

const router = useRouter()
const notif = useNotifications()
const isTauri = isTauriEnv()

const ENABLED_KEY = 'construct.notifications.enabled'
const enabled = ref(localStorage.getItem(ENABLED_KEY) !== 'false')

// OS-level notification permission (separate from the in-app toggle above:
// that controls our inbox/bridge; this is whether macOS lets us post
// system banners at all). Mirrors the first-run permissions primer.
type OsPerm = 'unknown' | 'granted' | 'denied' | 'requesting'
const osPerm = ref<OsPerm>('unknown')

async function refreshOsPerm() {
  if (!isTauri) return
  try {
    osPerm.value = (await isPermissionGranted()) ? 'granted' : 'denied'
  } catch {
    osPerm.value = 'unknown'
  }
}

async function grantOsPerm() {
  if (osPerm.value === 'granted' || osPerm.value === 'requesting') return
  osPerm.value = 'requesting'
  try {
    osPerm.value = (await requestPermission()) === 'granted' ? 'granted' : 'denied'
  } catch {
    osPerm.value = 'denied'
  }
}

watch(enabled, (val) => {
  localStorage.setItem(ENABLED_KEY, String(val))
  if (val) {
    notif.start()
    notif.refresh()
  } else {
    notif.stop()
  }
})

onMounted(() => {
  if (enabled.value) {
    notif.start()
    notif.refresh()
  }
  refreshOsPerm()
})

async function activate(n: AppNotification) {
  if (!n.read_at) await notif.markRead(n.id)
  if (n.link) router.push(n.link)
}

function relTime(iso: string): string {
  const d = new Date(iso).getTime()
  if (Number.isNaN(d)) return ''
  const diff = Math.max(0, Date.now() - d)
  const m = Math.floor(diff / 60_000)
  if (m < 1) return 'just now'
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  const day = Math.floor(h / 24)
  if (day < 7) return `${day}d ago`
  return new Date(iso).toLocaleDateString()
}
</script>

<template>
  <div class="space-y-4">
    <Card
      title="Notifications"
      description="Receive push notifications and alerts on this device. Includes mentions, invites, and system alerts."
    >
      <template #accessory>
        <Switch v-model="enabled" />
      </template>

      <!-- OS-level permission. Without this macOS suppresses banners even
           when the toggle above is on. -->
      <div
        v-if="isTauri"
        class="mt-3 flex items-center justify-between gap-3 rounded-lg border border-[var(--app-border)] bg-[var(--app-background)] p-3"
      >
        <div class="min-w-0">
          <p class="text-sm font-medium text-[var(--app-foreground)]">System permission</p>
          <p class="text-xs text-[var(--app-muted)]">Allow Construct to post banners and badge the dock.</p>
        </div>
        <span
          v-if="osPerm === 'granted'"
          class="inline-flex shrink-0 items-center gap-1 rounded-md bg-green-500/10 px-2 py-1 text-xs font-medium text-green-600 dark:text-green-400"
        >
          <Check class="size-3.5" /> Granted
        </span>
        <span
          v-else-if="osPerm === 'denied'"
          class="shrink-0 text-xs text-[var(--app-muted)]"
        >
          Enable in System Settings
        </span>
        <Button
          v-else
          variant="outline"
          size="sm"
          label="Grant"
          :loading="osPerm === 'requesting'"
          @click="grantOsPerm"
        />
      </div>
    </Card>

    <Card title="Inbox">
      <template v-if="notif.unread.value > 0" #footer-end>
        <Button
          variant="outline"
          size="xs"
          label="Mark all read"
          @click="notif.markAllRead()"
        />
      </template>

      <div v-if="!enabled" class="py-8 text-center text-sm text-[var(--app-muted)]">
        Notifications are disabled.
      </div>
      <div v-else-if="notif.loading.value && !notif.items.value.length" class="py-10 text-center text-sm text-[var(--app-muted)]">
        Loading…
      </div>
      <div v-else-if="notif.error.value" class="py-10 text-center text-sm text-red-500">
        {{ notif.error.value }}
      </div>
      <Empty
        v-else-if="!notif.items.value.length"
        title="You're all caught up."
        description="New notifications will appear here."
      >
        <BellOff class="size-8 text-[var(--app-muted)] mx-auto mb-3" />
      </Empty>
      <ul v-else class="-mx-4 -my-2 divide-y divide-[var(--app-border)]">
        <li
          v-for="n in notif.items.value"
          :key="n.id"
          class="group px-4 py-3 cursor-pointer hover:bg-[var(--app-card-hover)] transition-colors flex gap-3"
          :class="{ 'bg-[color-mix(in_srgb,var(--app-accent)_5%,transparent)]': !n.read_at }"
          @click="activate(n)"
        >
          <div
            class="size-9 rounded-md flex items-center justify-center shrink-0 mt-0.5"
            :class="!n.read_at
              ? 'bg-[color-mix(in_srgb,var(--app-accent)_15%,transparent)] text-[var(--app-accent)]'
              : 'bg-[var(--app-surface)] text-[var(--app-muted)]'"
          >
            <Bell class="size-4" />
          </div>
          <div class="flex-1 min-w-0">
            <div class="flex items-baseline gap-2">
              <div class="text-sm font-medium truncate flex-1 text-[var(--app-foreground)]">{{ n.title }}</div>
              <div class="text-[11px] text-[var(--app-muted)] shrink-0">{{ relTime(n.created_at) }}</div>
            </div>
            <div v-if="n.body" class="text-xs text-[var(--app-muted)] mt-0.5 line-clamp-3">{{ n.body }}</div>
            <div v-if="n.source || n.type" class="flex items-center gap-2 mt-1.5">
              <span v-if="n.source" class="text-[10px] uppercase tracking-wide text-[var(--app-muted)]">{{ n.source }}</span>
              <span v-if="n.type" class="text-[10px] text-[var(--app-muted)]">·  {{ n.type }}</span>
            </div>
          </div>
          <Button
            variant="ghost"
            color="error"
            size="xs"
            class="opacity-0 group-hover:opacity-100"
            title="Dismiss"
            @click.stop="notif.dismiss(n.id)"
          >
            <X class="size-3.5" />
          </Button>
        </li>
      </ul>
    </Card>
  </div>
</template>
