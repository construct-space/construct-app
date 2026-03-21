/**
 * User Module Composable
 *
 * Standalone, reusable user management system with roles and permissions.
 * This composable provides a complete interface for user CRUD operations,
 * role management, and permission checking.
 *
 * Features:
 * - User CRUD operations
 * - Role and permission management
 * - Reactive state management
 * - Type-safe API calls
 * - Permission-based access control
 */

import type {
  User,
  CreateUserRequest,
  UpdateUserRequest,
  UserResponse,
  Role,
  Permission,
  RoleCreateRequest,
  RoleUpdateRequest,
  PermissionCheck
} from '~/types'

export interface UserModuleState {
  users: User[]
  selectedUser: User | null
  roles: Role[]
  permissions: Permission[]
  loading: boolean
  error: string | null
}

export function useUserModule() {
  // ===== STATE =====
  const state = reactive<UserModuleState>({
    users: [],
    selectedUser: null,
    roles: [],
    permissions: [],
    loading: false,
    error: null
  })

  // ===== API COMPOSABLES =====
  const api = useApi()
  const toast  = useToast()

  // ===== EMPLOYEE OPERATIONS =====
  
  /**
   * Fetch all users with optional filters
   */
  const fetchUsers = async (filters: Record<string, unknown> = {}) => {
    state.loading = true
    state.error = null
    
    try {
      const params = new URLSearchParams()
      Object.entries(filters).forEach(([key, value]) => {
        if (value !== null && value !== undefined && value !== '') {
          params.append(key, value.toString())
        }
      })

      const response = await api.get<UserResponse>(`/users?${params}`)
      state.users = response.data || []
      return response
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : ''
      state.error = errorMessage || 'Failed to fetch users'
      toast.add({
        title: 'Error',
        description: state.error,
       
      })
      throw error
    } finally {
      state.loading = false
    }
  }

  /**
   * Fetch a single user by ID
   */
  const fetchUser = async (id: number) => {
    state.loading = true
    state.error = null
    
    try {
      const user = await api.get<User>(`/users/${id}`)
      state.selectedUser = user
      return user
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : ''
      state.error = errorMessage || 'Failed to fetch user'
      toast.add({
        title: 'Error',
        description: state.error,
       
      })
      throw error
    } finally {
      state.loading = false
    }
  }

  /**
   * Create a new user
   */
  const createUser = async (userData: CreateUserRequest) => {
    state.loading = true
    state.error = null
    
    try {
      const newUser = await api.post<User>('/users', userData)
      state.users.unshift(newUser)
      
      toast.add({
        title: 'Success',
        description: 'User created successfully',
        
      })
      
      return newUser
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : ''
      state.error = errorMessage || 'Failed to create user'
      toast.add({
        title: 'Error',
        description: state.error,
       
      })
      throw error
    } finally {
      state.loading = false
    }
  }

  /**
   * Update an existing user
   */
  const updateUser = async (id: number, userData: UpdateUserRequest) => {
    state.loading = true
    state.error = null
    
    try {
      const updatedUser = await api.put<User>(`/users/${id}`, userData)
      
      const index = state.users.findIndex((emp: User) => emp.id === id)
      if (index !== -1) {
        state.users[index] = updatedUser
      }
      
      if (state.selectedUser?.id === id) {
        state.selectedUser = updatedUser
      }
      
      toast.add({
        title: 'Success',
        description: 'User updated successfully',
        
      })
      
      return updatedUser
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : ''
      state.error = errorMessage || 'Failed to update user'
      toast.add({
        title: 'Error',
        description: state.error,
       
      })
      throw error
    } finally {
      state.loading = false
    }
  }

  /**
   * Delete an user
   */
  const deleteUser = async (id: number) => {
    state.loading = true
    state.error = null
    
    try {
      await api.delete(`/users/${id}`)
      
      state.users = state.users.filter((emp: User) => emp.id !== id)
      if (state.selectedUser?.id === id) {
        state.selectedUser = null
      }
      
      toast.add({
        title: 'Success',
        description: 'User deleted successfully',
        
      })
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : ''
      state.error = errorMessage || 'Failed to delete user'
      toast.add({
        title: 'Error',
        description: state.error,
       
      })
      throw error
    } finally {
      state.loading = false
    }
  }

  // ===== ROLE OPERATIONS =====
  
  /**
   * Fetch all roles
   */
  const fetchRoles = async () => {
    state.loading = true
    state.error = null
    
    try {
      const response = await api.get<Role[] | { data: Role[] }>('/authorization/roles')
      state.roles = Array.isArray(response) ? response : response.data || []
      return state.roles
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : ''
      state.error = errorMessage || 'Failed to fetch roles'
      throw error
    } finally {
      state.loading = false
    }
  }

  /**
   * Create a new role
   */
  const createRole = async (roleData: RoleCreateRequest) => {
    state.loading = true
    state.error = null
    
    try {
      const newRole = await api.post<Role>('/authorization/roles', roleData)
      // Ensure the role is properly typed
      const typedRole = newRole as Role
      state.roles.unshift(typedRole)
      
      toast.add({
        title: 'Success',
        description: 'Role created successfully',
        
      })
      
      return typedRole
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to create role'
      state.error = errorMessage
      toast.add({
        title: 'Error',
        description: state.error,
       
      })
      throw error
    } finally {
      state.loading = false
    }
  }

  /**
   * Update an existing role
   */
  const updateRole = async (id: number, roleData: RoleUpdateRequest) => {
    state.loading = true
    state.error = null
    
    try {
      const updatedRole = await api.put<Role>(`/authorization/roles/${id}`, roleData)
      
      const index = state.roles.findIndex(role => role.id === id)
      if (index !== -1) {
        state.roles[index] = updatedRole
      }
      
      toast.add({
        title: 'Success',
        description: 'Role updated successfully',
        
      })
      
      return updatedRole
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : ''
      state.error = errorMessage || 'Failed to update role'
      toast.add({
        title: 'Error',
        description: state.error,
       
      })
      throw error
    } finally {
      state.loading = false
    }
  }

  /**
   * Delete a role
   */
  const deleteRole = async (id: number) => {
    state.loading = true
    state.error = null
    
    try {
      await api.delete(`/authorization/roles/${id}`)
      
      state.roles = state.roles.filter(role => role.id !== id)
      
      toast.add({
        title: 'Success',
        description: 'Role deleted successfully',
        
      })
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : ''
      state.error = errorMessage || 'Failed to delete role'
      toast.add({
        title: 'Error',
        description: state.error,
       
      })
      throw error
    } finally {
      state.loading = false
    }
  }

  // ===== PERMISSION OPERATIONS =====
  
  /**
   * Fetch all permissions
   */
  const fetchPermissions = async () => {
    state.loading = true
    state.error = null
    
    try {
      const response = await api.get<Permission[] | { data: Permission[] }>('/authorization/permissions')
      state.permissions = Array.isArray(response) ? response : response.data || []
      return state.permissions
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : ''
      state.error = errorMessage || 'Failed to fetch permissions'
      throw error
    } finally {
      state.loading = false
    }
  }

  /**
   * Check if user has specific permission
   */
  const checkPermission = async (resource: string, action: string, resourceId?: string | number): Promise<boolean> => {
    try {
      const response = await api.post<PermissionCheck>('/authorization/check-permission', {
        resource_type: resource,
        action,
        resource_id: resourceId
      })
      
      return response.has_permission || false
    } catch (error) {
      console.error('Permission check failed:', error)
      return false
    }
  }

  // ===== COMPUTED PROPERTIES =====
  
  const userOptions = computed(() => {
    return state.users.map((emp: User) => ({
      id: emp.id,
      name: emp.name || `${emp.first_name} ${emp.last_name}`.trim(),
      label: emp.name || `${emp.first_name} ${emp.last_name}`.trim(),
      value: emp.id
    }))
  })

  const roleOptions = computed(() => {
    return state.roles.map(role => ({
      id: role.id,
      name: role.name,
      label: role.name,
      value: role.id
    }))
  })

  // ===== UTILITY FUNCTIONS =====
  
  const setSelectedUser = (user: User | null) => {
    state.selectedUser = user
  }

  const clearError = () => {
    state.error = null
  }

  const resetState = () => {
    state.users = []
    state.selectedUser = null
    state.roles = []
    state.permissions = []
    state.loading = false
    state.error = null
  }

  // ===== RETURN API =====
  return {
    // State (using computed to maintain reactivity but return proper types)
    users: computed(() => state.users),
    selectedUser: computed(() => state.selectedUser),
    roles: computed(() => state.roles),
    permissions: computed(() => state.permissions),
    loading: computed(() => state.loading),
    error: computed(() => state.error),
    
    // User operations
    fetchUsers,
    fetchUser,
    createUser,
    updateUser,
    deleteUser,
    
    // Role operations
    fetchRoles,
    createRole,
    updateRole,
    deleteRole,
    
    // Permission operations
    fetchPermissions,
    checkPermission,
    
    // Computed properties
    userOptions: readonly(userOptions),
    roleOptions: readonly(roleOptions),
    
    // Utility functions
    setSelectedUser,
    clearError,
    resetState
  }
}