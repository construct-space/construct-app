<script setup lang="ts">
/**
 * NotificationBell — sidebar widget that shows the user's notification
 * inbox. Uses useNotifications() module-level state so it shares one
 * fetch + one SSE connection with any other consumer (e.g. an
 * Account → Notifications page if/when added).
 *
 * The composable's start() must have been called once for this app
 * session — typically right after sign-in. Mounting here also calls
 * start() defensively (idempotent).
 */
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { Bell, BellOff, X, Settings } from 'lucide-vue-next'
import { useNotifications, type AppNotification } from '@/composables/useNotifications'

const router = useRouter()
const notif = useNotifications()

const open = ref(false)
const anchorRef = ref<HTMLElement | null>(null)
const popoverRef = ref<HTMLElement | null>(null)

const badge = computed(() => (notif.unread.value > 99 ? '99+' : String(notif.unread.value)))

// Stream-health tooltip — surfaces the Rust bridge state alongside the
// unread count so an offline stream is visible without opening devtools.
const bellTitle = computed(() => {
  const base = `Notifications${notif.unread.value > 0 ? ` (${notif.unread.value})` : ''}`
  if (!notif.bridgeActive.value) return base
  const d = notif.debugState.value
  if (!d) return base
  if (d.connected) {
    if (!d.last_connect_at_ms) return `${base}\nStream: connected`
    const age = Math.max(0, Date.now() - d.last_connect_at_ms)
    const mins = Math.floor(age / 60_000)
    const hint = mins < 1 ? 'just now' : mins < 60 ? `${mins}m ago` : `${Math.floor(mins / 60)}h ago`
    return `${base}\nStream: connected (since ${hint})`
  }
  const retry = d.retry_count > 0 ? ` · retry #${d.retry_count}` : ''
  const err = d.last_error ? `\n${d.last_error}` : ''
  return `${base}\nStream: reconnecting${retry}${err}`
})

onMounted(() => {
  notif.start()
  document.addEventListener('click', onDocClick)
  document.addEventListener('keydown', onKey)
})
onBeforeUnmount(() => {
  document.removeEventListener('click', onDocClick)
  document.removeEventListener('keydown', onKey)
})

function toggle() {
  open.value = !open.value
  if (open.value) notif.refresh()
}
function close() { open.value = false }

function onDocClick(e: MouseEvent) {
  if (!open.value) return
  const t = e.target as Node | null
  if (!t) return
  if (anchorRef.value?.contains(t)) return
  if (popoverRef.value?.contains(t)) return
  close()
}
function onKey(e: KeyboardEvent) {
  if (e.key === 'Escape' && open.value) close()
}

async function activate(n: AppNotification) {
  if (!n.read_at) await notif.markRead(n.id)
  close()
  if (n.link) router.push(n.link)
}

function relTime(iso: string): string {
  const d = new Date(iso).getTime()
  if (Number.isNaN(d)) return ''
  const diff = Math.max(0, Date.now() - d)
  const m = Math.floor(diff / 60_000)
  if (m < 1) return 'just now'
  if (m < 60) return `${m}m`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h`
  const day = Math.floor(h / 24)
  if (day < 7) return `${day}d`
  return new Date(iso).toLocaleDateString()
}

function goToPreferences() {
  close()
  router.push('/app/settings/notifications')
}
</script>

<template>
  <div class="relative">
    <button
      ref="anchorRef"
      class="size-9 rounded-lg flex items-center justify-center transition-colors relative"
      :class="open
        ? 'bg-app-accent/10 text-app-accent'
        : 'text-app-muted hover:text-app-foreground hover:bg-app-card-hover'"
      :title="bellTitle"
      @click="toggle"
    >
      <Bell class="size-5" />
      <span
        v-if="notif.unread.value > 0"
        class="absolute -top-0.5 -right-0.5 min-w-[16px] h-[16px] px-1 rounded-full bg-red-500 text-white text-[10px] leading-[16px] font-semibold text-center"
      >{{ badge }}</span>
    </button>

    <!-- Flyout -->
    <Teleport to="body">
      <div v-if="open" class="fixed inset-0 z-199" @click="close" />
      <div
        v-if="open"
        ref="popoverRef"
        class="fixed z-200 left-20 bottom-16 w-[360px] rounded-xl border border-app-border bg-app-background shadow-xl overflow-hidden flex flex-col"
        style="max-height: min(560px, 80vh)"
      >
        <!-- Header -->
        <div class="px-4 py-3 border-b border-app-border flex items-center justify-between gap-2">
          <div class="text-sm font-semibold">Notifications</div>
          <button
            v-if="notif.unread.value > 0"
            class="text-xs text-app-muted hover:text-app-foreground transition-colors"
            @click="notif.markAllRead()"
          >
Mark all read
</button>
        </div>

        <!-- Body -->
        <div class="flex-1 overflow-y-auto">
          <div v-if="notif.loading.value && !notif.items.value.length" class="px-4 py-8 text-center text-xs text-app-muted">
            Loading…
          </div>
          <div v-else-if="notif.error.value" class="px-4 py-8 text-center text-xs text-red-500">
            {{ notif.error.value }}
          </div>
          <div v-else-if="!notif.items.value.length" class="px-4 py-10 text-center">
            <BellOff class="size-6 text-app-muted mx-auto mb-2" />
            <div class="text-xs text-app-muted">You're all caught up.</div>
          </div>
          <ul v-else class="divide-y divide-app-border">
            <li
              v-for="n in notif.items.value"
              :key="n.id"
              class="group px-4 py-3 cursor-pointer hover:bg-app-card-hover transition-colors flex gap-3"
              :class="{ 'bg-app-accent/5': !n.read_at }"
              @click="activate(n)"
            >
              <div
                class="size-8 rounded-md flex items-center justify-center shrink-0 mt-0.5"
                :class="!n.read_at ? 'bg-app-accent/15 text-app-accent' : 'bg-app-surface text-app-muted'"
              >
                <Bell class="size-4" />
              </div>
              <div class="flex-1 min-w-0">
                <div class="flex items-baseline gap-2">
                  <div class="text-sm font-medium truncate flex-1">{{ n.title }}</div>
                  <div class="text-[10px] text-app-muted shrink-0">{{ relTime(n.created_at) }}</div>
                </div>
                <div v-if="n.body" class="text-xs text-app-muted mt-0.5 line-clamp-2">{{ n.body }}</div>
              </div>
              <button
                class="size-6 rounded flex items-center justify-center text-app-muted opacity-0 group-hover:opacity-100 hover:text-red-500 hover:bg-red-500/10 transition-all shrink-0"
                title="Dismiss"
                @click.stop="notif.dismiss(n.id)"
              >
                <X class="size-3.5" />
              </button>
            </li>
          </ul>
        </div>

        <!-- Footer -->
        <div class="border-t border-app-border px-3 py-2 flex items-center justify-between">
          <button
            class="text-xs text-app-muted hover:text-app-foreground flex items-center gap-1.5 transition-colors"
            @click="goToPreferences"
          >
            <Settings class="size-3.5" />
            Notification settings
          </button>
        </div>
      </div>
    </Teleport>
  </div>
</template>
