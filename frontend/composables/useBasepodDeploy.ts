/**
 * useBasepodDeploy — One-click deploy to Basepod (construct.ninja)
 *
 * Uses the logged-in user's Construct OAuth token for authentication.
 * No separate deploy token or login needed.
 */

import { ref, computed } from 'vue'
import { invoke } from '@tauri-apps/api/core'

const BASEPOD_SERVER = 'https://bp.construct.ninja'

export interface DeployedApp {
  id: string
  name: string
  domain: string
  status: string
  owner_id: string
  created_at: string
  updated_at: string
}

interface DeployState {
  deploying: boolean
  logs: string[]
  progress: string
  url: string | null
  error: string | null
  // On a first deploy the domain's SSL cert takes ~30-90s to provision, so
  // the URL 502s/handshake-fails until it's ready. `verifying` is true while
  // we poll for a 200; `urlReady` flips true once it serves. Re-deploys reuse
  // the existing cert, so they skip the wait (urlReady set immediately).
  verifying: boolean
  urlReady: boolean
}

/** Generate a unique app name from project name */
function generateAppName(projectName: string): string {
  const slug = projectName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
  return slug || 'app'
}

/** Get the user's OAuth token from the auth store */
async function getOAuthToken(): Promise<string | null> {
  const { useAuthStore } = await import('@/stores/auth')
  const authStore = useAuthStore()
  return authStore.oauthToken || authStore.token || null
}

export function useBasepodDeploy() {
  const state = ref<DeployState>({
    deploying: false,
    logs: [],
    progress: '',
    url: null,
    error: null,
    verifying: false,
    urlReady: false,
  })

  const apps = ref<DeployedApp[]>([])
  const loadingApps = ref(false)

  function addLog(msg: string) {
    state.value.logs.push(msg)
    state.value.progress = msg
  }

  /** List apps owned by the current user */
  async function listApps(): Promise<DeployedApp[]> {
    loadingApps.value = true
    try {
      const token = await getOAuthToken()
      if (!token) return []

      const result = await invoke<{ success: boolean; stdout: string; stderr: string }>('run_shell_command', {
        command: 'curl',
        args: ['-s', '-H', `Authorization: Bearer ${token}`, `${BASEPOD_SERVER}/api/construct/apps`, '--max-time', '10'],
        cwd: '/tmp',
      })

      if (result.success) {
        const data = JSON.parse(result.stdout)
        apps.value = data.apps || []
        return apps.value
      }
    } catch {
      // Failed to list apps
    } finally {
      loadingApps.value = false
    }
    return []
  }

  /** Deploy a project to construct.ninja */
  async function deploy(projectPath: string, projectName: string): Promise<{ success: boolean; url?: string; error?: string }> {
    state.value = { deploying: true, logs: [], progress: 'Starting deploy...', url: null, error: null, verifying: false, urlReady: false }

    try {
      const token = await getOAuthToken()
      if (!token) {
        throw new Error('Please log in to Construct to deploy.')
      }

      const appName = generateAppName(projectName)
      addLog(`Deploying "${projectName}" as ${appName}...`)

      // Detect source directory — Construct projects have code/ subdirectory
      let sourceDir = projectPath
      const tauriFs = await import('@tauri-apps/plugin-fs')
      if (await tauriFs.exists(`${projectPath}/code`)) {
        sourceDir = `${projectPath}/code`
        addLog('Detected Construct project, using code/ directory')
      }

      // Detect project type and determine what to deploy
      let deployDir = sourceDir
      let deployType = ''
      const hasPackageJson = await tauriFs.exists(`${sourceDir}/package.json`)
      const hasDockerfile = await tauriFs.exists(`${sourceDir}/Dockerfile`)
      const hasIndexHtml = await tauriFs.exists(`${sourceDir}/index.html`)

      if (!hasDockerfile && hasPackageJson) {
        // Node.js project — build locally and deploy as static
        deployType = 'static'
        addLog('Detected Node.js project, building locally...')

        // Default to bun (Construct onboarding guarantees it). Honor lock file if present.
        let pm = 'bun'
        if (await tauriFs.exists(`${sourceDir}/bun.lock`) || await tauriFs.exists(`${sourceDir}/bun.lockb`)) pm = 'bun'
        else if (await tauriFs.exists(`${sourceDir}/yarn.lock`)) pm = 'yarn'
        else if (await tauriFs.exists(`${sourceDir}/pnpm-lock.yaml`)) pm = 'pnpm'
        else if (await tauriFs.exists(`${sourceDir}/package-lock.json`)) pm = 'npm'

        // Verify the detected package manager is available, fall back to bun
        if (pm !== 'bun') {
          const whichResult = await invoke<{ success: boolean }>('run_shell_command', {
            command: 'which', args: [pm], cwd: sourceDir,
          }).catch(() => ({ success: false }))
          if (!whichResult.success) {
            addLog(`${pm} not found, using bun instead`)
            pm = 'bun'
          }
        }

        // Install dependencies
        addLog(`Installing dependencies with ${pm}...`)
        const installResult = await invoke<{ success: boolean; stdout: string; stderr: string }>('run_shell_command', {
          command: pm, args: ['install'], cwd: sourceDir,
        })
        if (!installResult.success) {
          addLog(`Warning: ${installResult.stderr}`)
        }

        // Build
        addLog('Building...')
        const buildResult = await invoke<{ success: boolean; stdout: string; stderr: string }>('run_shell_command', {
          command: pm, args: ['run', 'build'], cwd: sourceDir,
        })
        if (!buildResult.success) {
          throw new Error(`Build failed: ${buildResult.stderr}`)
        }
        addLog('Build complete.')

        // Use dist/ as the deploy directory
        const distCandidates = ['dist', '.output/public', 'build', 'out']
        for (const candidate of distCandidates) {
          if (await tauriFs.exists(`${sourceDir}/${candidate}`)) {
            deployDir = `${sourceDir}/${candidate}`
            addLog(`Deploying from ${candidate}/`)
            break
          }
        }
      } else if (!hasDockerfile && hasIndexHtml) {
        // Plain HTML site
        deployType = 'static'
        addLog('Detected static HTML site')
      }

      // Create tarball
      addLog('Creating source archive...')
      const tarPath = `/tmp/construct-deploy-${appName}-${Date.now()}.tar.gz`
      const tarResult = await invoke<{ success: boolean; code: number | null; stdout: string; stderr: string }>('run_shell_command', {
        command: 'tar',
        args: ['czf', tarPath, '--exclude=node_modules', '--exclude=.git', '--exclude=.nuxt', '--exclude=__pycache__', '--exclude=.venv', '--exclude=.DS_Store', '--exclude=._*', '-C', deployDir, '.'],
        cwd: deployDir,
      })

      if (!tarResult.success) {
        throw new Error(`Failed to create archive: ${tarResult.stderr}`)
      }

      // Check archive size (max 50MB)
      const MAX_SIZE_MB = 50
      const sizeResult = await invoke<{ success: boolean; stdout: string }>('run_shell_command', {
        command: 'stat', args: ['-f', '%z', tarPath], cwd: '/tmp',
      })
      if (sizeResult.success) {
        const sizeBytes = parseInt(sizeResult.stdout.trim(), 10)
        const sizeMB = sizeBytes / (1024 * 1024)
        if (sizeMB > MAX_SIZE_MB) {
          await tauriFs.remove(tarPath).catch(() => {})
          throw new Error(`Deploy archive is ${sizeMB.toFixed(1)}MB, max is ${MAX_SIZE_MB}MB. Remove large files and try again.`)
        }
        addLog(`Archive created (${sizeMB.toFixed(1)}MB)`)
      } else {
        addLog('Archive created.')
      }

      // Get git info if available
      let gitCommit = ''
      let gitBranch = ''
      let gitMessage = ''
      try {
        const commitResult = await invoke<{ success: boolean; stdout: string }>('run_shell_command', {
          command: 'git', args: ['rev-parse', '--short', 'HEAD'], cwd: sourceDir,
        })
        if (commitResult.success) gitCommit = commitResult.stdout.trim()

        const branchResult = await invoke<{ success: boolean; stdout: string }>('run_shell_command', {
          command: 'git', args: ['branch', '--show-current'], cwd: sourceDir,
        })
        if (branchResult.success) gitBranch = branchResult.stdout.trim()

        const msgResult = await invoke<{ success: boolean; stdout: string }>('run_shell_command', {
          command: 'git', args: ['log', '-1', '--format=%s'], cwd: sourceDir,
        })
        if (msgResult.success) gitMessage = msgResult.stdout.trim()
      } catch {
        // No git — fine
      }

      // Build deploy config
      const config = JSON.stringify({
        name: appName,
        type: deployType || undefined,
        public: deployType === 'static' ? '.' : undefined,
        git_commit: gitCommit,
        git_branch: gitBranch,
        git_message: gitMessage,
      })

      // Deploy via Construct OAuth endpoint
      addLog('Uploading to construct.ninja...')

      const curlResult = await invoke<{ success: boolean; code: number | null; stdout: string; stderr: string }>('run_shell_command', {
        command: 'curl',
        args: [
          '-s', '-w', '\n%{http_code}',
          '-X', 'POST',
          `${BASEPOD_SERVER}/api/construct/deploy`,
          '-H', `Authorization: Bearer ${token}`,
          '-F', `config=${config}`,
          '-F', `source=@${tarPath}`,
          '--max-time', '300',
        ],
        cwd: '/tmp',
      })

      // Clean up tarball
      await tauriFs.remove(tarPath).catch(() => {})

      if (!curlResult.success) {
        throw new Error(`Deploy request failed: ${curlResult.stderr}`)
      }

      // Parse response - last line is HTTP status code
      const lines = curlResult.stdout.trim().split('\n')
      const httpCode = lines.pop()?.trim()
      const responseBody = lines.join('\n')

      if (httpCode === '401') {
        throw new Error('Session expired. Please log in again.')
      }
      if (httpCode === '403') {
        throw new Error('This app belongs to another user.')
      }
      if (httpCode && parseInt(httpCode) >= 400) {
        throw new Error(`Deploy failed (HTTP ${httpCode}): ${responseBody}`)
      }

      // Parse deploy logs
      addLog('Deploy in progress...')
      const logLines = responseBody.split('\n')
      for (const line of logLines) {
        if (line.trim()) addLog(line.trim())
      }

      // Construct the domain URL
      const deployUrl = `https://${appName}.construct.ninja`

      // Save deploy info to .construct/deploy.json
      try {
        const deployInfo = JSON.stringify({
          name: appName,
          url: deployUrl,
          domain: `${appName}.construct.ninja`,
          deployed_at: new Date().toISOString(),
        }, null, 2)
        const tauriFs = await import('@tauri-apps/plugin-fs')
        await tauriFs.mkdir(`${projectPath}/.construct`, { recursive: true })
        await tauriFs.writeTextFile(`${projectPath}/.construct/deploy.json`, deployInfo)
      } catch { /* non-critical */ }

      state.value.url = deployUrl
      state.value.deploying = false
      state.value.progress = 'Deployed!'
      addLog(`Live at: ${deployUrl}`)

      return { success: true, url: deployUrl }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Deploy failed'
      state.value.error = msg
      state.value.deploying = false
      state.value.progress = ''
      addLog(`Error: ${msg}`)
      return { success: false, error: msg }
    }
  }

  /**
   * One probe: does the URL serve a 200 yet? Uses curl (not fetch) so an
   * in-progress/invalid SSL cert reports as not-ready instead of throwing in
   * the webview. Returns false on any error or non-200 (incl. 502/000).
   */
  async function checkUrlReady(url: string): Promise<boolean> {
    try {
      const result = await invoke<{ success: boolean; stdout: string }>('run_shell_command', {
        command: 'curl',
        args: ['-s', '-o', '/dev/null', '-w', '%{http_code}', '--max-time', '10', url],
        cwd: '/tmp',
      })
      return result.success && result.stdout.trim() === '200'
    } catch {
      return false
    }
  }

  /**
   * Poll the deployed URL until it serves a 200 (SSL provisioned) or the
   * timeout elapses. Sets state.verifying while polling and state.urlReady on
   * success. `signal` lets the caller abort (e.g. modal closed). Returns
   * whether the URL became ready.
   */
  async function waitForUrlReady(
    url: string,
    opts?: { timeoutMs?: number; intervalMs?: number; signal?: () => boolean },
  ): Promise<boolean> {
    const timeoutMs = opts?.timeoutMs ?? 120_000
    const intervalMs = opts?.intervalMs ?? 4000
    const deadline = Date.now() + timeoutMs
    state.value.verifying = true
    state.value.progress = 'Provisioning SSL certificate…'
    try {
      // First probe immediately — re-deploys / fast certs are ready at once.
      while (true) {
        if (opts?.signal?.()) return false
        if (await checkUrlReady(url)) {
          state.value.urlReady = true
          state.value.progress = 'Live'
          return true
        }
        if (Date.now() >= deadline) return false
        await new Promise(r => setTimeout(r, intervalMs))
      }
    } finally {
      state.value.verifying = false
    }
  }

  /** Load deploy info from .construct/deploy.json */
  async function loadDeployInfo(projectPath: string): Promise<{ name: string; url: string; domain: string; deployed_at: string } | null> {
    try {
      const tauriFs = await import('@tauri-apps/plugin-fs')
      const deployPath = `${projectPath}/.construct/deploy.json`
      if (await tauriFs.exists(deployPath)) {
        const content = await tauriFs.readTextFile(deployPath)
        return JSON.parse(content)
      }
    } catch { /* no deploy info */ }
    return null
  }

  return {
    state,
    apps: computed(() => apps.value),
    loadingApps: computed(() => loadingApps.value),
    deploy,
    listApps,
    loadDeployInfo,
    checkUrlReady,
    waitForUrlReady,
    generateAppName,
  }
}
