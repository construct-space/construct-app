<script setup lang="ts">
import { useSkills } from '@/composables/useSkills'
import type { SkillInfo } from '@/composables/useSkills'
import { Badge, Button, Card, Empty, Icon, Input, Modal, Switch } from '@construct-space/ui'
import { Loader2, Plus, RefreshCw, Sparkles, Download, Wand2 } from 'lucide-vue-next'
import { useOrgStore } from '@/stores/org'
import { useBrain } from '@/brain'
import { useAIModel } from '@/composables/useAIModel'
import OrgManagedBadge from '@/components/common/OrgManagedBadge.vue'
import { normalizeSkillMarkdown } from '@/lib/skillMarkdown'

const toast = useNotification()
const orgStore = useOrgStore()
const brain = useBrain()
const { defaultModelId } = useAIModel()
const { skills, isLoading, loadSkill, enableSkill, disableSkill, deleteSkill, saveSkill, loadBuiltins, refresh } = useSkills()

const selectedSkill = ref<SkillInfo | null>(null)

// Add skill modal
const showAddModal = ref(false)
const addMode = ref<'paste' | 'url' | 'ai'>('paste')
const newSkillFilename = ref('')
const newSkillContent = ref(`---
name: My Skill
description: What this skill does
category: custom
trigger: keyword1,keyword2
---

Your skill prompt here. This is the instruction text that gets injected when the skill is triggered.
`)
const skillUrl = ref('')
const aiPrompt = ref('')
const isSaving = ref(false)
const isFetching = ref(false)
const isGenerating = ref(false)

// Condensed version of Anthropic's skill-creator guidance
// (anthropics/claude-plugins-official → plugins/skill-creator/skills/skill-creator/SKILL.md).
// We skip the full iterative-eval workflow and focus on the writing rules
// for a single-shot generator.
const SKILL_CREATOR_SYSTEM_PROMPT = `You write Claude Skill files.

A skill is a single markdown file with YAML frontmatter. Output EXACTLY one fenced code block containing the full skill file and nothing else. No commentary before or after.

Frontmatter fields:
- name (required): short kebab-case identifier, e.g. "pr-security-review"
- description (required): the PRIMARY triggering mechanism. State clearly what the skill does AND explicit conditions/phrases that should trigger it. Be a little "pushy" about triggering — models undertrigger skills when descriptions are vague. Include phrases like "Use this skill when the user mentions X, Y, or Z, even if they don't say 'skill' explicitly."
- category (optional): one of builtin, user, project, space, custom
- trigger (optional): pipe- or comma-separated keyword shortlist, e.g. "review|security|audit"
- tools (optional): YAML array of tool names the skill may use
- agents (optional): YAML array of agent ids the skill is scoped to

Body rules:
- Use imperative form ("Read the README", not "You should read")
- Under 500 lines
- Explain *why* steps matter in lieu of heavy-handed MUSTs
- If output format matters, include a concrete template or example
- Keep it general; don't over-specialise to a single example
- Do NOT include scripts, assets, references folders — this is a single-file skill

Example output shape (yours will have different content):

\`\`\`markdown
---
name: commit-message-helper
description: Draft conventional-commit messages from staged diffs. Use this skill whenever the user asks for a commit message, wants to stage changes, or mentions writing commits — even if they say "what should I write" or "summarise these changes".
category: custom
trigger: commit|message|stage
---

Read the staged diff, then draft a Conventional Commit message.

## Steps
1. Run \`git diff --cached\`.
2. Identify the dominant change type (feat, fix, refactor, docs, chore).
3. Pick a scope from the top-level directory touched.
4. Write a subject under 72 characters.

## Format
\`\`\`
<type>(<scope>): <subject>

<body — optional, wrapped at 72 chars>
\`\`\`
\`\`\`

Now generate the skill the user requests.`

function extractSkillMarkdown(raw: string): string {
  // The model should emit one fenced block; pull it out. Accept both
  // \`\`\`markdown and \`\`\` fences.
  const m = raw.match(/```(?:markdown|md)?\s*\n([\s\S]*?)\n```/)
  return (m ? m[1] : raw).trim()
}

function filenameFromSkillContent(md: string, fallback = 'skill.md'): string {
  const m = md.match(/^name:\s*["']?([A-Za-z0-9_.-]+)/m)
  if (!m) return fallback
  const name = m[1].replace(/\s+/g, '-').toLowerCase()
  return name.endsWith('.md') ? name : `${name}.md`
}

// Normalise common GitHub UI URLs to the raw content URL so a pasted
// https://github.com/owner/repo/blob/main/path/to/skill.md Just Works.
function normalizeSkillUrl(input: string): string {
  const u = input.trim()
  if (!u) return u
  // github.com/owner/repo/blob/<ref>/path → raw.githubusercontent.com
  const m = u.match(/^https?:\/\/github\.com\/([^/]+)\/([^/]+)\/blob\/([^/]+)\/(.+)$/)
  if (m) return `https://raw.githubusercontent.com/${m[1]}/${m[2]}/${m[3]}/${m[4]}`
  return u
}

function filenameFromUrl(input: string): string {
  try {
    const url = new URL(input)
    const last = url.pathname.split('/').filter(Boolean).pop() || 'skill.md'
    return last.endsWith('.md') ? last : `${last}.md`
  } catch {
    return 'skill.md'
  }
}

async function handleSaveSkill() {
  console.info('[SkillsSettings] save skill requested', {
    filename: newSkillFilename.value,
    contentLength: newSkillContent.value.length,
  })
  if (!newSkillFilename.value.trim() || !newSkillContent.value.trim()) {
    toast.add({ title: 'Filename and content are required', color: 'warning' })
    return
  }
  isSaving.value = true
  try {
    const normalizedContent = normalizeSkillMarkdown(newSkillContent.value)
    if (normalizedContent !== newSkillContent.value) {
      console.info('[SkillsSettings] normalized skill frontmatter before save')
      newSkillContent.value = normalizedContent
    }
    const result = await saveSkill(newSkillFilename.value, normalizedContent)
    console.info('[SkillsSettings] save skill result', { result })
    if (result) {
      toast.add({ title: `Skill "${result.name}" saved`, color: 'success' })
      showAddModal.value = false
      newSkillFilename.value = ''
    } else {
      toast.add({ title: 'Failed to save skill', color: 'error' })
    }
  } catch (e) {
    console.error('[SkillsSettings] save skill failed', {
      error: e,
      frontmatterPreview: newSkillContent.value.split('---')[1]?.trim().slice(0, 500),
    })
    toast.add({ title: String(e), color: 'error' })
  } finally {
    isSaving.value = false
  }
}

async function handleGenerate() {
  const prompt = aiPrompt.value.trim()
  console.info('[SkillsSettings] generate skill requested', {
    promptLength: prompt.length,
    defaultModelId: defaultModelId.value,
  })
  if (!prompt) {
    toast.add({ title: 'Describe what the skill should do', color: 'warning' })
    return
  }
  isGenerating.value = true
  try {
    console.info('[SkillsSettings] connecting operator for skill generation')
    const connected = await brain.connect()
    console.info('[SkillsSettings] operator connection result for skill generation', { connected })
    if (!connected) {
      toast.add({ title: 'Agent is disconnected — could not connect to Operator', color: 'error' })
      return
    }
    // Extract just the model id from the composite "connector:model" form
    // so dispatch resolves against whichever provider is currently active.
    const model = defaultModelId.value?.includes(':')
      ? defaultModelId.value.split(':').slice(1).join(':')
      : defaultModelId.value || undefined
    const task = `${SKILL_CREATOR_SYSTEM_PROMPT}\n\n---\n\nUser request:\n${prompt}`
    console.info('[SkillsSettings] dispatching skill generator agent', {
      agentId: 'ask',
      model,
      taskLength: task.length,
    })
    const startedAt = performance.now()
    const result = await brain.dispatch('ask', task, model, { timeout: 120_000 })
    console.info('[SkillsSettings] skill generator dispatch completed', {
      durationMs: Math.round(performance.now() - startedAt),
      contentLength: result?.content?.length || 0,
      stopReason: result?.stop_reason,
    })
    const content = normalizeSkillMarkdown(extractSkillMarkdown(result?.content || ''))
    if (!content || !/^---/.test(content)) {
      console.warn('[SkillsSettings] skill generator returned unusable content', {
        contentLength: content.length,
        preview: content.slice(0, 120),
      })
      toast.add({ title: 'Generator returned no usable skill. Try again or refine the description.', color: 'error' })
      return
    }
    newSkillContent.value = content
    newSkillFilename.value = filenameFromSkillContent(content)
    addMode.value = 'paste'
    toast.add({ title: 'Skill generated — review and save', color: 'success' })
  } catch (e) {
    console.error('[SkillsSettings] skill generation failed', e)
    toast.add({ title: `Generation failed: ${e}`, color: 'error' })
  } finally {
    isGenerating.value = false
  }
}

async function handleInstallFromUrl() {
  const raw = skillUrl.value.trim()
  if (!raw) {
    toast.add({ title: 'Paste a URL to a skill .md file', color: 'warning' })
    return
  }
  const normalized = normalizeSkillUrl(raw)
  isFetching.value = true
  try {
    const res = await fetch(normalized)
    if (!res.ok) {
      toast.add({ title: `Fetch failed: ${res.status} ${res.statusText}`, color: 'error' })
      return
    }
    const content = normalizeSkillMarkdown(await res.text())
    if (!/^---/.test(content.trimStart())) {
      toast.add({ title: 'Response does not look like a skill markdown file (no YAML frontmatter).', color: 'warning' })
    }
    const filename = filenameFromUrl(normalized)
    const result = await saveSkill(filename, content)
    if (result) {
      toast.add({ title: `Skill "${result.name}" installed`, color: 'success' })
      showAddModal.value = false
      skillUrl.value = ''
    } else {
      toast.add({ title: 'Failed to install skill', color: 'error' })
    }
  } catch (e) {
    toast.add({ title: `Install failed: ${e}`, color: 'error' })
  } finally {
    isFetching.value = false
  }
}

async function handleDeleteSkill(skill: SkillInfo) {
  try {
    const success = await deleteSkill(skill.id)
    if (success) {
      toast.add({ title: `${skill.name} deleted`, color: 'success' })
      selectedSkill.value = null
    } else {
      toast.add({ title: 'Cannot delete — only user skills can be removed', color: 'warning' })
    }
  } catch (e) {
    toast.add({ title: String(e), color: 'error' })
  }
}

// Group skills by category source
const skillCategories = computed(() => {
  const groups: Record<string, SkillInfo[]> = {
    builtin: [],
    space: [],
    user: [],
    community: [],
  }
  for (const skill of skills.value) {
    const cat = skill.category?.toLowerCase() || 'user'
    if (cat === 'builtin' || cat === 'core') groups.builtin.push(skill)
    else if (cat === 'space') groups.space.push(skill)
    else if (cat === 'community') groups.community.push(skill)
    else groups.user.push(skill)
  }
  return groups
})

const categoryLabels: Record<string, string> = {
  builtin: 'Built-in',
  space: 'Space',
  user: 'User',
  community: 'Community',
}

const categoryIcons: Record<string, string> = {
  builtin: 'i-lucide-box',
  space: 'i-lucide-layout-grid',
  user: 'i-lucide-user',
  community: 'i-lucide-globe',
}

async function toggleSkill(skill: SkillInfo) {
  try {
    if (skill.state === 'active') {
      await disableSkill(skill.id)
      toast.add({ title: `${skill.name} disabled`, color: 'warning' })
    } else if (skill.state === 'disabled' || skill.state === 'unloaded') {
      if (skill.state === 'unloaded') await loadSkill(skill.id)
      await enableSkill(skill.id)
      toast.add({ title: `${skill.name} enabled`, color: 'success' })
    }
  } catch (e) {
    toast.add({ title: String(e), color: 'error' })
  }
}

async function handleLoadBuiltins() {
  try {
    const success = await loadBuiltins()
    if (success) {
      await new Promise(resolve => setTimeout(resolve, 500))
      await refresh()
      toast.add({ title: 'Built-in skills loaded', color: 'success' })
    } else {
      toast.add({ title: 'Could not load skills', color: 'warning' })
    }
  } catch {
    toast.add({ title: 'Connection lost - please restart the app', color: 'error' })
  }
}

onMounted(() => { refresh() })
</script>

<template>
  <div>
    <!-- Org-managed banner -->
    <div v-if="orgStore.isEnabled"
      class="mb-4 flex items-center gap-2 px-3 py-2 rounded-lg bg-amber-500/5 border border-amber-500/20">
      <OrgManagedBadge :org-name="orgStore.orgName" />
      <span class="text-xs text-[var(--app-muted)]">Skills may be managed by your organization.</span>
    </div>

    <!-- Intro -->
    <Card variant="muted" class="mb-4">
      <template #header>
        <div class="flex items-start gap-3 min-w-0 flex-1">
          <Sparkles class="size-5 text-[var(--app-muted)] mt-0.5 shrink-0" />
          <div class="min-w-0 flex-1">
            <h3
              class="text-sm tracking-[0.08em] uppercase font-normal text-[var(--app-foreground)] leading-tight after:content-['.'] after:text-[var(--app-accent)]">
              Skills
</h3>
            <p class="text-sm text-[var(--app-muted)] mt-0.5">
Prompt packs that add instructions, tools, and hooks when
              triggered.
</p>
          </div>
        </div>
        <div class="flex items-center gap-2 shrink-0">
          <Button variant="ghost" color="neutral" size="xs" :loading="isLoading" @click="refresh">
            <template #leading>
              <RefreshCw class="size-3.5" />
            </template>
          </Button>
          <Button variant="ghost" size="xs" label="Load builtins" @click="handleLoadBuiltins">
            <template #leading>
              <Download class="size-3.5" />
            </template>
          </Button>
          <Button size="xs" label="Add skill" @click="showAddModal = true">
            <template #leading>
              <Plus class="size-3.5" />
            </template>
          </Button>
        </div>
      </template>
    </Card>

    <!-- Loading -->
    <div v-if="isLoading && !skills.length" class="flex items-center justify-center py-12">
      <Loader2 class="size-5 animate-spin text-[var(--app-muted)]" />
    </div>

    <template v-else>
      <Card v-if="skills.length === 0">
        <Empty icon="i-lucide-sparkles" title="No skills loaded"
          description="Load the built-in skill pack or add your own to extend assistant capabilities.">
          <Button size="sm" label="Load built-in skills" @click="handleLoadBuiltins">
            <template #leading>
              <Download class="size-3.5" />
            </template>
          </Button>
        </Empty>
      </Card>

      <div v-else class="space-y-6">
        <!-- Grouped skills by category -->
        <template v-for="(groupSkills, groupKey) in skillCategories" :key="groupKey">
          <div v-if="groupSkills.length > 0">
            <h3
              class="text-[11px] tracking-[0.12em] uppercase font-medium text-[var(--app-muted)] mb-2 flex items-center gap-2">
              <Icon :name="categoryIcons[groupKey] || 'i-lucide-box'" class="size-3.5" />
              {{ categoryLabels[groupKey] || groupKey }}
              <span class="text-[10px] font-normal normal-case tracking-normal">({{ groupSkills.length }})</span>
            </h3>
            <div class="space-y-3">
              <Card v-for="skill in groupSkills" :key="skill.id" interactive
                :class="skill.state === 'active' ? '' : 'opacity-60'"
                @click="selectedSkill = selectedSkill?.id === skill.id ? null : skill">
                <template #header>
                  <div class="min-w-0 flex-1">
                    <div class="flex items-center gap-2 flex-wrap">
                      <h4
                        class="text-sm tracking-[0.08em] uppercase font-normal text-[var(--app-foreground)] leading-tight after:content-['.'] after:text-[var(--app-accent)]">
                        {{ skill.name }}
</h4>
                      <span class="text-[10px] text-[var(--app-muted)] font-mono">v{{ skill.version }}</span>
                      <Badge :color="skill.state === 'active' ? 'success'
                        : skill.state === 'error' ? 'error'
                          : skill.state === 'loading' ? 'info'
                            : skill.state === 'disabled' ? 'warning'
                              : 'neutral'" size="xs">
                        {{ skill.state }}
                      </Badge>
                      <!-- Skills the agent wrote for itself (skill_manage). -->
                      <Badge v-if="skill.source === 'agent'" color="info" size="xs" title="Created by the agent from experience">
                        agent-created
                      </Badge>
                    </div>
                    <p class="text-xs text-[var(--app-muted)] mt-1 line-clamp-2">{{ skill.description }}</p>
                  </div>
                  <div class="shrink-0" @click.stop>
                    <Switch :model-value="skill.state === 'active'" size="sm"
                      @update:model-value="toggleSkill(skill)" />
                  </div>
                </template>

                <div class="flex items-center gap-3 text-xs text-[var(--app-muted)] flex-wrap">
                  <span>{{ skill.hooksCount }} hooks</span>
                  <span>{{ skill.toolsCount }} tools</span>
                  <span v-if="(skill as any).trigger"
                    class="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-sm bg-[color-mix(in_srgb,var(--app-muted)_10%,transparent)]">
                    <Icon name="i-lucide-zap" class="size-3" />
                    {{ (skill as any).trigger }}
                  </span>
                  <span v-if="(skill as any).agents?.length"
                    class="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-sm bg-[color-mix(in_srgb,var(--app-accent)_8%,transparent)] text-[var(--app-accent)]/70">
                    <Icon name="i-lucide-bot" class="size-3" />
                    {{ (skill as any).agents.join(', ') }}
                  </span>
                </div>

                <!-- Detail panel (expanded) -->
                <div v-if="selectedSkill?.id === skill.id" class="mt-3 pt-3 border-t border-[var(--app-border)]">
                  <div class="grid grid-cols-2 gap-3 text-xs">
                    <div>
                      <span class="text-[var(--app-muted)]">Category:</span>
                      <span class="text-[var(--app-foreground)]"> {{ skill.category }}</span>
                    </div>
                    <div>
                      <span class="text-[var(--app-muted)]">Hooks:</span>
                      <span class="text-[var(--app-foreground)]"> {{ skill.hooksCount }}</span>
                    </div>
                    <div>
                      <span class="text-[var(--app-muted)]">Tools:</span>
                      <span class="text-[var(--app-foreground)]"> {{ skill.toolsCount }}</span>
                    </div>
                    <div v-if="skill.dependencies?.length">
                      <span class="text-[var(--app-muted)]">Deps:</span>
                      <span class="text-[var(--app-foreground)]"> {{ skill.dependencies.join(', ') }}</span>
                    </div>
                    <div v-if="(skill as any).trigger">
                      <span class="text-[var(--app-muted)]">Trigger:</span>
                      <span class="text-[var(--app-foreground)]"> {{ (skill as any).trigger }}</span>
                    </div>
                    <div v-if="(skill as any).agents?.length">
                      <span class="text-[var(--app-muted)]">Agents:</span>
                      <span class="text-[var(--app-foreground)]"> {{ (skill as any).agents.join(', ') }}</span>
                    </div>
                  </div>
                </div>

                <template v-if="selectedSkill?.id === skill.id" #footer-end>
                  <Button variant="ghost" color="error" size="xs" label="Delete skill"
                    @click.stop="handleDeleteSkill(skill)" />
                </template>
              </Card>
            </div>
          </div>
        </template>
      </div>
    </template>

    <!-- Add Skill Modal -->
    <Modal :open="showAddModal" title="Add Skill" @close="showAddModal = false">
      <div class="space-y-4">
        <!-- Mode toggle -->
        <div class="flex gap-2 flex-wrap">
          <button v-for="m in (['paste', 'url', 'ai'] as const)" :key="m"
            class="px-3 py-1.5 text-xs rounded-sm border transition-colors cursor-pointer inline-flex items-center gap-1.5"
            :class="addMode === m
              ? 'border-[var(--app-accent)] bg-[color-mix(in_srgb,var(--app-accent)_10%,transparent)] text-[var(--app-accent)]'
              : 'border-[var(--app-border)] text-[var(--app-muted)] hover:text-[var(--app-foreground)]'"
            @click="addMode = m">
            <Wand2 v-if="m === 'ai'" class="size-3" />
            {{ m === 'paste' ? 'Paste content' : m === 'url' ? 'From URL' : 'Generate with AI' }}
          </button>
        </div>

        <!-- Paste mode -->
        <template v-if="addMode === 'paste'">
          <div>
            <label class="block text-xs font-medium text-[var(--app-muted)] mb-1">Filename</label>
            <Input v-model="newSkillFilename" placeholder="my-skill.md" />
          </div>
          <div>
            <label class="block text-xs font-medium text-[var(--app-muted)] mb-1">Skill content (markdown with YAML
              frontmatter)</label>
            <textarea v-model="newSkillContent" rows="14"
              class="w-full rounded-sm border border-[var(--app-border)] bg-[var(--app-background)] text-[var(--app-foreground)] text-sm font-mono p-3 focus:outline-none focus:ring-1 focus:ring-[var(--app-accent)] resize-y"
              placeholder="---&#10;name: My Skill&#10;description: What it does&#10;category: custom&#10;trigger: keyword&#10;---&#10;&#10;Prompt text here..." />
          </div>
        </template>

        <!-- URL mode -->
        <template v-else-if="addMode === 'url'">
          <div>
            <label class="block text-xs font-medium text-[var(--app-muted)] mb-1">Skill URL</label>
            <Input v-model="skillUrl" placeholder="https://github.com/owner/repo/blob/main/path/skill.md" />
            <p class="text-xs text-[var(--app-muted)] mt-1">
              GitHub <code class="font-mono">/blob/</code> URLs are auto-converted to raw. Other origins must serve CORS
              for <code class="font-mono">GET</code>.
            </p>
          </div>
        </template>

        <!-- AI generator -->
        <template v-else>
          <div>
            <label class="block text-xs font-medium text-[var(--app-muted)] mb-1">Describe the skill</label>
            <textarea v-model="aiPrompt" rows="6"
              class="w-full rounded-sm border border-[var(--app-border)] bg-[var(--app-background)] text-[var(--app-foreground)] text-sm p-3 focus:outline-none focus:ring-1 focus:ring-[var(--app-accent)] resize-y"
              placeholder="e.g. A skill that reviews PRs for security issues — reads the diff, flags secrets, unsafe deserialisation, SSRF patterns." />
            <p class="text-xs text-[var(--app-muted)] mt-1">
              Generates a complete <code class="font-mono">SKILL.md</code> with frontmatter and body. You'll review the
              output before saving.
            </p>
            <p v-if="defaultModelId" class="text-[10px] tracking-[0.08em] uppercase text-[var(--app-muted)] mt-1">
              Model · <strong class="text-[var(--app-foreground)]">{{ defaultModelId }}</strong>
            </p>
            <p v-else class="text-xs text-amber-500 mt-1">
              No default model set. Pick one in Settings → LLMs first.
            </p>
          </div>
        </template>

        <div class="flex justify-end gap-2">
          <Button variant="soft" label="Cancel" @click="showAddModal = false" />
          <Button v-if="addMode === 'paste'" label="Save skill" :loading="isSaving" @click="handleSaveSkill" />
          <Button v-else-if="addMode === 'url'" label="Install from URL" :loading="isFetching"
            :disabled="!skillUrl.trim()" @click="handleInstallFromUrl" />
          <Button v-else label="Generate" :loading="isGenerating" :disabled="!aiPrompt.trim() || !defaultModelId"
            @click="handleGenerate">
            <template #leading>
              <Wand2 class="size-3.5" />
            </template>
          </Button>
        </div>
      </div>
    </Modal>
  </div>
</template>
