import type { RouteRecordRaw } from 'vue-router'
import { SETTINGS_DEFAULT_PATH, settingsRouteChildren } from './settingsNavigation'

/**
 * Routes — hybrid space loading.
 *
 * Host-native spaces (architect, ask, coder, project) have explicit
 * routes that import their page components at compile time. They are NOT
 * loaded through DynamicSpacePage.
 *
 * Dynamic spaces (installed from marketplace or linked via `construct dev`)
 * use the catch-all `:spaceName` route and render through DynamicSpacePage +
 * SpaceLoader. This means dynamic spaces can be installed/uninstalled
 * without any code changes to the router.
 */

export const routes: RouteRecordRaw[] = [
  // Public routes
  {
    path: '/',
    redirect: '/app',
  },
  {
    // Legacy: the profile picker lived at /profiles. LoginPage now hosts the
    // unified picker + sign-in flow, so any deep-link or stale Sidebar entry
    // lands on /login (with ?switch=1 so an authenticated session doesn't
    // get auto-bounced into /app).
    path: '/profiles',
    name: 'profiles',
    redirect: '/login?switch=1',
  },
  {
    path: '/login',
    name: 'login',
    component: () => import('@/pages/auth/LoginPage.vue'),
    meta: { guest: true },
  },
  {
    path: '/register',
    name: 'register',
    component: () => import('@/pages/auth/RegisterPage.vue'),
    meta: { guest: true },
  },
  {
    path: '/oauth/callback',
    name: 'oauth-callback',
    component: () => import('@/pages/auth/OAuthCallbackPage.vue'),
    meta: { guest: true },
  },
  {
    path: '/forgot-password',
    name: 'forgot-password',
    component: () => import('@/pages/auth/ForgotPasswordPage.vue'),
    meta: { guest: true },
  },
  {
    path: '/reset-password',
    name: 'reset-password',
    component: () => import('@/pages/auth/ResetPasswordPage.vue'),
    meta: { guest: true },
  },

  // Onboarding (first-time space picker)
  {
    path: '/onboarding',
    name: 'onboarding',
    component: () => import('@/pages/OnboardingPage.vue'),
    meta: { requiresAuth: true },
  },

  // App routes (authenticated)
  {
    path: '/app',
    component: () => import('@/layouts/DefaultLayout.vue'),
    meta: { requiresAuth: true },
    children: [
      // Home — recent projects
      {
        path: '',
        name: 'home',
        component: () => import('@/pages/HomePage.vue'),
      },

      // All Spaces (Launchpad grid)
      {
        path: 'spaces',
        name: 'spaces',
        component: () => import('@/pages/SpacesPage.vue'),
      },

      // Marketplace (rebranded as Space Store in UI; route + name kept
      // for deep-link compatibility).
      {
        path: 'marketplace',
        name: 'marketplace',
        component: () => import('@/pages/MarketplacePage.vue'),
      },
      {
        path: 'marketplace/spaces/:id',
        name: 'marketplace-space-detail',
        component: () => import('@/pages/MarketplaceSpaceDetail.vue'),
        props: true,
      },
      {
        path: 'marketplace/collections/:slug',
        name: 'marketplace-collection-detail',
        component: () => import('@/pages/MarketplaceCollectionDetail.vue'),
        props: true,
      },
      // Intermediate /collections and /spaces paths exist as breadcrumb
      // segments but have no standalone page — fold them back to the
      // Space Store home so clicking a breadcrumb crumb works instead of
      // falling through to the dynamic-space catch-all below.
      { path: 'marketplace/collections', redirect: '/app/marketplace' },
      { path: 'marketplace/spaces', redirect: '/app/marketplace' },

      // Settings — switches layout based on org membership
      {
        path: 'settings',
        component: () => import('@/pages/SettingsRouter.vue'),
        children: [
          {
            path: '',
            redirect: SETTINGS_DEFAULT_PATH,
          },
          ...settingsRouteChildren,
          // Org detail pages (third-level deep within settings)
          {
            path: 'org-members/:id',
            component: () => import('@/spaces/org/pages/members/[id].vue'),
            props: true,
          },
          {
            path: 'org-departments/:id',
            component: () => import('@/spaces/org/pages/departments/[id].vue'),
            props: true,
          },
          {
            path: 'org-teams/:id',
            component: () => import('@/spaces/org/pages/teams/[id].vue'),
            props: true,
          },
        ],
      },

      // ===== Developer Portal (native host page) =====
      // /app/developer — entry point for enrolled developers. Lists the
      // two paths (Builder, SpaceKit) and the user's project grid. The
      // sidebar gate (useDeveloperGate) keeps non-developers out of this
      // route; the guard in router/guards.ts redirects them away if they
      // land here via a deep link.
      {
        path: 'developer',
        name: 'developer-portal',
        component: () => import('@/spaces/developer/pages/DeveloperPortal.vue'),
        meta: { requiresDeveloper: true },
      },

      // ===== Projects (native host pages) =====
      // /app/projects — project list (legacy entry point — survives so
      // existing deeplinks and project-detail subroutes keep working
      // until Phase 2 of the developer-portal rebrand).
      {
        path: 'projects',
        name: 'projects',
        component: () => import('@/spaces/project/pages/ProjectsPage.vue'),
      },

      // /app/projects/:projectId — project detail + project-scoped spaces
      {
        path: 'projects/:projectId',
        component: () => import('@/layouts/ProjectLayout.vue'),
        meta: { projectScoped: true },
        children: [
          // /app/projects/:projectId — project overview
          {
            path: '',
            name: 'project-detail',
            component: () => import('@/spaces/project/pages/ProjectDetailPage.vue'),
          },
          // /app/projects/:projectId/space-developer — Space Developer (Construct Spaces)
          {
            path: 'space-developer',
            name: 'project-space-developer',
            component: () => import('@/spaces/space-developer/pages/SpaceDeveloperPage.vue'),
          },
          // /app/projects/:projectId/builder — Builder (general software)
          {
            path: 'builder',
            name: 'project-builder',
            component: () => import('@/spaces/builder/pages/BuilderPage.vue'),
          },
          // /app/projects/:projectId/tui — TUI apps (Claude Code, Codex, etc.)
          {
            path: 'tui',
            name: 'project-tui',
            component: () => import('@/spaces/tui/pages/TUIPage.vue'),
          },
          // /app/projects/:projectId/:spaceName — space within project
          {
            path: ':spaceName',
            component: () => import('@/layouts/SpaceLayout.vue'),
            children: [
              {
                path: '',
                component: () => import('@/space_loader/DynamicSpacePage.vue'),
                props: (route) => ({
                  spaceName: route.params.spaceName,
                  projectId: route.params.projectId,
                }),
              },
              {
                path: ':subPage(.*)',
                component: () => import('@/space_loader/DynamicSpacePage.vue'),
                props: (route) => ({
                  spaceName: route.params.spaceName,
                  subPage: route.params.subPage,
                  projectId: route.params.projectId,
                }),
              },
            ],
          },
        ],
      },

      // ===== Org Projects (native host pages) =====
      // /app/org-project — org project list
      {
        path: 'org-project',
        name: 'org-projects',
        component: () => import('@/spaces/org-project/pages/OrgProjectsPage.vue'),
        meta: { requiresDeveloper: true },
      },

      // /app/org-project/:projectId — org project detail + project-scoped spaces
      {
        path: 'org-project/:projectId',
        component: () => import('@/layouts/OrgProjectLayout.vue'),
        meta: { orgProjectScoped: true, requiresDeveloper: true },
        children: [
          // /app/org-project/:projectId — org project overview
          {
            path: '',
            name: 'org-project-detail',
            component: () => import('@/spaces/org-project/pages/OrgProjectDetailPage.vue'),
            props: true,
          },
          // /app/org-project/:projectId/:spaceName — space within org project
          {
            path: ':spaceName',
            component: () => import('@/layouts/SpaceLayout.vue'),
            children: [
              {
                path: '',
                component: () => import('@/space_loader/DynamicSpacePage.vue'),
                props: (route) => ({
                  spaceName: route.params.spaceName,
                  projectId: route.params.projectId,
                }),
              },
              {
                path: ':subPage(.*)',
                component: () => import('@/space_loader/DynamicSpacePage.vue'),
                props: (route) => ({
                  spaceName: route.params.spaceName,
                  subPage: route.params.subPage,
                  projectId: route.params.projectId,
                }),
              },
            ],
          },
        ],
      },

      // ===== Core spaces (native host pages) =====
      {
        path: 'ask',
        name: 'ask',
        component: () => import('@/spaces/ask/pages/AskPage.vue'),
      },
      // Space Developer — specialized for Construct Spaces
      {
        path: 'space-developer',
        name: 'space-developer',
        component: () => import('@/spaces/space-developer/pages/SpaceDeveloperPage.vue'),
      },
      // Builder — general-purpose plan+code agent (sites, apps, anything)
      {
        path: 'builder',
        name: 'builder',
        component: () => import('@/spaces/builder/pages/BuilderPage.vue'),
      },
      // TUI — interactive CLI tools
      {
        path: 'tui',
        name: 'tui',
        component: () => import('@/spaces/tui/pages/TUIPage.vue'),
      },
      // ===== Dynamic space routes (company-scoped) =====
      // Remaining spaces (code, design, kanban, etc.) go through DynamicSpacePage.
      // SpaceLoader handles dev (Vite import) vs prod (IIFE bundle) loading.
      // NOTE: host-native spaces (architect, ask, coder, project) have explicit routes above.
      {
        path: ':spaceName',
        component: () => import('@/layouts/SpaceLayout.vue'),
        children: [
          {
            path: '',
            component: () => import('@/space_loader/DynamicSpacePage.vue'),
            props: (route) => ({
              spaceName: route.params.spaceName,
            }),
          },
          {
            path: ':subPage(.*)',
            component: () => import('@/space_loader/DynamicSpacePage.vue'),
            props: (route) => ({
              spaceName: route.params.spaceName,
              subPage: route.params.subPage,
            }),
          },
        ],
      },
    ],
  },

  // AI Assistant — legacy route; redirect to new detach path (one release of grace)
  {
    path: '/assistant',
    redirect: '/detach/assistant',
  },

  // Detach windows — assistant and space popouts
  {
    path: '/detach/assistant',
    component: () => import('@/shells/DetachShell.vue'),
  },
  {
    path: '/detach/space/:spaceId',
    component: () => import('@/shells/DetachShell.vue'),
    props: true,
  },
  {
    path: '/detach/space/:spaceId/:subPage(.*)',
    component: () => import('@/shells/DetachShell.vue'),
    props: true,
  },

  // Space preview — single route with optional subPage so navigating
  // between pages inside the space doesn't switch route records and
  // remount the shell (which would throw away the sidebar + re-download
  // the IIFE). subPage is a catchall (.*) with a trailing ? to match
  // both `/preview/pm` and `/preview/pm/tasks/abc`.
  {
    path: '/preview/:spaceName/:subPage(.*)?',
    component: () => import('@/shells/SpacePreviewShell.vue'),
    props: true,
  },

  // Web preview — host an external URL in a device-sized child webview
  {
    path: '/preview-web',
    component: () => import('@/shells/WebPreviewShell.vue'),
  },

  // Space Runner — standalone space window (popout or dev preview)
  // ?dir=path   → dev preview: load IIFE from project dir
  // ?project=path → popout: set project context
  //
  // Same single-route collapsing as /preview: optional spaceName +
  // optional subPage so the runner keeps state across navigations
  // inside the same space instead of remounting on every link click.
  {
    path: '/runner/:spaceName?/:subPage(.*)?',
    component: () => import('@/pages/SpaceRunnerPage.vue'),
    props: (route) => ({
      spaceName: (route.params.spaceName as string) || null,
      subPage: route.params.subPage,
      projectPath: route.query.dir as string | undefined,
      project: route.query.project as string | undefined,
    }),
  },

  // Catch-all
  {
    path: '/:pathMatch(.*)*',
    redirect: '/app',
  },
]
