<script setup lang="ts">
import { onMounted } from 'vue'
import { useConstructAuth } from '@/composables/useConstructAuth'
import { isTauriEnv } from '@/utils/tauri'

const constructAuth = useConstructAuth()

onMounted(() => {
  const registerUrl = constructAuth.getRegisterUrl()

  if (isTauriEnv()) {
    import('@tauri-apps/plugin-shell').then(({ open }) => {
      open(registerUrl)
    }).catch(() => {
      window.open(registerUrl, '_blank')
    })
  } else {
    window.location.href = registerUrl
  }
})
</script>

<template>
  <div class="min-h-screen bg-gray-50 dark:bg-gray-950 flex items-center justify-center px-6">
    <div class="w-full max-w-sm text-center space-y-4">
      <p class="text-2xl">
        <span class="text-gray-400">REDIRECTING:</span><span class="font-bold text-gray-900 dark:text-white">REGISTER</span>
      </p>
      <p class="text-sm text-gray-500">
        Opening Construct Accounts to create your account...
      </p>
      <div class="w-6 h-6 border-2 border-app-accent border-t-transparent rounded-full animate-spin mx-auto" />
      <RouterLink
        to="/login"
        class="inline-block mt-4 text-sm text-gray-500 hover:text-app-accent transition-colors uppercase tracking-wider"
      >
        Back to Sign In
      </RouterLink>
    </div>
  </div>
</template>
