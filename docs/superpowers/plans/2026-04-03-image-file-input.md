# Universal File & Image Input — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enable sending images and files to AI models via the chat input, using file paths over IPC and Go-side file processing.

**Architecture:** Frontend captures file paths (Tauri dialog / drag-drop), sends them as `content_blocks` alongside the task text to the operator. Go reads files from disk, determines type (image/text/PDF), resizes images, and builds Claude API content arrays.

**Tech Stack:** Vue 3, Tauri 2 (fs/dialog plugins), Go stdlib (image, encoding/base64), Claude Messages API

---

### Task 1: Go ContentBlock type and file resolver

**Files:**
- Create: `operator/internal/provider/content.go`
- Modify: `operator/internal/provider/provider.go:42-48`
- Test: `operator/internal/provider/content_test.go`

- [ ] **Step 1: Write failing test for file type detection**

```go
// operator/internal/provider/content_test.go
package provider

import "testing"

func TestDetectFileType(t *testing.T) {
	tests := []struct {
		name string
		want FileType
	}{
		{"photo.png", FileTypeImage},
		{"photo.jpg", FileTypeImage},
		{"photo.webp", FileTypeImage},
		{"icon.svg", FileTypeText}, // SVG is text (XML)
		{"readme.md", FileTypeText},
		{"data.csv", FileTypeText},
		{"main.go", FileTypeText},
		{"app.vue", FileTypeText},
		{"report.pdf", FileTypeDocument},
		{"archive.zip", FileTypeUnsupported},
		{"video.mp4", FileTypeUnsupported},
	}
	for _, tt := range tests {
		if got := DetectFileType(tt.name); got != tt.want {
			t.Errorf("DetectFileType(%q) = %v, want %v", tt.name, got, tt.want)
		}
	}
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd operator && go test ./internal/provider/ -run TestDetectFileType -v`
Expected: FAIL — `DetectFileType` not defined

- [ ] **Step 3: Implement ContentBlock type and DetectFileType**

```go
// operator/internal/provider/content.go
package provider

import (
	"path/filepath"
	"strings"
)

// FileType classifies files for content block handling.
type FileType int

const (
	FileTypeUnsupported FileType = iota
	FileTypeText
	FileTypeImage
	FileTypeDocument
)

// ContentBlock is a file or text attachment sent alongside a user message.
type ContentBlock struct {
	Type     string `json:"type"`               // "text", "file"
	Content  string `json:"content,omitempty"`   // For inline text blocks
	Path     string `json:"path,omitempty"`      // Disk path
	Name     string `json:"name,omitempty"`      // Display name
	MimeType string `json:"mime_type,omitempty"` // Resolved MIME
	Data     string `json:"data,omitempty"`      // Base64 (filled after reading)
}

var imageExts = map[string]string{
	".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
	".gif": "image/gif", ".webp": "image/webp",
}

var textExts = map[string]bool{
	".md": true, ".txt": true, ".csv": true, ".json": true,
	".yaml": true, ".yml": true, ".toml": true, ".xml": true,
	".ts": true, ".tsx": true, ".js": true, ".jsx": true,
	".go": true, ".rs": true, ".py": true, ".rb": true,
	".vue": true, ".svelte": true, ".html": true, ".htm": true,
	".css": true, ".scss": true, ".less": true,
	".sh": true, ".bash": true, ".zsh": true,
	".sql": true, ".graphql": true, ".gql": true,
	".swift": true, ".kt": true, ".java": true, ".c": true, ".cpp": true, ".h": true,
	".dart": true, ".cs": true, ".php": true,
	".svg": true, // SVG is XML text
	".env": true, ".gitignore": true,
	".lock": true, ".log": true,
}

// DetectFileType classifies a file by its extension.
func DetectFileType(name string) FileType {
	ext := strings.ToLower(filepath.Ext(name))
	if _, ok := imageExts[ext]; ok {
		return FileTypeImage
	}
	if textExts[ext] {
		return FileTypeText
	}
	if ext == ".pdf" {
		return FileTypeDocument
	}
	return FileTypeUnsupported
}

// ImageMIME returns the MIME type for an image extension, or empty string.
func ImageMIME(name string) string {
	ext := strings.ToLower(filepath.Ext(name))
	return imageExts[ext]
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd operator && go test ./internal/provider/ -run TestDetectFileType -v`
Expected: PASS

- [ ] **Step 5: Add ContentBlocks field to Message**

In `operator/internal/provider/provider.go`, add to the Message struct (after line 47):

```go
type Message struct {
	Role             string         `json:"role"`
	Content          string         `json:"content,omitempty"`
	ContentBlocks    []ContentBlock `json:"content_blocks,omitempty"`
	ReasoningContent string         `json:"reasoning_content,omitempty"`
	ToolCalls        []ToolCall     `json:"tool_calls,omitempty"`
	ToolResult       *ToolResult    `json:"tool_result,omitempty"`
}
```

- [ ] **Step 6: Commit**

```bash
git add operator/internal/provider/content.go operator/internal/provider/content_test.go operator/internal/provider/provider.go
git commit -m "feat: add ContentBlock type, file detection, and Message.ContentBlocks field"
```

---

### Task 2: Go file reader and image resizer

**Files:**
- Modify: `operator/internal/provider/content.go`
- Test: `operator/internal/provider/content_test.go`

- [ ] **Step 1: Write failing test for ResolveContentBlocks**

```go
// append to operator/internal/provider/content_test.go
func TestResolveContentBlocks(t *testing.T) {
	// Create a temp text file
	dir := t.TempDir()
	txtPath := filepath.Join(dir, "test.md")
	os.WriteFile(txtPath, []byte("# Hello\nWorld"), 0644)

	blocks := []ContentBlock{
		{Type: "file", Path: txtPath, Name: "test.md"},
	}

	resolved, warnings := ResolveContentBlocks(blocks)
	if len(warnings) > 0 {
		t.Errorf("unexpected warnings: %v", warnings)
	}
	if len(resolved) != 1 {
		t.Fatalf("expected 1 resolved block, got %d", len(resolved))
	}
	if resolved[0].Type != "text" {
		t.Errorf("expected type 'text', got %q", resolved[0].Type)
	}
	if resolved[0].Content != "# Hello\nWorld" {
		t.Errorf("unexpected content: %q", resolved[0].Content)
	}
}

func TestResolveContentBlocks_MissingFile(t *testing.T) {
	blocks := []ContentBlock{
		{Type: "file", Path: "/nonexistent/file.txt", Name: "file.txt"},
	}
	resolved, warnings := ResolveContentBlocks(blocks)
	if len(resolved) != 0 {
		t.Errorf("expected 0 resolved blocks for missing file, got %d", len(resolved))
	}
	if len(warnings) != 1 {
		t.Fatalf("expected 1 warning, got %d", len(warnings))
	}
}

func TestResolveContentBlocks_Image(t *testing.T) {
	// Create a minimal 1x1 PNG
	dir := t.TempDir()
	imgPath := filepath.Join(dir, "test.png")

	img := image.NewRGBA(image.Rect(0, 0, 1, 1))
	f, _ := os.Create(imgPath)
	png.Encode(f, img)
	f.Close()

	blocks := []ContentBlock{
		{Type: "file", Path: imgPath, Name: "test.png"},
	}
	resolved, warnings := ResolveContentBlocks(blocks)
	if len(warnings) > 0 {
		t.Errorf("unexpected warnings: %v", warnings)
	}
	if len(resolved) != 1 {
		t.Fatalf("expected 1 block, got %d", len(resolved))
	}
	if resolved[0].Type != "image" {
		t.Errorf("expected type 'image', got %q", resolved[0].Type)
	}
	if resolved[0].MimeType != "image/png" {
		t.Errorf("expected mime 'image/png', got %q", resolved[0].MimeType)
	}
	if resolved[0].Data == "" {
		t.Error("expected base64 data, got empty")
	}
}
```

Add imports at top of test file: `"image"`, `"image/png"`, `"os"`, `"path/filepath"`

- [ ] **Step 2: Run test to verify it fails**

Run: `cd operator && go test ./internal/provider/ -run TestResolveContentBlocks -v`
Expected: FAIL — `ResolveContentBlocks` not defined

- [ ] **Step 3: Implement ResolveContentBlocks**

Append to `operator/internal/provider/content.go`:

```go
import (
	"encoding/base64"
	"fmt"
	"image"
	_ "image/gif"
	"image/jpeg"
	"image/png"
	_ "golang.org/x/image/webp"
	"bytes"
	"os"
)

const maxImageDimension = 1568
const maxFileSize = 20 * 1024 * 1024 // 20MB

// ResolveContentBlocks reads files from disk and converts them to API-ready content blocks.
// Returns resolved blocks and any warning messages (for skipped files).
func ResolveContentBlocks(blocks []ContentBlock) (resolved []ContentBlock, warnings []string) {
	for _, b := range blocks {
		if b.Type == "text" {
			resolved = append(resolved, b)
			continue
		}
		if b.Path == "" {
			continue
		}

		info, err := os.Stat(b.Path)
		if err != nil {
			warnings = append(warnings, fmt.Sprintf("File not found: %s", b.Name))
			continue
		}
		if info.Size() > maxFileSize {
			warnings = append(warnings, fmt.Sprintf("File too large: %s (%.1fMB, max 20MB)", b.Name, float64(info.Size())/(1024*1024)))
			continue
		}

		ft := DetectFileType(b.Name)
		switch ft {
		case FileTypeText:
			data, err := os.ReadFile(b.Path)
			if err != nil {
				warnings = append(warnings, fmt.Sprintf("Cannot read: %s", b.Name))
				continue
			}
			resolved = append(resolved, ContentBlock{
				Type:    "text",
				Content: fmt.Sprintf("[File: %s]\n%s", b.Name, string(data)),
				Name:    b.Name,
			})

		case FileTypeImage:
			data, err := readAndResizeImage(b.Path)
			if err != nil {
				warnings = append(warnings, fmt.Sprintf("Cannot process image: %s — %v", b.Name, err))
				continue
			}
			resolved = append(resolved, ContentBlock{
				Type:     "image",
				MimeType: ImageMIME(b.Name),
				Data:     data,
				Name:     b.Name,
			})

		case FileTypeDocument:
			data, err := os.ReadFile(b.Path)
			if err != nil {
				warnings = append(warnings, fmt.Sprintf("Cannot read: %s", b.Name))
				continue
			}
			resolved = append(resolved, ContentBlock{
				Type:     "document",
				MimeType: "application/pdf",
				Data:     base64.StdEncoding.EncodeToString(data),
				Name:     b.Name,
			})

		default:
			warnings = append(warnings, fmt.Sprintf("Unsupported file type: %s", b.Name))
		}
	}
	return
}

// readAndResizeImage reads an image, resizes if > maxImageDimension, returns base64.
func readAndResizeImage(path string) (string, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return "", err
	}

	img, format, err := image.Decode(bytes.NewReader(data))
	if err != nil {
		// Can't decode (e.g. unsupported format) — send raw base64
		return base64.StdEncoding.EncodeToString(data), nil
	}

	bounds := img.Bounds()
	w, h := bounds.Dx(), bounds.Dy()

	// No resize needed
	if w <= maxImageDimension && h <= maxImageDimension {
		return base64.StdEncoding.EncodeToString(data), nil
	}

	// Calculate new dimensions maintaining aspect ratio
	scale := float64(maxImageDimension) / float64(max(w, h))
	newW := int(float64(w) * scale)
	newH := int(float64(h) * scale)

	// Simple nearest-neighbor resize (good enough for AI vision)
	dst := image.NewRGBA(image.Rect(0, 0, newW, newH))
	for y := 0; y < newH; y++ {
		for x := 0; x < newW; x++ {
			srcX := x * w / newW
			srcY := y * h / newH
			dst.Set(x, y, img.At(srcX+bounds.Min.X, srcY+bounds.Min.Y))
		}
	}

	var buf bytes.Buffer
	switch format {
	case "jpeg":
		jpeg.Encode(&buf, dst, &jpeg.Options{Quality: 85})
	default:
		png.Encode(&buf, dst)
	}

	return base64.StdEncoding.EncodeToString(buf.Bytes()), nil
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd operator && go test ./internal/provider/ -run TestResolveContentBlocks -v`
Expected: PASS (all 3 subtests)

- [ ] **Step 5: Commit**

```bash
git add operator/internal/provider/content.go operator/internal/provider/content_test.go
git commit -m "feat: implement ResolveContentBlocks with image resize and file type handling"
```

---

### Task 3: Wire content blocks through dispatch handler

**Files:**
- Modify: `operator/internal/ai/module.go:347-373`

- [ ] **Step 1: Add ContentBlocks to dispatch payload**

In `operator/internal/ai/module.go`, update the `handleDispatchStream` payload struct (line 348) and message building:

```go
func (m *AIModule) handleDispatchStream(reqCtx context.Context, req transport.Request, emit func(transport.StreamChunk)) {
	var payload struct {
		AgentID       string               `json:"agent_id"`
		Task          string               `json:"task"`
		Model         string               `json:"model,omitempty"`
		Messages      []provider.Message    `json:"messages,omitempty"`
		ContentBlocks []provider.ContentBlock `json:"content_blocks,omitempty"`
		SessionID     string               `json:"session_id,omitempty"`
		ProjectPath   string               `json:"project_path,omitempty"`
		ProjectName   string               `json:"project_name,omitempty"`
		AssistantType string               `json:"assistant_type,omitempty"`
		OutputSchema  string               `json:"output_schema,omitempty"`
		FastMode      bool                 `json:"fast_mode,omitempty"`
	}
```

- [ ] **Step 2: Resolve content blocks and attach to the user message**

After the payload parsing and before agent resolution (after line 369), add content block resolution:

```go
	if payload.Task == "" {
		payload.Task = lastUserMessage(payload.Messages)
	}

	// Resolve file content blocks (read from disk, resize images, etc.)
	if len(payload.ContentBlocks) > 0 {
		resolved, warnings := provider.ResolveContentBlocks(payload.ContentBlocks)
		for _, w := range warnings {
			fmt.Fprintf(os.Stderr, "[dispatch] content block warning: %s\n", w)
		}
		// If we have no messages yet, we'll build one with task + content blocks
		if len(payload.Messages) == 0 && payload.Task != "" {
			payload.Messages = []provider.Message{{
				Role:          "user",
				Content:       payload.Task,
				ContentBlocks: resolved,
			}}
			payload.Task = "" // prevent double-send
		} else if len(payload.Messages) > 0 {
			// Attach to the last user message
			last := &payload.Messages[len(payload.Messages)-1]
			if last.Role == "user" {
				last.ContentBlocks = append(last.ContentBlocks, resolved...)
			}
		}
	}

	if payload.Task == "" && len(payload.Messages) == 0 {
		emitStreamError(req, emit, "task is required")
		return
	}
```

- [ ] **Step 3: Run operator tests**

Run: `cd operator && go test ./... -short`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add operator/internal/ai/module.go
git commit -m "feat: wire content blocks through dispatch stream handler"
```

---

### Task 4: Anthropic connector content block support

**Files:**
- Modify: `operator/internal/provider/connectors/anthropic.go:199-232`

- [ ] **Step 1: Update buildBody to handle ContentBlocks**

Replace the else branch (line 228-229) in `buildBody` to check for content blocks:

```go
		} else if len(m.ContentBlocks) > 0 {
			content := []map[string]any{}
			if m.Content != "" {
				content = append(content, map[string]any{"type": "text", "text": m.Content})
			}
			for _, cb := range m.ContentBlocks {
				switch cb.Type {
				case "text":
					content = append(content, map[string]any{"type": "text", "text": cb.Content})
				case "image":
					content = append(content, map[string]any{
						"type": "image",
						"source": map[string]any{
							"type":       "base64",
							"media_type": cb.MimeType,
							"data":       cb.Data,
						},
					})
				case "document":
					content = append(content, map[string]any{
						"type": "document",
						"source": map[string]any{
							"type":       "base64",
							"media_type": cb.MimeType,
							"data":       cb.Data,
						},
					})
				}
			}
			msg["content"] = content
		} else {
			msg["content"] = m.Content
		}
```

- [ ] **Step 2: Run operator tests**

Run: `cd operator && go test ./... -short`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add operator/internal/provider/connectors/anthropic.go
git commit -m "feat: Anthropic connector builds image/document content blocks"
```

---

### Task 5: Frontend — dispatchStream accepts content_blocks

**Files:**
- Modify: `frontend/operator/client.ts:353-386`
- Modify: `frontend/operator/useAgentSession.ts:236-281`

- [ ] **Step 1: Add contentBlocks to dispatchStream signature**

In `frontend/operator/client.ts`, update `dispatchStream` (line 353):

```typescript
  async function dispatchStream(
    agentId: string,
    task: string,
    onChunk: (chunk: StreamEvent) => void,
    onDone?: (result: DispatchResult) => void,
    onError?: (error: string) => void,
    model?: string,
    options?: {
      projectPath?: string
      projectName?: string
      sessionId?: string
      assistantType?: string
      outputSchema?: string
      contentBlocks?: { type: string; path?: string; name?: string; content?: string }[]
    },
    onStart?: (requestId: string) => void,
  ): Promise<() => void> {
    return stream(
      'agents.dispatch_stream',
      {
        agent_id: agentId,
        task,
        ...(model ? { model } : {}),
        ...(options?.projectPath ? { project_path: options.projectPath } : {}),
        ...(options?.projectName ? { project_name: options.projectName } : {}),
        ...(options?.sessionId ? { session_id: options.sessionId } : {}),
        ...(options?.assistantType ? { assistant_type: options.assistantType } : {}),
        ...(options?.outputSchema ? { output_schema: options.outputSchema } : {}),
        ...(options?.contentBlocks?.length ? { content_blocks: options.contentBlocks } : {}),
      },
      onChunk,
      (data) => onDone?.(data as unknown as DispatchResult),
      onError,
      onStart,
    )
  }
```

- [ ] **Step 2: Forward file blocks from useAgentSession.send()**

In `frontend/operator/useAgentSession.ts`, update `send()` (around line 252-281):

```typescript
    // Extract text from request blocks
    const textContent = requestBlocks
      .filter((b): b is TextBlock => b.type === 'text')
      .map(b => b.content)
      .join('\n')

    // Extract file blocks to send as content_blocks
    const fileBlocks = requestBlocks
      .filter(b => b.type === 'file' && (b as any).path)
      .map(b => ({ type: 'file', path: (b as any).path, name: (b as any).name }))

    // Allow sending with only attachments (no text required)
    if (!textContent.trim() && fileBlocks.length === 0) return
```

Then update the `dispatchStream` call (around line 279) to pass `contentBlocks`:

```typescript
      unlisten = await operator.dispatchStream(
        agentId,
        task,
        (chunk) => handleStreamChunk(turn, chunk, options?.assistantType),
        (result) => { /* ... existing done handler ... */ },
        (streamError) => { /* ... existing error handler ... */ },
        resolvedModel,
        {
          projectPath: projectPath || options?.projectPath,
          projectName: projectStore.currentProject?.name,
          sessionId: runnerSessionId.value || undefined,
          assistantType: options?.assistantType,
          outputSchema: options?.outputSchema,
          contentBlocks: fileBlocks.length > 0 ? fileBlocks : undefined,
        },
        (requestId) => { activeRequestId = requestId },
      )
```

- [ ] **Step 3: Run typecheck**

Run: `bun run typecheck`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add frontend/operator/client.ts frontend/operator/useAgentSession.ts
git commit -m "feat: forward content_blocks from frontend to operator dispatch"
```

---

### Task 6: Frontend — AgentInput uses file paths instead of base64

**Files:**
- Modify: `frontend/components/agent/AgentInput.vue`

- [ ] **Step 1: Update drag-drop to use file paths**

Replace `handleDrop` (lines 98-122) to use Tauri file paths:

```typescript
async function handleDrop(e: DragEvent) {
  e.preventDefault()
  isDragOver.value = false
  if (!e.dataTransfer?.files) return

  for (const file of e.dataTransfer.files) {
    // In Tauri, dropped files have a path property
    const filePath = (file as any).path as string | undefined
    if (!filePath) {
      // Browser fallback — skip non-path files
      continue
    }

    const isImage = file.type.startsWith('image/')
    if (isImage && !supportsVision.value) continue

    attachments.value.push({
      type: 'file',
      name: file.name,
      path: filePath,
      size: file.size,
    })
  }
}
```

- [ ] **Step 2: Update file picker to use Tauri dialog**

Replace `handleFileSelect` (lines 124-148):

```typescript
async function handleFileSelect(_e: Event) {
  // Clear the HTML input (used as fallback)
  const htmlInput = _e.target as HTMLInputElement
  htmlInput.value = ''

  try {
    const { isTauriEnv } = await import('@/utils/tauri')
    if (isTauriEnv()) {
      const { open } = await import('@tauri-apps/plugin-dialog')
      const selected = await open({
        multiple: true,
        filters: [
          { name: 'All Supported', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'pdf', 'md', 'txt', 'json', 'csv', 'ts', 'js', 'go', 'rs', 'py', 'vue', 'html', 'css', 'yaml', 'yml', 'toml'] },
          { name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg'] },
          { name: 'Documents', extensions: ['pdf', 'md', 'txt', 'csv', 'json'] },
          { name: 'Code', extensions: ['ts', 'js', 'go', 'rs', 'py', 'vue', 'html', 'css'] },
        ],
      })
      if (!selected) return
      const paths = Array.isArray(selected) ? selected : [selected]
      for (const filePath of paths) {
        const name = filePath.split('/').pop() || filePath
        attachments.value.push({
          type: 'file',
          name,
          path: filePath,
        })
      }
      return
    }
  } catch { /* not in Tauri, use HTML fallback */ }

  // HTML fallback
  const files = (_e.target as HTMLInputElement).files
  if (!files) return
  for (const file of files) {
    attachments.value.push({
      type: 'file',
      name: file.name,
      size: file.size,
    })
  }
}
```

- [ ] **Step 3: Update paste handler to write temp file**

Replace paste image handling in `handlePaste` (lines 76-96):

```typescript
async function handlePaste(e: ClipboardEvent) {
  const items = e.clipboardData?.items
  if (!items) return

  for (const item of items) {
    if (item.type.startsWith('image/') && supportsVision.value) {
      e.preventDefault()
      const file = item.getAsFile()
      if (!file) continue

      try {
        const { isTauriEnv } = await import('@/utils/tauri')
        if (isTauriEnv()) {
          // Write clipboard image to temp file for path-based transport
          const { invoke } = await import('@tauri-apps/api/core')
          const { writeFile, mkdir, exists } = await import('@tauri-apps/plugin-fs')
          const dataDir = (await invoke<string>('get_data_dir')).replace(/\/$/, '')
          const tmpDir = `${dataDir}/tmp`
          if (!await exists(tmpDir)) await mkdir(tmpDir, { recursive: true })
          const fileName = `paste-${Date.now()}.png`
          const filePath = `${tmpDir}/${fileName}`
          const buffer = await file.arrayBuffer()
          await writeFile(filePath, new Uint8Array(buffer))
          attachments.value.push({ type: 'file', name: fileName, path: filePath })
          return
        }
      } catch { /* browser fallback */ }

      // Browser fallback: data URL
      const reader = new FileReader()
      reader.onload = () => {
        attachments.value.push({
          type: 'image',
          src: reader.result as string,
          alt: `screenshot-${Date.now()}.png`,
        })
      }
      reader.readAsDataURL(file)
    }
  }
}
```

- [ ] **Step 4: Update + button to use Tauri dialog directly**

Replace the + button click handler (line 197):

```html
      <button
        class="dock-btn"
        @click="openFilePicker"
      >
```

And add the method:

```typescript
async function openFilePicker() {
  try {
    const { isTauriEnv } = await import('@/utils/tauri')
    if (isTauriEnv()) {
      // Trigger Tauri dialog directly — handleFileSelect does the rest
      const fakeEvent = { target: { value: '' } } as unknown as Event
      await handleFileSelect(fakeEvent)
      return
    }
  } catch { /* fallback */ }
  // Browser: use hidden file input
  const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement
  fileInput?.click()
}
```

- [ ] **Step 5: Update attachment preview to handle file paths**

Replace the image preview in the template (lines 172-176):

```html
        <img
          v-if="att.type === 'image' || (att.type === 'file' && isImageFile((att as any).name))"
          :src="getAttachmentSrc(att)"
          class="size-12 rounded-lg object-cover border border-white/20 dark:border-white/10"
          @error="($event.target as HTMLImageElement).style.display = 'none'"
        />
```

Add helpers:

```typescript
function isImageFile(name: string): boolean {
  if (!name) return false
  const ext = name.split('.').pop()?.toLowerCase() || ''
  return ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg'].includes(ext)
}

function getAttachmentSrc(att: RequestBlock): string {
  if (att.type === 'image') return (att as ImageBlock).src
  if (att.type === 'file' && (att as any).path) {
    try {
      // Tauri: convert file path to webview-safe URL
      const { convertFileSrc } = require('@tauri-apps/api/core')
      return convertFileSrc((att as any).path)
    } catch {
      return ''
    }
  }
  return ''
}
```

- [ ] **Step 6: Run typecheck**

Run: `bun run typecheck`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add frontend/components/agent/AgentInput.vue
git commit -m "feat: AgentInput uses file paths via Tauri dialog and drag-drop"
```

---

### Task 7: Conversation history — render images inline

**Files:**
- Check: conversation rendering components that display `Turn.request` blocks

- [ ] **Step 1: Find and update request block rendering**

Search for where `turn.request` blocks are rendered in the conversation UI. The component that renders user messages needs to handle `FileBlock` with image paths — show `<img>` for images, file icon + name for other files.

```html
<!-- For image file blocks in the request -->
<template v-for="block in turn.request" :key="block">
  <img
    v-if="block.type === 'file' && isImageFile(block.name)"
    :src="convertFileSrc(block.path)"
    class="max-w-xs rounded-lg"
    @error="($event.target as HTMLImageElement).src = ''"
  />
  <span
    v-else-if="block.type === 'file'"
    class="inline-flex items-center gap-1 text-xs text-app-muted"
  >
    📎 {{ block.name }}
  </span>
</template>
```

- [ ] **Step 2: Run typecheck and test manually**

Run: `bun run typecheck`
Test: Drop an image into the chat input, send, verify it appears in conversation.

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "feat: render image and file attachments inline in conversation history"
```

---

### Task 8: End-to-end test

- [ ] **Step 1: Build operator**

Run: `bun run operator:build`
Expected: BUILD SUCCESS

- [ ] **Step 2: Run all Go tests**

Run: `cd operator && go test ./... -short`
Expected: PASS

- [ ] **Step 3: Run frontend typecheck and tests**

Run: `bun run typecheck && bun run test`
Expected: PASS

- [ ] **Step 4: Manual test**

1. Start dev: `bun run dev`
2. Open a project, enter Coder space
3. Drag-drop a PNG image into the chat → should show preview thumbnail
4. Click + button → Tauri file picker opens → select an image → preview shows
5. Paste a screenshot (Cmd+Shift+4, then Cmd+V) → preview shows
6. Type "what's in this image?" and send → Claude should describe the image
7. Drop a .ts file → sends as text content → Claude can read it
8. Try a PDF if available → sends as document block

- [ ] **Step 5: Final commit**

```bash
git add -A
git commit -m "feat: universal file & image input — complete"
```
