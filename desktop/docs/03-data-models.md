# HR Space — Data Models

## Core Types

### Employee

```ts
interface Employee {
  id: string                    // UUID v4
  firstName: string             // Required, min 1 char
  lastName: string              // Required, min 1 char
  email: string                 // Required, valid email format
  phone: string                 // Optional, free-form
  avatarUrl?: string            // Optional, URL to avatar image
  departmentId: string          // Required, references Department.id
  jobTitle: string              // Required, e.g. "Senior Engineer"
  managerId?: string            // Optional, references another Employee.id (null = top-level)
  employmentType: EmploymentType
  startDate: string             // ISO 8601 date (YYYY-MM-DD)
  status: EmployeeStatus
  createdAt: string             // ISO 8601 datetime
  updatedAt: string             // ISO 8601 datetime
}

type EmploymentType = 'full-time' | 'part-time' | 'contractor'
type EmployeeStatus = 'active' | 'inactive' | 'on-leave'
```

### Department

```ts
interface Department {
  id: string                    // UUID v4
  name: string                  // Required, unique, e.g. "Engineering"
  color: string                 // Hex color for badges, e.g. "#3B82F6"
  description?: string          // Optional department description
}
```

### LeaveRequest

```ts
interface LeaveRequest {
  id: string                    // UUID v4
  employeeId: string            // Required, references Employee.id
  type: LeaveType               // Required
  startDate: string             // ISO 8601 date (YYYY-MM-DD)
  endDate: string               // ISO 8601 date (YYYY-MM-DD), >= startDate
  reason?: string               // Optional, free-form text
  status: LeaveStatus
  reviewedBy?: string           // Optional, Employee.id of approver/rejector
  reviewedAt?: string           // Optional, ISO 8601 datetime
  createdAt: string             // ISO 8601 datetime
}

type LeaveType = 'annual' | 'sick' | 'personal' | 'unpaid' | 'maternity' | 'paternity'
type LeaveStatus = 'pending' | 'approved' | 'rejected'
```

### LeaveBalance

```ts
interface LeaveBalance {
  id: string                    // Composite: `${employeeId}-${type}`
  employeeId: string            // References Employee.id
  type: LeaveType
  total: number                 // Total days allocated
  used: number                  // Days used
}

// Computed in UI: remaining = total - used
```

## Application Types

```ts
type AppRole = 'hr-admin' | 'employee'

type PageName = 'dashboard' | 'directory' | 'employee-detail' | 'leave' | 'org-chart' | 'settings'

interface NavItem {
  id: PageName
  label: string
  icon: string                  // UnoCSS icon class, e.g. "i-lucide-users"
}

interface OrgTreeNode {
  employee: Employee
  children: OrgTreeNode[]
}
```

## Dexie Schema

```ts
// db/index.ts
import Dexie, { type Table } from 'dexie'

class HRDatabase extends Dexie {
  employees!: Table<Employee>
  departments!: Table<Department>
  leaveRequests!: Table<LeaveRequest>
  leaveBalances!: Table<LeaveBalance>

  constructor() {
    super('hr-space-db')
    this.version(1).stores({
      employees: 'id, firstName, lastName, email, departmentId, managerId, status',
      departments: 'id, name',
      leaveRequests: 'id, employeeId, type, status, startDate',
      leaveBalances: 'id, employeeId, type',
    })
  }
}

export const db = new HRDatabase()
```

**Index design notes:**
- `employees` indexed on `departmentId` for department-filtered queries
- `employees` indexed on `managerId` for org chart tree building
- `employees` indexed on `status` for active/inactive filtering
- `leaveRequests` indexed on `employeeId` for per-employee history
- `leaveRequests` indexed on `status` for pending request queries
- `leaveBalances` indexed on `employeeId` for balance lookups

## Seed Data

### 4 Departments

| Name | Color | Description |
|------|-------|-------------|
| Engineering | #3B82F6 (blue) | Software development and infrastructure |
| Design | #8B5CF6 (purple) | Product and visual design |
| Marketing | #F59E0B (amber) | Growth, content, and brand |
| Operations | #10B981 (green) | HR, finance, and administration |

### 12 Employees

| # | Name | Department | Title | Manager | Status |
|---|------|-----------|-------|---------|--------|
| 1 | Sarah Chen | Engineering | VP of Engineering | — | active |
| 2 | Marcus Johnson | Design | Head of Design | — | active |
| 3 | Alex Rivera | Engineering | Senior Engineer | Sarah Chen | active |
| 4 | Priya Patel | Engineering | Software Engineer | Sarah Chen | on-leave |
| 5 | James Wilson | Engineering | Junior Engineer | Sarah Chen | active |
| 6 | Elena Kowalski | Design | Senior Designer | Marcus Johnson | active |
| 7 | David Kim | Design | UI Designer | Marcus Johnson | active |
| 8 | Rachel Thompson | Marketing | Marketing Lead | — | active |
| 9 | Omar Hassan | Marketing | Content Strategist | Rachel Thompson | active |
| 10 | Lisa Wang | Operations | Operations Manager | — | active |
| 11 | Tom Anderson | Operations | HR Coordinator | Lisa Wang | active |
| 12 | Nina Fernandez | Engineering | DevOps Engineer | Sarah Chen | inactive |

### Leave Balances (per employee)

Each active employee gets:
- Annual: 20 total (used varies 0-8)
- Sick: 10 total (used varies 0-4)
- Personal: 5 total (used varies 0-2)

### 8 Leave Requests

| Employee | Type | Dates | Status |
|----------|------|-------|--------|
| Alex Rivera | annual | 2024-03-15 → 2024-03-22 | approved |
| Priya Patel | sick | 2024-03-10 → 2024-03-14 | approved |
| James Wilson | personal | 2024-04-01 → 2024-04-02 | pending |
| Elena Kowalski | annual | 2024-04-05 → 2024-04-12 | pending |
| David Kim | sick | 2024-03-20 → 2024-03-21 | approved |
| Omar Hassan | annual | 2024-04-15 → 2024-04-19 | pending |
| Tom Anderson | personal | 2024-03-25 → 2024-03-25 | rejected |
| Alex Rivera | sick | 2024-04-08 → 2024-04-09 | pending |

## Relationships

```
Department 1──* Employee (via departmentId)
Employee   1──* Employee (via managerId, self-referential: manager → reports)
Employee   1──* LeaveRequest (via employeeId)
Employee   1──* LeaveBalance (via employeeId)
Employee   1──* LeaveRequest.reviewedBy (via reviewedBy)
```

## Validation Rules

| Field | Rule |
|-------|------|
| Employee.firstName | Required, non-empty string |
| Employee.lastName | Required, non-empty string |
| Employee.email | Required, valid email format |
| Employee.departmentId | Must reference existing Department |
| Employee.managerId | If set, must reference existing Employee (not self) |
| Employee.startDate | Valid ISO date |
| LeaveRequest.startDate | Valid ISO date |
| LeaveRequest.endDate | Valid ISO date, >= startDate |
| LeaveRequest.employeeId | Must reference existing Employee |
| Department.name | Required, unique |
| Department.color | Valid hex color |
