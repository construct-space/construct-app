// Billing types — matches Go API response shapes from core/billing/models.go

export interface BillingPlan {
  id: number
  name: string
  slug: string
  description: string
  price_cents: number
  currency: string
  billing_interval: string
  trial_days: number
  ai_credits: number
  max_rollover_multiplier: number
  features?: Record<string, unknown>
}

export interface BillingSubscription {
  id: number
  user_id: number
  plan?: BillingPlan
  status: 'active' | 'canceled' | 'incomplete' | 'incomplete_expired' | 'past_due' | 'trialing' | 'unpaid'
  current_period_start: string
  current_period_end: string
  trial_end: string | null
  canceled_at: string | null
  cancel_at_period_end: boolean
  days_until_renewal: number
  days_until_trial_end: number
}

export interface BillingInvoice {
  id: number
  amount_due_cents: number
  amount_paid_cents: number
  currency: string
  status: string
  paid_at: string | null
  invoice_url: string
  invoice_pdf: string
  description: string
  created_at: string
}

export const useBilling = () => {
  const api = useApi()

  const normalizeCurrencyCode = (currency?: string | null): string => {
    const code = String(currency || 'USD').trim().toUpperCase()
    return /^[A-Z]{3}$/.test(code) ? code : 'USD'
  }

  // State
  const subscription = ref<BillingSubscription | null>(null)
  const plans = ref<BillingPlan[]>([])
  const invoices = ref<BillingInvoice[]>([])
  const loading = ref(false)
  const error = ref<string | null>(null)

  // Computed
  const isSubscribed = computed(() => {
    const status = subscription.value?.status
    return status === 'active' || status === 'trialing'
  })

  const isTrialing = computed(() => {
    return subscription.value?.status === 'trialing'
  })

  const trialDaysRemaining = computed(() => {
    return subscription.value?.days_until_trial_end ?? 0
  })

  const currentPlan = computed(() => {
    return subscription.value?.plan || null
  })

  const monthlyPrice = computed(() => {
    if (!subscription.value?.plan) return 0
    return subscription.value.plan.price_cents
  })

  // API Methods — hit Go API via useApi()
  const fetchPlans = async () => {
    loading.value = true
    error.value = null
    try {
      const response = await api.get<BillingPlan[]>('/billing/plans')
      plans.value = response
      return response
    } catch (err) {
      error.value = err instanceof Error ? err.message : 'Failed to fetch plans'
      throw err
    } finally {
      loading.value = false
    }
  }

  const fetchSubscription = async () => {
    loading.value = true
    error.value = null
    try {
      const response = await api.get<BillingSubscription>('/billing/subscription')
      subscription.value = response
      return response
    } catch (err) {
      const errMsg = err instanceof Error ? err.message.toLowerCase() : ''
      if (errMsg.includes('not found') || errMsg.includes('404')) {
        subscription.value = null
        return null
      }
      error.value = err instanceof Error ? err.message : 'Failed to fetch subscription'
      throw err
    } finally {
      loading.value = false
    }
  }

  const createCheckout = async (planSlug: string, successUrl: string, cancelUrl: string): Promise<string> => {
    loading.value = true
    error.value = null
    try {
      const response = await api.post<{ url: string }>('/billing/checkout', {
        plan_slug: planSlug,
        success_url: successUrl,
        cancel_url: cancelUrl,
      })
      return response.url
    } catch (err) {
      error.value = err instanceof Error ? err.message : 'Failed to create checkout session'
      throw err
    } finally {
      loading.value = false
    }
  }

  const createPortalSession = async (returnUrl: string): Promise<string> => {
    loading.value = true
    error.value = null
    try {
      const response = await api.post<{ url: string }>('/billing/portal', {
        return_url: returnUrl,
      })
      return response.url
    } catch (err) {
      error.value = err instanceof Error ? err.message : 'Failed to create portal session'
      throw err
    } finally {
      loading.value = false
    }
  }

  const cancelSubscription = async () => {
    loading.value = true
    error.value = null
    try {
      await api.delete('/billing/subscription')
      // Refresh subscription data after cancellation
      await fetchSubscription()
    } catch (err) {
      error.value = err instanceof Error ? err.message : 'Failed to cancel subscription'
      throw err
    } finally {
      loading.value = false
    }
  }

  const fetchInvoices = async () => {
    loading.value = true
    error.value = null
    try {
      const response = await api.get<BillingInvoice[]>('/billing/invoices')
      invoices.value = response
      return response
    } catch (err) {
      const errMsg = err instanceof Error ? err.message.toLowerCase() : ''
      if (errMsg.includes('not found') || errMsg.includes('404')) {
        invoices.value = []
        return []
      }
      error.value = err instanceof Error ? err.message : 'Failed to fetch invoices'
      throw err
    } finally {
      loading.value = false
    }
  }

  // Helpers
  const formatPrice = (cents: number, currency = 'usd'): string => {
    const amount = Number.isFinite(cents) ? cents / 100 : 0
    const code = normalizeCurrencyCode(currency)
    try {
      return new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: code,
      }).format(amount)
    } catch {
      return new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: 'USD',
      }).format(amount)
    }
  }

  type BadgeColor = 'error' | 'neutral' | 'success' | 'info' | 'warning' | 'primary' | 'secondary'
  const getStatusColor = (status: string): BadgeColor => {
    switch (status) {
      case 'active':
        return 'success'
      case 'trialing':
        return 'info'
      case 'past_due':
        return 'warning'
      case 'canceled':
      case 'unpaid':
        return 'error'
      default:
        return 'neutral'
    }
  }

  return {
    // State
    subscription,
    plans,
    invoices,
    loading,
    error,

    // Computed
    isSubscribed,
    isTrialing,
    trialDaysRemaining,
    currentPlan,
    monthlyPrice,

    // Methods
    fetchPlans,
    fetchSubscription,
    createCheckout,
    createPortalSession,
    cancelSubscription,
    fetchInvoices,

    // Helpers
    formatPrice,
    getStatusColor,
  }
}
