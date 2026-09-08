/**
 * bootstrapMain
 *
 * Main-window-only bootstrap logic. Called from MainShell.onMounted for every
 * window (because secondary windows currently fall through to MainShell in
 * Phase 3). The early-return guard ensures secondary windows skip all of this.
 *
 * Phases 4/5/6 will give secondary windows their own shells and stop calling
 * bootstrapMain altogether — the guard is temporary scaffolding.
 */

import { getWindowLabel } from '@/lib/window/windowType'
import { initAppPaths } from '@/lib/appPaths'
import { isTauriEnv } from '@/utils/tauri'
import { installKeyGuard } from '@/lib/keyGuard'

// Register handoff contracts as side effects (main window only; detach does
// the same import from bootstrapDetach so both windows have contracts ready)
import '@/spaces/assistant/handoff'

const bootStart = performance.now()

export async function bootstrapMain(): Promise<{ cleanup: () => void }> {
  const label = await getWindowLabel()
  // Every popout that renders MainShell (runner / detach / generic
  // main-*) needs the full bootstrap too — project store, operator,
  // agents, org state. Otherwise the user sees a MainShell template
  // with no data behind it: routes resolve, but clicks don't work
  // because the stores are empty and the operator isn't connected.
  // The only path that skips bootstrap is the preview shell, which
  // isn't selected as MainShell at all (App.vue routes preview-*
  // labels to SpacePreviewShell directly).
  const isAppWindow = !label
    || label === 'main'
    || label.startsWith('main-')
    || label.startsWith('runner-')
    || label === 'space-runner'
    || label.startsWith('detach-space-')
    || label.startsWith('detach-assistant-')
  const isPrimaryAppWindow = !label || label === 'main'

  if (!isAppWindow) {
    return { cleanup: () => {} }
  }

  // Install the key-guard FIRST, before any space bundle can eval. It
  // wraps window + document addEventListener so space key handlers are
  // bypassed when a host input is focused (prevents typing-character
  // hijack and quiet keystroke snooping).
  installKeyGuard()

  const trace = (msg: string) => console.log(`[bootstrapMain] ${msg}`)
  trace('start')

  // --- a. App paths (Tauri invoke — hangs in secondary windows) ---
  await initAppPaths()
  trace('initAppPaths done')

  // --- b. Profile + auth init ---
  try {
    const { useProfileStore } = await import('@/stores/profile')
    const profileStore = useProfileStore()
    await profileStore.init()
    trace(`profileStore.init() done, hasProfiles=${profileStore.hasProfiles}`)

    if (profileStore.hasProfiles) {
      const { useAuthStore } = await import('@/stores/auth')
      const authStore = useAuthStore()
      // Only the primary main window should trigger biometric unlock.
      // Secondary main-*/runner-*/detach-* popouts inherit the already-
      // unlocked session by reading auth.json directly. Without this
      // gate, every detached window prompts Touch ID on open.
      await authStore.initialize({ skipBiometric: !isPrimaryAppWindow })
      trace(`authStore.initialize() done (primary=${isPrimaryAppWindow})`)
    }
  } catch (err) {
    console.warn('[bootstrapMain] Auth/profile init failed:', err)
  }

  // --- b2. Operator boot (fire-and-forget) ---
  // Kicks off start_context_service in parallel with the rest of
  // bootstrap so subsequent brain.request() calls (useLocalStorage,
  // useContextDB, etc.) find a live sidecar. Without this brain was
  // only spawned lazily when AssistantPanel / Onboarding / Settings
  // mounted — every reactive preference initializer logged a noisy
  // "Not connected" error during cold start.
  if (isTauriEnv()) {
    import('@/brain').then(({ useBrain }) => {
      useBrain().connect().catch(err => {
        console.warn('[bootstrapMain] brain connect:', err)
      })
    }).catch(() => {})
  }

  // --- c. Bridge listener (main window only — Rust targets "main" webview) ---
  if (isPrimaryAppWindow && isTauriEnv()) {
    import('@/lib/bridgeListener').then(({ startBridgeListener }) => {
      startBridgeListener().catch(err => {
        console.warn('[bootstrapMain] Bridge listener:', err)
      })
    }).catch(() => {})
  }

  // --- c2. Source device-bus subscription (main window only) ---
  // Subscribes to source-api's /api/device-bus/ws to receive
  // assistant.ask from other devices and scheduler.claim_now from
  // the source scheduler. Migrated 2026-05-20 from delivery's hub
  // (which kept notifications-only responsibility after the move).
  if (isPrimaryAppWindow) {
    // Prime the alarm/timer chime so a scheduled sound notify can play later
    // without a fresh user gesture (it arms on the first interaction).
    import('@/utils/notifySound').then(({ primeNotifySound }) => {
      primeNotifySound()
    }).catch(() => { /* non-fatal */ })
    import('@/composables/useSourceDeviceBus').then(({ startSourceDeviceBus }) => {
      startSourceDeviceBus()
    }).catch(err => {
      console.warn('[bootstrapMain] Source device-bus:', err)
    })
    // Mirror notify-class scheduled tasks into the Rust local alarm scheduler
    // so they ring natively even when the window is closed-to-tray / offline.
    import('@/composables/useLocalAlarmSync').then(({ startLocalAlarmSync }) => {
      startLocalAlarmSync()
    }).catch(err => {
      console.warn('[bootstrapMain] Local alarm sync:', err)
    })
  }

  // --- d. (moved) App menu + deep link are now initialized synchronously
  // at the top of MainShell's <script setup>. Calling lifecycle-hook
  // composables after the awaits above loses the active component instance
  // and produced Vue warnings + non-registering hooks.

  // --- e. Telemetry: session start + startup perf + device snapshot ---
  import('@/composables/useTelemetry').then(({ useTelemetry }) => {
    const t = useTelemetry()
    t.trackSessionStart()
    t.trackPerf('app.startup', performance.now() - bootStart)
    // Fire-and-forget device upsert — needs a Bearer token; skipped silently
    // if the user isn't signed in yet. Idempotent, so next boot tries again.
    t.syncDevice().catch(() => {})
  }).catch(() => {})

  // --- f. Updater ---
  if (isTauriEnv()) {
    import('@/composables/useUpdater').then(({ useUpdater }) => {
      useUpdater().autoCheckOnStartup()
    }).catch(() => {})
  }

  // --- g. Desktop notification permission (deferred to first user gesture) ---
  // macOS WKWebView refuses Notification.requestPermission() without an
  // active user gesture. Attach a one-shot handler that fires on the next
  // click/keydown anywhere in the window.
  if ('Notification' in window && Notification.permission === 'default') {
    const requestOnGesture = () => {
      try { Notification.requestPermission().catch(() => {}) } catch { /* noop */ }
      window.removeEventListener('click', requestOnGesture, true)
      window.removeEventListener('keydown', requestOnGesture, true)
    }
    window.addEventListener('click', requestOnGesture, { capture: true, once: true })
    window.addEventListener('keydown', requestOnGesture, { capture: true, once: true })
  }

  // --- h. Project store (non-blocking) ---
  import('@/stores/project').then(({ useProjectStore }) => {
    useProjectStore().initialize().catch(err => {
      console.warn('[bootstrapMain] Project store init:', err)
    })
  }).catch(() => {})

  // --- i-pre. Cross-window state broadcasts (main → children) ---
  const mainBroadcastUnlistens: ((() => void))[] = []
  if (isPrimaryAppWindow) {
    try {
      const { startMainBroadcasts } = await import('@/lib/crossWindow/mainBroadcast')
      const fns = await startMainBroadcasts()
      mainBroadcastUnlistens.push(...fns)
    } catch (err) {
      console.warn('[bootstrapMain] mainBroadcasts init failed:', err)
    }
  }

  // --- i-pre2a. Detach responder: fields claim requests from detach windows ---
  if (isPrimaryAppWindow) {
    try {
      const { installDetachResponder } = await import('@/lib/crossWindow/sessionHandoff')
      const unlistenResponder = await installDetachResponder()
      mainBroadcastUnlistens.push(unlistenResponder)
    } catch (err) {
      console.warn('[bootstrapMain] detach responder install failed:', err)
    }
  }

  // --- i-pre2b. Session release: re-hydrate main when detach window closes ---
  if (isPrimaryAppWindow) {
    try {
      const { listenForRelease } = await import('@/lib/crossWindow/sessionHandoff')
      const unlistenRelease = await listenForRelease(async () => { /* load already happens inside */ })
      mainBroadcastUnlistens.push(unlistenRelease)
    } catch (err) {
      console.warn('[bootstrapMain] session release listener install failed:', err)
    }
  }

  // --- i-pre2. Forward permission requests from detach windows to local modal ---
  if (isPrimaryAppWindow && isTauriEnv()) {
    try {
      const { listen, channels } = await import('@/lib/crossWindow/sync')
      const { useStreamStatus } = await import('@/composables/useStreamStatus')
      type PEv = import('@/composables/useStreamStatus').PermissionRequestEvent
      const unlisten = await listen<PEv>(channels.permission, (perm) => {
        useStreamStatus().pendingPermission.value = perm
      })
      mainBroadcastUnlistens.push(unlisten)
    } catch (err) {
      console.warn('[bootstrapMain] permission forward listener failed:', err)
    }
  }

  // --- i. Preload space actions + signal brain ---
  // Core (host-native) providers first, then dynamic-space lazy providers,
  // so the actions_ready signal means the full directory is registered.
  import('@/space_loader/SpaceLoader').then(async ({ preloadSpaceActions }) => {
    const { registerCoreSpaceProviders } = await import('@/lib/coreSpaceProviders')
    await registerCoreSpaceProviders()
    await preloadSpaceActions()
    const { useBrain } = await import('@/brain')
    useBrain().request('spaces.actions_ready', {}).catch(() => {})
  }).catch(() => {})

  // --- j. Window-resize → chrome state ---
  let unlistenResize: (() => void) | null = null
  if (isTauriEnv()) {
    try {
      const { getCurrentWindow } = await import('@tauri-apps/api/window')
      const { useWindowChromeState } = await import('@/composables/useWindowChromeState')
      const { setWindowChromeHidden } = useWindowChromeState()

      // Entering macOS fullscreen must NOT strip the app chrome — the
      // sidebar, toolbar, and title bar stay visible (product decision).
      // Previously this hid chrome whenever the window reported fullscreen;
      // now we keep it shown regardless. The chrome-hidden state stays
      // available for popout/preview windows that opt out elsewhere.
      const syncChrome = () => { setWindowChromeHidden(false) }

      unlistenResize = await getCurrentWindow().onResized(() => { syncChrome() })
      syncChrome()
    } catch (e) {
      console.error('[bootstrapMain] Failed to wire window chrome listener:', e)
    }
  }

  // --- k. Focus/blur → construct events ---
  let unlistenFocus: (() => void) | null = null
  if (isTauriEnv()) {
    try {
      const { getCurrentWindow } = await import('@tauri-apps/api/window')
      unlistenFocus = await getCurrentWindow().onFocusChanged(({ payload: focused }) => {
        window.dispatchEvent(new Event(focused ? 'construct:window-focus' : 'construct:window-blur'))
      })
    } catch (e) {
      console.error('[bootstrapMain] Failed to setup focus listener:', e)
    }
  }

  trace('done')

  return {
    cleanup: () => {
      unlistenResize?.()
      unlistenFocus?.()
      for (const fn of mainBroadcastUnlistens) fn()
    },
  }
}
