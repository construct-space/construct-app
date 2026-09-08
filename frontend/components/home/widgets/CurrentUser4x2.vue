<script setup lang="ts">
/**
 * CurrentUser widget — 3×2 built-in card.
 *
 * Flat, typography-forward. Big thin day number on the right as a visual
 * anchor, bold name on the left, everything else quiet. Whole card is
 * clickable → profile settings; hover tints the surface gently so the
 * affordance reads without chrome.
 */
import { computed } from 'vue'
import { useRouter } from 'vue-router'
import { useAuthStore } from '@/stores/auth'

const router = useRouter()
const authStore = useAuthStore()

const userName = computed(() => authStore.user?.first_name || 'there')

const greeting = computed(() => {
  const h = new Date().getHours()
  if (h < 5) return { lead: 'Up', rest: 'late' }
  if (h < 12) return { lead: 'Good', rest: 'morning' }
  if (h < 18) return { lead: 'Good', rest: 'afternoon' }
  return { lead: 'Good', rest: 'evening' }
})

const today = new Date()
const dayNumber = today.getDate().toString().padStart(2, '0')
const dayName = today.toLocaleDateString('en-US', { weekday: 'short' }).toUpperCase()
const monthName = today.toLocaleDateString('en-US', { month: 'short' }).toUpperCase()

const scopeLabel = computed(() => {
  if (authStore.scope === 'org') return authStore.orgName || 'Organization'
  if (authStore.scope === 'user') return 'Personal'
  return ''
})

const isDeveloper = computed(() => {
  if (authStore.scope === 'user') return !!authStore.personalDeveloper
  if (authStore.scope === 'org') return authStore.roles?.includes('developer')
  return false
})

// Quiet "meta" line below the name — dots separate scope, developer flag,
// and email. Omit segments that aren't populated yet so the line doesn't
// collapse to "· ·".
const metaParts = computed(() => {
  const parts: string[] = []
  if (scopeLabel.value) parts.push(scopeLabel.value)
  if (isDeveloper.value) parts.push('Developer')
  return parts
})
</script>

<template>
  <button
    class="user-card group h-full w-full flex items-stretch text-left transition-colors"
    @click="router.push('/app/settings/profile')"
  >
    <!-- Identity column: greeting + name grouped, meta anchored to bottom -->
    <div class="flex-1 min-w-0 flex flex-col py-4 pl-4 pr-2">
      <div class="identity-stack">
        <p class="greeting text-[var(--app-muted)]">
          <span class="greeting-lead">{{ greeting.lead }}</span>
          <span class="greeting-rest">{{ greeting.rest }}</span>
        </p>

        <h2 class="name text-[var(--app-foreground)] truncate">
          {{ userName }}<span class="comma">.</span>
        </h2>
      </div>

      <p class="meta text-[10.5px] text-[var(--app-muted)] truncate mt-auto">
        <template v-for="(part, i) in metaParts" :key="part">
          <span v-if="i > 0" class="sep"> · </span>
          <span :class="{ 'meta-strong': part === 'Developer' }">{{ part }}</span>
        </template>
        <span v-if="!metaParts.length" class="italic opacity-70">Welcome</span>
      </p>
    </div>

    <!-- Date column: big thin number + caps weekday/month -->
    <div class="date-col flex flex-col items-end justify-between py-4 pr-4 pl-2">
      <span
        class="chevron text-[var(--app-muted)] opacity-0 group-hover:opacity-100 transition-opacity"
        aria-hidden="true"
      >›</span>
      <div class="text-right leading-none">
        <p class="day-number text-[var(--app-foreground)] tabular-nums">{{ dayNumber }}</p>
        <p class="day-meta text-[var(--app-muted)]">{{ dayName }} · {{ monthName }}</p>
      </div>
      <span aria-hidden="true" />
    </div>
  </button>
</template>

<style scoped>
.user-card {
  background: transparent;
}
.user-card:hover {
  background: color-mix(in srgb, var(--app-foreground) 3%, transparent);
}

/* Greeting + name grouped tight; the line-height below does the spacing
   so the two lines feel like a single typographic unit. */
.identity-stack {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

/* Greeting: weight-split. "Good" stays thin and recedes; the time-of-day
   word ("evening", "morning"…) jumps to semibold so the line has its own
   internal rhythm before handing off to the bold name below. */
.greeting {
  font-size: 15px;
  letter-spacing: 0.005em;
  line-height: 1.1;
}
.greeting-lead {
  font-weight: 300;
  opacity: 0.7;
  margin-right: 4px;
}
.greeting-rest {
  font-weight: 300;
  color: color-mix(in srgb, var(--app-foreground) 75%, transparent);
}

/* The name is the hero — heavy, tight, slightly extended. */
.name {
  font-size: 22px;
  font-weight: 600;
  letter-spacing: -0.015em;
  line-height: 1;
}
.name .comma {
  color: var(--app-accent);
  font-weight: 600;
}

/* Meta row: short, letter-spaced, quiet. "Developer" gets a slightly
   bolder weight so it reads as a proper flag without a pill. */
.meta {
  font-weight: 300;
  letter-spacing: 0.01em;
}
.meta .sep { opacity: 0.6; }
.meta-strong {
  color: var(--app-foreground);
  font-weight: 300;
}

/* Date column: borderless; the left edge separator is a single hairline
   at low opacity, purely to prevent the two columns from colliding
   visually — removes entirely on hover so the card reads as one surface. */
.date-col {
  border-left: 1px solid color-mix(in srgb, var(--app-foreground) 6%, transparent);
  transition: border-color 160ms ease;
  min-width: 72px;
}
.user-card:hover .date-col {
  border-left-color: transparent;
}

/* The day number is deliberately thin — weight contrast with the name
   is where the composition gets its voice. */
.day-number {
  font-size: 34px;
  font-weight: 300;
  letter-spacing: -0.02em;
}
.day-meta {
  margin-top: 4px;
  font-size: 9px;
  font-weight: 300;
  letter-spacing: 0.12em;
}

.chevron {
  font-size: 16px;
  line-height: 1;
  transform: translateX(-3px);
  transition: transform 160ms ease, opacity 160ms ease;
}
.user-card:hover .chevron {
  transform: translateX(0);
}
</style>
