<script setup lang="ts">
/**
 * OnboardingPage — Multi-step first-run setup
 *
 * Step 1: Set projects directory (default ~/ConstructProjects)
 * Step 2: Connect AI providers (OAuth + API keys)
 * Step 3: Install spaces from marketplace
 */

import { useSpaceMarketplace } from '@/composables/useSpaceMarketplace'
import { useSpaces } from '@/composables/useSpaces'
import { usePinnedStore, createSpacePin } from '@/stores/pinned'
import { getSpace as getSpaceTheme } from '@/config/spaces'
import { useProviderAuth } from '@/composables/useProviderAuth'
import { useOperator } from '@/operator'
import { useContextDB } from '@/composables/useContextDB'
import { useProjectDirectory } from '@/composables/useProjectDirectory'
import { useAuthStore } from '@/stores/auth'
import { getSpaceManifestPath } from '@/lib/appPaths'
import Input from '@/components/ui/Input.vue'
import Button from '@/components/ui/Button.vue'
import {
  ArrowRight, ArrowLeft, Download, Check, Loader2,
  FolderOpen, Sparkles, Key, ExternalLink, Eye, EyeOff,
} from 'lucide-vue-next'

const router = useRouter()
const toast = useToast()
const pinnedStore = usePinnedStore()
const marketplace = useSpaceMarketplace()
const { loadSpaces } = useSpaces()
const projectDir = useProjectDirectory()
const providerAuth = useProviderAuth()
const operator = useOperator()
const db = useContextDB()
const authStore = useAuthStore()

// Per-user onboarding key
const onboardingKey = computed(() => {
  const userId = authStore.user?.id || authStore.user?.email || 'unknown'
  return `cp_onboarding_complete:${userId}`
})

// ── Step management ──
const currentStep = ref(1)
const totalSteps = 3

function nextStep() {
  if (currentStep.value < totalSteps) currentStep.value++
}
function prevStep() {
  if (currentStep.value > 1) currentStep.value--
}

// ── Step 1: Projects Path ──
const projectsPath = ref('')
const pathLoading = ref(false)
const pathSet = ref(false)

onMounted(async () => {
  // Load default path
  try {
    const defaultPath = await projectDir.getDefaultProjectsRoot()
    const savedRoot = await projectDir.getProjectsRoot()
    projectsPath.value = savedRoot || defaultPath
  } catch {
    projectsPath.value = '~/ConstructProjects'
  }

  // Check AI provider status
  try {
    await providerAuth.checkStatus()
    await checkOpenAIStatus()
    await loadProviderKeys()
  } catch { /* silent */ }

  // Check which spaces are already installed
  try {
    const { exists } = await import('@tauri-apps/plugin-fs')
    const { homeDir } = await import('@tauri-apps/api/path')
    const home = await homeDir()

    const diskInstalled = new Set<string>()
    for (const s of recommendedSpaces) {
      const manifestPath = getSpaceManifestPath(home, s.id)
      if (await exists(manifestPath)) {
        diskInstalled.add(s.id)
      }
    }

    if (diskInstalled.size > 0) {
      installedIds.value = diskInstalled
      selected.value = diskInstalled
    }
  } catch { /* Tauri FS not available */ }
})

async function browseProjectsPath() {
  const path = await projectDir.openFolderDialog('Choose Projects Folder')
  if (path) {
    projectsPath.value = path
  }
}

async function confirmProjectsPath() {
  pathLoading.value = true
  try {
    const success = await projectDir.setProjectsRoot(projectsPath.value)
    if (success) {
      pathSet.value = true
      toast.add({ title: 'Projects directory set', color: 'success' })
    } else {
      toast.add({ title: 'Failed to create directory', color: 'error' })
    }
  } catch {
    toast.add({ title: 'Failed to set projects directory', color: 'error' })
  } finally {
    pathLoading.value = false
  }
}

// ── Step 2: AI Providers ──
const openAIAuthenticated = ref(false)
const openAIAuthLoading = ref(false)
const openAIAuthCode = ref('')
const showOpenAIAuthCodeInput = ref(false)
const openAIAuthState = ref('')
const openAIAuthVerifier = ref('')

interface ProviderKeyConfig {
  id: string
  name: string
  description: string
  placeholder: string
  kvKey: string
}

const providers: ProviderKeyConfig[] = [
  { id: 'deepseek', name: 'DeepSeek', description: 'DeepSeek V3/R1 models', placeholder: 'sk-...', kvKey: 'provider_key:deepseek' },
  { id: 'xai', name: 'xAI (Grok)', description: 'Grok models', placeholder: 'xai-...', kvKey: 'provider_key:xai' },
  { id: 'zai', name: 'Z.AI', description: 'GLM / CogView models', placeholder: 'API key', kvKey: 'provider_key:zai' },
  { id: 'mimo', name: 'Xiaomi MiMo', description: 'MiMo reasoning model', placeholder: 'API key', kvKey: 'provider_key:mimo' },
  { id: 'kimi', name: 'Kimi (Moonshot)', description: 'Moonshot AI models', placeholder: 'API key', kvKey: 'provider_key:kimi' },
]

const apiKeys = ref<Record<string, string>>({})
const visibleKeys = ref<Record<string, boolean>>({})
const savedKeys = ref<Record<string, boolean>>({})
const savingKeys = ref<Record<string, boolean>>({})
const configuredProviders = ref<Record<string, boolean>>({})

function toggleVisibility(id: string) {
  visibleKeys.value[id] = !visibleKeys.value[id]
}

async function saveKey(provider: ProviderKeyConfig) {
  const value = apiKeys.value[provider.id]?.trim()
  if (!value) return
  savingKeys.value[provider.id] = true
  try {
    await operator.send('settings.set', { key: provider.kvKey, value })
    try { await db.kvSet(provider.kvKey, value, 'provider_keys') } catch { /* ignore */ }
    configuredProviders.value[provider.id] = true
    savedKeys.value[provider.id] = true
    setTimeout(() => { savedKeys.value[provider.id] = false }, 2000)
    toast.add({ title: `${provider.name} API key saved`, color: 'success' })
  } catch {
    toast.add({ title: `Failed to save ${provider.name} key`, color: 'error' })
  } finally {
    savingKeys.value[provider.id] = false
  }
}

async function loadProviderKeys() {
  for (const p of providers) {
    try {
      const val = await db.kvGet(p.kvKey)
      if (val) apiKeys.value[p.id] = val
    } catch { /* ignore */ }
  }
  try {
    const result = await operator.send('settings.provider_status', {}) as { providers?: Record<string, boolean> }
    if (result?.providers) configuredProviders.value = result.providers
  } catch { /* ignore */ }
}

async function checkOpenAIStatus() {
  if (!operator.isTauri.value) return
  try {
    const result = await operator.send('auth.openai.status', {}) as { authenticated?: boolean }
    openAIAuthenticated.value = !!result?.authenticated
  } catch {
    openAIAuthenticated.value = false
  }
}

// OpenAI OAuth
async function startOpenAIAuth() {
  if (!operator.isTauri.value) return
  openAIAuthLoading.value = true
  try {
    const result = await operator.send('auth.openai.start', {}) as {
      auth_url?: string
      url?: string
      state?: string
      verifier?: string
      authenticated?: boolean
    }
    if (result?.authenticated) {
      await checkOpenAIStatus()
      toast.add({ title: 'OpenAI connected', color: 'success' })
      openAIAuthState.value = ''
      openAIAuthVerifier.value = ''
      return
    }
    const authUrl = result?.auth_url || result?.url
    if (!authUrl) throw new Error('No auth URL')
    showOpenAIAuthCodeInput.value = true
    openAIAuthState.value = result?.state || ''
    openAIAuthVerifier.value = result?.verifier || ''
    try {
      const { open } = await import('@tauri-apps/plugin-shell')
      await open(authUrl)
    } catch {
      window.open(authUrl, '_blank')
    }
  } catch {
    openAIAuthState.value = ''
    openAIAuthVerifier.value = ''
    toast.add({ title: 'Failed to start OpenAI auth', color: 'error' })
  } finally {
    openAIAuthLoading.value = false
  }
}

async function submitOpenAICode() {
  if (!openAIAuthCode.value) return
  openAIAuthLoading.value = true
  try {
    const payload: Record<string, string> = { code: openAIAuthCode.value.trim() }
    if (openAIAuthState.value) payload.state = openAIAuthState.value
    if (openAIAuthVerifier.value) payload.code_verifier = openAIAuthVerifier.value
    const result = await operator.send('auth.openai.exchange', payload) as { authenticated?: boolean; success?: boolean; error?: string }
    if (result?.authenticated || result?.success) {
      showOpenAIAuthCodeInput.value = false
      openAIAuthCode.value = ''
      openAIAuthState.value = ''
      openAIAuthVerifier.value = ''
      await checkOpenAIStatus()
      toast.add({ title: 'OpenAI connected', color: 'success' })
      return
    }
    openAIAuthState.value = ''
    openAIAuthVerifier.value = ''
    toast.add({ title: result?.error || 'Failed to authenticate', color: 'error' })
  } catch {
    openAIAuthState.value = ''
    openAIAuthVerifier.value = ''
    toast.add({ title: 'OpenAI authentication failed', color: 'error' })
  } finally {
    openAIAuthLoading.value = false
  }
}

const connectedProviderCount = computed(() => {
  let count = 0
  if (providerAuth.isAuthenticated.value) count++
  if (openAIAuthenticated.value) count++
  count += Object.values(configuredProviders.value).filter(Boolean).length
  return count
})

// ── Step 3: Spaces ──
const recommendedSpaces = [
  { id: 'code', name: 'Code', description: 'Code editor with terminal & git', recommended: true },
  { id: 'design', name: 'Design', description: 'Visual design tool', recommended: true },
  { id: 'kanban', name: 'Tasks', description: 'Project management with boards' },
  { id: 'docs', name: 'Docs', description: 'Project documentation' },
  { id: 'notes', name: 'Notes', description: 'Sticky notes and reminders' },
  { id: 'terminal', name: 'Terminal', description: 'Terminal emulator' },
  { id: 'git', name: 'Git', description: 'Version control' },
  { id: 'calendar', name: 'Calendar', description: 'Events and scheduling' },
  { id: 'ai', name: 'AI', description: 'AI-powered project assistant' },
  { id: 'chat', name: 'Chat', description: 'Team chat with AI' },
]

const selected = ref<Set<string>>(new Set(['code', 'design']))
const installing = ref(false)
const installedIds = ref<Set<string>>(new Set())
const currentInstall = ref('')
const installError = ref<string | null>(null)

const spaceCards = computed(() => {
  return recommendedSpaces.map(s => {
    const theme = getSpaceTheme(s.id)
    return {
      ...s,
      icon: theme.icon,
      color: theme.color,
      bg: theme.bg,
      isSelected: selected.value.has(s.id),
      isInstalled: installedIds.value.has(s.id),
    }
  })
})

function toggleSpace(id: string) {
  if (installedIds.value.has(id)) return
  const newSet = new Set(selected.value)
  if (newSet.has(id)) newSet.delete(id)
  else newSet.add(id)
  selected.value = newSet
}

async function finishOnboarding() {
  installing.value = true
  installError.value = null

  try {
    // Set projects path if not yet set
    if (!pathSet.value && projectsPath.value) {
      await projectDir.setProjectsRoot(projectsPath.value)
    }

    // Initialize pinned store
    if (pinnedStore.items.length === 0) {
      await pinnedStore.init()
    }

    // Install or pin selected spaces
    for (const id of selected.value) {
      currentInstall.value = id
      if (!installedIds.value.has(id)) {
        try {
          await marketplace.install(id)
          installedIds.value.add(id)
        } catch (err) {
          console.error(`Failed to install ${id}:`, err)
          continue
        }
      }
      const space = recommendedSpaces.find(s => s.id === id)
      const theme = getSpaceTheme(id)
      if (space) {
        const pin = createSpacePin({ name: space.name, spaceId: id, icon: theme.icon })
        await pinnedStore.addPin(pin)
      }
    }

    await loadSpaces()
    localStorage.setItem(onboardingKey.value, 'true')
    router.push('/app')
  } catch (error) {
    console.error('Onboarding error:', error)
    installError.value = 'Some spaces failed to install. You can install them later from the Marketplace.'
    localStorage.setItem(onboardingKey.value, 'true')
    router.push('/app')
  } finally {
    installing.value = false
    currentInstall.value = ''
  }
}

function skipOnboarding() {
  // Still set projects path if entered
  if (projectsPath.value) {
    projectDir.setProjectsRoot(projectsPath.value)
  }
  localStorage.setItem(onboardingKey.value, 'true')
  router.push('/app')
}
</script>

<template>
  <div class="min-h-screen bg-[var(--app-background)]">
    <div class="min-h-screen flex items-center justify-center px-6 py-12">
      <div class="w-full max-w-2xl">

        <!-- Logo + Step indicator -->
        <div class="text-center mb-8">
          <svg width="40" height="40" viewBox="0 0 533 533" fill="currentColor" class="text-app-accent mx-auto mb-4">
            <path d="M266.5 410.156C230.912 410.156 199.106 402.203 171.081 386.297C143.056 370.39 121.036 348.519 105.022 320.684C89.0072 292.848 81 261.256 81 225.909C81 190.12 89.0072 158.308 105.022 130.472C121.036 102.636 143.056 80.7655 171.081 64.8593C199.106 48.9531 230.912 41 266.5 41C302.087 41 333.671 48.9531 361.252 64.8593C389.277 80.7655 411.297 102.636 427.311 130.472C443.326 158.308 451.555 190.12 452 225.909C452 261.256 443.77 292.848 427.311 320.684C411.297 348.519 389.277 370.39 361.252 386.297C333.671 402.203 302.087 410.156 266.5 410.156ZM266.5 363.763C292.301 363.763 315.433 357.798 335.896 345.868C356.359 333.939 372.373 317.591 383.939 296.824C395.505 276.058 401.288 252.42 401.288 225.909C401.288 199.399 395.505 175.761 383.939 154.994C372.373 133.786 356.359 117.217 335.896 105.287C315.433 93.3579 292.301 87.393 266.5 87.393C240.699 87.393 217.567 93.3579 197.104 105.287C176.641 117.217 160.405 133.786 148.394 154.994C136.828 175.761 131.045 199.399 131.045 225.909C131.045 252.42 136.828 276.058 148.394 296.824C160.405 317.591 176.641 333.939 197.104 345.868C217.567 357.798 240.699 363.763 266.5 363.763Z" />
            <path d="M378.22 451.578C393.077 451.578 405.121 460.85 405.121 472.289C405.121 483.727 393.077 493 378.22 493H160.945C146.089 493 134.044 483.727 134.044 472.289C134.044 460.85 146.089 451.578 160.945 451.578H378.22Z" />
          </svg>

          <!-- Step dots -->
          <div class="flex items-center justify-center gap-2 mb-6">
            <div
              v-for="s in totalSteps"
              :key="s"
              class="h-1.5 rounded-full transition-all duration-300"
              :class="s === currentStep ? 'w-8 bg-app-accent' : s < currentStep ? 'w-4 bg-app-accent/40' : 'w-4 bg-[var(--app-border)]'"
            />
          </div>
        </div>

        <!-- ═══ STEP 1: Projects Path ═══ -->
        <div v-if="currentStep === 1">
          <div class="text-center mb-8">
            <h1 class="text-2xl font-bold text-[var(--app-foreground)] mb-2">Where should projects live?</h1>
            <p class="text-sm text-[var(--app-muted)]">Choose a folder for your Construct projects. You can change this later in Settings.</p>
          </div>

          <div class="p-6 rounded-xl border border-[var(--app-border)] bg-[color-mix(in_srgb,var(--app-foreground)_3%,transparent)] mb-6">
            <div class="flex items-center gap-3 mb-4">
              <div class="size-10 rounded-lg bg-app-accent/10 flex items-center justify-center">
                <FolderOpen class="size-5 text-app-accent" />
              </div>
              <div>
                <p class="text-sm font-medium text-[var(--app-foreground)]">Projects Directory</p>
                <p class="text-xs text-[var(--app-muted)]">All new projects will be created here</p>
              </div>
            </div>

            <div class="flex gap-2">
              <div class="flex-1 px-3 py-2.5 rounded-lg border border-[var(--app-border)] bg-[var(--app-background)] text-sm text-[var(--app-foreground)] font-mono truncate">
                {{ projectsPath }}
              </div>
              <button
                class="flex items-center gap-1.5 px-4 py-2.5 rounded-lg text-sm border border-[var(--app-border)] text-[var(--app-foreground)] hover:bg-[color-mix(in_srgb,var(--app-foreground)_5%,transparent)] transition-colors"
                @click="browseProjectsPath"
              >
                <FolderOpen class="size-3.5" />
                Browse
              </button>
            </div>

            <div v-if="pathSet" class="mt-3 flex items-center gap-2 text-sm text-green-500">
              <Check class="size-4" />
              <span>Directory ready</span>
            </div>
          </div>
        </div>

        <!-- ═══ STEP 2: AI Providers ═══ -->
        <div v-else-if="currentStep === 2">
          <div class="text-center mb-8">
            <h1 class="text-2xl font-bold text-[var(--app-foreground)] mb-2">Connect AI providers</h1>
            <p class="text-sm text-[var(--app-muted)]">
              Connect your accounts or add API keys. You need at least one to use AI features.
              <span v-if="connectedProviderCount > 0" class="text-app-accent font-medium">
                {{ connectedProviderCount }} connected
              </span>
            </p>
          </div>

          <div class="space-y-4 mb-6">
            <!-- OAuth Providers -->
            <p class="text-xs font-semibold tracking-widest text-[var(--app-muted)] uppercase">OAuth Login</p>

            <!-- Claude (via Claude Code keychain) -->
            <div class="p-4 rounded-xl border border-[var(--app-border)]">
              <div class="flex items-center justify-between">
                <div class="flex items-center gap-3">
                  <div class="size-9 rounded-lg bg-purple-500/10 flex items-center justify-center">
                    <Sparkles class="size-4 text-purple-400" />
                  </div>
                  <div>
                    <p class="text-sm font-medium text-[var(--app-foreground)]">Claude</p>
                    <p class="text-xs text-[var(--app-muted)]">Uses tokens from Claude Code</p>
                  </div>
                </div>
                <span
                  v-if="providerAuth.isAuthenticated.value"
                  class="px-2 py-0.5 text-xs rounded-full bg-green-500/10 text-green-500"
                >
                  Connected
                </span>
                <button
                  v-else
                  class="px-3 py-1.5 text-xs rounded-lg bg-app-accent text-white hover:opacity-90 transition-opacity"
                  :disabled="providerAuth.isLoading.value"
                  @click="providerAuth.loginFromKeychain()"
                >
                  Use Claude Code
                </button>
              </div>
            </div>

            <!-- OpenAI -->
            <div class="p-4 rounded-xl border border-[var(--app-border)]">
              <div class="flex items-center justify-between">
                <div class="flex items-center gap-3">
                  <div class="size-9 rounded-lg bg-green-500/10 flex items-center justify-center">
                    <Sparkles class="size-4 text-green-400" />
                  </div>
                  <div>
                    <p class="text-sm font-medium text-[var(--app-foreground)]">OpenAI</p>
                    <p class="text-xs text-[var(--app-muted)]">GPT models via account OAuth</p>
                  </div>
                </div>
                <span
                  v-if="openAIAuthenticated"
                  class="px-2 py-0.5 text-xs rounded-full bg-green-500/10 text-green-500"
                >
                  Connected
                </span>
                <button
                  v-else-if="!showOpenAIAuthCodeInput"
                  class="px-3 py-1.5 text-xs rounded-lg bg-app-accent text-white hover:opacity-90 transition-opacity"
                  :disabled="openAIAuthLoading"
                  @click="startOpenAIAuth"
                >
                  Connect
                </button>
              </div>
              <!-- Auth code input -->
              <div v-if="showOpenAIAuthCodeInput && !openAIAuthenticated" class="mt-3 flex gap-2">
                <Input v-model="openAIAuthCode" placeholder="Paste authorization code..." size="sm" class="flex-1" />
                <Button size="sm" :loading="openAIAuthLoading" :disabled="!openAIAuthCode" label="Submit" @click="submitOpenAICode" />
                <Button size="sm" variant="ghost" label="Cancel" @click="showOpenAIAuthCodeInput = false; openAIAuthCode = ''; openAIAuthState = ''; openAIAuthVerifier = ''" />
              </div>
            </div>

            <!-- API Key Providers -->
            <p class="text-xs font-semibold tracking-widest text-[var(--app-muted)] uppercase pt-2">API Keys</p>

            <div
              v-for="provider in providers"
              :key="provider.id"
              class="p-4 rounded-xl border border-[var(--app-border)]"
            >
              <div class="flex items-center justify-between mb-2">
                <div class="flex items-center gap-3">
                  <div class="size-9 rounded-lg bg-[color-mix(in_srgb,var(--app-accent)_10%,transparent)] flex items-center justify-center">
                    <Key class="size-4 text-app-accent" />
                  </div>
                  <div>
                    <p class="text-sm font-medium text-[var(--app-foreground)]">{{ provider.name }}</p>
                    <p class="text-xs text-[var(--app-muted)]">{{ provider.description }}</p>
                  </div>
                </div>
                <span
                  v-if="configuredProviders[provider.id]"
                  class="px-2 py-0.5 text-[10px] rounded-full bg-green-500/10 text-green-500"
                >
                  Saved
                </span>
              </div>
              <div class="flex gap-2">
                <div class="flex-1 relative">
                  <Input
                    v-model="apiKeys[provider.id]"
                    :type="visibleKeys[provider.id] ? 'text' : 'password'"
                    :placeholder="provider.placeholder"
                    size="sm"
                  />
                  <button
                    v-if="apiKeys[provider.id]"
                    class="absolute right-2 top-1/2 -translate-y-1/2 text-[var(--app-muted)] hover:text-[var(--app-foreground)] transition-colors"
                    @click="toggleVisibility(provider.id)"
                  >
                    <component :is="visibleKeys[provider.id] ? EyeOff : Eye" class="size-3.5" />
                  </button>
                </div>
                <Button
                  v-if="savedKeys[provider.id]"
                  size="sm" variant="ghost" disabled
                >
                  <Check class="size-3.5 text-green-500" />
                </Button>
                <Button
                  v-else
                  size="sm"
                  :loading="savingKeys[provider.id]"
                  :disabled="!apiKeys[provider.id]?.trim()"
                  label="Save"
                  @click="saveKey(provider)"
                />
              </div>
            </div>
          </div>
        </div>

        <!-- ═══ STEP 3: Spaces ═══ -->
        <div v-else-if="currentStep === 3">
          <div class="text-center mb-8">
            <h1 class="text-2xl font-bold text-[var(--app-foreground)] mb-2">Install spaces</h1>
            <p class="text-sm text-[var(--app-muted)]">Pick workspaces to get started. You can add more from the Marketplace anytime.</p>
          </div>

          <!-- Space grid -->
          <div class="grid grid-cols-3 gap-3 mb-6">
            <button
              v-for="space in spaceCards"
              :key="space.id"
              class="relative text-left p-4 rounded-xl border-2 transition-all"
              :class="[
                space.isInstalled
                  ? 'border-green-500/30 bg-green-500/5 opacity-70'
                  : space.isSelected
                    ? 'border-[var(--app-accent)] bg-[color-mix(in_srgb,var(--app-accent)_5%,transparent)]'
                    : 'border-[var(--app-border)] hover:border-[color-mix(in_srgb,var(--app-accent)_20%,transparent)]'
              ]"
              :disabled="installing"
              @click="toggleSpace(space.id)"
            >
              <!-- Status indicator -->
              <div class="absolute top-3 right-3">
                <Check v-if="space.isInstalled" class="size-4 text-green-400" />
                <div
                  v-else
                  class="size-5 rounded-md border-2 flex items-center justify-center transition-all"
                  :class="space.isSelected
                    ? 'border-[var(--app-accent)] bg-[var(--app-accent)]'
                    : 'border-[var(--app-border)]'"
                >
                  <svg v-if="space.isSelected" class="size-3 text-white" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M2 6l3 3 5-5" />
                  </svg>
                </div>
              </div>

              <!-- Recommended badge -->
              <span
                v-if="space.recommended"
                class="absolute top-3 left-3 text-[9px] font-medium px-1.5 py-0.5 rounded bg-[var(--app-accent)]/10 text-[var(--app-accent)]"
              >
                Recommended
              </span>

              <!-- Icon -->
              <div
                class="size-9 rounded-lg flex items-center justify-center mb-2"
                :class="space.bg"
                :style="space.recommended ? 'margin-top: 1rem' : ''"
              >
                <Icon :name="space.icon" class="size-4.5" :class="space.color" />
              </div>

              <!-- Name & description -->
              <h3 class="text-sm font-semibold text-[var(--app-foreground)] mb-0.5">{{ space.name }}</h3>
              <p class="text-[11px] text-[var(--app-muted)] line-clamp-2 leading-relaxed">{{ space.description }}</p>
            </button>
          </div>

          <!-- Install progress -->
          <div v-if="installing" class="mb-6 p-4 rounded-lg border border-[var(--app-border)] bg-[color-mix(in_srgb,var(--app-accent)_3%,transparent)]">
            <div class="flex items-center gap-3">
              <Loader2 class="size-4 text-app-accent animate-spin" />
              <span class="text-sm text-[var(--app-foreground)]">Installing {{ currentInstall }}...</span>
            </div>
          </div>

          <!-- Error -->
          <div v-if="installError" class="mb-6 p-4 rounded-lg border border-amber-500/20 bg-amber-500/5">
            <p class="text-sm text-amber-400">{{ installError }}</p>
          </div>
        </div>

        <!-- ═══ Footer Navigation ═══ -->
        <div class="flex items-center justify-between mt-8">
          <div>
            <button
              v-if="currentStep === 1"
              class="text-sm text-[var(--app-muted)] hover:text-[var(--app-foreground)] transition-colors"
              @click="skipOnboarding"
            >
              Skip setup
            </button>
            <button
              v-else
              class="flex items-center gap-1.5 text-sm text-[var(--app-muted)] hover:text-[var(--app-foreground)] transition-colors"
              :disabled="installing"
              @click="prevStep"
            >
              <ArrowLeft class="size-3.5" />
              Back
            </button>
          </div>

          <div class="flex items-center gap-3">
            <!-- Step 2 skip -->
            <button
              v-if="currentStep === 2"
              class="text-sm text-[var(--app-muted)] hover:text-[var(--app-foreground)] transition-colors"
              @click="nextStep"
            >
              Skip for now
            </button>

            <!-- Next / Finish -->
            <button
              v-if="currentStep < totalSteps"
              class="flex items-center gap-2 px-6 py-2.5 rounded-lg bg-app-accent text-white font-medium text-sm hover:opacity-90 transition-opacity"
              @click="currentStep === 1 ? (confirmProjectsPath().then(nextStep)) : nextStep()"
            >
              Continue
              <ArrowRight class="size-4" />
            </button>
            <button
              v-else
              class="flex items-center gap-2 px-6 py-2.5 rounded-lg bg-app-accent text-white font-medium text-sm hover:opacity-90 transition-opacity disabled:opacity-50"
              :disabled="installing || selected.size === 0"
              @click="finishOnboarding"
            >
              <Download v-if="!installing" class="size-4" />
              <Loader2 v-else class="size-4 animate-spin" />
              {{ installing ? 'Installing...' : `Install ${selected.size} space${selected.size !== 1 ? 's' : ''} & Start` }}
            </button>
          </div>
        </div>

      </div>
    </div>
  </div>
</template>
