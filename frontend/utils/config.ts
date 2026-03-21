/**
 * App configuration — replaces Nuxt's useRuntimeConfig()
 * All composables that previously used useRuntimeConfig() now import this.
 */
export const appConfig = {
  apiBase: import.meta.env.VITE_API_BASE || 'https://api.construct.space/api',
  apiKey: import.meta.env.VITE_API_KEY || 'api',
  sourceUrl: import.meta.env.VITE_SOURCE_URL || 'https://source.construct.space/api',
  paasUrl: import.meta.env.VITE_PAAS_URL || 'https://paas.construct.ninja',
  freepikApiKey: import.meta.env.VITE_FREEPIK_API_KEY || '',
  spacesRegistryUrl: import.meta.env.VITE_SPACES_REGISTRY_URL || 'https://developer.construct.space/api',
  accountsUrl: import.meta.env.VITE_ACCOUNTS_URL || 'https://accounts.construct.space',
  oauthClientId: import.meta.env.VITE_OAUTH_CLIENT_ID || 'construct_app',
}
