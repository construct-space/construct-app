import { createRouter, createWebHashHistory } from 'vue-router'
import { routes } from './routes'
import { authGuard } from './guards'
import { useTelemetry } from '@/composables/useTelemetry'
import { setActiveSpace } from '@/lib/spaceContextBus'

export const router = createRouter({
  history: createWebHashHistory(),
  routes,
})

router.beforeEach(authGuard)

router.afterEach((to) => {
  // Always update active space — clear when leaving /app entirely
  const space = to.path.startsWith('/app') ? detectSpaceFromPath(to.path) : null
  setActiveSpace(space)

  if (!to.path.startsWith('/app')) return
  const telemetry = useTelemetry()
  const spaceId = to.params.spaceName as string | undefined
  const routeName = (to.name as string) ?? to.path
  telemetry.trackScreenView(routeName, spaceId)

  if (space) {
    import('@tauri-apps/api/event').then(({ emit }) => {
      emit('space-changed', { space })
    }).catch(() => { /* not in Tauri */ })
  }
})

function detectSpaceFromPath(path: string): string | null {
  const spaceMatch = path.match(/\/app\/projects\/([^/]+)\/([^/]+)/)
  if (spaceMatch?.[2]) return spaceMatch[2]
  if (path.match(/\/app\/projects(\/[^/]+)?$/)) return 'project'
  const directMatch = path.match(/\/app\/([a-z][\w-]*)/)
  if (directMatch?.[1] && !['settings', 'marketplace', 'onboarding'].includes(directMatch[1])) {
    return directMatch[1]
  }
  return null
}
