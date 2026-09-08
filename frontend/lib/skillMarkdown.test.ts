import { describe, expect, it } from 'vitest'
import { normalizeSkillMarkdown } from './skillMarkdown'

describe('normalizeSkillMarkdown', () => {
  it('quotes frontmatter scalar values containing colon-space so YAML remains valid', () => {
    const input = `---
name: review: security
description: Use when: reviewing PRs
category: custom
trigger: review|security
---

Review the diff.`

    expect(normalizeSkillMarkdown(input)).toBe(`---
name: "review: security"
description: "Use when: reviewing PRs"
category: custom
trigger: review|security
---

Review the diff.`)
  })

  it('leaves already quoted and block scalar values unchanged', () => {
    const input = `---
name: "review: security"
description: >
  Use when: reviewing PRs
category: custom
---

Review the diff.`

    expect(normalizeSkillMarkdown(input)).toBe(input)
  })
})
