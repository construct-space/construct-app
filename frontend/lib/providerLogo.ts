/**
 * Provider logo resolver — maps provider IDs to inline SVG strings that
 * use `fill="currentColor"` so they inherit color from the parent (e.g.
 * `text-app-accent`). Logos bundled in frontend/assets/provider-logos/.
 */

const sources = import.meta.glob('@/assets/provider-logos/*.svg', {
  eager: true,
  query: '?raw',
  import: 'default',
}) as Record<string, string>

const byBase: Record<string, string> = {}
for (const path in sources) {
  const base = path.split('/').pop()?.replace(/\.svg$/, '')
  if (base) byBase[base] = normalizeSvg(sources[path])
}

function normalizeSvg(raw: string): string {
  return raw
    // drop inline width/height so the wrapper can size by height only
    .replace(/\s(width|height)="[^"]*"/g, '')
    // replace any fill that isn't `none` with currentColor
    .replace(/fill="(?!none")[^"]*"/g, 'fill="currentColor"')
    .replace(/stroke="(?!none")[^"]*"/g, 'stroke="currentColor"')
    // svg fills its container height; width follows viewBox aspect ratio
    .replace(/<svg\b/, '<svg height="100%" style="width:auto;display:block"')
}

// Provider ID → bundled filename (without .svg)
const idMap: Record<string, string> = {
  construct: 'construct',
  anthropic: 'anthropic',
  openai: 'openai',
  google: 'google',
  'google-gemini': 'google',
  gemini: 'google',
  deepseek: 'deepseek',
  xai: 'xai',
  grok: 'xai',
  mistral: 'mistral',
  openrouter: 'openrouter',
  groq: 'groq',
  cohere: 'cohere',
  perplexity: 'perplexity',
  huggingface: 'huggingface',
  llama: 'llama',
  mimo: 'xiaomi',
  xiaomi: 'xiaomi',
  nvidia: 'nvidia',
  kimi: 'moonshotai',
  moonshot: 'moonshotai',
  moonshotai: 'moonshotai',
  'z-ai': 'zai',
  zai: 'zai',
  together: 'togetherai',
  togetherai: 'togetherai',
  fireworks: 'fireworks-ai',
  'fireworks-ai': 'fireworks-ai',
  ollama: 'ollama',
  lmstudio: 'lmstudio',
  'lm-studio': 'lmstudio',
  basemlx: 'base-mlx',
  'base-mlx': 'base-mlx',
}

export function providerLogoSvg(providerId: string): string | null {
  const key = idMap[providerId] || providerId
  return byBase[key] || null
}

// Short provider blurbs used when the catalog entry has no description.
// Keep each line terse — one-liner sized for a card subtitle.
const descriptions: Record<string, string> = {
  deepseek: 'DeepSeek V4 Pro · Flash · pay-per-token',
  xai: 'Grok models · tools · reasoning',
  mistral: 'Mistral Large, Codestral · tools · multilingual',
  openrouter: 'Gateway to 100+ models · unified billing',
  nvidia: 'Free NIM endpoints · GLM, DeepSeek, Nemotron · rate-limited',
  cohere: 'Command R+ · RAG-native · enterprise',
  perplexity: 'Sonar · online search-augmented answers',
  groq: 'Llama, Mixtral on LPU · ultra-low latency',
  huggingface: 'Open models on the HF Inference API',
  together: 'Together AI · open-source model hosting',
  fireworks: 'Fireworks AI · fine-tuned open models',
  zai: 'Z.AI · GLM-4 family',
  kimi: 'Moonshot AI · Kimi K2 · long context',
  moonshotai: 'Moonshot AI · Kimi K2 · long context',
  google: 'Gemini 2.x · vision · reasoning · tools',
  'google-gemini': 'Gemini 2.x · vision · reasoning · tools',
}

export function providerDescription(providerId: string, fallback = ''): string {
  return descriptions[providerId] || fallback
}
