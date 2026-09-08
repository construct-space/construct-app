/**
 * App configuration — replaces Nuxt's useRuntimeConfig()
 * All composables that previously used useRuntimeConfig() now import this.
 *
 * Most Construct backend services sit behind
 * https://my.construct.space/api/<service>/... Graph is the exception:
 * spaces send tenant headers such as X-Space-ID and X-Project-ID, and the
 * public graph service is the CORS surface that allows those headers.
 *
 * Two distinct needs:
 *   - `gatewayUrl` (absolute) — used when we need to hand a URL to the OS
 *     (OAuth redirect in the system browser, deep links, copy-to-clipboard).
 *     Must always be a full https:// URL; relative URLs can't be opened
 *     externally.
 *   - `apiBase` / `sourceUrl` / `graphUrl` / `spacesRegistryUrl` (relative
 *     in dev, absolute in prod) — used by fetch(). Relative strings let
 *     the Vite dev proxy handle same-origin routing to localhost stacks.
 *
 * Env overrides (VITE_GATEWAY_URL, VITE_*_URL) remain as escape hatches.
 */
const gatewayAbsolute = import.meta.env.VITE_GATEWAY_URL || 'https://my.construct.space'

// In dev, API calls prefer relative paths so Vite's proxy can rewrite them
// to wherever the local stack lives (docker-compose, remote staging, prod).
// In prod (Tauri bundle), there's no dev proxy — use the absolute URL.
const gatewayForFetch = (import.meta.env.DEV && !import.meta.env.VITE_GATEWAY_URL) ? '' : gatewayAbsolute
const graphForFetch = import.meta.env.VITE_GRAPH_URL || 'https://graph.construct.space'

export const appConfig = {
  /** Absolute URL of the gateway. Always usable for OS-level open(). */
  gatewayUrl:        gatewayAbsolute,

  apiBase:           import.meta.env.VITE_API_BASE            || `${gatewayForFetch}/api/source`,
  apiKey:            import.meta.env.VITE_API_KEY             || 'api',
  billingUrl:        import.meta.env.VITE_BILLING_URL         || `${gatewayForFetch}/api/billing`,
  sourceUrl:         import.meta.env.VITE_SOURCE_URL          || `${gatewayForFetch}/api/source`,
  telemetryUrl:      import.meta.env.VITE_TELEMETRY_URL       || `${gatewayForFetch}/api/telemetry`,
  /**
   * Storage goes through the gateway: it auth_requests the user's session
   * then injects `X-Internal-Secret` before forwarding to storage-api. Host
   * never holds the secret directly; spaces never see it. See
   * `web/my/snippets/upstream-headers.conf` and `api/storage/`.
   */
  storageUrl:        import.meta.env.VITE_STORAGE_URL          || `${gatewayForFetch}/api/storage`,
  graphUrl:          graphForFetch,
  // Delivery SDK calls can still hit the public delivery API directly.
  // Host-owned notifications are separate: inbox REST and the native push
  // bridge go through my.construct.space so auth, cookies, and routing stay
  // on the same gateway surface as the rest of the desktop app.
  deliveryUrl:       import.meta.env.VITE_DELIVERY_URL         || 'https://api.construct.delivery/api',
  notificationsUrl:  import.meta.env.VITE_NOTIFICATIONS_URL    || `${gatewayForFetch}/api/notifications`,
  notificationsBridgeUrl:
    import.meta.env.VITE_NOTIFICATIONS_BRIDGE_URL              || `${gatewayAbsolute}/api`,
  freepikApiKey:     import.meta.env.VITE_FREEPIK_API_KEY     || '',
  spacesRegistryUrl: import.meta.env.VITE_SPACES_REGISTRY_URL || `${gatewayForFetch}/api/developer`,
  marketplaceUrl:    import.meta.env.VITE_MARKETPLACE_URL     || `${gatewayForFetch}/api/marketplace`,
  // Conductor — the always-on automation control plane. Sits OUTSIDE the
  // gateway (its own CORS surface, like graph), so this is always absolute.
  conductorUrl:      import.meta.env.VITE_CONDUCTOR_URL       || 'https://conductor.construct.space',

  /**
   * Base for the OAuth authorize / token / profile endpoints. Always
   * absolute — startLogin hands this to plugin-opener, which can't open
   * relative paths in the system browser.
   */
  accountsUrl:       import.meta.env.VITE_ACCOUNTS_URL        || gatewayAbsolute,
  oauthClientId:     import.meta.env.VITE_OAUTH_CLIENT_ID     || 'construct_app',
}
