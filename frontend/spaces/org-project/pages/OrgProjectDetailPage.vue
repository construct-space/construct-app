<script setup lang="ts">
import { ref, onMounted, onUnmounted, watch } from 'vue'
import { useRouter } from 'vue-router'
import { useOrgProjects } from '../composables/useOrgProjects'
import { useToolbar } from '@/composables/useToolbar'
import { useProjectStore } from '@/stores/project'
import { useProjectDirectory } from '@/composables/useProjectDirectory'
import { getProjectRouteKey } from '@/utils/projectRoutes'
import { FolderKanban, GitBranch, Loader2, Trash2, Pencil, Download, Check, Users, Plus, Globe, ShieldAlert, FolderOpen } from 'lucide-vue-next'
import { Badge, Button, Card, Empty, Input, Modal } from '@construct-space/ui'
import type { OrgProjectRepo } from '../composables/useOrgProjects'
import ConfirmationModal from '@/components/common/ConfirmationModal.vue'
import ToolbarSlot from '@/components/common/ToolbarSlot.vue'
import { notify } from '@/composables/useNotification'
import { useOrgStore } from '@/stores/org'
import type { OrgMember } from '@/types/org'
import { profileStorage } from '@/lib/profileStorage'

const props = defineProps<{ projectId: string }>()
const router = useRouter()
const projectStore = useProjectStore()
const projectDir = useProjectDirectory()
const orgStore = useOrgStore()
const { projects, loading, fetchProjects, fetchProject, updateProject, deleteProject, fetchProjectMembers, addProjectMember, removeProjectMember, fetchProjectRepos, addProjectRepo, removeProjectRepo } = useOrgProjects()
const { setBreadcrumbs, clearToolbar } = useToolbar()

const project = computed(() => projects.value.find(p => p.id === props.projectId))

// Edit state
const editing = ref(false)
const editName = ref('')
const editDescription = ref('')
const editRepoUrl = ref('')
const editFramework = ref('')
const editBranch = ref('')

// Clone state
const cloning = ref(false)

// Local path mapping — profile-scoped via profileStorage (consistent with project store)
const PATHS_KEY = 'org-project-paths'
const PATHS_KEY_LEGACY = 'construct:org-project-paths' // unprefixed key used before migration
// Paths the user explicitly unlinked. Needed because a folder can also be
// surfaced by the repo-name heuristic (below) — unlinking only the explicit
// map left those entries un-removable. Excluded paths are suppressed from
// BOTH sources; (re)linking clears the exclusion.
const EXCLUDED_KEY = 'org-project-excluded-paths'

function getStoredPaths(): Record<string, string[]> {
  try {
    // Migrate from unprefixed localStorage key on first read
    const legacy = localStorage.getItem(PATHS_KEY_LEGACY)
    if (legacy) {
      profileStorage.setItem(PATHS_KEY, legacy)
      localStorage.removeItem(PATHS_KEY_LEGACY)
    }
    return JSON.parse(profileStorage.getItem(PATHS_KEY) || '{}')
  } catch { return {} }
}

// Reactive mirror of stored paths so computed properties re-evaluate.
// Initialised empty then loaded in onMounted so profileStorage is ready
// (setActiveProfileId must run before any profile-scoped read).
const localPathsMap = ref<Record<string, string[]>>({})

function getStoredExcluded(): Record<string, string[]> {
  try { return JSON.parse(profileStorage.getItem(EXCLUDED_KEY) || '{}') } catch { return {} }
}
const excludedPathsMap = ref<Record<string, string[]>>({})

function storeLocalPath(projectId: string, localPath: string) {
  const paths = { ...localPathsMap.value }
  if (!paths[projectId]) paths[projectId] = []
  if (!paths[projectId].includes(localPath)) paths[projectId].push(localPath)
  profileStorage.setItem(PATHS_KEY, JSON.stringify(paths))
  localPathsMap.value = paths
  // (Re)linking clears any prior exclusion so the folder reappears.
  const excl = { ...excludedPathsMap.value }
  if (excl[projectId]?.includes(localPath)) {
    excl[projectId] = excl[projectId].filter((p: string) => p !== localPath)
    if (!excl[projectId].length) delete excl[projectId]
    profileStorage.setItem(EXCLUDED_KEY, JSON.stringify(excl))
    excludedPathsMap.value = excl
  }
}

// All local projects linked to this org project
const linkedLocalProjects = computed(() => {
  if (!project.value) return []

  const results: typeof projectStore.projects = []
  const seen = new Set<string>()
  // Paths the user explicitly unlinked — suppressed from both sources below.
  const excluded = new Set(excludedPathsMap.value[props.projectId] || [])

  // 1. Explicit mappings from reactive ref
  const stored = localPathsMap.value[props.projectId] || []
  for (const path of stored) {
    if (excluded.has(path)) continue
    const match = projectStore.projects.find(p => p.path === path)
    if (match && !seen.has(match.path)) {
      results.push(match)
      seen.add(match.path)
    }
  }

  // 2. Match by repo names (legacy single + multi repos)
  const repoUrls = [
    ...(project.value.repo_url ? [project.value.repo_url] : []),
    ...repos.value.map(r => r.repo_url),
  ]
  for (const url of repoUrls) {
    const repoName = url.split('/').pop()?.replace(/\.git$/, '')?.toLowerCase()
    if (repoName) {
      const match = projectStore.projects.find(p => {
        const folderName = p.path.split('/').pop()?.toLowerCase()
        if (!folderName) return false
        if (folderName === repoName) return true
        // Org-prefixed repo: "construct-website" → folder "website"
        if (repoName.endsWith(`-${folderName}`)) return true
        if (p.repo_url && p.repo_url === url) return true
        return false
      })
      if (match && !excluded.has(match.path) && !seen.has(match.path)) {
        results.push(match)
        seen.add(match.path)
      }
    }
  }

  return results
})

// Unified entries: merge repos + local projects into one list
interface UnifiedEntry {
  key: string
  name: string
  localPath?: string
  localProject?: (typeof projectStore.projects)[number]
  repoUrl?: string
  repoBranch?: string
  repoId?: string // for removing the org-project repo
}

const unifiedEntries = computed<UnifiedEntry[]>(() => {
  const entries: UnifiedEntry[] = []
  const matchedLocalPaths = new Set<string>()

  // Collect all repos (multi-repo API + legacy fallback)
  const allRepos = repos.value.length
    ? repos.value
    : project.value?.repo_url
      ? [{ id: '__legacy__', name: project.value.name, repo_url: project.value.repo_url, default_branch: project.value.default_branch }]
      : []

  // For each repo, try to find a matching local project
  for (const repo of allRepos) {
    const repoName = repo.repo_url.split('/').pop()?.replace(/\.git$/, '')?.toLowerCase()
    const matchedLocal = linkedLocalProjects.value.find(lp => {
      const localName = lp.path.split('/').pop()?.toLowerCase()
      if (!localName) return false
      // Exact match: "construct-website" === "construct-website"
      if (localName === repoName) return true
      // Org-prefixed: "construct-website" ends with "-website"
      if (repoName?.endsWith(`-${localName}`)) return true
      // Local project has a stored repo_url that matches
      if (lp.repo_url && lp.repo_url === repo.repo_url) return true
      return false
    })

    entries.push({
      key: `repo-${repo.id}`,
      name: repo.name || repoName || '',
      repoUrl: repo.repo_url,
      repoBranch: repo.default_branch,
      repoId: repo.id !== '__legacy__' ? repo.id : undefined,
      localPath: matchedLocal?.path,
      localProject: matchedLocal,
    })

    if (matchedLocal) matchedLocalPaths.add(matchedLocal.path)
  }

  // Add local-only projects (not matched to any repo)
  for (const lp of linkedLocalProjects.value) {
    if (!matchedLocalPaths.has(lp.path)) {
      entries.push({
        key: `local-${lp.path}`,
        name: lp.name,
        localPath: lp.path,
        localProject: lp,
      })
    }
  }

  return entries
})

const hasEntries = computed(() => unifiedEntries.value.length > 0)

// Delete confirmation
const showDeleteConfirm = ref(false)

// Assign members
const showMembersModal = ref(false)
const assignedMembers = ref<OrgMember[]>([])
const membersLoading = ref(false)

async function openMembersModal() {
  showMembersModal.value = true
  membersLoading.value = true
  assignedMembers.value = await fetchProjectMembers(props.projectId)
  membersLoading.value = false
}

function isAssigned(memberId: string): boolean {
  return assignedMembers.value.some(m => m.id === memberId)
}

async function toggleMember(member: OrgMember) {
  if (isAssigned(member.id)) {
    const ok = await removeProjectMember(props.projectId, member.id)
    if (ok) assignedMembers.value = assignedMembers.value.filter(m => m.id !== member.id)
  } else {
    const ok = await addProjectMember(props.projectId, member.id)
    if (ok) assignedMembers.value.push(member)
  }
}

// Repos
const repos = ref<OrgProjectRepo[]>([])
const showAddRepo = ref(false)
const newRepoUrl = ref('')
const newRepoName = ref('')
const newRepoBranch = ref('main')

// Create-local-project form. Distinct from Link Folder (picks an
// existing dir) and Add Repository (saves a remote URL): this one
// mints a fresh folder + writes .construct/project.json with the
// kind marker that decides whether we open in Space Developer
// ("space-project") or Builder ("project").
const showCreate = ref(false)
const newLocalName = ref('')
type LocalProjectKind = 'space-project' | 'project'
const newLocalKind = ref<LocalProjectKind>('project')
const creatingLocal = ref(false)

function slugifyName(s: string): string {
  return s.trim().toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64)
}

async function handleCreateLocalProject() {
  const name = newLocalName.value.trim()
  if (!name) return
  creatingLocal.value = true
  try {
    const slug = slugifyName(name) || 'project'
    const root = await getPreferredProjectsRoot()
    if (!root) {
      notify('No projects directory set', 'error', 'Open Settings and pick a projects root first.')
      return
    }

    const { mkdir, writeTextFile, exists } = await import('@tauri-apps/plugin-fs')
    const targetPath = `${root}/${slug}`
    if (await exists(targetPath)) {
      notify(
        'Folder already exists',
        'warning',
        `${targetPath} is already on disk — use Link Folder to attach it to this project.`,
      )
      return
    }

    await mkdir(targetPath, { recursive: true })
    await mkdir(`${targetPath}/.construct`, { recursive: true })
    // kind drives which space opens on click:
    //   space-project → Space Developer (scaffolds + builds Construct Spaces)
    //   project       → Builder (general dev: web apps, scripts, landing pages)
    const manifest = {
      id: slug,
      name,
      kind: newLocalKind.value,
      spaces: [] as unknown[],
    }
    await writeTextFile(
      `${targetPath}/.construct/project.json`,
      JSON.stringify(manifest, null, 2) + '\n',
    )

    // Register with the local project store (so it shows up in Projects
    // space + sidebar recents) and stash the path under this org project
    // so it appears in the unified list here.
    await projectStore.addExternalFolderByPath(targetPath)
    storeLocalPath(props.projectId, targetPath)

    notify(
      `Created ${name}`,
      'success',
      `${targetPath} — opens in ${newLocalKind.value === 'space-project' ? 'Space Developer' : 'Builder'}`,
    )

    newLocalName.value = ''
    newLocalKind.value = 'project'
    showCreate.value = false
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    console.error('[org-project] createLocalProject threw:', msg)
    notify('Create failed', 'error', msg.slice(0, 200))
  } finally {
    creatingLocal.value = false
  }
}

async function loadRepos() {
  repos.value = await fetchProjectRepos(props.projectId)
}

async function handleAddRepo() {
  const url = newRepoUrl.value.trim()
  if (!url) return
  const added = await addProjectRepo(props.projectId, {
    name: newRepoName.value.trim() || undefined,
    repo_url: url,
    default_branch: newRepoBranch.value.trim() || 'main',
  })
  if (added) {
    repos.value.push(added)
    newRepoUrl.value = ''
    newRepoName.value = ''
    newRepoBranch.value = 'main'
    showAddRepo.value = false
    notify(`Added ${added.name}`, 'success')
  } else {
    // addProjectRepo swallows the API error and returns null. Surface a
    // toast so the form user sees *something* instead of the button
    // quietly doing nothing. The composable's console.error has the
    // underlying message for debugging; most common causes are 403
    // (missing projects.edit permission) or 404 (gateway route missing).
    notify(
      'Could not add repository',
      'error',
      'Check your permissions (projects.edit) or the DevTools network tab for details.',
    )
  }
}

async function handleRemoveRepo(repoId: string) {
  const ok = await removeProjectRepo(props.projectId, repoId)
  if (ok) repos.value = repos.value.filter(r => r.id !== repoId)
}

// Breadcrumb
watch(project, (p) => {
  if (p) {
    setBreadcrumbs([
      { label: 'Projects', to: '/app/org-project' },
      { label: p.name },
    ])
  }
}, { immediate: true })

function startEdit() {
  if (!project.value) return
  editName.value = project.value.name
  editDescription.value = project.value.description
  editRepoUrl.value = project.value.repo_url
  editFramework.value = project.value.framework
  editBranch.value = project.value.default_branch
  editing.value = true
}

async function saveEdit() {
  if (!project.value) return
  await updateProject(props.projectId, {
    name: editName.value.trim(),
    description: editDescription.value.trim(),
    repo_url: editRepoUrl.value.trim(),
    framework: editFramework.value.trim(),
    default_branch: editBranch.value.trim() || 'main',
  })
  editing.value = false
}

async function handleDelete() {
  if (!props.projectId) return
  await deleteProject(props.projectId)
  showDeleteConfirm.value = false
  router.push('/app/org-project')
}

async function getPreferredProjectsRoot(): Promise<string | undefined> {
  if (projectStore.projectsRoot) {
    return projectStore.projectsRoot
  }

  const root = await projectDir.getProjectsRoot()
  if (root) {
    projectStore.setProjectsRoot(root)
    return root
  }

  return undefined
}

async function cloneRepo(repoUrl?: string) {
  const url = repoUrl || project.value?.repo_url
  if (!url) return
  let targetPath: string | null = null
  try {
    const defaultDir = await getPreferredProjectsRoot()
    const { open } = await import('@tauri-apps/plugin-dialog')
    const dir = await open({ directory: true, title: 'Select folder for clone', defaultPath: defaultDir })
    if (!dir) return // user cancelled — no error toast

    cloning.value = true
    const repoName = url.split('/').pop()?.replace(/\.git$/, '') || project.value?.name || 'project'
    targetPath = `${dir}/${repoName}`

    // Use Tauri shell directly (same plugin the rest of this file uses
    // for git rev-parse / remote / branch checks). Going through the
    // operator's bash tool added an unnecessary dependency on the
    // operator being connected — clone is a one-shot git invocation,
    // not an agent action.
    const result = await shell('git', ['clone', url, targetPath], dir)
    if (!result.success) {
      const msg = (result.stderr || result.stdout || `exit ${result.code ?? '?'}`).trim()
      console.error('[org-project] clone failed:', msg)
      notify(`Clone failed: ${msg.slice(0, 200)}`, 'error')
      return
    }

    await projectStore.addExternalFolderByPath(targetPath)
    storeLocalPath(props.projectId, targetPath)
    notify(`Cloned ${url.split('/').pop()?.replace(/\.git$/, '')} to ${targetPath}`, 'success')
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    console.error('[org-project] cloneRepo threw:', msg, { url, targetPath })
    notify(`Clone failed: ${msg}`, 'error')
  } finally {
    cloning.value = false
  }
}

async function setLocalPath() {
  if (!project.value) return
  try {
    const defaultDir = await getPreferredProjectsRoot()
    const { open } = await import('@tauri-apps/plugin-dialog')
    const selected = await open({ directory: true, title: 'Select local project folder', defaultPath: defaultDir })
    if (!selected || typeof selected !== 'string') return

    await projectStore.addExternalFolderByPath(selected)
    storeLocalPath(props.projectId, selected)

    // Check for .git and remote. Use `--show-toplevel` + compare to
    // `selected` so a subfolder inside a parent repo isn't mistaken
    // for its own git root — otherwise git walks up and we auto-save
    // the parent repo's remote URL as this project's remote.
    try {
      const topResult = await shell('git', ['rev-parse', '--show-toplevel'], selected)
      const normalizedLocal = selected.replace(/\/+$/, '')
      const toplevel = (topResult.stdout || '').trim().replace(/\/+$/, '')
      const hasOwnGit = topResult.success && toplevel === normalizedLocal

      if (!hasOwnGit) {
        // Either no git at all, OR inside a parent repo — delegate to
        // checkGitAndPrompt which handles both cases correctly.
        checkGitAndPrompt(selected)
        return
      }

      // Has .git at this level — check for remote and auto-add
      const output = await shell('git', ['remote', 'get-url', 'origin'], selected)
      const remoteUrl = (output.stdout || '').trim()
      if (remoteUrl && output.success) {
        const alreadyAdded = repos.value.some(r => r.repo_url === remoteUrl)
          || project.value?.repo_url === remoteUrl
        if (!alreadyAdded) {
          const repoName = selected.split('/').pop() || ''
          const branchOutput = await shell('git', ['rev-parse', '--abbrev-ref', 'HEAD'], selected)
          const branch = (branchOutput.stdout || '').trim() || 'main'

          const added = await addProjectRepo(props.projectId, {
            name: repoName,
            repo_url: remoteUrl,
            default_branch: branch,
          })
          if (added) repos.value.push(added)
        } else {
          // Remote already tracked — the folder is now linked, nothing else to add
          notify('Linked', 'success', `Folder linked — remote already tracked.`)
          return
        }
      } else {
        // Has .git but no remote → prompt to create
        checkGitAndPrompt(selected)
      }
    } catch { /* git not available */ }
  } catch { /* user cancelled */ }
}

async function changeGlobalPath() {
  try {
    const defaultDir = await getPreferredProjectsRoot()
    const { open } = await import('@tauri-apps/plugin-dialog')
    const selected = await open({ directory: true, title: 'Change projects directory for all projects', defaultPath: defaultDir })
    if (!selected || typeof selected !== 'string') return
    projectStore.setProjectsRoot(selected)
    await projectStore.loadProjects()
  } catch { /* user cancelled */ }
}

function unlinkLocalPath(localPath: string) {
  // Drop any explicit mapping…
  const paths = { ...localPathsMap.value }
  if (paths[props.projectId]) {
    paths[props.projectId] = paths[props.projectId].filter((p: string) => p !== localPath)
    if (!paths[props.projectId].length) delete paths[props.projectId]
    profileStorage.setItem(PATHS_KEY, JSON.stringify(paths))
    localPathsMap.value = paths
  }
  // …and record an exclusion so a repo-name-heuristic match (e.g. folder
  // "website" auto-matching the "construct-website" repo) doesn't re-surface
  // the entry. Without this, unlinking a heuristic-matched folder did nothing.
  const excl = { ...excludedPathsMap.value }
  if (!excl[props.projectId]) excl[props.projectId] = []
  if (!excl[props.projectId].includes(localPath)) excl[props.projectId].push(localPath)
  profileStorage.setItem(EXCLUDED_KEY, JSON.stringify(excl))
  excludedPathsMap.value = excl
}

// --- Git setup modal (no .git detected) ---
const showGitSetup = ref(false)
const gitSetupPath = ref('')
const gitSetupStep = ref<'choose' | 'pick-org' | 'creating'>('choose')
const gitSetupOrgs = ref<string[]>([])
const gitSetupRepoName = ref('')
const gitSetupPrivate = ref(true)
const gitSetupError = ref('')
// Separate channel for the two specific gh-setup problems we can guide the
// user through (install vs. authenticate). Anything else falls back to the
// plain gitSetupError string.
const gitSetupGhState = ref<'ok' | 'not-installed' | 'not-authed' | null>(null)
const gitSetupCopied = ref(false)

// Shell helper — uses Tauri IPC which has the user's full PATH
async function shell(command: string, args: string[], cwd = '/'): Promise<{ success: boolean; code: number | null; stdout: string; stderr: string }> {
  const { invoke } = await import('@tauri-apps/api/core')
  return invoke('run_shell_command', { command, args, cwd })
}

async function checkGitAndPrompt(localPath: string) {
  // Don't trust `git rev-parse --git-dir` alone — it walks up the
  // directory tree and returns the closest ancestor repo. A folder
  // like /Users/me/ConstructProjects/pm would "have git" via the
  // parent /Users/me/ConstructProjects/.git, and remote get-url would
  // return the parent's origin — which then got saved as pm's remote.
  // Compare the toplevel to localPath to confirm it's really this
  // folder's own repo.
  const topResult = await shell('git', ['rev-parse', '--show-toplevel'], localPath)
  const normalizedLocal = localPath.replace(/\/+$/, '')
  const toplevel = (topResult.stdout || '').trim().replace(/\/+$/, '')
  const hasGit = topResult.success && toplevel === normalizedLocal
  const insideParentRepo = topResult.success && toplevel !== '' && toplevel !== normalizedLocal

  if (hasGit) {
    // Has .git — check if remote exists.
    const remoteCheck = await shell('git', ['remote', 'get-url', 'origin'], localPath)
    const remoteUrl = (remoteCheck.stdout || '').trim()
    if (remoteCheck.success && remoteUrl) {
      // Folder already has origin (set manually outside Construct, or a
      // prior session). Save it to the project's repos so the UI picks
      // it up on next render — no modal needed.
      const alreadyTracked = repos.value.some(r => r.repo_url === remoteUrl)
        || project.value?.repo_url === remoteUrl
      if (alreadyTracked) {
        notify('Linked', 'success', `Folder linked — remote already tracked.`)
        return
      }
      const branchOut = await shell('git', ['rev-parse', '--abbrev-ref', 'HEAD'], localPath)
      const branch = (branchOut.stdout || '').trim() || 'main'
      const repoName = remoteUrl.split('/').pop()?.replace(/\.git$/, '')
        || localPath.split('/').pop()
        || 'repo'
      const added = await addProjectRepo(props.projectId, {
        name: repoName,
        repo_url: remoteUrl,
        default_branch: branch,
      })
      if (added) {
        repos.value.push(added)
        notify(`Added ${added.name}`, 'success', remoteUrl)
      } else {
        notify(
          'Could not save repository',
          'error',
          'Found origin locally but saving to this project failed. Check permissions (projects.edit).',
        )
      }
      return
    }

    // Has .git but no remote → skip "choose" step, go straight to pick org
    gitSetupPath.value = localPath
    gitSetupRepoName.value = localPath.split('/').pop() || ''
    gitSetupError.value = ''
    showGitSetup.value = true
    gitSetupPickOrg()
    return
  }

  // Folder is inside a parent repo. Surface as an informational toast
  // (so the user sees the nesting) but still proceed to auto-init —
  // the click on "Add Remote" is the user's intent signal. A nested
  // repo doesn't break the parent; it just creates its own .git.
  if (insideParentRepo) {
    notify(
      'Creating nested repository',
      'info',
      `Folder is inside ${toplevel}. Initialising a new repo in this subfolder.`,
    )
  }

  // No own .git (either plain folder or inside a parent repo). Run
  // `git init` automatically and jump to the pick-org step. If init
  // fails (permission, non-existent path) fall back to the manual
  // modal with the error surfaced.
  const initResult = await shell('git', ['init'], localPath)
  if (!initResult.success) {
    notify(
      'git init failed',
      'error',
      (initResult.stderr || initResult.stdout || `exit ${initResult.code ?? '?'}`).slice(0, 200),
    )
    gitSetupPath.value = localPath
    gitSetupRepoName.value = localPath.split('/').pop() || ''
    gitSetupStep.value = 'choose'
    gitSetupError.value = initResult.stderr || 'git init failed'
    showGitSetup.value = true
    return
  }

  // Init succeeded → straight to the gh pick-org flow.
  gitSetupPath.value = localPath
  gitSetupRepoName.value = localPath.split('/').pop() || ''
  gitSetupError.value = ''
  showGitSetup.value = true
  gitSetupPickOrg()
}

async function gitSetupInitOnly() {
  try {
    const result = await shell('git', ['init'], gitSetupPath.value)
    if (!result.success) {
      gitSetupError.value = result.stderr || 'Failed to init git'
      return
    }
    showGitSetup.value = false
  } catch (e) {
    gitSetupError.value = String(e)
  }
}

async function gitSetupPickOrg() {
  gitSetupStep.value = 'pick-org'
  gitSetupOrgs.value = []
  gitSetupError.value = ''
  gitSetupGhState.value = null

  // Preflight: is gh installed at all?
  const versionCheck = await shell('gh', ['--version'])
  if (!versionCheck.success) {
    gitSetupGhState.value = 'not-installed'
    return
  }

  // Is the user logged in?
  const authCheck = await shell('gh', ['auth', 'status'])
  if (!authCheck.success) {
    gitSetupGhState.value = 'not-authed'
    return
  }

  // Both green — fetch the orgs.
  try {
    const userResult = await shell('gh', ['api', 'user', '--jq', '.login'])
    const username = (userResult.stdout || '').trim()
    const orgResult = await shell('gh', ['api', 'user/orgs', '--jq', '.[].login'])
    const orgs = (orgResult.stdout || '').trim().split('\n').filter(Boolean)

    if (!username && !orgs.length) {
      gitSetupGhState.value = 'not-authed'
      return
    }

    gitSetupGhState.value = 'ok'
    gitSetupOrgs.value = username ? [username, ...orgs] : orgs
  } catch (e) {
    gitSetupError.value = `Failed to fetch GitHub orgs: ${e instanceof Error ? e.message : String(e)}`
  }
}

function openGhInstallPage() {
  import('@tauri-apps/plugin-opener').then(({ openUrl }) => {
    openUrl('https://cli.github.com/')
  }).catch(() => {
    window.open('https://cli.github.com/', '_blank')
  })
}

// Opens the platform's native terminal already running `gh auth login`.
// Cross-platform: macOS via AppleScript, Windows via cmd/start, Linux via
// whichever x-terminal-emulator resolves. Falls back to "copy command"
// when no terminal is available — the user can paste into their own shell.
async function openTerminalLogin() {
  const cmd = 'gh auth login'
  let launched = false
  try {
    // Read platform from Tauri's os plugin — different launch path per OS.
    const { platform } = await import('@tauri-apps/plugin-os')
    const p = await platform()
    if (p === 'macos') {
      const result = await shell('osascript', [
        '-e',
        `tell application "Terminal" to do script "${cmd}"`,
        '-e',
        'tell application "Terminal" to activate',
      ])
      launched = result.success
    } else if (p === 'windows') {
      // `start` is a cmd builtin — wrap with cmd /c. keeps the prompt open
      // after gh exits so the user can read any final status.
      const result = await shell('cmd', ['/c', 'start', 'cmd', '/k', cmd])
      launched = result.success
    } else {
      // Linux: try x-terminal-emulator first (Debian/Ubuntu default), then
      // a couple common terminals. If none land, fall through to clipboard.
      for (const term of ['x-terminal-emulator', 'gnome-terminal', 'konsole', 'xterm']) {
        const result = await shell(term, ['-e', cmd])
        if (result.success) { launched = true; break }
      }
    }
  } catch { /* fall through to copy */ }

  if (!launched) {
    copyLoginCommand()
  }
}

async function copyLoginCommand() {
  const cmd = 'gh auth login'
  try {
    const { writeText } = await import('@tauri-apps/plugin-clipboard-manager')
    await writeText(cmd)
  } catch {
    try { await navigator.clipboard.writeText(cmd) } catch { /* ignore */ }
  }
  gitSetupCopied.value = true
  setTimeout(() => { gitSetupCopied.value = false }, 2000)
}

async function gitSetupCreateRepo(owner: string) {
  gitSetupStep.value = 'creating'
  gitSetupError.value = ''
  const repoName = gitSetupRepoName.value.trim() || gitSetupPath.value.split('/').pop() || 'project'
  const fullName = `${owner}/${repoName}`
  const visibility = gitSetupPrivate.value ? '--private' : '--public'

  try {
    // Init git if needed. Compare toplevel to the folder itself —
    // `rev-parse --git-dir` alone returns the *parent* repo's .git
    // if the folder is nested inside one, which then convinces us
    // not to init. `gh repo create --source <dir>` later fails on
    // that subfolder with "not a git repository. Run git init".
    const topResult = await shell('git', ['rev-parse', '--show-toplevel'], gitSetupPath.value)
    const normalizedLocal = gitSetupPath.value.replace(/\/+$/, '')
    const toplevel = (topResult.stdout || '').trim().replace(/\/+$/, '')
    const hasOwnGit = topResult.success && toplevel === normalizedLocal
    if (!hasOwnGit) {
      const initResult = await shell('git', ['init'], gitSetupPath.value)
      if (!initResult.success) {
        gitSetupError.value = (initResult.stderr || 'git init failed').trim()
        gitSetupStep.value = 'pick-org'
        return
      }
    }

    // Ensure at least one commit exists before pushing
    const hasCommits = await shell('git', ['rev-parse', 'HEAD'], gitSetupPath.value)
    if (!hasCommits.success) {
      await shell('git', ['add', '-A'], gitSetupPath.value)
      const commitResult = await shell('git', ['commit', '-m', 'Initial commit'], gitSetupPath.value)
      if (!commitResult.success) {
        // Nothing to commit (empty dir) — create an empty initial commit
        await shell('git', ['commit', '--allow-empty', '-m', 'Initial commit'], gitSetupPath.value)
      }
    }

    // Create remote repo via gh (create first, push separately for reliability)
    const createResult = await shell('gh', [
      'repo', 'create', fullName, visibility,
      '--source', gitSetupPath.value,
    ], gitSetupPath.value)

    if (createResult.success) {
      // Push after creation
      await shell('git', ['push', '-u', 'origin', 'HEAD'], gitSetupPath.value)
    }
    if (!createResult.success) {
      gitSetupError.value = (createResult.stderr || '').trim() || 'Failed to create repository'
      gitSetupStep.value = 'pick-org'
      return
    }

    // Get the remote URL
    const remoteResult = await shell('git', ['remote', 'get-url', 'origin'], gitSetupPath.value)
    const remoteUrl = (remoteResult.stdout || '').trim()

    // Detect branch
    const branchResult = await shell('git', ['rev-parse', '--abbrev-ref', 'HEAD'], gitSetupPath.value)
    const branch = (branchResult.stdout || '').trim() || 'main'

    // Add as org project repo
    if (remoteUrl) {
      const added = await addProjectRepo(props.projectId, {
        name: repoName,
        repo_url: remoteUrl,
        default_branch: branch,
      })
      if (added) repos.value.push(added)
    }

    showGitSetup.value = false
  } catch (e) {
    gitSetupError.value = String(e)
    gitSetupStep.value = 'pick-org'
  }
}

// Also prompt git setup for local-only entries. async + try/catch so
// the shell IPC failure mode ("git not found", "permission denied")
// surfaces as a toast instead of an unhandled promise rejection.
async function handleAddRemote(localPath: string) {
  try {
    await checkGitAndPrompt(localPath)
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    console.error('[org-project] handleAddRemote threw:', msg, { localPath })
    notify('Could not set up remote', 'error', msg.slice(0, 200))
  }
}

function openLocalProject(path: string, space: string) {
  const lp = projectStore.projects.find(p => p.path === path)
  if (lp) {
    router.push(`/app/projects/${encodeURIComponent(getProjectRouteKey(lp))}/${space}`)
  }
}

onMounted(async () => {
  const stored = getStoredPaths()
  localPathsMap.value = stored
  excludedPathsMap.value = getStoredExcluded()

  // Re-register stored paths as external projects so projectStore.projects
  // includes them after a fresh app load (addExternalFolderByPath is idempotent).
  const pathsForThisProject = stored[props.projectId] || []
  if (pathsForThisProject.length) {
    await Promise.all(pathsForThisProject.map(p => projectStore.addExternalFolderByPath(p)))
  }

  // Try to load from list first, then fetch individually as fallback
  if (!projects.value.length) await fetchProjects()
  if (!project.value && props.projectId) {
    await fetchProject(props.projectId)
  }
  if (props.projectId) {
    const [members] = await Promise.all([
      fetchProjectMembers(props.projectId),
      loadRepos(),
    ])
    assignedMembers.value = members
  }
})

onUnmounted(() => {
  clearToolbar()
})
</script>

<template>
  <div class="h-full overflow-auto">
    <ToolbarSlot v-if="project && !editing" name="right">
      <div class="flex items-center gap-2">
        <Button variant="ghost" size="xs" :label="assignedMembers.length ? `Members (${assignedMembers.length})` : 'Members'" @click="openMembersModal">
          <template #leading>
            <Users class="size-3.5" />
          </template>
        </Button>
        <Button variant="ghost" size="xs" label="Edit" @click="startEdit">
          <template #leading>
            <Pencil class="size-3.5" />
          </template>
        </Button>
      </div>
    </ToolbarSlot>
    <div class="max-w-3xl mx-auto px-6 py-6 space-y-4">
      <!-- Loading -->
      <div v-if="loading" class="flex items-center justify-center py-16">
        <Loader2 class="size-5 animate-spin text-[var(--app-muted)]" />
      </div>

      <!-- Not found -->
      <Card v-else-if="!project">
        <Empty
          icon="i-lucide-folder-kanban"
          title="Project not found"
          description="This project may have been deleted or the link is wrong."
        />
      </Card>

      <template v-else>
        <!-- Intro -->
        <Card variant="muted">
          <template #header>
            <div class="flex items-start gap-3">
              <FolderKanban class="size-5 text-[var(--app-muted)] mt-0.5 shrink-0" />
              <div class="min-w-0 flex-1">
                <div class="flex items-center gap-2 flex-wrap">
                  <h3 class="text-sm tracking-[0.08em] uppercase font-normal text-[var(--app-foreground)] leading-tight after:content-['.'] after:text-[var(--app-accent)]">{{ project.name }}</h3>
                  <Badge v-if="project.framework" color="primary" size="xs">{{ project.framework }}</Badge>
                  <Badge v-if="project.default_branch" color="neutral" size="xs">{{ project.default_branch }}</Badge>
                </div>
                <p v-if="project.description" class="text-sm text-[var(--app-muted)] mt-0.5">{{ project.description }}</p>
              </div>
            </div>
          </template>
        </Card>

        <!-- Edit form -->
        <Card v-if="editing">
          <template #header>
            <h4 class="text-sm tracking-[0.08em] uppercase font-normal text-[var(--app-foreground)] leading-tight after:content-['.'] after:text-[var(--app-accent)]">Edit project</h4>
          </template>

          <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <label class="block text-[10px] tracking-[0.08em] uppercase text-[var(--app-muted)] mb-1">Name</label>
              <Input v-model="editName" size="sm" />
            </div>
            <div>
              <label class="block text-[10px] tracking-[0.08em] uppercase text-[var(--app-muted)] mb-1">Framework</label>
              <Input v-model="editFramework" size="sm" placeholder="e.g. Next.js, Vue, Rails" />
            </div>
            <div class="md:col-span-2">
              <label class="block text-[10px] tracking-[0.08em] uppercase text-[var(--app-muted)] mb-1">Description</label>
              <Input v-model="editDescription" size="sm" placeholder="Optional" />
            </div>
            <div>
              <label class="block text-[10px] tracking-[0.08em] uppercase text-[var(--app-muted)] mb-1">Repo URL</label>
              <Input v-model="editRepoUrl" size="sm" placeholder="https://github.com/org/repo" />
            </div>
            <div>
              <label class="block text-[10px] tracking-[0.08em] uppercase text-[var(--app-muted)] mb-1">Default branch</label>
              <Input v-model="editBranch" size="sm" placeholder="main" />
            </div>
          </div>

          <template #footer-end>
            <div class="flex items-center gap-2">
              <Button variant="ghost" size="sm" label="Cancel" @click="editing = false" />
              <Button size="sm" label="Save changes" @click="saveEdit" />
            </div>
          </template>
        </Card>

        <!-- Local Projects — unified cards (local + remote merged) -->
        <div>
          <div class="flex items-center justify-between mb-2">
            <h4 class="text-[11px] tracking-[0.12em] uppercase font-medium text-[var(--app-muted)]">Local projects ({{ unifiedEntries.length }})</h4>
            <div class="flex items-center gap-2">
              <Button
                size="xs"
                label="Create"
                @click="showCreate = !showCreate; if (showCreate) showAddRepo = false"
              >
                <template #leading>
                  <Plus class="size-3.5" />
                </template>
              </Button>
              <Button
                size="xs"
                variant="ghost"
                label="Add repository"
                @click="showAddRepo = !showAddRepo; if (showAddRepo) showCreate = false"
              >
                <template #leading>
                  <Plus class="size-3.5" />
                </template>
              </Button>
              <Button
                size="xs"
                variant="ghost"
                label="Link folder"
                @click="setLocalPath"
              >
                <template #leading>
                  <Plus class="size-3.5" />
                </template>
              </Button>
            </div>
          </div>

          <!-- Add repo form -->
          <Card v-if="showAddRepo" class="mb-3">
            <template #header>
              <h4 class="text-sm tracking-[0.08em] uppercase font-normal text-[var(--app-foreground)] leading-tight after:content-['.'] after:text-[var(--app-accent)]">Add repository</h4>
            </template>

            <div class="grid grid-cols-1 md:grid-cols-3 gap-3">
              <div class="md:col-span-2">
                <label class="block text-[10px] tracking-[0.08em] uppercase text-[var(--app-muted)] mb-1">Repo URL</label>
                <Input v-model="newRepoUrl" size="sm" placeholder="https://github.com/org/repo" />
              </div>
              <div>
                <label class="block text-[10px] tracking-[0.08em] uppercase text-[var(--app-muted)] mb-1">Label</label>
                <Input v-model="newRepoName" size="sm" placeholder="Auto" />
              </div>
            </div>

            <template #footer-end>
              <div class="flex items-center gap-2">
                <Button variant="ghost" size="sm" label="Cancel" @click="showAddRepo = false" />
                <Button size="sm" label="Add repository" :disabled="!newRepoUrl.trim()" @click="handleAddRepo" />
              </div>
            </template>
          </Card>

          <!-- Create local project form — picks kind so the card knows
               whether to route to Space Developer or Builder on open. -->
          <Card v-if="showCreate" class="mb-3">
            <template #header>
              <h4 class="text-sm tracking-[0.08em] uppercase font-normal text-[var(--app-foreground)] leading-tight after:content-['.'] after:text-[var(--app-accent)]">New local project</h4>
            </template>

            <div class="space-y-3">
              <div>
                <label class="block text-[10px] tracking-[0.08em] uppercase text-[var(--app-muted)] mb-1">Name</label>
                <Input
                  v-model="newLocalName"
                  size="sm"
                  placeholder="Project name"
                  @keydown.enter="handleCreateLocalProject"
                />
                <p v-if="newLocalName.trim()" class="text-[10px] text-[var(--app-muted)] font-mono mt-1">
                  → {{ projectStore.projectsRoot || '<projects-root>' }}/{{ slugifyName(newLocalName) || 'project' }}
                </p>
              </div>

              <div>
                <label class="block text-[10px] tracking-[0.08em] uppercase text-[var(--app-muted)] mb-1">Kind</label>
                <div class="grid grid-cols-1 md:grid-cols-2 gap-2">
                  <Card
                    interactive
                    variant="muted"
                    :class="newLocalKind === 'project' ? 'ring-1 ring-[var(--app-accent)]' : ''"
                    @click="newLocalKind = 'project'"
                  >
                    <div class="text-[11px] font-medium text-[var(--app-foreground)]">Default Project</div>
                    <div class="text-[10px] text-[var(--app-muted)] mt-0.5 leading-snug">
                      General dev — opens in Builder. Landing pages, web apps, scripts, anything else.
                    </div>
                  </Card>
                  <Card
                    interactive
                    variant="muted"
                    :class="newLocalKind === 'space-project' ? 'ring-1 ring-[var(--app-accent)]' : ''"
                    @click="newLocalKind = 'space-project'"
                  >
                    <div class="text-[11px] font-medium text-[var(--app-foreground)]">Space</div>
                    <div class="text-[10px] text-[var(--app-muted)] mt-0.5 leading-snug">
                      Construct Space — opens in Space Developer. Scaffolds + builds spaces with the SDK.
                    </div>
                  </Card>
                </div>
              </div>
            </div>

            <template #footer-end>
              <div class="flex items-center gap-2">
                <Button
                  variant="ghost"
                  size="sm"
                  label="Cancel"
                  :disabled="creatingLocal"
                  @click="showCreate = false"
                />
                <Button
                  size="sm"
                  :label="creatingLocal ? 'Creating…' : 'Create'"
                  :loading="creatingLocal"
                  :disabled="!newLocalName.trim() || creatingLocal"
                  @click="handleCreateLocalProject"
                />
              </div>
            </template>
          </Card>

          <!-- Projects directory (if set) -->
          <Card v-if="projectStore.projectsRoot && !hasEntries" variant="muted" class="mb-3">
            <template #header>
              <div class="min-w-0 flex-1">
                <p class="text-[10px] tracking-[0.08em] uppercase text-[var(--app-muted)]">Projects directory</p>
                <p class="text-xs text-[var(--app-foreground)] font-mono truncate mt-0.5">{{ projectStore.projectsRoot }}</p>
              </div>
            </template>
            <template #accessory>
              <Button variant="ghost" size="xs" label="Change" @click="changeGlobalPath" />
            </template>
          </Card>

          <!-- Unified entries -->
          <div v-if="hasEntries" class="space-y-3">
            <Card
              v-for="entry in unifiedEntries"
              :key="entry.key"
              :class="entry.localPath ? 'ring-1 ring-[var(--app-accent)]/30' : ''"
            >
              <template #header>
                <div class="flex items-start gap-3">
                  <Check v-if="entry.localPath" class="size-5 text-[var(--app-accent)] mt-0.5 shrink-0" />
                  <GitBranch v-else class="size-5 text-[var(--app-muted)] mt-0.5 shrink-0" />
                  <div class="min-w-0 flex-1">
                    <div class="flex items-center gap-2 flex-wrap">
                      <h4 class="text-sm tracking-[0.08em] uppercase font-normal text-[var(--app-foreground)] leading-tight after:content-['.'] after:text-[var(--app-accent)]">{{ entry.name }}</h4>
                      <Badge v-if="entry.repoBranch" color="neutral" size="xs">{{ entry.repoBranch }}</Badge>
                      <Badge v-if="entry.localPath" color="success" size="xs">linked</Badge>
                    </div>
                    <p v-if="entry.localPath" class="text-[10px] text-[var(--app-muted)] font-mono truncate mt-1">{{ entry.localPath }}</p>
                    <p v-if="entry.repoUrl" class="text-[10px] text-[var(--app-muted)] font-mono truncate mt-1">{{ entry.repoUrl }}</p>
                  </div>
                </div>
              </template>

              <template #accessory>
                <div class="flex items-center gap-1.5">
                  <!-- Has local → Open -->
                  <Button
                    v-if="entry.localPath"
                    size="xs"
                    label="Open"
                    @click="openLocalProject(entry.localPath!, '')"
                  >
                    <template #leading>
                      <FolderKanban class="size-3.5" />
                    </template>
                  </Button>
                  <!-- Remote only → Clone -->
                  <Button
                    v-if="entry.repoUrl && !entry.localPath"
                    size="xs"
                    :label="cloning ? 'Cloning…' : 'Clone'"
                    :loading="cloning"
                    :disabled="cloning"
                    @click="cloneRepo(entry.repoUrl)"
                  >
                    <template #leading>
                      <Download class="size-3.5" />
                    </template>
                  </Button>
                  <!-- Remote only → Link local -->
                  <Button
                    v-if="entry.repoUrl && !entry.localPath"
                    variant="ghost"
                    size="xs"
                    label="Link local"
                    @click="setLocalPath"
                  >
                    <template #leading>
                      <FolderKanban class="size-3.5" />
                    </template>
                  </Button>
                  <!-- Local only → Add remote / create repo -->
                  <Button
                    v-if="entry.localPath && !entry.repoUrl"
                    variant="ghost"
                    size="xs"
                    label="Add remote"
                    @click="handleAddRemote(entry.localPath!)"
                  >
                    <template #leading>
                      <GitBranch class="size-3.5" />
                    </template>
                  </Button>
                  <!-- Remove -->
                  <Button
                    v-if="entry.repoId"
                    variant="ghost"
                    color="error"
                    size="xs"
                    icon="lucide:x"
                    title="Remove repository"
                    @click="handleRemoveRepo(entry.repoId)"
                  />
                  <Button
                    v-else-if="entry.localPath && !entry.repoUrl"
                    variant="ghost"
                    color="error"
                    size="xs"
                    icon="lucide:x"
                    title="Unlink local folder"
                    @click="unlinkLocalPath(entry.localPath!)"
                  />
                </div>
              </template>
            </Card>
          </div>

          <!-- Empty state -->
          <Card v-else>
            <Empty
              icon="i-lucide-folder-kanban"
              title="No local projects yet"
              description="Link a folder already on your machine, or add a remote repository URL to clone."
            >
              <div class="flex items-center gap-2">
                <Button size="sm" label="Link folder" @click="setLocalPath">
                  <template #leading>
                    <FolderOpen class="size-3.5" />
                  </template>
                </Button>
                <Button variant="ghost" size="sm" label="Add repository" @click="showAddRepo = true">
                  <template #leading>
                    <Download class="size-3.5" />
                  </template>
                </Button>
              </div>
            </Empty>
          </Card>
        </div>

        <!-- Danger zone — only visible in edit mode -->
        <Card v-if="editing">
          <template #header>
            <div class="flex items-start gap-3">
              <ShieldAlert class="size-5 text-red-400 mt-0.5 shrink-0" />
              <div class="min-w-0 flex-1">
                <h4 class="text-sm tracking-[0.08em] uppercase font-normal text-red-400 leading-tight after:content-['.']">Danger zone</h4>
                <p class="text-xs text-[var(--app-muted)] mt-0.5">Remove this project from the organization. Members using this project will lose access.</p>
              </div>
            </div>
          </template>
          <template #accessory>
            <Button
              variant="ghost"
              color="error"
              size="xs"
              label="Delete project"
              @click="showDeleteConfirm = true"
            >
              <template #leading>
                <Trash2 class="size-3.5" />
              </template>
            </Button>
          </template>
        </Card>

        <Teleport to="body">
          <ConfirmationModal
            v-model="showDeleteConfirm"
            title="Delete Project"
            :message="`Are you sure you want to delete '${project.name}'? Members using this project will lose access.`"
            confirm-text="Delete"
            confirm-color="error"
            @confirm="handleDelete"
          />
        </Teleport>

        <!-- Assign Members Modal -->
        <Modal :open="showMembersModal" title="Assign members" @close="showMembersModal = false">
          <div class="space-y-3">
            <p class="text-xs text-[var(--app-muted)]">
              <strong class="text-[var(--app-foreground)]">{{ assignedMembers.length }}</strong> assigned to {{ project.name }}
            </p>

            <div v-if="membersLoading" class="flex items-center justify-center py-8">
              <Loader2 class="size-4 animate-spin text-[var(--app-muted)]" />
            </div>

            <div v-else class="space-y-1 max-h-[50vh] overflow-y-auto -mx-1">
              <button
                v-for="member in orgStore.members"
                :key="member.id"
                class="w-full flex items-center gap-3 px-3 py-2 rounded-lg text-left transition-colors"
                :class="isAssigned(member.id) ? 'bg-[color-mix(in_srgb,var(--app-accent)_8%,transparent)]' : 'hover:bg-[var(--app-canvas-bg)]'"
                @click="toggleMember(member)"
              >
                <div class="size-7 rounded-full bg-[color-mix(in_srgb,var(--app-accent)_12%,transparent)] flex items-center justify-center text-[10px] font-medium text-[var(--app-accent)] shrink-0">
                  {{ member.name.split(' ').map((w: string) => w[0]).slice(0, 2).join('').toUpperCase() }}
                </div>
                <div class="flex-1 min-w-0">
                  <p class="text-xs font-medium text-[var(--app-foreground)] truncate">{{ member.name }}</p>
                  <p class="text-[10px] text-[var(--app-muted)] truncate">{{ member.email || member.role }}</p>
                </div>
                <div class="shrink-0">
                  <div v-if="isAssigned(member.id)" class="size-5 rounded bg-[var(--app-accent)] flex items-center justify-center">
                    <Check class="size-3 text-white" />
                  </div>
                  <div v-else class="size-5 rounded border border-[var(--app-border)]" />
                </div>
              </button>
            </div>

            <div class="flex justify-end">
              <Button size="sm" label="Done" @click="showMembersModal = false" />
            </div>
          </div>
        </Modal>

        <!-- Git Setup Modal -->
        <Modal :open="showGitSetup" title="Set up repository" @close="showGitSetup = false">
          <p class="text-[10px] text-[var(--app-muted)] font-mono truncate mb-3">{{ gitSetupPath }}</p>

          <!-- Step: choose -->
          <div v-if="gitSetupStep === 'choose'" class="space-y-3">
            <p class="text-xs text-[var(--app-muted)]">This folder has no git repository. What would you like to do?</p>
            <Card interactive variant="muted" @click="gitSetupPickOrg">
              <div class="flex items-center gap-3">
                <Globe class="size-5 text-[var(--app-accent)] shrink-0" />
                <div class="min-w-0 flex-1">
                  <p class="text-sm font-medium text-[var(--app-foreground)]">Create GitHub repository</p>
                  <p class="text-[10px] text-[var(--app-muted)] mt-0.5">Init git, create remote repo, and push</p>
                </div>
              </div>
            </Card>
            <Card interactive variant="muted" @click="gitSetupInitOnly">
              <div class="flex items-center gap-3">
                <GitBranch class="size-5 text-[var(--app-muted)] shrink-0" />
                <div class="min-w-0 flex-1">
                  <p class="text-sm font-medium text-[var(--app-foreground)]">Init local only</p>
                  <p class="text-[10px] text-[var(--app-muted)] mt-0.5">Initialize git without a remote</p>
                </div>
              </div>
            </Card>
          </div>

          <!-- Step: pick org -->
          <div v-else-if="gitSetupStep === 'pick-org'" class="space-y-4">
            <div>
              <label class="block text-[10px] tracking-[0.08em] uppercase text-[var(--app-muted)] mb-1">Repository name</label>
              <Input v-model="gitSetupRepoName" size="sm" />
            </div>

            <div>
              <label class="block text-[10px] tracking-[0.08em] uppercase text-[var(--app-muted)] mb-1">Visibility</label>
              <div class="flex items-center gap-2">
                <Button
                  :variant="gitSetupPrivate ? 'solid' : 'ghost'"
                  size="xs"
                  label="Private"
                  @click="gitSetupPrivate = true"
                />
                <Button
                  :variant="!gitSetupPrivate ? 'solid' : 'ghost'"
                  size="xs"
                  label="Public"
                  @click="gitSetupPrivate = false"
                />
              </div>
            </div>

            <div>
              <label class="block text-[10px] tracking-[0.08em] uppercase text-[var(--app-muted)] mb-2">Select owner</label>

              <!-- gh CLI missing entirely -->
              <div
                v-if="gitSetupGhState === 'not-installed'"
                class="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 space-y-2"
              >
                <p class="text-xs font-medium text-[var(--app-foreground)]">
                  GitHub CLI not found
                </p>
                <p class="text-[10px] text-[var(--app-muted)]">
                  Construct uses <code class="font-mono">gh</code> to create and push repos. Install it once, then come back to this dialog.
                </p>
                <Button size="sm" label="Install GitHub CLI" @click="openGhInstallPage" />
              </div>

              <!-- gh installed but not logged in -->
              <div
                v-else-if="gitSetupGhState === 'not-authed'"
                class="rounded-lg border border-[var(--app-accent)]/30 bg-[var(--app-accent)]/5 p-3 space-y-2"
              >
                <p class="text-xs font-medium text-[var(--app-foreground)]">
                  Sign in to GitHub
                </p>
                <p class="text-[10px] text-[var(--app-muted)]">
                  <code class="font-mono">gh</code> is installed but not authenticated. Run <code class="font-mono">gh auth login</code> once and retry.
                </p>
                <div class="flex items-center gap-2 pt-1">
                  <Button size="sm" label="Open Terminal to log in" @click="openTerminalLogin" />
                  <Button
                    variant="ghost"
                    size="sm"
                    :label="gitSetupCopied ? 'Copied' : 'Copy command'"
                    @click="copyLoginCommand"
                  />
                  <Button variant="ghost" size="sm" label="Retry" class="ml-auto" @click="gitSetupPickOrg" />
                </div>
              </div>

              <!-- Loading orgs -->
              <div
                v-else-if="!gitSetupOrgs.length && !gitSetupError"
                class="flex items-center justify-center py-4"
              >
                <Loader2 class="size-4 animate-spin text-[var(--app-muted)]" />
              </div>

              <!-- Org list -->
              <div v-else class="space-y-1 max-h-60 overflow-y-auto">
                <button
                  v-for="org in gitSetupOrgs"
                  :key="org"
                  class="w-full flex items-center gap-2 px-3 py-2.5 rounded-lg text-left hover:bg-[var(--app-canvas-bg)] transition-colors"
                  @click="gitSetupCreateRepo(org)"
                >
                  <div class="size-6 rounded-full bg-[color-mix(in_srgb,var(--app-accent)_12%,transparent)] flex items-center justify-center text-[10px] font-medium text-[var(--app-accent)] shrink-0">
                    {{ org[0]?.toUpperCase() }}
                  </div>
                  <span class="text-xs font-medium text-[var(--app-foreground)]">{{ org }}</span>
                  <span class="text-[10px] text-[var(--app-muted)] ml-auto font-mono">{{ org }}/{{ gitSetupRepoName }}</span>
                </button>
              </div>
            </div>

            <p v-if="gitSetupError" class="text-[10px] text-red-400">{{ gitSetupError }}</p>
          </div>

          <!-- Step: creating -->
          <div v-else-if="gitSetupStep === 'creating'" class="flex flex-col items-center justify-center py-10">
            <Loader2 class="size-5 animate-spin text-[var(--app-accent)] mb-3" />
            <p class="text-sm text-[var(--app-foreground)]">Creating repository…</p>
            <p class="text-[10px] text-[var(--app-muted)] mt-1">Initializing git, creating remote, and pushing</p>
          </div>
        </Modal>
      </template>
    </div>
  </div>
</template>
