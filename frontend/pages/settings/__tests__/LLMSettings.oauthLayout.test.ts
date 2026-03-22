import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('LLMSettings direct OAuth card layout', () => {
  it('keeps the action button from collapsing into the content column', () => {
    const source = readFileSync('/Users/flakerim/Construct/construct-app/frontend/pages/settings/LLMSettings.vue', 'utf8')

    expect(source).toContain('class="flex items-start justify-between gap-3"')
    expect(source).toContain('class="min-w-0 flex-1"')
    expect(source).toContain("class=\"shrink-0 self-start\"")
  })
})
