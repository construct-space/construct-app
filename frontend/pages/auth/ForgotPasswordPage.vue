<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRoute } from 'vue-router'
import { useConstructAuth } from '@/composables/useConstructAuth'

const constructAuth = useConstructAuth()
const route = useRoute()

// Preserve the add-account intent across cross-links so the auth guard
// doesn't bounce already-authenticated users back to /app when they
// hop between /login, /register and /forgot-password.
const isAdd = computed(() => route.query.add === '1')
const loginHref = computed(() => isAdd.value ? '/login?add=1' : '/login')
const registerHref = computed(() => isAdd.value ? '/register?add=1' : '/register')

const email = ref('')
const isLoading = ref(false)
const error = ref('')
const success = ref(false)

const handleSubmit = async () => {
  error.value = ''
  isLoading.value = true
  try {
    await constructAuth.forgotPassword(email.value.trim())
    success.value = true
  } catch (err) {
    error.value = err instanceof Error ? err.message : 'Failed to send reset email'
  } finally {
    isLoading.value = false
  }
}
</script>

<template>
  <div class="min-h-screen bg-[var(--app-background)]">
    <div class="h-screen overflow-hidden flex items-center justify-center px-6">
      <div class="w-full max-w-sm">
        <!-- Header -->
        <div class="flex flex-col items-center gap-4 mb-8">
          <RouterLink to="/">
            <svg width="48" height="48" viewBox="0 0 533 533" fill="currentColor" class="text-app-accent">
              <path d="M266.5 410.156C230.912 410.156 199.106 402.203 171.081 386.297C143.056 370.39 121.036 348.519 105.022 320.684C89.0072 292.848 81 261.256 81 225.909C81 190.12 89.0072 158.308 105.022 130.472C121.036 102.636 143.056 80.7655 171.081 64.8593C199.106 48.9531 230.912 41 266.5 41C302.087 41 333.671 48.9531 361.252 64.8593C389.277 80.7655 411.297 102.636 427.311 130.472C443.326 158.308 451.555 190.12 452 225.909C452 261.256 443.77 292.848 427.311 320.684C411.297 348.519 389.277 370.39 361.252 386.297C333.671 402.203 302.087 410.156 266.5 410.156ZM266.5 363.763C292.301 363.763 315.433 357.798 335.896 345.868C356.359 333.939 372.373 317.591 383.939 296.824C395.505 276.058 401.288 252.42 401.288 225.909C401.288 199.399 395.505 175.761 383.939 154.994C372.373 133.786 356.359 117.217 335.896 105.287C315.433 93.3579 292.301 87.393 266.5 87.393C240.699 87.393 217.567 93.3579 197.104 105.287C176.641 117.217 160.405 133.786 148.394 154.994C136.828 175.761 131.045 199.399 131.045 225.909C131.045 252.42 136.828 276.058 148.394 296.824C160.405 317.591 176.641 333.939 197.104 345.868C217.567 357.798 240.699 363.763 266.5 363.763Z" />
              <path d="M378.22 451.578C393.077 451.578 405.121 460.85 405.121 472.289C405.121 483.727 393.077 493 378.22 493H160.945C146.089 493 134.044 483.727 134.044 472.289C134.044 460.85 146.089 451.578 160.945 451.578H378.22Z" />
            </svg>
          </RouterLink>
          <p class="text-2xl text-center">
            <span class="text-[var(--app-muted)]">CONSTRUCT:</span><span class="font-bold text-[var(--app-foreground)]">RESET</span>
          </p>
          <p class="text-sm text-[var(--app-muted)] text-center">
            Enter your email to receive password reset instructions.
          </p>
        </div>

        <Card variant="muted">
          <div v-if="success" class="space-y-5 text-center py-2">
            <div class="flex items-center justify-center gap-3 text-app-accent">
              <Icon name="i-lucide-check-circle" class="size-6" />
              <h3 class="text-sm tracking-[0.08em] uppercase font-normal text-[var(--app-foreground)] after:content-['.'] after:text-app-accent">
                Check your email
              </h3>
            </div>
            <p class="text-sm text-[var(--app-muted)]">
              We've sent password reset instructions to
              <strong class="text-[var(--app-foreground)]">{{ email }}</strong>.
            </p>
            <RouterLink
              :to="loginHref"
              class="inline-flex items-center gap-2 text-[var(--app-muted)] hover:text-app-accent transition-colors"
            >
              <Icon name="i-lucide-arrow-left" class="size-4" />
              <span class="text-sm uppercase tracking-wider">Back to Sign In</span>
            </RouterLink>
          </div>

          <form v-else class="space-y-5" @submit.prevent="handleSubmit">
            <FormField label="Email" name="email" required>
              <Input
                v-model="email"
                type="email"
                icon="i-lucide-mail"
                size="lg"
                autocomplete="email"
                placeholder="you@example.com"
                autofocus
                required
              />
            </FormField>

            <Alert v-if="error" color="error" :description="error" />

            <Button
              type="submit"
              :loading="isLoading"
              :disabled="isLoading"
              block
              size="lg"
            >
              {{ isLoading ? 'SENDING…' : 'SEND RESET LINK' }}
            </Button>

            <div class="pt-4 border-t border-[var(--app-border)] space-y-3">
              <RouterLink
                :to="loginHref"
                class="flex items-center gap-2 text-[var(--app-muted)] hover:text-app-accent transition-colors"
              >
                <Icon name="i-lucide-arrow-left" class="size-4" />
                <span class="text-sm uppercase tracking-wider">Back to Sign In</span>
              </RouterLink>
              <RouterLink
                :to="registerHref"
                class="flex items-center gap-2 text-[var(--app-muted)] hover:text-app-accent transition-colors"
              >
                <Icon name="i-lucide-user-plus" class="size-4" />
                <span class="text-sm uppercase tracking-wider">Create Account</span>
              </RouterLink>
            </div>
          </form>
        </Card>
      </div>
    </div>
  </div>
</template>
