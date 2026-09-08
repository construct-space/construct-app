import { describe, it, expect } from 'vitest'
import { type SpaceSource, resolveJsEntry, resolveCssEntries } from './SpaceSource'

function fakeSource(spaceId: string, entries: string[]): SpaceSource {
  return {
    spaceId,
    kind: 'zip',
    listEntries: async () => entries,
    entryExists: async (e: string) => entries.includes(e),
    readText: async () => '',
    readBytes: async () => new Uint8Array(),
    assetUrl: (e: string) => `space://localhost/${spaceId}/${e}`,
  }
}

describe('resolveJsEntry', () => {
  it('prefers the canonical app.iife.js', async () => {
    const src = fakeSource('weather', ['manifest.json', 'app.iife.js', 'space-weather.iife.js'])
    expect(await resolveJsEntry(src)).toBe('app.iife.js')
  })

  it('falls back to space-<id>.iife.js (the newer CLI naming)', async () => {
    const src = fakeSource('weather', ['manifest.json', 'space-weather.iife.js', 'space-weather.css'])
    expect(await resolveJsEntry(src)).toBe('space-weather.iife.js')
  })

  it('falls back to any top-level *.iife.js', async () => {
    const src = fakeSource('weather', ['manifest.json', 'bundle.iife.js'])
    expect(await resolveJsEntry(src)).toBe('bundle.iife.js')
  })

  it('ignores nested *.iife.js and returns null when no top-level bundle exists', async () => {
    const src = fakeSource('weather', ['manifest.json', 'vendor/x.iife.js'])
    expect(await resolveJsEntry(src)).toBeNull()
  })
})

describe('resolveCssEntries', () => {
  it('prefers style.css, then space-<id>.css', async () => {
    const src = fakeSource('weather', ['style.css', 'space-weather.css', 'other.css'])
    expect(await resolveCssEntries(src)).toEqual(['style.css', 'space-weather.css', 'other.css'])
  })

  it('uses space-<id>.css when there is no style.css', async () => {
    const src = fakeSource('weather', ['space-weather.css'])
    expect(await resolveCssEntries(src)).toEqual(['space-weather.css'])
  })

  it('returns [] when CSS is inlined (no css file) — not an error', async () => {
    const src = fakeSource('calendar', ['manifest.json', 'space-calendar.iife.js'])
    expect(await resolveCssEntries(src)).toEqual([])
  })
})
