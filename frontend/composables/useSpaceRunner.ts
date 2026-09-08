/**
 * Open a space in a standalone window.
 *
 * Two modes:
 *   - Popout: detach any space from the main window for multitasking
 *     openRunner({ spaceId: 'coder', project: '/Users/me/myapp' })
 *
 *   - Preview: test a dev space from its project directory
 *     openRunner({ spaceId: 'myspace', projectPath: '/Users/me/my-space' })
 *
 * Reserved query params:
 *   - dir     → load IIFE from this path (dev preview)
 *   - project → set project context in the window
 */

import { isTauriEnv } from '@/utils/tauri'

export interface SpaceRunnerOptions {
  /** Space ID (from manifest or core space name) */
  spaceId?: string
  /** Dev preview: absolute path to space project directory */
  projectPath?: string
  /** Popout: absolute path to project (sets project context) */
  project?: string
  /**
   * Popout: project ID (slug) for project-aware spaces. When set, the
   * detached window opens at /app/projects/<id>/<spaceId> so the route
   * activates the project-scoped layout (and its projectStore wiring)
   * instead of the root /app/<spaceId> route, which has no project
   * context and would render the space against the wrong (or no)
   * project. Required for builder + space-developer + coder when
   * detached from a project.
   */
  projectId?: string | number
}

export function useSpaceRunner() {
  async function openRunner(opts: SpaceRunnerOptions = {}) {
    const isPopout = !opts.projectPath

    // Popout = "open this space in its own window with the full app
    // behind it." Route through /app/<spaceId> (MainShell + full
    // bootstrap + sidebar + operator) so the user can actually use
    // the space — not the stripped SpaceRunnerPage which has no
    // project store populated, no operator connected, no real nav.
    //
    // Preview = "hot-reload a dev space from a dist/ dir." That keeps
    // the /runner/... path with `?dir=` because the runner page knows
    // how to load the IIFE from disk instead of the installed bundle.
    let route: string
    if (isPopout) {
      if (opts.spaceId && opts.projectId !== undefined && opts.projectId !== '') {
        route = `/app/projects/${opts.projectId}/${opts.spaceId}`
      } else if (opts.spaceId) {
        route = `/app/${opts.spaceId}`
      } else {
        route = '/app'
      }
    } else {
      route = opts.spaceId ? `/runner/${opts.spaceId}` : '/runner'
    }

    const query = new URLSearchParams()
    if (opts.projectPath) query.set('dir', opts.projectPath)
    if (opts.project) query.set('project', opts.project)
    const qs = query.toString()
    if (qs) route += `?${qs}`

    // Router uses hash history — URLs must be /#/route
    const path = `/#${route}`

    // Labels: popouts get `main-<spaceId>` so bootstrapMain's
    // isAppWindow check matches (full bootstrap runs). Dev previews
    // keep `runner-*` so the runner's hot-reload plumbing keys off
    // them. Bootstrap runs for both now, but the label distinction
    // is still meaningful for window enumeration / focus.
    // Project-scoped popouts include projectId in the label so detaching
    // the same space from two different projects gives two windows
    // instead of focus-collapsing into one.
    const label = isPopout
      ? (opts.spaceId
        ? (opts.projectId !== undefined && opts.projectId !== ''
          ? `main-${opts.projectId}-${opts.spaceId}`
          : `main-${opts.spaceId}`)
        : 'main-runner')
      : (opts.spaceId ? `runner-${opts.spaceId}` : 'space-runner')

    if (!isTauriEnv()) {
      window.open(path, label)
      return
    }

    try {
      const { WebviewWindow } = await import('@tauri-apps/api/webviewWindow')

      const existing = await WebviewWindow.getByLabel(label)
      if (existing) {
        await existing.setFocus()
        return
      }

      const win = new WebviewWindow(label, {
        url: path,
        title: isPopout
          ? (opts.spaceId || 'Space')
          : `Space Preview : ${opts.spaceId || 'dev'}`,
        width: isPopout ? 1200 : 1100,
        height: isPopout ? 820 : 750,
        minWidth: 800,
        minHeight: 500,
        center: true,
        decorations: true,
        // Match the main window: traffic lights overlay the content area,
        // no visible title text. Spaces handle clearance via top padding.
        titleBarStyle: 'overlay',
        hiddenTitle: true,
        resizable: true,
        minimizable: true,
        maximizable: true,
      })

      win.once('tauri://error', (e) => {
        console.error('[SpaceRunner] Failed to open window:', e)
      })

      // DevTools no longer auto-open here. The import.meta.env.DEV gate
      // was supposed to scope the behavior to `vite dev`, but released
      // builds hit it too (dev-instance variants, some build configs).
      // Cmd+Alt+I still opens DevTools on demand via useUniversalBootstrap
      // — that's the right place for opt-in access.
    } catch (err) {
      console.error('[SpaceRunner] Error:', err)
    }
  }

  async function closeRunner(spaceId?: string) {
    if (!isTauriEnv()) return
    try {
      const { WebviewWindow } = await import('@tauri-apps/api/webviewWindow')
      // Try both label shapes — popout (main-*) and dev-preview
      // (runner-*) — so a single closeRunner call works regardless
      // of how the window was opened.
      const labels = spaceId
        ? [`main-${spaceId}`, `runner-${spaceId}`]
        : ['main-runner', 'space-runner']
      for (const label of labels) {
        const win = await WebviewWindow.getByLabel(label)
        if (win) await win.close()
      }
    } catch { /* ignore */ }
  }

  return { openRunner, closeRunner }
}
