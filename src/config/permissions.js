// Single source of truth for RBAC. Every key here is enforced by a route.
const group = (key, label, perms) => ({
  key,
  label,
  permissions: perms.map(([k, l]) => ({ key: k, label: l })),
});

const GROUPS = [
  group("general", "General", [
    ["dashboard.view", "View Dashboard"],
    ["mywork.view", "My Work"],
    ["calendar.view", "Calendar"],
  ]),
  group("users", "User Management", [
    ["users.view", "View Users"],
    ["users.create", "Create Users"],
    ["users.edit", "Edit Users"],
    ["users.delete", "Delete Users"],
  ]),
  group("roles", "Roles & Access", [
    ["roles.view", "View Roles"],
    ["roles.manage", "Manage Roles"],
  ]),
  group("employees", "Employees", [
    ["employees.view", "View Employees"],
    ["employees.manage", "Manage Employees"],
  ]),
  group("tasks", "Tasks", [
    ["tasks.view_all", "View All Tasks"],
    ["tasks.assign", "Assign Tasks"],
  ]),
  group("crm", "CRM", [
    ["leads.view", "View Leads"],
    ["leads.manage", "Manage Leads"],
    ["clients.view", "View Clients"],
    ["clients.manage", "Manage Clients"],
    ["deals.view", "View Deals"],
    ["deals.manage", "Manage Deals"],
    ["crmtasks.view", "View CRM Tasks"],
    ["crmtasks.manage", "Manage CRM Tasks"],
    ["followups.view", "View Follow-ups"],
    ["followups.manage", "Manage Follow-ups"],
  ]),
  group("projects", "Projects", [
    ["projects.view", "View Projects"],
    ["projects.manage", "Manage Projects"],
    ["projecttasks.view", "View Project Tasks"],
    ["projecttasks.manage", "Manage Project Tasks"],
    ["milestones.view", "View Milestones"],
    ["milestones.manage", "Manage Milestones"],
    ["timelogs.view", "View Time Tracking"],
    ["timelogs.manage", "Log Time"],
  ]),
  group("finance", "Finance", [
    ["finance.view", "View Revenue & Finance Reports"],
    ["invoices.view", "View Invoices"],
    ["invoices.manage", "Manage Invoices"],
    ["payments.view", "View Payments"],
    ["payments.manage", "Record Payments"],
    ["expenses.view", "View Expenses"],
    ["expenses.manage", "Manage Expenses"],
    ["subscriptions.view", "View Subscriptions"],
    ["subscriptions.manage", "Manage Subscriptions"],
    ["plans.view", "View Plans & Pricing"],
    ["plans.manage", "Manage Plans & Pricing"],
    ["tax.view", "View Tax Settings"],
    ["tax.manage", "Manage Tax Settings"],
  ]),
  group("campaigns", "Campaigns", [
    ["campaigns.view", "View Campaigns"],
    ["campaigns.manage", "Manage Campaigns"],
  ]),
  group("analytics", "Reports & Analytics", [
    ["analytics.view", "View Reports & Analytics"],
    ["analytics.export", "Export Data"],
  ]),
  group("reports", "Reports", [
    ["reports.view", "View Reports"],
    ["reports.manage", "Manage Reports"],
  ]),
];

const ALL_PERMISSIONS = GROUPS.flatMap((g) => g.permissions.map((p) => p.key));

// Defaults mirror what each role could already do before RBAC existed.
// What a manager needs for: lead -> demo / quotation -> sales -> project -> tasks.
const MANAGER_DEFAULTS = [
  "dashboard.view",
  "mywork.view",
  "calendar.view",
  "campaigns.view",
  "campaigns.manage",
  "leads.view",
  "leads.manage",
  "followups.view",
  "followups.manage",
  "crmtasks.view",
  "crmtasks.manage",
  "deals.view",
  "deals.manage",
  "clients.view",
  "projects.view",
  "projects.manage",
  "projecttasks.view",
  "projecttasks.manage",
  "milestones.view",
  "milestones.manage",
  "timelogs.view",
  "timelogs.manage",
];

const SYSTEM_ROLES = {
  ADMIN: {
    key: "ADMIN",
    name: "Admin",
    description:
      "Full system access with every permission. Can manage users, roles and all modules. This role is locked.",
    permissions: ALL_PERMISSIONS,
    baseRole: "ADMIN",
    isSystem: true,
  },
  MANAGER: {
    key: "MANAGER",
    name: "Manager",
    description:
      "Follows leads from demo or quotation to sales, then creates and runs the project: tasks, team, milestones and time. Admin can turn more permissions on.",
    permissions: MANAGER_DEFAULTS,
    baseRole: "MANAGER",
    isSystem: true,
  },
  EMPLOYEE: {
    key: "EMPLOYEE",
    name: "Employee",
    description:
      "Works on their own tasks. Has no extra module access unless an admin grants it.",
    permissions: [],
    baseRole: "EMPLOYEE",
    isSystem: true,
  },
};

module.exports = { GROUPS, ALL_PERMISSIONS, SYSTEM_ROLES, MANAGER_DEFAULTS };
