import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const ORG_PROJECT_DETAIL_PATH = resolve(__dirname, '../pages/OrgProjectDetailPage.vue')

describe('OrgProjectDetailPage projects root fallback', () => {
  it('falls back to the saved projects root from settings before opening folder dialogs', () => {
    const source = readFileSync(ORG_PROJECT_DETAIL_PATH, 'utf8')

    expect(source).toContain("import { useProjectDirectory } from '@/composables/useProjectDirectory'")
    expect(source).toContain('const projectDir = useProjectDirectory()')
    expect(source).toContain('async function getPreferredProjectsRoot(): Promise<string | undefined>')
    expect(source).toContain('const root = await projectDir.getProjectsRoot()')
    expect(source).toContain('projectStore.setProjectsRoot(root)')
    expect(source).toContain('const defaultDir = await getPreferredProjectsRoot()')
  })
})
