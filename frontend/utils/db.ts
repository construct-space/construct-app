/**
 * IndexedDB Database using Dexie.js
 *
 * Tables:
 * - project_settings: Machine-specific project paths
 *
 * NOTE: UI designs are now stored in SQLite via context service.
 * See useLocalDesigns.ts for the UIDesign type.
 */
import Dexie from 'dexie'

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

  constructor() {
    super('ConstructDB')

    this.version(2).stores({
      project_settings: 'projectId',
      // ui_designs removed - now in SQLite
      ui_designs: null, // Delete the table
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
