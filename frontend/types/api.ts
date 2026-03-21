// ===== API & CONNECTIVITY TYPES =====
// HTTP API responses, error handling, and customer connectivity status
// Note: ConnectionStatus here is for customer internet connectivity checks
export interface Customer {
  id: number
  name: string
  email: string
  phone?: string
  address?: string
  city?: string
  postal_code?: string
  country?: string
  plan_id?: number
  radius_username?: string
  radius_password?: string
  status: CustomerStatus
  connection_status?: ConnectionStatus
  last_login?: string
  data_usage?: DataUsage
  billing_address?: BillingAddress
  notes?: string
  created_at: string
  updated_at: string
}

// Customer account status
export type CustomerStatus = 'active' | 'inactive' | 'suspended' | 'pending'

// API/Service connectivity status - for customer internet connection checks
export type ConnectionStatus = 'online' | 'offline' | 'limited' | 'blocked'

export interface DataUsage {
  current_month_mb: number
  last_month_mb: number
  total_mb: number
  last_updated: string
}

export interface BillingAddress {
  street: string
  city: string
  postal_code: string
  country: string
}

// ISP Service Plan Types
export interface Plan {
  id: number
  name: string
  description?: string
  price: number
  currency: string
  bandwidth_up: number // in Kbps
  bandwidth_down: number // in Kbps
  data_limit?: number // in MB, null for unlimited
  duration_days?: number
  radius_group?: string
  status: PlanStatus
  plan_type: PlanType
  features?: PlanFeature[]
  priority?: number
  burst_limit_up?: number
  burst_limit_down?: number
  created_at: string
  updated_at: string
}

export type PlanStatus = 'active' | 'inactive' | 'deprecated'
export type PlanType = 'residential' | 'business' | 'premium' | 'trial'

export interface PlanFeature {
  name: string
  description?: string
  enabled: boolean
}

// Customer Plan Subscription Types
export interface CustomerPlan {
  id: number
  customer_id: number
  plan_id: number
  start_date: string
  end_date?: string
  price: number
  currency: string
  status: CustomerPlanStatus
  auto_renew: boolean
  payment_method?: PaymentMethod
  discount_percentage?: number
  promo_code?: string
  installation_date?: string
  cancellation_reason?: string
  notes?: string
  created_at: string
  updated_at: string
  // Relations
  customer?: Customer
  plan?: Plan
}

export type CustomerPlanStatus = 'active' | 'expired' | 'suspended' | 'pending' | 'cancelled'
export type PaymentMethod = 'cash' | 'bank_transfer' | 'credit_card' | 'paypal' | 'crypto'

// Note: User, AuthResponse, LoginRequest, RegisterRequest types are defined in auth.ts
// Note: ApiResponse, PaginatedResponse, Media types are defined in common.ts
// Note: Role, Permission types are defined in authorization.ts
// Import and re-export them from their canonical sources if needed here
