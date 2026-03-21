import type { User } from './user'
import type { Project } from '~/stores/project'

export interface EventMember {
  id: number
  first_name: string
  last_name: string
  email: string
  avatar_url?: string
}

export interface Event {
  id: number
  title: string
  description: string
  start_time: string
  end_time: string
  all_day: boolean
  color: string
  location: string
  is_recurring: boolean
  recurrence_rule: string
  project_id?: number
  owner_id?: number
  project?: Project
  owner?: User
  members?: EventMember[]
  created_at: string
  updated_at: string
}

export interface CreateEventRequest {
  title: string
  description?: string
  start_time: string
  end_time: string
  all_day?: boolean
  color?: string
  location?: string
  is_recurring?: boolean
  recurrence_rule?: string
  member_ids?: number[]
}

export interface UpdateEventRequest {
  title?: string
  description?: string
  start_time?: string
  end_time?: string
  all_day?: boolean
  color?: string
  location?: string
  is_recurring?: boolean
  recurrence_rule?: string
  member_ids?: number[]
}
