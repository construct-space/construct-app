<script setup lang="ts">
/**
 * FeedBlock — renders a single feed block from the API layout.
 * Supports types: announcement, action, changelog, tip, update.
 *
 * Flat typographic style matching the rest of the home widgets: no inner
 * card, no borders, no icon badges — a small uppercase type label sits
 * above the title, hover tints the surface subtly if the block is clickable.
 */
import { useRouter } from 'vue-router'
import { isTauriEnv } from '@/utils/tauri'

const props = defineProps<{
  block: {
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
}>()

const router = useRouter()

function handleClick() {
  if (props.block.route) {
    router.push(props.block.route)
    return
  }
  if (!props.block.url) return

  const url = props.block.url
  if (isTauriEnv()) {
    // window.open inside the Tauri webview doesn't reach the system browser.
    // plugin-opener has a permissive URL scope (plugin-shell rejects
    // multi-dot hosts like my.construct.space). Same pattern as
    // useConstructAuth.ts.
    import('@tauri-apps/plugin-opener')
      .then(({ openUrl }) => openUrl(url))
      .catch(() => { window.open(url, '_blank', 'noopener,noreferrer') })
  } else {
    window.open(url, '_blank', 'noopener,noreferrer')
  }
}

// Pre-compute the kicker label (uppercase category) for each block type,
// so the template stays uniform regardless of type.
function kicker(): string {
  if (props.block.type === 'changelog') return 'Changelog'
  if (props.block.type === 'tip') return 'Tip'
  if (props.block.type === 'update') return 'Update'
  if (props.block.type === 'announcement') return 'Announcement'
  if (props.block.type === 'action') return 'Action'
  return ''
}

const clickable = !!(props.block.route || props.block.url)
</script>

<template>
  <component
    :is="clickable ? 'button' : 'div'"
    class="feed-block group h-full w-full px-4 py-3 text-left transition-colors flex flex-col justify-between gap-1"
    :class="{ clickable }"
    @click="handleClick"
  >
    <!-- Action block — shortcut card with label + body -->
    <template v-if="block.type === 'action'">
      <p class="kicker">{{ kicker() }}</p>
      <div class="flex items-baseline justify-between gap-3 flex-1">
        <div class="min-w-0">
          <p class="title">{{ block.label || block.title }}</p>
          <p v-if="block.body" class="body line-clamp-1">{{ block.body }}</p>
        </div>
        <span v-if="clickable" class="chev" aria-hidden="true">›</span>
      </div>
    </template>

    <!-- Changelog — kicker + title + bullet list -->
    <template v-else-if="block.type === 'changelog'">
      <p class="kicker">{{ kicker() }}</p>
      <p class="title">{{ block.title }}</p>
      <ul v-if="block.items?.length" class="flex-1 overflow-hidden space-y-0.5">
        <li
          v-for="(item, i) in block.items.slice(0, 3)"
          :key="i"
          class="body truncate"
        >
· {{ item }}
</li>
      </ul>
    </template>

    <!-- Tip / Update / Announcement — kicker + title + body -->
    <template v-else-if="block.type === 'tip' || block.type === 'update' || block.type === 'announcement'">
      <p class="kicker">{{ kicker() }}</p>
      <p class="title">{{ block.title }}</p>
      <p v-if="block.body" class="body line-clamp-2 flex-1">{{ block.body }}</p>
    </template>

    <!-- Fallback — plain title line -->
    <template v-else>
      <p class="title-plain">{{ block.title || block.body }}</p>
    </template>
  </component>
</template>

<style scoped>
.feed-block {
  background: transparent;
}
.feed-block.clickable {
  cursor: pointer;
}
.feed-block.clickable:hover {
  background: color-mix(in srgb, var(--app-foreground) 4%, transparent);
}

/* Uppercase category label — same voice as widget-title elsewhere.
   Strong foreground + trailing accent period; no more all-red kicker. */
.kicker {
  font-size: 11px;
  font-weight: 300;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: color-mix(in srgb, var(--app-foreground) 85%, transparent);
  line-height: 1;
}
.kicker::after {
  content: '.';
  color: var(--app-accent);
  font-weight: 300;
  margin-left: 1px;
}

.title {
  font-size: 13px;
  font-weight: 300;
  letter-spacing: -0.005em;
  color: var(--app-foreground);
  line-height: 1.15;
}

.title-plain {
  font-size: 12.5px;
  font-weight: 300;
  color: var(--app-foreground);
}

.body {
  font-size: 10.5px;
  font-weight: 300;
  color: var(--app-muted);
  line-height: 1.35;
}

.chev {
  font-size: 15px;
  line-height: 1;
  color: var(--app-muted);
  opacity: 0;
  transform: translateX(-3px);
  transition: transform 160ms ease, opacity 160ms ease;
}
.feed-block.clickable:hover .chev {
  opacity: 1;
  transform: translateX(0);
}
</style>
