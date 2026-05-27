/**
 * Platform-level constants.
 *
 * AINA operates a "platform tenant" — a sentinel tenant_id under which all
 * AINA staff users live. Platform admins have cross-tenant visibility (enforced
 * at the DB via RLS bypass for these users) but their own user records still
 * have a tenant_id (this sentinel) so they go through the normal auth flow.
 */

export const PLATFORM_TENANT_ID = "00000000-0000-0000-0000-000000000000";

/** Canonical AINA admin role names. */
export const PLATFORM_ROLES = ["platform_admin", "platform_support"] as const;

export function isPlatformAdmin(roles: string[] | undefined): boolean {
  if (!roles?.length) return false;
  return roles.includes("platform_admin");
}

export function isPlatformStaff(roles: string[] | undefined): boolean {
  if (!roles?.length) return false;
  return roles.includes("platform_admin") || roles.includes("platform_support");
}

/**
 * The set of module keys the SaaS exposes. Packages enable a subset.
 * Keep in sync with packages.enabledModules + sidebar gating in dashboard layout.
 */
export const ALL_MODULES = [
  "crm",
  "lead_management",
  "client_master",
  "family_mapping",
  "onboarding",
  "risk_profile",
  "goal_planning",
  "proposals",
  "insurance",
  "transactions",
  "sip_tracker",
  "sip_rejection",
  "review_meetings",
  "service_requests",
  "complaints",
  "ddq",
  "marketing_campaigns",
  "content_calendar",
  "tasks",
  "employees",
  "reports",
  "documents",
  "cybersecurity",
  "ai_assistant",
  "automation_workflows",
  "broadcasts",
  "white_label",
  "audit_log",
  "sub_distributor",
] as const;

export type ModuleKey = (typeof ALL_MODULES)[number];

/** Default modules each preset package enables. */
export const PACKAGE_PRESETS: Record<string, { modules: ModuleKey[]; flags: Record<string, any> }> = {
  starter: {
    modules: [
      "crm",
      "lead_management",
      "client_master",
      "tasks",
      "service_requests",
      "transactions",
      "sip_tracker",
      "documents",
      "reports",
    ],
    flags: { ai_tier: "none", video: "none", broadcasts: false },
  },
  growth: {
    modules: [
      "crm",
      "lead_management",
      "client_master",
      "family_mapping",
      "onboarding",
      "risk_profile",
      "goal_planning",
      "tasks",
      "transactions",
      "sip_tracker",
      "sip_rejection",
      "review_meetings",
      "service_requests",
      "complaints",
      "ddq",
      "marketing_campaigns",
      "content_calendar",
      "automation_workflows",
      "broadcasts",
      "documents",
      "reports",
      "employees",
    ],
    flags: { ai_tier: "tier1", video: "limited", broadcasts: true },
  },
  professional: {
    modules: [...ALL_MODULES.filter((m) => m !== "white_label" && m !== "sub_distributor")] as ModuleKey[],
    flags: { ai_tier: "tier2", video: "unlimited", broadcasts: true },
  },
  premium: {
    modules: [...ALL_MODULES] as ModuleKey[],
    flags: { ai_tier: "tier3", video: "unlimited", broadcasts: true, white_label: true },
  },
};
