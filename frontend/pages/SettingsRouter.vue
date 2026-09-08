<script setup lang="ts">
/**
 * SettingsRouter — switches between personal and org settings layout.
 * In org: OrgSettingsPage with org nav + ORG:SETTINGS branding
 * Personal: SettingsPage with personal nav + CONSTRUCT:SETTINGS branding
 */
import { useAuthStore } from '@/stores/auth'
import SettingsPage from '@/pages/SettingsPage.vue'
import OrgSettingsPage from '@/pages/OrgSettingsPage.vue'

const authStore = useAuthStore()
</script>

<template>
  <OrgSettingsPage v-if="authStore.isOrgManaged">
    <RouterView />
  </OrgSettingsPage>
  <SettingsPage v-else>
    <RouterView />
  </SettingsPage>
</template>
