// Types
export interface CreditPool {
  id: number
  user_id: number
  balance: number
  total_bought: number
  total_used: number
  total_granted: number
}

export interface CreditTransaction {
  id: number
  user_id: number
  type: 'purchase' | 'subscription_grant' | 'usage' | 'refund' | 'admin_adjust' | 'rollover' | 'expired'
  amount: number
  balance: number
  description: string
  metadata?: Record<string, unknown>
  created_at: string
}

export interface CreditPackage {
  id: number
  name: string
  description: string
  credits: number
  price_cents: number
  currency: string
  is_active: boolean
}

export interface CreditsSummary {
  pool: CreditPool
}

export interface CreditBalance {
  balance: number
  user_remaining?: number
  user_used_this_month?: number
}

export interface PurchaseCreditsRequest {
  package_id: number
  success_url: string
  cancel_url: string
}

export const useCredits = () => {
  const api = useApi()

  const normalizeCurrencyCode = (currency?: string | null): string => {
    const code = String(currency || 'USD').trim().toUpperCase()
    return /^[A-Z]{3}$/.test(code) ? code : 'USD'
  }

  // State
  const pool = ref<CreditPool | null>(null)
  const packages = ref<CreditPackage[]>([])
  const transactions = ref<CreditTransaction[]>([])
  const loading = ref(false)
  const error = ref<string | null>(null)

  // Computed
  const balance = computed(() => pool.value?.balance || 0)

  const isLowCredits = computed(() => {
    return balance.value < 20
  })

  // API Methods
  const fetchCredits = async (): Promise<CreditsSummary | null> => {
    loading.value = true
    error.value = null
    try {
      const response = await api.get<CreditsSummary>('/credits')
      pool.value = response.pool
      return response
    } catch (err) {
      // No credits setup is not an error
      const errMsg = err instanceof Error ? err.message.toLowerCase() : ''
      if (errMsg.includes('not found') || errMsg.includes('404')) {
        pool.value = null
        return null
      }
      error.value = err instanceof Error ? err.message : 'Failed to fetch credits'
      throw err
    } finally {
      loading.value = false
    }
  }

  const fetchBalance = async (): Promise<CreditBalance> => {
    loading.value = true
    error.value = null
    try {
      const response = await api.get<CreditBalance>('/credits/balance')
      if (pool.value) {
        pool.value.balance = response.balance
      }
      return response
    } catch (err) {
      error.value = err instanceof Error ? err.message : 'Failed to fetch balance'
      throw err
    } finally {
      loading.value = false
    }
  }

  const fetchPackages = async (): Promise<CreditPackage[]> => {
    loading.value = true
    error.value = null
    try {
      const response = await api.get<CreditPackage[]>('/credits/packages')
      packages.value = response
      return response
    } catch (err) {
      // No packages is not an error
      const errMsg = err instanceof Error ? err.message.toLowerCase() : ''
      if (errMsg.includes('not found') || errMsg.includes('404')) {
        packages.value = []
        return []
      }
      error.value = err instanceof Error ? err.message : 'Failed to fetch packages'
      throw err
    } finally {
      loading.value = false
    }
  }

  const purchaseCredits = async (request: PurchaseCreditsRequest): Promise<string> => {
    loading.value = true
    error.value = null
    try {
      const response = await api.post<{ url: string }>('/credits/purchase', request)
      return response.url
    } catch (err) {
      error.value = err instanceof Error ? err.message : 'Failed to create purchase session'
      throw err
    } finally {
      loading.value = false
    }
  }

  const fetchTransactions = async (limit = 50, offset = 0): Promise<CreditTransaction[]> => {
    loading.value = true
    error.value = null
    try {
      const response = await api.get<CreditTransaction[]>('/credits/transactions', {
        params: { limit, offset },
      })
      transactions.value = response
      return response
    } catch (err) {
      // No transactions is not an error
      const errMsg = err instanceof Error ? err.message.toLowerCase() : ''
      if (errMsg.includes('not found') || errMsg.includes('404')) {
        transactions.value = []
        return []
      }
      error.value = err instanceof Error ? err.message : 'Failed to fetch transactions'
      throw err
    } finally {
      loading.value = false
    }
  }

  // Helper to format credits
  const formatCredits = (amount: number | null | undefined): string => {
    if (amount === null || amount === undefined || isNaN(amount)) return '0'
    return new Intl.NumberFormat('en-US').format(amount)
  }

  // Helper to format price
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

  // Helper to get transaction type label
  const getTransactionTypeLabel = (type: string): string => {
    switch (type) {
      case 'purchase':
        return 'Purchase'
      case 'subscription_grant':
        return 'Monthly Grant'
      case 'usage':
        return 'AI Usage'
      case 'refund':
        return 'Refund'
      case 'admin_adjust':
        return 'Adjustment'
      case 'rollover':
        return 'Rollover'
      case 'expired':
        return 'Expired'
      default:
        return type
    }
  }

  // Helper to get transaction type color
  type BadgeColor = 'error' | 'neutral' | 'success' | 'info' | 'warning' | 'primary' | 'secondary'
  const getTransactionTypeColor = (type: string): BadgeColor => {
    switch (type) {
      case 'purchase':
      case 'subscription_grant':
      case 'refund':
      case 'rollover':
        return 'success'
      case 'usage':
        return 'info'
      case 'expired':
        return 'warning'
      case 'admin_adjust':
        return 'neutral'
      default:
        return 'neutral'
    }
  }

  return {
    // State
    pool,
    packages,
    transactions,
    loading,
    error,

    // Computed
    balance,
    isLowCredits,

    // Methods
    fetchCredits,
    fetchBalance,
    fetchPackages,
    purchaseCredits,
    fetchTransactions,

    // Helpers
    formatCredits,
    formatPrice,
    getTransactionTypeLabel,
    getTransactionTypeColor,
  }
}
