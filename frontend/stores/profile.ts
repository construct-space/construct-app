/**
 * Profile store — manages multi-profile system.
 *
 * Profiles are account-driven: each profile maps to an accounts UUID.
 * No profiles exist until the user logs in. Profile switching is reactive.
 */
import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import {
  clearProfileStorage,
  setActiveProfileId,
  migrateLocalStorage,
} from '@/lib/profileStorage'
import { emitProfileChanged } from '@/lib/profileEvents'

export interface Profile {
  id: string
  name: string
  email?: string
  avatar?: string
  created_at?: string
}

export const useProfileStore = defineStore('profile', () => {
  const profiles = ref<Profile[]>([])
  const activeProfileId = ref<string>('')
  const loading = ref(false)
  const initialized = ref(false)

  const activeProfile = computed(() =>
    profiles.value.find(p => p.id === activeProfileId.value) || null,
  )

  const hasMultipleProfiles = computed(() => profiles.value.length > 1)
  const hasProfiles = computed(() => profiles.value.length > 0)

  async function notifyOperatorProfileSwitch(profileId: string) {
    try {
      const { useBrain } = await import('@/brain')
      const brain = useBrain()
      await brain.request('profile.switch', { id: profileId })
    } catch { /* brain may not be reachable */ }
  }

  async function afterActiveProfileChanged(profileId: string) {
    // Re-init app paths first so every reload below reads the new profile's
    // profile-scoped spaces/settings directories.
    try {
      const { initAppPaths } = await import('@/lib/appPaths')
      await initAppPaths()
    } catch { /* best effort */ }

    try {
      const { resetDynamicSpacesForProfileSwitch, preloadSpaceActions } = await import('@/space_loader/SpaceLoader')
      resetDynamicSpacesForProfileSwitch()
      // Re-register the NEW profile's lazy action providers (the reset just
      // dropped the old profile's), then tell brain to rebuild its
      // installed-spaces directory — otherwise the assistant serves the
      // previous profile's catalog until its cache TTL expires.
      await preloadSpaceActions()
      const { useBrain } = await import('@/brain')
      await useBrain().request('spaces.reload')
    } catch { /* best effort */ }

    void emitProfileChanged(profileId)
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('construct:spaces-changed'))
    }
  }

  /** Initialize: load profiles from Tauri/operator. */
  async function init() {
    if (initialized.value) return
    loading.value = true

    try {
      const { invoke } = await import('@tauri-apps/api/core')
      const registry = await invoke<{
        version: number
        active_profile: string | null
        profiles: Profile[]
      }>('list_profiles')

      profiles.value = registry.profiles || []
      activeProfileId.value = registry.active_profile || ''

      if (activeProfileId.value) {
        setActiveProfileId(activeProfileId.value)
        migrateLocalStorage(activeProfileId.value)
        // Theme refs were initialized at module-eval time against the
        // 'default' profile namespace; rehydrate now that the real
        // profile id is set, otherwise the persisted theme is lost on reload.
        const { reloadThemeFromStorage } = await import('@/composables/useAppTheme')
        reloadThemeFromStorage()
      }

      initialized.value = true
    } catch (e) {
      console.warn('[Profile] init failed (non-Tauri?):', e)
      activeProfileId.value = ''
      initialized.value = true
    } finally {
      loading.value = false
    }
  }

  /** Create a profile with a specific ID (accounts UUID). */
  async function createProfile(id: string, name: string, email?: string, avatar?: string): Promise<Profile | null> {
    try {
      const { invoke } = await import('@tauri-apps/api/core')
      await invoke<string>('create_profile', {
        profileId: id,
        name,
        email: email || null,
        avatar: avatar || null,
      })

      const profile: Profile = { id, name, email, avatar }
      // Add to list if not already there
      if (!profiles.value.find(p => p.id === id)) {
        profiles.value = [...profiles.value, profile]
      }
      await notifyOperatorProfileSwitch(id)
      activeProfileId.value = id
      setActiveProfileId(id)
      migrateLocalStorage(id)
      const { reloadThemeFromStorage: reloadTheme1 } = await import('@/composables/useAppTheme')
      reloadTheme1()
      await afterActiveProfileChanged(id)

      return profile
    } catch (e) {
      console.error('[Profile] create failed:', e)
      return null
    }
  }

  /** Switch to a different profile. Reactively re-initializes auth. */
  async function switchProfile(profileId: string) {
    try {
      const { invoke } = await import('@tauri-apps/api/core')
      await invoke('switch_profile', { profileId })
      await notifyOperatorProfileSwitch(profileId)
      activeProfileId.value = profileId
      setActiveProfileId(profileId)
      migrateLocalStorage(profileId)
      const { reloadThemeFromStorage: reloadTheme2 } = await import('@/composables/useAppTheme')
      reloadTheme2()
      await afterActiveProfileChanged(profileId)

      // Drop the cached settings store so the next read rebinds to the
      // newly-active profile's construct-settings.json — otherwise we'd
      // keep writing to the previous profile's file.
      try {
        const { resetTauriStore } = await import('@/composables/useTauriStore')
        await resetTauriStore()
      } catch { /* best effort */ }

      // Reset org store for the new profile
      try {
        const { useOrgStore } = await import('@/stores/org')
        useOrgStore().onProfileSwitch()
      } catch { /* org store may not be initialized */ }

      // Drop the previous profile's cached server preferences (editor/theme
      // settings) so they don't leak into the new profile's session.
      try {
        const { usePreferencesStore } = await import('@/stores/preferences')
        usePreferencesStore().onProfileSwitch()
      } catch { /* preferences store may not be initialized */ }

      // Re-initialize auth for the new profile (reactive, no reload)
      const { useAuthStore } = await import('@/stores/auth')
      const authStore = useAuthStore()
      authStore.clearAuthState()
      await authStore.initialize()

      // Reload profile-scoped stores
      try {
        const { usePinnedStore } = await import('@/stores/pinned')
        const pinnedStore = usePinnedStore()
        pinnedStore.items = []
        await pinnedStore.init()
      } catch { /* pinned store may not be ready */ }

      // Rebind the notifications inbox to the new profile's token — the
      // module-scoped poll timer + Tauri listeners otherwise keep streaming
      // the previous user's notifications. Restart after auth re-init so the
      // new token is in place.
      try {
        const { useNotifications } = await import('@/composables/useNotifications')
        const notif = useNotifications()
        await notif.stop()
        await notif.start()
      } catch { /* notifications may not be active */ }

    } catch (e) {
      console.error('[Profile] switch failed:', e)
      throw e
    }
  }

  /** Rename profile ID (migrate random UUID → accounts UUID). */
  async function renameProfile(oldId: string, newId: string): Promise<boolean> {
    try {
      const { invoke } = await import('@tauri-apps/api/core')
      await invoke<string>('rename_profile', { oldId, newId })

      // Update local state
      const profile = profiles.value.find(p => p.id === oldId)
      if (profile) {
        profile.id = newId
      }
      if (activeProfileId.value === oldId) {
        activeProfileId.value = newId
        setActiveProfileId(newId)
        // Tell brain the active profile dir changed BEFORE letting the
        // rest of the app rebind. Brain's profile.switch rebinds skills,
        // hooks, and paths against the renamed dir so subsequent wire
        // ops read auth/providers/skills from the right place.
        await notifyOperatorProfileSwitch(newId)
        await afterActiveProfileChanged(newId)
      }

      return true
    } catch (e) {
      console.error('[Profile] rename failed:', e)
      return false
    }
  }

  /** Delete a profile (cannot delete active or last). */
  async function deleteProfile(profileId: string) {
    try {
      // Brain currently stubs profile.delete; the real deletion lives
      // in the desktop bridge. Wire it through brain for surface
      // consistency — once the desktop side implements a Tauri command
      // we can swap this to invoke() without touching callers.
      const { useBrain } = await import('@/brain')
      const brain = useBrain()
      await brain.request('profile.delete', { id: profileId })
      clearProfileStorage(profileId)
      profiles.value = profiles.value.filter(p => p.id !== profileId)
    } catch (e) {
      console.error('[Profile] delete failed:', e)
      throw e
    }
  }

  return {
    profiles,
    activeProfileId,
    activeProfile,
    hasMultipleProfiles,
    hasProfiles,
    loading,
    initialized,

    init,
    createProfile,
    switchProfile,
    renameProfile,
    deleteProfile,
  }
})
