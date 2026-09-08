# Universal File & Image Input

**Date:** 2026-04-03
**Status:** Approved

## Problem

AgentInput has UI for image paste, drag-drop, and file picking, but:
- Images are stored as base64 data URLs (bloats IPC, not sent to operator)
- Files don't capture the disk path (FileBlock.path is empty)
- useAgentSession only extracts text blocks — attachments are dropped
- Operator Message struct has no content block support
- Anthropic connector only sends plain text content

## Design

### Principle

Send **file paths** over IPC. Go operator reads files from disk, determines type, and builds the appropriate Claude API content blocks. No base64 over the Tauri bridge.

### Layer 1: Frontend (AgentInput)

**Current issues to fix:**
- Drag-drop and file picker use `FileReader.readAsDataURL()` → change to capture the native file path
- Pasted images (clipboard) have no path → write to temp dir via Tauri fs, then use that path
- FileBlock.path is optional and often empty → make it the primary data

**Changes:**

1. **Drag-drop** (`handleDrop`): In Tauri, dropped files expose their path. Use `@tauri-apps/api/webviewWindow` drag-drop event or access `file.path` from the Tauri file drop payload. Store as `FileBlock { type: 'file', name, path, size }` for all file types (including images).

2. **File picker** (`handleFileSelect`): Use Tauri's `@tauri-apps/plugin-dialog` `open()` instead of `<input type="file">` for native path access. Falls back to HTML file input in browser mode.

3. **Paste** (`handlePaste`): Clipboard images have no path. Write the blob to a temp file: `${dataDir}/tmp/paste-${timestamp}.png`, then store as FileBlock with that path.

4. **ImageBlock deprecation**: Stop using ImageBlock for new attachments. All attachments become `FileBlock` with a path. Keep ImageBlock type for backward compat but don't create new ones.

5. **Attachment previews**: For image files, render `<img :src="convertFileSrc(att.path)">` using Tauri's `convertFileSrc` for webview-safe URLs. Show file icon + name for non-images.

6. **Conversation history**: Store FileBlock in Turn data. Render images inline via `convertFileSrc(path)`. On image load error (file deleted), show a placeholder with the original filename.

### Layer 2: Transport (useAgentSession → operator)

**Changes to `useAgentSession.send()`:**

Currently extracts only text:
```ts
const text = blocks.filter(b => b.type === 'text').map(b => b.content).join('\n')
operator.dispatchStream({ task: text, ... })
```

Change to forward all blocks:
```ts
const contentBlocks = blocks.map(b => {
  if (b.type === 'text') return { type: 'text', content: b.content }
  if (b.type === 'file') return { type: 'file', path: b.path, name: b.name }
  return null
}).filter(Boolean)
operator.dispatchStream({ task: textContent, content_blocks: contentBlocks, ... })
```

**IPC format** (operator_stream command args):
```json
{
  "agent_id": "coder",
  "task": "analyze this screenshot",
  "content_blocks": [
    { "type": "file", "path": "/Users/.../screenshot.png", "name": "screenshot.png" }
  ]
}
```

### Layer 3: Operator (Go)

**New types in `provider/provider.go`:**

```go
type ContentBlock struct {
    Type     string `json:"type"`      // "text", "image", "file", "document"
    Content  string `json:"content"`   // For text blocks
    Path     string `json:"path"`      // Disk path for file/image
    Name     string `json:"name"`      // Display name
    MimeType string `json:"mime_type"` // Resolved MIME type
    Data     string `json:"data"`      // Base64 data (filled by operator after reading)
}

type Message struct {
    Role          string         `json:"role"`
    Content       string         `json:"content"`
    ContentBlocks []ContentBlock `json:"content_blocks,omitempty"` // NEW
    // ... existing fields
}
```

**File processing pipeline (new function `resolveContentBlocks`):**

1. Receive `content_blocks` from IPC
2. For each block with a `path`:
   - Stat the file, get size
   - Determine MIME type from extension
   - Route by type:

| File Type | Extensions | Action |
|-----------|-----------|--------|
| Image (raster) | png, jpg, jpeg, gif, webp | Read → resize to max 1568px → base64 → `image` content block |
| Image (vector) | svg | Read as text → `text` content block (XML) |
| Text | md, txt, csv, json, yaml, toml, ts, js, go, rs, py, vue, html, css, sh, sql, xml | Read as text → `text` content block |
| PDF | pdf | Read → base64 → `document` content block |
| Binary/unknown | * | Skip with warning log |

3. Image resize: Use Go's `image` + `image/png` + `image/jpeg` stdlib. Scale down if either dimension > 1568px, maintaining aspect ratio.

**Anthropic connector changes (`buildBody`):**

When `msg.ContentBlocks` is non-empty, build Claude's content array:

```json
{
  "role": "user",
  "content": [
    { "type": "text", "text": "analyze this" },
    { "type": "image", "source": { "type": "base64", "media_type": "image/png", "data": "..." } },
    { "type": "document", "source": { "type": "base64", "media_type": "application/pdf", "data": "..." } }
  ]
}
```

Other provider connectors (OpenAI, Gemini): ignore content blocks for now, only send text. Log a warning if image blocks are present but provider doesn't support them.

### File Type Detection

Simple extension-based lookup. No need for magic byte detection:

```go
var imageExts = map[string]string{
    ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
    ".gif": "image/gif", ".webp": "image/webp", ".svg": "image/svg+xml",
}
var textExts = map[string]bool{
    ".md": true, ".txt": true, ".csv": true, ".json": true,
    ".yaml": true, ".yml": true, ".toml": true,
    ".ts": true, ".js": true, ".go": true, ".rs": true, ".py": true,
    ".vue": true, ".html": true, ".css": true, ".sh": true,
    ".sql": true, ".xml": true, ".jsx": true, ".tsx": true,
}
```

### Conversation History

- **First send**: File is read from disk and sent to Claude with content blocks
- **Subsequent messages in same session**: Only text. Files are NOT re-sent (Claude remembers within the conversation)
- **Turn storage**: `Turn.request` stores `FileBlock { path, name }` so the UI can render it
- **Image rendering**: `<img :src="convertFileSrc(block.path)" @error="showPlaceholder">` 
- **File deleted**: `@error` handler shows a gray placeholder with filename text

### Error Handling

- File not found: skip block, add system note "File not found: {name}"
- File too large (>20MB): skip block, add system note "File too large: {name} ({size}MB, max 20MB)"  
- Unsupported type: skip block, add system note "Unsupported file type: {name}"
- Read permission denied: skip block, add system note

## Out of Scope

- Video/audio file support
- Non-Claude provider image support (GPT, Gemini — added later per provider)
- Re-sending files in conversation history to API
- Image editing/annotation before sending
- Multiple file drag-drop ordering

## Files to Modify

### Frontend
- `frontend/components/agent/AgentInput.vue` — file path capture, Tauri dialog, paste-to-temp
- `frontend/assistant/blocks.ts` — ensure FileBlock.path is primary
- `frontend/operator/useAgentSession.ts` — forward content_blocks to operator
- `frontend/operator/client.ts` — add content_blocks to dispatchStream args
- Conversation rendering components — inline image display with error fallback

### Operator (Go)
- `operator/internal/provider/provider.go` — ContentBlock type, Message.ContentBlocks field
- `operator/internal/provider/connectors/anthropic.go` — buildBody content array
- New file: `operator/internal/provider/content.go` — resolveContentBlocks, image resize, file type detection
- `operator/internal/agent/dispatch.go` (or similar) — receive content_blocks from IPC, pass through
