/**
 * useProjectRunner - Detects project type and provides run configurations
 * Reads from .construct/project.json for project configuration
 * Similar to VS Code's launch configurations
 */
import { invoke } from '@tauri-apps/api/core'
import { readTextFile } from '@tauri-apps/plugin-fs'
import { templates, type TemplateConfig, getTemplate } from '../templates.config'
import { buildStaticHtmlServeCommand } from './useStaticHtmlServer'

export interface RunConfiguration {
  id: string
  name: string
  icon: string
  command: readonly string[]
  description?: string
  type: 'dev' | 'build' | 'start' | 'test' | 'install' | 'custom'
}

export interface ConstructProjectConfig {
  version: number
  template?: string
  created?: string
  commands?: {
    install?: string[]
    dev?: string[]
    build?: string[]
    start?: string[]
    test?: string[]
  }
  // Custom run configurations
  runConfigurations?: Array<{
    id: string
    name: string
    command: string[]
    type?: string
    icon?: string
  }>
}

export interface DetectedProject {
  template: TemplateConfig | null
  config: ConstructProjectConfig | null
  path: string
  name: string
  isRunnable: boolean
}

interface ShellResult {
  success: boolean
  code: number | null
  stdout: string
  stderr: string
}

// Check if a file exists in a directory
async function fileExists(dirPath: string, filename: string): Promise<boolean> {
  try {
    const result = await invoke<ShellResult>('run_shell_command', {
      command: 'test',
      args: ['-f', `${dirPath}/${filename}`],
      cwd: dirPath
    })
    return result.success
  } catch {
    return false
  }
}

// Read .construct/project.json configuration
async function readProjectConfig(projectPath: string): Promise<ConstructProjectConfig | null> {
  try {
    const configPath = `${projectPath}/.construct/project.json`
    const content = await readTextFile(configPath)
    return JSON.parse(content)
  } catch {
    return null
  }
}

// Detect project type from directory
// Priority: .construct/project.json > file identifiers > generic detection
export async function detectProjectType(projectPath: string): Promise<DetectedProject | null> {
  const name = projectPath.split('/').pop() || 'project'

  // First, try to read .construct/project.json
  const config = await readProjectConfig(projectPath)

  if (config) {
    // Get template from config
    const template = config.template ? getTemplate(config.template) : null

    // Check if project has any run commands
    const hasCommands = !!(
      config.commands?.dev ||
      config.commands?.build ||
      config.commands?.start ||
      config.commands?.test ||
      config.runConfigurations?.length ||
      template?.commands
    )

    return {
      template: template || null,
      config,
      path: projectPath,
      name,
      isRunnable: hasCommands
    }
  }

  // Fallback: detect from file identifiers
  for (const template of templates) {
    if (!template.identifiers) continue

    for (const identifier of template.identifiers) {
      if (await fileExists(projectPath, identifier)) {
        return {
          template,
          config: null,
          path: projectPath,
          name,
          isRunnable: !!template.commands
        }
      }
    }
  }

  // Check for generic project types not in templates
  const genericTemplates: Record<string, { files: string[]; template: TemplateConfig }> = {
    node: {
      files: ['package.json'],
      template: {
        id: 'node',
        name: 'Node.js',
        icon: 'i-simple-icons-nodedotjs',
        category: 'backend',
        packageManager: 'npm',
        create: { cmd: '', args: [] },
        commands: {
          install: ['npm', 'install'],
          dev: ['npm', 'run', 'dev'],
          build: ['npm', 'run', 'build'],
          start: ['npm', 'start'],
          test: ['npm', 'test']
        },
        identifiers: ['package.json']
      }
    },
    rust: {
      files: ['Cargo.toml'],
      template: {
        id: 'rust',
        name: 'Rust',
        icon: 'i-simple-icons-rust',
        category: 'backend',
        packageManager: 'none',
        create: { cmd: '', args: [] },
        commands: {
          build: ['cargo', 'build'],
          dev: ['cargo', 'run'],
          test: ['cargo', 'test'],
          start: ['cargo', 'run', '--release']
        },
        identifiers: ['Cargo.toml']
      }
    },
    go: {
      files: ['go.mod'],
      template: {
        id: 'go',
        name: 'Go',
        icon: 'i-simple-icons-go',
        category: 'backend',
        packageManager: 'none',
        create: { cmd: '', args: [] },
        commands: {
          build: ['go', 'build'],
          dev: ['go', 'run', '.'],
          test: ['go', 'test', './...'],
          start: ['go', 'run', '.']
        },
        identifiers: ['go.mod']
      }
    },
    python: {
      files: ['requirements.txt', 'pyproject.toml'],
      template: {
        id: 'python',
        name: 'Python',
        icon: 'i-simple-icons-python',
        category: 'backend',
        packageManager: 'pip',
        create: { cmd: '', args: [] },
        commands: {
          install: ['pip', 'install', '-r', 'requirements.txt'],
          dev: ['python', 'main.py'],
          test: ['pytest']
        },
        identifiers: ['requirements.txt', 'pyproject.toml']
      }
    },
    html: {
      files: ['index.html'],
      template: {
        id: 'static-html',
        name: 'Static HTML',
        icon: 'i-lucide-file-code',
        category: 'frontend',
        packageManager: 'none',
        create: { cmd: '', args: [] },
        commands: {
          dev: [...buildStaticHtmlServeCommand()],
          start: [...buildStaticHtmlServeCommand()],
        },
        identifiers: ['index.html'],
      }
    }
  }

  for (const [, { files, template }] of Object.entries(genericTemplates)) {
    for (const file of files) {
      if (await fileExists(projectPath, file)) {
        return {
          template,
          config: null,
          path: projectPath,
          name,
          isRunnable: true
        }
      }
    }
  }

  return null
}

// Get run configurations for a detected project
// Priority: config commands > template commands
export function getRunConfigurations(project: DetectedProject): RunConfiguration[] {
  const configs: RunConfiguration[] = []

  // Merge commands: config takes priority over template
  const configCommands = project.config?.commands || {}
  const templateCommands = project.template?.commands || {}
  const commands = { ...templateCommands, ...configCommands }

  // Standard command types
  const standardConfigs: Array<{
    key: keyof typeof commands
    id: string
    name: string
    icon: string
    description: string
    type: RunConfiguration['type']
  }> = [
    { key: 'dev', id: 'dev', name: 'Development', icon: 'i-lucide-play', description: 'Start development server', type: 'dev' },
    { key: 'build', id: 'build', name: 'Build', icon: 'i-lucide-hammer', description: 'Build for production', type: 'build' },
    { key: 'start', id: 'start', name: 'Start', icon: 'i-lucide-rocket', description: 'Start production server', type: 'start' },
    { key: 'test', id: 'test', name: 'Test', icon: 'i-lucide-flask-conical', description: 'Run tests', type: 'test' },
    { key: 'install', id: 'install', name: 'Install', icon: 'i-lucide-download', description: 'Install dependencies', type: 'install' }
  ]

  for (const { key, id, name, icon, description, type } of standardConfigs) {
    const cmd = commands[key]
    if (cmd && Array.isArray(cmd) && cmd.length > 0) {
      configs.push({ id, name, icon, command: cmd, description, type })
    }
  }

  // Add custom run configurations from project.json
  if (project.config?.runConfigurations) {
    for (const custom of project.config.runConfigurations) {
      configs.push({
        id: custom.id,
        name: custom.name,
        icon: custom.icon || 'i-lucide-terminal',
        command: custom.command,
        type: (custom.type as RunConfiguration['type']) || 'custom'
      })
    }
  }

  return configs
}

// Composable for project runner state
export function useProjectRunner() {
  const detectedProject = ref<DetectedProject | null>(null)
  const configurations = ref<RunConfiguration[]>([])
  const isDetecting = ref(false)
  const isRunning = ref(false)
  const runningConfigId = ref<string | null>(null)
  const output = ref('')
  const error = ref('')

  // Detect project type for a given path
  async function detect(projectPath: string) {
    isDetecting.value = true
    error.value = ''

    try {
      const project = await detectProjectType(projectPath)
      detectedProject.value = project

      if (project) {
        configurations.value = getRunConfigurations(project)
        console.log('[ProjectRunner] Detected:', project.template?.name || 'Unknown', '- Configs:', configurations.value.length)
      } else {
        configurations.value = []
        console.log('[ProjectRunner] No project type detected')
      }
    } catch (e) {
      console.error('[ProjectRunner] Detection error:', e)
      error.value = String(e)
    } finally {
      isDetecting.value = false
    }
  }

  // Run a configuration
  async function run(configId: string) {
    const config = configurations.value.find(c => c.id === configId)
    if (!config || !detectedProject.value) return

    isRunning.value = true
    runningConfigId.value = configId
    output.value = ''
    error.value = ''

    try {
      const [cmd, ...args] = config.command
      console.log(`[ProjectRunner] Running: ${cmd} ${args.join(' ')}`)

      const result = await invoke<ShellResult>('run_shell_command', {
        command: cmd,
        args,
        cwd: detectedProject.value.path
      })

      output.value = result.stdout
      if (!result.success) {
        error.value = result.stderr || 'Command failed'
      }

      return result
    } catch (e) {
      console.error('[ProjectRunner] Run error:', e)
      error.value = String(e)
    } finally {
      isRunning.value = false
      runningConfigId.value = null
    }
  }

  // Quick run - detect and run dev
  async function quickRun(projectPath: string) {
    await detect(projectPath)
    if (configurations.value.length > 0) {
      // Prefer dev, then start, then first available
      const devConfig = configurations.value.find(c => c.type === 'dev')
      const startConfig = configurations.value.find(c => c.type === 'start')
      const config = devConfig || startConfig || configurations.value[0]
      if (config) {
        return run(config.id)
      }
    }
  }

  return {
    // State
    detectedProject: readonly(detectedProject),
    configurations: readonly(configurations),
    isDetecting: readonly(isDetecting),
    isRunning: readonly(isRunning),
    runningConfigId: readonly(runningConfigId),
    output: readonly(output),
    error: readonly(error),

    // Actions
    detect,
    run,
    quickRun
  }
}
