import { describe, expect, it } from 'vitest'
import { marketplaceSpaceToRemote, type MarketplaceSpace } from './useSpaceMarketplace'

function fixture(overrides: Partial<MarketplaceSpace> = {}): MarketplaceSpace {
  return {
    id: 'kanban-board',
    name: 'Kanban Board',
    description: 'Drag-and-drop tasks',
    icon: 'lucide:kanban',
    version: '1.2.3',
    tarball_url: 'https://my.construct.space/api/marketplace/downloads/kanban-board-1.2.3.tar.gz',
    scopes: ['org'],
    project_aware: true,
    publisher_slug: 'acme',
    publisher_name: 'Acme Inc',
    category: 'productivity',
    tags: ['tasks', 'agile'],
    downloads: 42,
    installs_7d: 5,
    installs_30d: 12,
    promoted_at: '2026-04-01T00:00:00Z',
    updated_at: '2026-04-15T00:00:00Z',
    ...overrides,
  }
}

describe('marketplaceSpaceToRemote', () => {
  it('maps marketplace space fields to RemoteSpace', () => {
    const r = marketplaceSpaceToRemote(fixture())
    expect(r.id).toBe('kanban-board')
    expect(r.name).toBe('kanban-board')
    expect(r.display_name).toBe('Kanban Board')
    expect(r.author).toBe('Acme Inc')
    expect(r.category).toBe('productivity')
    expect(r.downloads).toBe(42)
    expect(r.updated_at).toBe('2026-04-15T00:00:00Z')
  })

  it('falls back to first scope when category is null', () => {
    const r = marketplaceSpaceToRemote(fixture({ category: null, scopes: ['app'] }))
    expect(r.category).toBe('app')
  })

  it('falls back to promoted_at when updated_at is empty', () => {
    const r = marketplaceSpaceToRemote(fixture({ updated_at: '' }))
    expect(r.updated_at).toBe('2026-04-01T00:00:00Z')
  })

  it('uses default author when publisher_name is empty', () => {
    const r = marketplaceSpaceToRemote(fixture({ publisher_name: '' }))
    expect(r.author).toBe('Construct Team')
  })
})
