<script setup lang="ts">
import { Button } from '@construct-space/ui'
import { useAuthStore } from '@/stores/auth'

const authStore = useAuthStore()

async function openExternal(url: string) {
  try {
    const { open } = await import('@tauri-apps/plugin-shell')
    await open(url)
  } catch {
    window.open(url, '_blank')
  }
}

function openAccountPortal() {
  openExternal('https://accounts.construct.space')
}

function openDeleteAccount() {
  openExternal('https://accounts.construct.space/danger-zone')
}
</script>

<template>
  <div>
    <!-- Account info (synced from accounts.construct.space) -->
    <div
      class="mb-6 p-4 rounded-lg border border-[var(--app-border)] bg-[color-mix(in_srgb,var(--app-muted)_5%,transparent)]">
      <div class="flex items-center gap-4">
        <div
          class="size-12 rounded-full bg-[color-mix(in_srgb,var(--app-accent)_15%,transparent)] flex items-center justify-center text-lg font-semibold text-[var(--app-accent)]">
          {{ (authStore.user?.first_name?.[0] || authStore.user?.name?.[0] || 'U').toUpperCase() }}
        </div>
        <div class="flex-1 min-w-0">
          <p class="text-sm font-medium text-[var(--app-foreground)]">{{ authStore.user?.name || 'User' }}</p>
          <p class="text-xs text-[var(--app-muted)]">{{ authStore.userEmail }}</p>
        </div>
      </div>
    </div>

    <!-- Manage account link -->
    <div class="rounded-lg border border-[var(--app-border)] p-4 flex items-center justify-between">
      <div>
        <p class="text-sm font-medium text-[var(--app-foreground)]">Manage your account</p>
        <p class="text-xs text-[var(--app-muted)] mt-0.5">
Update your profile, password, and security settings on
          accounts.construct.space
</p>
      </div>
      <Button variant="soft" color="neutral" label="Open Account Portal" @click="openAccountPortal" />
    </div>

    <!-- Danger zone -->
    <div class="mt-12 pt-6 border-t border-red-500/20">
      <p class="text-xs text-red-400 uppercase tracking-widest font-medium mb-3">Danger Zone</p>
      <div class="rounded-lg border border-red-500/20 p-4 flex items-center justify-between">
        <div>
          <p class="text-sm font-medium text-[var(--app-foreground)]">Delete Account</p>
          <p class="text-xs text-[var(--app-muted)] mt-0.5">
Permanently delete your account and all associated data.
            This action cannot be undone.
</p>
        </div>
        <Button variant="soft" color="error" label="Delete Account" @click="openDeleteAccount" />
      </div>
    </div>
  </div>
</template>
