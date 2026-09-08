<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { Button, Card, Separator } from '@construct-space/ui'
import { useAuthStore } from '@/stores/auth'
import { appConfig } from '@/utils/config'

const greeting = computed(() => {
  const h = new Date().getHours()
  if (h < 5) return { lead: 'Up', rest: 'late' }
  if (h < 12) return { lead: 'Good', rest: 'morning' }
  if (h < 18) return { lead: 'Good', rest: 'afternoon' }
  return { lead: 'Good', rest: 'evening' }
})

const userFirstName = computed(() =>
  authStore.user?.first_name || authStore.user?.name?.split(' ')[0] || 'there'
)

const authStore = useAuthStore()

const biometricAvailable = ref(false)
const biometricEnabled = ref(false)
const biometricBusy = ref(false)
const biometricError = ref('')

async function openExternal(url: string) {
  try {
    const { open } = await import('@tauri-apps/plugin-shell')
    await open(url)
  } catch {
    window.open(url, '_blank')
  }
}

function openAccountPortal() {
  openExternal(appConfig.accountsUrl)
}

function openDeleteAccount() {
  openExternal(`${appConfig.accountsUrl}/privacy`)
}

onMounted(async () => {
  biometricAvailable.value = await authStore.biometricAvailable()
  biometricEnabled.value = authStore.isBiometricUnlockEnabled()
})

async function toggleBiometric() {
  biometricError.value = ''
  biometricBusy.value = true
  try {
    if (biometricEnabled.value) {
      await authStore.disableBiometricUnlock()
      biometricEnabled.value = false
    } else {
      const ok = await authStore.enableBiometricUnlock()
      if (ok) {
        biometricEnabled.value = true
      } else {
        biometricError.value = 'Unable to enable biometric unlock — the prompt was cancelled or failed.'
      }
    }
  } finally {
    biometricBusy.value = false
  }
}

// --- Link a TV (Construct TV device-code login) ---
const tvUrl = (import.meta.env.VITE_TV_URL as string) || 'https://tv.construct.space'
const tvCode = ref('')
const tvBusy = ref(false)
const tvMsg = ref('')
const tvOk = ref(false)
async function linkTv() {
  const code = tvCode.value.trim().toUpperCase()
  if (!code) return
  tvBusy.value = true; tvMsg.value = ''; tvOk.value = false
  try {
    const token = authStore.token || authStore.oauthToken
    const r = await fetch(`${tvUrl}/api/device/link`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ user_code: code }),
    })
    const d = await r.json()
    if (r.ok && d.ok) { tvOk.value = true; tvMsg.value = 'TV linked ✓'; tvCode.value = '' }
    else { tvMsg.value = d.error || 'Could not link — check the code.' }
  } catch { tvMsg.value = 'Network error.' } finally { tvBusy.value = false }
}
</script>

<template>
  <div class="space-y-4">
    <!-- Greeting + account management -->
    <Card>
      <template #header>
        <div class="flex flex-col gap-1 min-w-0 flex-1">
          <p class="text-sm text-[var(--app-muted)] font-light">
            {{ greeting.lead }} <span class="font-semibold text-[var(--app-foreground)]">{{ greeting.rest }}</span>
          </p>
          <h2 class="text-[22px] font-semibold tracking-[-0.015em] leading-none text-[var(--app-foreground)]">
            {{ userFirstName }}<span class="text-[var(--app-accent)]">.</span>
          </h2>
          <p class="text-sm text-[var(--app-muted)] font-light tracking-[0.01em] truncate">
            {{ authStore.userEmail }}
          </p>
        </div>
      </template>
      <template #accessory>
        <Button variant="soft" color="neutral" label="Open Account Portal" @click="openAccountPortal" />
      </template>
      <p class="text-sm text-[var(--app-muted)]">
        Update your profile, password, and security settings on my.construct.space
      </p>
    </Card>

    <!-- Biometric unlock -->
    <Card
      v-if="biometricAvailable"
      title="Biometric unlock"
      description="Require Touch ID / Windows Hello to unlock Construct on launch. Your tokens stay in the OS keychain."
    >
      <template #accessory>
        <Button
          variant="soft"
          :color="biometricEnabled ? 'success' : 'neutral'"
          :label="biometricBusy ? 'Working…' : biometricEnabled ? 'Enabled' : 'Enable'"
          :disabled="biometricBusy"
          @click="toggleBiometric"
        />
      </template>
      <template v-if="biometricError" #default>
        <p class="text-xs text-red-500">{{ biometricError }}</p>
      </template>
    </Card>

    <!-- Link a TV -->
    <Card
      title="Link a TV"
      description="Open Construct TV on your television, then enter the code it shows to sign that TV into your account."
    >
      <div class="flex items-center gap-2">
        <input
          v-model="tvCode"
          placeholder="XXXX-XXXX"
          maxlength="9"
          class="flex-1 px-3 py-2 rounded-md border border-[var(--app-border)] bg-[var(--app-input-bg)] text-sm text-[var(--app-foreground)] uppercase tracking-widest outline-none focus:border-[var(--app-accent)]"
          @keydown.enter="linkTv"
        />
        <Button :label="tvBusy ? 'Linking…' : 'Link TV'" :disabled="tvBusy || !tvCode" @click="linkTv" />
      </div>
      <p v-if="tvMsg" class="text-xs mt-2" :class="tvOk ? 'text-green-500' : 'text-red-500'">{{ tvMsg }}</p>
    </Card>

    <!-- Danger zone -->
    <Separator label="Danger Zone" color="accent" class="mt-4" />
    <Card
      title="Delete Account"
      description="Permanently delete your account and all associated data. This action cannot be undone."
    >
      <template #accessory>
        <Button variant="soft" color="error" label="Delete Account" @click="openDeleteAccount" />
      </template>
    </Card>
  </div>
</template>
