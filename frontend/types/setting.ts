
export interface Setting {
  id: number
  setting_key: string
  label: string
  group: string
  type: string
  value_string: string
  value_int: number
  value_float: number
  value_bool: boolean
  description: string
  is_public: boolean
  is_nullable?: boolean
  created_at: string
  updated_at: string
}

export interface SettingUpdate {
  setting_key: string
  label: string
  group: string
  type: string
  value_string?: string
  value_int?: number
  value_float?: number
  value_bool?: boolean
  description: string
  is_public: boolean
}
