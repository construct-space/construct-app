import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const PAGE_PATH = resolve(__dirname, '../pages/SpaceDeveloperPage.vue')
const MENU_PATH = resolve(__dirname, '../components/SkillsMenu.vue')

describe('Space Developer runtime skill display', () => {
  it('tracks skills loaded by stream events instead of listing all registered skills', () => {
    const source = readFileSync(PAGE_PATH, 'utf8')

    expect(source).not.toContain('useSkills()')
    expect(source).not.toContain('listSkills()')
    expect(source).toMatch(/chunk\.type === ["']skill\.loaded["']/)
    expect(source).toContain('loadedRunSkills')
  })

  it('labels the menu as loaded skills for the current run', () => {
    const source = readFileSync(MENU_PATH, 'utf8')

    expect(source).toContain('Loaded skills: {{ count }}')
    expect(source).toContain('No skills loaded for this run yet.')
    expect(source).toContain('Skills appear here when the agent loads them on demand.')
    expect(source).toContain('s.id')
    expect(source).toContain('s.source')
  })
})
