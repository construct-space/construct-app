import { describe, it, expect, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useBrowserBookmarksStore } from './browserBookmarks'

describe('browserBookmarks store', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('initializes with empty bookmarks and folders', () => {
    const store = useBrowserBookmarksStore()
    expect(store.bookmarks).toEqual([])
    expect(store.folders).toEqual([])
  })

  it('initializes default folders on first call', () => {
    const store = useBrowserBookmarksStore()
    store.initFolders()
    expect(store.folders.length).toBe(1)
    expect(store.folders[0].title).toBe('Favorites')
    expect(store.folders[0].folderId).toBeNull()
  })

  it('does not reinitialize folders on subsequent calls', () => {
    const store = useBrowserBookmarksStore()
    store.initFolders()
    const firstId = store.folders[0].id
    store.initFolders()
    expect(store.folders.length).toBe(1)
    expect(store.folders[0].id).toBe(firstId)
  })

  it('adds a new bookmark', () => {
    const store = useBrowserBookmarksStore()
    const id = store.addBookmark({
      title: 'Google',
      url: 'https://google.com',
      favicon: null,
      folderId: null,
    })
    expect(id).toBeDefined()
    expect(store.bookmarks.length).toBe(1)
    expect(store.bookmarks[0].title).toBe('Google')
    expect(store.bookmarks[0].url).toBe('https://google.com')
  })

  it('prevents duplicate bookmarks by URL', () => {
    const store = useBrowserBookmarksStore()
    const id1 = store.addBookmark({
      title: 'Google',
      url: 'https://google.com',
      favicon: null,
      folderId: null,
    })
    const id2 = store.addBookmark({
      title: 'Google Search',
      url: 'https://google.com',
      favicon: null,
      folderId: null,
    })
    expect(id1).toBe(id2)
    expect(store.bookmarks.length).toBe(1)
  })

  it('removes a bookmark', () => {
    const store = useBrowserBookmarksStore()
    const id = store.addBookmark({
      title: 'Google',
      url: 'https://google.com',
      favicon: null,
      folderId: null,
    })
    store.removeBookmark(id)
    expect(store.bookmarks.length).toBe(0)
  })

  it('checks if a URL is bookmarked', () => {
    const store = useBrowserBookmarksStore()
    store.addBookmark({
      title: 'Google',
      url: 'https://google.com',
      favicon: null,
      folderId: null,
    })
    expect(store.isBookmarked('https://google.com')).toBe(true)
    expect(store.isBookmarked('https://example.com')).toBe(false)
  })

  it('gets bookmarks by folder', () => {
    const store = useBrowserBookmarksStore()
    store.initFolders()
    store.addBookmark({
      title: 'Google',
      url: 'https://google.com',
      favicon: null,
      folderId: null,
    })
    store.addBookmark({
      title: 'Bing',
      url: 'https://bing.com',
      favicon: null,
      folderId: 'favorites',
    })
    const rootBookmarks = store.getBookmarksByFolder(null)
    const favBookmarks = store.getBookmarksByFolder('favorites')
    expect(rootBookmarks.length).toBe(1)
    expect(favBookmarks.length).toBe(1)
  })

  it('adds a new folder', () => {
    const store = useBrowserBookmarksStore()
    const id = store.addFolder({
      title: 'Work',
      folderId: null,
    })
    expect(id).toBeDefined()
    expect(store.folders.length).toBe(1)
    expect(store.folders[0].title).toBe('Work')
  })

  it('removes a folder and its bookmarks', () => {
    const store = useBrowserBookmarksStore()
    const folderId = store.addFolder({
      title: 'Work',
      folderId: null,
    })
    store.addBookmark({
      title: 'Work Site',
      url: 'https://work.com',
      favicon: null,
      folderId: folderId,
    })
    expect(store.bookmarks.length).toBe(1)
    store.removeFolder(folderId)
    expect(store.folders.length).toBe(0)
    expect(store.bookmarks.length).toBe(0)
  })
})
