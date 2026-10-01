/**
 * The dashboard widget library — CLIENT-SAFE metadata (no DB). The builder's
 * picker reads it; the server registry (components/dashboards/system/registry)
 * implements each key on lib/metrics.
 *
 * Every figure a widget shows comes from lib/metrics, so the same number on
 * two dashboards is the same query. `supports` lists the dashboard filters a
 * widget honours; any other active filter shows "Filter not applied" on the
 * card instead of a silently unfiltered number.
 */

import type { FilterKey } from "./filters";

export type WidgetSize = "S" | "M" | "L";

export type WidgetCategory = "Business" | "Clients" | "Work" | "Leads" | "Insurance" | "Compliance" | "Team" | "Practice";

export type SystemWidgetMeta = {
  key: string;
  title: string;
  description: string;
  category: WidgetCategory;
  defaultSize: WidgetSize;
  sizes: WidgetSize[];
  /** Dashboard filters the widget honours. Period is listed when it applies. */
  supports: Array<FilterKey | "period">;
};

/** Filters that narrow the client book (everything scoped through a client). */
const CLIENT: Array<FilterKey | "period"> = ["rm", "branch", "segment", "category", "family", "tags", "leadSource"];

export const SYSTEM_WIDGETS: SystemWidgetMeta[] = [
  {
    key: "kpi_row", title: "KPI cards", category: "Business", defaultSize: "L", sizes: ["L"],
    description: "AUM, SIP book, net business, net SIP added, new clients, clients and insurance premium.",
    supports: ["period", ...CLIENT, "amc"],
  },
  {
    key: "needs_attention", title: "Needs attention", category: "Work", defaultSize: "M", sizes: ["M", "L"],
    description: "The six most urgent things across tasks, service requests, reviews, claims, renewals and risk profiles.",
    supports: ["rm", "branch"],
  },
  {
    key: "lead_pipeline", title: "Lead pipeline", category: "Leads", defaultSize: "M", sizes: ["S", "M", "L"],
    description: "Leads by stage, open leads and follow-ups due.",
    supports: ["period", "rm", "branch", "leadSource"],
  },
  {
    key: "team_table", title: "Team", category: "Team", defaultSize: "L", sizes: ["L"],
    description: "One row per RM: clients, AUM, SIP book, net business, new clients, overdue tasks, target.",
    supports: ["period", ...CLIENT, "amc"],
  },
  {
    key: "branch_table", title: "Branches", category: "Team", defaultSize: "L", sizes: ["L"],
    description: "The same columns per branch. Hidden when the firm has one branch.",
    supports: ["period", "segment", "category", "family", "tags", "leadSource", "amc"],
  },
  {
    key: "money_movement", title: "Money movement", category: "Business", defaultSize: "L", sizes: ["M", "L"],
    description: "Gross investment, redemption and net sales by month. Hidden when there are no transactions.",
    supports: ["period", ...CLIENT, "amc"],
  },
  {
    key: "top_clients", title: "Top clients", category: "Clients", defaultSize: "M", sizes: ["M", "L"],
    description: "Largest relationships by AUM, with SIP and last contact.",
    supports: ["rm", "branch", "segment", "category", "family", "tags", "leadSource"],
  },
  {
    key: "tasks_due", title: "Tasks due", category: "Work", defaultSize: "M", sizes: ["M", "L"],
    description: "Overdue and due-today tasks.",
    supports: ["rm", "branch"],
  },
  {
    key: "lead_funnel", title: "Lead funnel", category: "Leads", defaultSize: "L", sizes: ["M", "L"],
    description: "Leads created in the period by stage, with conversion.",
    supports: ["period", "rm", "branch", "leadSource"],
  },
  {
    key: "lead_sources", title: "Lead sources", category: "Leads", defaultSize: "M", sizes: ["M", "L"],
    description: "Leads, won and conversion by source.",
    supports: ["period", "rm", "branch", "leadSource"],
  },
  {
    key: "proposal_pipeline", title: "Proposals", category: "Leads", defaultSize: "M", sizes: ["M", "L"],
    description: "Proposals by status and value.",
    supports: ["period", "rm", "branch"],
  },
  {
    key: "lead_owners", title: "Leads by RM", category: "Leads", defaultSize: "L", sizes: ["M", "L"],
    description: "Open, won, lost and conversion per lead owner.",
    supports: ["period", "rm", "branch", "leadSource"],
  },
  {
    key: "insurance_book", title: "Premium book", category: "Insurance", defaultSize: "M", sizes: ["M", "L"],
    description: "Policies in force, annual premium, new and renewal premium.",
    supports: ["period", "rm", "branch"],
  },
  {
    key: "renewals_due", title: "Renewals due", category: "Insurance", defaultSize: "M", sizes: ["M", "L"],
    description: "Premiums falling due in 30, 60 and 90 days, and overdue.",
    supports: ["rm", "branch"],
  },
  {
    key: "claims_status", title: "Claims", category: "Insurance", defaultSize: "L", sizes: ["M", "L"],
    description: "Open claims by status and age.",
    supports: ["rm", "branch"],
  },
  {
    key: "compliance_gaps", title: "Compliance gaps", category: "Compliance", defaultSize: "M", sizes: ["M", "L"],
    description: "Risk profiles due, nominee missing, consent missing, KYC and PAN–Aadhaar.",
    supports: ["rm", "branch", "segment", "category", "family", "tags"],
  },
  {
    key: "expiry_pipeline", title: "Expiries", category: "Compliance", defaultSize: "L", sizes: ["M", "L"],
    description: "KYC, FATCA, mandates and documents expiring in 30, 60 and 90 days.",
    supports: ["rm", "branch"],
  },
  {
    key: "complaints", title: "Complaints", category: "Compliance", defaultSize: "M", sizes: ["M", "L"],
    description: "Open complaints by age (SEBI register).",
    supports: ["rm", "branch"],
  },
  {
    key: "business_trend", title: "Business trend", category: "Practice", defaultSize: "L", sizes: ["M", "L"],
    description: "AUM and the SIP book at each month end, as recorded, with today's figure.",
    supports: ["rm", "branch"],
  },
  {
    key: "sip_health", title: "SIP health", category: "Practice", defaultSize: "M", sizes: ["M", "L"],
    description: "SIP book, SIPs started and stopped, rejections and 1- and 3-year persistency.",
    supports: ["period", ...CLIENT],
  },
  {
    key: "aum_mix", title: "AUM mix", category: "Practice", defaultSize: "M", sizes: ["M", "L"],
    description: "AUM by fund house and by client category, with concentration.",
    supports: ["rm", "branch", "segment", "category", "family", "tags", "leadSource", "amc"],
  },
  {
    key: "client_mix", title: "Client mix", category: "Practice", defaultSize: "M", sizes: ["M", "L"],
    description: "Active, funded, new, dormant and at-risk clients, and clients who left.",
    supports: ["period", ...CLIENT],
  },
  {
    key: "brokerage", title: "Brokerage", category: "Practice", defaultSize: "M", sizes: ["M", "L"],
    description: "Brokerage by month and by fund house, from the brokerage statements. Firm-wide only.",
    supports: ["period"],
  },
  {
    key: "automation", title: "Automation this month", category: "Practice", defaultSize: "L", sizes: ["M", "L"],
    description: "Workflow runs, messages sent, tasks created and sends stopped by compliance. Firm-wide only.",
    supports: [],
  },
  {
    key: "business_entries", title: "Business (Business Entries)", category: "Business", defaultSize: "L", sizes: ["L"],
    description: "Gross investment, redemption and net business by product (MF, PMS, AIF, SIF) and type (equity, liquid …), beside the RTA feed.",
    supports: ["period", ...CLIENT, "amc"],
  },
  {
    key: "sip_flow", title: "SIP added and stopped", category: "Business", defaultSize: "M", sizes: ["M", "L"],
    description: "Gross SIP added, SIP stopped and net SIP from Business Entries, with the SIP register and RTA figures.",
    supports: ["period", ...CLIENT, "amc"],
  },
  {
    key: "new_clients_category", title: "New clients by category", category: "Clients", defaultSize: "M", sizes: ["M", "L"],
    description: "Clients onboarded in the period by A–D category, and FY to date against the target.",
    supports: ["period", ...CLIENT],
  },
  {
    key: "client_book", title: "Client book", category: "Clients", defaultSize: "L", sizes: ["L"],
    description: "Clients and AUM by category, by client type (family head, member, individual, corporate) and by status.",
    supports: ["period", ...CLIENT],
  },
  {
    key: "kyc_risk", title: "KYC and risk profile", category: "Compliance", defaultSize: "M", sizes: ["M", "L"],
    description: "Clients by KYC status and by risk-profile status.",
    supports: ["period", ...CLIENT],
  },
  {
    key: "meetings", title: "Meetings", category: "Work", defaultSize: "L", sizes: ["M", "L"],
    description: "New, review, follow-up and on-call meetings in the period, by status.",
    supports: ["period", "rm", "branch"],
  },
  {
    key: "reviews_due", title: "Client reviews due", category: "Clients", defaultSize: "M", sizes: ["M", "L"],
    description: "Reviews overdue, due this month and in the next 30 days, with the clients.",
    supports: ["rm", "branch", "segment", "category", "family", "tags", "leadSource"],
  },
  {
    key: "sip_rejection_status", title: "SIP rejections", category: "Business", defaultSize: "M", sizes: ["M", "L"],
    description: "SIPs rejected in the period, count and value, by recovery status.",
    supports: ["period", ...CLIENT],
  },
  {
    key: "insurance_business", title: "Insurance business by product", category: "Insurance", defaultSize: "M", sizes: ["M", "L"],
    description: "New and renewal premium booked in the period, by product.",
    supports: ["period", "rm", "branch"],
  },
  {
    key: "claims_period", title: "Claims by status", category: "Insurance", defaultSize: "M", sizes: ["M", "L"],
    description: "Claims intimated in the period by status, with the amount claimed and settled.",
    supports: ["period", "rm", "branch"],
  },
  {
    key: "task_summary", title: "Task summary", category: "Work", defaultSize: "M", sizes: ["M", "L"],
    description: "Tasks created in the period — total, pending, awaiting input and completed, financial and non-financial.",
    supports: ["period", "rm", "branch"],
  },
  {
    key: "cross_sell", title: "Cross-sell", category: "Clients", defaultSize: "L", sizes: ["M", "L"],
    description: "Existing clients taking another product: open opportunities, won and lost in the period, conversion, and products held per client.",
    supports: ["period", "rm", "branch", "segment", "category", "family", "tags", "leadSource"],
  },
];

export const SYSTEM_WIDGETS_BY_KEY: Record<string, SystemWidgetMeta> = Object.fromEntries(
  SYSTEM_WIDGETS.map((w) => [w.key, w]),
);

/** A placed widget in a dashboard layout. */
export type LayoutItem = { id: string; widgetKey: string; size: WidgetSize; title?: string };

/** At most this many widgets on one dashboard (the Owner Dashboard, cloned, has 28). */
export const MAX_WIDGETS = 32;

/** Validate a layout from the client or the database: known widgets, valid sizes, capped. */
export function sanitizeLayoutItems(input: unknown): LayoutItem[] {
  if (!Array.isArray(input)) return [];
  const out: LayoutItem[] = [];
  for (const raw of input) {
    if (out.length >= MAX_WIDGETS) break;
    const r = raw as Record<string, unknown>;
    const meta = SYSTEM_WIDGETS_BY_KEY[String(r?.widgetKey ?? "")];
    if (!meta) continue;
    const size = meta.sizes.includes(r.size as WidgetSize) ? (r.size as WidgetSize) : meta.defaultSize;
    out.push({
      id: typeof r.id === "string" && r.id ? r.id.slice(0, 64) : `${meta.key}-${out.length + 1}`,
      widgetKey: meta.key,
      size,
      title: typeof r.title === "string" && r.title.trim() ? r.title.trim().slice(0, 80) : undefined,
    });
  }
  return out;
}

/** Keys that appear more than once — the builder warns, it does not refuse. */
export function duplicateWidgets(items: LayoutItem[]): string[] {
  const seen = new Set<string>();
  const dup = new Set<string>();
  for (const i of items) (seen.has(i.widgetKey) ? dup : seen).add(i.widgetKey);
  return [...dup];
}

/**
 * Old custom-board widgets (the pre-2026-09 catalog) mapped onto this library
 * — their own SQL disagreed with the rest of the app, so a saved board opens
 * with the equivalent metric widget instead. Unmapped keys are dropped.
 */
export const LEGACY_WIDGET_MAP: Record<string, string> = {
  kpi_aum: "kpi_row",
  kpi_active_sip: "kpi_row",
  kpi_clients: "kpi_row",
  kpi_net_sales_mtd: "kpi_row",
  kpi_gross_business_mtd: "kpi_row",
  cmp_net_sales_mom: "kpi_row",
  cmp_new_clients_mom: "kpi_row",
  meter_new_clients_target: "kpi_row",
  kpi_new_leads_mtd: "lead_pipeline",
  kpi_conversion_rate: "lead_funnel",
  funnel_blueprint: "lead_funnel",
  table_sla_leads: "lead_pipeline",
  kpi_open_tasks: "tasks_due",
  kpi_overdue_reviews: "needs_attention",
  table_review_pending: "needs_attention",
  chart_net_sales: "money_movement",
  chart_aum_movement: "money_movement",
  table_high_aum: "top_clients",
  table_dormant: "top_clients",
  table_open_complaints: "complaints",
  table_rm_business: "team_table",
};

/** Convert an old board layout, keeping the first occurrence of each mapped widget. */
export function migrateLegacyLayout(input: unknown): LayoutItem[] {
  if (!Array.isArray(input)) return [];
  const seen = new Set<string>();
  const out: LayoutItem[] = [];
  for (const raw of input) {
    const r = raw as Record<string, unknown>;
    const key = String(r?.widgetKey ?? "");
    const mapped = SYSTEM_WIDGETS_BY_KEY[key] ? key : LEGACY_WIDGET_MAP[key];
    if (!mapped || seen.has(mapped)) continue;
    seen.add(mapped);
    const meta = SYSTEM_WIDGETS_BY_KEY[mapped];
    out.push({ id: `${mapped}-${out.length + 1}`, widgetKey: mapped, size: meta.defaultSize });
  }
  return out.slice(0, MAX_WIDGETS);
}
