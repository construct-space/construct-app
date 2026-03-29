/**
 * useProcessManager - Manages multiple running processes
 * Supports running Flutter on multiple devices simultaneously
 * Uses spawn_shell_command for streaming output
 */
import { invoke } from '@tauri-apps/api/core'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'

export interface RunningProcess {
  id: string
  name: string
  deviceId?: string
  deviceName?: string
  platform?: string
  command: readonly string[]
  status: 'starting' | 'running' | 'stopping' | 'stopped' | 'error'
  output: string
  error: string
  startedAt: Date
  pid?: number
}

interface ProcessManagerState {
  processes: Map<string, RunningProcess>
  projectPath: string | null
  listeners: UnlistenFn[]
}

interface SpawnResult {
  success: boolean
  pid: number
  process_id: string
}

interface ProcessOutputEvent {
  process_id: string
  stream: 'stdout' | 'stderr'
  data: string
}

interface ProcessExitEvent {
  process_id: string
  code: number | null
  success: boolean
}

const state = reactive<ProcessManagerState>({
  processes: new Map(),
  projectPath: null,
  listeners: []
})

// Version counter to force reactivity updates
const processVersion = ref(0)

// Setup event listeners once, track consumer count for cleanup
let listenersInitialized = false
let consumerCount = 0

async function initListeners() {
  if (listenersInitialized) return
  listenersInitialized = true

  // Listen for process output
  const unlistenOutput = await listen<ProcessOutputEvent>('process-output', (event) => {
    const { process_id, stream, data } = event.payload
    const process = state.processes.get(process_id)
    if (process) {
      // Create new object to ensure reactivity
      const updated: RunningProcess = {
        ...process,
        output: process.output + data + '\n',
        error: stream === 'stderr' ? process.error + data + '\n' : process.error,
        status: process.status === 'starting' ? 'running' : process.status
      }
      state.processes.set(process_id, updated)
      processVersion.value++ // Trigger reactivity
    }
  })

  // Listen for process exit
  const unlistenExit = await listen<ProcessExitEvent>('process-exit', (event) => {
    const { process_id, code, success } = event.payload
    const process = state.processes.get(process_id)
    if (process) {
      const updated: RunningProcess = {
        ...process,
        status: success ? 'stopped' : 'error',
        output: process.output + `\n--- Process exited with code ${code} ---\n`
      }
      state.processes.set(process_id, updated)
      processVersion.value++ // Trigger reactivity
    }
  })

  state.listeners.push(unlistenOutput, unlistenExit)
}

function cleanupListeners() {
  for (const unlisten of state.listeners) {
    unlisten()
  }
  state.listeners = []
  listenersInitialized = false
}

export function useProcessManager() {
  // Initialize listeners on first use, track consumers
  onMounted(() => {
    consumerCount++
    initListeners()
  })

  // Cleanup listeners when last consumer unmounts
  onUnmounted(() => {
    consumerCount--
    if (consumerCount <= 0) {
      consumerCount = 0
      cleanupListeners()
    }
  })

  // Set the project path
  const setProjectPath = (path: string) => {
    state.projectPath = path
  }

  // Get all running processes
  const runningProcesses = computed(() => {
    // Access version to trigger reactivity on updates
    const _version = processVersion.value
    return Array.from(state.processes.values()).filter(
      p => p.status === 'running' || p.status === 'starting'
    )
  })

  // Get all processes (including stopped)
  const allProcesses = computed(() => {
    const _version = processVersion.value
    return Array.from(state.processes.values())
  })

  // Check if a specific device is running
  const isDeviceRunning = (deviceId: string): boolean => {
    const process = state.processes.get(deviceId)
    return process?.status === 'running' || process?.status === 'starting'
  }

  // Check if any process is running
  const hasRunningProcess = computed(() => {
    return runningProcesses.value.length > 0
  })

  // Start a new process using spawn_shell_command (streaming)
  const startProcess = async (options: {
    id: string
    name: string
    command: readonly string[]
    deviceId?: string
    deviceName?: string
    platform?: string
  }): Promise<RunningProcess | null> => {
    if (!state.projectPath) {
      console.error('[ProcessManager] No project path set')
      return null
    }

    // Check if already running
    if (isDeviceRunning(options.id)) {
      console.warn(`[ProcessManager] Process ${options.id} is already running`)
      return state.processes.get(options.id) || null
    }

    // Ensure listeners are initialized
    await initListeners()

    const process: RunningProcess = {
      id: options.id,
      name: options.name,
      deviceId: options.deviceId,
      deviceName: options.deviceName,
      platform: options.platform,
      command: options.command,
      status: 'starting',
      output: `$ ${options.command.join(' ')}\n`,
      error: '',
      startedAt: new Date()
    }

    state.processes.set(options.id, process)
    processVersion.value++

    try {
      const [cmd, ...args] = options.command
      console.log(`[ProcessManager] Spawning: ${cmd} ${args.join(' ')}`)

      const result = await invoke<SpawnResult>('spawn_shell_command', {
        processId: options.id,
        command: cmd,
        args,
        cwd: state.projectPath
      })

      // Update process with PID
      const updatedProcess = state.processes.get(options.id)
      if (updatedProcess) {
        updatedProcess.pid = result.pid
        updatedProcess.status = 'running'
        state.processes.set(options.id, updatedProcess)
        processVersion.value++
      }

      console.log(`[ProcessManager] Process spawned with PID: ${result.pid}`)
      return state.processes.get(options.id) || null
    } catch (e) {
      const updatedProcess = state.processes.get(options.id)
      if (updatedProcess) {
        updatedProcess.status = 'error'
        updatedProcess.error = String(e)
        updatedProcess.output += `\nError: ${e}`
        state.processes.set(options.id, updatedProcess)
        processVersion.value++
      }
      console.error('[ProcessManager] Failed to spawn process:', e)
      return null
    }
  }

  // Stop a specific process
  const stopProcess = async (processId: string): Promise<boolean> => {
    const process = state.processes.get(processId)
    if (!process) return false

    process.status = 'stopping'
    state.processes.set(processId, process)
    processVersion.value++

    try {
      // Use the new kill_shell_process command
      const killed = await invoke<boolean>('kill_shell_process', {
        processId
      })

      if (killed) {
        process.status = 'stopped'
        process.output += '\n--- Process stopped ---\n'
      } else {
        // Fallback: try to kill by PID
        if (process.pid) {
          await invoke('run_shell_command', {
            command: 'kill',
            args: ['-9', String(process.pid)],
            cwd: state.projectPath || '/'
          })
        }
        process.status = 'stopped'
        process.output += '\n--- Process stopped (fallback) ---\n'
      }

      state.processes.set(processId, process)
      processVersion.value++
      return true
    } catch (e) {
      console.error(`[ProcessManager] Error stopping process ${processId}:`, e)
      process.status = 'stopped'
      process.error = String(e)
      state.processes.set(processId, process)
      processVersion.value++
      return false
    }
  }

  // Stop all processes
  const stopAll = async (): Promise<void> => {
    const running = runningProcesses.value
    await Promise.all(running.map(p => stopProcess(p.id)))

    // Also kill any lingering flutter processes
    try {
      await invoke('run_shell_command', {
        command: 'pkill',
        args: ['-f', 'flutter_tools'],
        cwd: state.projectPath || '/'
      })
    } catch {
      // Ignore errors - process may not exist
    }
  }

  // Send input to a running process (for hot reload, etc.)
  const sendInput = async (processId: string, input: string): Promise<boolean> => {
    try {
      return await invoke<boolean>('send_process_input', {
        processId,
        input
      })
    } catch (e) {
      console.error(`[ProcessManager] Error sending input to ${processId}:`, e)
      return false
    }
  }

  // Hot reload a Flutter process
  const hotReload = async (processId?: string): Promise<boolean> => {
    const id = processId || runningProcesses.value[0]?.id
    if (!id) return false
    return sendInput(id, 'r')
  }

  // Hot restart a Flutter process
  const hotRestart = async (processId?: string): Promise<boolean> => {
    const id = processId || runningProcesses.value[0]?.id
    if (!id) return false
    return sendInput(id, 'R')
  }

  // Restart a specific process
  const restartProcess = async (processId: string): Promise<RunningProcess | null> => {
    const process = state.processes.get(processId)
    if (!process) return null

    // Store process info before stopping
    const { name, command, deviceId, deviceName, platform } = process

    await stopProcess(processId)

    // Small delay before restart
    await new Promise(resolve => setTimeout(resolve, 500))

    return startProcess({
      id: processId,
      name,
      command,
      deviceId,
      deviceName,
      platform
    })
  }

  // Clear output for a process
  const clearOutput = (processId: string): void => {
    const process = state.processes.get(processId)
    if (process) {
      process.output = ''
      process.error = ''
      state.processes.set(processId, process)
      processVersion.value++
    }
  }

  // Remove stopped process from list
  const removeProcess = (processId: string): void => {
    const process = state.processes.get(processId)
    if (process && (process.status === 'stopped' || process.status === 'error')) {
      state.processes.delete(processId)
      processVersion.value++
    }
  }

  // Clear all stopped processes
  const clearStopped = (): void => {
    let deleted = false
    for (const [id, process] of state.processes) {
      if (process.status === 'stopped' || process.status === 'error') {
        state.processes.delete(id)
        deleted = true
      }
    }
    if (deleted) processVersion.value++
  }

  // Get process by ID
  const getProcess = (processId: string): RunningProcess | undefined => {
    return state.processes.get(processId)
  }

  // Kill process on a specific port
  const killPort = async (port: number): Promise<boolean> => {
    try {
      // Find and kill process using the port (macOS/Linux)
      await invoke('run_shell_command', {
        command: 'lsof',
        args: ['-ti', `:${port}`],
        cwd: state.projectPath || '/'
      }).then(async (result: unknown) => {
        const res = result as { success: boolean; stdout: string }
        if (res.success && res.stdout.trim()) {
          const pids = res.stdout.trim().split('\n')
          for (const pid of pids) {
            if (pid) {
              await invoke('run_shell_command', {
                command: 'kill',
                args: ['-9', pid.trim()],
                cwd: '/'
              })
            }
          }
        }
      })
      return true
    } catch (e) {
      console.error('[ProcessManager] Failed to kill port:', e)
      return false
    }
  }

  return {
    // State
    runningProcesses,
    allProcesses,
    hasRunningProcess,

    // Actions
    setProjectPath,
    isDeviceRunning,
    startProcess,
    stopProcess,
    stopAll,
    restartProcess,
    clearOutput,
    removeProcess,
    clearStopped,
    getProcess,
    sendInput,
    hotReload,
    hotRestart,
    killPort
  }
}
