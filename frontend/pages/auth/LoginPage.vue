<script setup lang="ts">
import { computed, nextTick, onMounted, ref, useTemplateRef, watchEffect } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { useAuthStore } from '@/stores/auth'
import { useProfileStore, type Profile } from '@/stores/profile'
import { useConstructAuth } from '@/composables/useConstructAuth'
import ProfileAvatar from '@/components/common/ProfileAvatar.vue'

const router = useRouter()
const route = useRoute()
const authStore = useAuthStore()
const profileStore = useProfileStore()
const constructAuth = useConstructAuth()

const mode = ref<'password' | '2fa'>('password')
const email = ref('')
const password = ref('')
const showPassword = ref(false)
const totpCode = ref('')
const pendingToken = ref('')
const errorMsg = ref('')
const isBusy = ref(false)

// Show "Sign in with Touch ID" when a stored session exists and the owner
// opted into biometric unlock. Resolved on mount so the button doesn't
// flicker in and out; null means "no stored candidate, hide the button".
const biometricEmail = ref<string | null>(null)

const passwordInput = useTemplateRef<HTMLInputElement>('passwordInput')

function focusPasswordField() {
  void nextTick(() => {
    const root = passwordInput.value as unknown as { $el?: HTMLElement } | HTMLElement | null
    if (!root) return
    const host = (root as { $el?: HTMLElement }).$el ?? (root as HTMLElement)
    const input = host instanceof HTMLElement ? host.querySelector('input') : null
    input?.focus()
  })
}

// macOS-style fast user switching — every known profile renders in the
// left rail; clicking one switches the active profile and rebinds the
// form (biometric candidate + prefilled email) without a route change.
const activeProfile = computed<Profile | null>(() =>
  profileStore.profiles.find(p => p.id === profileStore.activeProfileId) || null,
)
// Show the rail whenever the machine has any known profiles. Even a single
// profile gets a card — the user can still tap "Add account" or see who
// they're signing in as. The only times we hide the rail entirely:
//   - add-account mode (the user is explicitly adding a fresh identity)
//   - no profiles on disk at all (first-run / wiped install)
const hasAnyProfile = computed(() => profileStore.profiles.length >= 1)

// Switcher mode — entered by an already-authenticated user via the
// Sidebar's "Switch Profile" entry. Drives the Cancel button (back to /app)
// and the per-row TOUCH ID action.
const isSwitcherMode = computed(() => route.query.switch === '1' && authStore.isAuthenticated)

// Add-account mode — entered by an already-authenticated user via the
// picker's "Add account" card. The page shows the empty sign-in form
// so the user can authenticate against another identity without
// touching the current session.
const isAddAccountMode = computed(() => route.query.add === '1')

// Layout decisions:
// - Switcher is centered alone when profiles exist and we're not adding.
// - Login form is centered alone on first run (no profiles).
// - Add-account: split the page — switcher on the left, login form on the
//   right (matches the CONSTRUCT:PROFILE / CONSTRUCT:LOGIN mockup).
const showSwitcher = computed(() =>
  hasAnyProfile.value && mode.value === 'password',
)
// Show the login form whenever:
//  - no profiles exist yet (first run),
//  - the user explicitly opened "Add account",
//  - we're collecting a TOTP code, OR
//  - profiles exist but the active one is signed out. Without this last
//    clause, logging out (or switching to a profile with no stored
//    session) leaves the page rendering only the picker rail — clicking
//    another profile silently re-binds form state with no visible UI.
const showLoginForm = computed(() =>
  !hasAnyProfile.value
  || isAddAccountMode.value
  || mode.value === '2fa'
  || !authStore.isAuthenticated,
)
const isSplitLayout = computed(() => showSwitcher.value && showLoginForm.value)

// TOUCH ID on a row: if it's the active profile, unlock directly; otherwise
// switch first and then attempt biometric on the newly-active profile.
async function biometricForProfile(profile: Profile) {
  errorMsg.value = ''
  isBusy.value = true
  try {
    if (profile.id !== profileStore.activeProfileId) {
      await profileStore.switchProfile(profile.id)
      biometricEmail.value = await authStore.getBiometricCandidate()
      email.value = profile.email || ''
      password.value = ''
      if (authStore.isAuthenticated) {
        router.push('/app')
        return
      }
    }
    const ok = await authStore.signInWithBiometric()
    if (!ok) errorMsg.value = 'Biometric sign-in failed. Use your password to sign in.'
  } finally {
    isBusy.value = false
  }
}

async function switchToProfile(profile: Profile) {
  if (profile.id === profileStore.activeProfileId) {
    // In switcher mode (the user already has a live session and just
    // tapped their own row), treat the click as confirmation: take them
    // into the app rather than no-op'ing. Outside switcher mode this is
    // the unauthenticated flow — refresh the form binding so a stale
    // biometric candidate or pre-filled email gets re-resolved, and move
    // focus into the password field so the click has a visible effect
    // (otherwise tapping your own card looks broken).
    if (isSwitcherMode.value) {
      router.push('/app')
      return
    }
    email.value = profile.email || email.value
    // The logout flow rewrites profiles.json directly (auth.ts:392-428)
    // without going through profileStore.switchProfile, so when this card
    // becomes "active" after a logout the auth store hasn't re-hydrated
    // from this profile's auth.json. Attempt a hydrate before falling
    // back to biometric / password — if the user has stored tokens, this
    // signs them straight in.
    isBusy.value = true
    try {
      await authStore.initialize({ skipBiometric: true })
    } catch { /* fall through */ }
    finally { isBusy.value = false }
    if (authStore.isAuthenticated) {
      router.push('/app')
      return
    }
    // No stored session — offer biometric if this profile registered it,
    // otherwise focus the password field so the click has a clear effect.
    if (hasBiometricFor(profile)) {
      await handleBiometricSignIn()
    } else {
      focusPasswordField()
    }
    return
  }
  errorMsg.value = ''
  isBusy.value = true
  try {
    await profileStore.switchProfile(profile.id)
    // Rebind the form + biometric controls to the new active profile.
    biometricEmail.value = await authStore.getBiometricCandidate()
    email.value = profile.email || ''
    password.value = ''
    // If the new profile already had a live session on disk, switchProfile
    // hydrated it — bounce straight to /app. Otherwise drop the ?switch=1
    // flag so watchEffect's redirect (and the visible form) can resume.
    if (authStore.isAuthenticated) {
      router.push('/app')
      return
    }
    // No stored session for the chosen profile — show the password form
    // and move focus into it. Drop ?switch=1 if it was set (the switcher
    // mode is meaningless once we're no longer authenticated).
    if (isSwitcherMode.value || route.query.switch === '1') {
      router.replace({ path: '/login' })
    }
    focusPasswordField()
  } finally {
    isBusy.value = false
  }
}

function addAccount() {
  // "Add account" = sign in to an existing or new identity without dropping
  // the current session. /login?add=1 keeps the auth guard from bouncing an
  // already-authenticated user back to /app and tells the page to show the
  // empty sign-in form (not the switcher rail).
  router.push('/login?add=1')
}

// Picker cards lead with the first name + accent dot for that warm
// "Welcome back, Flak." feel — matches the home widget typography.
function firstName(full: string): string {
  return (full || '').trim().split(/\s+/)[0] || full || ''
}

// Decide whether a profile card should expose the TOUCH ID button.
// Active profile: trust the resolved `biometricEmail` (already keychain-
// preflighted in getBiometricCandidate). Other profiles: fall back to the
// per-email biometric_unlock flag — we can't preflight their keychain
// without switching, but the flag filters out profiles where biometric
// was never enabled. Stale flags self-heal on the next active-profile
// resolution. Without this gate, TOUCH ID always rendered and clicking
// it on a tokenless profile produced the "Biometric sign-in failed" error.
function hasBiometricFor(profile: Profile): boolean {
  if (!profile.email) return false
  if (profile.id === profileStore.activeProfileId) {
    return !!biometricEmail.value && biometricEmail.value === profile.email
  }
  return authStore.isBiometricFlagSetFor(profile.email)
}

onMounted(async () => {
  if (!profileStore.initialized) await profileStore.init()
  biometricEmail.value = await authStore.getBiometricCandidate()
  // Pre-fill the email field with the active profile's email so the user
  // can tap straight into the password without retyping. Skip in add-mode
  // (where the point is to sign in as someone else), and skip if the user
  // already started typing.
  if (!isAddAccountMode.value && !email.value && activeProfile.value?.email) {
    email.value = activeProfile.value.email
  }
})

async function handleBiometricSignIn() {
  errorMsg.value = ''
  isBusy.value = true
  try {
    const ok = await authStore.signInWithBiometric()
    if (!ok) {
      errorMsg.value = 'Biometric sign-in failed. Use your password to sign in.'
    }
  } finally {
    isBusy.value = false
  }
}

async function handlePasswordSubmit() {
  errorMsg.value = ''
  if (!email.value.trim() || !password.value) {
    errorMsg.value = 'Enter your email and password.'
    return
  }
  isBusy.value = true
  try {
    const result = await authStore.loginWithPassword(email.value.trim(), password.value)
    if (result.kind === 'ok') {
      // In add-account mode the watchEffect deliberately suppresses the
      // /app redirect (so an already-authenticated user can reach the
      // empty form). Once the new account is actually signed in we want
      // to enter the app as that identity — drive the navigation here.
      if (isAddAccountMode.value) router.push('/app')
      // Otherwise watchEffect handles the navigation.
      return
    }
    if (result.kind === 'needs_2fa') {
      pendingToken.value = result.pending_token
      mode.value = '2fa'
      totpCode.value = ''
      return
    }
    if (result.kind === 'needs_reset') {
      router.push(`/reset-password?token=${encodeURIComponent(result.reset_token)}`)
      return
    }
    errorMsg.value = result.error
  } finally {
    isBusy.value = false
  }
}

async function handleTwoFactorSubmit() {
  errorMsg.value = ''
  if (totpCode.value.trim().length < 6) {
    errorMsg.value = 'Enter the 6-digit code from your authenticator app.'
    return
  }
  isBusy.value = true
  try {
    const result = await authStore.completeTwoFactorLogin(pendingToken.value, totpCode.value.trim())
    if (result.kind === 'error') {
      errorMsg.value = result.error
    } else if (isAddAccountMode.value) {
      router.push('/app')
    }
  } finally {
    isBusy.value = false
  }
}

function cancelTwoFactor() {
  mode.value = 'password'
  pendingToken.value = ''
  totpCode.value = ''
  errorMsg.value = ''
}

// Keeps the OAuth fallback alive — useful for passkey users (WebAuthn can't
// run inside the Tauri webview because origin won't match the RP ID) or
// anyone who'd rather sign in via the browser.
function handleOAuthFallback() {
  constructAuth.startLogin()
}

// Auto-redirect into the app once we're authenticated — except when the
// user explicitly opened this page to switch (?switch=1) or to add an
// account (?add=1). In those intents the rail / form must stay mounted
// even though a live session already exists for the current profile.
watchEffect(() => {
  if (authStore.isAuthenticated && route.query.switch !== '1' && route.query.add !== '1') {
    router.push('/app')
  }
})
</script>

<template>
  <div class="min-h-screen bg-[var(--app-background)]">
    <div
      class="h-screen overflow-hidden flex items-center justify-center px-6"
      :class="isSplitLayout ? 'gap-10' : ''"
    >
      <!-- Profile switcher — centered alone when only profiles exist,
           or pinned to the left half when the user is adding a new
           account (split layout, mirrors the mockup). -->
      <aside
        v-if="showSwitcher"
        class="flex flex-col gap-3 max-h-[90vh] overflow-y-auto"
        :class="isSplitLayout ? 'w-full max-w-md' : 'w-full max-w-2xl'"
      >
        <!-- Header: logo + CONSTRUCT:PROFILE — mirrors the sign-in header -->
        <div class="flex items-center gap-3 mb-4">
          <svg width="36" height="36" viewBox="0 0 533 533" fill="currentColor" class="text-app-accent shrink-0">
            <path d="M266.5 410.156C230.912 410.156 199.106 402.203 171.081 386.297C143.056 370.39 121.036 348.519 105.022 320.684C89.0072 292.848 81 261.256 81 225.909C81 190.12 89.0072 158.308 105.022 130.472C121.036 102.636 143.056 80.7655 171.081 64.8593C199.106 48.9531 230.912 41 266.5 41C302.087 41 333.671 48.9531 361.252 64.8593C389.277 80.7655 411.297 102.636 427.311 130.472C443.326 158.308 451.555 190.12 452 225.909C452 261.256 443.77 292.848 427.311 320.684C411.297 348.519 389.277 370.39 361.252 386.297C333.671 402.203 302.087 410.156 266.5 410.156ZM266.5 363.763C292.301 363.763 315.433 357.798 335.896 345.868C356.359 333.939 372.373 317.591 383.939 296.824C395.505 276.058 401.288 252.42 401.288 225.909C401.288 199.399 395.505 175.761 383.939 154.994C372.373 133.786 356.359 117.217 335.896 105.287C315.433 93.3579 292.301 87.393 266.5 87.393C240.699 87.393 217.567 93.3579 197.104 105.287C176.641 117.217 160.405 133.786 148.394 154.994C136.828 175.761 131.045 199.399 131.045 225.909C131.045 252.42 136.828 276.058 148.394 296.824C160.405 317.591 176.641 333.939 197.104 345.868C217.567 357.798 240.699 363.763 266.5 363.763Z" />
            <path d="M378.22 451.578C393.077 451.578 405.121 460.85 405.121 472.289C405.121 483.727 393.077 493 378.22 493H160.945C146.089 493 134.044 483.727 134.044 472.289C134.044 460.85 146.089 451.578 160.945 451.578H378.22Z" />
          </svg>
          <p class="text-xl">
            <span class="text-[var(--app-muted)]">CONSTRUCT:</span>
            <span class="font-bold text-[var(--app-foreground)]">PROFILE</span>
          </p>
        </div>

        <div class="flex items-center justify-between px-1 mb-1">
          <p class="text-[10px] font-medium text-[var(--app-muted)] uppercase tracking-[0.12em]">
            {{ isSwitcherMode ? 'Switch profile' : 'Profiles' }}
          </p>
          <button
            v-if="isSwitcherMode"
            type="button"
            class="text-[11px] text-[var(--app-muted)] hover:text-[var(--app-foreground)] transition-colors"
            @click="router.push('/app')"
          >
            Cancel
          </button>
        </div>

        <Card
          v-for="(profile, index) in profileStore.profiles"
          :key="profile.id"
          variant="muted"
          interactive
          hoverable
          :class="isBusy ? 'opacity-50 pointer-events-none' : ''"
          @click="switchToProfile(profile)"
        >
          <div class="flex items-center gap-4">
            <ProfileAvatar
              :name="profile.name"
              :avatar="profile.avatar"
              :index="index"
              :size="44"
            />
            <div class="min-w-0 flex-1">
              <p class="text-xs text-[var(--app-muted)] leading-tight">
                {{ profile.id === profileStore.activeProfileId ? 'Welcome back,' : 'Sign in as' }}
              </p>
              <p class="text-base font-bold text-[var(--app-foreground)] truncate leading-tight mt-0.5 after:content-['.'] after:text-[var(--app-accent)]">
                {{ firstName(profile.name) }}
              </p>
              <p v-if="profile.email" class="text-[11px] text-[var(--app-muted)] truncate mt-1">{{ profile.email }}</p>
            </div>
            <Button
              v-if="hasBiometricFor(profile)"
              type="button"
              variant="soft"
              icon="i-lucide-fingerprint"
              :disabled="isBusy"
              @click.stop="biometricForProfile(profile)"
            >
              TOUCH ID
            </Button>
          </div>
        </Card>

        <Card
          v-if="!isSplitLayout"
          variant="muted"
          interactive
          hoverable
          class="text-[var(--app-muted)] hover:text-[var(--app-foreground)]"
          @click="addAccount"
        >
          <div class="flex items-center gap-4">
            <span class="size-11 rounded-full flex items-center justify-center shrink-0 bg-[color-mix(in_srgb,var(--app-foreground)_8%,transparent)]">
              <Icon name="i-lucide-plus" class="size-5" />
            </span>
            <span class="text-sm font-medium">Add account</span>
          </div>
        </Card>

        <!-- Biometric / profile actions originate on this side, so render
             errors next to the cards. The form-side <Alert> is suppressed
             in the split layout to avoid showing the same message twice. -->
        <Alert v-if="errorMsg" color="error" :description="errorMsg" />
      </aside>

      <div v-if="showLoginForm" class="w-full max-w-sm">
        <!-- Header -->
        <div class="flex flex-col items-center gap-4 mb-8">
          <RouterLink to="/">
            <svg width="48" height="48" viewBox="0 0 533 533" fill="currentColor" class="text-app-accent">
              <path d="M266.5 410.156C230.912 410.156 199.106 402.203 171.081 386.297C143.056 370.39 121.036 348.519 105.022 320.684C89.0072 292.848 81 261.256 81 225.909C81 190.12 89.0072 158.308 105.022 130.472C121.036 102.636 143.056 80.7655 171.081 64.8593C199.106 48.9531 230.912 41 266.5 41C302.087 41 333.671 48.9531 361.252 64.8593C389.277 80.7655 411.297 102.636 427.311 130.472C443.326 158.308 451.555 190.12 452 225.909C452 261.256 443.77 292.848 427.311 320.684C411.297 348.519 389.277 370.39 361.252 386.297C333.671 402.203 302.087 410.156 266.5 410.156ZM266.5 363.763C292.301 363.763 315.433 357.798 335.896 345.868C356.359 333.939 372.373 317.591 383.939 296.824C395.505 276.058 401.288 252.42 401.288 225.909C401.288 199.399 395.505 175.761 383.939 154.994C372.373 133.786 356.359 117.217 335.896 105.287C315.433 93.3579 292.301 87.393 266.5 87.393C240.699 87.393 217.567 93.3579 197.104 105.287C176.641 117.217 160.405 133.786 148.394 154.994C136.828 175.761 131.045 199.399 131.045 225.909C131.045 252.42 136.828 276.058 148.394 296.824C160.405 317.591 176.641 333.939 197.104 345.868C217.567 357.798 240.699 363.763 266.5 363.763Z" />
              <path d="M378.22 451.578C393.077 451.578 405.121 460.85 405.121 472.289C405.121 483.727 393.077 493 378.22 493H160.945C146.089 493 134.044 483.727 134.044 472.289C134.044 460.85 146.089 451.578 160.945 451.578H378.22Z" />
            </svg>
          </RouterLink>
          <p class="text-2xl text-center">
            <span class="text-[var(--app-muted)]">CONSTRUCT:</span>
            <span class="font-bold text-[var(--app-foreground)]">{{ mode === '2fa' ? 'VERIFY' : 'SIGN IN' }}</span>
          </p>
          <p v-if="mode === 'password'" class="text-sm text-[var(--app-muted)] text-center">
            Access your spaces and continue building.
          </p>
          <p v-else class="text-sm text-[var(--app-muted)] text-center">
            Enter the 6-digit code from your authenticator app.
          </p>
        </div>

        <!-- Password form -->
        <Card v-if="mode === 'password'" variant="muted">
          <form class="space-y-5" @submit.prevent="handlePasswordSubmit">
            <FormField label="Email" name="email" required>
              <Input
                v-model="email"
                type="email"
                placeholder="you@example.com"
                icon="i-lucide-mail"
                size="lg"
                autocomplete="email"
                autofocus
                required
              />
            </FormField>

            <FormField label="Password" name="password" required>
              <div class="relative">
                <Input
                  ref="passwordInput"
                  v-model="password"
                  :type="showPassword ? 'text' : 'password'"
                  placeholder="••••••••"
                  icon="i-lucide-lock"
                  size="lg"
                  autocomplete="current-password"
                  required
                  class="!pr-10"
                />
                <button
                  type="button"
                  tabindex="-1"
                  class="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 rounded text-[var(--app-muted)] hover:text-[var(--app-foreground)] transition-colors"
                  :aria-label="showPassword ? 'Hide password' : 'Show password'"
                  @click="showPassword = !showPassword"
                >
                  <Icon :name="showPassword ? 'i-lucide-eye-off' : 'i-lucide-eye'" class="size-4" />
                </button>
              </div>
            </FormField>

            <!-- In the split layout the rail renders this alert next to the
                 cards (biometric/profile actions live there). Outside the
                 split layout the form is the only surface, so show it here. -->
            <Alert v-if="errorMsg && !isSplitLayout" color="error" :description="errorMsg" />

            <Button
              type="submit"
              :loading="isBusy || authStore.isLoading"
              :disabled="isBusy || authStore.isLoading"
              block
              size="lg"
            >
              {{ isBusy || authStore.isLoading ? 'SIGNING IN…' : 'SIGN IN' }}
            </Button>

            <div class="flex items-center justify-between text-sm">
              <RouterLink
                :to="isAddAccountMode ? '/forgot-password?add=1' : '/forgot-password'"
                class="text-[var(--app-muted)] hover:text-app-accent transition-colors"
              >
                Forgot password?
              </RouterLink>
              <RouterLink
                :to="isAddAccountMode ? '/register?add=1' : '/register'"
                class="flex items-center gap-1.5 text-[var(--app-muted)] hover:text-app-accent transition-colors"
              >
                <Icon name="i-lucide-user-plus" class="size-3.5" />
                Create account
              </RouterLink>
            </div>

            <div v-if="!isSplitLayout" class="pt-4 border-t border-[var(--app-border)] space-y-2">
              <div class="grid gap-2" :class="biometricEmail ? 'grid-cols-2' : 'grid-cols-1'">
                <Button
                  v-if="biometricEmail"
                  type="button"
                  variant="soft"
                  icon="i-lucide-fingerprint"
                  :disabled="isBusy"
                  block
                  @click="handleBiometricSignIn"
                >
                  {{ isBusy ? 'UNLOCKING…' : 'TOUCH ID' }}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  color="neutral"
                  icon="i-lucide-key-round"
                  trailing-icon="i-lucide-external-link"
                  block
                  @click="handleOAuthFallback"
                >
                  PASSKEY
                </Button>
              </div>
              <p v-if="biometricEmail" class="text-xs text-[var(--app-muted)] text-center">
                Continue as <strong class="text-[var(--app-foreground)]">{{ biometricEmail }}</strong> with Touch ID,
                or sign in with your passkey in the browser.
              </p>
              <p v-else class="text-xs text-[var(--app-muted)] text-center">
                Passkey opens my.construct.space in your browser.
              </p>
            </div>
</form>
        </Card>

        <!-- 2FA form -->
        <Card v-else variant="muted">
          <form class="space-y-5" @submit.prevent="handleTwoFactorSubmit">
            <FormField label="Authentication Code" name="totp" required>
              <Input
                v-model="totpCode"
                type="text"
                inputmode="numeric"
                autocomplete="one-time-code"
                pattern="[0-9]*"
                maxlength="6"
                placeholder="123456"
                size="lg"
                required
                autofocus
                class="text-center !text-lg tracking-[0.4em]"
              />
            </FormField>

            <!-- 2FA branch — split layout doesn't reach here, but keep the
                 form-only Alert for parity with the password form. -->
            <Alert v-if="errorMsg && !isSplitLayout" color="error" :description="errorMsg" />

            <Button
              type="submit"
              :loading="isBusy || authStore.isLoading"
              :disabled="isBusy || authStore.isLoading"
              block
              size="lg"
            >
              {{ isBusy || authStore.isLoading ? 'VERIFYING…' : 'VERIFY' }}
            </Button>

            <Button
              type="button"
              variant="ghost"
              color="neutral"
              block
              @click="cancelTwoFactor"
            >
              Use a different account
            </Button>
          </form>
        </Card>
      </div>
    </div>
  </div>
</template>
