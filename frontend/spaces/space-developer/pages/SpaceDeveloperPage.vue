<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { readDir } from "@tauri-apps/plugin-fs";
import {
    FolderTree,
    Loader2,
    Sparkles,
    FolderPlus,
    RefreshCw,
    Boxes,
    Hammer,
    ShieldCheck,
    PackagePlus,
    Play,
} from "lucide-vue-next";
import { useProjectStore } from "@/stores/project";
import { useBrainSession } from "@/brain/useBrainSession";
import { useAIModel } from "@/composables/useAIModel";
import type { SkillInfo } from "@/composables/useSkills";
import SkillsMenu from "../components/SkillsMenu.vue";
import BlockRenderer, {
    type Block,
    type ToolCallBlock,
} from "../components/BlockRenderer.vue";
import RunControls from "../components/RunControls.vue";
import AgentInput from "@/components/agent/AgentInput.vue";
import type { RequestBlock } from "@/assistant";
import ContextGauge from "@/components/agent/ContextGauge.vue";
import CostBadge from "@/components/agent/CostBadge.vue";
import { routeParamString, getProjectRouteKey } from "@/utils/projectRoutes";
import type { BrainChunk } from "@/brain/client";
import ProjectCreateModal from "@/spaces/project/components/ProjectCreateModal.vue";
import FileTreeItem from "../components/FileTreeItem.vue";
import TasksPanel from "../components/TasksPanel.vue";
import { unwrapToolCall, findLastRunningTool, findOldestRunningTool, applyTaskResult, type WorkflowTask } from "@/lib/agentToolStream";
import { resolveAttachments } from "@/lib/attachmentContent";
import {
    parseHandoff,
    handoffLabel,
    performHandoff,
    type HandoffTarget,
} from "@/lib/agentHandoff";
import ToolbarSlot from "@/components/common/ToolbarSlot.vue";

const route = useRoute();
const router = useRouter();
const projectStore = useProjectStore();
const session = useBrainSession();
const { defaultModelId, resolveModelId } = useAIModel();

// Text shown in the live bottom indicator. Brain emits `status` chunks
// (e.g. "Running write_file…") via session.statusMessage; otherwise we
// fall back to a mode-appropriate default.
const liveStatusText = computed(() => {
    const fallback = mode.value === "plan" ? "drafting plan…" : "thinking…";
    const m = session.statusMessage.value;
    return m || fallback;
});

const AGENT_ID = "space";

type Mode = "plan" | "code";

interface Message {
    id: string;
    role: "user" | "assistant";
    content: string;
    timestamp: number;
    streaming?: boolean;
    blocks?: Block[];
}

interface FileNode {
    name: string;
    path: string;
    isDir: boolean;
    children?: FileNode[];
    expanded?: boolean;
    loaded?: boolean;
}

const routeProjectId = computed(() => routeParamString(route.params.projectId));
const resolvedRouteProject = computed(() => {
    const lookup = routeProjectId.value;
    return lookup ? projectStore.getProjectById(lookup) : null;
});
const projectPath = computed(
    () =>
        projectStore.currentProject?.local_path ||
        projectStore.currentProject?.path ||
        resolvedRouteProject.value?.local_path ||
        resolvedRouteProject.value?.path ||
        "",
);
const hasProject = computed(() => !!projectPath.value);

// Default to 'plan' so new spaces start in the planning workflow.
// Restored sessions overwrite this with the saved mode.
const mode = ref<Mode>("plan");
const messages = ref<Message[]>([]);
// Live task tracker — populated from task_* tool results, rendered by TasksPanel.
const tasks = ref<Map<number, WorkflowTask>>(new Map());
const sending = ref(false);
const errorMsg = ref<string | null>(null);
const chatScrollEl = ref<HTMLElement | null>(null);
const lastSessionId = ref<string | null>(null);
let cancelStream: (() => void) | null = null;

// Session history lives IN the project: `<projectPath>/.construct/spacedev-history.json`.
// Keeping it there means the chat travels with the project (backup, sync,
// move), and removing the project dir removes the history — no stale state
// hiding in browser storage.
const STORAGE_VERSION = 1;
interface PersistedSession {
    v: number;
    sessionId: string | null;
    messages: Message[];
    mode: Mode;
    savedAt: number;
}

function historyPath(): string | null {
    const path = projectPath.value;
    if (!path) return null;
    return `${path}/.construct/spacedev-history.json`;
}

async function saveSession() {
    const path = historyPath();
    if (!path) return;
    const payload: PersistedSession = {
        v: STORAGE_VERSION,
        sessionId: lastSessionId.value,
        messages: messages.value,
        mode: mode.value,
        savedAt: Date.now(),
    };
    try {
        const { writeTextFile, mkdir, exists } =
            await import("@tauri-apps/plugin-fs");
        const root = projectPath.value;
        if (root) {
            const constructDir = `${root}/.construct`;
            if (!(await exists(constructDir)))
                await mkdir(constructDir, { recursive: true });
        }
        await writeTextFile(path, JSON.stringify(payload, null, 2));
    } catch {
        /* non-fatal */
    }
}

async function restoreSession() {
    const path = historyPath();
    if (!path) return;
    try {
        const { readTextFile, exists } = await import("@tauri-apps/plugin-fs");
        if (!(await exists(path))) return;
        const raw = await readTextFile(path);
        const parsed = JSON.parse(raw) as PersistedSession;
        if (parsed?.v !== STORAGE_VERSION) return;
        if (Array.isArray(parsed.messages)) {
            messages.value = parsed.messages;
            // A restored session is historical — nothing is live. Finalize
            // any "running" tool block (else it spins forever), clear the
            // streaming flag, and rebuild the task tracker from saved
            // task_* results so the Tasks panel survives the reload.
            tasks.value = new Map();
            for (const m of messages.value) {
                m.streaming = false;
                for (const b of m.blocks ?? []) {
                    if (b.type !== "tool") continue;
                    const tb = b as ToolCallBlock;
                    if (tb.state === "running") tb.state = tb.isError ? "error" : "done";
                    if (!tb.isError && tb.result) applyTaskResult(tb.tool, tb.result, tasks.value);
                }
            }
        }
        if (parsed.sessionId) lastSessionId.value = parsed.sessionId;
        if (parsed.mode === "plan" || parsed.mode === "code")
            mode.value = parsed.mode;
    } catch {
        /* bad JSON or permissions — start fresh */
    }
}

async function clearPersistedSession() {
    const path = historyPath();
    if (!path) return;
    try {
        const { remove, exists } = await import("@tauri-apps/plugin-fs");
        if (await exists(path)) await remove(path);
    } catch {
        /* ignore */
    }
}

// Debounced save so we don't hammer storage on every chunk.
let saveTimer: ReturnType<typeof setTimeout> | null = null;
function scheduleSave() {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
        saveTimer = null;
        saveSession();
    }, 400);
}

function stopRun() {
    if (cancelStream) {
        try {
            cancelStream();
        } catch {
            /* already stopped */
        }
    }
    cancelStream = null;
    sending.value = false;
    const streamingMsg = messages.value.find((m) => m.streaming);
    if (streamingMsg) streamingMsg.streaming = false;
}

async function clearChat() {
    stopRun();
    messages.value = [];
    tasks.value = new Map();
    errorMsg.value = null;
    lastSessionId.value = null;
    session.newSession();
    await clearPersistedSession();
}

// "Dangling promise" detection — text the model often ends on when it
// intends to do more work but stops (end_turn). Case-insensitive, anchored
// near the end of the message so an early "let me know" doesn't trip it.
const DANGLING_PATTERNS: RegExp[] = [
    /\blet me (check|fix|try|run|see|verify|look|handle|do|make|update|add|continue|start|build|create|scaffold|set up|refactor|wire|implement)\b/i,
    /\bi['']?ll (check|fix|try|run|do|make|continue|implement|update|verify|handle|write|add|now|start|build|create|scaffold|set up|refactor|wire|begin|generate|put together)\b/i,
    /\bnow (let me|i['']?ll|i will)\b/i,
    // "Creating tasks:", "Building the Space…", "Setting up the project"
    /\b(creating|building|scaffolding|setting up|adding|implementing|refactoring|writing|generating) (the |a )?(tasks?|files?|project|space|page|app|components?|layout)\b/i,
    /\bcontinuing\.{0,3}$/i,
    /\bone (moment|sec|second)\b/i,
    // Dangles on a lead-in colon — the promised list/work never came.
    /[:：]\s*$/,
];

function endsOnDanglingIntent(text: string): boolean {
    const tail = text.trim().slice(-400); // only check the tail — narrations early on are fine
    return DANGLING_PATTERNS.some((rx) => rx.test(tail));
}

const canContinue = computed(() => {
    if (sending.value) return false;
    if (messages.value.length === 0) return false;
    const last = messages.value[messages.value.length - 1];
    if (!last || last.role !== "assistant" || last.streaming) return false;
    if (!lastSessionId.value) return false; // need a session to continue
    const text =
        last.content ||
        (last.blocks ?? [])
            .filter((b): b is Block & { type: "text" } => b.type === "text")
            .map((b) => b.text)
            .join("");
    return text.length > 0 && endsOnDanglingIntent(text);
});

async function continueRun() {
    if (!canContinue.value || sending.value) return;
    // Use a brief, unambiguous continuation prompt. The operator session id
    // carries the full prior context so the agent knows what "continue" means.
    await send([{ type: "text", content: "Continue." }]);
}

// Auto-continue: resume on the user's behalf when the model narrates intent
// then stops without acting (or hits the token limit). Capped per user turn;
// the counter resets whenever the user sends a real message (see send()).
const MAX_AUTO_CONTINUE = 3;
let autoContinueDepth = 0;

// --- Toolbar actions ---
// Each runs the corresponding operator space_* tool against currentSpace.
// Results/errors surface in `errorMsg`; the spinner icon indicates progress.

async function runOperatorTool(
    name: string,
    args: Record<string, unknown>,
): Promise<{ ok: boolean; content: string }> {
    // Brain wire route `tools.call` — see brain/wire_*.go. Returns
    // { content, is_error } shape (mirrors operator's CallToolResult).
    try {
        const result = await session.brain.request<{
            content?: string;
            is_error?: boolean;
        }>("tools.call", { name, args });
        return {
            ok: !result?.is_error,
            content: String(result?.content ?? ""),
        };
    } catch (e) {
        return {
            ok: false,
            content: e instanceof Error ? e.message : String(e),
        };
    }
}

async function runAction(
    action: Exclude<SpaceAction, null>,
    fn: () => Promise<void>,
): Promise<void> {
    if (activeAction.value !== null) return;
    activeAction.value = action;
    errorMsg.value = null;
    try {
        await fn();
    } finally {
        activeAction.value = null;
    }
}

async function buildSpace() {
    const s = currentSpace.value;
    if (!s) return;
    await runAction("build", async () => {
        const r = await runOperatorTool("space_build", { path: s.absPath });
        if (!r.ok) errorMsg.value = `Build failed: ${r.content}`;
        scheduleTreeRefresh();
    });
}

async function validateSpace() {
    const s = currentSpace.value;
    if (!s) return;
    await runAction("validate", async () => {
        const r = await runOperatorTool("space_validate", { path: s.absPath });
        if (!r.ok) errorMsg.value = r.content || "Validation failed";
    });
}

async function installSpace() {
    const s = currentSpace.value;
    if (!s) return;
    await runAction("install", async () => {
        let r = await runOperatorTool("space_install", { path: s.absPath });
        if (!r.ok && /no dist\/|Run space_build/i.test(r.content)) {
            const b = await runOperatorTool("space_build", { path: s.absPath });
            if (!b.ok) {
                errorMsg.value = `Build failed: ${b.content}`;
                return;
            }
            r = await runOperatorTool("space_install", { path: s.absPath });
        }
        if (!r.ok) errorMsg.value = `Install failed: ${r.content}`;
    });
}

async function runInPreview() {
    const s = currentSpace.value;
    if (!s) return;
    await runAction("runner", async () => {
        // Ensure we have a fresh dist/ before opening.
        const b = await runOperatorTool("space_build", { path: s.absPath });
        if (!b.ok) {
            errorMsg.value = `Build failed: ${b.content}`;
            return;
        }
        const { useSpaceRunner } = await import("@/composables/useSpaceRunner");
        await useSpaceRunner().openRunner({
            spaceId: s.id,
            projectPath: `${s.absPath}/dist`,
            project: projectPath.value || undefined,
        });
    });
}

const fileTree = ref<FileNode[]>([]);
const treeLoading = ref(false);

// Toolbar action state — one flag per action so the right icon spins while
// its tool runs. `activeAction` drives disabling the row during any op.
type SpaceAction = "build" | "validate" | "install" | "runner" | null;
const activeAction = ref<SpaceAction>(null);

// The first `space-*/` directory we find becomes the "current space" the
// toolbar actions operate on. Derived from the explorer's fileTree so it
// stays in sync with the project state (refreshed after tool.result).
const currentSpace = computed(() => {
    const dir = fileTree.value.find(
        (n) => n.isDir && n.name.startsWith("space-"),
    );
    if (!dir) return null;
    return {
        id: dir.name.replace(/^space-/, ""),
        name: dir.name,
        absPath: dir.path,
    };
});

const showCreateModal = ref(false);
const creatingProject = ref(false);

const loadedRunSkills = ref<SkillInfo[]>([]);

function trackLoadedSkill(data: Record<string, unknown> | undefined) {
    const id = typeof data?.id === "string" ? data.id : "";
    if (!id || loadedRunSkills.value.some((s) => s.id === id)) return;
    loadedRunSkills.value.push({
        id,
        name:
            typeof data?.name === "string"
                ? data.name
                : id.replace(/^[^:]+:/, ""),
        category: "runtime",
        description:
            typeof data?.description === "string" ? data.description : "",
        version: "",
        state: "active",
        dependencies: [],
        hooksCount: 0,
        toolsCount: 0,
        loadedAt: new Date().toISOString(),
        source: typeof data?.source === "string" ? data.source : "runtime",
    });
}

let messageCounter = 0;
function nextId() {
    return `msg-${Date.now()}-${++messageCounter}`;
}

// Tools that change the filesystem — when any of these completes, refresh
// the explorer so the user sees new/changed files immediately.
const WRITE_TOOLS = new Set([
    "write_file",
    "edit_file",
    "space_create",
    "space_install",
    "space_clean",
    "space_graph_init",
    "space_graph_generate",
    "notebook_edit",
    "bash", // bash may touch files; refreshing on every bash is cheap compared to a stale tree
]);

let treeRefreshTimer: ReturnType<typeof setTimeout> | null = null;
function scheduleTreeRefresh() {
    if (treeRefreshTimer) clearTimeout(treeRefreshTimer);
    // Debounce so a burst of tool calls doesn't hammer readDir.
    treeRefreshTimer = setTimeout(() => {
        treeRefreshTimer = null;
        refreshTreePreserveExpanded();
    }, 300);
}

async function loadFileTree(path: string): Promise<FileNode[]> {
    try {
        const entries = await readDir(path);
        // Show everything — match Finder. The tree is lazy-expanded, so heavy
        // directories (node_modules, dist) only enumerate their children when
        // the user explicitly clicks them. Hiding them silently was surprising.
        const nodes: FileNode[] = entries.map((e) => ({
            name: e.name,
            path: `${path}/${e.name}`,
            isDir: !!e.isDirectory,
            expanded: false,
            loaded: false,
        }));
        nodes.sort((a, b) => {
            if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
            return a.name.localeCompare(b.name);
        });
        return nodes;
    } catch {
        return [];
    }
}

async function refreshTree() {
    if (!projectPath.value) {
        fileTree.value = [];
        return;
    }
    treeLoading.value = true;
    fileTree.value = await loadFileTree(projectPath.value);
    treeLoading.value = false;
}

// Reload the tree but keep the currently-expanded directories expanded. The
// agent creates many directories during scaffolding; we don't want each
// refresh to collapse the user's view.
async function refreshTreePreserveExpanded() {
    if (!projectPath.value) {
        fileTree.value = [];
        return;
    }
    const expanded = new Set<string>();
    const collect = (nodes: FileNode[]) => {
        for (const n of nodes) {
            if (n.isDir && n.expanded) expanded.add(n.path);
            if (n.children) collect(n.children);
        }
    };
    collect(fileTree.value);
    const fresh = await loadFileTree(projectPath.value);
    const hydrate = async (nodes: FileNode[]) => {
        for (const n of nodes) {
            if (n.isDir && expanded.has(n.path)) {
                n.children = await loadFileTree(n.path);
                n.expanded = true;
                n.loaded = true;
                if (n.children) await hydrate(n.children);
            }
        }
    };
    await hydrate(fresh);
    fileTree.value = fresh;
}

async function toggleNode(node: FileNode) {
    if (!node.isDir) return;
    if (!node.loaded) {
        node.children = await loadFileTree(node.path);
        node.loaded = true;
    }
    node.expanded = !node.expanded;
}

async function scrollToBottom() {
    await nextTick();
    if (chatScrollEl.value) {
        chatScrollEl.value.scrollTop = chatScrollEl.value.scrollHeight;
    }
}

function modeDirective(): string {
    if (mode.value === "plan") {
        // PLAN mode: architect.v1 strict schema. ALL nine top-level keys must
        // be present (unused ones as null) because the operator's JSON Schema
        // marks them all required. Options require value/label/description/icon
        // (description and icon may be null).
        const stamp = new Date()
            .toISOString()
            .replace(/[:.]/g, "-")
            .slice(0, 19);
        return [
            "Mode: PLAN — clarify first when key choices are unclear, THEN produce a concrete plan.",
            "",
            "CRITICAL — architect.v1 schema rules:",
            "- Emit a SINGLE JSON envelope as your final text response. No prose, no markdown, no code fences around it. Just the object.",
            "- ALL nine top-level keys are REQUIRED every turn: `version`, `state`, `questions`, `title`, `summary`, `decisions`, `docs`, `next_actions`, `message`. Unused keys MUST be present with value `null` (or empty arrays if typed as array).",
            '- `state` is one of "questions" | "plan" | "progress".',
            "- Every question option MUST include four keys: `value`, `label`, `description`, `icon`. Use `null` for `description` or `icon` when you have nothing to say.",
            "- EXACTLY ONE question per `questions` envelope (minItems=1, maxItems=1). After the user answers, ask the next question or emit the plan.",
            "",
            "When to use each state:",
            "- `questions`: you need the user to pick between approaches they'd want to weigh in on (rendering engine, data storage, scope, state library, visual style). Include 2–4 options with concrete pros/cons in `description`. Surface non-obvious tradeoffs the user may not know.",
            "- `plan`: FINAL state, all decisions settled. Also write the plan markdown to `docs/plan-" +
            stamp +
            ".md` via write_file — docs/ is the only write path allowed. Cover: classification, identity, pages, data model, user flows, files to create/edit, verification targets.",
            "- `progress`: avoid unless you're narrating a long-running action; just emit `plan` or `questions`.",
            "",
            "Shape for `questions`:",
            "```json",
            "{",
            '  "version": "architect.v1",',
            '  "state": "questions",',
            '  "questions": [{',
            '    "id": "rendering",',
            '    "question": "Pick a rendering approach for the game",',
            '    "type": "single",',
            '    "options": [',
            '      {"value": "canvas-2d", "label": "Canvas 2D", "description": "Zero deps, simple, great for 2D grid games", "icon": null},',
            '      {"value": "pixi",      "label": "PixiJS",    "description": "WebGL, smooth animations, ~40kb dep",       "icon": null},',
            '      {"value": "phaser",    "label": "Phaser 3",  "description": "Full game framework, ~500kb",               "icon": null}',
            "    ]",
            "  }],",
            '  "title": null, "summary": null, "decisions": null, "docs": null, "next_actions": null, "message": null',
            "}",
            "```",
            "",
            "Shape for `plan`:",
            "```json",
            "{",
            '  "version": "architect.v1",',
            '  "state": "plan",',
            '  "questions": null,',
            '  "title": "<short plan title>",',
            '  "summary": "<2-3 sentence summary>",',
            '  "decisions": [',
            '    {"label": "ID", "value": "<space-id>"},',
            '    {"label": "Scope", "value": "project"},',
            '    {"label": "Data", "value": "Graph|useLocalStorage|transient"},',
            '    {"label": "Pages", "value": "<count> — /, /settings, ..."}',
            "  ],",
            `  "docs": [{"path": "docs/plan-${stamp}.md", "title": "Plan — <title>"}],`,
            '  "next_actions": [{"id": "switch-to-code", "label": "Switch to CODE and build"}],',
            '  "message": null',
            "}",
            "```",
            "",
            "Rules:",
            "- If the request is already specific (explicit tech stack), skip questions and go straight to `plan`.",
            "- Do NOT scaffold, run build/install/check, create spaces, run graph tools, or edit source files. docs/ writes are the ONLY writes allowed.",
            "- If a write is blocked, surface the block and ask the user to switch to CODE mode.",
        ].join("\n");
    }
    return [
        "Mode: CODE — execute against a plan. Scaffold, implement, and verify as described in your system prompt.",
        "",
        "PLAN HANDOFF: if `docs/plan-*.md` exists in the project, treat it as the source of truth:",
        "1. Read the most recent `docs/plan-*.md` (glob `docs/plan-*.md`, pick the latest by filename).",
        "2. Decompose it into tasks with `task_create` — one task per discrete implementation step, in order, with dependencies where relevant. This is your own todo list; the plan doc stays untouched.",
        '3. Walk the tasks: `task_update(id, status:"in_progress")` → do the work with edit/write/bash → `task_update(id, status:"completed")`. If blocked, set `status:"error"` with a short description.',
        "4. Finish with a short summary referencing the task list.",
        "",
        "TRIAGE (no plan yet, request arrived straight in CODE). If this turn's request is any of:",
        "- a migration (swap framework/lib/tooling — Tailwind↔CSS, Vue↔React, REST↔GraphQL, etc.)",
        "- a multi-page / multi-file feature touching more than ~3 files",
        "- a new external dependency or a build-config change",
        "- a refactor that changes public shape (routes, store API, DB schema)",
        "",
        "then DO NOT start editing. Instead:",
        "1. Explore with read-only tools (read_file / glob / grep / bash ls) to understand current shape.",
        "2. Reply in prose with a scoped plan: files to change, order of operations, risks, verification.",
        '3. End with: "This is a planning-scale change — recommend switching to Plan mode so we capture it in docs/plan-*.md before editing." Wait for the user to toggle.',
        "",
        "For small, localised changes (one or two files, no new deps, no config shift) — proceed normally: plan briefly, edit, verify. `task_create` is optional here.",
    ].join("\n");
}

async function send(blocks: RequestBlock[], opts: { auto?: boolean } = {}) {
    // A genuine user message resets the auto-continue budget; an auto-fired
    // continuation does not (so the cap actually bounds the chain).
    if (!opts.auto) autoContinueDepth = 0;
    // Steer mid-stream: if the user sends while the agent is running,
    // abort the current turn so the new message lands as the next user
    // turn in the same operator session. The session id is preserved, so
    // the agent keeps context + sees the new instruction on the next turn.
    if (sending.value) {
        stopRun();
        await new Promise((r) => setTimeout(r, 200));
    }

    // AgentInput emits send(blocks). Programmatic callers (Continue,
    // plan actions, question answers) build synthetic block arrays and
    // call send directly.
    const text = blocks
        .filter(
            (b): b is { type: "text"; content: string } => b.type === "text",
        )
        .map((b) => b.content)
        .join("\n")
        .trim();
    type FileLike = RequestBlock & { path?: string; name?: string };
    const fileBlocks = blocks
        .filter(
            (b): b is FileLike => b.type === "file" && !!(b as FileLike).path,
        )
        .map((b) => ({
            type: "file" as const,
            path: b.path as string,
            name: b.name as string,
        }));

    if (!text && fileBlocks.length === 0) return;

    sending.value = true;
    errorMsg.value = null;

    // Attachment filenames go into the displayed message; the actual bytes
    // ride along via content_blocks below.
    const displayContent =
        text +
        (fileBlocks.length > 0
            ? `\n\n[Attached: ${fileBlocks.map((f) => f.name).join(", ")}]`
            : "");
    messages.value.push({
        id: nextId(),
        role: "user",
        content: displayContent,
        timestamp: Date.now(),
    });

    const assistantId = nextId();
    messages.value.push({
        id: assistantId,
        role: "assistant",
        content: "",
        timestamp: Date.now(),
        streaming: true,
        blocks: [],
    });
    await scrollToBottom();

    const modelId = resolveModelId(defaultModelId.value, { allowAuto: false });
    loadedRunSkills.value = [];
    // Route image/file attachments to the brain's multimodal `content` field.
    // Images are inlined as data URLs; non-image files are appended as paths
    // so the agent can `read` them.
    const { images, filePaths } = await resolveAttachments(blocks);
    void fileBlocks;
    const fileHint = filePaths.length
        ? `\n\nAttached files (read them by path):\n${filePaths.map((f) => `- ${f.path}`).join("\n")}`
        : "";
    const task = `${modeDirective()}\n\n${text}${fileHint}`;

    const onChunk = (chunk: BrainChunk) => {
        // Capture brain's session id so follow-up turns thread.
        if (chunk.type === "session" && chunk.data?.session_id) {
            lastSessionId.value = chunk.data.session_id as string;
            return;
        }
        // Brain doesn't currently emit a `skill.loaded` event; the skills
        // menu just stays empty during a brain run.
        if (chunk.type === "skill.loaded") {
            trackLoadedSkill(chunk.data);
            return;
        }

        const msg = messages.value.find((m) => m.id === assistantId);
        if (!msg) return;
        if (!msg.blocks) msg.blocks = [];
        const last = msg.blocks[msg.blocks.length - 1];

        // Brain tool start
        if (chunk.type === "tool_call") {
            // Unwrap the pi-shape call_tool dispatcher → the real tool + args.
            const { tool, input } = unwrapToolCall(String(chunk.data?.name ?? ""), chunk.data?.input);
            // `||` not `??`: the brain sometimes sends an empty-string id, which
            // must still fall through to a unique fallback so blocks don't collide.
            const callId = String(
                chunk.data?.id || chunk.data?.call_id || `${tool}-${Date.now()}`,
            );
            // The brain fires tool_call TWICE per call: once at tool_use_start
            // with empty input, then again with the assembled args. Merge by
            // callId — don't push a duplicate, and don't let the empty first
            // emission clobber the resolved tool/input.
            const existing = msg.blocks.find(
                (b): b is ToolCallBlock => b.type === "tool" && b.callId === callId && !!callId,
            );
            if (existing) {
                if (tool && tool !== "call_tool") { existing.tool = tool; existing.title = tool; }
                if (input) existing.input = input;
            } else {
                msg.blocks.push({
                    type: "tool",
                    callId,
                    tool,
                    title: tool,
                    input,
                    state: "running",
                } as ToolCallBlock);
            }
            scrollToBottom();
            return;
        }

        if (chunk.type === "tool_result") {
            const callId = String(chunk.data?.id ?? chunk.data?.call_id ?? "");
            // The brain's tool_result is `{id, output, is_error}` — no tool
            // name — so the real tool is recovered from the correlated call.
            const { tool: resultTool } = unwrapToolCall(String(chunk.data?.name ?? chunk.data?.tool ?? ""), chunk.data?.input);
            const isError = Boolean(chunk.data?.is_error ?? chunk.data?.error);
            const content = String(chunk.data?.output ?? chunk.data?.error ?? "");
            // Correlate by id; else most recent running block of the same tool
            // (when the result carried a name); else the oldest running block
            // of any tool. The brain often sends an empty id and never a name
            // on results — without the FIFO fallback the call half spins
            // "running" forever and task results are dropped.
            const existing =
                msg.blocks.find(
                    (b): b is ToolCallBlock =>
                        b.type === "tool" && b.callId === callId && !!callId,
                )
                ?? (resultTool ? findLastRunningTool(msg.blocks as ToolCallBlock[], resultTool) : undefined)
                ?? findOldestRunningTool(msg.blocks as ToolCallBlock[]);
            if (existing) {
                existing.result = content;
                existing.isError = isError;
                existing.state = isError ? "error" : "done";
            } else {
                msg.blocks.push({
                    type: "tool",
                    callId: callId || `${resultTool || "tool"}-${Date.now()}`,
                    tool: resultTool,
                    title: resultTool,
                    input: "",
                    result: content,
                    isError,
                    state: isError ? "error" : "done",
                } as ToolCallBlock);
            }
            // Use the correlated call's real (unwrapped) tool name — the result
            // event has none, so the task tracker / tree refresh need it here.
            const toolName = existing?.tool || resultTool || "";
            // Keep the live task tracker in sync for the TasksPanel.
            if (!isError && toolName) applyTaskResult(toolName, content, tasks.value);
            if (!isError && toolName && WRITE_TOOLS.has(toolName))
                scheduleTreeRefresh();
            scrollToBottom();
            return;
        }

        // Text delta — brain emits `text_delta` with data.delta.
        if (chunk.type === "text_delta") {
            const delta = (chunk.data?.delta as string) ?? "";
            if (!delta) return;
            if (last && last.type === "text") {
                last.text += delta;
            } else {
                msg.blocks.push({ type: "text", text: delta });
            }
            msg.content += delta;
            // PLAN mode: try to promote as soon as we see a closing `}`.
            if (mode.value === "plan" && delta.includes("}")) {
                tryPromoteToPlanBlock(msg);
            }
            scrollToBottom();
        }
    };

    const onDone = (result: Record<string, unknown>) => {
        let autoFire = false;
        const msg = messages.value.find((m) => m.id === assistantId);
        if (msg) {
            msg.streaming = false;
            const finalContent = result?.content as string | undefined;
            if (!msg.content && finalContent) msg.content = finalContent;
            const errText = result?.error as string | undefined;
            if (errText) {
                msg.content = msg.content || `Error: ${errText}`;
                errorMsg.value = errText;
            } else {
                tryPromoteToPlanBlock(msg);
                tryPromoteToHandoffBlock(msg);
                // Auto-resume when the model narrates intent then stops without
                // acting, or hits the token limit — so the user doesn't have to
                // click Continue. Capped per user turn; only when the turn did
                // no work and there's a session to continue.
                const stopReason = result?.stop_reason as string | undefined;
                if (stopReason && stopReason !== "tool_use") {
                    const madeToolCalls = (msg.blocks ?? []).some((b) => b.type === "tool");
                    const danglingNarration =
                        stopReason === "end_turn" && !madeToolCalls
                        && mode.value !== "plan" && endsOnDanglingIntent(msg.content || "");
                    const hitTokenLimit = stopReason === "max_tokens";
                    const canAuto =
                        (danglingNarration || hitTokenLimit)
                        && !!lastSessionId.value && autoContinueDepth < MAX_AUTO_CONTINUE;
                    let footer = "";
                    if (canAuto) {
                        autoContinueDepth++;
                        autoFire = true;
                        footer = `\n\n_Continuing automatically… (${autoContinueDepth}/${MAX_AUTO_CONTINUE})_`;
                    } else if (danglingNarration) {
                        footer = "\n\n_The model stopped after announcing intent. Click **Continue** to keep going._";
                    } else if (hitTokenLimit) {
                        footer = "\n\n_Stopped: output token limit reached. Click **Continue** to keep going._";
                    }
                    if (footer) msg.content = (msg.content || "") + footer;
                }
            }
        }
        const sid = result?.session_id as string | undefined;
        if (sid) lastSessionId.value = sid;
        sending.value = false;
        cancelStream = null;
        saveSession();
        scrollToBottom();
        if (autoFire) {
            setTimeout(() => { void send([{ type: "text", content: "Continue." }], { auto: true }); }, 200);
        }
    };

    const onError = (errText: string) => {
        errorMsg.value = errText;
        const msg = messages.value.find((m) => m.id === assistantId);
        if (msg) {
            msg.streaming = false;
            msg.content = msg.content || `Error: ${errText}`;
        }
        sending.value = false;
        cancelStream = null;
    };

    try {
        // Brain reads project context from the active profile / data dir;
        // operator.setProject is no longer needed.
        // project_dir scopes bash/read/grep/glob/write to the right
        // directory. Prefer the scaffolded space's path (so the model
        // operates inside the space being built), but fall back to the
        // project root for empty projects that haven't been scaffolded
        // yet — otherwise brain's tools resolve against the brain process
        // cwd (in dev, `construct-app-brain/desktop`), which makes the
        // model think a random Cargo.lock is the project.
        const projectDir = currentSpace.value?.absPath || projectPath.value;
        cancelStream = await session.brain.prompt(
            {
                prompt: task,
                agent_id: AGENT_ID,
                ...(images.length
                    ? { content: [{ type: "text" as const, text: task }, ...images] }
                    : {}),
                ...(modelId ? { model: modelId } : {}),
                ...(lastSessionId.value
                    ? { session_id: lastSessionId.value }
                    : {}),
                ...(projectDir ? { project_dir: projectDir } : {}),
            },
            { onChunk, onDone, onError },
        );
    } catch (e) {
        const errText = e instanceof Error ? e.message : String(e);
        errorMsg.value = errText;
        const msg = messages.value.find((m) => m.id === assistantId);
        if (msg) {
            msg.streaming = false;
            msg.content = `Error: ${errText}`;
        }
        sending.value = false;
    }
}

// --- PLAN mode: architect.v1 envelope -> structured plan block ---

interface ArchitectPlanEnvelope {
    version: "architect.v1";
    state: "plan";
    title: string;
    summary: string;
    decisions?: Array<{ label: string; value: string }>;
    docs?: Array<{ path: string; title: string }>;
    next_actions?: Array<{ id: string; label: string }>;
}

interface ArchitectQuestionOption {
    value: string;
    label: string;
    description?: string | null;
    icon?: string | null;
}

interface ArchitectQuestionsEnvelope {
    version: "architect.v1";
    state: "questions";
    questions: Array<{
        id: string;
        question: string;
        type: "single" | "multi";
        options: ArchitectQuestionOption[];
    }>;
}

type ArchitectEnvelope = ArchitectPlanEnvelope | ArchitectQuestionsEnvelope;

// Extract every balanced top-level JSON object from a string. String-aware
// so braces inside values don't trip the counter. Tolerates text before /
// between / after objects (markdown prose, fenced blocks, progress states).
function extractJsonObjects(src: string): string[] {
    const out: string[] = [];
    let depth = 0;
    let start = -1;
    let inString = false;
    let escape = false;
    for (let i = 0; i < src.length; i++) {
        const ch = src[i];
        if (escape) {
            escape = false;
            continue;
        }
        if (inString) {
            if (ch === "\\") {
                escape = true;
                continue;
            }
            if (ch === '"') inString = false;
            continue;
        }
        if (ch === '"') {
            inString = true;
            continue;
        }
        if (ch === "{") {
            if (depth === 0) start = i;
            depth++;
        } else if (ch === "}") {
            if (depth > 0) depth--;
            if (depth === 0 && start >= 0) {
                out.push(src.slice(start, i + 1));
                start = -1;
            }
        }
    }
    return out;
}

// Try hard to parse an architect.v1 envelope (questions | plan) out of
// whatever the model emitted. Strategies in order:
//   1. Balanced top-level objects (handles multiple envelopes in one stream)
//   2. Contents of a fenced ```json ... ``` block
//   3. Broad slice from first `{` to last `}` — last-ditch for truncated
//      or prose-wrapped output
// Returns the LAST terminal-state envelope (plan or questions). Ignores
// `progress` interstitials. `null` when nothing parses.
function parseArchitectEnvelope(src: string): ArchitectEnvelope | null {
    const candidates: string[] = [];
    candidates.push(...extractJsonObjects(src));
    for (const m of src.matchAll(/```(?:json)?\s*([\s\S]*?)```/g)) {
        if (m[1]) candidates.push(m[1]);
    }
    const first = src.indexOf("{");
    const last = src.lastIndexOf("}");
    if (first >= 0 && last > first) candidates.push(src.slice(first, last + 1));

    let match: ArchitectEnvelope | null = null;
    for (const raw of candidates) {
        try {
            const parsed = JSON.parse(raw) as Record<string, unknown>;
            const envelope = coerceArchitectEnvelope(parsed);
            if (envelope) match = envelope; // keep scanning; we want the last terminal state
        } catch {
            /* try next */
        }
    }
    return match;
}

function coerceArchitectEnvelope(
    parsed: Record<string, unknown>,
): ArchitectEnvelope | null {
    if (!parsed || parsed.version !== "architect.v1") return null;
    if (
        parsed.state === "plan" &&
        typeof parsed.title === "string" &&
        typeof parsed.summary === "string"
    ) {
        return parsed as unknown as ArchitectPlanEnvelope;
    }
    if (
        parsed.state === "questions" &&
        Array.isArray(parsed.questions) &&
        parsed.questions.length > 0 &&
        typeof (parsed.questions[0] as Record<string, unknown>)?.question ===
        "string"
    ) {
        return parsed as unknown as ArchitectQuestionsEnvelope;
    }
    return null;
}

function tryPromoteToPlanBlock(msg: Message) {
    // Gather every piece of text content — blocks (streamed) + .content
    // (final result). Both may carry envelopes; we search across the full
    // accumulated stream for the latest terminal-state one.
    const textFromBlocks = (msg.blocks ?? [])
        .filter((b): b is Block & { type: "text" } => b.type === "text")
        .map((b) => b.text)
        .join("\n");
    const source = [textFromBlocks, msg.content]
        .filter(Boolean)
        .join("\n")
        .trim();
    if (!source) return;
    const envelope = parseArchitectEnvelope(source);
    if (!envelope) return;

    let promoted: Block | null = null;
    let summary = "";
    if (envelope.state === "plan") {
        promoted = {
            type: "plan",
            title: envelope.title,
            summary: envelope.summary,
            decisions: envelope.decisions ?? [],
            docs: envelope.docs ?? [],
            nextActions: envelope.next_actions ?? [],
        };
        summary = envelope.summary;
    } else if (envelope.state === "questions") {
        const q = envelope.questions[0];
        // Shape matches the shared QuestionBlock type in @/assistant/blocks.ts:
        // { type: 'question', id, question, questionType, options, answer? }
        promoted = {
            type: "questions",
            question: {
                type: "question",
                id: q.id,
                question: q.question,
                questionType: q.type,
                options: q.options.map((o) => ({
                    value: o.value,
                    label: o.label,
                    description: o.description ?? undefined,
                    icon: o.icon ?? undefined,
                })),
            },
        };
        summary = q.question;
    }
    if (!promoted) return;

    // Keep thinking + tool blocks above the card. Drop `text` blocks (they
    // carry the raw JSON) AND any existing plan/questions blocks — promotion
    // is idempotent: the last parsed envelope wins, no card duplication even
    // if we're called mid-stream then again on onDone.
    const kept: Block[] = (msg.blocks ?? []).filter(
        (b) => b.type !== "text" && b.type !== "plan" && b.type !== "questions",
    );
    kept.push(promoted);
    msg.blocks = kept;
    msg.content = summary;
}

// Space Developer doesn't currently emit handoff markers, but users can
// still land here with ?q= from a ask handoff — we keep symmetry
// with Builder by rendering any handoff block the shared BlockRenderer
// knows about, and by auto-sending the seeded prompt on mount.
function tryPromoteToHandoffBlock(msg: Message) {
    const textFromBlocks = (msg.blocks ?? [])
        .filter((b): b is Block & { type: "text" } => b.type === "text")
        .map((b) => b.text)
        .join("\n");
    const source = [textFromBlocks, msg.content]
        .filter(Boolean)
        .join("\n")
        .trim();
    if (!source) return;
    const parsed = parseHandoff(source);
    if (!parsed) return;
    const kept: Block[] = (msg.blocks ?? []).filter(
        (b) => b.type !== "handoff" && b.type !== "text",
    );
    if (parsed.cleanText.trim()) {
        kept.push({ type: "text", text: parsed.cleanText });
    }
    kept.push({
        type: "handoff",
        target: parsed.target,
        label: handoffLabel(parsed.target),
    });
    msg.blocks = kept;
    msg.content = parsed.cleanText;
}

async function onHandoff(target: string) {
    const lastUser = [...messages.value]
        .reverse()
        .find((m) => m.role === "user");
    const prompt = lastUser?.content?.trim();
    await performHandoff(target as HandoffTarget, {
        projectId: routeProjectId.value || undefined,
        prompt: prompt || undefined,
    });
}

async function onPlanAction(action: { id: string; label: string }) {
    // Primary path: flip to CODE mode and immediately ask the agent to proceed
    // with the plan. Uses the prior session id so the agent has full plan
    // context; the CODE directive replaces the PLAN directive on the next turn.
    const id = action.id.toLowerCase();
    if (
        id.includes("code") ||
        id === "build" ||
        id === "proceed" ||
        id === "execute"
    ) {
        mode.value = "code";
        await send([
            {
                type: "text",
                content:
                    'Read the latest docs/plan-*.md, break it into tasks with task_create (one task per implementation step, ordered, with dependencies where relevant), then work through them — task_update to "in_progress" before each, "completed" after.',
            },
        ]);
        return;
    }
    // Fallback: treat unknown actions as the prompt to send. AgentInput
    // owns its own buffer now, so we fire the send directly.
    await send([{ type: "text", content: action.label }]);
}

function onPlanOpenDoc(doc: { path: string; title: string }) {
    // Best-effort "open" — for now, we surface the path. A future step can
    // open the doc in a side panel or route to the editor space.
    const abs = projectPath.value
        ? `${projectPath.value}/${doc.path}`
        : doc.path;
    errorMsg.value = `Saved plan at ${abs}`;
    setTimeout(() => {
        if (errorMsg.value?.startsWith("Saved plan")) errorMsg.value = null;
    }, 4000);
}

async function onQuestionAnswer(questionId: string, answer: string | string[]) {
    if (sending.value) return;
    // Send the answer back in the same session. The shared QuestionBlock
    // emits a comma-joined string for multi-select; we send it verbatim since
    // the LLM can parse either form.
    const text = Array.isArray(answer) ? answer.join(", ") : answer;
    await send([
        { type: "text", content: `Answer for ${questionId}: ${text}` },
    ]);
}

// Sync question state (answered/not) back into the message's block tree so
// re-renders preserve the user's selection.
function onQuestionUpdate(block: import("@/assistant").QuestionBlock) {
    const lastMsg = messages.value[messages.value.length - 1];
    if (!lastMsg?.blocks) return;
    const idx = lastMsg.blocks.findIndex(
        (b) => b.type === "questions" && b.question.id === block.id,
    );
    if (idx >= 0) {
        const b = lastMsg.blocks[idx] as Block & { type: "questions" };
        b.question = block;
    }
}

async function handleCreateProject(
    name: string,
    description?: string,
    // The modal forces `space-project` on this page (see template), so the
    // third arg always arrives. We forward it to createProject so the
    // canonical `.construct/project.json` write includes `kind:
    // "space-project"` — without this the manifest landed as a generic
    // project and ProjectDetailPage badged it "WEB" + offered Builder
    // instead of Space Developer.
    kind: "project" | "space-project" = "space-project",
) {
    creatingProject.value = true;
    try {
        const result = await projectStore.createProject({ name, description, kind });
        if (result.success && result.data) {
            // Belt-and-suspenders: createProject's manifest write should
            // already carry `kind`, but markAsSpaceProject patches in case
            // a legacy code path skipped it. No-op when the file is already
            // correct.
            const root = result.data.local_path ?? result.data.path;
            if (root) await markAsSpaceProject(root);

            showCreateModal.value = false;
            const key = getProjectRouteKey(result.data);
            router.replace(
                `/app/projects/${encodeURIComponent(key)}/space-developer`,
            );
        } else {
            errorMsg.value = result.error || "Failed to create project";
        }
    } finally {
        creatingProject.value = false;
    }
}

async function markAsSpaceProject(root: string) {
    try {
        const { writeTextFile, readTextFile, mkdir, exists } =
            await import("@tauri-apps/plugin-fs");
        const constructDir = `${root}/.construct`;
        if (!(await exists(constructDir)))
            await mkdir(constructDir, { recursive: true });
        const path = `${constructDir}/project.json`;
        const now = new Date().toISOString();

        // Patch-in-place: if a manifest already exists, only write when
        // `kind` is missing or wrong. We must not clobber the canonical
        // shape (version/local_path/spaces array etc.) — just set kind.
        // Legacy projects (created before kind existed, like `my-space`)
        // get healed the first time the user opens them in spacedev.
        if (await exists(path)) {
            try {
                const raw = await readTextFile(path);
                const parsed = JSON.parse(raw) as Record<string, unknown>;
                if (parsed.kind === "space-project") return;
                parsed.kind = "space-project";
                parsed.updated = now;
                await writeTextFile(path, JSON.stringify(parsed, null, 2) + "\n");
            } catch {
                /* malformed JSON — leave it alone, don't make it worse */
            }
            return;
        }

        // No manifest yet — write a minimal one. The canonical writer
        // (createProjectStructure) normally beats us to this; this branch
        // only fires for edge cases (manual project import, manifest
        // deleted, etc.).
        const payload = {
            kind: "space-project",
            createdAt: now,
            updatedAt: now,
            spaces: [] as Array<{
                id: string;
                name: string;
                dir: string;
                manifestPath: string;
            }>,
        };
        await writeTextFile(path, JSON.stringify(payload, null, 2) + "\n");
    } catch {
        /* non-fatal — detection still falls back to filesystem scan */
    }
}

watch(
    projectPath,
    (newPath, oldPath) => {
        refreshTree();
        // Flush current session for the previous project before swapping.
        if (oldPath && oldPath !== newPath) saveSession();
        // Restore whatever we persisted for the new project (no-op on first-visit).
        messages.value = [];
        tasks.value = new Map();
        lastSessionId.value = null;
        restoreSession();
    },
    { immediate: false },
);

watch(mode, () => scheduleSave());
watch(messages, () => scheduleSave(), { deep: true });

// Some webviews (notably older Chromium/Tauri builds) still navigate back
// on Backspace when focus isn't in an editable field. Swallow it for this
// page so a stray Backspace outside the chat input doesn't leave the
// Space Developer mid-conversation.
function blockBackspaceNav(e: KeyboardEvent) {
    if (e.key !== "Backspace") return;
    const t = e.target as HTMLElement | null;
    if (!t) return;
    const editable =
        t.isContentEditable ||
        t.tagName === "INPUT" ||
        t.tagName === "TEXTAREA" ||
        t.tagName === "SELECT";
    if (!editable) e.preventDefault();
}

onMounted(async () => {
    // await here so scrollToBottom runs AFTER messages are in the DOM —
    // persisted-history threads should open at the latest turn, not scrolled
    // to the top.
    await restoreSession();
    await nextTick();
    await scrollToBottom();
    await refreshTree();
    window.addEventListener("keydown", blockBackspaceNav, true);

    // Handoff seed: if we were navigated here with ?q=<prompt> (from Builder
    // or Chat's "Switch to Space Developer" button), auto-send so the user
    // doesn't retype. Strip the param first so reloads don't resend.
    const q = route.query.q;
    if (hasProject.value && typeof q === "string" && q.trim()) {
        const seeded = q.trim();
        router.replace({ query: { ...route.query, q: undefined } });
        await send([{ type: "text", content: seeded }]);
    }
});

onUnmounted(() => {
    if (treeRefreshTimer) {
        clearTimeout(treeRefreshTimer);
        treeRefreshTimer = null;
    }
    window.removeEventListener("keydown", blockBackspaceNav, true);
});
</script>

<template>
    <div class="flex flex-col h-full" style="background: var(--app-background); color: var(--app-foreground)">
        <ToolbarSlot name="left">
            <SkillsMenu :skills="loadedRunSkills" :loading="false" />
        </ToolbarSlot>

        <ToolbarSlot name="center">
            <div class="flex items-center gap-2">
                <!-- Current space identifier -->
                <div class="inline-flex items-center gap-2 rounded-md px-2.5 py-1 text-[12px] font-medium max-w-[220px] truncate"
                    style="
                        background: color-mix(
                            in srgb,
                            var(--app-muted) 10%,
                            transparent
                        );
                        color: var(--app-muted);
                        border: 1px solid var(--app-border);
                    " :title="currentSpace
                            ? currentSpace.absPath
                            : 'No space in this project yet'
                        ">
                    <Boxes :size="13" style="color: var(--app-accent)" />
                    <span class="truncate">{{
                        currentSpace?.name ?? "Construct Space"
                        }}</span>
                </div>

                <!-- Space lifecycle actions -->
                <div class="inline-flex items-center gap-0.5 rounded-md p-0.5" style="
                        border: 1px solid var(--app-border);
                        background: var(--app-surface);
                    ">
                    <button type="button" class="toolbar-action" :disabled="!currentSpace || activeAction !== null"
                        title="Build" @click="buildSpace">
                        <Loader2 v-if="activeAction === 'build'" :size="14" class="animate-spin" />
                        <Hammer v-else :size="14" />
                    </button>
                    <button type="button" class="toolbar-action" :disabled="!currentSpace || activeAction !== null"
                        title="Validate manifest" @click="validateSpace">
                        <Loader2 v-if="activeAction === 'validate'" :size="14" class="animate-spin" />
                        <ShieldCheck v-else :size="14" />
                    </button>
                    <button type="button" class="toolbar-action" :disabled="!currentSpace || activeAction !== null"
                        title="Install (builds if needed)" @click="installSpace">
                        <Loader2 v-if="activeAction === 'install'" :size="14" class="animate-spin" />
                        <PackagePlus v-else :size="14" />
                    </button>
                    <button type="button" class="toolbar-action toolbar-action--primary"
                        :disabled="!currentSpace || activeAction !== null" title="Build &amp; open in Preview"
                        @click="runInPreview">
                        <Loader2 v-if="activeAction === 'runner'" :size="14" class="animate-spin" />
                        <Play v-else :size="14" />
                    </button>
                </div>
            </div>
        </ToolbarSlot>

        <ToolbarSlot name="right">
            <div class="flex items-center gap-2">
                <!-- TODO: re-wire to brain telemetry -->
                <ContextGauge v-if="false" :context="null" />
                <CostBadge v-if="false" :cost="null" />
                <div class="inline-flex rounded-md overflow-hidden text-[11px] font-semibold tracking-wider"
                    style="border: 1px solid var(--app-border)">
                    <button type="button" class="px-3 py-1 transition cursor-pointer" :class="mode === 'plan'
                            ? ''
                            : 'hover:bg-white/5 hover:text-[var(--app-foreground)]'
                        " :style="mode === 'plan'
                                ? 'background: var(--app-accent); color: var(--app-accent-foreground)'
                                : 'background: transparent; color: var(--app-muted)'
                            " @click="mode = 'plan'">
                        PLAN
                    </button>
                    <button type="button" class="px-3 py-1 transition cursor-pointer" :class="mode === 'code'
                            ? ''
                            : 'hover:bg-white/5 hover:text-[var(--app-foreground)]'
                        " :style="mode === 'code'
                                ? 'background: var(--app-accent); color: var(--app-accent-foreground)'
                                : 'background: transparent; color: var(--app-muted)'
                            " @click="mode = 'code'">
                        CODE
                    </button>
                </div>
            </div>
        </ToolbarSlot>

        <div class="flex-1 flex min-h-0">
            <div class="flex-1 flex flex-col min-w-0">
                <div ref="chatScrollEl" class="flex-1 overflow-y-auto px-4 py-4 space-y-4">
                    <div v-if="messages.length === 0"
                        class="h-full flex flex-col items-center justify-center gap-4 text-center px-6">
                        <Sparkles :size="28" style="color: var(--app-accent)" />
                        <div class="max-w-md">
                            <p class="text-sm font-medium" style="color: var(--app-foreground)">
                                Build a Construct Space.
                            </p>
                            <p class="text-xs mt-1" style="color: var(--app-muted)">
                                Describe what you want. I'll plan, scaffold,
                                implement, and verify it in the Space Runner.
                            </p>
                        </div>
                        <button v-if="!hasProject" type="button"
                            class="inline-flex items-center gap-2 px-4 py-2 rounded-full text-sm font-medium transition"
                            style="
                                background: var(--app-accent);
                                color: var(--app-accent-foreground);
                            " @click="showCreateModal = true">
                            <FolderPlus :size="14" />
                            Create new Project
                        </button>

                        <div v-if="loadedRunSkills.length > 0" class="w-full max-w-xl mt-2">
                            <div class="flex items-center gap-2 text-[10px] tracking-[0.08em] uppercase font-semibold mb-2"
                                style="color: var(--app-muted)">
                                <Sparkles :size="11" />
                                <span>Loaded skills</span>
                                <span class="px-1.5 py-px rounded-sm font-medium" style="
                                        background: color-mix(
                                            in srgb,
                                            var(--app-accent) 12%,
                                            transparent
                                        );
                                        color: var(--app-accent);
                                    ">{{ loadedRunSkills.length }}</span>
                            </div>
                            <ul class="grid grid-cols-1 sm:grid-cols-2 gap-1.5 text-left">
                                <li v-for="s in loadedRunSkills" :key="s.id" class="px-3 py-2 rounded-md" style="
                                        background: var(--app-surface);
                                        border: 1px solid var(--app-border);
                                    ">
                                    <div class="text-[12px] font-medium truncate" style="color: var(--app-foreground)"
                                        :title="s.id">
                                        {{
                                            s.name ||
                                            s.id.replace(/^space:/, "")
                                        }}
                                    </div>
                                    <div v-if="s.description" class="text-[11px] mt-0.5 line-clamp-2"
                                        style="color: var(--app-muted)">
                                        {{ s.description }}
                                    </div>
                                </li>
                            </ul>
                        </div>
                    </div>

                    <div v-for="msg in messages" :key="msg.id" :class="[
                        'flex',
                        msg.role === 'user'
                            ? 'justify-end'
                            : 'justify-start',
                    ]">
                        <div v-if="msg.role === 'user'"
                            class="max-w-[80%] rounded-lg px-3 py-2 text-sm whitespace-pre-wrap break-words" style="
                                background: var(--app-accent);
                                color: var(--app-accent-foreground);
                            ">
                            {{ msg.content }}
                        </div>
                        <!-- Assistant content is a SEQUENCE of blocks, each styled on
                 its own. No outer card — that caused the "card-in-card"
                 nesting the user flagged. -->
                        <div v-else class="w-full max-w-[85%]">
                            <BlockRenderer :blocks="msg.blocks ??
                                (msg.content
                                    ? [{ type: 'text', text: msg.content }]
                                    : [])
                                " :streaming="!!msg.streaming" :status-text="msg.streaming ? liveStatusText : ''
                                    " :hide-json-text="mode === 'plan'" @plan-action="onPlanAction"
                                @plan-open-doc="onPlanOpenDoc" @question-answer="onQuestionAnswer"
                                @question-update="onQuestionUpdate" @handoff="onHandoff" />
                        </div>
                    </div>

                    <div v-if="errorMsg" class="text-xs px-3 py-2 rounded" style="
                            background: rgba(239, 68, 68, 0.08);
                            color: rgb(239, 68, 68);
                            border: 1px solid rgba(239, 68, 68, 0.25);
                        ">
                        {{ errorMsg }}
                    </div>
                </div>

                <RunControls :streaming="sending" :error="errorMsg" :message-count="messages.length"
                    :can-continue="canContinue" @stop="stopRun" @clear="clearChat" @continue="continueRun" />
                <div v-if="!hasProject" class="px-3 py-3 flex justify-center" style="background: var(--app-background)">
                    <button type="button"
                        class="h-9 shrink-0 rounded-md flex items-center gap-1.5 px-3 text-xs font-medium transition"
                        style="
                            background: var(--app-surface);
                            border: 1px solid var(--app-border);
                            color: var(--app-foreground);
                        " :disabled="sending" title="Create project" @click="showCreateModal = true">
                        <FolderPlus :size="13" />
                        New project
                    </button>
                </div>
                <!-- Top padding so the input doesn't sit flush against the IDLE row. -->
                <div v-else class="pt-2" style="background: var(--app-background)">
                    <AgentInput variant="editorial" :loading="sending" :placeholder="mode === 'plan'
                            ? 'Describe what you want. I\'ll plan only…'
                            : 'Ask or build a Space…'
                        " @send="send" @stop="stopRun" />
                </div>
            </div>

            <aside class="w-64 shrink-0 border-l flex flex-col min-h-0" style="
                    border-color: var(--app-border);
                    background: var(--app-surface);
                ">
                <!-- Live task tracker — populated from task_* tool results.
                     Capped + scrollable so it never crowds out the explorer. -->
                <div
                    v-if="tasks.size > 0"
                    class="max-h-[40%] overflow-y-auto border-b shrink-0"
                    style="border-color: var(--app-border)"
                >
                    <TasksPanel :tasks="tasks" />
                </div>
                <div class="px-3 py-2 text-xs font-semibold flex items-center gap-2 border-b" style="
                        border-color: var(--app-border);
                        color: var(--app-muted);
                    ">
                    <FolderTree :size="13" />
                    <span class="flex-1">Explorer</span>
                    <button type="button" class="p-1 rounded transition disabled:opacity-40"
                        style="color: var(--app-muted)" :disabled="!projectPath || treeLoading" title="Refresh"
                        @click="refreshTreePreserveExpanded">
                        <RefreshCw :size="12" :class="treeLoading ? 'animate-spin' : ''" />
                    </button>
                </div>
                <div class="flex-1 overflow-y-auto p-2 text-sm">
                    <div v-if="treeLoading" class="flex items-center gap-2 px-2 py-1 text-xs"
                        style="color: var(--app-muted)">
                        <Loader2 :size="12" class="animate-spin" />
                        loading…
                    </div>
                    <div v-else-if="fileTree.length === 0" class="text-xs px-2 py-1 italic"
                        style="color: var(--app-muted)">
                        {{ hasProject ? "empty" : "no project" }}
                    </div>
                    <ul v-else class="space-y-0.5">
                        <FileTreeItem v-for="node in fileTree" :key="node.path" :node="node" :depth="0"
                            @toggle="toggleNode" />
                    </ul>
                </div>
            </aside>
        </div>

        <ProjectCreateModal v-model:open="showCreateModal" forced-kind="space-project" @create="handleCreateProject" />
    </div>
</template>

<style scoped>
.toolbar-action {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 26px;
    height: 26px;
    border-radius: 4px;
    color: var(--app-muted);
    transition:
        background 120ms ease,
        color 120ms ease;
}

.toolbar-action:hover:not(:disabled) {
    background: color-mix(in srgb, var(--app-muted) 12%, transparent);
    color: var(--app-foreground);
}

.toolbar-action:disabled {
    opacity: 0.4;
    cursor: not-allowed;
}

.toolbar-action--primary:hover:not(:disabled) {
    background: color-mix(in srgb, var(--app-accent) 15%, transparent);
    color: var(--app-accent);
}
</style>
