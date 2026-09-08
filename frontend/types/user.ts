import type { Role } from './authorization'

export interface User {
  id: number
  created_at: string
  updated_at: string
  deleted_at: string | null
  first_name: string
  last_name: string
  username: string
  phone: string
  email: string
  role_id: number
  role?: Role
  name?: string
  avatar_url?: string
  last_login?: string
}

export interface CreateUserRequest {
  first_name: string
  last_name: string
  username: string
  phone?: string
  email: string
  role_id: number
  password: string
}

export interface UpdateUserRequest {
  first_name?: string
  last_name?: string
  username?: string
  phone?: string
  email?: string
  role_id?: number
  password?: string
}

export interface UserTableRow extends User {
  display_name?: string
  full_name?: string
}

export interface UserResponse {
  data: User[]
  total?: number
  page?: number
  per_page?: number
}
