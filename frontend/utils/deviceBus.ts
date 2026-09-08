import { appConfig } from '@/utils/config'

function sourceGatewayBase(): string {
  return appConfig.sourceUrl.replace(/\/$/, '').replace(/\/source$/, '')
}

export function sourceDeviceBusWsUrl(token: string): string {
  const base = sourceGatewayBase().replace(/^http/, 'ws')
  return `${base}/device-bus/ws?token=${encodeURIComponent(token)}`
}

export function sourceDeviceBusRelayUrl(): string {
  return `${sourceGatewayBase()}/device-bus/relay`
}

export function sourceDeviceBusOperatorStatusUrl(): string {
  return `${sourceGatewayBase()}/device-bus/operator/status`
}
