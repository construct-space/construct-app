<script setup lang="ts">
/**
 * OnboardingPage — First-run welcome.
 *
 * Step 1: Introduce Source as the free, built-in AI assistant. CTA selects
 *         the Construct provider as the active default so the user can chat
 *         immediately, without configuring any keys. A supplemental row
 *         lists the other supported providers (logo-only, non-interactive)
 *         with a deep link to Settings → Providers for users who want to
 *         bring their own keys.
 * Step 2: Getting-started quick actions.
 *
 * Auto-sets the projects directory in the background on mount so the
 * filesystem-backed features work without an explicit prompt.
 *
 * Visual style mirrors the dashboard widget grid: muted cards with sharp
 * corners, uppercase category labels with accent dot, construct-space/ui
 * Card + Button primitives instead of raw Tailwind divs.
 */

import { Card, Button } from '@construct-space/ui'
import { useProjectDirectory } from '@/composables/useProjectDirectory'
import { useAuthStore } from '@/stores/auth'
import { useAIModel } from '@/composables/useAIModel'
import { markOnboardingComplete } from '@/composables/useOnboarding'

type StepId = 'providers' | 'spaces' | 'developer' | 'org'

const router = useRouter()
const projectDir = useProjectDirectory()
const authStore = useAuthStore()
const aiModel = useAIModel()

// Supported providers — informational only on this screen; configuration
// lives in Settings → Providers. Logos resolved against
// /assets/provider-logos/*.svg (the same files the settings cards use).
const supportedProviders = [
  { id: 'anthropic', name: 'Anthropic', logo: 'anthropic.svg' },
  { id: 'openai', name: 'OpenAI', logo: 'openai.svg' },
  { id: 'google', name: 'Google', logo: 'google.svg' },
  { id: 'xai', name: 'xAI', logo: 'xai.svg' },
  { id: 'deepseek', name: 'DeepSeek', logo: 'deepseek.svg' },
  { id: 'openrouter', name: 'OpenRouter', logo: 'openrouter.svg' },
  { id: 'moonshotai', name: 'Moonshot', logo: 'moonshotai.svg' },
  { id: 'zai', name: 'Z.ai', logo: 'zai.svg' },
  { id: 'xiaomi', name: 'MiMo', logo: 'xiaomi.svg' },
  { id: 'ollama', name: 'Ollama', logo: 'ollama.svg' },
  { id: 'lmstudio', name: 'LM Studio', logo: 'lmstudio.svg' },
  { id: 'base-mlx', name: 'BaseMLX', logo: 'base-mlx.svg' },
]

const state = reactive({
  providersAcknowledged: false,
  spacesAcknowledged: false,
  developerAcknowledged: false,
  loading: false,
})

const currentStep = computed<StepId>(() => {
  if (!state.providersAcknowledged) return 'providers'
  if (!state.spacesAcknowledged) return 'spaces'
  if (!state.developerAcknowledged) return 'developer'
  return 'org'
})

// A curated cross-section of Spaces for the welcome screen — built-in
// essentials plus a sample of community Spaces from ~/Spaces. The point
// is to show breadth (work, communication, creative, fun) without
// dumping the entire marketplace on the user. Last tile is the
// Marketplace deep link so users can see the rest.
const builtInSpaces = [
  { id: 'ask', name: 'Ask', icon: 'i-lucide-message-circle-question-mark', tagline: 'Ask anything.' },
  { id: 'editor', name: 'Editor', icon: 'i-lucide-code', tagline: 'Monaco + AI completions.' },
  { id: 'notes', name: 'Notes', icon: 'i-lucide-notebook-pen', tagline: 'Write, link, find.' },
  { id: 'canvas', name: 'Canvas', icon: 'i-lucide-shapes', tagline: 'Whiteboard + AI.' },
  { id: 'pages', name: 'Pages', icon: 'i-lucide-file-text', tagline: 'Docs that think.' },
  { id: 'calendar', name: 'Calendar', icon: 'i-lucide-calendar', tagline: 'Your week.' },
  { id: 'meet', name: 'Meet', icon: 'i-lucide-video', tagline: 'Video + agent.' },
  { id: 'mail', name: 'Mail', icon: 'i-lucide-mail', tagline: 'Inbox triage.' },
  { id: 'maps', name: 'Maps', icon: 'i-lucide-map', tagline: 'Places and routes.' },
  { id: 'drive', name: 'Drive', icon: 'i-lucide-hard-drive', tagline: 'Files and AI.' },
  { id: 'design', name: 'Design', icon: 'i-lucide-palette', tagline: 'Mocks and prototypes.' },
  { id: 'board', name: 'Board', icon: 'i-lucide-kanban-square', tagline: 'Kanban + AI moves.' },
  { id: 'radio', name: 'Radio', icon: 'i-lucide-radio', tagline: 'Live streams + playlists.' },
  { id: 'dentist', name: 'Dentist', icon: 'i-lucide-smile', tagline: 'Practice management.' },
  { id: 'pacman', name: 'Pac-Man', icon: 'i-lucide-ghost', tagline: 'Because why not.' },
]

// Developer toolkit shipped with Construct — surfaced on the developer
// step so engineers see what's available before they go looking. Names
// match the npm packages and CLI verbs so the value carries over to
// Settings → Developer and the docs.
const devTools = [
  { name: 'Graph', icon: 'i-lucide-share-2', tagline: 'Reactive ORM, live queries, schema-as-code.' },
  { name: 'CLI', icon: 'i-lucide-terminal', tagline: 'Scaffold, run, and publish from your shell.' },
  { name: 'UI', icon: 'i-lucide-layout-template', tagline: 'Design-system primitives, themed.' },
  { name: 'Builder', icon: 'i-lucide-hammer', tagline: 'Build websites and apps outside Construct.' },
  { name: 'Spacekit', icon: 'i-lucide-boxes', tagline: 'Build Spaces that run inside Construct.' },
  { name: 'SDK', icon: 'i-lucide-package', tagline: 'The umbrella module — one import.' },
]

// Org capabilities surfaced on the Organization step. Mirrors the Org +
// Org Projects built-in Spaces and the org-managed features in
// auth.ts (members, roles, dev enrollment). Keep short — the right card
// already carries the explanation.
const orgFeatures = [
  { name: 'Members', icon: 'i-lucide-users', tagline: 'Invite teammates, manage who has access.' },
  { name: 'Departments', icon: 'i-lucide-network', tagline: 'Engineering, design, ops — your shape.' },
  { name: 'Roles', icon: 'i-lucide-shield-check', tagline: 'Owner, admin, developer, member.' },
  { name: 'Projects', icon: 'i-lucide-folder-kanban', tagline: 'Org-wide projects, tracked together.' },
  { name: 'Billing', icon: 'i-lucide-credit-card', tagline: 'One bill, one usage view.' },
  { name: 'Org Spaces', icon: 'i-lucide-boxes', tagline: 'Publish Spaces for everyone at once.' },
]

const currentUserId = computed(() => authStore.user?.id || authStore.user?.email || 'unknown')

function logoSrc(filename: string): string {
  return new URL(`../assets/provider-logos/${filename}`, import.meta.url).href
}

onMounted(async () => {
  try {
    const defaultPath = await projectDir.getDefaultProjectsRoot()
    if (defaultPath) await projectDir.setProjectsRoot(defaultPath)
  } catch { /* ignore */ }

  // Warm the provider catalog so the construct provider is loaded by the
  // time the user clicks "Continue with Source". loadProviders dedupes
  // internally so re-entries are safe.
  try {
    await aiModel.loadProviders()
  } catch { /* non-fatal — selectSourceAsDefault retries on click */ }
})

// Set the Construct provider as the active default model. The provider
// catalog is loaded dynamically from my.construct.space; we pick whatever
// model the catalog returns as Source's primary entry. Best-effort — if
// the catalog is unreachable the user still advances; they'll need to
// pick a model in Settings later.
async function selectSourceAsDefault() {
  try {
    if (!aiModel.initialized.value) await aiModel.loadProviders()
    const construct = aiModel.providers.value.find(p => p.id === 'construct')
    const firstModel = construct?.models?.[0]
    if (firstModel) {
      const compositeId = firstModel.id.includes(':') ? firstModel.id : `construct:${firstModel.id}`
      aiModel.setDefaultModel(compositeId)
    }
  } catch (e) {
    console.warn('[Onboarding] failed to set Source as default:', e)
  }
}

async function continueFromProviders() {
  state.loading = true
  try {
    await selectSourceAsDefault()
    state.providersAcknowledged = true
  } finally {
    state.loading = false
  }
}

async function openProviderSettings() {
  // Route guard redirects /app/* back to /onboarding while the
  // onboarding-complete flag is unset, so jumping straight to Settings
  // would round-trip the user. Mark complete first — the user is
  // explicitly choosing the bring-your-own-AI path and doesn't need to
  // see this page again.
  await markOnboardingComplete(currentUserId.value)
  router.push('/app/settings/llms')
}

async function getStarted() {
  state.loading = true
  try {
    await markOnboardingComplete(currentUserId.value)
    router.push('/app')
  } finally {
    state.loading = false
  }
}

function goToProviders() {
  state.providersAcknowledged = false
  state.spacesAcknowledged = false
  state.developerAcknowledged = false
}

function goToSpaces() {
  state.spacesAcknowledged = false
  state.developerAcknowledged = false
}

function goToDeveloper() {
  state.developerAcknowledged = false
}

function continueFromSpaces() {
  state.spacesAcknowledged = true
}

function continueFromDeveloper() {
  state.developerAcknowledged = true
}
</script>

<template>
  <div class="min-h-screen bg-[var(--app-background)]">
    <div
      class="min-h-screen flex items-center justify-center px-6 py-12"
    >
      <div class="w-full max-w-5xl">
        <!-- Logo + title -->
        <div class="text-center mb-10">
          <svg width="44" height="44" viewBox="0 0 533 533" fill="currentColor" class="text-app-accent mx-auto mb-5">
            <path
              d="M266.5 410.156C230.912 410.156 199.106 402.203 171.081 386.297C143.056 370.39 121.036 348.519 105.022 320.684C89.0072 292.848 81 261.256 81 225.909C81 190.12 89.0072 158.308 105.022 130.472C121.036 102.636 143.056 80.7655 171.081 64.8593C199.106 48.9531 230.912 41 266.5 41C302.087 41 333.671 48.9531 361.252 64.8593C389.277 80.7655 411.297 102.636 427.311 130.472C443.326 158.308 451.555 190.12 452 225.909C452 261.256 443.77 292.848 427.311 320.684C411.297 348.519 389.277 370.39 361.252 386.297C333.671 402.203 302.087 410.156 266.5 410.156ZM266.5 363.763C292.301 363.763 315.433 357.798 335.896 345.868C356.359 333.939 372.373 317.591 383.939 296.824C395.505 276.058 401.288 252.42 401.288 225.909C401.288 199.399 395.505 175.761 383.939 154.994C372.373 133.786 356.359 117.217 335.896 105.287C315.433 93.3579 292.301 87.393 266.5 87.393C240.699 87.393 217.567 93.3579 197.104 105.287C176.641 117.217 160.405 133.786 148.394 154.994C136.828 175.761 131.045 199.399 131.045 225.909C131.045 252.42 136.828 276.058 148.394 296.824C160.405 317.591 176.641 333.939 197.104 345.868C217.567 357.798 240.699 363.763 266.5 363.763Z" />
            <path
              d="M378.22 451.578C393.077 451.578 405.121 460.85 405.121 472.289C405.121 483.727 393.077 493 378.22 493H160.945C146.089 493 134.044 483.727 134.044 472.289C134.044 460.85 146.089 451.578 160.945 451.578H378.22Z" />
          </svg>

          <p class="text-2xl">
            <span class="text-[var(--app-muted)]">CONSTRUCT:</span><span class="font-normal text-[var(--app-foreground)]">WELCOME</span>
          </p>
          <p class="text-sm text-[var(--app-muted)] max-w-md mx-auto leading-relaxed mt-3">
            <template v-if="currentStep === 'providers'">
              Not one assistant. An OS full of AI-native apps.
            </template>
            <template v-else-if="currentStep === 'spaces'">
              Spaces are how Construct works. Have a look around.
            </template>
            <template v-else-if="currentStep === 'developer'">
              For builders — extend Construct in TypeScript.
            </template>
            <template v-else>
              Built for solo work — and the whole company.
            </template>
          </p>
        </div>

        <!-- Step 1: Source intro + supported providers — side-by-side on
             wide screens (matches the login split layout), stacked on
             narrow ones so the operator list + logo grid never crowd. -->
        <template v-if="currentStep === 'providers'">
          <div class="grid grid-cols-1 md:grid-cols-2 gap-4 items-stretch">
          <!-- Source hero card -->
          <Card variant="muted" title="Construct Model" class="h-full">
            <div class="space-y-5">
              <h2 class="text-3xl font-normal text-[var(--app-foreground)] leading-tight">
                Meet Source<span class="text-app-accent">.</span>
              </h2>
              <p class="text-sm text-[var(--app-muted)] leading-relaxed">
                Our first model — fine-tuned to meet Construct's needs and
                understand it from the inside out. Free on
                our cloud today, runnable on a 24 GB Mac once we ship it.
                It builds with you instead of just answering questions about code.
              </p>

              <!-- Capability list — base-model specs that carry over to
                   Source. Kept as compact rows so the card stays tight
                   against the provider grid on the right. Numbers reflect
                   the base model's published benchmarks (April 2026
                   release); fine-tuning preserves these. -->
              <ul class="space-y-2 pt-1">
                <li class="flex items-baseline gap-2 text-xs">
                  <span class="font-normal text-[var(--app-foreground)] w-32 shrink-0 after:content-['.'] after:text-app-accent">35B / 3B active</span>
                  <span class="text-[var(--app-muted)]">MoE with 256 experts — frontier quality, 3B-active speed.</span>
                </li>
                <li class="flex items-baseline gap-2 text-xs">
                  <span class="font-normal text-[var(--app-foreground)] w-32 shrink-0 after:content-['.'] after:text-app-accent">262k context</span>
                  <span class="text-[var(--app-muted)]">1M with YaRN. Whole repos, long sessions, no truncation.</span>
                </li>
                <li class="flex items-baseline gap-2 text-xs">
                  <span class="font-normal text-[var(--app-foreground)] w-32 shrink-0 after:content-['.'] after:text-app-accent">Thinking mode</span>
                  <span class="text-[var(--app-muted)]">Step-by-step reasoning, preserved across agentic turns.</span>
                </li>
                <li class="flex items-baseline gap-2 text-xs">
                  <span class="font-normal text-[var(--app-foreground)] w-32 shrink-0 after:content-['.'] after:text-app-accent">Multimodal</span>
                  <span class="text-[var(--app-muted)]">Native text, image, and video — screenshots and mockups.</span>
                </li>
                <li class="flex items-baseline gap-2 text-xs">
                  <span class="font-normal text-[var(--app-foreground)] w-32 shrink-0 after:content-['.'] after:text-app-accent">Agentic coding</span>
                  <span class="text-[var(--app-muted)]">73.4% SWE-bench Verified, 51.5% Terminal-Bench 2.0.</span>
                </li>
                <li class="flex items-baseline gap-2 text-xs">
                  <span class="font-normal text-[var(--app-foreground)] w-32 shrink-0 after:content-['.'] after:text-app-accent">Math &amp; reasoning</span>
                  <span class="text-[var(--app-muted)]">92.6% on AIME 2026.</span>
                </li>
              </ul>

              <Button
                :loading="state.loading"
                :disabled="state.loading"
                block
                size="lg"
                trailing-icon="i-lucide-arrow-right"
                @click="continueFromProviders"
              >
                {{ state.loading ? 'SETTING UP…' : 'CONTINUE WITH SOURCE' }}
              </Button>
            </div>
          </Card>

          <!-- Supported providers (informational) -->
          <Card variant="muted" title="Providers" class="h-full">
            <template #accessory>
              <Button
                variant="link"
                size="sm"
                trailing-icon="i-lucide-external-link"
                @click="openProviderSettings"
              >
                Open Settings
              </Button>
            </template>
            <div class="space-y-4">
              <p class="text-sm text-[var(--app-muted)] leading-relaxed">
                Prefer your own AI? Construct supports these providers — add
                an API key or sign in via OAuth in Settings.
              </p>

              <ul class="grid grid-cols-3 gap-2">
                <li
                  v-for="p in supportedProviders"
                  :key="p.id"
                  class="flex flex-col items-center gap-1.5 px-2 py-3 rounded-sm bg-[color-mix(in_srgb,var(--app-foreground)_3%,transparent)]"
                  :title="p.name"
                >
                  <img
                    :src="logoSrc(p.logo)"
                    :alt="`${p.name} logo`"
                    class="size-6 object-contain opacity-90"
                    loading="lazy"
                  />
                  <span class="text-[10px] text-[var(--app-muted)] text-center leading-tight">{{ p.name }}</span>
                </li>
              </ul>
            </div>
          </Card>
          </div>
        </template>

        <!-- Step 2: Spaces — mirrors the providers layout but flipped.
             Left card holds the grid of space tiles (the visual focus),
             right card holds the text intro + the Continue CTA. -->
        <template v-else-if="currentStep === 'spaces'">
          <div class="grid grid-cols-1 md:grid-cols-2 gap-4 items-stretch">
            <!-- Spaces grid -->
            <Card variant="muted" title="Spaces" class="h-full">
              <ul class="grid grid-cols-3 gap-2">
                <li
                  v-for="s in builtInSpaces"
                  :key="s.id"
                  class="flex flex-col items-center gap-1.5 px-2 py-3 rounded-sm bg-[color-mix(in_srgb,var(--app-foreground)_3%,transparent)]"
                  :title="s.tagline"
                >
                  <Icon :name="s.icon" class="size-6 text-[var(--app-foreground)]" />
                  <span class="text-[10px] text-[var(--app-muted)] text-center leading-tight">{{ s.name }}</span>
                </li>
              </ul>
            </Card>

            <!-- Spaces intro text -->
            <Card variant="muted" title="What is a Space?" class="h-full">
              <div class="space-y-5">
                <h2 class="text-3xl font-normal text-[var(--app-foreground)] leading-tight">
                  Apps, not chat<span class="text-app-accent">.</span>
                </h2>
                <p class="text-sm text-[var(--app-muted)] leading-relaxed">
                  Every workflow in Construct lives inside a Space — a small
                  app with its own pages, tools, and AI agent. They share
                  your session, your model, and your project context, so
                  your agent remembers where you left off as you switch
                  between them.
                </p>
                <p class="text-sm text-[var(--app-muted)] leading-relaxed">
                  Need more? The
                  <span class="uppercase tracking-wider"><span class="font-normal text-[var(--app-muted)]">Space</span><span class="font-bold text-[var(--app-foreground)]">Store</span></span>
                  is where you install Spaces built by the community — chat,
                  calendar, notes, design, games, anything. Bring your own
                  too: anyone can publish.
                </p>

                <Button
                  :loading="state.loading"
                  :disabled="state.loading"
                  block
                  size="lg"
                  trailing-icon="i-lucide-arrow-right"
                  @click="continueFromSpaces"
                >
                  CONTINUE
                </Button>

                <Button
                  variant="link"
                  block
                  size="sm"
                  @click="goToProviders"
                >
                  Back to provider setup
                </Button>
              </div>
            </Card>
          </div>
        </template>

        <!-- Step 3: Developer — toolkit overview for engineers. Text
             lives on the left (matches step 1's text-left/grid-right
             rhythm), feature grid on the right. -->
        <template v-else-if="currentStep === 'developer'">
          <div class="grid grid-cols-1 md:grid-cols-2 gap-4 items-stretch">
            <!-- Developer intro text -->
            <Card variant="muted" title="Developer" class="h-full">
              <div class="space-y-5">
                <h2 class="text-3xl font-normal text-[var(--app-foreground)] leading-tight">
                  Built to be extended<span class="text-app-accent">.</span>
                </h2>
                <p class="text-sm text-[var(--app-muted)] leading-relaxed">
                  Build inside or outside Construct — same toolkit, same
                  agent. Use
                  <span class="text-[var(--app-foreground)]">Spacekit</span>
                  to ship a new Space that runs inside Construct (its own
                  sidebar entry, pages, tools, agent). Or use
                  <span class="text-[var(--app-foreground)]">Builder</span>
                  to plan, write, and verify standalone projects — landing
                  pages, websites, mobile apps, whatever — outside Construct
                  entirely.
                </p>
                <p class="text-sm text-[var(--app-muted)] leading-relaxed">
                  Either way you get reactive data, a CLI, a design system,
                  and an agentic build loop one import away. Publish a Space
                  to the
                  <span class="uppercase tracking-wider"><span class="font-normal text-[var(--app-muted)]">Space</span><span class="font-bold text-[var(--app-foreground)]">Store</span></span>
                  when it's ready, or keep it private to your org.
                </p>

                <Button
                  :loading="state.loading"
                  :disabled="state.loading"
                  block
                  size="lg"
                  trailing-icon="i-lucide-arrow-right"
                  @click="continueFromDeveloper"
                >
                  CONTINUE
                </Button>

                <Button
                  variant="link"
                  block
                  size="sm"
                  @click="goToSpaces"
                >
                  Back to spaces
                </Button>
              </div>
            </Card>

            <!-- Developer toolkit grid -->
            <Card variant="muted" title="Toolkit" class="h-full">
              <ul class="grid grid-cols-3 gap-2">
                <li
                  v-for="t in devTools"
                  :key="t.name"
                  class="flex flex-col items-center gap-1.5 px-2 py-3 rounded-sm bg-[color-mix(in_srgb,var(--app-foreground)_3%,transparent)]"
                  :title="t.tagline"
                >
                  <Icon :name="t.icon" class="size-6 text-[var(--app-foreground)]" />
                  <span class="text-[10px] text-[var(--app-muted)] text-center leading-tight">{{ t.name }}</span>
                </li>
              </ul>
            </Card>
          </div>
        </template>

        <!-- Step 4: Organization — bring your whole team to Construct.
             Left card lists org capabilities, right card explains the
             org space and ends with the Go to Dashboard CTA. -->
        <template v-else>
          <div class="grid grid-cols-1 md:grid-cols-2 gap-4 items-stretch">
            <!-- Org feature grid + power moves -->
            <Card variant="muted" title="Organization" class="h-full">
              <div class="space-y-5">
                <ul class="grid grid-cols-3 gap-2">
                  <li
                    v-for="f in orgFeatures"
                    :key="f.name"
                    class="flex flex-col items-center gap-1.5 px-2 py-3 rounded-sm bg-[color-mix(in_srgb,var(--app-foreground)_3%,transparent)]"
                    :title="f.tagline"
                  >
                    <Icon :name="f.icon" class="size-6 text-[var(--app-foreground)]" />
                    <span class="text-[10px] text-[var(--app-muted)] text-center leading-tight">{{ f.name }}</span>
                  </li>
                </ul>

                <!-- What you can do with an org. Listed in the same
                     name + accent-dot + description pattern as the
                     Source capability list on step 1 so the two feel
                     like siblings. -->
                <ul class="space-y-2 pt-1">
                  <li class="flex items-baseline gap-2 text-xs">
                    <span class="font-normal text-[var(--app-foreground)] w-32 shrink-0 after:content-['.'] after:text-app-accent">Shared API keys</span>
                    <span class="text-[var(--app-muted)]">One key per provider, every member uses it. Bills to the org.</span>
                  </li>
                  <li class="flex items-baseline gap-2 text-xs">
                    <span class="font-normal text-[var(--app-foreground)] w-32 shrink-0 after:content-['.'] after:text-app-accent">Pre-installed Spaces</span>
                    <span class="text-[var(--app-muted)]">Pin tools that show up for everyone at first login.</span>
                  </li>
                  <li class="flex items-baseline gap-2 text-xs">
                    <span class="font-normal text-[var(--app-foreground)] w-32 shrink-0 after:content-['.'] after:text-app-accent">Private Space&nbsp;Store</span>
                    <span class="text-[var(--app-muted)]">Publish internal Spaces only your team can see.</span>
                  </li>
                  <li class="flex items-baseline gap-2 text-xs">
                    <span class="font-normal text-[var(--app-foreground)] w-32 shrink-0 after:content-['.'] after:text-app-accent">Default model</span>
                    <span class="text-[var(--app-muted)]">Set the org's preferred provider and model org-wide.</span>
                  </li>
                  <li class="flex items-baseline gap-2 text-xs">
                    <span class="font-normal text-[var(--app-foreground)] w-32 shrink-0 after:content-['.'] after:text-app-accent">Shared projects</span>
                    <span class="text-[var(--app-muted)]">Clone, track, and hand off projects across the team.</span>
                  </li>
                  <li class="flex items-baseline gap-2 text-xs">
                    <span class="font-normal text-[var(--app-foreground)] w-32 shrink-0 after:content-['.'] after:text-app-accent">SSO &amp; policies</span>
                    <span class="text-[var(--app-muted)]">Single sign-on, role-based access, audit trail.</span>
                  </li>
                  <li class="flex items-baseline gap-2 text-xs">
                    <span class="font-normal text-[var(--app-foreground)] w-32 shrink-0 after:content-['.'] after:text-app-accent">One bill</span>
                    <span class="text-[var(--app-muted)]">Usage, seats, and credits in a single statement.</span>
                  </li>
                </ul>
              </div>
            </Card>

            <!-- Org intro text -->
            <Card variant="muted" title="Bring your team" class="h-full">
              <div class="space-y-5">
                <h2 class="text-3xl font-normal text-[var(--app-foreground)] leading-tight">
                  One <span class="font-bold">organization</span>, one home<span class="text-app-accent">.</span>
                </h2>
                <p class="text-sm text-[var(--app-muted)] leading-relaxed">
                  Construct works for one person — and it works just as well
                  for your whole company. Spin up an Organization to invite
                  teammates, structure departments, assign roles, share
                  projects, and put everyone on the same billing plan.
                </p>
                <p class="text-sm text-[var(--app-muted)] leading-relaxed">
                  The
                  <span class="text-[var(--app-foreground)]">Org Space</span>
                  is the home base for all of that — and the gateway to
                  publishing private Spaces just for your team. When you
                  switch into your org, every Space (and every Source
                  session) picks up the org context automatically.
                </p>

                <Button
                  :loading="state.loading"
                  :disabled="state.loading"
                  block
                  size="lg"
                  trailing-icon="i-lucide-arrow-right"
                  @click="getStarted"
                >
                  {{ state.loading ? 'LOADING…' : 'GO TO DASHBOARD' }}
                </Button>

                <Button
                  variant="link"
                  block
                  size="sm"
                  @click="goToDeveloper"
                >
                  Back to developer
                </Button>
              </div>
            </Card>
          </div>
        </template>
      </div>
    </div>
  </div>
</template>
