/**
 * Role-Based Access Control — the source of truth for "who can do what".
 *
 * The spec defines 7 roles (one platform + six tenant):
 *
 *   PLATFORM (lives under tenant_id = PLATFORM_TENANT_ID)
 *     1. platform_admin  — AINA super admin. Cross-tenant. Uses withPlatformAdmin().
 *
 *   TENANT-SCOPED (every MFD organisation)
 *     2. owner            — full access inside their MFD
 *     3. rm               — assigned leads / clients only
 *     4. back_office (ops)— operations: onboarding, transactions, KYC
 *     5. marketing        — campaigns + content; no investment data
 *     6. compliance       — DDQ + approvals + consents + SOPs
 *     7. team_member      — limited: assigned tasks only
 *
 * `branch_head` is a legacy/extra MFD role used to gate aggregated team views.
 * `investor` is reserved for the future client app and has no dashboard caps.
 *
 * Two layers of enforcement:
 *   - UI:  `can(roles, cap)` to hide / disable controls.
 *   - API: `require(roles, cap)` to throw 403 before mutating.
 *
 * Platform capabilities (creating tenants, suspending licenses, package
 * templates) live in the PLATFORM_CAPS list and are checked separately —
 * NOT through this `can()` matrix, because tenants must never grant them.
 */

export type Role =
  | "owner"
  | "rm"
  | "back_office"
  | "ops" // alias for back_office
  | "marketing"
  | "compliance"
  | "branch_head"
  | "team_member"
  | "investor";

export const ROLE_LABELS: Record<string, string> = {
  platform_admin: "Platform Super Admin (AINA)",
  platform_support: "Platform Support (AINA)",
  owner: "MFD Owner / Admin",
  rm: "Relationship Manager",
  back_office: "Back Office Executive",
  ops: "Back Office Executive",
  marketing: "Marketing Executive",
  compliance: "Compliance / DDQ Executive",
  branch_head: "Branch Head",
  team_member: "Limited Team Member",
  investor: "Investor (Client App)",
};

/**
 * Every capability the UI / API enforces.
 *
 * Naming convention: `<entity>.<action>[.scope]`
 *   - .all       = every row in the tenant
 *   - .assigned  = only rows where the user is the owner/RM/assignee
 *
 * Keep this list flat. New caps → add the key, then the role row in MATRIX.
 */
export type Capability =
  // Investor data
  | "investor.view.all"
  | "investor.view.assigned"
  | "investor.edit.all"
  | "investor.edit.assigned"
  | "investor.bulk_export"
  | "investor.note.add"
  // Leads
  | "lead.view.all"
  | "lead.view.assigned"
  | "lead.edit.all"
  | "lead.edit.assigned"
  // Transactions / SIPs / Mandates
  | "transactions.view"
  | "transactions.execute"
  // Onboarding + KYC (back-office)
  | "onboarding.manage"
  | "kyc.manage"
  // Service requests + Complaints
  | "service_request.view.all"
  | "service_request.view.assigned"
  | "service_request.manage"
  | "complaint.manage"
  // Review meetings
  | "review_meeting.manage.all"
  | "review_meeting.manage.assigned"
  // Tasks
  | "task.view.all"
  | "task.view.assigned"
  | "task.edit.all"
  | "task.edit.assigned"
  // Documents
  | "document.view"
  | "document.upload"
  | "document.delete"
  // Workflows
  | "workflow.view"
  | "workflow.edit"
  | "workflow.publish"
  // Templates + broadcasts + campaigns
  | "template.view"
  | "template.edit"
  | "template.approve"
  | "campaign.send"
  | "content_calendar.manage"
  // Segments (audience lists for campaigns + workflow triggers)
  | "segments.view"
  | "segments.manage"
  // Proposals (Mutual Fund / Insurance / PMS / AIF)
  | "proposal.view"
  | "proposal.write"
  | "proposal.send"
  // Insurance policy register
  | "insurance.view"
  | "insurance.write"
  // Compliance + DDQ + risk profile + consent + SOP
  | "compliance.view"
  | "compliance.edit"
  | "compliance.approve"
  | "risk_profile.manage"
  | "consent.manage"
  | "sop.manage"
  // Reports
  | "reports.business"
  | "reports.team"
  | "reports.commission"
  // Dashboards
  | "dashboard.view.owner"
  | "dashboard.view.compliance"
  | "dashboard.view.marketing"
  | "dashboard.view.ops"
  | "dashboard.view.rm"
  // Master settings + admin
  | "settings.users"
  | "settings.billing"
  | "settings.masters"
  | "settings.security";


/**
 * Capability matrix per role. Roles in the array are allowed.
 * `owner` is granted everything via the special case in `can()`.
 */
const MATRIX: Record<Capability, Role[]> = {
  // Investor data — back_office sees all, RM sees assigned, marketing blocked.
  "investor.view.all": ["compliance", "back_office", "ops"],
  "investor.view.assigned": ["rm", "branch_head"],
  "investor.edit.all": ["back_office", "ops"],
  "investor.edit.assigned": ["rm"],
  "investor.bulk_export": ["compliance"],
  "investor.note.add": ["rm", "back_office", "ops", "branch_head", "compliance"],

  // Leads — marketing + owner own pipeline; RM works assigned.
  "lead.view.all": ["marketing", "branch_head", "compliance"],
  "lead.view.assigned": ["rm"],
  "lead.edit.all": ["marketing"],
  "lead.edit.assigned": ["rm"],

  // Transactions — execute by back_office + RM; everyone in ops/compliance views.
  "transactions.view": ["back_office", "ops", "rm", "branch_head", "compliance"],
  "transactions.execute": ["back_office", "ops", "rm"],

  // Back-office specialties
  "onboarding.manage": ["back_office", "ops"],
  "kyc.manage": ["back_office", "ops", "compliance"],

  // Service requests / complaints
  "service_request.view.all": ["back_office", "ops", "compliance"],
  "service_request.view.assigned": ["rm"],
  "service_request.manage": ["back_office", "ops"],
  "complaint.manage": ["compliance", "back_office", "ops"],

  // Review meetings — back_office plans for all, RM runs assigned
  "review_meeting.manage.all": ["back_office", "ops", "branch_head"],
  "review_meeting.manage.assigned": ["rm"],

  // Tasks — every working role plus limited team_member
  "task.view.all": ["compliance", "back_office", "ops", "marketing", "branch_head"],
  "task.view.assigned": ["rm", "team_member", "branch_head"],
  "task.edit.all": ["back_office", "ops", "marketing"],
  "task.edit.assigned": ["rm", "team_member", "compliance", "branch_head"],

  // Documents
  "document.view": ["compliance", "back_office", "ops", "rm", "branch_head", "marketing"],
  "document.upload": ["back_office", "ops", "rm", "compliance", "team_member", "branch_head"],
  "document.delete": ["compliance"],

  // Workflows — owner publishes; ops/marketing/compliance can view + draft.
  "workflow.view": ["compliance", "marketing", "back_office", "ops"],
  "workflow.edit": [],
  "workflow.publish": [],

  // Templates + campaigns + content calendar
  "template.view": ["marketing", "compliance"],
  "template.edit": ["marketing"],
  "template.approve": ["compliance"],
  "campaign.send": ["marketing"],
  "content_calendar.manage": ["marketing"],

  // Segments (audience lists). Marketing builds them for campaigns;
  // back-office reads to seed workflow triggers.
  "segments.view": ["marketing", "back_office", "ops", "compliance", "branch_head"],
  "segments.manage": ["marketing", "back_office", "ops"],

  // Proposals — RM/back_office prepare, compliance reviews, owner sends.
  "proposal.view": ["rm", "branch_head", "back_office", "ops", "compliance", "marketing"],
  "proposal.write": ["rm", "branch_head", "back_office", "ops"],
  "proposal.send": ["rm", "branch_head"],

  // Insurance — RM + back-office maintain; compliance reads.
  "insurance.view": ["rm", "branch_head", "back_office", "ops", "compliance"],
  "insurance.write": ["rm", "branch_head", "back_office", "ops"],

  // Compliance + adjacent
  "compliance.view": ["compliance"],
  "compliance.edit": ["compliance"],
  "compliance.approve": ["compliance"],
  "risk_profile.manage": ["compliance", "back_office", "ops", "rm"],
  "consent.manage": ["compliance", "back_office", "ops"],
  "sop.manage": ["compliance"],

  // Reports
  "reports.business": ["compliance", "branch_head"],
  "reports.team": ["branch_head"],
  "reports.commission": [],

  // Dashboards
  "dashboard.view.owner": ["compliance", "branch_head"],
  "dashboard.view.compliance": ["compliance"],
  "dashboard.view.marketing": ["marketing"],
  "dashboard.view.ops": ["back_office", "ops"],
  "dashboard.view.rm": ["rm"],

  // Org admin — owner only (no other role)
  "settings.users": [],
  "settings.billing": [],
  "settings.masters": [],
  "settings.security": ["compliance"],
};

/**
 * Platform-level (AINA) capabilities. Held only by `platform_admin`.
 * These actions hit /super-admin/* routes; they bypass tenant RLS via
 * `withPlatformAdmin()` in src/db/client.ts.
 */
export type PlatformCapability =
  | "platform.tenant.create"
  | "platform.tenant.suspend"
  | "platform.tenant.activate"
  | "platform.tenant.view_all"
  | "platform.tenant.usage"
  | "platform.package.manage"
  | "platform.license.assign"
  | "platform.billing.manage"
  | "platform.support.view"
  | "platform.master.manage"
  | "platform.staff.manage";

export const PLATFORM_CAPS: PlatformCapability[] = [
  "platform.tenant.create",
  "platform.tenant.suspend",
  "platform.tenant.activate",
  "platform.tenant.view_all",
  "platform.tenant.usage",
  "platform.package.manage",
  "platform.license.assign",
  "platform.billing.manage",
  "platform.support.view",
  "platform.master.manage",
  "platform.staff.manage",
];

/** Returns true if the caller has the capability via any of their roles or custom permissions override. */
export function can(userRoles: string[] | undefined, cap: Capability, userPermissions?: string[] | null): boolean {
  if (!userRoles?.length) return false;
  if (userRoles.includes("owner")) return true; // owner always wins
  
  // If custom permissions override is specified, check that list instead of default roles
  if (userPermissions && userPermissions.length > 0) {
    return userPermissions.includes(cap);
  }
  
  const allowed = MATRIX[cap] ?? [];
  return userRoles.some((r) => allowed.includes(r as Role));
}

/** Throws a 403-shaped error if the caller is not authorised. */
export function require(userRoles: string[] | undefined, cap: Capability, userPermissions?: string[] | null): void {
  if (!can(userRoles, cap, userPermissions)) {
    throw Object.assign(new Error(`forbidden: missing ${cap}`), { status: 403 });
  }
}

/**
 * Pass-if-any helper — handler that legitimately accepts multiple
 * capabilities (e.g. lead create allowed for owners, marketing, RMs,
 * AND branch heads). Avoids ugly inline OR chains.
 *
 *   requireAny(session.roles, ["lead.edit.all", "lead.edit.assigned"], session.permissions);
 */
export function requireAny(userRoles: string[] | undefined, caps: Capability[], userPermissions?: string[] | null): void {
  if (caps.some((c) => can(userRoles, c, userPermissions))) return;
  throw Object.assign(new Error(`forbidden: missing one of ${caps.join(", ")}`), { status: 403 });
}

/**
 * Platform-capability check — separate from the tenant `can()` matrix because
 * tenant role mixtures must never grant these.
 */
export function canPlatform(userRoles: string[] | undefined, cap: PlatformCapability): boolean {
  if (!userRoles?.length) return false;
  if (!userRoles.includes("platform_admin")) return false;
  return PLATFORM_CAPS.includes(cap);
}

export function requirePlatform(userRoles: string[] | undefined, cap: PlatformCapability): void {
  if (!canPlatform(userRoles, cap)) {
    throw Object.assign(new Error(`forbidden: missing platform capability ${cap}`), { status: 403 });
  }
}

/** Returns the most senior role label for UI display. */
export function primaryRoleLabel(roles: string[]): string {
  if (roles.includes("platform_admin")) return ROLE_LABELS.platform_admin;
  if (roles.includes("platform_support")) return ROLE_LABELS.platform_support;
  for (const r of ["owner", "compliance", "marketing", "back_office", "ops", "rm", "branch_head", "team_member"]) {
    if (roles.includes(r)) return ROLE_LABELS[r] ?? r;
  }
  return roles[0] ?? "User";
}

/** Returns the default home page for a role. */
export function defaultHomeFor(roles: string[]): string {
  if (roles.includes("platform_admin") || roles.includes("platform_support")) return "/super-admin";
  if (roles.includes("owner")) return "/dashboard";
  if (roles.includes("compliance")) return "/dashboard/compliance";
  if (roles.includes("marketing")) return "/dashboard/campaigns";
  // back_office / ops used to land on /dashboard/onboarding before the
  // module was retired (its 11-stage pipeline merged into the unified
  // blueprint engine that lives in Leads + Clients). Send them to Tasks
  // — that's the work-queue view they actually use day to day.
  if (roles.includes("back_office") || roles.includes("ops")) return "/dashboard/tasks";
  if (roles.includes("rm") || roles.includes("branch_head")) return "/dashboard";
  if (roles.includes("team_member")) return "/dashboard/tasks";
  return "/dashboard/tasks";
}
