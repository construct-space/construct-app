import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const MEMBER_DETAIL_PATH = resolve(__dirname, '../pages/members/[id].vue')

describe('member detail role editing', () => {
  it('submits role_id instead of the display role string', () => {
    const source = readFileSync(MEMBER_DETAIL_PATH, 'utf8')

    expect(source).toContain("const editRoleId = ref('')")
    expect(source).toContain('updates.role_id = editRoleId.value || resolveRoleId(member.value) || null')
    expect(source).not.toContain('role: editRole.value')
    expect(source).toContain('<Select')
    expect(source).toContain("value: r.id, label: r.name")
  })
})
