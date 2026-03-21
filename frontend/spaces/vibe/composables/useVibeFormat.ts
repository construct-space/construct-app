/**
 * useVibeFormat — Pure formatting functions for Vibe UI
 *
 * Minimal helpers for display. Tool tracking is handled by
 * useStreamStatus (operator protocol: tool.call / tool.result / status).
 */

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`
}

export function formatSessionTime(value?: string): string {
  if (!value) return 'Unknown time'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(date)
}

export function sessionStatusClass(status?: string): string {
  switch ((status || '').toLowerCase()) {
    case 'complete': return 'bg-emerald-500/10 text-emerald-300'
    case 'blocked': return 'bg-amber-500/10 text-amber-300'
    case 'cancelled':
    case 'canceled': return 'bg-red-500/10 text-red-300'
    case 'failed': return 'bg-red-500/10 text-red-300'
    default: return 'bg-white/8 text-app-muted'
  }
}

export function vibeStatusBadgeClass(label?: string): string {
  const value = (label || '').trim().toLowerCase()

  if (!value || value === 'ready') {
    return 'bg-white/8 text-app-muted'
  }

  if (value === 'done' || value === 'complete' || value === 'completed') {
    return 'border border-emerald-500/20 bg-emerald-500/12 text-emerald-300'
  }

  if (value === 'cancelled' || value === 'canceled') {
    return 'border border-red-500/20 bg-red-500/12 text-red-300'
  }

  if (value === 'fail' || value === 'failed' || value === 'error' || value === 'blocked') {
    return 'border border-red-500/20 bg-red-500/12 text-red-300'
  }

  if (value.includes('plan') || value.includes('research') || value.includes('think')) {
    return 'border border-amber-500/20 bg-amber-500/12 text-amber-300'
  }

  if (value.includes('implement') || value.includes('build') || value.includes('run')) {
    return 'border border-sky-500/20 bg-sky-500/12 text-sky-300'
  }

  if (value.includes('review') || value.includes('verify')) {
    return 'border border-cyan-500/20 bg-cyan-500/12 text-cyan-300'
  }

  return 'bg-white/8 text-app-muted'
}
