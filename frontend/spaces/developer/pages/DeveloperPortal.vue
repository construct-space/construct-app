<script setup lang="ts">
/**
 * DeveloperPortal — landing page for users enrolled as developers.
 *
 * Replaces the bare Projects list with a framed page that explains the
 * two paths Construct exposes (Builder vs SpaceKit), then renders the
 * project list as the lower zone. Active scope decides the data
 * source: personal → local projects, org → org projects.
 *
 * Gated by useDeveloperGate; the router guard redirects non-developers
 * away from /app/developer so this component can assume visibility.
 */
import { computed, defineAsyncComponent } from 'vue'
import { useRouter } from 'vue-router'
import { Card } from '@construct-space/ui'
import { Zap, Boxes, ArrowRight } from 'lucide-vue-next'
import { useDeveloperGate } from '@/composables/useDeveloperGate'

// Async to break the import cycle: ProjectsPage + OrgProjectsPage are
// also referenced by coreSpaces.ts (host-native page registry) and by
// the router's /app/projects + /app/org-project routes. A static
// import here was creating a temporal dead zone at module init —
// "Cannot access 'ProjectsPage' before initialization". Resolving them
// lazily at mount time sidesteps the cycle.
const ProjectsPage = defineAsyncComponent(() => import('@/spaces/project/pages/ProjectsPage.vue'))
const OrgProjectsPage = defineAsyncComponent(() => import('@/spaces/org-project/pages/OrgProjectsPage.vue'))

const router = useRouter()
const { mode, isOrg } = useDeveloperGate()

const heading = computed(() => isOrg.value ? 'Org Developer' : 'Developer')
const blurb = computed(() =>
  isOrg.value
    ? 'Build, ship, and verify apps and Spaces for this organization.'
    : 'Build, ship, and verify apps and Spaces with Construct.'
)

function goBuilder() {
  router.push('/app/builder')
}
function goSpaceKit() {
  router.push('/app/space-developer')
}
</script>

<template>
  <div v-if="mode" class="h-full overflow-y-auto">
    <div class="max-w-5xl mx-auto px-6 py-6 space-y-5">
      <!-- Header -->
      <div class="flex items-start gap-3">
        <div class="min-w-0 flex-1">
          <h2
            class="text-sm tracking-[0.08em] uppercase font-normal text-[var(--app-foreground)] leading-tight after:content-['.'] after:text-[var(--app-accent)]"
          >
            {{ heading }}
          </h2>
          <p class="text-sm text-[var(--app-muted)] mt-0.5">{{ blurb }}</p>
        </div>
      </div>

      <!-- Explainer cards — the two paths. grid-cols-2 (not md:) so they sit
           side by side at the same widths as the projects grid below. -->
      <div class="grid gap-3 grid-cols-2">
        <Card interactive @click="goBuilder">
          <template #header>
            <div class="flex items-start gap-3">
              <div class="size-10 rounded-lg bg-emerald-500/10 flex items-center justify-center shrink-0">
                <Zap class="size-5 text-emerald-500" />
              </div>
              <div class="min-w-0 flex-1">
                <h3
                  class="text-sm tracking-[0.08em] uppercase font-normal text-[var(--app-foreground)] leading-tight after:content-['.'] after:text-[var(--app-accent)]"
                >
                  Builder
                </h3>
                <p class="text-xs text-[var(--app-muted)] mt-1">
                  Plans, writes, and verifies general software — landing pages, sites, apps.
                </p>
              </div>
            </div>
          </template>
          <ul class="text-xs text-[var(--app-muted)] space-y-1 pl-1">
            <li class="flex gap-2"><span class="text-emerald-500">▸</span><span>Full plan → write → verify loop with your chosen LLM.</span></li>
            <li class="flex gap-2"><span class="text-emerald-500">▸</span><span>Builds against any framework — Next, Vue, Go, Rust…</span></li>
            <li class="flex gap-2"><span class="text-emerald-500">▸</span><span>Deploys to your hosting target when ready.</span></li>
          </ul>
          <template #footer>
            <button
              class="text-[11px] tracking-[0.08em] uppercase text-[var(--app-accent)] hover:underline flex items-center gap-1"
              @click.stop="goBuilder"
            >
              Open Builder <ArrowRight class="size-3" />
            </button>
          </template>
        </Card>

        <Card interactive @click="goSpaceKit">
          <template #header>
            <div class="flex items-start gap-3">
              <div class="size-10 rounded-lg bg-violet-500/10 flex items-center justify-center shrink-0">
                <Boxes class="size-5 text-violet-500" />
              </div>
              <div class="min-w-0 flex-1">
                <h3
                  class="text-sm tracking-[0.08em] uppercase font-normal text-[var(--app-foreground)] leading-tight after:content-['.'] after:text-[var(--app-accent)]"
                >
                  SpaceKit
                </h3>
                <p class="text-xs text-[var(--app-muted)] mt-1">
                  Scaffold and verify a Construct Space — a mini-app that runs inside the host.
                </p>
              </div>
            </div>
          </template>
          <ul class="text-xs text-[var(--app-muted)] space-y-1 pl-1">
            <li class="flex gap-2"><span class="text-violet-500">▸</span><span>Inherits host auth, theme, and the agent runtime.</span></li>
            <li class="flex gap-2"><span class="text-violet-500">▸</span><span>Publishes to the marketplace or stays org-private.</span></li>
            <li class="flex gap-2"><span class="text-violet-500">▸</span><span>Verifies in the Space Runner before you ship.</span></li>
          </ul>
          <template #footer>
            <button
              class="text-[11px] tracking-[0.08em] uppercase text-[var(--app-accent)] hover:underline flex items-center gap-1"
              @click.stop="goSpaceKit"
            >
              Open SpaceKit <ArrowRight class="size-3" />
            </button>
          </template>
        </Card>
      </div>

      <!-- Projects list — personal or org based on active scope.
           Embedded pages render their own header / search / grid; we hide
           their built-in quick-action cards since we display larger
           explainers above. -->
      <div>
        <h4 class="text-[11px] tracking-[0.12em] uppercase font-medium text-[var(--app-muted)] mb-2">
          {{ isOrg ? 'Org projects' : 'Your projects' }}
        </h4>
        <div class="developer-portal-projects">
          <OrgProjectsPage v-if="isOrg" :hide-header="true" />
          <ProjectsPage v-else :hide-quick-actions="true" :hide-header="true" />
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* Embedded project pages set their own h-full + overflow; reset that so
   the outer portal owns the scroll. */
.developer-portal-projects :deep(.h-full) {
  height: auto;
}
.developer-portal-projects :deep(.overflow-y-auto),
.developer-portal-projects :deep(.overflow-auto) {
  overflow: visible;
}
</style>
