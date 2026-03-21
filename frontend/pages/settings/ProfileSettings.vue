<script setup lang="ts">
import FormField from '@/components/ui/FormField.vue'
import Input from '@/components/ui/Input.vue'
import Button from '@/components/ui/Button.vue'
import { useAuthStore } from '@/stores/auth'
import { useApi } from '@/composables/useApi'

const authStore = useAuthStore()
const toast = useToast()
const api = useApi()

const form = ref({
  first_name: authStore.user?.first_name ?? '',
  last_name: authStore.user?.last_name ?? '',
  username: authStore.user?.username ?? '',
  phone: authStore.user?.phone ?? '',
})

const passwordForm = ref({
  current_password: '',
  new_password: '',
  confirm_password: '',
})

const isSaving = ref(false)
const isChangingPassword = ref(false)
const passwordError = ref('')

async function save() {
  if (!authStore.token) {
    toast.add({ title: 'Not authenticated', color: 'error' })
    return
  }
  isSaving.value = true
  try {
    const updated = await api.put<Record<string, unknown>>('/me', {
      first_name: form.value.first_name,
      last_name: form.value.last_name,
      username: form.value.username || undefined,
      phone: form.value.phone || undefined,
    })
    if (authStore.user) {
      authStore.user = {
        ...authStore.user,
        ...updated,
        name: `${form.value.first_name} ${form.value.last_name}`.trim(),
      }
      await authStore.persistAuthState()
    }
    toast.add({ title: 'Profile updated', color: 'success' })
  } catch {
    toast.add({ title: 'Failed to save profile', color: 'error' })
  } finally {
    isSaving.value = false
  }
}

async function changePassword() {
  passwordError.value = ''

  if (passwordForm.value.new_password !== passwordForm.value.confirm_password) {
    passwordError.value = 'Passwords do not match'
    return
  }

  if (passwordForm.value.new_password.length < 8) {
    passwordError.value = 'Password must be at least 8 characters'
    return
  }

  isChangingPassword.value = true
  try {
    await api.put('/me/password', {
      current_password: passwordForm.value.current_password,
      new_password: passwordForm.value.new_password,
    })
    toast.add({ title: 'Password updated successfully', color: 'success' })
    passwordForm.value = { current_password: '', new_password: '', confirm_password: '' }
  } catch {
    toast.add({ title: 'Failed to update password', color: 'error' })
  } finally {
    isChangingPassword.value = false
  }
}
</script>

<template>
  <div>
    <!-- Email (read-only) -->
    <div class="mb-8 p-4 rounded-lg border border-[var(--app-border)] bg-[color-mix(in_srgb,var(--app-muted)_5%,transparent)]">
      <p class="text-xs text-[var(--app-muted)] uppercase tracking-widest font-medium mb-1">Email</p>
      <p class="text-sm text-[var(--app-foreground)]">{{ authStore.userEmail }}</p>
    </div>

    <!-- Profile form -->
    <form class="flex flex-col gap-5" @submit.prevent="save">
      <div class="grid grid-cols-2 gap-4">
        <FormField label="First Name" name="first_name">
          <Input v-model="form.first_name" placeholder="First name" />
        </FormField>
        <FormField label="Last Name" name="last_name">
          <Input v-model="form.last_name" placeholder="Last name" />
        </FormField>
      </div>

      <FormField label="Username" name="username">
        <Input v-model="form.username" placeholder="username" />
      </FormField>

      <FormField label="Phone" name="phone">
        <Input v-model="form.phone" type="tel" placeholder="+1 555 000 0000" />
      </FormField>

      <div class="pt-2">
        <Button type="submit" :loading="isSaving" label="Save Changes" />
      </div>
    </form>

    <!-- Change password -->
    <div class="mt-10 pt-6 border-t border-[var(--app-border)]">
      <h3 class="text-sm font-semibold text-[var(--app-foreground)] mb-4">Change Password</h3>

      <form class="flex flex-col gap-5" @submit.prevent="changePassword">
        <FormField label="Current Password" name="current_password">
          <Input v-model="passwordForm.current_password" type="password" placeholder="Enter current password" />
        </FormField>

        <FormField label="New Password" name="new_password">
          <Input v-model="passwordForm.new_password" type="password" placeholder="Enter new password" />
        </FormField>

        <FormField label="Confirm New Password" name="confirm_password" :error="passwordError">
          <Input v-model="passwordForm.confirm_password" type="password" placeholder="Confirm new password" />
        </FormField>

        <div class="pt-2">
          <Button type="submit" :loading="isChangingPassword" label="Update Password" />
        </div>
      </form>
    </div>

    <!-- Danger zone -->
    <div class="mt-12 pt-6 border-t border-[var(--app-border)]">
      <p class="text-xs text-red-400 uppercase tracking-widest font-medium mb-3">Danger Zone</p>
      <p class="text-sm text-[var(--app-muted)] mb-4">Permanently delete your account and all associated data. This action cannot be undone.</p>
      <Button variant="soft" color="error" label="Delete Account" />
    </div>
  </div>
</template>
