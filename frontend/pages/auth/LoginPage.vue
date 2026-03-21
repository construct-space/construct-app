<script setup lang="ts">
import { ref, watchEffect } from 'vue'
import { useRouter } from 'vue-router'
import { useAuthStore } from '@/stores/auth'
import { useConstructAuth } from '@/composables/useConstructAuth'
import { ExternalLink, UserPlus, ClipboardPaste, KeyRound } from 'lucide-vue-next'

const router = useRouter()
const authStore = useAuthStore()
const constructAuth = useConstructAuth()

const showCodeEntry = ref(false)
const codeError = ref('')

const handleLogin = () => {
  showCodeEntry.value = true
  constructAuth.startLogin()
}

const handlePasskeyLogin = () => {
  showCodeEntry.value = true
  constructAuth.startPasskeyLogin()
}

async function readClipboard(): Promise<string> {
  // Try Tauri clipboard plugin first (no native paste banner)
  try {
    const { readText } = await import('@tauri-apps/plugin-clipboard-manager')
    const text = await readText()
    return text?.trim() ?? ''
  } catch {
    // Fallback to web API
    try {
      return (await navigator.clipboard.readText()).trim()
    } catch {
      return ''
    }
  }
}

async function submitCode(raw: string) {
  let code = raw.trim()
  if (!code) return

  // Fix doubled paste: if code is 128 chars and both halves match, take first half
  if (code.length === 128) {
    const half = code.length / 2
    if (code.slice(0, half) === code.slice(half)) {
      code = code.slice(0, half)
    }
  }

  codeError.value = ''
  authStore.isLoading = true

  try {
    const tokenData = await constructAuth.exchangeCode(code)
    const apiToken = tokenData.access_token
    const oauthToken = tokenData.oauth_token || apiToken
    const profile = await constructAuth.fetchProfile(oauthToken)

    const { useApi } = await import('@/composables/useApi')
    const api = useApi()
    api.setToken(apiToken)

    authStore.token = apiToken
    authStore.oauthToken = oauthToken
    authStore.user = {
      id: Number(profile.id),
      email: profile.email,
      username: profile.username,
      first_name: profile.first_name,
      last_name: profile.last_name,
      name: `${profile.first_name} ${profile.last_name}`.trim(),
      created_at: '',
      updated_at: '',
    }
    authStore.isAuthenticated = true
    await authStore.persistAuthState()
  } catch (err) {
    codeError.value = err instanceof Error ? err.message : 'Invalid code. Please try again.'
  } finally {
    authStore.isLoading = false
  }
}

const handlePasteAndSubmit = async () => {
  const code = await readClipboard()
  if (!code) {
    codeError.value = 'Nothing in clipboard. Copy the authorization code first.'
    return
  }
  await submitCode(code)
}

// Redirect if already authenticated
watchEffect(() => {
  if (authStore.isAuthenticated) {
    router.push('/app')
  }
})
</script>

<template>
  <div class="min-h-screen bg-gray-50 dark:bg-gray-950">
    <div class="h-screen overflow-hidden flex items-center justify-center px-6">
      <div class="w-full max-w-sm">
        <!-- Header -->
        <div class="flex flex-col items-center gap-4 mb-10">
          <RouterLink to="/">
            <svg width="48" height="48" viewBox="0 0 533 533" fill="currentColor" class="text-app-accent">
              <path d="M266.5 410.156C230.912 410.156 199.106 402.203 171.081 386.297C143.056 370.39 121.036 348.519 105.022 320.684C89.0072 292.848 81 261.256 81 225.909C81 190.12 89.0072 158.308 105.022 130.472C121.036 102.636 143.056 80.7655 171.081 64.8593C199.106 48.9531 230.912 41 266.5 41C302.087 41 333.671 48.9531 361.252 64.8593C389.277 80.7655 411.297 102.636 427.311 130.472C443.326 158.308 451.555 190.12 452 225.909C452 261.256 443.77 292.848 427.311 320.684C411.297 348.519 389.277 370.39 361.252 386.297C333.671 402.203 302.087 410.156 266.5 410.156ZM266.5 363.763C292.301 363.763 315.433 357.798 335.896 345.868C356.359 333.939 372.373 317.591 383.939 296.824C395.505 276.058 401.288 252.42 401.288 225.909C401.288 199.399 395.505 175.761 383.939 154.994C372.373 133.786 356.359 117.217 335.896 105.287C315.433 93.3579 292.301 87.393 266.5 87.393C240.699 87.393 217.567 93.3579 197.104 105.287C176.641 117.217 160.405 133.786 148.394 154.994C136.828 175.761 131.045 199.399 131.045 225.909C131.045 252.42 136.828 276.058 148.394 296.824C160.405 317.591 176.641 333.939 197.104 345.868C217.567 357.798 240.699 363.763 266.5 363.763Z" />
              <path d="M378.22 451.578C393.077 451.578 405.121 460.85 405.121 472.289C405.121 483.727 393.077 493 378.22 493H160.945C146.089 493 134.044 483.727 134.044 472.289C134.044 460.85 146.089 451.578 160.945 451.578H378.22Z" />
            </svg>
          </RouterLink>
          <p class="text-2xl text-center">
            <span class="text-gray-400">CONSTRUCT:</span><span class="font-bold text-gray-900 dark:text-white">SIGN IN</span>
          </p>
          <p class="text-sm text-gray-500 text-center">
            Access your spaces and continue building.
          </p>
        </div>

        <!-- Actions -->
        <div class="space-y-6">
          <button
            @click="handleLogin"
            :disabled="authStore.isLoading"
            class="w-full py-3 rounded-md bg-app-accent text-app-accent-foreground font-medium hover:opacity-90 transition-opacity disabled:opacity-50 flex items-center justify-center gap-2"
          >
            <ExternalLink class="size-4" />
            {{ authStore.isLoading ? 'CONNECTING...' : 'SIGN IN WITH CONSTRUCT' }}
          </button>

          <button
            @click="handlePasskeyLogin"
            :disabled="authStore.isLoading"
            class="w-full py-3 rounded-md border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-white font-medium hover:border-app-accent transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
          >
            <KeyRound class="size-4" />
            SIGN IN WITH PASSKEY
          </button>

          <p class="text-sm text-gray-500 text-center">
            You'll be redirected to accounts.construct.space to sign in.
          </p>

          <!-- Manual code entry (shown after clicking sign in) -->
          <div v-if="showCodeEntry" class="pt-4 border-t border-gray-200 dark:border-gray-800 space-y-3">
            <p class="text-sm text-gray-500">
              If the app didn't open, copy the authorization code and click below:
            </p>
            <button
              @click="handlePasteAndSubmit"
              :disabled="authStore.isLoading"
              class="w-full py-2.5 rounded-md border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-white text-sm font-medium hover:border-app-accent transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
            >
              <ClipboardPaste class="size-4" />
              {{ authStore.isLoading ? 'Verifying...' : 'Paste Code & Sign In' }}
            </button>
            <p v-if="codeError" class="text-sm text-red-500">{{ codeError }}</p>
          </div>

          <!-- Footer Links -->
          <div class="pt-6 border-t border-gray-200 dark:border-gray-800 space-y-3">
            <a
              :href="constructAuth.getRegisterUrl()"
              target="_blank"
              class="flex items-center justify-center gap-2 text-gray-600 dark:text-gray-400 hover:text-app-accent transition-colors"
            >
              <UserPlus class="size-4" />
              <span class="text-sm uppercase tracking-wider">Create Account</span>
            </a>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
