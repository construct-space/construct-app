# HR Space — UI Specification

## Global Design System

### Theme Integration

All colors use Construct CSS custom properties. Never hard-code colors.

```css
/* Base palette */
--c-bg-base       /* page backgrounds */
--c-bg-subtle     /* card backgrounds */
--c-bg-muted      /* hover, zebra stripes */
--c-border        /* all borders */
--c-text-base     /* primary text */
--c-text-subtle   /* secondary/muted text */
--c-primary       /* actions, active states, links */
--c-primary-subtle /* active nav item bg */
--c-success       /* approved, active status */
--c-warning       /* pending status */
--c-danger        /* rejected, delete, error */
```

### Typography

- **Page titles:** text-xl font-semibold text-[--c-text-base]
- **Section headers:** text-lg font-medium text-[--c-text-base]
- **Body text:** text-sm text-[--c-text-base]
- **Muted text:** text-sm text-[--c-text-subtle]
- **Stat values:** text-2xl font-bold text-[--c-text-base]

### Spacing

- Page padding: p-6
- Card padding: p-4
- Card gap in grids: gap-4
- Section vertical spacing: space-y-6

### Cards

```
bg-[--c-bg-subtle]
border border-[--c-border]
rounded-lg
p-4
shadow-sm (optional, subtle)
```

### Buttons

- **Primary:** bg-[--c-primary] text-white px-4 py-2 rounded-md text-sm font-medium
- **Secondary:** bg-transparent border border-[--c-border] text-[--c-text-base] px-4 py-2 rounded-md
- **Danger:** bg-[--c-danger] text-white px-4 py-2 rounded-md
- **Ghost:** bg-transparent text-[--c-text-subtle] hover:bg-[--c-bg-muted] px-2 py-1 rounded

### Status Badges

- **Active/Approved:** bg-green-500/15 text-green-600 dark:text-green-400 px-2 py-0.5 rounded-full text-xs font-medium
- **Pending:** bg-yellow-500/15 text-yellow-600 dark:text-yellow-400 ...
- **Rejected/Inactive:** bg-red-500/15 text-red-600 dark:text-red-400 ...
- **On Leave:** bg-blue-500/15 text-blue-600 dark:text-blue-400 ...

### Department Badges

Small colored badge: `bg-[dept.color]/15 text-[dept.color] px-2 py-0.5 rounded-full text-xs font-medium`

---

## Layout: AppShell

```
┌──────────────────────────────────────────────────┐
│ ┌────────┐ ┌──────────────────────────────────┐  │
│ │        │ │                                  │  │
│ │  Nav   │ │          Content Area            │  │
│ │ Sidebar│ │                                  │  │
│ │        │ │    (current page renders here)   │  │
│ │ w-60   │ │                                  │  │
│ │        │ │          flex-1                  │  │
│ │        │ │          overflow-auto           │  │
│ │        │ │          p-6                     │  │
│ │        │ │                                  │  │
│ │ ────── │ │                                  │  │
│ │ Role   │ │                                  │  │
│ │ Toggle │ │                                  │  │
│ └────────┘ └──────────────────────────────────┘  │
└──────────────────────────────────────────────────┘
```

- Sidebar: w-60, fixed height (h-screen), bg-[--c-bg-subtle], border-r
- Collapsed sidebar: w-16, icons only
- Mobile (<768px): sidebar becomes overlay with hamburger toggle

### NavSidebar Detail

```
┌──────────────────┐
│  ☰ HR Space      │  ← collapse toggle + title
│                  │
│  ▣ Dashboard     │  ← active: bg-[--c-primary-subtle] text-[--c-primary]
│  ▣ Directory     │
│  ▣ Leave         │
│  ▣ Org Chart     │
│  ▣ Settings      │
│                  │
│  ─────────────── │
│                  │
│  Role: [HR Admin ▾] │  ← dropdown or toggle
└──────────────────┘
```

---

## Page: Dashboard

```
┌──────────────────────────────────────────────┐
│  Dashboard                                    │
│                                              │
│  ┌──────┐ ┌──────┐ ┌──────┐ ┌──────┐       │
│  │  👥  │ │  🏢  │ │  📋  │ │  🏖️  │       │
│  │  12  │ │   4  │ │   4  │ │   1  │       │
│  │Total │ │Depts │ │Pend. │ │On    │       │
│  │Emps  │ │      │ │Leave │ │Leave │       │
│  └──────┘ └──────┘ └──────┘ └──────┘       │
│                                              │
│  Department Breakdown                        │
│  ┌──────────────────────────────────────┐   │
│  │ Engineering  ████████████  5          │   │
│  │ Design       ████████     3          │   │
│  │ Marketing    █████        2          │   │
│  │ Operations   █████        2          │   │
│  └──────────────────────────────────────┘   │
│                                              │
│  Pending Leave Requests                      │
│  ┌──────────────────────────────────────┐   │
│  │ James Wilson  Personal  Apr 1-2       │   │
│  │                    [Approve] [Reject] │   │
│  │ Elena Kowalski Annual  Apr 5-12       │   │
│  │                    [Approve] [Reject] │   │
│  │ ...                                   │   │
│  └──────────────────────────────────────┘   │
└──────────────────────────────────────────────┘
```

---

## Page: Employee Directory

```
┌──────────────────────────────────────────────┐
│  Employee Directory              [+ Add New]  │
│                                              │
│  ┌──────────────────┐ ┌─────────────┐       │
│  │ 🔍 Search...      │ │ All Depts ▾ │       │
│  └──────────────────┘ └─────────────┘       │
│                                              │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐    │
│  │ SC       │ │ MJ       │ │ AR       │    │
│  │ Sarah    │ │ Marcus   │ │ Alex     │    │
│  │ Chen     │ │ Johnson  │ │ Rivera   │    │
│  │ VP of Eng│ │ Head of  │ │ Senior   │    │
│  │ 🔵 Eng   │ │ Design   │ │ Engineer │    │
│  │ ● Active │ │ 🟣 Design│ │ 🔵 Eng   │    │
│  └──────────┘ │ ● Active │ │ ● Active │    │
│               └──────────┘ └──────────┘    │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐    │
│  │ ...      │ │ ...      │ │ ...      │    │
│  └──────────┘ └──────────┘ └──────────┘    │
└──────────────────────────────────────────────┘
```

- Grid: 3 cols (lg), 2 cols (md), 1 col (sm)
- Each card is clickable → navigates to detail

---

## Page: Employee Detail

```
┌──────────────────────────────────────────────┐
│  ← Back to Directory                         │
│                                              │
│  ┌──────────────────────────────────────┐   │
│  │  ┌────┐                              │   │
│  │  │ SC │  Sarah Chen                  │   │
│  │  └────┘  VP of Engineering           │   │
│  │          🔵 Engineering  ● Active     │   │
│  │                        [Edit] [Delete]│   │
│  └──────────────────────────────────────┘   │
│                                              │
│  ┌─────────────────┐ ┌─────────────────┐   │
│  │ Personal Info    │ │ Organization    │   │
│  │                 │ │                 │   │
│  │ Email:          │ │ Department:     │   │
│  │ sarah@co.com   │ │ Engineering     │   │
│  │                 │ │                 │   │
│  │ Phone:          │ │ Manager:        │   │
│  │ (555) 123-4567 │ │ None (Top)      │   │
│  │                 │ │                 │   │
│  │ Type:           │ │ Title:          │   │
│  │ Full-time       │ │ VP of Eng.      │   │
│  │                 │ │                 │   │
│  │ Start Date:     │ │                 │   │
│  │ 2020-03-15     │ │                 │   │
│  └─────────────────┘ └─────────────────┘   │
│                                              │
│  Leave Balances                              │
│  ┌──────────────────────────────────────┐   │
│  │ Annual   ████████░░░░  8/20 used     │   │
│  │ Sick     ██░░░░░░░░░░  2/10 used     │   │
│  │ Personal █░░░░░░░░░░░  1/5  used     │   │
│  └──────────────────────────────────────┘   │
│                                              │
│  Leave History                               │
│  ┌──────────────────────────────────────┐   │
│  │ Type     │ Dates        │ Status     │   │
│  │──────────│──────────────│────────────│   │
│  │ Annual   │ Mar 15-22    │ ✅ Approved │   │
│  │ Sick     │ Apr 8-9      │ ⏳ Pending  │   │
│  └──────────────────────────────────────┘   │
└──────────────────────────────────────────────┘
```

---

## Page: Leave Management

```
┌──────────────────────────────────────────────────────┐
│  Leave Management                    [+ New Request]  │
│                                                      │
│  ┌──────────────────────┐  ┌──────────────────────┐ │
│  │ [All] [Pending]      │  │  ◄  March 2024  ►    │ │
│  │                      │  │                      │ │
│  │ ┌──────────────────┐ │  │  Mo Tu We Th Fr Sa Su│ │
│  │ │ James Wilson     │ │  │               1  2  3│ │
│  │ │ Personal         │ │  │   4  5  6  7  8  9 10│ │
│  │ │ Apr 1-2          │ │  │  11 12 13 14 15 16 17│ │
│  │ │ ⏳ Pending        │ │  │  18 19 20[DK]21 22 23│ │
│  │ │ [Approve][Reject]│ │  │  24 25 26 27 28 29 30│ │
│  │ └──────────────────┘ │  │  31                   │ │
│  │                      │  │                      │ │
│  │ ┌──────────────────┐ │  │ [DK] = David Kim     │ │
│  │ │ Elena Kowalski   │ │  │       sick leave      │ │
│  │ │ Annual           │ │  │                      │ │
│  │ │ Apr 5-12         │ │  └──────────────────────┘ │
│  │ │ ⏳ Pending        │ │                           │
│  │ │ [Approve][Reject]│ │                           │
│  │ └──────────────────┘ │                           │
│  │                      │                           │
│  │ ┌──────────────────┐ │                           │
│  │ │ Alex Rivera      │ │                           │
│  │ │ Annual           │ │                           │
│  │ │ Mar 15-22        │ │                           │
│  │ │ ✅ Approved       │ │                           │
│  │ └──────────────────┘ │                           │
│  └──────────────────────┘                           │
└──────────────────────────────────────────────────────┘
```

- Left/right panels: side by side on desktop (each 50%), stacked on mobile
- Tab filtering: HR Admin sees "All" + "Pending", Employee sees "All" + "My Requests"
- Calendar highlights approved leave dates with employee initials

---

## Page: Org Chart

```
┌──────────────────────────────────────────────┐
│  Organization Chart                          │
│                                              │
│           ┌──────────────┐                   │
│           │ Sarah Chen   │                   │
│           │ VP of Eng.   │                   │
│           │ 🔵 Eng       │                   │
│           └──────┬───────┘                   │
│        ┌─────────┼─────────┐                 │
│  ┌─────┴───┐ ┌───┴─────┐ ┌┴────────┐       │
│  │Alex     │ │Priya    │ │James   │       │
│  │Rivera   │ │Patel    │ │Wilson  │       │
│  │Sr. Eng  │ │Sw. Eng  │ │Jr. Eng │       │
│  └─────────┘ └─────────┘ └────────┘       │
│                                              │
│           ┌──────────────┐                   │
│           │ Marcus       │                   │
│           │ Johnson      │                   │
│           │ Head Design  │                   │
│           └──────┬───────┘                   │
│        ┌─────────┴─────────┐                 │
│  ┌─────┴───┐         ┌────┴────┐            │
│  │Elena    │         │David   │            │
│  │Kowalski │         │Kim     │            │
│  │Sr. Des. │         │UI Des. │            │
│  └─────────┘         └────────┘            │
│                                              │
│  ... (Rachel Thompson, Lisa Wang trees)      │
└──────────────────────────────────────────────┘
```

- CSS tree lines connecting parent to children
- Each node is clickable → employee detail
- Expand/collapse toggle on nodes with children
- Mobile: indented list format

---

## Page: Settings

```
┌──────────────────────────────────────────────┐
│  Settings                                    │
│                                              │
│  ┌──────────────────────────────────────┐   │
│  │ Departments                           │   │
│  │                                      │   │
│  │ 🔵 Engineering  Software dev...  [✏️][🗑️]│   │
│  │ 🟣 Design       Product and...   [✏️][🗑️]│   │
│  │ 🟡 Marketing    Growth, cont... [✏️][🗑️]│   │
│  │ 🟢 Operations   HR, finance...  [✏️][🗑️]│   │
│  │                                      │   │
│  │ ┌──────────┐ ┌───┐ [Add]            │   │
│  │ │ Name...   │ │ 🎨│                  │   │
│  │ └──────────┘ └───┘                   │   │
│  └──────────────────────────────────────┘   │
│                                              │
│  ┌──────────────────────────────────────┐   │
│  │ Data Management                       │   │
│  │                                      │   │
│  │ [Reset Demo Data] [Export JSON]       │   │
│  │ [Clear All Data]                      │   │
│  └──────────────────────────────────────┘   │
│                                              │
│  ┌──────────────────────────────────────┐   │
│  │ About                                 │   │
│  │ HR Space v1.0.0                       │   │
│  │ A Construct space for HR management   │   │
│  └──────────────────────────────────────┘   │
└──────────────────────────────────────────────┘
```

---

## Modal/Dialog Patterns

### EmployeeForm Modal

- Full-width on mobile, max-w-lg centered on desktop
- Overlay backdrop with bg-black/50
- Form in a card with header (Add/Edit Employee), body (form fields), footer (Cancel + Save)
- Fields: 2-column grid on desktop for first/last name, email/phone pairs

### LeaveRequestForm Modal

- Same modal pattern as EmployeeForm
- Shows remaining balance inline below the leave type dropdown
- Date range picker: two date inputs side by side

### ConfirmDialog

- Smaller modal (max-w-sm)
- Title, message text, Cancel + Confirm buttons
- Danger variant: confirm button is red

---

## Transitions & Animations

- **Page transitions:** Fade (opacity 0→1, 150ms ease)
- **Modal enter:** Scale from 0.95 + fade in (200ms)
- **Modal leave:** Scale to 0.95 + fade out (150ms)
- **Sidebar collapse:** Width transition (200ms ease)
- **Notifications:** Slide in from top-right, auto-dismiss after 3s
- **Loading skeletons:** Pulse animation on placeholder rectangles while data loads

## Notifications

Position: fixed top-4 right-4, z-50. Stack vertically with gap-2.

Types:

- **Success:** border-l-4 border-green-500 bg-[--c-bg-subtle]
- **Error:** border-l-4 border-red-500 bg-[--c-bg-subtle]
- **Info:** border-l-4 border-blue-500 bg-[--c-bg-subtle]

Auto-dismiss after 3 seconds. Show icon + message text.
