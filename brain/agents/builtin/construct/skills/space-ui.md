---
id: space-ui
name: UI Components and Theming
description: "@construct-space/ui component library, theme variables, Vue SFC patterns, layout primitives"
trigger: "ui,component,button,card,modal,sidebar,tailwind,theme,style,layout,page,form,dashboard,admin,table,list,grid,settings,panel,view,screen,input,select,dropdown,tabs,modal,drawer,empty state,skeleton,notification,toast,shell,Vue,.vue,template,design,construct-space/ui"
category: construct
---

# UI and Theming

Spaces are Vue 3 apps that must look native inside Construct. The host ships a complete component library at `@construct-space/ui` — **use it. Do not design your own buttons, cards, modals, tables, inputs, dropdowns, tabs, or any other primitive that exists below.** Rolling your own makes the Space look foreign and breaks theme inheritance.

## Hard rules

1. **Before writing any `.vue` file**, check the component table below. If a primitive exists there, you MUST use it.
2. **Never write `<button class="...">`** — use `<Button>`. Same for inputs, cards, tables, modals, tabs, dropdowns, tooltips, etc.
3. **Never hardcode colors** — use the theme CSS variables below. The host owns dark/light, not the Space.
4. **Never add `.dark:` branching** in components. The CSS variables already flip.
5. **If you need a primitive not in the library**, compose from the existing ones before inventing. Ask the user if truly missing.

## Component Library

Auto-imported in Spaces — use in templates without explicit imports in most cases. Explicit imports still work and are fine.

| Category | Components |
|---|---|
| **Form** | `Button`, `Input`, `Textarea`, `Select`, `SelectMenu`, `Autocomplete`, `DatePicker`, `FileInput`, `MultiSelect`, `Checkbox`, `RadioGroup`, `Switch`, `Slider`, `ColorPicker`, `FormField`, `ToggleGroup` |
| **Layout** | `Card`, `Modal`, `ConfirmationModal`, `Drawer`, `Slideover`, `Popover`, `PanelSection`, `PropRow`, `Separator`, `ScrollArea`, `SplitPane`, `Group` |
| **Data** | `Table`, `Calendar`, `Tree`, `Timeline`, `Pagination` |
| **Feedback** | `Alert`, `Badge`, `Chip`, `Progress`, `Skeleton`, `Empty`, `Notification`, `Toast` |
| **Menu** | `Dropdown`, `DropdownMenu`, `DropdownMenuItem`, `ContextMenu`, `Tabs`, `Tab` |
| **Display** | `Icon`, `Avatar`, `Accordion`, `Tooltip`, `Kbd`, `Breadcrumbs` |
| **Shell** | `SidebarLayout` |

UI 1.0 removed: `Sidebar3D`, `Toolbar3D`, `HeaderLayout`, `DashboardPanel` (host-only or replaced). UI 1.0 also stripped every composable that used to ship from this package — `useAuth`, `useTheme`, `useLocalStorage`, `useClipboard`, `useFormValidation`, `useKeyboard`, `useClickOutside`, `useAsync`, `useDebounce`, `useToggle`, `useSearch`, `useIntersectionObserver`, `useMediaQuery`, `useNotification` are all gone from `@construct-space/ui`. Get composables from `@construct-space/sdk` (see the `sdk` skill).

Import once in the entry: `import '@construct-space/ui/style.css'`.

## Theme Variables (always)

Never hardcode colors. Use these CSS variables so the Space respects user theme + dark mode. **These are the only ones the host actually defines** — anything else (`--app-error`, `--app-warning`, `--app-info`, `--app-radius`, `--app-panel-2`, …) is fictional and won't resolve.

```css
var(--app-background)          /* main background */
var(--app-foreground)          /* main text */
var(--app-muted)               /* secondary text */
var(--app-border)              /* borders */
var(--app-surface)             /* card surfaces */
var(--app-canvas-bg)           /* recessed surface behind Cards */
var(--app-card)                /* card body */
var(--app-card-hover)          /* card hover state */
var(--app-input-bg)            /* form input background */
var(--app-status-bg)           /* status pill background */
var(--app-accent)              /* brand/accent */
var(--app-accent-foreground)   /* text on accent */
var(--app-accent-muted)        /* dimmed accent */
var(--app-success)             /* success state */
var(--app-danger)              /* destructive state */
```

Tailwind is available and can be combined with theme vars:

```vue
<div class="p-4 rounded-lg" style="background: var(--app-surface); border: 1px solid var(--app-border)">
  <h2 style="color: var(--app-foreground)">Title</h2>
  <p class="text-sm" style="color: var(--app-muted)">Description</p>
</div>
```

## SFC Pattern

Always `<script setup lang="ts">`. Import from `vue` (not `@vue/runtime-core`).

```vue
<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useToast } from '@construct-space/sdk'
import { Button, Card, Badge } from '@construct-space/ui'
import { StickyNote } from 'lucide-vue-next'
import { useNotes, type NoteRecord } from '../composables/useNotes'

const toast = useToast()
const { list, create, remove } = useNotes()
const notes = ref<NoteRecord[]>([])

onMounted(async () => { notes.value = await list() })
</script>

<template>
  <div class="p-4" style="background: var(--app-background); color: var(--app-foreground)">
    <Card v-for="note in notes" :key="note.id">
      <div class="p-3 flex items-center gap-2">
        <StickyNote :size="16" />
        <Badge :label="note.color" />
        <p class="text-sm" style="color: var(--app-muted)">{{ note.content }}</p>
      </div>
    </Card>
  </div>
</template>
```

## Layout Primitives

- `SidebarLayout` — 60px icon sidebar with nav items; use for Spaces with multiple sections
- `SplitPane` — resizable two-pane layout
- `PanelSection` — grouped settings sections (use inside `Card`)

## SDK Composables

UI does not export composables in 1.0. Get them from `@construct-space/sdk`. The ones most relevant to UI work:

- `useToast()` — transient inline feedback (`toast.success('Saved')`).
- `useNotification()` — host-owned bell/inbox/push surface (singular).
- `useAuthStore()` — current user / auth state.
- `useNavigator()` — `push`, `replace`, `back`, `currentPath`, `query`.
- `useBreadcrumb()` — toolbar trail (`set`, `push`, `clear`).
- `useMarkdown()` — sanitized markdown render.
- `useLocalStorage(key)` — KV in browser localStorage (UI prefs like view mode).
- `useStorage()` — file/blob storage scoped to the space.

See the `sdk` skill for the full list. Theming is host-owned in 1.0 — there is no `useTheme()`; just use the `var(--app-*)` tokens.

## Icons

`lucide-vue-next` for component icons. Manifest uses string icons in `i-lucide-<name>` form.

## Don't

- Don't read `node_modules/` — this skill has the API surface.
- Don't re-implement Button/Card/Modal from scratch.
- Don't hardcode hex colors.
- Don't add dark/light branching in components — theme vars handle it.

---

## Editorial pattern

Goal: a Space should look like it belongs inside Construct — a sibling of Settings / Org / Projects pages, not a separate app. The rules below are **what makes that happen**. Follow them even on a one-page Space.

### Heading tokens (three only)

```
/* Card title + top-level page title */
text-sm tracking-[0.08em] uppercase font-normal text-[var(--app-foreground)] leading-tight after:content-['.'] after:text-[var(--app-accent)]

/* Section label (above a list / grid) */
text-[11px] tracking-[0.12em] uppercase font-medium text-[var(--app-muted)]

/* Stat + form-field label (above every Input / Select) */
text-[10px] tracking-[0.08em] uppercase text-[var(--app-muted)]
```

Every card title ends with an accent-colored dot via the `after:` utility. Never plain sentence-case `<h2>Settings</h2>`.

### Intro card (almost every page)

Every page leads with one muted Card — icon + title + description on the left, action Button(s) in `#accessory` on the right. Sometimes secondary info (count, path) sits under the title.

```vue
<Card variant="muted">
  <template #header>
    <div class="flex items-start gap-3">
      <Users class="size-5 text-[var(--app-muted)] mt-0.5 shrink-0" />
      <div class="min-w-0 flex-1">
        <h3 class="text-sm tracking-[0.08em] uppercase font-normal text-[var(--app-foreground)] leading-tight after:content-['.'] after:text-[var(--app-accent)]">Members</h3>
        <p class="text-sm text-[var(--app-muted)] mt-0.5">People who belong to this organization.</p>
      </div>
    </div>
  </template>
  <template #accessory>
    <Button size="xs" label="Invite member" @click="…">
      <template #leading><Plus class="size-3.5" /></template>
    </Button>
  </template>
</Card>
```

### Card slots (all optional)

```
<Card
  variant="default | outline | muted"   <!-- default = lifted surface, muted = recedes behind siblings -->
  interactive                            <!-- cursor-pointer + click target -->
  hoverable                              <!-- soft lift on hover -->
>
  <template #header>…</template>         <!-- title row (left) -->
  <template #accessory>…</template>      <!-- right side of header: Badges / action Buttons -->
  <!-- default slot = body -->
  <template #footer>…</template>         <!-- left side of footer -->
  <template #footer-end>…</template>     <!-- right side of footer: primary actions -->
</Card>
```

### Lists and grids

- List of Cards stacked vertically: `class="space-y-3"`.
- Grid of Cards: `class="grid gap-3 grid-cols-2 md:grid-cols-3"` or `grid-template-columns: repeat(auto-fill, minmax(260px, 1fr))` for content-driven sizing. Cap at 3 or 4 cols — more reads as a feed, not a page.
- Each item is a `<Card interactive @click="open(item)">` with:
  - `#header`: icon + name in accent-dot title + meta Badges + path/description
  - `#accessory`: right-side actions (edit, delete, Switch)
  - `#footer`: timestamps, counts
  - `#footer-end`: hover-revealed icon actions

### Empty states

Always wrap `Empty` in a `Card` so it sits on a surface, never floats on the canvas:

```vue
<Card v-if="!items.length">
  <Empty
    icon="i-lucide-folder"
    title="No items yet"
    description="Create your first item to get started."
  >
    <Button size="sm" label="New item" @click="…" />
  </Empty>
</Card>
```

### Forms

Labeled Inputs only. **Never** rely on a placeholder alone to describe a field.

```vue
<div class="grid grid-cols-1 md:grid-cols-2 gap-3">
  <div>
    <label class="block text-[10px] tracking-[0.08em] uppercase text-[var(--app-muted)] mb-1">Name</label>
    <Input v-model="name" size="sm" placeholder="Team name" />
  </div>
  <div>
    <label class="block text-[10px] tracking-[0.08em] uppercase text-[var(--app-muted)] mb-1">Lead</label>
    <Select v-model="leadId" :options="leadOptions" size="sm" />
  </div>
</div>
```

Actions go in `#footer-end`:

```vue
<template #footer-end>
  <div class="flex items-center gap-2">
    <Button variant="ghost" size="sm" label="Cancel" @click="close" />
    <Button size="sm" label="Save" :disabled="!name.trim()" @click="save" />
  </div>
</template>
```

### Modals (never hand-roll an overlay)

```vue
<Modal :open="showAddModal" title="New item" @close="showAddModal = false">
  <div class="space-y-4">
    <div>
      <label class="block text-[10px] tracking-[0.08em] uppercase text-[var(--app-muted)] mb-1">Name</label>
      <Input v-model="name" size="sm" />
    </div>
    <div class="flex justify-end gap-2">
      <Button variant="ghost" size="sm" label="Cancel" @click="showAddModal = false" />
      <Button size="sm" label="Create" :disabled="!name.trim()" @click="submit" />
    </div>
  </div>
</Modal>
```

Do NOT build `<Teleport to="body">` + absolute-inset div + backdrop manually — `Modal` does that correctly and consistently.

### Buttons

- With a label: `<Button size="xs|sm" label="Save"><template #leading><Plus class="size-3.5" /></template></Button>`.
- Icon-only: use the `icon` prop with an iconify string, **not** the `#leading` slot. Icon-only sizing only kicks in when `icon`/`trailingIcon` is set:

```vue
<Button variant="ghost" color="error" size="xs" icon="lucide:trash-2" title="Delete" @click="…" />
```

### Badges

Status uses the color mapping: `success` (active/live/configured), `warning` (pending/disabled), `error` (revoked/error), `info` (in-progress/notice), `primary` (highlighted), `neutral` (default / type tag). Size `xs` is the norm inside card headers.

### Danger zone

```vue
<Card>
  <template #header>
    <div class="flex items-start gap-3">
      <ShieldAlert class="size-5 text-red-400 mt-0.5 shrink-0" />
      <div class="min-w-0 flex-1">
        <h4 class="text-sm tracking-[0.08em] uppercase font-normal text-red-400 leading-tight after:content-['.']">Danger zone</h4>
        <p class="text-xs text-[var(--app-muted)] mt-0.5">Deletes everything. Cannot be undone.</p>
      </div>
    </div>
  </template>
  <template v-if="!confirming" #accessory>
    <Button variant="ghost" color="error" size="xs" label="Delete" @click="confirming = true" />
  </template>
  <template v-if="confirming">
    <div class="flex items-center justify-end gap-2">
      <Button variant="ghost" size="sm" label="Cancel" @click="confirming = false" />
      <Button color="error" size="sm" label="Confirm delete" @click="doDelete" />
    </div>
  </template>
</Card>
```

### Tables inside a Card

Card body has its own padding. Bleed the table to the Card edges with negative margins, then use the label token for column headers:

```vue
<Card>
  <div class="-mx-5 -my-5">
    <table class="w-full">
      <thead>
        <tr class="border-b border-[var(--app-border)]">
          <th class="text-left text-[10px] tracking-[0.08em] uppercase font-medium text-[var(--app-muted)] px-4 py-2.5">Name</th>
          …
        </tr>
      </thead>
      …
    </table>
  </div>
</Card>
```

### Detail pages

Use this order:

1. **Back link** — uppercase-tracked, no border:
   ```vue
   <button class="inline-flex items-center gap-1.5 text-[11px] tracking-[0.12em] uppercase text-[var(--app-muted)] hover:text-[var(--app-foreground)] transition-colors" @click="router.push('/back')">
     <ArrowLeft class="size-3.5" />
     Back to list
   </button>
   ```
2. **Intro Card** (muted) with Edit in `#accessory`.
3. **Stats Card** — 2–4 column grid of stat-label + value.
4. **Edit Card** (appears only when editing) — labeled Inputs, Cancel/Save in `#footer-end`.
5. **Subordinate sections** — section label + list of Cards or Card-wrapped Empty.
6. **Danger zone** at the bottom.

### Surface / canvas tokens

The host defines these; a Space should not override them.

- `var(--app-background)` — primary surface (card body, app background)
- `var(--app-canvas-bg)` — recessed surface behind Cards; `Card variant="muted"` uses it
- `var(--app-card)`, `var(--app-card-hover)` — card body + hover state
- `var(--app-surface)` — legacy alias; prefer the named tokens above
- `var(--app-foreground)`, `var(--app-muted)`, `var(--app-accent)`, `var(--app-accent-foreground)`, `var(--app-accent-muted)`, `var(--app-border)` — text and chrome
- `var(--app-success)`, `var(--app-danger)` — semantic colors for status

### What Spaces commonly get wrong

- Plain `<h2 class="font-semibold">Section</h2>` instead of the uppercase-tracked title with accent dot.
- Cards stacked without any structure — use the intro Card + sections pattern instead of a flat scroll.
- Hand-rolled modals with `<Teleport to="body">` + backdrop div.
- Inputs with just a placeholder and no label above them.
- Icon-only Buttons using `#leading` slot (renders padding with no content). Use `icon="lucide:…"`.
- Empty states rendered as plain `<p>No results</p>`.
- Hardcoded `bg-gray-800 border-gray-700` Tailwind — always use `var(--app-*)`.
