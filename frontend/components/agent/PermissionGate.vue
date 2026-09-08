<script setup lang="ts">
/**
 * PermissionGate — brain-native permission modal.
 *
 * Registers `permission.request` on the brain bridge at mount; brain's
 * permission gate (mode = "ask") fires the bridge call mid-tool, which
 * pops this modal. User clicks Allow / Always Allow / Deny → resolves
 * the bridge promise with `{allow, reason}`. Brain's tool execution
 * unblocks and either runs the tool or surfaces the deny reason as the
 * tool's error output.
 *
 * Mount once in MainShell (or any always-on shell). Multiple instances
 * is fine — last register wins; bridge.unregister on unmount cleans up.
 *
 * "Always Allow" persists per-tool in localStorage so the gate skips
 * future prompts for that tool name in this profile. Cleared via
 * Settings → Permissions (TODO).
 */
import { ref, onMounted, onBeforeUnmount } from 'vue'
import { ShieldAlert, Check, X } from 'lucide-vue-next'
import { useBrainBridge } from '@/brain/bridge'

interface PendingRequest {
  tool: string
  input: unknown
  /** Resolver bound when brain calls; flipped by the click handlers. */
  resolve: (response: { allow: boolean; reason?: string }) => void
}

const pending = ref<PendingRequest | null>(null)
const bridge = useBrainBridge()

const ALWAYS_ALLOW_KEY = 'brain.permission.always_allow'

function loadAlwaysAllow(): Set<string> {
  try {
    const raw = localStorage.getItem(ALWAYS_ALLOW_KEY)
    if (!raw) return new Set()
    const arr = JSON.parse(raw) as string[]
    return new Set(Array.isArray(arr) ? arr : [])
  } catch {
    return new Set()
  }
}

function saveAlwaysAllow(set: Set<string>) {
  try {
    localStorage.setItem(ALWAYS_ALLOW_KEY, JSON.stringify([...set]))
  } catch {
    // localStorage may be unavailable (private mode, quota); the
    // user just has to re-allow each turn. Not worth surfacing.
  }
}

function formatInput(input: unknown): string {
  if (input == null) return ''
  if (typeof input === 'string') return input
  try {
    return JSON.stringify(input, null, 2)
  } catch {
    return String(input)
  }
}

function respond(allow: boolean, remember = false) {
  if (!pending.value) return
  const { tool, resolve } = pending.value
  pending.value = null
  if (allow && remember) {
    const set = loadAlwaysAllow()
    set.add(tool)
    saveAlwaysAllow(set)
  }
  resolve({ allow, reason: allow ? undefined : 'user denied' })
}

onMounted(() => {
  bridge.register('permission.request', async (params) => {
    const tool = (params.tool as string) || 'unknown'
    const input = params.input
    // Short-circuit when this tool is on the user's always-allow list.
    // Saves a render + click for the common "yeah, I trust git_status" case.
    if (loadAlwaysAllow().has(tool)) {
      return { allow: true }
    }
    return await new Promise<{ allow: boolean; reason?: string }>((resolve) => {
      pending.value = { tool, input, resolve }
    })
  })
})

onBeforeUnmount(() => {
  bridge.unregister('permission.request')
  // If the modal was open at unmount, deny so brain doesn't hang.
  if (pending.value) {
    pending.value.resolve({ allow: false, reason: 'permission host unmounted' })
    pending.value = null
  }
})
</script>

<template>
  <Teleport to="body">
    <Transition name="fade">
      <div
        v-if="pending"
        class="fixed inset-0 z-[9000] flex items-center justify-center p-4"
      >
        <!-- Click backdrop = deny. Keeps a panicked-user escape hatch. -->
        <div class="absolute inset-0 bg-black/50" @click="respond(false)" />
        <div
          class="relative bg-[var(--app-background)] border border-[var(--app-border)] rounded-xl shadow-2xl w-full max-w-md overflow-hidden"
        >
          <div class="flex items-center gap-3 px-5 py-4 border-b border-[var(--app-border)]">
            <div class="size-10 rounded-lg bg-amber-500/10 flex items-center justify-center shrink-0">
              <ShieldAlert class="size-5 text-amber-400" />
            </div>
            <div>
              <h3 class="text-sm font-semibold text-[var(--app-foreground)]">Permission required</h3>
              <p class="text-xs text-[var(--app-muted)]">Brain wants to use a tool that may modify your project.</p>
            </div>
          </div>

          <div class="px-5 py-4 space-y-3">
            <p class="text-sm text-[var(--app-foreground)]">
              Allow
              <span class="font-mono text-[var(--app-accent)] font-medium">{{ pending.tool }}</span>
              to run?
            </p>
            <div
              v-if="formatInput(pending.input)"
              class="rounded-lg bg-black/5 dark:bg-white/5 px-3 py-2 max-h-[180px] overflow-y-auto"
            >
              <pre class="text-[11px] text-[var(--app-muted)] whitespace-pre-wrap break-all font-mono">{{ formatInput(pending.input) }}</pre>
            </div>
          </div>

          <div class="flex items-center gap-2 px-5 py-3 border-t border-[var(--app-border)]">
            <button
              class="flex-1 flex items-center justify-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium bg-emerald-500 text-white hover:bg-emerald-600 transition-colors"
              @click="respond(true, false)"
            >
              <Check class="size-4" />
              Allow once
            </button>
            <button
              class="flex-1 flex items-center justify-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium border border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/10 transition-colors"
              @click="respond(true, true)"
            >
              <Check class="size-4" />
              Always allow
            </button>
            <button
              class="flex-1 flex items-center justify-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium border border-red-500/30 text-red-400 hover:bg-red-500/10 transition-colors"
              @click="respond(false)"
            >
              <X class="size-4" />
              Deny
            </button>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.12s ease;
}
.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}
</style>
