<script setup lang="ts">
/**
 * OnboardingPage — First-run welcome + AI provider setup
 *
 * 1. Explains what Construct is
 * 2. Lets user connect AI providers (OAuth)
 * 3. Auto-sets projects directory in background
 */

import { useProjectDirectory } from '@/composables/useProjectDirectory'
import { useAuthStore } from '@/stores/auth'
import { useProviderAuth } from '@/composables/useProviderAuth'
import { useOperator } from '@/operator'
import { ArrowRight, Sparkles, Check, Loader2 } from 'lucide-vue-next'

const router = useRouter()
const toast = useToast()
const projectDir = useProjectDirectory()
const authStore = useAuthStore()
const providerAuth = useProviderAuth()
const operator = useOperator()

// Per-user onboarding key
const onboardingKey = computed(() => {
  const userId = authStore.user?.id || authStore.user?.email || 'unknown'
  return `cp_onboarding_complete:${userId}`
})

const loading = ref(false)

// OAuth providers
const oauthProviders = reactive([
  { id: 'anthropic', name: 'Claude', description: 'Anthropic', icon: '🟣', connected: false, loading: false },
  { id: 'openai-codex', name: 'ChatGPT', description: 'OpenAI', icon: '🟢', connected: false, loading: false },
  { id: 'google-gemini-cli', name: 'Gemini', description: 'Google', icon: '🔵', connected: false, loading: false },
  { id: 'github-copilot', name: 'Copilot', description: 'GitHub', icon: '⚫', connected: false, loading: false },
])

const connectedCount = computed(() => oauthProviders.filter(p => p.connected).length)

onMounted(async () => {
  // Auto-set projects directory in background
  try {
    const defaultPath = await projectDir.getDefaultProjectsRoot()
    if (defaultPath) await projectDir.setProjectsRoot(defaultPath)
  } catch { /* ignore */ }

  // Check which providers are already connected
  await refreshProviderStatus()
})

async function refreshProviderStatus() {
  try {
    const result = await operator.send('oauth.providers', {}) as {
      providers?: Array<{ id?: string; connected?: boolean }>
    }
    const byId = new Map((result.providers || []).filter(p => p.id).map(p => [p.id!, p]))
    for (const p of oauthProviders) {
      p.connected = !!byId.get(p.id)?.connected
    }
  } catch { /* ignore */ }

  // Also check Claude Code keychain
  try {
    await providerAuth.checkStatus()
    const anthropic = oauthProviders.find(p => p.id === 'anthropic')
    if (anthropic && providerAuth.isAuthenticated.value) {
      anthropic.connected = true
    }
  } catch { /* ignore */ }
}

async function connectProvider(providerId: string) {
  const provider = oauthProviders.find(p => p.id === providerId)
  if (!provider || provider.connected) return

  provider.loading = true
  try {
    // Claude: try keychain first
    if (providerId === 'anthropic') {
      await providerAuth.loginFromKeychain()
      if (providerAuth.isAuthenticated.value) {
        provider.connected = true
        toast.add({ title: 'Claude connected', color: 'success' })
        return
      }
    }

    // OAuth flow
    const result = await operator.send('oauth.login', { provider: providerId })

    // Device code (GitHub Copilot) — skip on onboarding, direct to settings
    if (result?.device_code) {
      toast.add({ title: 'GitHub Copilot requires device code. Set up in Settings after onboarding.', color: 'info' })
      return
    }

    if (result?.success) {
      provider.connected = true
      toast.add({ title: `${provider.name} connected`, color: 'success' })
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    toast.add({ title: `Failed: ${msg}`, color: 'error' })
  } finally {
    provider.loading = false
    await refreshProviderStatus()
  }
}

async function getStarted() {
  loading.value = true
  try {
    localStorage.setItem(onboardingKey.value, 'true')
    router.push('/app')
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <div class="min-h-screen bg-[var(--app-background)]">
    <div class="min-h-screen flex items-center justify-center px-6 py-12">
      <div class="w-full max-w-lg">
<!-- Logo -->
        <div class="text-center mb-8">
          <svg width="48" height="48" viewBox="0 0 533 533" fill="currentColor" class="text-app-accent mx-auto mb-6">
            <path d="M266.5 410.156C230.912 410.156 199.106 402.203 171.081 386.297C143.056 370.39 121.036 348.519 105.022 320.684C89.0072 292.848 81 261.256 81 225.909C81 190.12 89.0072 158.308 105.022 130.472C121.036 102.636 143.056 80.7655 171.081 64.8593C199.106 48.9531 230.912 41 266.5 41C302.087 41 333.671 48.9531 361.252 64.8593C389.277 80.7655 411.297 102.636 427.311 130.472C443.326 158.308 451.555 190.12 452 225.909C452 261.256 443.77 292.848 427.311 320.684C411.297 348.519 389.277 370.39 361.252 386.297C333.671 402.203 302.087 410.156 266.5 410.156ZM266.5 363.763C292.301 363.763 315.433 357.798 335.896 345.868C356.359 333.939 372.373 317.591 383.939 296.824C395.505 276.058 401.288 252.42 401.288 225.909C401.288 199.399 395.505 175.761 383.939 154.994C372.373 133.786 356.359 117.217 335.896 105.287C315.433 93.3579 292.301 87.393 266.5 87.393C240.699 87.393 217.567 93.3579 197.104 105.287C176.641 117.217 160.405 133.786 148.394 154.994C136.828 175.761 131.045 199.399 131.045 225.909C131.045 252.42 136.828 276.058 148.394 296.824C160.405 317.591 176.641 333.939 197.104 345.868C217.567 357.798 240.699 363.763 266.5 363.763Z" />
            <path d="M378.22 451.578C393.077 451.578 405.121 460.85 405.121 472.289C405.121 483.727 393.077 493 378.22 493H160.945C146.089 493 134.044 483.727 134.044 472.289C134.044 460.85 146.089 451.578 160.945 451.578H378.22Z" />
          </svg>

          <h1 class="text-3xl font-bold text-[var(--app-foreground)] mb-3">Welcome to Construct</h1>
          <p class="text-sm text-[var(--app-muted)] max-w-md mx-auto leading-relaxed">
            Construct is your operating environment. It loads the spaces you need — code, design, docs, tasks, AI — and connects them into one place. Install what you need, build what you want.
          </p>
        </div>

        <!-- AI Providers -->
        <div class="mb-8">
          <div class="flex items-center gap-2 mb-4">
            <Sparkles class="size-4 text-app-accent" />
            <p class="text-sm font-medium text-[var(--app-foreground)]">Connect AI to get started</p>
            <span v-if="connectedCount > 0" class="text-xs text-green-400 ml-auto">{{ connectedCount }} connected</span>
          </div>

          <div class="grid grid-cols-2 gap-3">
            <button
              v-for="provider in oauthProviders"
              :key="provider.id"
              class="p-4 rounded-xl border-2 text-left transition-all"
              :class="[
                provider.connected
                  ? 'border-green-500/30 bg-green-500/5'
                  : 'border-[var(--app-border)] hover:border-[color-mix(in_srgb,var(--app-accent)_30%,transparent)]'
              ]"
              :disabled="provider.loading || provider.connected"
              @click="connectProvider(provider.id)"
            >
              <div class="flex items-center justify-between mb-2">
                <span class="text-lg">{{ provider.icon }}</span>
                <Check v-if="provider.connected" class="size-4 text-green-400" />
                <Loader2 v-else-if="provider.loading" class="size-4 text-app-accent animate-spin" />
              </div>
              <p class="text-sm font-semibold text-[var(--app-foreground)]">{{ provider.name }}</p>
              <p class="text-xs text-[var(--app-muted)]">{{ provider.description }}</p>
            </button>
          </div>

          <p class="text-xs text-[var(--app-muted)] mt-3 text-center">
            You can add more providers and API keys later in Settings.
          </p>
        </div>

        <!-- Get Started button -->
        <button
          class="w-full flex items-center justify-center gap-2 px-6 py-3 rounded-lg bg-app-accent text-white font-medium text-sm hover:opacity-90 transition-opacity disabled:opacity-50"
          :disabled="loading"
          @click="getStarted"
        >
          {{ loading ? 'Loading...' : 'Get Started' }}
          <ArrowRight v-if="!loading" class="size-4" />
        </button>
</div>
    </div>
  </div>
</template>
