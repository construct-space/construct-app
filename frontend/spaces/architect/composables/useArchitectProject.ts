/**
 * useArchitectProject - Project creation, feature saving, and template detection
 *
 * Extracted from useArchitectEngine to keep the engine focused on
 * question flow + AI calls + keyboard shortcuts.
 */
import { ref, computed, type Ref, type ComputedRef } from 'vue'
import { useRouter } from 'vue-router'
import { useToast } from '@/composables/useToast'
import { useProjectDirectory } from '@/composables/useProjectDirectory'
import { useArchitectKickoff, mapFrontendToTemplate, mapBackendToTemplate } from './useArchitectKickoff'
import type { ArchitectPlan } from '../utils/documentsGenerator'
import { saveProjectVibeHandoff } from '../utils/vibeHandoff'
import type { SpaceType } from '@/types/project'

interface ProjectDeps {
  plan: Ref<ArchitectPlan | null>
  answers: Ref<Record<string, string | string[]>>
  currentProject: ComputedRef<{ id: string; name: string; local_path?: string; spaces?: string[]; description?: string } | null>
  isInsideProject: ComputedRef<boolean>
  onReset: () => void
  generateDocs: (projectPath: string) => Promise<void>
}

export function useArchitectProject(deps: ProjectDeps) {
  const router = useRouter()
  const toast = useToast()
  const {
    kickoff,
    generateSuggestedTasks,
    isKicking,
    progress: kickoffProgress,
    progressMessage,
  } = useArchitectKickoff()

  // ─── State ───

  const showProjectConfig = ref(false)
  const projectPath = ref('')
  const initGit = ref(true)
  const isFinalizingProject = ref(false)
  const finalizingMessage = ref('')
  const finalizingProgress = ref(92)

  // ─── Template Detection ───

  const isConstructSpace = computed(() => deps.plan.value?.type === 'construct-space' && !!deps.plan.value?.spaceId)
  const isAppScopedConstructSpace = computed(() => isConstructSpace.value && deps.plan.value?.spaceScope === 'app')

  const detectedTemplate = computed(() => {
    if (!deps.plan.value) return null
    if (isConstructSpace.value && !isAppScopedConstructSpace.value) return null
    const d = deps.plan.value.decisions
    const frontend = d?.frontend || d?.platform || d?.framework
    return typeof frontend === 'string' ? mapFrontendToTemplate(frontend) : null
  })

  const detectedBackendTemplate = computed(() => {
    if (!deps.plan.value) return null
    if (isConstructSpace.value && !isAppScopedConstructSpace.value) return null
    const d = deps.plan.value.decisions
    const backend = d?.backend || d?.server || d?.api
    return typeof backend === 'string' ? mapBackendToTemplate(backend) : null
  })

  const rawFrontendName = computed(() => {
    if (!deps.plan.value) return null
    if (isConstructSpace.value && !isAppScopedConstructSpace.value) return null
    const d = deps.plan.value.decisions
    const v = d?.frontend || d?.platform || d?.framework
    return typeof v === 'string' ? v : null
  })

  const rawBackendName = computed(() => {
    if (!deps.plan.value) return null
    if (isConstructSpace.value && !isAppScopedConstructSpace.value) return null
    const d = deps.plan.value.decisions
    const v = d?.backend || d?.server || d?.api
    return typeof v === 'string' ? v : null
  })

  const gitInSpaces = computed(() => {
    if (!deps.plan.value) return false
    const spaces = deps.plan.value.decisions?.spaces
    return Array.isArray(spaces) && spaces.some(s => String(s).toLowerCase() === 'git')
  })

  // ─── Helpers ───

  function slugify(name: string): string {
    return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
  }

  function normalizeSpaceForKickoff(space: string): string {
    const key = (space || '').trim().toLowerCase()
    if (key === 'tasks') return 'kanban'
    if (key === 'ui') return 'design'
    return key
  }

  function getSelectedSpacesForKickoff(currentPlan: ArchitectPlan): SpaceType[] {
    const raw = currentPlan.decisions?.spaces
    const values = Array.isArray(raw)
      ? raw.map(v => normalizeSpaceForKickoff(String(v))).filter(Boolean) as SpaceType[]
      : []
    return values.length > 0 ? Array.from(new Set(values)) as SpaceType[] : ['code']
  }

  // ─── Actions ───

  async function showConfigStep() {
    if (!deps.plan.value || deps.isInsideProject.value || isCreatingProject.value) return
    initGit.value = gitInSpaces.value
    const { getDefaultProjectsRoot } = useProjectDirectory()
    const defaultRoot = await getDefaultProjectsRoot()
    const name = deps.plan.value.name || 'New Project'
    projectPath.value = defaultRoot ? `${defaultRoot}/${slugify(name)}` : ''
    showProjectConfig.value = true
  }

  async function browseProjectDir() {
    const { openFolderDialog } = useProjectDirectory()
    const selected = await openFolderDialog('Select Project Location')
    if (selected) projectPath.value = selected
  }

  async function createProject() {
    if (!deps.plan.value || deps.isInsideProject.value || isCreatingProject.value) return

    const currentPlan = deps.plan.value
    const spaces = getSelectedSpacesForKickoff(currentPlan)
    const tasks = generateSuggestedTasks(currentPlan)

    const isSpace = isConstructSpace.value
    const isAppScoped = isSpace && currentPlan.spaceScope === 'app'
    const result = await kickoff(currentPlan, {
      name: currentPlan.name || 'New Project',
      description: currentPlan.description || currentPlan.prd?.overview || '',
      spaces,
      tasks,
      documents: [], // Docs are generated by the docs agent as part of the create flow
      localPath: projectPath.value || undefined,
      initGit: initGit.value,
      templateId: isSpace && !isAppScoped ? null : (detectedTemplate.value?.id || null),
      backendTemplateId: isSpace && !isAppScoped ? null : (detectedBackendTemplate.value?.id || null),
      isConstructSpace: isSpace,
      spaceId: currentPlan.spaceId,
      spaceScope: currentPlan.spaceScope,
    })

    if (result.success && result.project) {
      isFinalizingProject.value = true
      finalizingMessage.value = isConstructSpace.value
        ? 'Writing space documentation...'
        : 'Writing project documentation...'
      finalizingProgress.value = 92
      try {
        await deps.generateDocs(result.project.path)
        finalizingProgress.value = 98
      } catch (e) {
        console.warn('[Architect] Docs generation failed:', e)
        toast.add({
          title: 'Docs Warning',
          description: `Project created, but docs could not be generated in ${result.project.path}/docs`,
          color: 'warning',
        })
      } finally {
        isFinalizingProject.value = false
      }
      await saveProjectVibeHandoff(result.project.path, {
        source: 'architect',
        description: currentPlan.description || currentPlan.prd?.overview || currentPlan.name || 'Architect project',
        plan: currentPlan,
        projectId: String(result.project.id),
      })
      showProjectConfig.value = false
      router.push(`/app/projects/${result.project.id}`)
    }
  }

  async function saveFeaturePlan() {
    if (!deps.plan.value || !deps.currentProject.value) return

    try {
      const featurePrd = deps.plan.value.docs?.prd || deps.plan.value.prd
      const featureDoc = `# Feature: ${deps.plan.value.name}

## Overview
${featurePrd?.overview || deps.plan.value.description}

## Decisions
${Object.entries(deps.plan.value.decisions || {}).map(([k, v]) => `- **${k}**: ${Array.isArray(v) ? v.join(', ') : v}`).join('\n')}

## Components
${(featurePrd?.coreFeatures || []).map(f => `- ${f}`).join('\n')}

## MVP Scope
${(featurePrd?.mvpScope || []).map(s => `- [ ] ${s}`).join('\n')}

## Future Enhancements
${(featurePrd?.futureConsiderations || []).map(f => `- ${f}`).join('\n')}

---
*Generated by Construct Architect*
`
      const projPath = deps.currentProject.value.local_path
      if (projPath) {
        try {
          const tauriFs = await import('@tauri-apps/plugin-fs')
          const docsPath = `${projPath}/docs`
          const exists = await tauriFs.exists(docsPath)
          if (!exists) await tauriFs.mkdir(docsPath, { recursive: true })
          const filename = `feature-${slugify(deps.plan.value.name)}.md`
          await tauriFs.writeTextFile(`${docsPath}/${filename}`, featureDoc)
        } catch (e) {
          console.warn('[Architect] Failed to save feature doc locally:', e)
        }
      }

      toast.add({
        title: 'Feature Plan Saved',
        description: `"${deps.plan.value.name}" doc saved to ${deps.currentProject.value.name}`,
        color: 'success',
      })
      deps.onReset()
    } catch (e) {
      console.error('[Architect] Save feature error:', e)
      toast.add({ title: 'Error', description: 'Failed to save feature plan', color: 'error' })
    }
  }

  const isCreatingProject = computed(() => isKicking.value || isFinalizingProject.value)
  const createProgress = computed(() => isFinalizingProject.value ? finalizingProgress.value : kickoffProgress.value)
  const createProgressMessage = computed(() => isFinalizingProject.value ? finalizingMessage.value : progressMessage.value)

  function resetProjectState() {
    showProjectConfig.value = false
    projectPath.value = ''
    initGit.value = true
    isFinalizingProject.value = false
    finalizingMessage.value = ''
    finalizingProgress.value = 92
  }

  return {
    // State
    showProjectConfig,
    projectPath,
    initGit,
    isKicking: isCreatingProject,
    kickoffProgress: createProgress,
    progressMessage: createProgressMessage,

    // Template detection
    isConstructSpace,
    detectedTemplate,
    detectedBackendTemplate,
    rawFrontendName,
    rawBackendName,
    gitInSpaces,

    // Actions
    showConfigStep,
    browseProjectDir,
    createProject,
    saveFeaturePlan,
    resetProjectState,
  }
}
