import { defineStore } from 'pinia'
import { useSource } from '@/composables/useSource'
import type { Setting, SettingUpdate } from '~/types'

interface SettingsState {
  settings: Setting[]
  isLoading: boolean
  isSaving: boolean
  error: string | null
}

export const useSettingsStore = defineStore('settings', {

  state: (): SettingsState => ({
    settings: [],
    isLoading: false,
    isSaving: false,
    error: null
  }),

  getters: {
    getByGroup: (state: SettingsState) => (group: string) =>
      state.settings.filter((s: Setting) => s.group === group),

    getByKey: (state: SettingsState) => (key: string) =>
      state.settings.find((s: Setting) => s.setting_key === key),

    systemSettings: (state: SettingsState) =>
      state.settings.filter((s: Setting) => s.group === 'system'),

    emailSettings: (state: SettingsState) =>
      state.settings.filter((s: Setting) => s.group === 'email'),

    mediaSettings: (state: SettingsState) =>
      state.settings.filter((s: Setting) => s.group === 'media'),

    securitySettings: (state: SettingsState) =>
      state.settings.filter((s: Setting) => s.group === 'security'),

    aiSettings: (state: SettingsState) =>
      state.settings.filter((s: Setting) => s.group === 'ai'),

    maintenanceMode: (state: SettingsState) =>
      state.settings.find((s: Setting) => s.setting_key === 'maintenance_mode')?.value_bool || false,

    timezone: (state: SettingsState) =>
      state.settings.find((s: Setting) => s.setting_key === 'timezone')?.value_string || 'UTC',

    aiEnabled: (state: SettingsState) =>
      state.settings.find((s: Setting) => s.setting_key === 'ai_enabled')?.value_bool ?? true,

    collaborationSettings: (state: SettingsState) =>
      state.settings.filter((s: Setting) => s.group === 'collaboration'),

    companySettings: (state: SettingsState) =>
      state.settings.filter((s: Setting) => s.group === 'company'),
  },

  actions: {
    // Fetch all settings
    async fetchSettings() {
      const authStore = useAuthStore()
      if (!authStore.isAuthenticated || !authStore.token) {
        return
      }

      this.isLoading = true
      this.error = null

      try {
        const source = useSource()
        const response = await source.get<{ data: Record<string, unknown> }>('/settings')

        // Source returns flat key-value settings — convert to Setting[] for compatibility
        const data = response.data || {}
        this.settings = Object.entries(data).map(([key, value], i) => ({
          id: i + 1,
          setting_key: key,
          value_string: String(value),
          value_bool: typeof value === 'boolean' ? value : null,
          group: 'system',
        })) as Setting[]
      } catch (error: unknown) {
        const msg = (error as Error).message || ''
        if (!msg.includes('404')) {
          this.error = msg || 'Failed to fetch settings'
          console.error('Error fetching settings:', error)
        }
      } finally {
        this.isLoading = false
      }
    },

    // Update a setting
    async updateSetting(id: number, data: SettingUpdate) {
      this.isSaving = true
      this.error = null

      try {
        const api = useApi()
        const response = await api.put(`/settings/${id}`, data)

        // Update the setting in the store
        const index = this.settings.findIndex((s: Setting) => s.id === id)
        if (index !== -1) {
          this.settings[index] = { ...this.settings[index], ...(response as Setting) }
        }

        return response
      } catch (error: unknown) {
        this.error = error as string || 'Failed to update setting'
        console.error('Error updating setting:', error)
        throw error
      } finally {
        this.isSaving = false
      }
    },

    // Update multiple settings (bulk update)
    async updateSettings(updates: Array<{ id: number; data: SettingUpdate }>) {
      this.isSaving = true
      this.error = null

      try {
        const api = useApi()
        const promises = updates.map(({ id, data }) =>
          api.put(`/settings/${id}`, data)
        )

        const responses = await Promise.all(promises)

        // Update settings in the store
        responses.forEach((response, index) => {
          const update = updates[index]
          if (update) {
            const settingIndex = this.settings.findIndex((s: Setting) => s.id === update.id)
            if (settingIndex !== -1 && response) {
              const setting = this.settings[settingIndex]
              if (setting) {
                Object.assign(setting, response as Partial<Setting>)
              }
            }
          }
        })

        return responses
      } catch (error: unknown) {
        this.error = error as string || 'Failed to update settings'
        console.error('Error updating settings:', error)
        throw error
      } finally {
        this.isSaving = false
      }
    },

    // Update system settings
    async updateSystemSettings(formData: {
      timezone: string
      date_format: string
      time_format: string
      maintenance_mode: boolean
    }) {
      const updates: Array<{ id: number; data: SettingUpdate }> = []

      // Handle string settings
      const stringKeys = ['timezone', 'date_format', 'time_format'] as const
      for (const key of stringKeys) {
        const setting = this.settings.find((s: Setting) => s.setting_key === key && s.group === 'system')
        if (setting) {
          updates.push({
            id: setting.id,
            data: {
              setting_key: key,
              label: setting.label,
              group: 'system',
              type: 'string',
              value_string: formData[key],
              description: setting.description,
              is_public: setting.is_public
            }
          })
        }
      }

      // Handle boolean settings
      const maintenanceSetting = this.settings.find((s: Setting) => s.setting_key === 'maintenance_mode' && s.group === 'system')
      if (maintenanceSetting) {
        updates.push({
          id: maintenanceSetting.id,
          data: {
            setting_key: 'maintenance_mode',
            label: maintenanceSetting.label,
            group: 'system',
            type: 'bool',
            value_bool: formData.maintenance_mode,
            description: maintenanceSetting.description,
            is_public: maintenanceSetting.is_public
          }
        })
      }

      return this.updateSettings(updates)
    },

    // Update email settings
    async updateEmailSettings(formData: {
      email_from_name: string
      email_signature: string
    }) {
      const updates = Object.entries(formData).map(([key, value]) => {
        const setting = this.settings.find((s: Setting) => s.setting_key === key)
        if (setting) {
          return {
            id: setting.id,
            data: {
              setting_key: key,
              label: setting.label,
              group: 'email',
              type: 'string',
              value_string: value,
              description: setting.description,
              is_public: setting.is_public
            }
          }
        }
        return null
      }).filter(Boolean) as Array<{ id: number; data: SettingUpdate }>

      return this.updateSettings(updates)
    },

    // Update media settings
    async updateMediaSettings(formData: {
      media_convert_images: boolean
      media_convert_videos: boolean
      media_convert_audio: boolean
      media_keep_original: boolean
      media_image_quality: number
      media_video_quality: number
      media_audio_bitrate: number
    }) {
      const updates = Object.entries(formData).map(([key, value]) => {
        const setting = this.settings.find((s: Setting) => s.setting_key === key && s.group === 'media')
        if (setting) {
          const data: SettingUpdate = {
            setting_key: key,
            label: setting.label,
            group: 'media',
            type: setting.type,
            description: setting.description,
            is_public: setting.is_public
          }

          // Set appropriate value field based on type
          if (setting.type === 'bool') {
            data.value_bool = value as boolean
          } else if (setting.type === 'int') {
            data.value_int = value as number
          }

          return { id: setting.id, data }
        }
        return null
      }).filter(Boolean) as Array<{ id: number; data: SettingUpdate }>

      return this.updateSettings(updates)
    },

    // Update AI settings
    async updateAiSettings(formData: {
      ai_enabled: boolean
      ai_suggestions_enabled: boolean
      ai_context_limit: number
    }) {
      const updates = Object.entries(formData).map(([key, value]) => {
        const setting = this.settings.find((s: Setting) => s.setting_key === key && s.group === 'ai')
        if (setting) {
          const data: SettingUpdate = {
            setting_key: key,
            label: setting.label,
            group: 'ai',
            type: setting.type,
            description: setting.description,
            is_public: setting.is_public
          }

          if (setting.type === 'bool') {
            data.value_bool = value as boolean
          } else if (setting.type === 'int') {
            data.value_int = value as number
          }

          return { id: setting.id, data }
        }
        return null
      }).filter(Boolean) as Array<{ id: number; data: SettingUpdate }>

      return this.updateSettings(updates)
    },

    // Update collaboration settings
    async updateCollaborationSettings(formData: {
      collab_real_time_sync: boolean
      collab_show_cursors: boolean
      collab_presence_timeout: number
    }) {
      const updates: Array<{ id: number; data: SettingUpdate }> = []

      const boolKeys = ['collab_real_time_sync', 'collab_show_cursors'] as const
      for (const key of boolKeys) {
        const setting = this.settings.find((s: Setting) => s.setting_key === key && s.group === 'collaboration')
        if (setting) {
          updates.push({
            id: setting.id,
            data: {
              setting_key: key, label: setting.label, group: 'collaboration',
              type: 'bool', value_bool: formData[key],
              description: setting.description, is_public: setting.is_public
            }
          })
        }
      }

      const timeoutSetting = this.settings.find((s: Setting) => s.setting_key === 'collab_presence_timeout' && s.group === 'collaboration')
      if (timeoutSetting) {
        updates.push({
          id: timeoutSetting.id,
          data: {
            setting_key: 'collab_presence_timeout', label: timeoutSetting.label, group: 'collaboration',
            type: 'int', value_int: formData.collab_presence_timeout,
            description: timeoutSetting.description, is_public: timeoutSetting.is_public
          }
        })
      }

      return this.updateSettings(updates)
    },

    // Update company settings
    async updateCompanySettings(formData: {
      company_name: string
      company_address: string
      company_phone: string
      company_email: string
      company_website: string
      company_nui: string
    }) {
      const updates = Object.entries(formData).map(([key, value]) => {
        const setting = this.settings.find((s: Setting) => s.setting_key === key && s.group === 'company')
        if (setting) {
          return {
            id: setting.id,
            data: {
              setting_key: key, label: setting.label, group: 'company',
              type: 'string', value_string: value,
              description: setting.description, is_public: setting.is_public
            }
          }
        }
        return null
      }).filter(Boolean) as Array<{ id: number; data: SettingUpdate }>

      return this.updateSettings(updates)
    },

    // Update multiple settings by key (generic method)
    async updateMultipleSettings(settingUpdates: Array<{
      setting_key: string
      value_string?: string
      value_int?: number
      value_bool?: boolean
      value_float?: number
    }>) {
      const updates = settingUpdates.map(update => {
        const setting = this.settings.find((s: Setting) => s.setting_key === update.setting_key)
        if (setting) {
          const data: SettingUpdate = {
            setting_key: update.setting_key,
            label: setting.label,
            group: setting.group,
            type: setting.type,
            description: setting.description,
            is_public: setting.is_public
          }

          // Set appropriate value field based on type
          if (setting.type === 'string' && update.value_string !== undefined) {
            data.value_string = update.value_string
          } else if (setting.type === 'int' && update.value_int !== undefined) {
            data.value_int = update.value_int
          } else if (setting.type === 'float' && update.value_float !== undefined) {
            data.value_float = update.value_float
          } else if (setting.type === 'bool' && update.value_bool !== undefined) {
            data.value_bool = update.value_bool
          }

          return { id: setting.id, data }
        }
        return null
      }).filter(Boolean) as Array<{ id: number; data: SettingUpdate }>

      return this.updateSettings(updates)
    },

    // Clear error
    clearError() {
      this.error = null
    }
  }
})
