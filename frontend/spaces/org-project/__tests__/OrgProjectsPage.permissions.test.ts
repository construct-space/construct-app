import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const ORG_PROJECTS_PAGE_PATH = resolve(__dirname, '../pages/OrgProjectsPage.vue')

describe('OrgProjectsPage project creation permissions', () => {
  it('gates the create controls behind the org projects.create permission', () => {
    const source = readFileSync(ORG_PROJECTS_PAGE_PATH, 'utf8')

    expect(source).toContain("import { useOrgPermissions } from '@/spaces/org/composables/useOrgPermissions'")
    expect(source).toContain("const { hasPermission } = useOrgPermissions()")
    expect(source).toContain("const canCreateProjects = computed(() => hasPermission('projects.create'))")
    expect(source).toMatch(/<Button[\s\S]*v-if="canCreateProjects"[\s\S]*label="New project"/)
    expect(source).toContain('<Modal :open="showCreateModal && canCreateProjects" title="New project" @close="showCreateModal = false">')
  })
})
