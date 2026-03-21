/**
 * Architect Kickoff Composable
 * Handles the full project kickoff flow from PRD to project creation,
 * including local directory scaffolding, git init, and design file creation.
 */

import type { SpaceType } from '@/types/project'
import type { ArchitectPlan, DocumentType, DocumentOption } from '../utils/documentsGenerator'
import { DOCUMENT_OPTIONS } from '../utils/documentsGenerator'
import { templates, sanitizeProjectName, buildCreateCommand } from '@/utils/templates.config'
import type { TemplateConfig } from '@/utils/templates.config'
import { useOperator } from '@/operator'
import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'

export interface SuggestedTask {
  title: string
  description: string
  priority: 'high' | 'medium' | 'low'
  enabled: boolean
}

export interface KickoffOptions {
  name: string
  description: string
  spaces: SpaceType[]
  tasks: SuggestedTask[]
  documents: DocumentType[]
  localPath?: string
  initGit?: boolean
  templateId?: string | null
  backendTemplateId?: string | null
  isConstructSpace?: boolean
  spaceId?: string
  spaceScope?: 'project' | 'app' | 'both'
}

/**
 * Map a frontend decision value from the AI plan to a template ID.
 */
const FRONTEND_TO_TEMPLATE: Record<string, string> = {
  nuxt: 'nuxt',
  'nuxt.js': 'nuxt',
  'nuxtjs': 'nuxt',
  'nuxt 3': 'nuxt',
  'nuxt3': 'nuxt',
  vue: 'vite-vue',
  'vue.js': 'vite-vue',
  'vue 3': 'vite-vue',
  'vue3': 'vite-vue',
  'vite + vue': 'vite-vue',
  'vue + vite': 'vite-vue',
  'vite/vue': 'vite-vue',
  'vite-vue': 'vite-vue',
  next: 'next',
  'next.js': 'next',
  'nextjs': 'next',
  'next 14': 'next',
  'next 15': 'next',
  react: 'vite-react',
  'react.js': 'vite-react',
  'vite + react': 'vite-react',
  'react + vite': 'vite-react',
  'vite/react': 'vite-react',
  'vite-react': 'vite-react',
  svelte: 'svelte',
  sveltekit: 'svelte',
  angular: 'angular',
  astro: 'astro',
  solid: 'solid-start',
  solidstart: 'solid-start',
  'solid-start': 'solid-start',
  flutter: 'flutter',
  'flutter-full': 'flutter',
  'google flutter': 'flutter',
  mobile: 'expo',
  'react-native': 'expo',
  'react native': 'expo',
  expo: 'expo',
  tauri: 'tauri',
  'tauri-mobile': 'tauri',
  laravel: 'laravel',
  rails: 'rails',
  'ruby on rails': 'rails',
  fastapi: 'fastapi',
  express: 'express',
  'express.js': 'express',
  nestjs: 'nestjs',
  'nest.js': 'nestjs',
  hono: 'hono',
  django: 'django',
  elysia: 'elysia',
  phoenix: 'phoenix',
  't3': 't3',
  't3 stack': 't3',
  duxt: 'duxt',
  redwood: 'redwood',
  'redwoodjs': 'redwood',
}

const BACKEND_TO_TEMPLATE: Record<string, string> = {
  express: 'express',
  'express.js': 'express',
  expressjs: 'express',
  nestjs: 'nestjs',
  'nest.js': 'nestjs',
  nest: 'nestjs',
  fastapi: 'fastapi',
  'fast-api': 'fastapi',
  django: 'django',
  rails: 'rails',
  'ruby on rails': 'rails',
  laravel: 'laravel',
  hono: 'hono',
  elysia: 'elysia',
  phoenix: 'phoenix',
  go: 'go',
  golang: 'go',
  gin: 'go',
  fiber: 'go',
  'custom-go': 'go',
  'custom-email-password-go': 'go',
  'go-chi': 'go',
  'go-echo': 'go',
  rust: 'rust',
  actix: 'rust',
  axum: 'rust',
}

export function mapBackendToTemplate(backendValue: string | undefined): TemplateConfig | null {
  if (!backendValue) return null
  const key = backendValue.trim().toLowerCase().replace(/\s+\d[\d.]*$/, '')
  const templateId = BACKEND_TO_TEMPLATE[key]
  if (!templateId) {
    console.warn(`[Architect] No template match for backend: "${backendValue}"`)
    return null
  }
  const template = templates.find(t => t.id === templateId) || null
  console.log(`[Architect] Backend template match: "${backendValue}" → ${template?.name || 'none'} (${templateId})`)
  return template
}

export function mapFrontendToTemplate(frontendValue: string | undefined): TemplateConfig | null {
  if (!frontendValue) return null
  // Normalize: lowercase, trim, strip version numbers, normalize separators
  let key = frontendValue.trim().toLowerCase()
  // Try exact match first
  let templateId = FRONTEND_TO_TEMPLATE[key]
  if (!templateId) {
    // Strip trailing version numbers (e.g., "vue 3.5" → "vue", "next 14" → "next")
    key = key.replace(/\s+\d[\d.]*$/, '')
    templateId = FRONTEND_TO_TEMPLATE[key]
  }
  if (!templateId) {
    // Normalize separators: "/" → " + "
    key = key.replace(/\s*\/\s*/g, ' + ')
    templateId = FRONTEND_TO_TEMPLATE[key]
  }
  if (!templateId) {
    console.warn(`[Architect] No template match for frontend: "${frontendValue}" (normalized: "${key}")`)
    return null
  }
  const template = templates.find(t => t.id === templateId) || null
  console.log(`[Architect] Template match: "${frontendValue}" → ${template?.name || 'none'} (${templateId})`)
  return template
}

export function useArchitectKickoff() {
  const projectStore = useProjectStore()
  const toast = useToast()
  const operator = useOperator()

  const isKicking = ref(false)
  const progress = ref(0)
  const progressMessage = ref('')

  function getSpaceDirectoryName(spaceId: string) {
    return spaceId.startsWith('space-') ? spaceId : `space-${spaceId}`
  }

  /**
   * Generate suggested tasks from the plan
   */
  function generateSuggestedTasks(plan: ArchitectPlan): SuggestedTask[] {
    const tasks: SuggestedTask[] = []
    const decisions = plan.decisions || {}
    const prd = plan.docs?.prd || plan.prd || {}
    const asArray = (value: unknown): string[] => {
      if (Array.isArray(value)) return value.map(v => String(v)).filter(Boolean)
      if (typeof value === 'string' && value.trim()) return [value.trim()]
      return []
    }
    const spaces = asArray(decisions.spaces).map(s => s.toLowerCase())

    // Project setup task
    const frontend = typeof decisions.frontend === 'string' ? decisions.frontend : ''
    const backend = typeof decisions.backend === 'string' ? decisions.backend : ''
    const stackParts = [frontend, backend].filter(Boolean)
    const setupDescription = stackParts.length > 0
      ? `Initialize project structure for ${stackParts.join(' + ')}`
      : 'Initialize project structure, tooling, and environments'

    tasks.push({
      title: 'Project Setup',
      description: setupDescription,
      priority: 'high',
      enabled: true
    })

    // Database setup
    if (decisions.database) {
      tasks.push({
        title: 'Database Setup',
        description: `Configure ${decisions.database} database and schema`,
        priority: 'high',
        enabled: true
      })
    }

    // Auth setup
    const authMethods = asArray(decisions.auth)
    if (authMethods.length > 0) {
      tasks.push({
        title: 'Authentication Setup',
        description: `Implement ${authMethods.join(', ')} authentication`,
        priority: 'high',
        enabled: true
      })
    }

    // Core features from PRD
    const seenTitles = new Set(tasks.map(t => t.title.toLowerCase()))

    if (prd.coreFeatures?.length) {
      for (const feature of prd.coreFeatures) {
        const title = String(feature).trim()
        if (!title || seenTitles.has(title.toLowerCase())) continue
        tasks.push({
          title,
          description: `Implement: ${title}`,
          priority: 'medium',
          enabled: true
        })
        seenTitles.add(title.toLowerCase())
      }
    }

    // MVP scope items
    if (prd.mvpScope?.length) {
      for (const scope of prd.mvpScope) {
        const title = String(scope).trim()
        if (!title || seenTitles.has(title.toLowerCase())) continue
        tasks.push({
          title,
          description: `MVP: ${title}`,
          priority: 'medium',
          enabled: true
        })
        seenTitles.add(title.toLowerCase())
      }
    }

    // If design space is enabled, include concrete design-direction tasks.
    if (spaces.includes('design') || spaces.includes('ui')) {
      const designStyle = typeof decisions.designStyle === 'string' ? decisions.designStyle : 'brand-aligned'
      const designTasks: SuggestedTask[] = [
        {
          title: 'Define Visual Direction',
          description: `Set mood and visual tone (${designStyle}) with 3-5 UI references`,
          priority: 'high',
          enabled: true
        },
        {
          title: 'Select Typography System',
          description: 'Choose heading/body font pair, scale, and weights for readability + brand fit',
          priority: 'medium',
          enabled: true
        },
        {
          title: 'Define Color Tokens',
          description: 'Create semantic palette (primary, secondary, surface, text, feedback) with contrast checks',
          priority: 'medium',
          enabled: true
        },
      ]

      for (const t of designTasks) {
        if (seenTitles.has(t.title.toLowerCase())) continue
        tasks.push(t)
        seenTitles.add(t.title.toLowerCase())
      }
    }

    return tasks
  }

  /**
   * Get document options relevant to the given plan.
   * Keeps kickoff focused by hiding documents that don't add value.
   */
  function getDocumentOptions(plan?: ArchitectPlan): DocumentOption[] {
    if (!plan) {
      return DOCUMENT_OPTIONS.filter(opt => opt.type === 'readme' || opt.type === 'prd')
    }

    // Rich docs: enable all doc types that have data
    if (plan.docs) {
      const allowed = new Set<DocumentType>(['readme', 'prd'])
      if (plan.docs.architecture) allowed.add('architecture')
      if (plan.docs.dataModels) allowed.add('data-models')
      if (plan.docs.uiSpec) allowed.add('ui-spec')
      if (plan.docs.roadmap) allowed.add('roadmap')
      if (plan.docs.aiContext) allowed.add('ai-context')
      return DOCUMENT_OPTIONS.filter(opt => allowed.has(opt.type))
    }

    // Legacy: infer from plan shape
    const decisions = plan.decisions || {}
    const prd = plan.prd || {}

    const hasBackend = typeof decisions.backend === 'string' && decisions.backend.trim().length > 0
    const hasDatabase = typeof decisions.database === 'string' && decisions.database.trim().length > 0
    const hasAuth = Array.isArray(decisions.auth)
      ? decisions.auth.length > 0
      : typeof decisions.auth === 'string' && decisions.auth.trim().length > 0
    const hasDeployment = typeof decisions.deployment === 'string' && decisions.deployment.trim().length > 0
    const featureCount = Array.isArray(prd.coreFeatures) ? prd.coreFeatures.length : 0
    const hasFuture = Array.isArray(prd.futureConsiderations) && prd.futureConsiderations.length > 0

    const text = [plan.name || '', plan.description || ''].join(' ').toLowerCase()
    const looksLikeLanding = /(landing page|marketing site|brochure site|one[-\s]?page|lead capture|seo|solar|portfolio|agency)/.test(text)
    const isComplex = hasBackend || hasDatabase || hasAuth || (hasDeployment && !looksLikeLanding) || (!looksLikeLanding && featureCount >= 7)
    const isMidComplex = featureCount >= 3 || (Array.isArray(prd.mvpScope) && prd.mvpScope.length > 0)

    const allowed = new Set<DocumentType>(['readme'])
    if (isMidComplex || isComplex || looksLikeLanding) {
      allowed.add('prd')
    }
    if (isComplex) {
      allowed.add('architecture')
    }
    if (hasFuture || (Array.isArray(prd.mvpScope) && prd.mvpScope.length >= 3)) {
      allowed.add('roadmap')
    }

    return DOCUMENT_OPTIONS.filter(opt => allowed.has(opt.type))
  }

  /**
   * Get recommended document selections based on plan complexity.
   */
  function getDefaultDocuments(plan?: ArchitectPlan): DocumentType[] {
    return getDocumentOptions(plan).map(opt => opt.type)
  }

  /**
   * Check if running inside Tauri desktop app
   */
  function isTauri(): boolean {
    return typeof window !== 'undefined' && !!(window as unknown as { __TAURI__?: unknown }).__TAURI__
  }

  /**
   * Execute the full kickoff flow:
   * 1. Create API project
   * 2. Set up local directory structure
   * 3. Scaffold framework (if template matched)
   * 4. Git init (if requested)
   * 5. Create homepage design (if design space enabled)
   * 6. Save documentation
   * 7. Create tasks
   */
  async function kickoff(_plan: ArchitectPlan, options: KickoffOptions) {
    isKicking.value = true
    progress.value = 0
    progressMessage.value = 'Starting kickoff...'

    try {
      // ── Step 1: Create project (10%)
      progress.value = 10
      progressMessage.value = 'Creating project...'
      console.log('[Kickoff] Creating project:', options.name, 'path:', options.localPath, 'docs:', options.documents)

      // Ensure projects root is set before createProject (it derives from localPath)
      if (options.localPath) {
        const parentDir = options.localPath.replace(/\/[^/]+\/?$/, '')
        if (parentDir && !projectStore.projectsRoot) {
          projectStore.setProjectsRoot(parentDir)
          console.log('[Kickoff] Set projectsRoot to:', parentDir)
        }
      }

      // Pass localPath so createProject uses the sanitized path directly
      const projectResult = await projectStore.createProject({
        name: options.name,
        description: options.description,
        spaces: options.spaces,
        localPath: options.localPath,
      })

      console.log('[Kickoff] createProject result:', projectResult.success, projectResult.error)

      if (!projectResult.success || !projectResult.data) {
        throw new Error(projectResult.error || 'Failed to create project')
      }

      const project = projectResult.data
      console.log('[Kickoff] Project created:', project.id, 'path:', project.path)

      // ── Step 3: Scaffold frontend + backend (30-60%)
      const frontendTemplate = options.templateId ? templates.find(t => t.id === options.templateId) : null
      const backendTemplate = options.backendTemplateId ? templates.find(t => t.id === options.backendTemplateId) : null
      const isAppScopedConstructSpace = options.isConstructSpace && options.spaceScope === 'app'
      const projectPath = project.path || options.localPath || ''
      const scopedProjectPath = isAppScopedConstructSpace && options.spaceId
        ? `${projectPath}/${options.spaceId}`
        : projectPath
      const codePath = scopedProjectPath ? `${scopedProjectPath}/code` : ''
      const frontendPath = codePath ? `${codePath}/frontend` : ''
      const backendPath = codePath ? `${codePath}/backend` : ''
      const appPath = codePath ? `${codePath}/app` : ''

      console.log('[Kickoff] Scaffold check:', {
        frontendTemplate: frontendTemplate?.id,
        backendTemplate: backendTemplate?.id,
        codePath,
        scopedProjectPath,
        isConstructSpace: options.isConstructSpace,
        spaceId: options.spaceId,
        spaceScope: options.spaceScope,
      })

      if (options.isConstructSpace && options.spaceId && isAppScopedConstructSpace && isTauri()) {
        // Construct app-scoped space: scaffold app structure into <project>/<spaceId>/code/*
        try {
          await invoke('run_shell_command', {
            command: 'mkdir',
            args: ['-p', codePath, appPath],
            cwd: '/',
          })
        } catch (e) {
          console.warn('[Kickoff] Could not pre-create app scope code directories:', e)
        }

        // If neither framework is chosen, treat app path as the primary scaffold target.
        const appTemplate = frontendTemplate || backendTemplate

        if (appTemplate) {
          progress.value = 30
          progressMessage.value = `Scaffolding application (${appTemplate.name})...`
          try {
            await scaffoldFramework(appTemplate, options.name, appPath, options.initGit !== false)
          } catch (e) {
            console.error('[Kickoff] App scaffold failed:', e)
            toast.add({
              title: 'Scaffold Warning',
              description: `Could not scaffold ${appTemplate.name}. You can set it up manually later.`,
              color: 'warning'
            })
          }
        } else if (codePath) {
          // If no framework match — create static HTML scaffold in app path
          progress.value = 30
          progressMessage.value = 'Creating static project files...'
          try {
            await createStaticScaffold(appPath, options.name)
          } catch (e) {
            console.warn('[Kickoff] Static scaffold failed:', e)
          }
        }

        progress.value = 60
      } else if (options.isConstructSpace && options.spaceId && isTauri()) {
        // Construct space — scaffold via operator space tools inside project/code
        progress.value = 30
        progressMessage.value = `Scaffolding Construct space: ${options.spaceId}...`

        try {
          if (codePath) {
            await invoke('run_shell_command', {
              command: 'mkdir',
              args: ['-p', codePath],
              cwd: '/',
            })
          }
          await scaffoldConstructSpace(options.spaceId, codePath || projectPath)
          progress.value = 60
          progressMessage.value = 'Space scaffolded and installed!'
        } catch (e) {
          console.error('[Kickoff] Space scaffold failed:', e)
          toast.add({
            title: 'Scaffold Warning',
            description: `Could not scaffold space "${options.spaceId}". You can scaffold manually: construct scaffold ${options.spaceId}`,
            color: 'warning'
          })
          progress.value = 60
        }
      } else if (codePath && isTauri()) {
        // Scaffold frontend
        if (frontendPath && frontendTemplate) {
          progress.value = 30
          progressMessage.value = `Scaffolding frontend (${frontendTemplate.name})...`
          try {
            await scaffoldFramework(frontendTemplate, options.name, frontendPath, options.initGit !== false)
          } catch (e) {
            console.error('[Kickoff] Frontend scaffold failed:', e)
            toast.add({
              title: 'Scaffold Warning',
              description: `Could not scaffold ${frontendTemplate.name}. You can set it up manually later.`,
              color: 'warning'
            })
          }
        } else if (frontendPath && !frontendTemplate) {
          // No framework match — create static HTML scaffold
          progress.value = 30
          progressMessage.value = 'Creating static project files...'
          try {
            await createStaticScaffold(frontendPath, options.name)
          } catch (e) {
            console.warn('[Kickoff] Static scaffold failed:', e)
          }
        }

        // Scaffold backend
        if (backendPath && backendTemplate) {
          progress.value = 45
          progressMessage.value = `Scaffolding backend (${backendTemplate.name})...`
          try {
            await scaffoldFramework(backendTemplate, options.name, backendPath, options.initGit !== false)
          } catch (e) {
            console.error('[Kickoff] Backend scaffold failed:', e)
            toast.add({
              title: 'Scaffold Warning',
              description: `Could not scaffold ${backendTemplate.name}. You can set it up manually later.`,
              color: 'warning'
            })
          }
        }

        progress.value = 60
      } else {
        progress.value = 60
      }

      // ── Step 4: Git init at code/ level (covers both frontend + backend) (70%)
      if (codePath && options.initGit && isTauri()) {
        const frontendInitsGit = frontendTemplate?.create.initsGit
        const backendInitsGit = backendTemplate?.create.initsGit
        // Only init git if neither template already did it
        if (!frontendInitsGit && !backendInitsGit) {
          progress.value = 70
          progressMessage.value = 'Initializing git...'
          try {
            await invoke('run_shell_command', {
              command: 'git',
              args: ['init'],
              cwd: codePath,
            })
          } catch (e) {
            console.warn('[Kickoff] Git init failed (non-critical):', e)
          }
        }
      }

      // Step 5: Design creation skipped — requires setCurrentProject which isn't in SDK yet

      // Docs are generated by the docs agent in the surrounding create flow,
      // so kickoff does not create template docs here.

      // ── Done (100%)
      progress.value = 100
      progressMessage.value = 'Complete!'

      toast.add({
        title: 'Project Created!',
        description: `${options.name} is ready`,
        color: 'success'
      })

      return { success: true, project }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Kickoff failed'
      toast.add({
        title: 'Error',
        description: message,
        color: 'error'
      })
      return { success: false, error: message }
    } finally {
      isKicking.value = false
    }
  }

  /**
   * Scaffold a framework project using spawn_shell_command (streaming).
   * Reuses buildCreateCommand from templates.config.
   */
  async function scaffoldFramework(
    template: TemplateConfig,
    projectName: string,
    projectPath: string,
    initGit: boolean
  ) {
    const safeName = sanitizeProjectName(projectName, template)
    const createCmd = buildCreateCommand(template, projectName, { initGit })
    if (!createCmd) throw new Error(`No create command for template: ${template.id}`)

    console.log(`[Kickoff] Scaffold command: ${createCmd.cmd} ${createCmd.args.join(' ')}`)
    console.log(`[Kickoff] Scaffold cwd: ${projectPath}, safeName: ${safeName}`)

    // The create command generates a subfolder named after the project.
    // Run it inside the project path so the framework files land there.
    // We use the parent dir and let the command create the subfolder,
    // then we'll move contents up if needed.
    const parentDir = projectPath

    const processId = `architect-scaffold-${Date.now()}`

    // Set up event listeners
    let output = ''
    const outputPromise = new Promise<{ success: boolean; code: number | null }>((resolve) => {
      let resolved = false

      const setupListeners = async () => {
        const unlistenOutput = await listen<{ process_id: string; stream: string; data: string }>('process-output', (event) => {
          if (event.payload.process_id !== processId) return
          output += event.payload.data + '\n'
          if (progress.value < 55) {
            progress.value = Math.min(progress.value + 1, 55)
          }
        })

        const unlistenExit = await listen<{ process_id: string; code: number | null; success: boolean }>('process-exit', (event) => {
          if (event.payload.process_id !== processId) return
          if (!resolved) {
            resolved = true
            resolve({ success: event.payload.success, code: event.payload.code })
          }
          unlistenOutput()
          unlistenExit()
        })

        // Safety timeout (5 min)
        setTimeout(() => {
          if (!resolved) {
            resolved = true
            resolve({ success: false, code: -1 })
            unlistenOutput()
            unlistenExit()
          }
        }, 300_000)
      }

      setupListeners()
    })

    // Spawn the scaffold command
    await invoke('spawn_shell_command', {
      processId,
      command: createCmd.cmd,
      args: createCmd.args,
      cwd: parentDir,
    })

    const result = await outputPromise

    if (!result.success) {
      const { parseCommandError } = await import('@/utils/templates.config')
      const parsed = parseCommandError(output)
      if (parsed) throw new Error(`${parsed.title}: ${parsed.hint}`)
      throw new Error(`Scaffold failed (exit code ${result.code})`)
    }

    // Move files from subfolder up to project root if the command created a subfolder
    // Check if a subdirectory matching the safe name was created
    try {
        const checkResult = await invoke<{ success: boolean; stdout: string }>('run_shell_command', {
          command: 'ls',
          args: ['-d', `${parentDir}/${safeName}`],
          cwd: parentDir,
        })

      if (checkResult.success) {
        // Move all contents from subfolder to parent
        await invoke('run_shell_command', {
          command: 'sh',
          args: ['-c', `shopt -s dotglob 2>/dev/null; mv "${parentDir}/${safeName}"/* "${parentDir}/${safeName}"/.[!.]* "${parentDir}/" 2>/dev/null; rmdir "${parentDir}/${safeName}" 2>/dev/null; true`],
          cwd: parentDir,
        })
      }
    } catch {
      // Subfolder may not exist if the command creates files in-place
    }

    // Install dependencies if the template has an install command
    if (template.commands.install) {
      progressMessage.value = 'Installing dependencies...'
      progress.value = 56
      try {
        await invoke('run_shell_command', {
          command: template.commands.install[0],
          args: template.commands.install.slice(1),
          cwd: parentDir,
        })
      } catch (e) {
        console.warn('[Kickoff] Dependency install failed (non-critical):', e)
      }
    }
  }

  /**
   * Scaffold a Construct space inside the selected project code directory using
   * the operator's first-class space tools.
   */
  async function scaffoldConstructSpace(spaceId: string, projectPath?: string) {
    if (!projectPath) {
      throw new Error('Project path is required before scaffolding a space')
    }

    const parentDir = projectPath
    const spaceDirName = getSpaceDirectoryName(spaceId)
    const spacePath = `${parentDir}/${spaceDirName}`

    console.log(`[Kickoff] Scaffolding Construct space: ${spaceId} in ${parentDir}`)

    await operator.connect()

    progressMessage.value = `Scaffolding Construct space: ${spaceId}...`
    const createResult = await operator.executeTool('space_create', {
      name: spaceId,
      path: parentDir,
    })
    if (createResult.is_error) {
      throw new Error(createResult.content || `Space scaffold failed for "${spaceId}"`)
    }

    if (progress.value < 45) {
      progress.value = 45
    }

    // Install deps and build
    progressMessage.value = 'Installing dependencies...'
    progress.value = 50

    try {
      await invoke('run_shell_command', {
        command: 'bun',
        args: ['install'],
        cwd: spacePath,
      })
    } catch (e) {
      console.warn('[Kickoff] bun install failed, trying npm:', e)
      await invoke('run_shell_command', {
        command: 'npm',
        args: ['install'],
        cwd: spacePath,
      })
    }

    progressMessage.value = 'Building space...'
    progress.value = 55

    const buildResult = await operator.executeTool('space_build', {
      path: spacePath,
    })
    if (buildResult.is_error) {
      throw new Error(buildResult.content || `Build failed for "${spaceDirName}"`)
    }

    progressMessage.value = 'Installing space to Construct...'
    progress.value = 58

    const installResult = await operator.executeTool('space_install', {
      path: spacePath,
    })
    if (installResult.is_error) {
      throw new Error(installResult.content || `Install failed for "${spaceDirName}"`)
    }

    console.log(`[Kickoff] Space ${spaceId} scaffolded, built, and installed at ${spacePath}`)
  }

  /**
   * Create a minimal static HTML project for non-framework projects.
   * @param codePath - The code/ directory to write files into
   */
  async function createStaticScaffold(codePath: string, projectName: string) {
    // Ensure the code directory exists
    await invoke('run_shell_command', {
      command: 'mkdir',
      args: ['-p', codePath],
      cwd: '/',
    })

    const indexHtml = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${projectName}</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <link rel="stylesheet" href="style.css">
</head>
<body class="min-h-screen bg-gray-50 flex items-center justify-center">
  <div class="text-center">
    <h1 class="text-4xl font-bold text-gray-900">${projectName}</h1>
    <p class="mt-2 text-gray-600">Your project is ready.</p>
  </div>
  <script src="script.js"></script>
</body>
</html>`

    const gitignore = `.DS_Store
node_modules/
.env
*.log`

    const files: Array<{ name: string; content: string }> = [
      { name: 'index.html', content: indexHtml },
      { name: 'style.css', content: '/* Custom styles */\n' },
      { name: 'script.js', content: '// App logic\n' },
      { name: '.gitignore', content: gitignore },
    ]

    for (const file of files) {
      await invoke('run_shell_command', {
        command: 'sh',
        args: ['-c', `cat > "${codePath}/${file.name}" << 'EOFCONTENT'\n${file.content}\nEOFCONTENT`],
        cwd: codePath,
      })
    }
  }

  return {
    // State
    isKicking,
    progress,
    progressMessage,

    // Methods
    generateSuggestedTasks,
    getDocumentOptions,
    getDefaultDocuments,
    kickoff,

    // Constants
    DOCUMENT_OPTIONS
  }
}
