import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const SKILLS_SETTINGS_PATH = resolve(__dirname, '../SkillsSettings.vue')

describe('SkillsSettings AI skill generation', () => {
  it('connects brain before dispatching the generator agent', () => {
    const source = readFileSync(SKILLS_SETTINGS_PATH, 'utf8')

    expect(source).toContain('const connected = await brain.connect()')
    expect(source).toMatch(/if \(!connected\)[\s\S]*return[\s\S]*const result = await brain\.dispatch\('ask'/)
  })
})
