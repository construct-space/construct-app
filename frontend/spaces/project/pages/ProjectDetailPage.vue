<script setup lang="ts">
import ToolbarSlot from '@/components/common/ToolbarSlot.vue'
/**
 * ProjectDetailPage - Project overview with spaces, stats, and deploy
 */
import { computed, ref, watchEffect } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { useProjectStore } from '@/stores/project'
import { routeParamString } from '@/utils/projectRoutes'
import { useProjectSummary } from '../composables/useProjectSummary'
import { useBasepodDeploy } from '@/composables/useBasepodDeploy'
import { useBrain } from '@/brain'
// Type-only import (erased at build) — a value import here would close a
// circular chain: coreSpaces → ProjectDetailPage → spaceDoctor → coreSpaces.
// spaceDoctor itself is loaded dynamically in loadSpaceHealth().
import type { SpaceHealthReport } from '@/space_loader/spaceDoctor'
import { Rocket, Zap, ExternalLink, FileText, GitBranch, Loader2, Folder, File, X, CheckCircle2, AlertTriangle, XCircle, Upload, Play, Boxes, Eye, TerminalSquare, ArrowLeft, FolderKanban, Copy, Check, ChevronRight } from 'lucide-vue-next'
import { Badge, Button, Card, Empty, Separator } from '@construct-space/ui'
import { useSpaceRunner } from '@/composables/useSpaceRunner'
import { useMarkdown } from '@/composables/useMarkdown'
import ProjectDeployModal from '../components/ProjectDeployModal.vue'
import SpacePublishModal from '../components/SpacePublishModal.vue'

const { renderMarkdown } = useMarkdown()
const brain = useBrain()
const { openRunner } = useSpaceRunner()

// Doc preview modal
const previewDoc = ref<{ title: string; content: string } | null>(null)

async function openDoc(docTitle: string) {
  const path = projectPath.value
  if (!path) return
  // Find the actual doc entry from the summary
  const docEntry = summary.value.docs.items.find((d: { title: string; filename?: string }) => d.title === docTitle)
  if (!docEntry) return
  // Use stored filename if available, fall back to title-based derivation
  const fileName = docEntry.filename || `${docEntry.title.replace(/ /g, '-')}.md`
  const filePath = `${path}/docs/${fileName}`
  try {
    const result = await brain.callTool({
      id: `doc-${Date.now()}`,
      type: 'function',
      function: { name: 'read_file', arguments: JSON.stringify({ path: filePath }) },
    })
    if (result?.content) {
      const raw = String(result.content)
      // Skip cache messages from read_file tool
      if (raw.includes('[File unchanged since last read')) return
      const content = raw.replace(/^\s*\d+[│|]\s?/gm, '')
      previewDoc.value = { title: docTitle, content }
    }
  } catch { /* ignore */ }
}

const router = useRouter()
const route = useRoute()
const projectStore = useProjectStore()
const { loadDeployInfo } = useBasepodDeploy()

const project = computed(() => projectStore.currentProject)
const projectRouteKey = computed(() => routeParamString(route.params.projectId))
const projectPath = computed(() => project.value?.path || project.value?.local_path)
const { summary } = useProjectSummary(projectPath)

const showDeployModal = ref(false)
const showPublishModal = ref(false)
const deployInfo = ref<{ name: string; url: string; domain: string; deployed_at: string } | null>(null)

// Space health for this project
const spaceHealthReports = ref<SpaceHealthReport[]>([])
const spaceHealthLoaded = ref(false)

const _activeSpaces = computed(() =>
  spaceHealthReports.value.filter(r => r.status !== 'error')
)
const _errorSpaces = computed(() =>
  spaceHealthReports.value.filter(r => r.status === 'error')
)

async function loadSpaceHealth() {
  try {
    const { spaceDoctor } = await import('@/space_loader/spaceDoctor')
    spaceHealthReports.value = await spaceDoctor()
    spaceHealthLoaded.value = true
  } catch {
    // non-critical
  }
}

const _healthStatusIcon = (status: string) => {
  switch (status) {
    case 'healthy': return CheckCircle2
    case 'warning': return AlertTriangle
    case 'error': return XCircle
    default: return CheckCircle2
  }
}

const _healthStatusColor = (status: string) => {
  switch (status) {
    case 'healthy': return 'text-green-400'
    case 'warning': return 'text-amber-400'
    case 'error': return 'text-red-400'
    default: return 'text-green-400'
  }
}

watchEffect(async () => {
  if (projectPath.value) {
    deployInfo.value = await loadDeployInfo(projectPath.value)
    loadSpaceHealth()
  }
})

function enterSpace(spaceName: string) {
  if (projectRouteKey.value) {
    router.push(`/app/projects/${projectRouteKey.value}/${spaceName}`)
  }
}

async function openDeployedSite() {
  if (!deployInfo.value?.url) return
  try {
    const { open } = await import('@tauri-apps/plugin-shell')
    await open(deployInfo.value.url)
  } catch {
    window.open(deployInfo.value.url, '_blank')
  }
}

async function onDeployClose() {
  showDeployModal.value = false
  if (projectPath.value) {
    deployInfo.value = await loadDeployInfo(projectPath.value)
  }
}

function handleActionClick() {
  if (projectType.value === 'space') {
    showPublishModal.value = true
  } else if (projectType.value === 'app') {
    // App projects (Flutter/Swift/React Native/…) have no deploy path in
    // the normal sense. Opening Builder gives the user the plan+code loop
    // to drive whatever the platform's equivalent of 'run' is.
    enterSpace('builder')
  } else {
    showDeployModal.value = true
  }
}

function onPublishClose() {
  showPublishModal.value = false
}

// Preview the first detected space in a SpacePreview window.
// The SpacePreview shell expects a built bundle + manifest.json at the
// target path. So before opening we:
//   1. Ensure the space is installed (copies dist/ to the app spaces dir).
//      If install fails because there's no dist/ yet, build then install.
//   2. Open the runner against the installed path (no projectPath → the
//      shell uses the installed location at ~/.../Construct/spaces/<id>).
// This lets Preview "just work" from a fresh scaffold without the user
// having to remember to build first.
const previewStatus = ref<'idle' | 'building' | 'installing' | 'opening' | 'error'>('idle')
const previewError = ref<string | null>(null)

async function runTool(name: string, args: Record<string, unknown>): Promise<{ ok: boolean; content: string }> {
  try {
    const result = await brain.callTool({
      id: `${name}-${Date.now()}`,
      type: 'function',
      function: { name, arguments: JSON.stringify(args) },
    })
    const content = String(result?.content ?? '')
    return { ok: !result?.is_error, content }
  } catch (err) {
    return { ok: false, content: err instanceof Error ? err.message : String(err) }
  }
}

function resolvePrimarySpaceDir(): string | null {
  // Prefer the async-detected list; fall back to the sync fileTree so the
  // button still works before detection finishes. Both paths return an
  // absolute directory containing space.manifest.json.
  const fromDetection = spaceManifestPaths.value[0]
  if (fromDetection) return fromDetection.replace(/\/space\.manifest\.json$/, '')
  const root = projectPath.value
  if (!root) return null
  const subdir = summary.value.fileTree.find(
    f => f.type === 'directory' && f.name.startsWith('space-'),
  )
  if (subdir) return `${root}/${subdir.name}`
  const rootManifest = summary.value.fileTree.some(f => f.name === 'space.manifest.json')
  if (rootManifest) return root
  return null
}

async function previewSpace() {
  const spaceDir = resolvePrimarySpaceDir()
  if (!spaceDir) return
  const dirName = spaceDir.split('/').pop() ?? 'space'
  const id = dirName.replace(/^space-/, '')

  previewError.value = null

  // Build first. space_build writes dist/manifest.json + the IIFE bundle.
  // The SpacePreview shell loads `manifest.json` at `dir`, so we point it
  // at `<space-src>/dist` rather than the source directory.
  previewStatus.value = 'building'
  const build = await runTool('space_build', { path: spaceDir })
  if (!build.ok) {
    previewStatus.value = 'error'
    previewError.value = `Build failed:\n${build.content}`
    return
  }

  previewStatus.value = 'opening'
  await openRunner({
    spaceId: id,
    projectPath: `${spaceDir}/dist`,
    // Pass the project root so the Runner sidebar can enumerate sibling
    // subspaces (other `space-*/` dirs) instead of the host's core spaces.
    project: projectPath.value,
  })
  previewStatus.value = 'idle'
}

const pathCopied = ref(false)
async function copyPath() {
  const p = project.value?.path || project.value?.local_path
  if (!p) return
  try {
    await navigator.clipboard.writeText(p)
    pathCopied.value = true
    setTimeout(() => { pathCopied.value = false }, 1400)
  } catch { /* clipboard unavailable */ }
}

const formatDate = (dateStr: string) => {
  try {
    const d = new Date(dateStr)
    return d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
  } catch {
    return dateStr
  }
}

const extLabel: Record<string, string> = {
  ts: 'TypeScript', js: 'JavaScript', vue: 'Vue', tsx: 'TSX', jsx: 'JSX',
  go: 'Go', rs: 'Rust', py: 'Python', rb: 'Ruby', swift: 'Swift',
  dart: 'Dart', kt: 'Kotlin', java: 'Java', css: 'CSS', scss: 'SCSS',
  html: 'HTML', json: 'JSON', yaml: 'YAML', yml: 'YAML', toml: 'TOML',
  md: 'Markdown', sql: 'SQL', sh: 'Shell', svg: 'SVG',
}

function getExtLabel(ext: string): string {
  return extLabel[ext] || `.${ext}`
}

// Manifests found anywhere in the project. Populated asynchronously — see
// detectSpaceManifests() below. Empty array means "not a Construct Space
// project (yet)"; one-or-more entries means we show the space actions.
const spaceManifestPaths = ref<string[]>([])

// Set true when `.construct/project.json` has `kind: "space-project"`, even
// if its `spaces` array is empty. Lets us show space-oriented actions on a
// brand-new project created from Space Developer before any space has been
// scaffolded inside it yet.
const isMarkedSpaceProject = ref(false)

// Parallel Tauri-direct probe of the project root for any `space-*/`
// subdirectory. The main projectType computed also scans
// `summary.fileTree` for the same marker, but that channel goes through
// the operator's list_dir tool — which dedup-silences repeat calls within
// a session and sometimes returns an empty listing for scope reasons.
// Reading the filesystem directly via Tauri's plugin-fs is authoritative
// and matches what ProjectCard already does.
const hasSpaceSubdir = ref(false)
async function probeSpaceSubdir(projectRoot: string) {
  try {
    const { readDir } = await import('@tauri-apps/plugin-fs')
    const entries = await readDir(projectRoot)
    hasSpaceSubdir.value = entries.some(e => e.isDirectory && e.name.startsWith('space-'))
  } catch {
    hasSpaceSubdir.value = false
  }
}

// `.construct/project.json` is the source of truth for subspaces in a
// project — written by `scaffold.Scaffold()` on `space_create`. Reading it
// avoids a filesystem scan and also gives us display names + IDs without
// opening each space's own manifest.
async function readProjectManifest(projectRoot: string): Promise<string[] | null> {
  try {
    const { readTextFile, exists } = await import('@tauri-apps/plugin-fs')
    const path = `${projectRoot}/.construct/project.json`
    if (!(await exists(path))) return null
    const raw = await readTextFile(path)
    const parsed = JSON.parse(raw) as {
      kind?: string
      spaces?: { manifestPath?: string }[]
    }
    // Record the space-project marker regardless of whether any spaces are
    // registered yet — a freshly-created project may have `spaces: []`.
    if (parsed?.kind === 'space-project') isMarkedSpaceProject.value = true
    if (!parsed?.spaces?.length) return []
    return parsed.spaces
      .map(s => s.manifestPath)
      .filter((p): p is string => !!p)
      .map(p => `${projectRoot}/${p}`)
  } catch {
    return null
  }
}

// Lightweight callTool wrapper. Returns the string content or null on
// error — all callers below are probing so nulls are expected.
async function probeTool(name: string, args: Record<string, unknown>): Promise<string | null> {
  try {
    const result = await brain.callTool({
      id: `detect-${name}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      type: 'function',
      function: { name, arguments: JSON.stringify(args) },
    })
    if (result?.is_error) return null
    const content = typeof result?.content === 'string' ? result.content : null
    if (content && content.includes('[File unchanged since last read')) return null
    return content
  } catch {
    return null
  }
}

async function detectSpaceManifests() {
  const path = projectPath.value
  if (!path) {
    spaceManifestPaths.value = []
    return
  }

  // 1. Authoritative: .construct/project.json written by scaffold. Prefer
  //    Tauri's direct fs read (fastest); fall back to operator.read_file.
  const fromProject = await readProjectManifest(path)
  if (fromProject !== null) {
    spaceManifestPaths.value = fromProject
    return
  }
  const projectJson = await probeTool('read_file', { path: `${path}/.construct/project.json` })
  if (projectJson) {
    try {
      // read_file prefixes each line with "<n>│ "; strip it before JSON.parse.
      const stripped = projectJson.replace(/^\s*\d+[│|]\s?/gm, '')
      const parsed = JSON.parse(stripped) as { spaces?: { manifestPath?: string }[] }
      if (parsed?.spaces?.length) {
        spaceManifestPaths.value = parsed.spaces
          .map(s => s.manifestPath)
          .filter((p): p is string => !!p)
          .map(p => `${path}/${p}`)
        return
      }
    } catch { /* malformed — fall through */ }
  }

  // 2. Filesystem scan via list_dir + read_file (the same tools used
  //    elsewhere on this page). list_dir output format: one line per entry,
  //    directories prefixed with "📁 ".
  const rootListing = await probeTool('list_dir', { path })
  const found: string[] = []
  const discovered: Array<{ id: string; name: string; dir: string; manifestPath: string }> = []
  if (rootListing) {
    const lines = rootListing.split('\n').map(l => l.trim()).filter(Boolean)
    const spaceDirs = lines
      .filter(l => l.startsWith('📁'))
      .map(l => l.replace(/^📁\s*/, '').trim())
      .filter(n => n.startsWith('space-'))

    const probes = await Promise.all(
      spaceDirs.map(async (dirName) => {
        const manifestPath = `${path}/${dirName}/space.manifest.json`
        const content = await probeTool('read_file', { path: manifestPath })
        if (!content) return null
        // Try to extract id + display name from the manifest so the migrated
        // project.json records them accurately. Fall back to the directory
        // name if parsing fails.
        let id = dirName.replace(/^space-/, '')
        let name = id
        try {
          const stripped = content.replace(/^\s*\d+[│|]\s?/gm, '')
          const m = JSON.parse(stripped) as { id?: string; name?: string }
          if (m?.id) id = m.id
          if (m?.name) name = m.name
        } catch { /* keep defaults */ }
        return { id, name, dir: dirName, manifestPath, fullPath: manifestPath }
      }),
    )
    for (const p of probes) {
      if (!p) continue
      found.push(p.fullPath)
      discovered.push({ id: p.id, name: p.name, dir: p.dir, manifestPath: `${p.dir}/space.manifest.json` })
    }

    // Single-space project: manifest at the root.
    if (rootListing.includes('space.manifest.json')) {
      found.push(`${path}/space.manifest.json`)
    }
  }

  spaceManifestPaths.value = found

  // Auto-migrate: if we recovered spaces the hard way (fallback scan), write
  // a project.json so next visit is instant AND the file is discoverable via
  // the filesystem. Only runs when project.json was actually missing (tier 1
  // and tier-1b probes both failed above) so we don't clobber a good file.
  if (discovered.length > 0) {
    await writeProjectManifest(path, discovered)
  }
}

// Write `.construct/project.json` with the discovered space records. This
// mirrors the schema the operator's scaffold.Scaffold() writes; the goal is
// that both producers end up with identical files so loaders can rely on
// them interchangeably.
async function writeProjectManifest(
  projectRoot: string,
  spaces: Array<{ id: string; name: string; dir: string; manifestPath: string }>,
): Promise<void> {
  try {
    const { writeTextFile, mkdir, exists } = await import('@tauri-apps/plugin-fs')
    const dir = `${projectRoot}/.construct`
    if (!(await exists(dir))) await mkdir(dir, { recursive: true })
    const now = new Date().toISOString()
    const payload = {
      kind: 'space-project',
      createdAt: now,
      updatedAt: now,
      spaces: spaces.map(s => ({
        id: s.id,
        name: s.name,
        dir: s.dir,
        manifestPath: s.manifestPath,
      })),
    }
    await writeTextFile(`${dir}/project.json`, JSON.stringify(payload, null, 2) + '\n')
  } catch { /* non-fatal — detection still works this session */ }
}

// Re-detect when the project path changes. Also re-runs after the summary
// loads (fileTree changing is a reasonable proxy for "files were written").
watchEffect(() => {
  if (projectPath.value) detectSpaceManifests()
})

// Direct filesystem probe for `space-*/` — cheapest + most reliable
// signal and independent of the operator's list_dir dedup.
watchEffect(() => {
  if (projectPath.value) probeSpaceSubdir(projectPath.value)
})

// Detect project type for contextual action button.
// A Construct Space project is one where `space.manifest.json` exists at
// ANY depth (excluding node_modules/dist/.git). Covers: single-space at
// root, multi-space container with `space-*/`, or unusual layouts.
//
// Order of evidence — each is allowed to "promote" the project to `space`:
//   1. detectSpaceManifests() — reads .construct/project.json or globs
//      (most authoritative, but async)
//   2. summary.fileTree — already-loaded root listing; catches the common
//      `space-*/` subdirectory case instantly so the buttons don't flash
//      the wrong state while detection runs.
const projectType = computed<'space' | 'app' | 'web'>(() => {
  if (spaceManifestPaths.value.length > 0) return 'space'
  // A project explicitly created from Space Developer is space-typed even
  // before any space dir exists inside it.
  if (isMarkedSpaceProject.value) return 'space'
  // Store record's kind wins over filesystem probes.
  if (project.value?.kind === 'space-project') return 'space'
  // Authoritative direct-FS probe (bypasses the operator list_dir dedup).
  if (hasSpaceSubdir.value) return 'space'
  const tree = summary.value.fileTree
  const hasManifestAtRoot = tree.some(f => f.name === 'space.manifest.json')
  const hasSpaceDir = tree.some(f => f.type === 'directory' && f.name.startsWith('space-'))
  if (hasManifestAtRoot || hasSpaceDir) return 'space'
  const fw = project.value?.framework?.toLowerCase() || ''
  if (['flutter', 'swift', 'kotlin', 'react-native', 'expo'].includes(fw)) return 'app'
  return 'web'
})

const actionButton = computed(() => {
  switch (projectType.value) {
    case 'space': return { label: 'Publish', reLabel: 'Re-Publish', icon: Upload }
    case 'app': return { label: 'Run in Simulator', reLabel: 'Run in Simulator', icon: Play }
    default: return { label: 'Deploy', reLabel: 'Re-Deploy', icon: Rocket }
  }
})
</script>

<template>
  <div class="h-full overflow-auto">
    <div v-if="projectStore.loading" class="flex items-center justify-center h-full">
      <Loader2 class="size-5 animate-spin text-[var(--app-muted)]" />
    </div>

    <div v-else-if="project" class="max-w-[1600px] mx-auto px-8 py-6 space-y-5">
      <!-- Back -->
      <button
        class="group inline-flex items-center gap-1.5 text-[11px] tracking-[0.12em] uppercase text-[var(--app-muted)] hover:text-[var(--app-foreground)] transition-colors"
        @click="router.push('/app/projects')"
      >
        <ArrowLeft class="size-3.5 transition-transform group-hover:-translate-x-0.5" />
        Back to projects
      </button>

      <!-- Hero: identity + live status + actions in one cohesive panel -->
      <Card>
        <div class="flex items-start gap-3.5">
          <div class="grid size-11 place-items-center rounded-xl bg-[var(--app-canvas-bg)] border border-[var(--app-border)] shrink-0">
            <FolderKanban class="size-5 text-[var(--app-accent)]" />
          </div>
          <div class="min-w-0 flex-1">
            <div class="flex items-center gap-2 flex-wrap">
              <h1 class="text-base tracking-[0.06em] uppercase font-medium text-[var(--app-foreground)] leading-tight after:content-['.'] after:text-[var(--app-accent)]">{{ project.name }}</h1>
              <Badge color="neutral" size="xs">{{ projectType }}</Badge>
              <Badge v-if="project.framework" color="primary" size="xs">{{ project.framework }}</Badge>
              <Badge v-if="summary.git.hasRepo" color="neutral" size="xs">git</Badge>
            </div>
            <p v-if="project.description" class="text-sm text-[var(--app-muted)] mt-1">{{ project.description }}</p>
            <!-- Copyable path chip -->
            <button
              class="group mt-2 inline-flex items-center gap-1.5 max-w-full rounded-md border border-[var(--app-border)] bg-[var(--app-canvas-bg)] px-2 py-1 text-[11px] font-mono text-[var(--app-muted)] hover:text-[var(--app-foreground)] hover:border-[color-mix(in_srgb,var(--app-foreground)_18%,transparent)] transition-colors cursor-pointer"
              :title="pathCopied ? 'Copied' : 'Copy path'"
              @click="copyPath"
            >
              <span class="truncate">{{ project.path }}</span>
              <Check v-if="pathCopied" class="size-3 text-emerald-400 shrink-0" />
              <Copy v-else class="size-3 opacity-0 group-hover:opacity-100 transition-opacity shrink-0" />
            </button>
          </div>

          <!-- Live status pill (top-right) -->
          <button
            v-if="deployInfo"
            class="group shrink-0 inline-flex items-center gap-2 rounded-full border border-emerald-500/30 bg-emerald-500/10 pl-2.5 pr-2 py-1 transition-colors hover:bg-emerald-500/15 cursor-pointer"
            :title="`Open ${deployInfo.domain}`"
            @click="openDeployedSite"
          >
            <span class="size-1.5 rounded-full bg-emerald-400 animate-pulse" />
            <span class="text-[10px] tracking-[0.12em] uppercase font-medium text-emerald-400">Live</span>
            <ExternalLink class="size-3 text-emerald-400/70 group-hover:text-emerald-400 transition-colors" />
          </button>
        </div>

        <!-- Deployed domain line (when live) -->
        <button
          v-if="deployInfo"
          class="mt-3 flex w-full items-center justify-between gap-3 rounded-lg border border-[var(--app-border)] bg-[var(--app-canvas-bg)] px-3 py-2 text-left transition-colors hover:border-emerald-500/30 cursor-pointer"
          @click="openDeployedSite"
        >
          <span class="text-xs font-mono text-[var(--app-foreground)] truncate">{{ deployInfo.domain }}</span>
          <span class="text-[10px] tracking-[0.08em] uppercase text-[var(--app-muted)] shrink-0">{{ formatDate(deployInfo.deployed_at) }}</span>
        </button>

        <Separator class="my-4" />

        <!-- Actions -->
        <div class="flex items-center gap-2 flex-wrap">
          <!-- Primary CTA first: Deploy/Publish (the main thing to do here). -->
          <template v-if="projectType === 'space'">
            <Button
              :variant="deployInfo ? 'soft' : 'solid'"
              color="success"
              size="sm"
              label="Publish"
              @click="showPublishModal = true"
            >
              <template #leading><Upload class="size-3.5" /></template>
            </Button>
          </template>
          <Button
            v-else
            :variant="deployInfo ? 'soft' : 'solid'"
            color="success"
            size="sm"
            :label="deployInfo ? actionButton.reLabel : actionButton.label"
            @click="handleActionClick"
          >
            <template #leading><component :is="actionButton.icon" class="size-3.5" /></template>
          </Button>

          <!--
            One "open the build agent" button. Routes to Space Developer when
            we detect this is a Construct Space project; otherwise routes to
            Builder, the general-purpose plan+code agent. projectType encodes
            this decision — reusing it keeps detection logic in one place.
          -->
          <Button
            v-if="projectType === 'space'"
            variant="ghost"
            size="sm"
            label="Space Developer"
            @click="enterSpace('space-developer')"
          >
            <template #leading><Boxes class="size-4 text-violet-400" /></template>
          </Button>
          <Button
            v-else
            variant="ghost"
            size="sm"
            label="Builder"
            @click="enterSpace('builder')"
          >
            <template #leading><Zap class="size-4 text-emerald-400" /></template>
          </Button>
          <!-- Space-only: Preview -->
          <Button
            v-if="projectType === 'space'"
            variant="ghost"
            size="sm"
            :disabled="previewStatus !== 'idle' && previewStatus !== 'error'"
            :label="previewStatus === 'building' ? 'Building…' : previewStatus === 'installing' ? 'Installing…' : previewStatus === 'opening' ? 'Opening…' : 'Preview'"
            @click="previewSpace"
          >
            <template #leading>
              <Loader2
                v-if="previewStatus === 'building' || previewStatus === 'installing' || previewStatus === 'opening'"
                class="size-4 animate-spin text-sky-400"
              />
              <Eye v-else class="size-4 text-sky-400" />
            </template>
          </Button>
        </div>
      </Card>

      <!-- Overview loading -->
      <Card v-if="summary.loading">
        <div class="space-y-3">
          <div class="h-4 w-1/3 rounded bg-[color-mix(in_srgb,var(--app-foreground)_6%,transparent)] animate-pulse" />
          <div class="h-24 rounded-lg bg-[color-mix(in_srgb,var(--app-foreground)_3%,transparent)] animate-pulse" />
        </div>
      </Card>

      <!-- Two-column layout: main content (readme + files) beside a metadata sidebar -->
      <div v-else class="grid grid-cols-1 lg:grid-cols-3 gap-5 items-start">
        <!-- Main column: README + Files sit side-by-side on wide screens -->
        <div class="lg:col-span-2 min-w-0 grid grid-cols-1 xl:grid-cols-2 gap-5 items-start">
          <!-- README -->
          <Card v-if="summary.readme" :class="summary.fileTree.length === 0 ? 'xl:col-span-2' : ''">
            <template #header>
              <h4 class="text-sm tracking-[0.08em] uppercase font-normal text-[var(--app-foreground)] leading-tight after:content-['.'] after:text-[var(--app-accent)]">Readme</h4>
            </template>
            <div
              class="project-prose text-sm leading-relaxed prose prose-sm dark:prose-invert max-w-none"
              v-html="renderMarkdown(summary.readme)"
            />
          </Card>

          <!-- Files -->
          <div v-if="summary.fileTree.length > 0" :class="!summary.readme ? 'xl:col-span-2' : ''">
            <h4 class="text-[11px] tracking-[0.12em] uppercase font-medium text-[var(--app-muted)] mb-2 px-1">Files</h4>
            <Card>
              <div class="-mx-5 -my-5 divide-y divide-[var(--app-border)]">
                <div
                  v-for="file in summary.fileTree"
                  :key="file.name"
                  class="flex items-center gap-2.5 w-full px-4 py-2 text-[13px] text-left"
                >
                  <Folder v-if="file.type === 'directory'" class="size-4 text-amber-400 shrink-0" />
                  <File v-else class="size-4 text-[var(--app-muted)] shrink-0" />
                  <span :class="file.type === 'directory' ? 'text-[var(--app-foreground)] font-medium' : 'text-[var(--app-muted)]'" class="truncate flex-1">{{ file.name }}</span>
                </div>
              </div>
            </Card>
          </div>

          <!-- Empty main column hint (no readme + no files) -->
          <Card v-if="!summary.readme && summary.fileTree.length === 0" class="xl:col-span-2">
            <Empty
              icon="i-lucide-file-text"
              title="Nothing to show yet"
              description="Open the Builder to start adding files."
            />
          </Card>
        </div>

        <!-- Sidebar: metadata + docs -->
        <div class="space-y-5 min-w-0">
          <!-- Stats -->
          <Card v-if="summary.files.count > 0 || summary.git.hasRepo || project.framework">
            <template #header>
              <h4 class="text-sm tracking-[0.08em] uppercase font-normal text-[var(--app-foreground)] leading-tight after:content-['.'] after:text-[var(--app-accent)]">About</h4>
            </template>
            <div class="space-y-3">
              <div v-if="summary.files.count > 0" class="flex items-center justify-between">
                <span class="text-[11px] tracking-[0.08em] uppercase text-[var(--app-muted)]">Files</span>
                <span class="text-sm font-semibold text-[var(--app-foreground)] tabular-nums">{{ summary.files.count }}</span>
              </div>
              <div v-if="summary.git.hasRepo" class="flex items-center justify-between">
                <span class="text-[11px] tracking-[0.08em] uppercase text-[var(--app-muted)]">Branch</span>
                <span class="text-sm text-[var(--app-foreground)] flex items-center gap-1.5 min-w-0">
                  <GitBranch class="size-3.5 text-orange-400 shrink-0" />
                  <span class="truncate">{{ summary.git.branch || 'main' }}</span>
                </span>
              </div>
              <div v-if="project.framework" class="flex items-center justify-between">
                <span class="text-[11px] tracking-[0.08em] uppercase text-[var(--app-muted)]">Framework</span>
                <span class="text-sm text-[var(--app-foreground)] truncate">{{ project.framework }}</span>
              </div>
            </div>
            <div v-if="summary.files.languages.length" class="mt-4 pt-3 border-t border-[var(--app-border)]">
              <div class="text-[11px] tracking-[0.08em] uppercase text-[var(--app-muted)] mb-2">Languages</div>
              <div class="flex flex-wrap gap-1.5">
                <Badge
                  v-for="lang in summary.files.languages.slice(0, 8)"
                  :key="lang.ext"
                  color="neutral"
                  size="xs"
                >
                  {{ getExtLabel(lang.ext) }} · {{ lang.count }}
                </Badge>
              </div>
            </div>
          </Card>

          <!-- Docs -->
          <div v-if="summary.docs.count > 0">
            <h4 class="text-[11px] tracking-[0.12em] uppercase font-medium text-[var(--app-muted)] mb-2 px-1">Docs <span class="text-[var(--app-muted)]/60">· {{ summary.docs.count }}</span></h4>
            <Card>
              <div class="-mx-5 -my-5 divide-y divide-[var(--app-border)]">
                <button
                  v-for="doc in summary.docs.items"
                  :key="doc.title"
                  class="group flex items-center gap-2.5 w-full px-4 py-2.5 text-sm text-left hover:bg-[var(--app-canvas-bg)] transition-colors cursor-pointer"
                  @click="openDoc(doc.title)"
                >
                  <FileText class="size-4 text-violet-400 shrink-0" />
                  <span class="text-[var(--app-foreground)] truncate flex-1">{{ doc.title }}</span>
                  <ChevronRight class="size-3.5 text-[var(--app-muted)] opacity-0 group-hover:opacity-100 transition-opacity shrink-0" />
                </button>
              </div>
            </Card>
          </div>
        </div>
      </div>
    </div>

    <div v-else class="p-6 max-w-3xl mx-auto">
      <Card>
        <Empty
          icon="i-lucide-folder-kanban"
          title="Project not found"
          description="This project may have been removed or the link is wrong."
        />
      </Card>
    </div>

    <ProjectDeployModal
      :project="showDeployModal ? project : null"
      @close="onDeployClose"
    />

    <SpacePublishModal
      :project="showPublishModal ? project : null"
      @close="onPublishClose"
    />

    <!-- Doc preview modal -->
    <Teleport to="body">
      <Transition name="fade">
        <div v-if="previewDoc" class="fixed inset-0 z-50 flex items-center justify-center p-8">
          <div class="absolute inset-0 bg-black/60" @click="previewDoc = null" />
          <div class="relative w-full max-w-3xl max-h-[80vh] rounded-xl border border-[var(--app-border)] bg-[var(--app-background)] shadow-2xl flex flex-col overflow-hidden">
            <div class="flex items-center justify-between px-5 py-3 border-b border-[var(--app-border)] shrink-0">
              <h3 class="text-sm font-semibold text-[var(--app-foreground)]">{{ previewDoc.title }}</h3>
              <button class="text-[var(--app-muted)] hover:text-[var(--app-foreground)] transition-colors" @click="previewDoc = null">
                <X class="size-4" />
              </button>
            </div>
            <div class="flex-1 overflow-auto px-6 py-5">
              <div class="project-prose text-sm leading-relaxed prose prose-sm dark:prose-invert max-w-none"
                v-html="renderMarkdown(previewDoc.content)" />
            </div>
          </div>
        </div>
      </Transition>
    </Teleport>

    <!-- TUI shortcut — only on project detail -->
    <ToolbarSlot name="right">
      <button
        class="rounded-md p-1 text-[var(--app-muted)] hover:text-cyan-400 transition cursor-pointer"
        title="TUI"
        @click="router.push(`/app/projects/${projectRouteKey}/tui`)"
      >
        <TerminalSquare class="size-3.5" />
      </button>
    </ToolbarSlot>
  </div>
</template>

<style scoped>
.fade-enter-active, .fade-leave-active { transition: opacity 0.15s ease; }
.fade-enter-from, .fade-leave-to { opacity: 0; }

.project-prose {
  --tw-prose-body: var(--app-foreground);
  --tw-prose-headings: var(--app-foreground);
  --tw-prose-bold: var(--app-foreground);
  --tw-prose-links: var(--app-accent);
  --tw-prose-code: var(--app-foreground);
}
</style>
