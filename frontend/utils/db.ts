/**
 * IndexedDB Database using Dexie.js
 *
 * Tables:
 * - project_settings: Machine-specific project paths
 * - pinned: User's pinned sidebar items (UI state — never leaves the
 *   browser; brain has no business owning this)
 *
 * NOTE: UI designs are now stored in SQLite via context service.
 * See useLocalDesigns.ts for the UIDesign type.
 */
import Dexie from 'dexie'
import type { PinnedItem } from '~/stores/pinned'

// ============================================
// Types
// ============================================

export interface ProjectLocalSettings {
  projectId: number
  localPath?: string
  updatedAt: Date
}

// ============================================
// Database
// ============================================

class ConstructDB extends Dexie {
  project_settings!: Dexie.Table<ProjectLocalSettings>
  pinned!: Dexie.Table<PinnedItem>

  constructor() {
    super('ConstructDB')

    this.version(2).stores({
      project_settings: 'projectId',
      // ui_designs removed - now in SQLite
      ui_designs: null, // Delete the table
    })
    // v3 — pinned moved out of the operator/brain wire ops into local
    // IndexedDB. Indexed on id (primary key) + sortOrder so we can list
    // in display order without an in-memory sort.
    this.version(3).stores({
      project_settings: 'projectId',
      ui_designs: null,
      pinned: 'id, sortOrder',
    })
  }
}

export const db = new ConstructDB()

// generateLocalId moved to useLocalDesigns.ts

export const deleteDatabase = async () => {
  db.close()
  await Dexie.delete('ConstructDB')
  console.log('Database deleted. Refresh to recreate.')
}
