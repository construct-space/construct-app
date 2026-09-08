# Browser Improvements Summary

This document outlines all improvements made to the Browser component during the recent enhancement cycle.

## Overview

The browser was enhanced with:
- Find-in-page functionality (Cmd+F)
- Expanded settings options using Construct UI
- Fixed visibility and focus issues
- Improved UX with organized settings sections

## Changes Made

### 1. Find-in-Page Feature (Find Bar)

**Problem**: Find bar wasn't visible when viewing websites because native Tauri webviews overlay Vue components.

**Solution**: Inject Find bar UI directly into the webview DOM instead of rendering it as a Vue overlay.

**Files Modified**:
- `frontend/browser/findController.ts`

**What Changed**:
- Added `buildFindBarHtml()` function that creates a styled Find bar UI with input, results counter, and navigation buttons
- Modified `buildFindScript()` to include Find bar creation functions: `createFindBar()`, `updateFindBar()`, `setupFindBarListeners()`, `closeFindBar()`
- Added `showBar()` and `hideBar()` methods to `window.__CONSTRUCT_FIND__` API
- Removed auto-creation of Find bar (deferred until user toggles)

**How It Works**:
1. User presses Cmd+F (Mac) or Ctrl+F (Windows/Linux)
2. `toggleFind()` in BrowserApp injects the find script
3. After injection, `window.__CONSTRUCT_FIND__.showBar()` is called
4. Find bar UI appears at bottom-right of webview content
5. User can:
   - Type to search (highlights all matches)
   - Press Enter or click next/prev buttons to navigate
   - Press Escape or click X to close

**Features**:
- CSS Highlight API with fallback to mark elements
- Smooth scroll to active match
- Real-time results counter
- Yellow highlights for matches, orange for active match

### 2. Address Bar Focus Fix

**Problem**: Find bar injection was automatically creating and focusing the input on page load, stealing focus from the address bar.

**Solution**: Defer Find bar creation until user explicitly toggles Find on.

**Files Modified**:
- `frontend/browser/BrowserApp.vue`
- `frontend/browser/findController.ts`

**What Changed**:
- Removed auto-call to `createFindBar()` at end of injected script
- Updated `toggleFind()` handler to explicitly call `showBar()` when toggling on, `hideBar()` when toggling off
- Find script is still injected once per tab, but bar UI only created on user demand

### 3. Enhanced Settings Page with Construct UI

**Problem**: Settings were limited and used custom styled form elements. UI wasn't unified with Construct design.

**Solution**: Refactor to use Construct UI components and add 3 new settings options.

**Files Modified**:
- `frontend/browser/settings.ts`
- `frontend/browser/BrowserSettingsPage.vue`
- `frontend/browser/settings.test.ts`

**New Settings Added**:

#### Theme
- **Type**: Radio/Select (dark or light)
- **Stored in**: `browserSettings.theme`
- **Default**: `'dark'`
- **Purpose**: Allow users to switch between dark and light themes

#### Default Zoom Level
- **Type**: Slider (0.5 to 2.0, step 0.1)
- **Stored in**: `browserSettings.defaultZoom`
- **Default**: `1` (100%)
- **Purpose**: Set initial zoom for new tabs
- **UI**: Shows live percentage (e.g., "120%")

#### Open Downloads in Folder
- **Type**: Toggle Switch
- **Stored in**: `browserSettings.openDownloadsInFolder`
- **Default**: `false`
- **Purpose**: Automatically open downloads in folder after completion

**Construct UI Components Used**:
- `Button` - for "Restore defaults"
- `Input` - for home page URL
- `SelectMenu` - for theme and search engine
- `Slider` - for zoom level
- `Switch` - for toggles (popup links, open downloads)

**Settings Organization**:
The settings page now has 3 organized sections:

1. **Appearance**
   - Theme selector
   - Default zoom level slider

2. **Navigation**
   - Home page URL input
   - Search engine selector (Google, DuckDuckGo, Kagi)

3. **Behavior**
   - Popup links toggle (open in new tabs)
   - Open downloads toggle (show in folder)

### 4. Updated Type System

**Files Modified**:
- `frontend/browser/settings.ts`

**New Types**:
```typescript
export type BrowserTheme = 'dark' | 'light'

export interface BrowserSettings {
  homeUrl: string
  searchEngine: BrowserSearchEngine
  openExternalLinksInNewTab: boolean
  zoomByOrigin: Record<string, number>
  pinnedTabUrls: string[]
  theme: BrowserTheme           // NEW
  defaultZoom: number           // NEW
  openDownloadsInFolder: boolean // NEW
}
```

**Sanitization Updated**:
- `sanitizeBrowserSettings()` validates all new fields
- Theme: only accepts 'dark' or 'light', defaults to 'dark'
- Default zoom: validates range (0.5-2.0), defaults to 1
- Open downloads: boolean, defaults to false

## Testing

All changes are tested and verified:
- `frontend/browser/settings.test.ts` - Settings sanitization with new fields
- `frontend/components/browser/__tests__/BrowserFindBar.test.ts` - Find bar component (12 tests)
- Type checking passes (`bun run typecheck`)
- All tests pass (`bun run test`)

## Git Commits

1. **cb3784fe** - Fix Find bar visibility by injecting UI into webview
2. **b33f7460** - Add theme, default zoom, and open-downloads settings with construct-ui
3. **44b7ef87** - Fix address bar focus theft by deferring Find bar creation

## Usage

### Testing Locally

```bash
bun run dev
```

Then:
1. Press Cmd+F (Mac) to open Find bar
2. Type to search on any webpage
3. Use Enter/Shift+Enter to navigate results
4. Go to Browser Settings (gear icon in header)
5. Adjust theme, zoom, and behavior settings

### Settings Storage

All settings are persisted to the user's profile storage:
- Key: `construct:browser:settings:v1`
- Format: JSON
- Stored via `profileStorage.setItem()`

### Find Script Injection

The find script is injected once per tab and stays injected. The Find bar UI is created/destroyed as needed:
- Created when: User presses Cmd+F and script exists
- Destroyed when: User presses Escape or clicks close button

## Architecture Notes

### Find Bar in Webview
- Positioned `fixed` at bottom-right
- z-index: 2147483647 (max value) to stay on top
- Uses injected CSS and HTML
- Event listeners wired in injected script
- Communication with Vue through `browser_eval_webview` commands

### Settings Persistence
- Loaded on app boot
- Saved on every change
- Validated on load with sanitization
- Merged with defaults if missing

### UI Consistency
- Uses Construct UI components throughout
- Matches existing Construct design system
- Responsive (mobile-friendly)
- Organized in logical sections with clear hierarchy

## Future Enhancements

Possible future additions:
- Per-origin theme preference
- Search history suggestions
- Tab persistence across sessions
- Custom search engines
- Privacy mode (no history tracking)
- Download folder customization
