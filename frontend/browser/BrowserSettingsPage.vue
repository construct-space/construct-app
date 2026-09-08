<script setup lang="ts">
import { computed, reactive, watch } from 'vue'
import { RotateCcw } from 'lucide-vue-next'
import { Button, Card, Input, Select, Slider, Switch } from '@construct-space/ui'
import type { BrowserSearchEngine, BrowserSettings, BrowserTheme } from './settings'

const props = defineProps<{
  profileName: string
  settings: BrowserSettings
}>()

const emit = defineEmits<{
  (e: 'update:settings', value: BrowserSettings): void
  (e: 'reset-settings'): void
}>()

// eslint-disable-next-line vue/no-setup-props-reactivity-loss
const draft = reactive<BrowserSettings>({ ...props.settings })

const themeOptions: { label: string; value: BrowserTheme }[] = [
  { value: 'dark', label: 'Dark' },
  { value: 'light', label: 'Light' },
]

const searchEngineOptions: { label: string; value: BrowserSearchEngine }[] = [
  { value: 'google', label: 'Google' },
  { value: 'duckduckgo', label: 'DuckDuckGo' },
  { value: 'kagi', label: 'Kagi' },
]

const labelClass = 'block text-xs font-medium text-[var(--app-foreground)] mb-1'
const zoomLabel = computed(() => `${Math.round(draft.defaultZoom * 100)}%`)

watch(
  () => props.settings,
  (next) => {
    Object.assign(draft, next)
  },
  { deep: true },
)

function commit() {
  emit('update:settings', { ...draft })
}

function updateTheme(value: string | string[]) {
  const v = Array.isArray(value) ? value[0] : value
  draft.theme = v === 'light' ? 'light' : 'dark'
  commit()
}

function updateSearchEngine(value: string | string[]) {
  const v = Array.isArray(value) ? value[0] : value
  if (v === 'duckduckgo' || v === 'kagi' || v === 'google') {
    draft.searchEngine = v
    commit()
  }
}

function updateHomeUrl(value: string | number) {
  draft.homeUrl = String(value)
}

function commitHomeUrl() {
  draft.homeUrl = draft.homeUrl.trim()
  commit()
}

function updateDefaultZoom(value: number) {
  draft.defaultZoom = value
  commit()
}

function updateOpenExternalLinksInNewTab(value: boolean) {
  draft.openExternalLinksInNewTab = value
  commit()
}

function updateOpenDownloadsInFolder(value: boolean) {
  draft.openDownloadsInFolder = value
  commit()
}
</script>

<template>
  <section data-testid="browser-settings-shell" class="browser-settings">
    <div class="browser-settings__inner">
      <header class="browser-settings__header">
        <div>
          <p class="browser-settings__eyebrow">{{ profileName }}</p>
          <h1>Browser settings</h1>
        </div>
        <Button variant="ghost" color="neutral" size="xs" label="Restore defaults" @click="emit('reset-settings')">
          <template #leading>
            <RotateCcw class="size-3.5" />
          </template>
        </Button>
      </header>

      <div class="browser-settings__sections">
        <Card
          class="browser-settings__panel"
          title="Appearance"
          description="Customize the browser chrome and default page scale."
        >
          <div class="browser-settings__grid">
            <div>
              <label :class="labelClass">Theme</label>
              <Select
                :model-value="draft.theme"
                :options="themeOptions"
                size="sm"
                @update:model-value="updateTheme"
              />
            </div>

            <div>
              <div class="browser-settings__label-row">
                <label :class="labelClass">Default zoom</label>
                <span class="browser-settings__value">{{ zoomLabel }}</span>
              </div>
              <Slider
                :model-value="draft.defaultZoom"
                :min="0.5"
                :max="2"
                :step="0.1"
                size="sm"
                @update:model-value="updateDefaultZoom"
              />
            </div>
          </div>
        </Card>

        <Card
          class="browser-settings__panel"
          title="Navigation"
          description="Set the starting page and search provider for this browser profile."
        >
          <div class="browser-settings__grid">
            <div @focusout="commitHomeUrl">
              <label :class="labelClass">Home page</label>
              <Input
                :model-value="draft.homeUrl"
                type="text"
                size="sm"
                autocomplete="off"
                placeholder="https://construct.space"
                @update:model-value="updateHomeUrl"
                @keydown.enter.prevent="commitHomeUrl"
              />
            </div>

            <div>
              <label :class="labelClass">Search engine</label>
              <Select
                :model-value="draft.searchEngine"
                :options="searchEngineOptions"
                size="sm"
                @update:model-value="updateSearchEngine"
              />
            </div>
          </div>
        </Card>

        <Card
          class="browser-settings__panel"
          title="Behavior"
          description="Control how browser actions are handled by Construct."
        >
          <div class="browser-settings__stack">
            <div class="browser-settings__toggle-row">
              <div>
                <p class="browser-settings__setting-title">New windows</p>
                <p class="browser-settings__description">Open popups and target blank links in Construct tabs.</p>
              </div>
              <Switch
                :model-value="draft.openExternalLinksInNewTab"
                size="sm"
                @update:model-value="updateOpenExternalLinksInNewTab"
              />
            </div>

            <div class="browser-settings__toggle-row">
              <div>
                <p class="browser-settings__setting-title">Open downloads</p>
                <p class="browser-settings__description">Show downloads in Finder after they complete.</p>
              </div>
              <Switch
                :model-value="draft.openDownloadsInFolder"
                size="sm"
                @update:model-value="updateOpenDownloadsInFolder"
              />
            </div>
          </div>
        </Card>
      </div>
    </div>
  </section>
</template>

<style scoped>
.browser-settings {
  flex: 1;
  min-height: 0;
  overflow: auto;
  background: var(--app-canvas-bg);
  color: var(--app-foreground);
}

.browser-settings__inner {
  max-width: 760px;
  margin: 0 auto;
  padding: 32px 24px 48px;
}

.browser-settings__header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 32px;
}

.browser-settings__header h1 {
  margin: 0;
  font-size: 30px;
  line-height: 1.1;
  font-weight: 700;
  letter-spacing: 0;
}

.browser-settings__eyebrow {
  margin: 0 0 4px;
  color: var(--app-accent);
  font-size: 10px;
  text-transform: uppercase;
  letter-spacing: 0.14em;
}

.browser-settings__sections {
  display: flex;
  flex-direction: column;
  gap: 24px;
}

.browser-settings__grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 16px;
  align-items: start;
}

.browser-settings__label-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.browser-settings__value {
  color: var(--app-muted);
  font-size: 12px;
}

.browser-settings__stack {
  display: flex;
  flex-direction: column;
}

.browser-settings__toggle-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 20px;
  padding: 14px 0;
}

.browser-settings__toggle-row:first-child {
  padding-top: 0;
}

.browser-settings__toggle-row:last-child {
  padding-bottom: 0;
}

.browser-settings__toggle-row + .browser-settings__toggle-row {
  border-top: 1px solid var(--app-border);
}

.browser-settings__setting-title {
  margin: 0;
  color: var(--app-foreground);
  font-size: 14px;
  font-weight: 500;
}

.browser-settings__description {
  margin: 3px 0 0;
  color: var(--app-muted);
  font-size: 12px;
  line-height: 1.4;
}

@media (max-width: 720px) {
  .browser-settings__inner {
    padding: 24px 18px 36px;
  }

  .browser-settings__header {
    flex-direction: column;
    align-items: flex-start;
  }

  .browser-settings__grid {
    grid-template-columns: 1fr;
  }
}
</style>
