/**
 * The six role dashboards — CLIENT-SAFE. Each is a row in `dashboards`
 * (is_system, system_key; created per firm by migration 0223 and by
 * ensureSystemDashboards) so it has an id to link to, favourite and set as a
 * default. Its CONTENT is defined here, in code: system dashboards are locked
 * for everyone.
 *
 * Every role's dashboard lives in Dashboard and is picked from the dashboard
 * name's dropdown — none of them is a report or a module tab. Two kinds:
 *
 *   widgets  the Owner Dashboard: cards from the widget library
 *            (catalog.ts), each on lib/metrics. A firm varies it by cloning.
 *   centre   the other five: a full role dashboard built from its own brief
 *            (Branch Head · Relationship Manager · Operations · Insurance
 *            Team · Claims), rendered under the same dashboard header by
 *            components/dashboards/system/centres.tsx, which also decides who
 *            may open it and which book it shows.
 *
 * Every dashboard reads top to bottom the same way: the headline numbers,
 * what needs action today, the team, then the analysis.
 */

import type { SessionUser } from "@/lib/auth/session";
import { can } from "@/lib/auth/rbac";
import type { LayoutItem } from "./catalog";
import { EXTRA_FILTERS, type FilterConfig } from "./filters";

export type SystemDashboardKey = "owner" | "branch_head" | "rm" | "operations" | "insurance" | "claims";

/** The role dashboards that are a full page of their own rather than widget cards. */
export type CentreKind = "branch" | "rm" | "ops" | "insurance" | "claims";

export type SystemDashboard = {
  key: SystemDashboardKey;
  name: string;
  description: string;
  /** Widget cards (the Owner Dashboard). Empty for a centre. */
  layout: LayoutItem[];
  filters: FilterConfig;
  /** A full role dashboard rendered under the dashboard header. */
  centre?: CentreKind;
  /**
   * The roles it is for — who sees it while it is shared with "everyone in
   * the roles it's for" (the default). An admin can also share it with
   * particular people, roles, branches or teams, or limit it to them.
   */
  visibleTo: (s: SessionUser) => boolean;
  /** The same audience in words, for the share dialog and Manage dashboards. */
  audience: string;
};

const item = (widgetKey: string, size: LayoutItem["size"]): LayoutItem => ({ id: widgetKey, widgetKey, size });

const has = (s: SessionUser, cap: string) => can(s.roles, cap as never, s.permissions);
const any = (s: SessionUser, caps: string[]) => s.roles.includes("owner") || caps.some((c) => has(s, c));

/** A branch head without "all branches" — their branch is the Branch Head Dashboard, never the firm. */
function branchLocked(s: SessionUser): boolean {
  return !s.roles.includes("owner") && s.roles.includes("branch_head") && !has(s, "dashboard.view.all_branches");
}

export const SYSTEM_DASHBOARDS: SystemDashboard[] = [
  {
    key: "owner",
    name: "Owner Dashboard",
    description: "The whole practice: business, what needs attention, the team, the book and compliance.",
    // The order follows the firm's dashboard sheet (Owner Dashboard tab):
    // headline, business and SIP flow, clients, meetings and work, insurance —
    // then the team and the analysis cards that were here before the sheet.
    layout: [
      // Headline
      item("kpi_row", "L"),
      // Today's actions
      item("needs_attention", "M"),
      item("reviews_due", "M"),
      // Business
      item("business_entries", "L"),
      item("sip_flow", "M"),
      item("sip_rejection_status", "M"),
      // Clients
      item("new_clients_category", "M"),
      item("kyc_risk", "M"),
      item("client_book", "L"),
      item("client_map", "L"),
      item("cross_sell", "L"),
      // Meetings and work
      item("meetings", "L"),
      item("task_summary", "M"),
      item("lead_pipeline", "M"),
      item("opportunity_pipeline", "M"),
      item("service_requests", "M"),
      item("lead_sources", "L"),
      // Insurance
      item("insurance_business", "M"),
      item("claims_period", "M"),
      // The team
      item("team_table", "L"),
      item("branch_table", "L"),
      // Analysis
      item("business_trend", "L"),
      item("money_movement", "L"),
      item("sip_health", "M"),
      item("aum_mix", "M"),
      item("client_mix", "M"),
      item("top_clients", "M"),
      item("brokerage", "M"),
      item("insurance_book", "M"),
      item("compliance_gaps", "M"),
      item("expiry_pipeline", "M"),
      item("owner_dependency", "M"),
      item("automation", "L"),
    ],
    filters: { fields: EXTRA_FILTERS, defaults: { period: "fy" } },
    audience: "Owner, compliance and marketing",
    visibleTo: (s) => {
      if (s.roles.includes("owner") || has(s, "dashboard.view.all_branches")) return true;
      if (branchLocked(s)) return false;
      return any(s, ["dashboard.view.owner", "dashboard.view.compliance", "dashboard.view.marketing"]);
    },
  },
  {
    key: "branch_head",
    name: "Branch Head Dashboard",
    description: "One branch: its business against target, what needs the branch head, its RMs and its clients.",
    layout: [],
    centre: "branch",
    filters: { fields: [], defaults: { period: "month" } },
    audience: "Branch heads",
    visibleTo: (s) => s.roles.includes("branch_head") || any(s, ["dashboard.view.branch", "dashboard.view.all_branches"]),
  },
  {
    key: "rm",
    name: "Relationship Manager Dashboard",
    description: "Your own book: whom to contact today, what is pending, your clients, leads and targets.",
    layout: [],
    centre: "rm",
    filters: { fields: [], defaults: { period: "month" } },
    audience: "RMs, team members, and owners or branch heads who carry clients",
    // It only ever shows the viewer's own book and work, so it needs no
    // capability of its own: an owner or branch head who carries clients, and
    // a team member with their own tasks and leads, open their desk here.
    visibleTo: (s) => ["owner", "rm", "branch_head", "team_member"].some((r) => s.roles.includes(r))
      || has(s, "dashboard.view.rm"),
  },
  {
    key: "operations",
    name: "Operations Dashboard",
    description: "Pending work across the team: the queue, SLA, team load, rejections and compliance.",
    layout: [],
    centre: "ops",
    // The Operations Dashboard uses the shared filter bar; "Save filter" is kept under this dashboard.
    filters: {
      fields: ["branch", "executive", "requestType", "priority", "slaState", "pendingWith", "ageing", "mode", "category"],
      pinned: ["rm", "status"],
      defaults: { period: "today", values: { status: ["open"] } },
    },
    audience: "Operations, back office and service team",
    visibleTo: (s) => any(s, ["dashboard.view.ops"]),
  },
  {
    key: "insurance",
    name: "Insurance Team Dashboard",
    description: "Insurance business, renewals, lost business, clients, issuance and claims.",
    layout: [],
    centre: "insurance",
    filters: { fields: [], defaults: { period: "month" } },
    audience: "Insurance team",
    visibleTo: (s) => any(s, ["dashboard.view.insurance"]),
  },
  {
    key: "claims",
    name: "Claims Dashboard",
    description: "The claims queue: what needs action today, what is overdue, what is missing and who owns it.",
    layout: [],
    centre: "claims",
    filters: { fields: [], defaults: { period: "month" } },
    audience: "Insurance team",
    visibleTo: (s) => any(s, ["dashboard.view.claims"]),
  },
];

export const SYSTEM_DASHBOARD_BY_KEY: Record<string, SystemDashboard> = Object.fromEntries(
  SYSTEM_DASHBOARDS.map((d) => [d.key, d]),
);

/**
 * The seeded role → default dashboard (D8), in the order a user with several
 * roles resolves them: the first of their roles on this list wins. Compliance
 * and marketing open the Owner Dashboard, which carries the compliance and
 * lead cards.
 */
export const ROLE_DEFAULTS: Array<{ role: string; label: string; dashboard: SystemDashboardKey }> = [
  { role: "owner", label: "Owner / Admin", dashboard: "owner" },
  { role: "branch_head", label: "Branch head", dashboard: "branch_head" },
  { role: "compliance", label: "Compliance", dashboard: "owner" },
  { role: "ops", label: "Operations", dashboard: "operations" },
  { role: "back_office", label: "Back office", dashboard: "operations" },
  { role: "service_team", label: "Service team", dashboard: "operations" },
  { role: "marketing", label: "Marketing", dashboard: "owner" },
  { role: "insurance_team", label: "Insurance team", dashboard: "insurance" },
  { role: "rm", label: "Relationship manager", dashboard: "rm" },
  { role: "team_member", label: "Team member", dashboard: "rm" },
];
