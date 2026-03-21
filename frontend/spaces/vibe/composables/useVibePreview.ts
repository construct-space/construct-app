/**
 * useVibePreview — Run and preview vibe-built projects
 *
 * Finds a free port, spawns dev server on it, opens preview directly.
 * No URL detection needed — we know the port.
 */

import { ref, computed, onBeforeUnmount } from 'vue'
import { useConstructWindow } from '@/composables/useConstructWindow'
import { isTauriEnv } from '@/utils/tauri'

export function useVibePreview() {
  const serverUrl = ref('')
  const isStarting = ref(false)
  const isRunning = ref(false)
  const processId = ref('')
  const error = ref('')
  const port = ref(0)

  const { open: openWindow } = useConstructWindow()
  const hasUrl = computed(() => !!serverUrl.value)

  async function start(projectPath: string) {
    if (!isTauriEnv() || isRunning.value || isStarting.value) return

    const codePath = projectPath.endsWith('/code') ? projectPath : `${projectPath}/code`
    isStarting.value = true
    error.value = ''
    serverUrl.value = ''

    try {
      const { invoke } = await import('@tauri-apps/api/core')
      const { listen } = await import('@tauri-apps/api/event')

      // Find a free port
      const freePort = await findFreePort(invoke, codePath)
      port.value = freePort
      serverUrl.value = `http://localhost:${freePort}`

      const pm = await detectPackageManager(invoke, codePath)
      const id = `vibe-preview-${Date.now()}`
      processId.value = id

      // Check if package.json has a dev script
      let command = pm
      let args = ['run', 'dev', '--', '--port', String(freePort), '--host']
      try {
        const pkgResult = await invoke<{ success: boolean; stdout: string }>('run_shell_command', {
          command: 'cat', args: [`${codePath}/package.json`], cwd: codePath,
        })
        if (pkgResult.success) {
          const pkg = JSON.parse(pkgResult.stdout)
          if (!pkg.scripts?.dev) {
            // No dev script — use npx vite directly
            command = 'npx'
            args = ['vite', '--port', String(freePort), '--host']
          }
        }
      } catch { /* use default */ }

      // Listen for exit
      const exitUnlisten = await listen<{ process_id: string; code: number | null }>('process-exit', (event) => {
        if (event.payload.process_id !== id) return
        isRunning.value = false
        isStarting.value = false
        serverUrl.value = ''
        exitUnlisten()
      })

      // Spawn dev server
      await invoke('spawn_shell_command', {
        processId: id,
        command,
        args,
        cwd: codePath,
      })

      isRunning.value = true
      isStarting.value = false
    } catch (err) {
      error.value = err instanceof Error ? err.message : 'Failed to start dev server'
      isStarting.value = false
      serverUrl.value = ''
    }
  }

  async function stop() {
    if (!processId.value || !isTauriEnv()) return
    try {
      const { invoke } = await import('@tauri-apps/api/core')
      await invoke('kill_shell_process', { processId: processId.value })
    } catch { /* already stopped */ }
    isRunning.value = false
    isStarting.value = false
    serverUrl.value = ''
  }

  function openInBrowser() {
    if (!serverUrl.value) return
    window.open(serverUrl.value, '_blank')
  }

  async function openInConstruct() {
    if (!serverUrl.value) return
    await openWindow(serverUrl.value, {
      title: 'Vibe Preview',
      width: 1280,
      height: 820,
      label: 'vibe-preview',
    })
  }

  onBeforeUnmount(() => { stop() })

  return {
    serverUrl,
    isStarting,
    isRunning,
    hasUrl,
    error,
    port,
    start,
    stop,
    openInBrowser,
    openInConstruct,
  }
}

async function findFreePort(
  invoke: <T>(cmd: string, args?: Record<string, unknown>) => Promise<T>,
  cwd: string,
): Promise<number> {
  // Use node/python to find a free port, or just pick a random high port
  try {
    const result = await invoke<{ success: boolean; stdout: string }>('run_shell_command', {
      command: 'node',
      args: ['-e', 'const s=require("net").createServer();s.listen(0,()=>{console.log(s.address().port);s.close()})'],
      cwd,
    })
    if (result.success) {
      const p = parseInt(result.stdout.trim(), 10)
      if (p > 0) return p
    }
  } catch { /* fallback */ }

  // Fallback: random port in 3100-9900 range
  return 3100 + Math.floor(Math.random() * 6800)
}

async function detectPackageManager(
  invoke: <T>(cmd: string, args?: Record<string, unknown>) => Promise<T>,
  codePath: string,
): Promise<string> {
  const check = async (file: string) => {
    try {
      const result = await invoke<{ success: boolean }>('run_shell_command', {
        command: 'test', args: ['-f', `${codePath}/${file}`], cwd: codePath,
      })
      return result.success
    } catch { return false }
  }

  if (await check('bun.lockb') || await check('bun.lock')) return 'bun'
  if (await check('pnpm-lock.yaml')) return 'pnpm'
  if (await check('yarn.lock')) return 'yarn'
  return 'npm'
}
