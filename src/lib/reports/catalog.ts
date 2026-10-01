/**
 * The canned report catalog — the single source of truth for the 87 built-in
 * reports, shared by the /dashboard/reports hub AND the ⌘K command palette.
 *
 * It lived inline in the reports page until findability became the problem:
 * a report the palette can't see is a report the user believes doesn't exist.
 * (That is verbatim the top complaint against the incumbent back offices —
 * a user reports a feature "missing" when it is only unfindable.)
 *
 * `icon` is a lucide displayName (a string, not a component) so this module
 * stays plain data and can cross the RSC boundary into client components.
 *
 * `href` defaults to /dashboard/reports/<key>; set it explicitly when a report
 * routes to a dedicated page elsewhere (e.g. DDQ readiness → /dashboard/compliance).
 *
 * `aliases` are extra search terms that never render. They carry three kinds of
 * word: what the OTHER back office called it (an MFD migrating from Investwell
 * or Wealth Elite searches with their old vocabulary), the RTA file code an ops
 * user thinks in (WBR9, MFSD211), and the plain synonym someone actually types
 * ("XIRR", "LTCG"). Adding a word here is free; leaving one out costs a support
 * ticket. See docs/UX_AND_SWITCHING.md.
 */

export type ReportItem = {
  key: string;
  label: string;
  icon: string;
  href?: string;
  desc?: string;
  /** Non-rendering search synonyms: incumbent names, RTA codes, plain terms. */
  aliases?: string[];
};

/** How often a group's reports are meant to be run — shown as a tag, never in the name. */
export type ReportFrequency = "Daily" | "Weekly" | "Monthly" | "Quarterly" | "Yearly";

export type ReportGroup = { group: string; frequency?: ReportFrequency; items: ReportItem[] };

/**
 * "Most used" on the reports hub counts what each person opens (per device).
 * Until someone has opened six, these fill the gaps, in order: the reports an
 * MFD firm runs week in, week out. More than six, so the row stays full after
 * favourites and hidden reports are left out of it.
 */
export const DEFAULT_MOST_USED = [
  "aum_movement",
  "active_sip_book",
  "net_sales",
  "sip_rejected",
  "tax_realised",
  "review_pending",
  "daily_sip_added",
  "rm_business",
  "high_aum",
  "tax_notional",
  "sip_expiring",
  "family_aum",
] as const;

export const REPORTS: ReportGroup[] = [
  {
    group: "Growth MIS", frequency: "Monthly", items: [
      { key: "growth_mis", label: "Growth MIS — Efforts × Results", icon: "BarChart3", href: "/dashboard/reports/growth-mis", desc: "Monthly efforts and results, side by side", aliases: ["MIS", "monthly MIS", "efforts"] },
      { key: "business_mis", label: "Results MIS — Product × Asset (Full FY)", icon: "BarChart3", href: "/dashboard/reports/business-mis", desc: "Full-year business by product and asset class", aliases: ["MIS", "annual MIS", "product wise"] },
    ]
  },
  {
    group: "Sales & Business", items: [
      { key: "daily_sip_added", label: "Daily SIP Added", icon: "TrendingUp", desc: "New SIPs registered, day by day", aliases: ["new SIP", "SIP added", "fresh SIP"] },
      { key: "daily_lumpsum", label: "Daily Purchase", icon: "TrendingUp", desc: "Lumpsum purchases, day by day", aliases: ["purchase", "lumpsum", "inflow", "subscription"] },
      { key: "redemption", label: "Daily Redemption", icon: "TrendingDown", desc: "Money leaving the book, day by day", aliases: ["outflow", "withdrawal", "repurchase", "sell"] },
      { key: "net_sales", label: "Net Business", icon: "BarChart3", desc: "Inflows minus outflows for the period", aliases: ["net sales", "gross sales", "net business", "inflow outflow", "sales"] },
      { key: "net_sales_platform", label: "Net Sales by Platform", icon: "BarChart3", href: "/dashboard/reports/net-sales", desc: "Net sales split by BSE/NSE/direct platform", aliases: ["net sales", "platform wise", "exchange wise"] },
      { key: "efforts", label: "Efforts — Plan vs Actual", icon: "ListChecks", href: "/dashboard/reports/efforts", desc: "Calls, meetings and proposals vs your plan" },
      { key: "amc_business", label: "AMC-wise Business", icon: "BarChart3", desc: "Which fund houses your business goes to", aliases: ["AMC wise", "fund house", "AMC report"] },
      { key: "scheme_category_business", label: "Scheme Category-wise", icon: "BarChart3", desc: "Business split by equity, debt, hybrid", aliases: ["category wise", "asset class", "scheme category"] },
      { key: "aum_movement", label: "AUM Movement", icon: "BarChart3", desc: "How your AUM grew or shrank", aliases: ["AUM", "AUM report", "AUM summary", "assets under management", "AUM change"] },
      { key: "equity_team", label: "Equity Team (Direct Equity) — Planned vs Actual", icon: "TrendingUp", href: "/dashboard/reports/equity-team", desc: "Direct-equity desk: planned vs delivered", aliases: ["direct equity", "stocks", "shares", "demat", "broking"] },
    ]
  },
  {
    group: "SIP Tracker", items: [
      { key: "active_sip_book", label: "Active SIP Book", icon: "BarChart3", desc: "Every live SIP and its monthly value", aliases: ["SIP book", "SIP report", "running SIP", "live SIP", "active SIP"] },
      { key: "sip_added_mtd", label: "SIP Added This Month", icon: "TrendingUp", desc: "SIPs started this month" },
      { key: "sip_stopped", label: "SIP Stopped This Month", icon: "TrendingDown", desc: "SIPs stopped this month, with reasons" },
      { key: "sip_expiring", label: "SIP Expiring Soon", icon: "Calendar", desc: "SIPs about to end — renew in time", aliases: ["SIP renewal", "expiring SIP", "SIP ending"] },
      { key: "sip_topup_opportunity", label: "SIP Top-Up Opportunity", icon: "TrendingUp", desc: "Clients who can raise their SIP" },
      { key: "sip_health", label: "SIP Health & Efforts", icon: "TrendingUp", href: "/dashboard/reports/sip-health", desc: "Bounce trends and recovery efforts" },
      { key: "sip_expiry", label: "SIP Expiry", icon: "CalendarClock", href: "/dashboard/reports/sip-expiry", desc: "SIPs reaching the end of their term, with lifetime progress", aliases: ["SIP renewal", "expiring SIP", "SIP ending"] },
      { key: "rm_sip_book", label: "RM-wise SIP Book", icon: "Users", desc: "Each RM's SIP book size", aliases: ["SIP book", "RM SIP"] },
      { key: "sip_book_size", label: "SIP Book Size (branch-wise)", icon: "BarChart3", href: "/dashboard/reports/metric/sip-book", desc: "SIP book totals by branch", aliases: ["SIP book", "branch SIP"] },
      { key: "sip_rejected", label: "SIP Rejected", icon: "AlertTriangle", desc: "SIPs that bounced and need recovery", aliases: ["bounce", "SIP bounce", "failed SIP", "rejection", "NACH failure", "mandate failure"] },
      { key: "sip_recovery_monthly", label: "Monthly SIP Recovery", icon: "TrendingUp", desc: "Bounced SIPs recovered each month" },
    ]
  },
  {
    group: "Team & Branch", items: [
      { key: "rm_business", label: "RM-wise Business", icon: "Users", desc: "Business brought in by each RM", aliases: ["RM wise", "advisor wise", "relationship manager", "employee business"] },
      { key: "rm_clients", label: "RM-wise Clients", icon: "Users", desc: "How many clients each RM manages" },
      { key: "rm_reviews", label: "RM-wise Reviews", icon: "Calendar", desc: "Review meetings held by each RM" },
      { key: "rm_pending", label: "RM-wise Pending Work", icon: "AlertTriangle", desc: "Open work sitting with each RM" },
      { key: "employee_tasks", label: "Employee-wise Tasks", icon: "Users", desc: "Task load and completion by teammate" },
      { key: "branch_business", label: "Branch-wise Business", icon: "Briefcase", desc: "Business by branch", aliases: ["branch wise", "location wise"] },
      { key: "aum_status", label: "AUM Status (branch-wise)", icon: "BarChart3", href: "/dashboard/reports/metric/aum", desc: "AUM totals by branch", aliases: ["AUM", "AUM report", "AUM summary", "branch AUM", "assets under management"] },
      { key: "team_productivity", label: "Team Productivity", icon: "Users", desc: "Activity and output across the team" },
    ]
  },
  {
    group: "Branch & RM Business", frequency: "Monthly", items: [
      { key: "sif_status", label: "SIF Business — Target vs Actual", icon: "TrendingUp", href: "/dashboard/reports/sif-status", desc: "SIF business vs target, monthly" },
      { key: "branch_rm_sip", label: "SIP — Branch & RM-wise", icon: "TrendingUp", href: "/dashboard/reports/branch-rm/sip", desc: "SIP numbers by branch and RM" },
      { key: "branch_rm_equity", label: "Equity Lumpsum — Branch & RM-wise", icon: "BarChart3", href: "/dashboard/reports/branch-rm/equity-lumpsum", desc: "Equity lumpsum by branch and RM" },
      { key: "branch_rm_liquid", label: "Liquid Lumpsum — Branch & RM-wise", icon: "BarChart3", href: "/dashboard/reports/branch-rm/liquid-lumpsum", desc: "Liquid lumpsum by branch and RM" },
      { key: "branch_rm_insurance", label: "Insurance — Branch & RM-wise", icon: "ShieldCheck", href: "/dashboard/reports/branch-rm/insurance", desc: "Insurance business by branch and RM" },
      { key: "redemption_by_client", label: "Redemption by Client", icon: "TrendingDown", href: "/dashboard/reports/redemption", desc: "Who redeemed, how much, and when", aliases: ["outflow", "withdrawal", "repurchase", "client redemption"] },
      { key: "sip_rejection", label: "SIP Rejection / Pending / Repurchase", icon: "AlertTriangle", href: "/dashboard/reports/sip-rejection", desc: "Bounces, pending recoveries and repurchases", aliases: ["bounce", "SIP bounce", "failed SIP", "rejection", "NACH failure", "repurchase"] },
    ]
  },
  {
    group: "Lead Blueprint", items: [
      { key: "lead_funnel", label: "Lead Funnel & Conversion (Source × RM)", icon: "Filter", href: "/dashboard/reports/lead-funnel", desc: "Where leads come from and who converts them", aliases: ["funnel", "conversion", "pipeline", "prospect"] },
      { key: "proposal_conversion", label: "Proposal Conversion — Proposed vs Invested", icon: "CheckCircle2", href: "/dashboard/reports/proposal-conversion", desc: "How much of what you propose clients accept, and actually invest", aliases: ["proposal", "proposals", "conversion", "executed", "take-up", "win rate"] },
      { key: "blueprint_drop_off", label: "Lead Drop-off Analysis", icon: "TrendingDown", desc: "Which stage loses the most leads" },
      { key: "blueprint_lost_reasons", label: "Lead Loss Reasons", icon: "Filter", desc: "Why leads say no" },
      { key: "blueprint_delayed_leads", label: "SLA-overdue Leads", icon: "AlertTriangle", desc: "Leads stuck past their stage deadline" },
      { key: "blueprint_pipeline_by_rm", label: "RM-wise Blueprint Pipeline", icon: "Users", desc: "Each RM's lead pipeline right now" },
    ]
  },
  {
    group: "Clients", items: [
      { key: "lead_conversion", label: "Lead Conversion", icon: "Filter", desc: "Leads that became clients", aliases: ["funnel", "conversion", "prospect"] },
      { key: "review_pending", label: "Review Pending", icon: "Calendar", desc: "Clients waiting for a portfolio review", aliases: ["review due", "portfolio review", "annual review"] },
      { key: "service_pending", label: "Service Requests Pending", icon: "FileText", desc: "Open service requests by age", aliases: ["service request", "ticket", "SR", "pending tickets"] },
      { key: "segmentation", label: "Client Segmentation", icon: "Users", desc: "Your book by segment — HNI, retail, NRI", aliases: ["client grouping", "AUM slab", "segment", "client segmentation"] },
      { key: "high_aum", label: "High-AUM Clients", icon: "TrendingUp", desc: "Your largest clients at a glance", aliases: ["top investors", "top clients", "HNI", "largest clients"] },
      { key: "dormant", label: "Dormant Clients", icon: "AlertTriangle", desc: "Clients with no activity for months", aliases: ["inactive clients", "non transacting", "idle clients"] },
      { key: "nomination-tracker", label: "Nomination Tracker", icon: "ShieldCheck", desc: "Folios still missing a nominee", aliases: ["nominee", "nomination", "opt out", "nomination status"] },
    ]
  },
  {
    group: "Retention & Tax", items: [
      { key: "churn-risk", label: "Churn-risk radar", icon: "ShieldCheck", desc: "Clients showing signs of leaving", aliases: ["attrition", "redemption risk", "retention", "at risk clients"] },
      { key: "tax-harvesting", label: "Tax-harvesting", icon: "TrendingUp", desc: "Gains that can be booked tax-smart", aliases: ["harvest", "harvesting", "LTCG exemption", "1.25 lakh", "loss harvesting", "booking"] },
      { key: "cross-sell", label: "Cross-sell Radar", icon: "Users", desc: "Who's missing SIP, insurance or ELSS", aliases: ["cross sell", "upsell", "opportunity", "wallet share"] },
    ]
  },
  {
    group: "Practice Intelligence", items: [
      { key: "impact-attribution", label: "Impact Attribution — Protected & Generated Business", icon: "TrendingUp", desc: "Business you protected and generated" },
      { key: "risk-drift", label: "Risk-Drift Radar", icon: "ShieldCheck", desc: "Portfolios drifting from their risk profile" },
      { key: "referral-radar", label: "Referral Radar", icon: "Users", desc: "Who referred, who's likely to refer" },
      { key: "revenue-intelligence", label: "Revenue Intelligence", icon: "TrendingUp", desc: "Where your revenue actually comes from", aliases: ["brokerage", "commission", "revenue", "income", "payout", "earnings", "brokerage report"] },
      { key: "trail-forecast", label: "Trail Forecast", icon: "TrendingUp", desc: "Projected trail income, month by month", aliases: ["trail", "trail commission", "brokerage forecast", "recurring income", "trail income"] },
    ]
  },
  {
    group: "Taxation", items: [
      { key: "tax_realised", label: "Realised Capital Gain", icon: "TrendingUp", href: "/dashboard/reports/tax/realised-capital-gains", desc: "STCG / LTCG booked this FY, per client (FIFO)", aliases: ["capital gains", "capital gain statement", "CG statement", "LTCG", "STCG", "long term", "short term", "realised gain", "realized gain", "112A", "FIFO"] },
      { key: "tax_notional", label: "Notional Capital Gain", icon: "BarChart3", href: "/dashboard/reports/tax/notional-capital-gains", desc: "Unrealised gains at today's NAV, per client", aliases: ["unrealised gain", "unrealized gain", "notional", "MTM", "mark to market", "paper profit", "book profit"] },
      { key: "tax_dividend", label: "Dividend / IDCW Report", icon: "FileText", href: "/dashboard/reports/tax/dividend-report", desc: "Payouts and reinvestments received this FY", aliases: ["IDCW", "dividend", "dividend income statement", "payout"] },
      { key: "tax_fy_wise", label: "Financial Year Wise Report", icon: "Calendar", href: "/dashboard/reports/tax/fy-wise", desc: "Inflows, redemptions and gains per FY, per client", aliases: ["FY wise", "year wise", "financial year", "annual"] },
      { key: "tax_package", label: "Tax Package (per-client PDF)", icon: "FileText", href: "/dashboard/reports/tax/tax-package", desc: "One PDF per client: gains, IDCW and holdings for ITR", aliases: ["ITR", "tax statement", "tax report", "CA", "filing"] },
    ]
  },
  {
    group: "Complaint Register (SEBI)", items: [
      { key: "open_complaints", label: "Open Complaints", icon: "AlertTriangle", desc: "Complaints still open (SEBI register)", aliases: ["SCORES", "complaint register", "SEBI complaint", "grievance"] },
      { key: "resolved_complaints", label: "Resolved Complaints", icon: "CheckCircle2", desc: "Complaints closed, with resolution time", aliases: ["SCORES", "complaint register", "grievance"] },
      { key: "complaint_tat", label: "Complaint TAT Report", icon: "Clock", desc: "How fast complaints get resolved", aliases: ["SCORES", "TAT", "turnaround", "grievance"] },
      { key: "complaint_category", label: "Complaint Category Report", icon: "Shield", desc: "What clients complain about most", aliases: ["SCORES", "complaint register", "grievance"] },
    ]
  },
  {
    group: "Family Mapping", items: [
      { key: "family_aum", label: "Family-wise AUM", icon: "Users", desc: "Wealth grouped by family", aliases: ["family", "household", "group", "family consolidated", "family portfolio"] },
      { key: "family_sip", label: "Family-wise SIP", icon: "TrendingUp", desc: "SIPs grouped by family", aliases: ["family", "household", "group"] },
      { key: "unmapped_family_members", label: "Unmapped Family Members", icon: "AlertTriangle", desc: "Clients not linked to any family" },
      { key: "family_review_due", label: "Family Review Due", icon: "Calendar", desc: "Families due for their review", aliases: ["review due", "portfolio review", "family review"] },
      { key: "next_gen_prospects", label: "Next-Gen Prospect List", icon: "Users", desc: "Children of clients — tomorrow's investors" },
    ]
  },
  {
    group: "Goal Planning", items: [
      { key: "goal_clients", label: "Goal-wise Clients", icon: "Users", desc: "Clients and the goals they're planning", aliases: ["Goal GPS", "goal planning", "goal tracking", "goals"] },
      { key: "goals_behind", label: "Goals Behind Track", icon: "AlertTriangle", desc: "Goals off-track and by how much", aliases: ["Goal GPS", "goal planning", "off track", "behind target"] },
      { key: "goals_5yr", label: "Goals Due in Next 5 Years", icon: "Calendar", desc: "Goals maturing in the next five years" },
      { key: "retirement_clients", label: "Retirement Planning Clients", icon: "TrendingUp", desc: "Everyone planning retirement with you" },
      { key: "child_edu_clients", label: "Child Education Planning", icon: "Users", desc: "Everyone planning a child's education" },
    ]
  },
  {
    group: "Marketing Campaigns", items: [
      { key: "campaign_leads", label: "Campaign-wise Leads", icon: "Users", desc: "Leads each campaign brought in" },
      { key: "campaign_conversion", label: "Campaign-wise Conversion", icon: "TrendingUp", desc: "Which campaigns turn into business" },
      { key: "marketing_calendar", label: "Monthly Marketing Calendar", icon: "Calendar", desc: "What goes out this month" },
      { key: "pending_approval_content", label: "Pending Approval Content", icon: "FileText", desc: "Content waiting for compliance sign-off" },
      { key: "marketing-assets", label: "Marketing assets & trust builders", icon: "Megaphone", desc: "Brochures, decks and trust builders" },
    ]
  },
  {
    group: "Insurance", items: [
      { key: "insurance_production", label: "Advisor Production (Personal + Commercial)", icon: "ShieldCheck", href: "/dashboard/reports/insurance-production", desc: "Policies sold — personal and commercial", aliases: ["insurance", "policy", "life insurance", "general insurance", "LI", "GI"] },
      { key: "insurance_claims", label: "Claims Summary", icon: "ShieldCheck", href: "/dashboard/reports/insurance-claims", desc: "Claims raised and settled", aliases: ["claim", "insurance claim", "settlement"] },
    ]
  },
  {
    group: "Back Office", frequency: "Monthly", items: [
      { key: "bo_other_services", label: "Other Services (IIN/CAN/KYC…) by Branch", icon: "ListChecks", href: "/dashboard/reports/other-services", desc: "IIN, CAN, KYC and other ops work by branch", aliases: ["IIN", "CAN", "back office", "other services", "non financial", "NFT", "bank change", "name change"] },
      { key: "bo_work", label: "Back-Office Work (Rectifications)", icon: "CheckCircle2", href: "/dashboard/reports/back-office-work", desc: "Rectifications handled by back office", aliases: ["rectification", "back office work", "corrections"] },
    ]
  },
  {
    group: "Compliance", items: [
      { key: "ddq_readiness", label: "DDQ Readiness", icon: "FileText", href: "/dashboard/compliance", desc: "How ready you are for a SEBI DDQ", aliases: ["DDQ", "audit", "due diligence", "SEBI audit", "inspection"] },
      { key: "arn-euin-tracker", label: "ARN / EUIN / NISM / DSC tracker", icon: "Shield", desc: "ARN, EUIN, NISM and DSC expiry dates", aliases: ["ARN", "EUIN", "NISM", "DSC", "renewal", "expiry", "licence", "license"] },
      { key: "kyc-tracker", label: "Client KYC tracker", icon: "ShieldCheck", desc: "Client KYC status across the book", aliases: ["KYC", "CKYC", "KRA", "PAN Aadhaar", "KYC status", "re-KYC"] },
      { key: "shortlisted-schemes", label: "AMC scheme shortlist (IC)", icon: "Briefcase", desc: "Your investment committee's approved list", aliases: ["IC", "investment committee", "approved schemes", "recommended funds"] },
      { key: "suitability-matrix", label: "MF suitability matrix (IC)", icon: "Filter", desc: "Which products suit which risk profile", aliases: ["IC", "investment committee", "suitability", "risk mapping"] },
      { key: "mf-selection-criteria", label: "MF selection criteria (IC)", icon: "ListChecks", desc: "How your firm picks funds", aliases: ["IC", "investment committee", "fund selection", "scheme selection"] },
    ]
  },
  {
    group: "Practice & Finances", items: [
      { key: "business-projections", label: "Business projections (AUM & income)", icon: "TrendingUp", desc: "Where AUM and income are heading", aliases: ["projection", "forecast", "budget", "target"] },
      { key: "financial-checklist", label: "Finance management checklist", icon: "CheckCircle2", desc: "Practice finance hygiene, item by item" },
    ]
  },
];

/** Flat list of every report, with its resolved href. */
export const ALL_REPORTS: Array<ReportItem & { href: string; group: string }> =
  REPORTS.flatMap((g) =>
    g.items.map((i) => ({ ...i, group: g.group, href: i.href ?? `/dashboard/reports/${i.key}` }))
  );

/** Every string a search should match a report on. */
export function reportHaystack(item: ReportItem & { group?: string }): string {
  return [item.label, item.desc ?? "", item.group ?? "", ...(item.aliases ?? [])]
    .join(" ")
    .toLowerCase();
}
