export interface Permission {
  id: number
  name: string
  resource: string
  resource_type?: string
  action: string
  description?: string
  created_at?: string
  updated_at?: string
}

export interface Role {
  id: number
  name: string
  description?: string
  is_system?: boolean
  permission_count?: number
  permissions?: Permission[]
  created_at: string
  updated_at: string
}

export interface RoleCreateRequest {
  name: string
  description?: string
}

export interface RoleUpdateRequest {
  name?: string
  description?: string
}

export interface RolePermissionRequest {
  role_id: number
  permission_ids: number[]
}

export interface PermissionCheck {
  has_permission: boolean
  reason?: string
}

export interface PermissionCheckRequest {
  resource_type: string
  action: string
  resource_id?: string | number
}
