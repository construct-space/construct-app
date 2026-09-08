import type { InjectionKey } from 'vue'

export interface FileEntry {
  name: string
  path: string
  isDirectory: boolean
  children?: FileEntry[]
}

interface FileTreeContext {
  state: {
    rootPath: string
    selectedFile: string | null
    expandedFolders: Set<string>
  }
  selectFile: (entry: FileEntry) => Promise<void>
  getFileIcon: (entry: FileEntry) => string
  getFileIconColor: (entry: FileEntry) => string
  // File operations
  deleteEntry: (path: string, isDirectory: boolean) => Promise<boolean>
  renameEntry: (oldPath: string, newName: string) => Promise<boolean>
  duplicateEntry: (path: string) => Promise<boolean>
  copyPath: (path: string) => Promise<boolean>
  copyRelativePath: (path: string) => Promise<boolean>
  copyName: (path: string) => Promise<boolean>
  revealInFinder: (path: string) => Promise<boolean>
  openInTerminal: (path: string) => Promise<boolean>
  createFile: (parentPath: string, fileName: string) => Promise<boolean>
  createFolder: (parentPath: string, folderName: string) => Promise<boolean>
  loadDirectory: (path: string) => Promise<void>
}

export const FileTreeContextKey = Symbol('FileTreeContext') as InjectionKey<FileTreeContext>
