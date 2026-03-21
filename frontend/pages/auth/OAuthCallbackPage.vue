<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useAuthStore } from '@/stores/auth'
import { useConstructAuth } from '@/composables/useConstructAuth'

const route = useRoute()
const router = useRouter()
const authStore = useAuthStore()
const constructAuth = useConstructAuth()

const error = ref('')
const status = ref('Authenticating...')

onMounted(async () => {
  console.log('[OAuthCallback] Mounted — query:', JSON.stringify(route.query))
  const code = route.query.code as string
  const state = route.query.state as string
  const errorParam = route.query.error as string

  if (errorParam) {
    console.log('[OAuthCallback] Error param:', errorParam)
    error.value = decodeURIComponent(errorParam)
    return
  }

  if (!code || !state) {
    console.log('[OAuthCallback] Missing code or state')
    error.value = 'Missing authorization code'
    return
  }

  // Validate state (CSRF protection)
  console.log('[OAuthCallback] Validating state...')
  if (!constructAuth.validateState(state)) {
    console.log('[OAuthCallback] State validation FAILED')
    error.value = 'Invalid state parameter. Please try again.'
    return
  }
  console.log('[OAuthCallback] State valid, exchanging code...')

  try {
    status.value = 'Exchanging authorization code...'
    const result = await authStore.loginWithOAuth(code)
    console.log('[OAuthCallback] loginWithOAuth result:', JSON.stringify(result))

    if (result.success) {
      router.replace('/app')
    } else {
      error.value = result.error || 'Authentication failed'
    }
  } catch (e) {
    console.error('[OAuthCallback] Error:', e)
    error.value = e instanceof Error ? e.message : 'Authentication failed'
  }
})
</script>

<template>
  <div class="min-h-screen bg-gray-50 dark:bg-gray-950 flex items-center justify-center px-6">
    <div class="w-full max-w-sm text-center">
      <svg width="48" height="48" viewBox="0 0 533 533" fill="currentColor" class="text-[#34C759] mx-auto mb-6">
        <path d="M266.5 410.156C230.912 410.156 199.106 402.203 171.081 386.297C143.056 370.39 121.036 348.519 105.022 320.684C89.0072 292.848 81 261.256 81 225.909C81 190.12 89.0072 158.308 105.022 130.472C121.036 102.636 143.056 80.7655 171.081 64.8593C199.106 48.9531 230.912 41 266.5 41C302.087 41 333.671 48.9531 361.252 64.8593C389.277 80.7655 411.297 102.636 427.311 130.472C443.326 158.308 451.555 190.12 452 225.909C452 261.256 443.77 292.848 427.311 320.684C411.297 348.519 389.277 370.39 361.252 386.297C333.671 402.203 302.087 410.156 266.5 410.156ZM266.5 363.763C292.301 363.763 315.433 357.798 335.896 345.868C356.359 333.939 372.373 317.591 383.939 296.824C395.505 276.058 401.288 252.42 401.288 225.909C401.288 199.399 395.505 175.761 383.939 154.994C372.373 133.786 356.359 117.217 335.896 105.287C315.433 93.3579 292.301 87.393 266.5 87.393C240.699 87.393 217.567 93.3579 197.104 105.287C176.641 117.217 160.405 133.786 148.394 154.994C136.828 175.761 131.045 199.399 131.045 225.909C131.045 252.42 136.828 276.058 148.394 296.824C160.405 317.591 176.641 333.939 197.104 345.868C217.567 357.798 240.699 363.763 266.5 363.763Z" />
        <path d="M378.22 451.578C393.077 451.578 405.121 460.85 405.121 472.289C405.121 483.727 393.077 493 378.22 493H160.945C146.089 493 134.044 483.727 134.044 472.289C134.044 460.85 146.089 451.578 160.945 451.578H378.22Z" />
      </svg>

      <div v-if="error" class="space-y-4">
        <p class="text-2xl">
          <span class="text-gray-400">AUTH:</span><span class="font-bold text-gray-900 dark:text-white">FAILED</span>
        </p>
        <p class="text-red-400 text-sm">{{ error }}</p>
        <RouterLink
          to="/login"
          class="inline-block mt-4 px-4 py-2 rounded-md bg-app-accent text-app-accent-foreground text-sm font-medium uppercase tracking-wider hover:opacity-90 transition-opacity"
        >
          Try Again
        </RouterLink>
      </div>

      <div v-else class="space-y-4">
        <p class="text-2xl">
          <span class="text-gray-400">AUTH:</span><span class="font-bold text-gray-900 dark:text-white">CONNECTING</span>
        </p>
        <p class="text-sm text-gray-500">{{ status }}</p>
        <div class="w-6 h-6 border-2 border-app-accent border-t-transparent rounded-full animate-spin mx-auto" />
      </div>
    </div>
  </div>
</template>
