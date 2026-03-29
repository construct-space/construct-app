<script setup lang="ts">
/**
 * RunControls.vue - Toolbar run controls with multi-device support
 * Supports running Flutter on iOS, Android, and Web simultaneously
 */
import { invoke } from '@tauri-apps/api/core'
import { useConstructWindow } from '@/composables/useConstructWindow'
import { useProjectRunner } from '../composables/useProjectRunner'
import { useProcessManager } from '../composables/useProcessManager'
import { stripAnsi } from '../composables/useAnsiStrip'

const props = defineProps<{
  projectPath: string
}>()

const emit = defineEmits<{
  run: [command: readonly string[], deviceId?: string]
  stop: [deviceId?: string]
  showOutput: [processId: string]
}>()

const {
  detectedProject,
  configurations,
  isDetecting,
  detect
} = useProjectRunner()

const {
  runningProcesses,
  hasRunningProcess,
  setProjectPath,
  isDeviceRunning,
  startProcess,
  stopProcess,
  stopAll,
  restartProcess,
  hotReload
} = useProcessManager()

// stripAnsi imported from composables/useAnsiStrip

// Extract localhost URL from running process output
const localhostUrl = computed(() => {
  if (runningProcesses.value.length === 0) return null

  // Check output from the first running process
  const process = runningProcesses.value[0]
  if (!process) return null

  // Strip ANSI codes before matching
  const output = stripAnsi(process.output || '')

  // Match common dev server URL patterns
  // Vite: http://localhost:5173/
  // Next.js: http://localhost:3000
  // Nuxt: http://localhost:3000
  const urlMatch = output.match(/https?:\/\/localhost:\d+\/?/gi)
  if (urlMatch && urlMatch.length > 0) {
    return urlMatch[urlMatch.length - 1]
  }

  // Also check for 127.0.0.1
  const ipMatch = output.match(/https?:\/\/127\.0\.0\.1:\d+\/?/gi)
  if (ipMatch && ipMatch.length > 0) {
    return ipMatch[ipMatch.length - 1]
  }

  return null
})

// Format localhost URL for display (e.g., "localhost:5173")
const localhostDisplay = computed(() => {
  if (!localhostUrl.value) return null
  // Extract just host:port from URL
  const match = localhostUrl.value.match(/(?:localhost|127\.0\.0\.1)(:\d+)?/)
  if (match) {
    return `localhost${match[1] || ''}`
  }
  return null
})

// Device presets for responsive preview
interface DevicePreset {
  id: string
  label: string
  icon: string
  width: number
  height: number
  shortLabel?: string
}

const devicePresets: DevicePreset[] = [
  { id: 'desktop', label: 'Desktop (1280×800)', icon: 'i-lucide-monitor', width: 1280, height: 800 },
  { id: 'tablet-l', label: 'Tablet Landscape (1024×768)', icon: 'i-lucide-tablet', width: 1024, height: 768 },
  { id: 'tablet-p', label: 'Tablet Portrait (768×1024)', icon: 'i-lucide-tablet', width: 768, height: 1024 },
  { id: 'phone-l', label: 'Phone Landscape (844×390)', icon: 'i-lucide-smartphone', width: 844, height: 390 },
  { id: 'phone-p', label: 'Phone Portrait (390×844)', icon: 'i-lucide-smartphone', width: 390, height: 844 },
]

// Open localhost URL in a ConstructWindow with specific device size
const { open: openWindow } = useConstructWindow()

async function openPreview(preset: DevicePreset) {
  if (!localhostUrl.value) return

  const title = `${preset.label} Preview - ${localhostDisplay.value}`
  await openWindow(localhostUrl.value, {
    title,
    width: preset.width,
    height: preset.height,
    label: `preview-${preset.id}`,
  })
  console.log(`[RunControls] Opened ${preset.label} preview:`, localhostUrl.value)
}

// Flutter devices
interface FlutterDevice {
  id: string
  name: string
  platform: string
  isEmulator: boolean
}
const flutterDevices = ref<FlutterDevice[]>([])
const isLoadingDevices = ref(false)
const devicesLoaded = ref(false)
const showDeviceMenu = ref(false)

// Check if this is a Flutter project
const isFlutterProject = computed(() => {
  return detectedProject.value?.template?.id === 'flutter'
})

// Environment detection
interface AvailableEmulator {
  id: string
  name: string
  type: 'ios-simulator' | 'android-emulator'
}
const availableEmulators = ref<AvailableEmulator[]>([])
const hasIOSSimulator = ref(false)
const hasAndroidEmulator = ref(false)
const isStartingEmulator = ref(false)

// Detect available simulators/emulators
async function detectEmulators() {
  const emulators: AvailableEmulator[] = []

  // Check for iOS Simulator (macOS only)
  try {
    const xcrunResult = await invoke<{ success: boolean; stdout: string }>('run_shell_command', {
      command: 'xcrun',
      args: ['simctl', 'list', 'devices', '-j'],
      cwd: props.projectPath || '/'
    })

    if (xcrunResult.success && xcrunResult.stdout) {
      const data = JSON.parse(xcrunResult.stdout)
      hasIOSSimulator.value = true

      // Find booted or available simulators
      for (const runtime in data.devices) {
        if (runtime.includes('iOS')) {
          // Extract iOS version from runtime string like "com.apple.CoreSimulator.SimRuntime.iOS-17-2"
          const versionMatch = runtime.match(/iOS[.-](\d+)[.-](\d+)/)
          const iosVersion = versionMatch ? `iOS ${versionMatch[1]}.${versionMatch[2]}` : 'iOS'

          for (const device of data.devices[runtime]) {
            if (device.isAvailable && device.state !== 'Booted') {
              emulators.push({
                id: device.udid,
                name: `${device.name} (${iosVersion})`,
                type: 'ios-simulator'
              })
            }
          }
        }
      }
    }
  } catch {
    hasIOSSimulator.value = false
  }

  // Check for Android emulators
  try {
    const emulatorResult = await invoke<{ success: boolean; stdout: string }>('run_shell_command', {
      command: 'emulator',
      args: ['-list-avds'],
      cwd: props.projectPath || '/'
    })

    if (emulatorResult.success && emulatorResult.stdout) {
      hasAndroidEmulator.value = true
      const avds = emulatorResult.stdout.trim().split('\n').filter(Boolean)

      for (const avd of avds) {
        emulators.push({
          id: avd,
          name: `${avd} (Android)`,
          type: 'android-emulator'
        })
      }
    }
  } catch {
    hasAndroidEmulator.value = false
  }

  availableEmulators.value = emulators
  console.log('[RunControls] Available emulators:', emulators)
}

// Start iOS Simulator
async function startIOSSimulator(udid?: string) {
  isStartingEmulator.value = true
  try {
    if (udid) {
      // Boot specific simulator
      await invoke('run_shell_command', {
        command: 'xcrun',
        args: ['simctl', 'boot', udid],
        cwd: '/'
      })
    }
    // Open Simulator app
    await invoke('run_shell_command', {
      command: 'open',
      args: ['-a', 'Simulator'],
      cwd: '/'
    })

    // Wait a bit then refresh devices
    setTimeout(async () => {
      await fetchFlutterDevices()
      isStartingEmulator.value = false
    }, 3000)
  } catch (e) {
    console.error('[RunControls] Failed to start iOS Simulator:', e)
    isStartingEmulator.value = false
  }
}

// Start Android Emulator
async function startAndroidEmulator(avdName: string) {
  isStartingEmulator.value = true
  try {
    // Start emulator in background (don't wait for it)
    await invoke('run_shell_command', {
      command: 'emulator',
      args: ['-avd', avdName, '-no-snapshot-load'],
      cwd: '/'
    })

    // Note: emulator command blocks, so we use spawn instead
    // For now, just open it and wait
    setTimeout(async () => {
      await fetchFlutterDevices()
      isStartingEmulator.value = false
    }, 5000)
  } catch (e) {
    console.error('[RunControls] Failed to start Android Emulator:', e)
    isStartingEmulator.value = false
  }
}

// Detect project and set path
watch(() => props.projectPath, async (path) => {
  if (path) {
    setProjectPath(path)
    await detect(path)
    // Only fetch devices once on initial load for Flutter projects
    if (isFlutterProject.value && !devicesLoaded.value) {
      await Promise.all([
        fetchFlutterDevices(),
        detectEmulators()
      ])
      devicesLoaded.value = true
    }
  }
}, { immediate: true })

// Get the dev/run configuration
const runConfig = computed(() =>
  configurations.value.find(c => c.type === 'dev') ||
  configurations.value.find(c => c.type === 'start') ||
  configurations.value[0]
)

// Check if project is runnable
const isRunnable = computed(() =>
  detectedProject.value?.isRunnable && configurations.value.length > 0
)

// Fetch Flutter devices
async function fetchFlutterDevices() {
  if (!props.projectPath || isLoadingDevices.value) return

  isLoadingDevices.value = true
  try {
    const result = await invoke<{ success: boolean; stdout: string; stderr: string }>('run_shell_command', {
      command: 'flutter',
      args: ['devices', '--machine'],
      cwd: props.projectPath
    })

    console.log('[RunControls] Flutter devices result:', result)

    if (result.success && result.stdout) {
      try {
        const devices = JSON.parse(result.stdout) as Array<{
          id: string
          name: string
          platform: string
          emulator: boolean
          targetPlatform?: string
        }>

        console.log('[RunControls] Parsed devices:', devices)

        flutterDevices.value = devices.map(d => ({
          id: d.id,
          name: d.name,
          platform: d.targetPlatform || d.platform || 'unknown',
          isEmulator: d.emulator ?? false
        }))

        console.log('[RunControls] Mapped devices:', flutterDevices.value)
      } catch (parseError) {
        console.error('[RunControls] Failed to parse devices JSON:', parseError, result.stdout)
        flutterDevices.value = []
      }
    } else {
      console.log('[RunControls] No devices output or command failed:', result)
    }
  } catch (e) {
    console.error('[RunControls] Failed to fetch Flutter devices:', e)
    flutterDevices.value = []
  } finally {
    isLoadingDevices.value = false
  }
}

// Get platform icon
function getPlatformIcon(platform: string): string {
  const p = platform.toLowerCase()
  // Desktop platforms
  if (p.includes('macos') || p.includes('darwin')) return 'i-simple-icons-apple'
  if (p.includes('windows')) return 'i-simple-icons-windows'
  if (p.includes('linux')) return 'i-simple-icons-linux'
  // Web/Browser
  if (p.includes('chrome') || p.includes('web') || p === 'web-javascript') return 'i-simple-icons-googlechrome'
  // Mobile - iOS
  if (p.includes('ios') || p.includes('iphone') || p.includes('ipad')) return 'i-lucide-smartphone'
  // Mobile - Android
  if (p.includes('android')) return 'i-simple-icons-android'
  // Default
  return 'i-lucide-monitor'
}

// Get platform color class
function getPlatformColor(platform: string): string {
  const p = platform.toLowerCase()
  if (p.includes('android')) return 'text-green-400'
  if (p.includes('ios') || p.includes('iphone') || p.includes('ipad')) return 'text-gray-300'
  if (p.includes('macos') || p.includes('darwin')) return 'text-gray-300'
  if (p.includes('chrome') || p.includes('web')) return 'text-blue-400'
  if (p.includes('windows')) return 'text-blue-400'
  if (p.includes('linux')) return 'text-orange-400'
  return 'text-app-muted'
}

// Desktop platform → directory mapping
const DESKTOP_PLATFORMS: Record<string, string> = {
  macos: 'macos',
  darwin: 'macos',
  windows: 'windows',
  linux: 'linux',
}

// Check if a desktop platform is supported in the project
async function checkDesktopSupport(platform: string): Promise<{ supported: boolean; platformDir: string }> {
  const p = platform.toLowerCase()
  const platformDir = Object.entries(DESKTOP_PLATFORMS).find(([key]) => p.includes(key))?.[1]
  if (!platformDir) return { supported: true, platformDir: '' } // Not a desktop platform, allow

  try {
    const result = await invoke<{ success: boolean }>('run_shell_command', {
      command: 'test',
      args: ['-d', `${props.projectPath}/${platformDir}`],
      cwd: props.projectPath,
    })
    return { supported: result.success, platformDir }
  } catch {
    return { supported: false, platformDir }
  }
}

// Pending platform init state
const pendingPlatformInit = ref<{ device: FlutterDevice; platformDir: string } | null>(null)
const isInitingPlatform = ref(false)

async function initPlatformSupport() {
  if (!pendingPlatformInit.value) return
  const { device, platformDir } = pendingPlatformInit.value
  isInitingPlatform.value = true

  try {
    const result = await invoke<{ success: boolean; stdout: string; stderr: string }>('run_shell_command', {
      command: 'flutter',
      args: ['create', '--platforms', platformDir, '.'],
      cwd: props.projectPath,
    })

    if (result.success) {
      pendingPlatformInit.value = null
      // Now run on the device
      await runOnDevice(device)
    } else {
      console.error('[RunControls] Failed to add platform support:', result.stderr)
    }
  } catch (e) {
    console.error('[RunControls] Failed to init platform:', e)
  } finally {
    isInitingPlatform.value = false
  }
}

// Run on a specific Flutter device
async function runOnDevice(device: FlutterDevice) {
  // Check desktop platform support before running
  const { supported, platformDir } = await checkDesktopSupport(device.platform)
  if (!supported) {
    pendingPlatformInit.value = { device, platformDir }
    return
  }

  const command = ['flutter', 'run', '-d', device.id]
  emit('run', command, device.id)

  await startProcess({
    id: device.id,
    name: `Flutter - ${device.name}`,
    command,
    deviceId: device.id,
    deviceName: device.name,
    platform: device.platform
  })

  showDeviceMenu.value = false
}

// Run on all connected devices
async function runOnAllDevices() {
  for (const device of flutterDevices.value) {
    if (!isDeviceRunning(device.id)) {
      await runOnDevice(device)
    }
  }
}

// Run the project based on selected config
async function handleRun() {
  const selected = selectedConfigValue.value

  // If a device is selected, run on that device
  if (selected.startsWith('device:')) {
    const deviceId = selected.replace('device:', '')
    const device = flutterDevices.value.find(d => d.id === deviceId)
    if (device) {
      await runOnDevice(device)
      return
    }
  }

  // For Flutter projects, always fetch devices and show picker
  if (isFlutterProject.value) {
    // Fetch devices if not loaded yet
    if (!devicesLoaded.value || flutterDevices.value.length === 0) {
      await fetchFlutterDevices()
    }

    // If exactly one device, run on it directly
    if (flutterDevices.value.length === 1) {
      await runOnDevice(flutterDevices.value[0]!)
      return
    }

    // If multiple devices, show picker
    if (flutterDevices.value.length > 1) {
      showDeviceMenu.value = true
      return
    }

    // If no devices, show warning and return
    if (flutterDevices.value.length === 0) {
      console.warn('[RunControls] No Flutter devices found')
      return
    }
  }

  // Run selected config or default
  const configId = selected.startsWith('config:') ? selected.replace('config:', '') : null
  const config = configId
    ? configurations.value.find(c => c.id === configId)
    : runConfig.value

  if (!config) return

  emit('run', config.command)
  await startProcess({
    id: config.id,
    name: config.name,
    command: config.command
  })
}

// Stop a specific process or all
async function handleStop(processId?: string) {
  if (processId) {
    await stopProcess(processId)
    emit('stop', processId)
  } else {
    await stopAll()
    emit('stop')
  }
}

// Restart a specific process - for Flutter send 'R', for others do full restart
async function handleRestart(processId?: string) {
  const id = processId || runningProcesses.value[0]?.id
  if (!id) return

  if (isFlutterProject.value) {
    // Flutter: send 'R' for stateful hot restart (doesn't restart the app)
    const { sendInput } = useProcessManager()
    const success = await sendInput(id, 'R')
    console.log('[RunControls] Hot restart (R) sent:', success)
  } else {
    // Non-Flutter: do full process restart (stop + start)
    console.log('[RunControls] Full restart for:', id)
    await restartProcess(id)
  }
}

// Show output for a running process
function showProcessOutput(processId: string) {
  emit('showOutput', processId)
}

// Selected configuration - defaults to runConfig
const selectedConfigValue = ref<string>('')

// Sync selected config - prefer first device for Flutter, otherwise runConfig
watch([runConfig, flutterDevices], ([config, devices]) => {
  // For Flutter, prefer first device
  if (isFlutterProject.value && devices.length > 0 && !selectedConfigValue.value.startsWith('device:')) {
    selectedConfigValue.value = `device:${devices[0]!.id}`
    return
  }

  // Otherwise use runConfig
  if (config && !selectedConfigValue.value) {
    selectedConfigValue.value = `config:${config.id}`
  }
}, { immediate: true })

// Build select options for configurations
const configOptions = computed(() => {
  const options: Array<{ label: string; value: string; icon?: string; disabled?: boolean }> = []

  // For Flutter projects, show devices first (most important)
  if (isFlutterProject.value && flutterDevices.value.length > 0) {
    for (const device of flutterDevices.value) {
      const running = isDeviceRunning(device.id)
      options.push({
        label: `${device.name}${running ? ' (Running)' : ''}`,
        value: `device:${device.id}`,
        icon: getPlatformIcon(device.platform)
      })
    }
  }

  // Add emulator start options if available
  if (isFlutterProject.value && availableEmulators.value.length > 0) {
    // Add separator before emulators
    if (options.length > 0) {
      options.push({
        label: '── Start Emulator ──',
        value: 'separator-emulator',
        disabled: true
      })
    }

    for (const emu of availableEmulators.value) {
      options.push({
        label: `▶ ${emu.name}`,
        value: `start:${emu.type}:${emu.id}`,
        icon: emu.type === 'ios-simulator' ? 'i-lucide-smartphone' : 'i-simple-icons-android'
      })
    }
  }

  // Add quick start options if no emulators listed but environment detected
  if (isFlutterProject.value && availableEmulators.value.length === 0) {
    const quickStarts: Array<{ label: string; value: string; icon: string }> = []

    if (hasIOSSimulator.value) {
      quickStarts.push({
        label: '▶ Open iOS Simulator',
        value: 'start:ios-simulator:default',
        icon: 'i-lucide-smartphone'
      })
    }

    if (quickStarts.length > 0) {
      if (options.length > 0) {
        options.push({
          label: '── Start Emulator ──',
          value: 'separator-emulator',
          disabled: true
        })
      }
      options.push(...quickStarts)
    }
  }

  // Add separator before commands
  if (isFlutterProject.value && configurations.value.length > 0 && options.length > 0) {
    options.push({
      label: '── Commands ──',
      value: 'separator',
      disabled: true
    })
  }

  // Add standard configurations
  for (const config of configurations.value) {
    options.push({
      label: config.name,
      value: `config:${config.id}`,
      icon: config.icon
    })
  }

  return options
})

// Handle config selection change
function handleConfigChange(value: string | number) {
  const v = String(value)
  if (!v || v === 'separator' || v.startsWith('separator-')) return

  // Handle emulator start actions
  if (v.startsWith('start:')) {
    const parts = v.split(':')
    const type = parts[1]
    const id = parts[2] || ''
    if (type === 'ios-simulator') {
      startIOSSimulator(id === 'default' ? undefined : id)
    } else if (type === 'android-emulator' && id) {
      startAndroidEmulator(id)
    }
    return // Don't update selected value for start actions
  }

  selectedConfigValue.value = v

  if (v.startsWith('device:')) {
    const deviceId = v.replace('device:', '')
    const device = flutterDevices.value.find(d => d.id === deviceId)
    if (device && !isDeviceRunning(device.id)) {
      runOnDevice(device)
    } else if (device && isDeviceRunning(device.id)) {
      // Show output for running device
      showProcessOutput(device.id)
    }
  }
  // Config selection just updates what Play will run - no immediate action
}
</script>

<template>
  <div v-if="isRunnable && !isDetecting" class="flex items-center gap-2 flex-1 h-6">
    <!-- Flexible space (left) -->
    <div class="flex-1" />

    <!-- Project indicator with running count -->
    <div class="flex items-center gap-1.5 px-2 h-6 rounded-md bg-app-subtle">
      <Icon
        v-if="detectedProject?.template?.icon"
        :name="detectedProject.template.icon"
        class="size-4 text-app-accent"
      />
      <span class="text-xs text-app-muted">{{ detectedProject?.template?.name || 'Project' }}</span>
      <span
        v-if="runningProcesses.length > 0"
        class="px-1.5 text-[10px] font-medium rounded-full bg-green-500/20 text-green-400"
      >
        {{ runningProcesses.length }}
      </span>
    </div>

    <!-- Run Controls -->
    <div class="flex items-center gap-1">
      <!-- Config/Device Select -->
      <Select
        v-model="selectedConfigValue"
        :items="configOptions"
        placeholder="Select..."
        size="xs"
        class="w-44 [&_button]:h-6"
        @update:model-value="handleConfigChange"
      />

      <!-- Play Button (only when NOT running) -->
      <Tooltip
        v-if="!hasRunningProcess"
        :text="isFlutterProject ? 'Run (Select Device)' : 'Run'"
        :content="{ align: 'center', side: 'bottom', sideOffset: 8 }"
      >
        <Button
          icon="i-lucide-play"
          color="success"
          variant="soft"
          size="xs"
          class="h-6 w-6"
          @click="handleRun"
        />
      </Tooltip>

      <!-- Stop Button (only when running) -->
      <Tooltip
        v-if="hasRunningProcess"
        text="Stop All"
        :content="{ align: 'center', side: 'bottom', sideOffset: 8 }"
      >
        <Button
          icon="i-lucide-square"
          color="error"
          variant="soft"
          size="xs"
          class="h-6 w-6"
          @click="handleStop()"
        />
      </Tooltip>

      <!-- Restart Button (only when running) -->
      <Tooltip
        v-if="hasRunningProcess"
        text="Restart"
        :content="{ align: 'center', side: 'bottom', sideOffset: 8 }"
      >
        <Button
          icon="i-lucide-refresh-cw"
          color="neutral"
          variant="soft"
          size="xs"
          class="h-6 w-6"
          @click="handleRestart()"
        />
      </Tooltip>

      <!-- Hot Reload (Flutter only, only when running) -->
      <Tooltip
        v-if="isFlutterProject && hasRunningProcess"
        text="Hot Reload (r)"
        :content="{ align: 'center', side: 'bottom', sideOffset: 8 }"
      >
        <Button
          icon="i-lucide-zap"
          color="warning"
          variant="soft"
          size="xs"
          class="h-6 w-6"
          @click="hotReload()"
        />
      </Tooltip>

      <!-- Responsive Preview Buttons (when dev server is running) -->
      <template v-if="localhostDisplay && hasRunningProcess">
        <div class="w-px h-4 bg-app-border mx-1" />

        <!-- Localhost URL label -->
        <span class="text-xs text-app-muted px-1">{{ localhostDisplay }}</span>

        <!-- Device preset buttons (icon only) -->
        <div class="flex items-center gap-0.5">
          <Tooltip
            v-for="preset in devicePresets"
            :key="preset.id"
            :text="preset.label"
            :delay-duration="0"
            :content="{ align: 'center', side: 'bottom', sideOffset: 8 }"
          >
            <Button
              :icon="preset.icon"
              variant="ghost"
              color="neutral"
              size="xs"
              :class="[
                'text-app-muted hover:text-app',
                preset.id.endsWith('-l') ? 'rotate-90' : ''
              ]"
              @click="openPreview(preset)"
            />
          </Tooltip>
        </div>
      </template>
    </div>

    <!-- Flexible space (right) -->
    <div class="flex-1" />

    <!-- Platform Init Prompt (e.g., "Add macOS desktop support?") -->
    <div
      v-if="pendingPlatformInit"
      class="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
      @click="pendingPlatformInit = null"
    >
      <div
        class="w-80 rounded-lg border border-app-border bg-app shadow-xl"
        @click.stop
      >
        <div class="p-4">
          <div class="flex items-center gap-2 mb-3">
            <Icon name="i-lucide-monitor" class="size-5 text-app-accent" />
            <span class="text-sm font-medium text-app">Desktop Platform Not Configured</span>
          </div>
          <p class="text-xs text-app-muted leading-relaxed">
            <span class="font-medium text-app">{{ pendingPlatformInit.platformDir }}</span> desktop support is not set up for this project. Would you like to add it?
          </p>
          <p class="text-xs text-app-muted/60 mt-2">
            This will run <code class="px-1 py-0.5 rounded bg-app-subtle text-app-muted font-mono text-[10px]">flutter create --platforms {{ pendingPlatformInit.platformDir }} .</code>
          </p>
        </div>
        <div class="p-3 border-t border-app-border flex gap-2 justify-end">
          <Button
            label="Cancel"
            size="xs"
            variant="ghost"
            @click="pendingPlatformInit = null"
          />
          <Button
            label="Add Support"
            icon="i-lucide-plus"
            size="xs"
            color="primary"
            :loading="isInitingPlatform"
            @click="initPlatformSupport"
          />
        </div>
      </div>
    </div>

    <!-- Flutter Device Selection Menu (overlay) -->
    <div
      v-if="showDeviceMenu && isFlutterProject"
      class="fixed inset-0 z-50"
      @click="showDeviceMenu = false"
    >
      <div
        class="absolute right-4 top-12 w-72 rounded-lg border border-app-border bg-app shadow-xl"
        @click.stop
      >
        <div class="p-3 border-b border-app-border">
          <div class="flex items-center justify-between">
            <span class="text-sm font-medium text-app">Select Device(s)</span>
            <Button
              icon="i-lucide-refresh-cw"
              size="xs"
              variant="ghost"
              :loading="isLoadingDevices"
              @click="fetchFlutterDevices"
            />
          </div>
          <p class="text-xs text-app-muted mt-1">Run on multiple devices simultaneously</p>
        </div>

        <div v-if="isLoadingDevices" class="p-4 text-center">
          <Icon name="i-lucide-loader-2" class="size-6 animate-spin text-app-muted mx-auto mb-2" />
          <p class="text-sm text-app-muted">Loading devices...</p>
        </div>

        <div v-else-if="flutterDevices.length === 0" class="p-4 text-center">
          <Icon name="i-lucide-smartphone-off" class="size-8 text-app-muted mx-auto mb-2" />
          <p class="text-sm text-app-muted">No devices found</p>
          <p class="text-xs text-app-muted/60">Connect a device or start an emulator</p>
        </div>

        <div v-else class="max-h-64 overflow-auto p-2 space-y-1">
          <button
            v-for="device in flutterDevices"
            :key="device.id"
            :disabled="isDeviceRunning(device.id)"
            class="w-full flex items-center gap-3 p-2 rounded-lg hover:bg-app-subtle transition-colors text-left disabled:opacity-50"
            @click="runOnDevice(device)"
          >
            <Icon
              :name="getPlatformIcon(device.platform)"
              :class="['size-5', getPlatformColor(device.platform)]"
            />
            <div class="flex-1 min-w-0">
              <div class="text-sm text-app truncate">{{ device.name }}</div>
              <div class="text-xs text-app-muted truncate">
                {{ device.id }}
                <span v-if="device.isEmulator" class="text-yellow-400">(Emulator)</span>
                <span v-if="isDeviceRunning(device.id)" class="text-green-400">(Running)</span>
              </div>
            </div>
            <Icon
              v-if="isDeviceRunning(device.id)"
              name="i-lucide-check"
              class="size-4 text-green-400"
            />
          </button>
        </div>

        <div class="p-2 border-t border-app-border flex gap-2">
          <Button
            label="Run All"
            icon="i-lucide-layers"
            size="xs"
            class="flex-1"
            @click="runOnAllDevices"
          />
          <Button
            label="Cancel"
            size="xs"
            variant="ghost"
            @click="showDeviceMenu = false"
          />
        </div>
      </div>
    </div>
  </div>

  <!-- Loading indicator -->
  <div v-else-if="isDetecting" class="flex items-center gap-1.5 px-2">
    <Icon name="i-lucide-loader-2" class="size-3.5 animate-spin text-app-muted" />
  </div>
</template>
