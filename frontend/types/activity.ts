// Activity/Audit Log Types

export interface Activity {
  id: number
  user_id: number
  user?: {
    id: number
    first_name: string
    last_name: string
    email: string
    avatar_url?: string
  }
  entity_type: string  // e.g., "post", "employee", "order"
  entity_id: number
  action: string       // e.g., "create", "update", "delete", "login"
  description: string  // Human-readable description
  metadata?: Record<string, unknown>  // Additional context
  ip_address: string
  user_agent: string
  created_at: string
  updated_at: string
}

export interface ActivityListResponse {
  data: Activity[]
  meta: {
    total: number
    page: number
    limit: number
    total_pages: number
  }
}
