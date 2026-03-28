import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('LLMSettings direct OAuth card layout', () => {
  it('keeps the action button from collapsing into the content column', () => {
    const source = readFileSync('/Users/flakerim/Construct/construct-app/frontend/pages/settings/LLMSettings.vue', 'utf8')

    expect(source).toContain('class="flex items-start justify-between gap-3"')
    expect(source).toContain('class="min-w-0 flex-1"')
    expect(source).toContain("class=\"shrink-0 self-start\"")
  })

  it('loads live providers when the settings page mounts', () => {
    const source = readFileSync('/Users/flakerim/Construct/construct-app/frontend/pages/settings/LLMSettings.vue', 'utf8')

    expect(source).toMatch(/onMounted\(async \(\) => \{[\s\S]*await ensureOperatorConnected\(\)[\s\S]*await loadProviders\(\)/)
  })

  it('shows only connected providers in the models tab', () => {
    const source = readFileSync('/Users/flakerim/Construct/construct-app/frontend/pages/settings/LLMSettings.vue', 'utf8')

    expect(source).toContain('.filter(group => group.provider.active !== false && group.models.length > 0)')
    expect(source).not.toContain('Not connected — add API key or login to use these models')
  })
})
