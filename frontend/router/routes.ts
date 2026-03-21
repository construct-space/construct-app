import type { RouteRecordRaw } from 'vue-router'
import { SETTINGS_DEFAULT_PATH, settingsRouteChildren } from './settingsNavigation'

/**
 * Routes — fully dynamic space loading.
 *
 * There are NO hardcoded space routes. All spaces (code, design, architect, etc.)
 * are loaded at runtime via DynamicSpacePage + SpaceLoader.
 * This means spaces can be installed/uninstalled from the marketplace
 * without any code changes to the router.
 */

export const routes: RouteRecordRaw[] = [
  // Public routes
  {
    path: '/',
    redirect: '/app',
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
    redirect: '/login',
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

      // Marketplace
      {
        path: 'marketplace',
        name: 'marketplace',
        component: () => import('@/pages/MarketplacePage.vue'),
      },

      // Settings
      {
        path: 'settings',
        component: () => import('@/pages/SettingsPage.vue'),
        children: [
          {
            path: '',
            redirect: SETTINGS_DEFAULT_PATH,
          },
          ...settingsRouteChildren,
        ],
      },

      // ===== Projects (native host pages) =====
      // /app/projects — project list
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
          // /app/projects/:projectId/architect — native architect (feature mode)
          {
            path: 'architect',
            name: 'project-architect',
            component: () => import('@/spaces/architect/pages/ArchitectPage.vue'),
          },
          {
            path: 'vibe',
            name: 'project-vibe',
            component: () => import('@/spaces/vibe/pages/VibePage.vue'),
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
                path: ':subPage',
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

      // ===== Architect (native host page) =====
      // /app/architect — company-scoped architect (new project mode)
      {
        path: 'architect',
        name: 'architect',
        component: () => import('@/spaces/architect/pages/ArchitectPage.vue'),
      },
      {
        path: 'vibe',
        name: 'vibe',
        component: () => import('@/spaces/vibe/pages/VibePage.vue'),
      },

      // ===== Dynamic space routes (company-scoped) =====
      // Remaining spaces (code, design, kanban, etc.) go through DynamicSpacePage.
      // SpaceLoader handles dev (Vite import) vs prod (IIFE bundle) loading.
      // NOTE: "projects" and "architect" are native pages above, so :spaceName won't catch them.
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
            path: ':subPage',
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

  // AI Assistant — opened in a separate Tauri window (popout mode)
  {
    path: '/assistant',
    name: 'assistant-popout',
    component: () => import('@/pages/AssistantPage.vue'),
    meta: { requiresAuth: true },
  },

  // Space preview — opened in a separate Tauri window for dev testing
  {
    path: '/preview/:spaceName',
    component: () => import('@/pages/SpacePreviewPage.vue'),
    props: (route) => ({
      spaceName: route.params.spaceName,
    }),
  },
  {
    path: '/preview/:spaceName/:subPage',
    component: () => import('@/pages/SpacePreviewPage.vue'),
    props: (route) => ({
      spaceName: route.params.spaceName,
      subPage: route.params.subPage,
    }),
  },

  // Catch-all
  {
    path: '/:pathMatch(.*)*',
    redirect: '/app',
  },
]
