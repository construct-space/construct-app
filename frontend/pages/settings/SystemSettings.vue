<script setup lang="ts">
/**
 * SystemSettings — System info
 */
import Button from '@/components/ui/Button.vue'
import { IS_DEV_INSTANCE } from '@/lib/appPaths'
import { useOperator } from '@/operator'

const operator = useOperator()
const toast = useToast()

const appVersion = ref('')
const operatorVersion = ref('')
const operatorLatestVersion = ref('')
const operatorUpdateAvailable = ref(false)
const operatorChecking = ref(false)
const operatorUpdating = ref(false)
const osInfo = ref('')

async function checkOperatorUpdate() {
  operatorChecking.value = true
  try {
    const result = await operator.send<{
      current_version?: string
      latest_version?: string
      update_available?: boolean
    }>('system.check_update', {})
    if (result?.latest_version) operatorLatestVersion.value = result.latest_version
    operatorUpdateAvailable.value = !!result?.update_available
    if (!result?.update_available) {
      toast.add({ title: 'Operator is up to date', color: 'success' })
    }
  } catch {
    toast.add({ title: 'Failed to check for operator updates', color: 'error' })
  } finally {
    operatorChecking.value = false
  }
}

async function applyOperatorUpdate() {
  operatorUpdating.value = true
  try {
    const result = await operator.send<{
      updated?: boolean
      new_version?: string
      restart_required?: boolean
    }>('system.apply_update', {})
    if (result?.updated) {
      operatorVersion.value = result.new_version || operatorLatestVersion.value
      operatorUpdateAvailable.value = false
      toast.add({ title: `Operator updated to v${operatorVersion.value}`, description: result.restart_required ? 'Restart the app to use the new version.' : undefined, color: 'success' })
    } else {
      toast.add({ title: 'Operator is already up to date', color: 'info' })
    }
  } catch {
    toast.add({ title: 'Failed to update operator', color: 'error' })
  } finally {
    operatorUpdating.value = false
  }
}

onMounted(async () => {
  try {
    const { getVersion } = await import('@tauri-apps/api/app')
    appVersion.value = await getVersion()
  } catch {
    appVersion.value = __APP_VERSION__
  }

  try {
    const result = await operator.send<{ version?: string }>('system.info', {})
    if (result?.version) operatorVersion.value = result.version
  } catch { /* operator may not be running */ }

  try {
    const { platform, arch, version: osVersion } = await import('@tauri-apps/plugin-os')
    osInfo.value = `${platform()} ${arch()} (${osVersion()})`
  } catch { /* web context */ }
})
</script>

<template>
  <div>
    <div class="space-y-4">
      <div class="flex items-center justify-between py-3 border-b border-app">
        <p class="text-sm font-medium text-app">App Version</p>
        <span class="text-sm text-app-muted font-mono">v{{ appVersion }}</span>
      </div>
      <div v-if="operatorVersion" class="flex items-center justify-between py-3 border-b border-app">
        <div>
          <p class="text-sm font-medium text-app">Operator Version</p>
          <p v-if="operatorUpdateAvailable" class="text-xs text-app-accent mt-0.5">v{{ operatorLatestVersion }} available</p>
        </div>
        <div class="flex items-center gap-3">
          <span class="text-sm text-app-muted font-mono">v{{ operatorVersion }}</span>
          <Button
            v-if="operatorUpdateAvailable"
            variant="soft"
            size="xs"
            :loading="operatorUpdating"
            label="Update"
            @click="applyOperatorUpdate"
          />
          <Button
            v-else
            variant="ghost"
            size="xs"
            :loading="operatorChecking"
            label="Check"
            @click="checkOperatorUpdate"
          />
        </div>
      </div>
      <div class="flex items-center justify-between py-3 border-b border-app">
        <p class="text-sm font-medium text-app">Instance</p>
        <span class="text-sm text-app-muted font-mono">{{ IS_DEV_INSTANCE ? 'Construct DEV' : 'Construct' }}</span>
      </div>
      <div v-if="osInfo" class="flex items-center justify-between py-3 border-b border-app">
        <p class="text-sm font-medium text-app">OS</p>
        <span class="text-sm text-app-muted font-mono">{{ osInfo }}</span>
      </div>
    </div>
  </div>
</template>
