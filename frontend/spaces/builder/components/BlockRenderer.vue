<script setup lang="ts">
/**
 * BlockRenderer — renders one assistant turn's mixed content.
 *
 * A turn is a blend of:
 *  - text content (streaming or final)
 *  - tool calls (running / done / error)
 *  - thinking blocks (model reasoning)
 *
 * We keep this intentionally simpler than coder's system. The goal is to
 * surface what the agent is doing without the user hunting through logs.
 */
import { computed, ref } from 'vue'
import { Loader2, Check, X, ChevronDown, ChevronUp, Brain, Wrench, ArrowRight, HelpCircle, Search } from 'lucide-vue-next'
import { useMarkdown } from '@/composables/useMarkdown'
import SpacePlanBlock from './SpacePlanBlock.vue'
import QuestionBlock from '@/components/agent/QuestionBlock.vue'
import type { QuestionBlock as QuestionBlockData } from '@/assistant'

const { renderMarkdown } = useMarkdown()

defineOptions({ name: 'BlockRenderer' })

export interface ToolCallBlock {
  type: 'tool'
  callId: string
  tool: string
  title: string
  input?: string
  result?: string
  isError?: boolean
  state: 'running' | 'done' | 'error'
}

export interface ThinkingBlock {
  type: 'thinking'
  text: string
}

export interface TextBlock {
  type: 'text'
  text: string
}

export interface PlanBlock {
  type: 'plan'
  title: string
  summary: string
  decisions: Array<{ label: string; value: string }>
  docs: Array<{ path: string; title: string; persisted?: boolean }>
  nextActions: Array<{ id: string; label: string }>
}

// Wrap the shared QuestionBlock payload so it fits the Block union. The
// `question` field carries the full shared-shape data and is handed to the
// shared `<QuestionBlock>` component (from components/agent/) unchanged.
export interface QuestionsBlock {
  type: 'questions'
  question: QuestionBlockData
}

// Emitted when the agent detects an out-of-scope request and wants the user
// to switch to a different space. The target is one of "builder" or
// "space-developer" — the BuilderPage handler navigates with the user's
// original prompt carried via `?q=`.
export interface HandoffBlock {
  type: 'handoff'
  target: 'builder' | 'space-developer' | string
  label: string
}

export interface AgentBlock {
  type: 'agent'
  callId: string
  agentId: string
  agentName?: string
  source?: string
  task?: string
  title: string
  result?: string
  isError?: boolean
  state: 'running' | 'done' | 'error'
  children: Block[]
}

export type Block = ToolCallBlock | ThinkingBlock | TextBlock | PlanBlock | QuestionsBlock | HandoffBlock | AgentBlock

const props = defineProps<{
  blocks: Block[]
  streaming: boolean
  /**
   * Human-readable label shown in the live indicator at the bottom of the
   * turn when the agent is actively working. Parent should derive this from
   * useStreamStatus (e.g. "running list_dir…") so the UI reflects actual
   * activity rather than a permanent "thinking…".
   */
  statusText?: string
  /**
   * Suppress text blocks whose content is an architect.v1 JSON envelope
   * (or looks like one — starts with `{"` or contains the version marker).
   * Used in PLAN mode so the user sees a "building plan…" loader instead
   * of raw streaming JSON while the envelope accumulates.
   */
  hideJsonText?: boolean
  /**
   * Nested agent activity should open tool details immediately once the
   * parent Explore block is expanded. Top-level tool blocks remain collapsed.
   */
  defaultOpenTools?: boolean
}>()

const emit = defineEmits<{
  'plan-action': [action: { id: string; label: string }]
  'plan-open-doc': [doc: { path: string; title: string }]
  'question-answer': [questionId: string, answer: string | string[]]
  'question-update': [block: QuestionBlockData]
  'handoff': [target: string]
}>()

// A render-only grouping of consecutive tool calls into a single collapsible
// block (Claude-Code style), so a long run of tools reads as one line instead
// of a wall of cards. Not produced by the stream handler — derived here.
interface ToolGroupBlock {
  type: 'toolgroup'
  id: string
  tools: ToolCallBlock[]
}
type RenderBlock = Block | ToolGroupBlock

const thinkingOpen = ref(new Set<number>())
const toolOpen = ref(new Set<string>())
const agentOpen = ref(new Set<string>())
const groupOpen = ref(new Set<string>())

function toggleThinking(idx: number) {
  if (thinkingOpen.value.has(idx)) thinkingOpen.value.delete(idx)
  else thinkingOpen.value.add(idx)
  thinkingOpen.value = new Set(thinkingOpen.value)
}

function toggleTool(id: string) {
  if (toolOpen.value.has(id)) toolOpen.value.delete(id)
  else toolOpen.value.add(id)
  toolOpen.value = new Set(toolOpen.value)
}

function toggleAgent(id: string) {
  if (agentOpen.value.has(id)) agentOpen.value.delete(id)
  else agentOpen.value.add(id)
  agentOpen.value = new Set(agentOpen.value)
}

function isToolOpen(id: string): boolean {
  return !!props.defaultOpenTools || toolOpen.value.has(id)
}

function shortArg(input?: string): string {
  if (!input) return ''
  const s = input.trim()
  if (s.length <= 60) return s
  return s.slice(0, 57) + '…'
}

// Render-time unwrap of the pi-shape `call_tool` dispatcher → the real tool.
// The stream handler also unwraps (subagentBlocks), but blocks streamed before
// that landed (or persisted in an old thread) still carry tool:"call_tool", so
// we unwrap here too for display.
function effectiveTool(block: ToolCallBlock): string {
  if (block.tool === 'call_tool' || block.tool === 'call') {
    try {
      const p = JSON.parse(block.input || '{}') as { name?: string; tool?: string }
      if (p.name || p.tool) return (p.name || p.tool) as string
    } catch { /* fall through */ }
  }
  return block.tool
}

// Claude-Code-style display name: bash → Bash, task_update → Task update.
function toolLabel(tool: string): string {
  const s = tool.replace(/_/g, ' ')
  return s.charAt(0).toUpperCase() + s.slice(1)
}

// The one meaningful argument to show inline as `Tool(arg)`. Picks the field
// that matters per tool (command / path / pattern / …) and drops noise like
// timeout_ms; falls back to compact JSON. Unwraps call_tool args first.
function toolArg(block: ToolCallBlock): string {
  let raw = block.input?.trim()
  if (!raw) return ''
  if (block.tool === 'call_tool' || block.tool === 'call') {
    try {
      const w = JSON.parse(raw) as { args?: unknown; arguments?: unknown }
      const inner = w.args ?? w.arguments
      if (inner !== undefined) raw = typeof inner === 'string' ? inner : JSON.stringify(inner)
    } catch { /* keep raw */ }
  }
  try {
    const p = JSON.parse(raw) as Record<string, unknown>
    const pick = p.command ?? p.path ?? p.file_path ?? p.filePath ?? p.pattern ?? p.query ?? p.url ?? p.name
    if (typeof pick === 'string') return pick
    if (p.id != null && p.status != null) return `#${p.id} → ${p.status}`
    if (pick != null) return String(pick)
    return raw
  } catch {
    return raw
  }
}

function groupState(g: ToolGroupBlock): 'running' | 'error' | 'done' {
  if (g.tools.some(t => t.state === 'running')) return 'running'
  if (g.tools.some(t => t.isError)) return 'error'
  return 'done'
}

// The tool currently running (for the collapsed header label).
function groupActiveTool(g: ToolGroupBlock): ToolCallBlock | undefined {
  return g.tools.find(t => t.state === 'running')
}

function activeToolLabel(g: ToolGroupBlock): string {
  const t = groupActiveTool(g)
  return t ? toolLabel(effectiveTool(t)) : 'tool'
}

function toggleGroup(id: string) {
  if (groupOpen.value.has(id)) groupOpen.value.delete(id)
  else groupOpen.value.add(id)
  groupOpen.value = new Set(groupOpen.value)
}

function isGroupOpen(g: ToolGroupBlock): boolean {
  return !!props.defaultOpenTools || groupOpen.value.has(g.id)
}

function agentLabel(block: AgentBlock): string {
  return block.title || `Explore(${block.agentId})`
}

// Pull the `question` field out of the ask_user tool input JSON. The tool
// input is always `{"question": "..."}` — if parsing fails (stream not yet
// complete), fall back to the raw string so the user still sees something.
function askQuestionText(input?: string): string {
  if (!input) return ''
  try {
    const parsed = JSON.parse(input) as { question?: string }
    return parsed.question || input
  } catch {
    return input
  }
}

// Regex sniff for in-progress architect.v1 envelopes. Matches the common
// streaming pattern — the opening `{` plus the version marker somewhere in
// the first chunk of text. Used to hide raw streaming JSON in PLAN mode.
const ARCHITECT_ENVELOPE_RE = /^\s*\{[\s\S]*architect\.v1/

// Collapse consecutive same-kind blocks into one. Anthropic's thinking
// stream can produce many small thinking segments back-to-back; showing 14
// cards is noise. Merging here (rather than in the handler) is reliable —
// even if the producer pushes separate blocks, the UI shows them as one.
const groupedBlocks = computed<RenderBlock[]>(() => {
  const out: RenderBlock[] = []
  for (const b of props.blocks) {
    // PLAN mode: drop text blocks that are (or will be) a JSON envelope.
    // The parent promotes them to a plan/question card on completion; in
    // the meantime we show a loading pill at the bottom instead of the
    // raw JSON bleeding across the chat.
    if (b.type === 'text' && props.hideJsonText && ARCHITECT_ENVELOPE_RE.test(b.text)) {
      continue
    }
    // Coalesce consecutive tool calls into one collapsible group. ask_user is
    // excluded — it renders as its own question card, not a tool row.
    if (b.type === 'tool' && b.tool !== 'ask_user') {
      const prev = out[out.length - 1]
      if (prev && prev.type === 'toolgroup') {
        prev.tools.push(b)
      } else {
        out.push({ type: 'toolgroup', id: b.callId, tools: [b] })
      }
      continue
    }
    const prev = out[out.length - 1]
    if (prev && prev.type === b.type && (b.type === 'thinking' || b.type === 'text')) {
      // Only merge thinking/text; each tool keeps its own row inside the group.
      if (b.type === 'thinking' && prev.type === 'thinking') prev.text += b.text
      else if (b.type === 'text' && prev.type === 'text') prev.text += b.text
      continue
    }
    // Shallow-copy so mutating `out[...].text` doesn't reach into props.blocks.
    out.push({ ...b } as RenderBlock)
  }
  return out
})

const hasAnyContent = computed(() => groupedBlocks.value.some(b => {
  if (b.type === 'text') return b.text.trim().length > 0
  return true // tool / thinking / plan / toolgroup always count
}))
</script>

<template>
  <div
    v-if="hasAnyContent || streaming"
    class="space-y-2 text-sm"
  >
    <template v-for="(block, idx) in groupedBlocks" :key="`b-${idx}`">
      <!-- handoff — agent detected an out-of-scope request and wants the
           user to switch to a different space (e.g. builder → space-developer
           for Construct Spaces). Parent navigates with the user's last prompt
           carried via ?q=. -->
      <div
        v-if="block.type === 'handoff'"
        class="rounded-md p-3 flex items-center gap-3"
        style="background: color-mix(in srgb, var(--app-accent) 8%, transparent); border: 1px solid color-mix(in srgb, var(--app-accent) 30%, transparent)"
      >
        <ArrowRight :size="14" style="color: var(--app-accent)" />
        <span class="text-xs flex-1" style="color: var(--app-foreground)">
          This looks like a job for <strong>{{ block.label }}</strong>.
        </span>
        <button
          type="button"
          class="px-3 py-1 text-[11px] font-semibold rounded-md transition"
          style="background: var(--app-accent); color: var(--app-accent-foreground)"
          @click="emit('handoff', block.target)"
        >
          Switch to {{ block.label }}
        </button>
      </div>

      <!-- structured question card (architect.v1 `questions` envelope —
           agent asks for a choice before committing to a plan). Uses the
           shared QuestionBlock so the style matches the rest of the app. -->
      <QuestionBlock
        v-else-if="block.type === 'questions'"
        :block="block.question"
        @answer="(id, answer) => emit('question-answer', id, answer)"
        @update:block="emit('question-update', $event)"
      />

      <!-- structured plan card (rendered when the agent returns an
           architect.v1 `plan` envelope in PLAN mode) -->
      <SpacePlanBlock
        v-else-if="block.type === 'plan'"
        :title="block.title"
        :summary="block.summary"
        :decisions="block.decisions"
        :docs="block.docs"
        :next-actions="block.nextActions"
        @action="emit('plan-action', $event)"
        @open-doc="emit('plan-open-doc', $event)"
      />

      <!-- text (markdown-rendered so tables, code fences, lists render) -->
      <div
        v-else-if="block.type === 'text' && block.text.trim().length > 0"
        class="spacedev-md text-sm leading-relaxed"
        style="color: var(--app-foreground)"
        v-html="renderMarkdown(block.text)"
      />

      <!-- thinking (collapsible) -->
      <div
        v-else-if="block.type === 'thinking'"
        class="rounded-md px-3 py-2 text-xs"
        style="background: color-mix(in srgb, var(--app-muted) 8%, transparent); border: 1px solid var(--app-border); color: var(--app-muted)"
      >
        <button
          type="button"
          class="w-full flex items-center gap-2 text-left"
          @click="toggleThinking(idx)"
        >
          <Brain :size="12" />
          <span class="flex-1 italic">
            thinking ({{ block.text.length }} chars)
          </span>
          <ChevronUp v-if="thinkingOpen.has(idx)" :size="12" />
          <ChevronDown v-else :size="12" />
        </button>
        <p
          v-if="thinkingOpen.has(idx)"
          class="mt-2 pt-2 border-t whitespace-pre-wrap"
          style="border-color: var(--app-border)"
        >
          {{ block.text }}
        </p>
      </div>

      <!-- subagent exploration — spawn_agent runs synchronously, but child
           stream events are nested here so broad discovery doesn't flood the
           parent turn. -->
      <div
        v-else-if="block.type === 'agent'"
        class="rounded-md text-xs"
        style="border: 1px solid color-mix(in srgb, var(--app-accent) 25%, var(--app-border)); background: color-mix(in srgb, var(--app-accent) 4%, var(--app-surface))"
      >
        <button
          type="button"
          class="w-full flex items-center gap-2 px-2 py-1.5 text-left"
          data-test="agent-block-toggle"
          @click="toggleAgent(block.callId)"
        >
          <Loader2
            v-if="block.state === 'running'"
            :size="12"
            class="animate-spin"
            style="color: var(--app-accent)"
          />
          <Check
            v-else-if="block.state === 'done'"
            :size="12"
            style="color: var(--app-accent)"
          />
          <X
            v-else
            :size="12"
            style="color: rgb(239, 68, 68)"
          />
          <Search :size="11" style="color: var(--app-muted); opacity: 0.75" />
          <span class="font-semibold" style="color: var(--app-accent)">
            {{ agentLabel(block) }}
          </span>
          <span
            v-if="block.task"
            class="truncate flex-1 text-left"
            style="color: var(--app-muted)"
          >
            {{ block.task }}
          </span>
          <span v-else class="flex-1" />
          <ChevronUp v-if="agentOpen.has(block.callId)" :size="10" style="color: var(--app-muted)" />
          <ChevronDown v-else :size="10" style="color: var(--app-muted)" />
        </button>
        <div
          v-if="agentOpen.has(block.callId)"
          class="px-2 pb-2 pt-0 space-y-2"
        >
          <div
            v-if="block.task"
            class="rounded px-2 py-1.5 whitespace-pre-wrap"
            style="background: color-mix(in srgb, var(--app-muted) 8%, transparent); color: var(--app-muted)"
          >
            {{ block.task }}
          </div>
          <BlockRenderer
            v-if="block.children.length"
            :blocks="block.children"
            :streaming="block.state === 'running'"
            :status-text="block.state === 'running' ? 'exploring…' : ''"
            :hide-json-text="hideJsonText"
            default-open-tools
            @plan-action="emit('plan-action', $event)"
            @plan-open-doc="emit('plan-open-doc', $event)"
            @question-answer="(id, answer) => emit('question-answer', id, answer)"
            @question-update="emit('question-update', $event)"
            @handoff="emit('handoff', $event)"
          />
          <div
            v-if="block.result"
            class="rounded px-2 py-1.5 whitespace-pre-wrap max-h-60 overflow-y-auto"
            :style="block.isError
              ? 'background: rgba(239, 68, 68, 0.08); color: rgb(239, 68, 68)'
              : 'background: color-mix(in srgb, var(--app-accent) 6%, transparent); color: var(--app-foreground); opacity: 0.85'"
          >
            {{ block.result }}
          </div>
        </div>
      </div>

      <!-- ask_user — the agent asked the user a question via the ask_user
           tool. Render as a clean question card (not as a JSON tool blob):
           the question text is what the user cares about, the tool call
           underneath is implementation detail. -->
      <div
        v-else-if="block.type === 'tool' && block.tool === 'ask_user'"
        class="rounded-lg p-3 space-y-1.5"
        style="background: color-mix(in srgb, var(--app-accent) 8%, transparent); border: 1px solid color-mix(in srgb, var(--app-accent) 25%, transparent)"
      >
        <div class="flex items-center gap-2 text-[11px] font-semibold tracking-wider uppercase" style="color: var(--app-accent)">
          <HelpCircle :size="12" />
          <span>Question</span>
          <span class="flex-1" />
          <span
            v-if="block.state === 'running'"
            class="inline-flex items-center gap-1 text-[10px] font-normal normal-case tracking-normal"
            style="color: var(--app-muted)"
          >
            <Loader2 :size="10" class="animate-spin" />
            waiting for your reply…
          </span>
        </div>
        <div
          class="text-sm leading-relaxed whitespace-pre-wrap"
          style="color: var(--app-foreground)"
        >
{{ askQuestionText(block.input) }}
</div>
      </div>

      <!-- tool group — consecutive tool calls collapsed into one expandable.
           Collapsed: a single status line ("Running Bash…" / "5 tools").
           Expanded: each call as a Claude-Code-style `Tool(arg)` row that can
           itself expand to show full input + result. -->
      <div
        v-else-if="block.type === 'toolgroup'"
        class="rounded-md text-xs font-mono overflow-hidden"
        style="border: 1px solid var(--app-border); background: var(--app-surface)"
      >
        <button
          type="button"
          class="w-full flex items-center gap-2 px-2.5 py-1.5 text-left transition-colors hover:bg-[color-mix(in_srgb,var(--app-foreground)_3%,transparent)]"
          @click="toggleGroup(block.id)"
        >
          <Loader2 v-if="groupState(block) === 'running'" :size="12" class="animate-spin" style="color: var(--app-accent)" />
          <Check v-else-if="groupState(block) === 'done'" :size="12" style="color: var(--app-accent)" />
          <X v-else :size="12" style="color: rgb(239, 68, 68)" />
          <Wrench :size="10" style="color: var(--app-muted); opacity: 0.55" />
          <span class="flex-1 truncate" style="color: var(--app-foreground)">
            <template v-if="groupState(block) === 'running'">
              Running <span class="font-semibold" style="color: var(--app-accent)">{{ activeToolLabel(block) }}</span>…
            </template>
            <template v-else>
              <span class="font-semibold">{{ block.tools.length }}</span> {{ block.tools.length === 1 ? 'tool call' : 'tool calls' }}
              <span v-if="groupState(block) === 'error'" style="color: rgb(239, 68, 68)"> · failed</span>
            </template>
          </span>
          <ChevronUp v-if="isGroupOpen(block)" :size="11" style="color: var(--app-muted)" />
          <ChevronDown v-else :size="11" style="color: var(--app-muted)" />
        </button>

        <div v-if="isGroupOpen(block)" style="border-top: 1px solid var(--app-border)">
          <div
            v-for="t in block.tools"
            :key="t.callId"
            style="border-bottom: 1px solid color-mix(in srgb, var(--app-border) 60%, transparent)"
            class="last:border-b-0"
          >
            <button
              type="button"
              class="w-full flex items-center gap-2 px-2.5 py-1.5 text-left transition-colors hover:bg-[color-mix(in_srgb,var(--app-foreground)_3%,transparent)]"
              @click="toggleTool(t.callId)"
            >
              <Loader2 v-if="t.state === 'running'" :size="11" class="animate-spin shrink-0" style="color: var(--app-accent)" />
              <Check v-else-if="t.state === 'done'" :size="11" class="shrink-0" style="color: var(--app-accent)" />
              <X v-else :size="11" class="shrink-0" style="color: rgb(239, 68, 68)" />
              <span class="min-w-0 flex-1 truncate">
                <span class="font-semibold" style="color: var(--app-accent)">{{ toolLabel(effectiveTool(t)) }}</span><span style="color: var(--app-muted)">(<span style="color: var(--app-foreground); opacity: 0.8">{{ shortArg(toolArg(t)) }}</span>)</span>
              </span>
              <ChevronUp v-if="isToolOpen(t.callId)" :size="10" class="shrink-0" style="color: var(--app-muted)" />
              <ChevronDown v-else :size="10" class="shrink-0" style="color: var(--app-muted)" />
            </button>
            <div v-if="isToolOpen(t.callId)" class="px-2.5 pb-2 pt-0 space-y-1.5">
              <div
                v-if="t.input"
                class="rounded px-2 py-1.5 whitespace-pre-wrap break-all"
                style="background: color-mix(in srgb, var(--app-muted) 10%, transparent); color: var(--app-muted)"
              >
                {{ t.input }}
              </div>
              <div
                v-if="t.result"
                class="rounded px-2 py-1.5 whitespace-pre-wrap break-all max-h-60 overflow-y-auto"
                :style="t.isError
                  ? 'background: rgba(239, 68, 68, 0.08); color: rgb(239, 68, 68)'
                  : 'background: color-mix(in srgb, var(--app-accent) 6%, transparent); color: var(--app-foreground); opacity: 0.85'"
              >
                {{ t.result }}
              </div>
            </div>
          </div>
        </div>
      </div>
    </template>
    <div
      v-if="streaming"
      class="inline-flex items-center gap-2 text-xs"
      style="color: var(--app-muted)"
    >
      <Loader2 :size="12" class="animate-spin" />
      {{ statusText || 'thinking…' }}
    </div>
  </div>
</template>

<style scoped>
/* Minimal typography for markdown-rendered assistant text. Keeps the look
   aligned with the rest of the page — we only style the pieces that
   actually appear in agent output (tables, code, lists, emphasis). */
.spacedev-md :deep(p) {
  margin: 0 0 0.6em;
}
.spacedev-md :deep(p:last-child) {
  margin-bottom: 0;
}
.spacedev-md :deep(ul),
.spacedev-md :deep(ol) {
  margin: 0 0 0.6em;
  padding-left: 1.2em;
}
.spacedev-md :deep(li) {
  margin-bottom: 0.2em;
}
.spacedev-md :deep(h1),
.spacedev-md :deep(h2),
.spacedev-md :deep(h3),
.spacedev-md :deep(h4) {
  font-weight: 600;
  margin: 0.8em 0 0.4em;
  color: var(--app-foreground);
}
.spacedev-md :deep(h1) { font-size: 1.1em; }
.spacedev-md :deep(h2) { font-size: 1.05em; }
.spacedev-md :deep(h3) { font-size: 1em; }
.spacedev-md :deep(code) {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 0.88em;
  padding: 0.15em 0.35em;
  border-radius: 3px;
  background: color-mix(in srgb, var(--app-muted) 12%, transparent);
  color: var(--app-foreground);
}
.spacedev-md :deep(pre) {
  margin: 0.4em 0 0.6em;
  padding: 0.6em 0.8em;
  border-radius: 6px;
  background: color-mix(in srgb, var(--app-muted) 10%, transparent);
  border: 1px solid var(--app-border);
  overflow-x: auto;
  font-size: 0.85em;
  line-height: 1.5;
}
.spacedev-md :deep(pre code) {
  background: transparent;
  padding: 0;
  border-radius: 0;
}
.spacedev-md :deep(table) {
  width: 100%;
  border-collapse: collapse;
  margin: 0.4em 0 0.6em;
  font-size: 0.9em;
  border: 1px solid var(--app-border);
  border-radius: 6px;
  overflow: hidden;
}
.spacedev-md :deep(th),
.spacedev-md :deep(td) {
  padding: 0.4em 0.7em;
  text-align: left;
  border-bottom: 1px solid var(--app-border);
}
.spacedev-md :deep(tr:last-child td) {
  border-bottom: none;
}
.spacedev-md :deep(th) {
  background: color-mix(in srgb, var(--app-muted) 10%, transparent);
  color: var(--app-muted);
  font-weight: 600;
  font-size: 0.82em;
  text-transform: uppercase;
  letter-spacing: 0.03em;
}
.spacedev-md :deep(blockquote) {
  margin: 0.4em 0;
  padding: 0.3em 0.9em;
  border-left: 3px solid var(--app-border);
  color: var(--app-muted);
}
.spacedev-md :deep(a) {
  color: var(--app-accent);
  text-decoration: none;
}
.spacedev-md :deep(a:hover) {
  text-decoration: underline;
}
.spacedev-md :deep(hr) {
  border: none;
  border-top: 1px solid var(--app-border);
  margin: 0.8em 0;
}
</style>
