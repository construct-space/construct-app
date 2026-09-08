import { describe, it, expect } from 'vitest'
import { resolveWindowTypeFromLabel, isSpacePopoutLabel } from './windowType'

describe('isSpacePopoutLabel', () => {
  it('is false for the primary main window and non-main labels', () => {
    expect(isSpacePopoutLabel(null)).toBe(false)
    expect(isSpacePopoutLabel('')).toBe(false)
    expect(isSpacePopoutLabel('main')).toBe(false)
    expect(isSpacePopoutLabel('preview-coder')).toBe(false)
  })
  it('is false for an extra Construct window (main-<timestamp>)', () => {
    // Cmd+N / New Construct Window — numeric suffix → full main window.
    expect(isSpacePopoutLabel('main-1716998561234')).toBe(false)
    expect(isSpacePopoutLabel('main-42')).toBe(false)
  })
  it('is true for real space popouts', () => {
    expect(isSpacePopoutLabel('main-mail')).toBe(true)
    expect(isSpacePopoutLabel('main-board')).toBe(true)
    expect(isSpacePopoutLabel('main-runner')).toBe(true)
    expect(isSpacePopoutLabel('main-proj123-calendar')).toBe(true) // project popout (has dash)
  })
})

describe('resolveWindowTypeFromLabel', () => {
  it('returns "main" for null', () => {
    expect(resolveWindowTypeFromLabel(null)).toBe('main')
  })

  it('returns "main" for empty string', () => {
    expect(resolveWindowTypeFromLabel('')).toBe('main')
  })

  it('returns "main" for the "main" label', () => {
    expect(resolveWindowTypeFromLabel('main')).toBe('main')
  })

  it('returns "space-preview" for preview-* labels', () => {
    expect(resolveWindowTypeFromLabel('preview-coder')).toBe('space-preview')
    expect(resolveWindowTypeFromLabel('preview-my-space-123')).toBe('space-preview')
  })

  it('returns "detach" for detach-space-* labels', () => {
    expect(resolveWindowTypeFromLabel('detach-space-coder-abc123')).toBe('detach')
    expect(resolveWindowTypeFromLabel('detach-space-architect-xyz')).toBe('detach')
  })

  it('returns "detach" for detach-assistant-* labels', () => {
    expect(resolveWindowTypeFromLabel('detach-assistant-abc123')).toBe('detach')
  })

  it('falls back to "main" for unknown labels', () => {
    expect(resolveWindowTypeFromLabel('unknown')).toBe('main')
    expect(resolveWindowTypeFromLabel('standalone-assistant')).toBe('main')
    expect(resolveWindowTypeFromLabel('browser-xyz')).toBe('main')
    expect(resolveWindowTypeFromLabel('detach-other-123')).toBe('main')
  })
})
