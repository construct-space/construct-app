<script setup lang="ts">
import { useOperator } from '@/operator'
import { Button, Input } from '@construct-space/ui'
import { Eye, EyeOff, ExternalLink } from 'lucide-vue-next'

const operator = useOperator()
const toast = useNotification()

const activeTab = ref<'services' | 'credits'>('services')

// Credits
const credits = ref({ balance: 0, currency: 'EUR', used: 0 })
const loadingCredits = ref(false)
const purchasingTier = ref<string | null>(null)

const creditTiers = [
  { id: '5e2674b6-8217-4d0e-bfcb-33932961691e', amount: 5, label: '€5', desc: '~250 images or 50 videos' },
  { id: '4831477a-bc8c-4f43-a7c6-d607263c9715', amount: 10, label: '€10', desc: '~500 images or 100 videos' },
  { id: 'ad2011a2-53fc-4bd3-9818-3980983bd744', amount: 25, label: '€25', desc: '~1,250 images or 250 videos' },
  { id: '5878ce02-f766-4323-a401-14545708c89e', amount: 50, label: '€50', desc: '~2,500 images or 500 videos' },
]

// API key (stored as provider_key:freepik in operator)
const apiKey = ref('')
const keyVisible = ref(false)
const keySaved = ref(false)
const keySaving = ref(false)

// Services
const services = [
  {
    category: 'Image Generation',
    items: [
      { id: 'mystic', name: 'Mystic', desc: 'Freepik native model — fast, high quality' },
      { id: 'flux-kontext-pro', name: 'Flux Kontext Pro', desc: 'Context-aware image generation' },
      { id: 'flux-2-pro', name: 'Flux 2 Pro', desc: 'Professional quality images' },
      { id: 'flux-2-turbo', name: 'Flux 2 Turbo', desc: 'Fast generation, good quality' },
      { id: 'seedream-4-5', name: 'Seedream 4.5', desc: 'Photorealistic image synthesis' },
      { id: 'z-image-turbo', name: 'Z-Image Turbo', desc: 'Ultra-fast generation' },
    ],
  },
  {
    category: 'Video Generation',
    items: [
      { id: 'kling-2-6-pro', name: 'Kling 2.6 Pro', desc: 'High-quality video from text/image' },
      { id: 'wan-2-6-1080p', name: 'WAN 2.6', desc: '1080p video generation' },
      { id: 'runway-gen4-turbo', name: 'RunWay Gen4 Turbo', desc: 'Fast video generation' },
      { id: 'seedance-pro-1080p', name: 'Seedance Pro', desc: '1080p dance/motion video' },
      { id: 'pixverse', name: 'PixVerse V5', desc: 'Creative video effects' },
    ],
  },
  {
    category: 'Image Editing',
    items: [
      { id: 'upscaler-creative', name: 'Upscaler (Creative)', desc: 'AI-enhanced upscaling with detail generation' },
      { id: 'upscaler-precision', name: 'Upscaler (Precision)', desc: 'Faithful high-res upscaling' },
      { id: 'remove-background', name: 'Remove Background', desc: 'Instant background removal' },
      { id: 'image-expand', name: 'Image Expand', desc: 'Outpaint — extend image boundaries' },
      { id: 'relight', name: 'Relight', desc: 'Change lighting and mood' },
      { id: 'style-transfer', name: 'Style Transfer', desc: 'Apply artistic styles to images' },
    ],
  },
  {
    category: 'Audio',
    items: [
      { id: 'music-generation', name: 'Music Generation', desc: 'Create music from text prompts' },
      { id: 'sound-effects', name: 'Sound Effects', desc: 'Generate sound effects from descriptions' },
      { id: 'audio-isolation', name: 'Audio Isolation', desc: 'Separate vocals from instruments' },
    ],
  },
]

// Usage stats
const usage = ref<{ model: string; count: number; credits: number }[]>([])

async function loadCredits() {
  loadingCredits.value = true
  try {
    const result = await operator.send('settings.get', { key: 'media_credits' }) as { value?: string }
    if (result?.value) {
      credits.value = JSON.parse(result.value)
    }
  } catch {
    // silent
  } finally {
    loadingCredits.value = false
  }
}

async function purchaseCredits(tier: typeof creditTiers[0]) {
  purchasingTier.value = tier.id
  try {
    const res = await fetch('https://api.polar.sh/v1/checkouts/', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer polar_oat_5oSYrM4H02ynnJquYGgy3c7BfSvQ8D5TNaHq30CalaX',
      },
      body: JSON.stringify({
        products: [tier.id],
        success_url: 'https://construct.space/settings/media?purchased=true',
      }),
    })
    const data = await res.json()
    if (data.url) {
      const { open } = await import('@tauri-apps/plugin-shell')
      await open(data.url)
      toast.add({ title: 'Checkout opened in browser', color: 'success' })
    } else {
      toast.add({ title: 'Failed to create checkout', color: 'error' })
    }
  } catch {
    toast.add({ title: 'Failed to create checkout', color: 'error' })
  } finally {
    purchasingTier.value = null
  }
}

async function saveApiKey() {
  const value = apiKey.value.trim()
  if (!value) return
  keySaving.value = true
  try {
    await operator.send('settings.set', { key: 'provider_key:freepik', value })
    keySaved.value = true
    setTimeout(() => { keySaved.value = false }, 2000)
    toast.add({ title: 'API key saved', color: 'success' })
  } catch {
    toast.add({ title: 'Failed to save key', color: 'error' })
  } finally {
    keySaving.value = false
  }
}

async function loadApiKey() {
  try {
    const result = await operator.send('settings.get', { key: 'provider_key:freepik' }) as { value?: string }
    if (result?.value) apiKey.value = result.value
  } catch { /* ignore */ }
}

onMounted(() => {
  loadCredits()
  loadApiKey()
})
</script>

<template>
  <div>
    <!-- Tabs -->
    <div class="flex gap-1 p-1 bg-[color-mix(in_srgb,var(--app-muted)_8%,transparent)] rounded-lg w-fit mb-6">
      <button class="px-4 py-1.5 text-sm rounded-md transition-colors cursor-pointer"
        :class="activeTab === 'services' ? 'bg-app-accent text-white' : 'text-[var(--app-muted)] hover:text-[var(--app-foreground)]'"
        @click="activeTab = 'services'">
        Services
      </button>
      <button class="px-4 py-1.5 text-sm rounded-md transition-colors cursor-pointer"
        :class="activeTab === 'credits' ? 'bg-app-accent text-white' : 'text-[var(--app-muted)] hover:text-[var(--app-foreground)]'"
        @click="activeTab = 'credits'">
        Credits
      </button>
    </div>

    <!-- Services Tab -->
    <template v-if="activeTab === 'services'">
      <div class="space-y-6">
        <!-- API Key -->
        <div class="rounded-lg border border-[var(--app-border)] bg-[var(--app-surface)] p-4">
          <h3 class="text-sm font-semibold text-[var(--app-foreground)] mb-1">API Configuration</h3>
          <p class="text-xs text-[var(--app-muted)] mb-3">Enter your API key to enable media generation services.</p>
          <div class="flex gap-2 items-center">
            <div class="relative flex-1">
              <Input v-model="apiKey" :type="keyVisible ? 'text' : 'password'" placeholder="Enter API key..."
                size="sm" />
            </div>
            <button class="p-2 text-[var(--app-muted)] hover:text-[var(--app-foreground)] transition-colors"
              @click="keyVisible = !keyVisible">
              <component :is="keyVisible ? EyeOff : Eye" class="size-4" />
            </button>
            <Button size="sm" :label="keySaved ? 'Saved' : 'Save'" :loading="keySaving" :disabled="!apiKey.trim()"
              @click="saveApiKey" />
          </div>
        </div>

        <!-- Service Categories -->
        <div v-for="cat in services" :key="cat.category"
          class="rounded-lg border border-[var(--app-border)] bg-[var(--app-surface)] overflow-hidden">
          <div class="px-4 py-3 bg-[var(--app-background)] border-b border-[var(--app-border)]">
            <h3 class="text-xs font-semibold text-[var(--app-foreground)] uppercase tracking-wider">
{{ cat.category }}
            </h3>
          </div>
          <div class="divide-y divide-[var(--app-border)]">
            <div v-for="item in cat.items" :key="item.id" class="flex items-center justify-between px-4 py-2.5">
              <div>
                <p class="text-sm text-[var(--app-foreground)]">{{ item.name }}</p>
                <p class="text-xs text-[var(--app-muted)]">{{ item.desc }}</p>
              </div>
              <span
                class="text-[10px] text-[var(--app-muted)] font-mono bg-[var(--app-background)] px-2 py-1 rounded">{{
                  item.id }}</span>
            </div>
          </div>
        </div>
      </div>
    </template>

    <!-- Credits Tab -->
    <template v-else-if="activeTab === 'credits'">
      <div class="space-y-6">
        <!-- Balance Card -->
        <div class="rounded-lg border border-[var(--app-border)] bg-[var(--app-surface)] p-6">
          <div class="flex items-center justify-between">
            <div>
              <p class="text-xs text-[var(--app-muted)] uppercase tracking-wider">Available Credits</p>
              <p class="text-4xl font-bold text-[var(--app-foreground)] mt-1">
                &euro;{{ credits.balance.toFixed(2) }}
              </p>
              <p class="text-xs text-[var(--app-muted)] mt-1">{{ credits.currency }}</p>
            </div>
          </div>
        </div>

        <!-- Buy Credits -->
        <div class="rounded-lg border border-[var(--app-border)] bg-[var(--app-surface)] overflow-hidden">
          <div class="px-4 py-3 bg-[var(--app-background)] border-b border-[var(--app-border)]">
            <h3 class="text-xs font-semibold text-[var(--app-foreground)] uppercase tracking-wider">Buy Credits</h3>
          </div>
          <div class="grid grid-cols-2 gap-3 p-4">
            <button v-for="tier in creditTiers" :key="tier.id"
              class="relative flex flex-col items-center p-4 rounded-lg border border-[var(--app-border)] bg-[var(--app-background)] hover:border-[var(--app-accent)] transition-all cursor-pointer group"
              :class="purchasingTier === tier.id ? 'opacity-70 pointer-events-none' : ''"
              @click="purchaseCredits(tier)">
              <span
                class="text-2xl font-bold text-[var(--app-foreground)] group-hover:text-[var(--app-accent)] transition-colors">
                {{ tier.label }}
              </span>
              <span class="text-[11px] text-[var(--app-muted)] mt-1">{{ tier.desc }}</span>
              <ExternalLink v-if="purchasingTier !== tier.id"
                class="size-3.5 text-[var(--app-muted)] absolute top-2.5 right-2.5 opacity-0 group-hover:opacity-100 transition-opacity" />
              <div v-else
                class="absolute inset-0 flex items-center justify-center bg-[var(--app-background)]/80 rounded-lg">
                <div
                  class="w-4 h-4 border-2 border-[var(--app-border)] border-t-[var(--app-accent)] rounded-full animate-spin" />
              </div>
            </button>
          </div>
          <div class="px-4 pb-4">
            <p class="text-[11px] text-[var(--app-muted)] text-center">
              Payments processed securely by Polar. Credits are added instantly after purchase.
            </p>
          </div>
        </div>

        <!-- Usage Stats -->
        <div class="rounded-lg border border-[var(--app-border)] bg-[var(--app-surface)] overflow-hidden">
          <div
            class="px-4 py-3 bg-[var(--app-background)] border-b border-[var(--app-border)] flex justify-between items-center">
            <h3 class="text-xs font-semibold text-[var(--app-foreground)] uppercase tracking-wider">Usage</h3>
            <span class="text-xs text-[var(--app-muted)]">This month</span>
          </div>

          <div class="p-4">
            <div class="grid grid-cols-4 gap-4 mb-4">
              <div class="text-center">
                <p class="text-2xl font-bold text-[var(--app-foreground)]">0</p>
                <p class="text-[10px] text-[var(--app-muted)] uppercase">Images</p>
              </div>
              <div class="text-center">
                <p class="text-2xl font-bold text-[var(--app-foreground)]">0</p>
                <p class="text-[10px] text-[var(--app-muted)] uppercase">Videos</p>
              </div>
              <div class="text-center">
                <p class="text-2xl font-bold text-[var(--app-foreground)]">0</p>
                <p class="text-[10px] text-[var(--app-muted)] uppercase">Edits</p>
              </div>
              <div class="text-center">
                <p class="text-2xl font-bold text-[var(--app-foreground)]">0</p>
                <p class="text-[10px] text-[var(--app-muted)] uppercase">Audio</p>
              </div>
            </div>

            <div class="border-t border-[var(--app-border)] pt-4">
              <div class="flex justify-between items-center text-xs text-[var(--app-muted)]">
                <span>Total spent this month</span>
                <span class="font-medium text-[var(--app-foreground)]">&euro;{{ credits.used.toFixed(2) }}</span>
              </div>
            </div>
          </div>
        </div>

        <!-- Pricing Reference -->
        <div class="rounded-lg border border-[var(--app-border)] bg-[var(--app-surface)] overflow-hidden">
          <div class="px-4 py-3 bg-[var(--app-background)] border-b border-[var(--app-border)]">
            <h3 class="text-xs font-semibold text-[var(--app-foreground)] uppercase tracking-wider">Pricing</h3>
          </div>
          <div class="divide-y divide-[var(--app-border)]">
            <div class="flex justify-between px-4 py-2.5">
              <span class="text-sm text-[var(--app-foreground)]">Image Generation</span>
              <span class="text-xs text-[var(--app-muted)]">from &euro;0.02 / image</span>
            </div>
            <div class="flex justify-between px-4 py-2.5">
              <span class="text-sm text-[var(--app-foreground)]">Video Generation</span>
              <span class="text-xs text-[var(--app-muted)]">from &euro;0.10 / video</span>
            </div>
            <div class="flex justify-between px-4 py-2.5">
              <span class="text-sm text-[var(--app-foreground)]">Image Editing</span>
              <span class="text-xs text-[var(--app-muted)]">from &euro;0.01 / edit</span>
            </div>
            <div class="flex justify-between px-4 py-2.5">
              <span class="text-sm text-[var(--app-foreground)]">Audio</span>
              <span class="text-xs text-[var(--app-muted)]">from &euro;0.05 / clip</span>
            </div>
          </div>
        </div>
      </div>
    </template>
  </div>
</template>
