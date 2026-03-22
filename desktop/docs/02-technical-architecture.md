# HR Space — Technical Architecture

## Stack

| Layer | Technology | Purpose |
|-------|-----------|---------|
| Framework | Vue 3 (Composition API, `<script setup>`) | UI components |
| Build | Vite (IIFE output) | Bundle as `dist/space.js` |
| State | Pinia | Reactive stores per domain |
| Storage | Dexie.js (IndexedDB wrapper) | Client-side persistence |
| Styling | UnoCSS + Construct theme tokens | Utility-first CSS |
| Utilities | @vueuse/core | Debounce, reactivity helpers |

## Project Structure

```
hr-space/
├── index.html
├── package.json
├── vite.config.ts
├── tsconfig.json
├── uno.config.ts
├── docs/
│   ├── 01-space-design.md
│   ├── 02-technical-architecture.md
│   ├── 03-data-models.md
│   ├── 04-ui-spec.md
│   └── 05-roadmap.md
├── src/
│   ├── main.ts                          # App entry: createApp, Pinia, seed
│   ├── App.vue                          # Root component, wraps AppShell
│   ├── types/
│   │   └── index.ts                     # All TypeScript interfaces/types
│   ├── db/
│   │   ├── index.ts                     # Dexie database instance + schema
│   │   └── seed.ts                      # Demo data seeder
│   ├── stores/
│   │   ├── app.ts                       # Navigation, role, UI state
│   │   ├── employees.ts                 # Employee + department CRUD
│   │   └── leave.ts                     # Leave request + balance management
│   ├── composables/
│   │   ├── useSearch.ts                 # Reusable fuzzy search
│   │   └── useOrgTree.ts               # Build tree from flat employee list
│   ├── components/
│   │   ├── AppShell.vue                 # Layout: sidebar + content area
│   │   ├── NavSidebar.vue               # Navigation sidebar
│   │   ├── EmployeeCard.vue             # Employee grid card
│   │   ├── EmployeeForm.vue             # Add/edit employee form
│   │   ├── LeaveRequestForm.vue         # Submit leave request form
│   │   ├── LeaveRequestCard.vue         # Leave request list item
│   │   ├── LeaveCalendar.vue            # Monthly calendar view
│   │   ├── OrgNode.vue                  # Recursive org chart node
│   │   ├── StatCard.vue                 # Dashboard stat card
│   │   ├── SearchBar.vue                # Debounced search input
│   │   ├── ConfirmDialog.vue            # Confirmation modal
│   │   ├── EmptyState.vue               # Empty state placeholder
│   │   └── AvatarInitials.vue           # Avatar circle with initials
│   └── pages/
│       ├── DashboardPage.vue            # Stats + pending actions
│       ├── DirectoryPage.vue            # Employee list with search
│       ├── EmployeeDetailPage.vue       # Single employee view
│       ├── LeavePage.vue                # Leave management
│       ├── OrgChartPage.vue             # Org hierarchy visualization
│       └── SettingsPage.vue             # Department mgmt + data controls
└── dist/
    └── space.js                         # Built IIFE bundle
```

## Component Tree

```
App.vue
└── AppShell.vue
    ├── NavSidebar.vue
    └── [Current Page]
        ├── DashboardPage.vue
        │   ├── StatCard.vue (×4)
        │   └── LeaveRequestCard.vue (×5)
        ├── DirectoryPage.vue
        │   ├── SearchBar.vue
        │   ├── EmployeeCard.vue (×N)
        │   ├── EmployeeForm.vue (modal)
        │   └── EmptyState.vue
        ├── EmployeeDetailPage.vue
        │   ├── AvatarInitials.vue
        │   ├── EmployeeForm.vue (modal, edit)
        │   └── ConfirmDialog.vue (delete)
        ├── LeavePage.vue
        │   ├── LeaveRequestCard.vue (×N)
        │   ├── LeaveRequestForm.vue (modal)
        │   └── LeaveCalendar.vue
        ├── OrgChartPage.vue
        │   └── OrgNode.vue (recursive)
        └── SettingsPage.vue
            └── ConfirmDialog.vue
```

## State Architecture

### App Store (`stores/app.ts`)
Manages global UI state. No persistence needed — resets on load.

```
State:
  currentPage: PageName          (default: 'dashboard')
  selectedEmployeeId: string|null (default: null)
  currentRole: AppRole           (default: 'hr-admin')
  sidebarCollapsed: boolean      (default: false)

Actions:
  navigateTo(page, employeeId?)
  setRole(role)
  toggleSidebar()
```

### Employees Store (`stores/employees.ts`)
CRUD for employees and departments. Reads/writes to Dexie.

```
State:
  employees: Employee[]
  departments: Department[]
  loading: boolean
  searchQuery: string

Getters:
  filteredEmployees     — filters by searchQuery across name/email/department/title
  getDepartmentById(id) — lookup helper
  getManagerName(id)    — returns "FirstName LastName" or null
  activeCount           — count of employees with status 'active'
  byDepartment          — grouped counts { [deptId]: number }

Actions:
  fetchAll()            — load all from Dexie
  addEmployee(data)     — insert into Dexie + update state
  updateEmployee(id, data) — update in Dexie + update state
  deleteEmployee(id)    — remove from Dexie + update state
  addDepartment(data)   — insert department
  updateDepartment(id, data)
  deleteDepartment(id)
```

### Leave Store (`stores/leave.ts`)
Manages leave requests and balances. Reads/writes to Dexie.

```
State:
  requests: LeaveRequest[]
  balances: LeaveBalance[]
  loading: boolean

Getters:
  pendingRequests       — requests with status 'pending'
  approvedRequests      — requests with status 'approved'
  getByEmployee(id)     — filter requests by employeeId
  getBalances(empId)    — filter balances by employeeId

Actions:
  fetchAll()
  fetchByEmployee(empId)
  submitRequest(data)    — create request with status 'pending'
  approveRequest(id, reviewerId) — set status 'approved', update balance
  rejectRequest(id, reviewerId)  — set status 'rejected'
```

## Data Flow

```
User Action → Component → Pinia Store Action → Dexie (IndexedDB) → Store State Update → Reactive UI
```

All data flows through Pinia stores. Components never access Dexie directly. Stores are the single source of truth for reactive state, but persist to IndexedDB for durability across page reloads.

## Page Routing

No vue-router — pages are switched via `appStore.currentPage` and rendered with a `v-if` chain or dynamic `<component :is>` in AppShell. This keeps the bundle small and avoids URL management complexity within a space.

```vue
<!-- AppShell.vue -->
<component :is="pageComponent" />

<script setup>
const pageMap = {
  'dashboard': DashboardPage,
  'directory': DirectoryPage,
  'employee-detail': EmployeeDetailPage,
  'leave': LeavePage,
  'org-chart': OrgChartPage,
  'settings': SettingsPage,
}
const pageComponent = computed(() => pageMap[appStore.currentPage])
</script>
```

## Build Configuration

Vite builds the space as an IIFE bundle:

```ts
// vite.config.ts
export default defineConfig({
  plugins: [vue(), UnoCSS()],
  build: {
    lib: {
      entry: 'src/main.ts',
      formats: ['iife'],
      name: 'HRSpace',
      fileName: () => 'space.js',
    },
    rollupOptions: {
      output: {
        inlineDynamicImports: true,
      },
    },
  },
})
```

## Styling Strategy

Use Construct theme CSS custom properties for all colors to ensure the space adapts to light/dark themes:

| Token | Usage |
|-------|-------|
| `--c-bg-base` | Page background |
| `--c-bg-subtle` | Card backgrounds |
| `--c-bg-muted` | Hover states |
| `--c-border` | All borders |
| `--c-text-base` | Primary text |
| `--c-text-subtle` | Secondary text |
| `--c-primary` | Active nav, buttons, links |
| `--c-primary-subtle` | Active nav background |
| `--c-success` | Approved status, active dot |
| `--c-warning` | Pending status |
| `--c-danger` | Rejected status, delete button |

UnoCSS utilities for layout, spacing, typography. Custom CSS only for the org chart connecting lines and calendar grid.
