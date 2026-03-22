# HR Space — Space Design

## Purpose

The HR Space is a Construct space that provides human resources management capabilities entirely client-side. It enables HR administrators to manage employees, handle leave requests, and visualize organizational structure. Employees can self-serve their profiles and leave requests.

## Target Users

### HR Admin
- Full CRUD on all employee records
- Approve/reject leave requests from any employee
- Manage departments and system settings
- View org-wide dashboards and reports

### Employee (Self-Service)
- View own profile and leave balances
- Submit leave requests
- Browse the employee directory (read-only)
- View org chart

## Pages & Navigation

The space uses a sidebar navigation pattern with 6 pages:

### 1. Dashboard (`dashboard`)
**Default landing page.**
- **Stat Cards Row:** Total Employees (active), Total Departments, Pending Leave Requests, Employees On Leave Today
- **Department Breakdown:** Horizontal list/bars showing employee count per department
- **Pending Actions (HR Admin):** Up to 5 pending leave requests with quick approve/reject
- **My Upcoming Leave (Employee):** Shows the logged-in employee's upcoming approved leave

### 2. Employee Directory (`directory`)
- **Header:** Title + "Add Employee" button (HR admin only)
- **Search & Filter Bar:** Real-time text search across name, email, title + Department dropdown filter
- **Employee Grid:** Cards showing avatar, name, title, department, status
- **Card Click:** Navigates to Employee Detail page
- **Empty State:** Shown when search/filter yields no results

### 3. Employee Detail (`employee-detail`)
- **Header:** Back button + large profile with avatar, name, title, department, status
- **Action Buttons (HR Admin):** Edit, Delete
- **Info Grid:** Two columns — Personal Info (email, phone, employment type, start date) + Organization (department, manager, job title)
- **Leave Balances:** Progress bars for each leave type (used/total)
- **Leave History:** Table of this employee's leave requests with status badges
- **Edit Mode:** Opens EmployeeForm modal pre-filled with current data
- **Delete:** Confirm dialog → removes employee → navigates to directory

### 4. Leave Management (`leave`)
- **Two-panel layout** (side by side on desktop, stacked on mobile)
- **Left Panel:**
  - Tab toggle: All Requests / Pending (HR Admin) or All / My Requests (Employee)
  - "New Request" button opens LeaveRequestForm modal
  - List of LeaveRequestCards with approve/reject actions (HR Admin, pending only)
- **Right Panel:**
  - Monthly calendar showing approved leaves highlighted with employee initials
  - Month navigation (prev/next)

### 5. Org Chart (`org-chart`)
- **Tree visualization** of reporting hierarchy
- Root nodes = employees with no manager
- Each node shows avatar, name, title, department
- Child nodes connected with CSS lines
- Expand/collapse children
- Click node → navigate to employee detail
- Mobile: falls back to indented list

### 6. Settings (`settings`)
- **HR Admin only** (employee role sees message to contact admin)
- **Departments Management:** List with inline edit/delete + add new department form
- **Data Management:** Reset demo data, Export JSON, Clear all data (with confirm)
- **About:** Space version info

## User Flows

### Flow 1: Add New Employee (HR Admin)
1. Navigate to Directory
2. Click "Add Employee"
3. Fill in EmployeeForm (name, email, department, manager, etc.)
4. Click Save
5. Employee appears in directory grid
6. Toast: "Employee added successfully"

### Flow 2: Submit Leave Request (Employee)
1. Navigate to Leave Management
2. Click "New Request"
3. Select leave type, dates, optional reason
4. See remaining balance for selected type
5. Submit
6. Request appears in list as "Pending"
7. Toast: "Leave request submitted"

### Flow 3: Approve Leave (HR Admin)
1. See pending request on Dashboard or Leave page
2. Click "Approve" button
3. Request status changes to "Approved"
4. Employee's leave balance updated (used +1 for each day)
5. Leave appears on calendar
6. Toast: "Leave request approved"

### Flow 4: View Org Chart
1. Navigate to Org Chart
2. See tree of all employees grouped by reporting structure
3. Click on any node to view their detail page
4. Expand/collapse branches to explore hierarchy

## Role Switching

A toggle in the sidebar bottom switches between HR Admin and Employee views. This is a demo mechanism — in production, roles would come from Construct's auth system. The toggle immediately shows/hides admin-only UI elements.
