<script setup lang="ts">
/**
 * BuiltinWidgets — Fixed 12×2 top strip for Construct.
 * Col 1-3: CurrentUser (clickable → profile settings)
 * Col 4-12: Dynamic feed blocks from API (announcements, actions, changelog, etc.)
 */
import { ref, watch } from 'vue'
import { GRID_COLS } from '@/composables/useWidgetRegistry'
import { profileStorage } from '@/lib/profileStorage'
import { useAuthStore } from '@/stores/auth'
import CurrentUser4x2 from '@/components/home/widgets/CurrentUser4x2.vue'
import FeedBlock from '@/components/home/widgets/FeedBlock.vue'

interface FeedBlockData {
  type: string
  title?: string
  body?: string
  label?: string
  route?: string
  url?: string
  icon?: string
  items?: string[]
  cols?: number
}

const feedBlocks = ref<FeedBlockData[]>([])
const loading = ref(true)

// Cache the "no feed access" signal for an hour. The source gateway returns
// 401 on /feed for users whose token is valid for accounts but doesn't have
// source scope (common for brand-new personal accounts). Without this cache,
// every navigation re-fires the fetch and the console fills with red 401s.
const FEED_DENY_KEY = 'construct:feed-access-denied-at'
const FEED_DENY_TTL_MS = 60 * 60 * 1000 // 1 hour

function feedRecentlyDenied(): boolean {
  const raw = profileStorage.getItem(FEED_DENY_KEY)
  if (!raw) return false
  const ts = parseInt(raw, 10)
  if (!Number.isFinite(ts)) return false
  return Date.now() - ts < FEED_DENY_TTL_MS
}

const authStore = useAuthStore()
let fetched = false
// fetchAttempted = "we've finished one fetch cycle (success OR fail)".
// Once true, the auth-state watcher must not flip loading back to true
// on a momentary token blip — otherwise we get a stuck spinner because
// fetchFeed() short-circuits on `fetched` and never resets loading again.
// That was the "flickering widgets" bug when /api/source/feed 502'd.
let fetchAttempted = false

async function fetchFeed() {
  if (fetched) return
  if (!authStore.isAuthenticated || !authStore.token) return
  fetched = true

  try {
    // Skip entirely if the server recently said "no feed for you".
    if (feedRecentlyDenied()) { loading.value = false; return }

    const { useApi } = await import('@/composables/useApi')
    const api = useApi()
    const data = await api.get('/feed') as { layout?: FeedBlockData[]; items?: Array<Partial<FeedBlockData> & Record<string, unknown>> }
    if (data?.layout) {
      feedBlocks.value = data.layout
    } else if (data?.items) {
      feedBlocks.value = data.items.map((item) => ({
        ...item,
        cols: item.cols || 3,
      } as FeedBlockData))
    }
    profileStorage.removeItem(FEED_DENY_KEY)
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    if (/\b401\b|unauthor/i.test(msg)) {
      profileStorage.setItem(FEED_DENY_KEY, String(Date.now()))
    }
    // Cache 5xx too — saves a noisy retry loop when the gateway is down.
    // Full 5xx block, including Cloudflare 520–527.
    if (/\b5\d{2}\b/i.test(msg)) {
      profileStorage.setItem(FEED_DENY_KEY, String(Date.now()))
    }
  } finally {
    loading.value = false
    fetchAttempted = true
  }
}

// Wait for both `isAuthenticated` AND `token` to be set before fetching.
// OAuth callback sets them in quick succession but Home can mount during
// that window; onMounted alone races the token assignment and fires /feed
// without an Authorization header, producing a 401 the server correctly
// rejects. `watch + immediate` re-runs as soon as the token arrives.
watch(
  () => authStore.isAuthenticated && !!authStore.token,
  (ready) => {
    if (ready) {
      fetchFeed()
    } else if (!fetchAttempted) {
      // Only show the loading state pre-first-fetch. After one cycle,
      // we stay settled even if auth temporarily flips.
      loading.value = !!authStore.isAuthenticated
    }
  },
  { immediate: true },
)
</script>

<template>
  <div
    class="grid gap-2"
    :style="{
      gridTemplateColumns: `repeat(${GRID_COLS}, 1fr)`,
      gridTemplateRows: 'repeat(2, 80px)',
    }"
  >
    <!-- Current User (3×2, always) — borderless; widget is typographic -->
    <div
      style="grid-column: 1 / span 3; grid-row: 1 / span 2"
      class="strip-cell overflow-hidden"
    >
      <CurrentUser4x2 />
    </div>

    <!-- Dynamic feed blocks from API (cols 4-12) -->
    <template v-if="!loading && feedBlocks.length">
      <div
        v-for="(block, i) in feedBlocks"
        :key="i"
        class="strip-cell overflow-hidden"
        :style="{
          gridColumn: `span ${Math.min(block.cols || 3, 9)}`,
          gridRow: 'span 1',
        }"
      >
        <FeedBlock :block="block" />
      </div>
    </template>

    <!-- Loading state -->
    <div
      v-else-if="loading"
      style="grid-column: 4 / span 9; grid-row: 1 / span 2"
      class="flex items-center justify-center"
    >
      <div class="size-4 border border-[var(--app-muted)]/30 border-t-[var(--app-accent)] rounded-full animate-spin" />
    </div>

    <!-- Empty state (no feed) -->
    <div
      v-else
      style="grid-column: 4 / span 9; grid-row: 1 / span 2"
      class="flex items-center justify-center"
    >
      <p class="text-[11px] font-light tracking-wide text-[var(--app-muted)]">Welcome to Construct</p>
    </div>
  </div>
</template>

<style scoped>
/* Match WidgetChrome's quiet rest tint so the top strip cells have the
   same visual weight as the space-widget grid below. No strip-level
   hover — widgets own their own interior feedback. */
.strip-cell {
  background: color-mix(in srgb, var(--app-foreground) 1.5%, transparent);
}
</style>
