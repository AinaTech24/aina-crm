import Link from "next/link";
import { BarChart3 } from "lucide-react";
import { ReportsGrid } from "@/components/reports/ReportsGrid";

/**
 * Canned report catalog. `icon` is a lucide displayName (string) so the list
 * can be handed to the client <ReportsGrid> (which owns per-user hide/restore)
 * without serializing icon components across the RSC boundary.
 *
 * `href` defaults to /dashboard/reports/<key>; set it explicitly when a report
 * routes to a dedicated page elsewhere (e.g. DDQ readiness → /dashboard/compliance).
 */
type ReportItem = { key: string; label: string; icon: string; href?: string };

const REPORTS: { group: string; items: ReportItem[] }[] = [
  { group: "Growth MIS (Monthly)", items: [
    { key: "growth_mis", label: "Growth MIS — Efforts × Results", icon: "BarChart3", href: "/dashboard/reports/growth-mis" },
    { key: "business_mis", label: "Results MIS — Product × Asset (Full FY)", icon: "BarChart3", href: "/dashboard/reports/business-mis" },
  ]},
  { group: "Sales & Business", items: [
    { key: "daily_sip_added", label: "Daily SIP Added", icon: "TrendingUp" },
    { key: "daily_lumpsum", label: "Daily Purchase", icon: "TrendingUp" },
    { key: "redemption", label: "Daily Redemption", icon: "TrendingDown" },
    { key: "net_sales", label: "Net Business", icon: "BarChart3" },
    { key: "net_sales_platform", label: "Net Sales by Platform", icon: "BarChart3", href: "/dashboard/reports/net-sales" },
    { key: "efforts", label: "Efforts — Plan vs Actual", icon: "ListChecks", href: "/dashboard/reports/efforts" },
    { key: "amc_business", label: "AMC-wise Business", icon: "BarChart3" },
    { key: "scheme_category_business", label: "Scheme Category-wise", icon: "BarChart3" },
    { key: "aum_movement", label: "AUM Movement", icon: "BarChart3" },
    { key: "equity_team", label: "Equity Team (Direct Equity) — Planned vs Actual", icon: "TrendingUp", href: "/dashboard/reports/equity-team" },
  ]},
  { group: "SIP Tracker", items: [
    { key: "active_sip_book", label: "Active SIP Book", icon: "BarChart3" },
    { key: "sip_added_mtd", label: "SIP Added This Month", icon: "TrendingUp" },
    { key: "sip_stopped", label: "SIP Stopped This Month", icon: "TrendingDown" },
    { key: "sip_expiring", label: "SIP Expiring Soon", icon: "Calendar" },
    { key: "sip_topup_opportunity", label: "SIP Top-Up Opportunity", icon: "TrendingUp" },
    { key: "sip_health", label: "SIP Health & Efforts", icon: "TrendingUp", href: "/dashboard/reports/sip-health" },
    { key: "rm_sip_book", label: "RM-wise SIP Book", icon: "Users" },
    { key: "sip_book_size", label: "SIP Book Size (branch-wise)", icon: "BarChart3", href: "/dashboard/reports/metric/sip-book" },
    { key: "sip_rejected", label: "SIP Rejected", icon: "AlertTriangle" },
    { key: "sip_recovery_monthly", label: "Monthly SIP Recovery", icon: "TrendingUp" },
  ]},
  { group: "Team & Branch", items: [
    { key: "rm_business", label: "RM-wise Business", icon: "Users" },
    { key: "rm_clients", label: "RM-wise Clients", icon: "Users" },
    { key: "rm_reviews", label: "RM-wise Reviews", icon: "Calendar" },
    { key: "rm_pending", label: "RM-wise Pending Work", icon: "AlertTriangle" },
    { key: "employee_tasks", label: "Employee-wise Tasks", icon: "Users" },
    { key: "branch_business", label: "Branch-wise Business", icon: "Briefcase" },
    { key: "aum_status", label: "AUM Status (branch-wise)", icon: "BarChart3", href: "/dashboard/reports/metric/aum" },
    { key: "team_productivity", label: "Team Productivity", icon: "Users" },
  ]},
  { group: "Branch & RM Business (Monthly)", items: [
    { key: "sif_status", label: "SIF Business — Target vs Actual", icon: "TrendingUp", href: "/dashboard/reports/sif-status" },
    { key: "branch_rm_sip", label: "SIP — Branch & RM-wise", icon: "TrendingUp", href: "/dashboard/reports/branch-rm/sip" },
    { key: "branch_rm_equity", label: "Equity Lumpsum — Branch & RM-wise", icon: "BarChart3", href: "/dashboard/reports/branch-rm/equity-lumpsum" },
    { key: "branch_rm_liquid", label: "Liquid Lumpsum — Branch & RM-wise", icon: "BarChart3", href: "/dashboard/reports/branch-rm/liquid-lumpsum" },
    { key: "branch_rm_insurance", label: "Insurance — Branch & RM-wise", icon: "ShieldCheck", href: "/dashboard/reports/branch-rm/insurance" },
    { key: "redemption_by_client", label: "Redemption by Client", icon: "TrendingDown", href: "/dashboard/reports/redemption" },
    { key: "sip_rejection", label: "SIP Rejection / Pending / Repurchase", icon: "AlertTriangle", href: "/dashboard/reports/sip-rejection" },
  ]},
  { group: "Lead Blueprint", items: [
    { key: "blueprint_drop_off", label: "Lead Drop-off Analysis", icon: "TrendingDown" },
    { key: "blueprint_lost_reasons", label: "Lead Loss Reasons", icon: "Filter" },
    { key: "blueprint_delayed_leads", label: "SLA-overdue Leads", icon: "AlertTriangle" },
    { key: "blueprint_pipeline_by_rm", label: "RM-wise Blueprint Pipeline", icon: "Users" },
  ]},
  { group: "Clients", items: [
    { key: "lead_conversion", label: "Lead Conversion", icon: "Filter" },
    { key: "review_pending", label: "Review Pending", icon: "Calendar" },
    { key: "service_pending", label: "Service Requests Pending", icon: "FileText" },
    { key: "segmentation", label: "Client Segmentation", icon: "Users" },
    { key: "high_aum", label: "High-AUM Clients", icon: "TrendingUp" },
    { key: "dormant", label: "Dormant Clients", icon: "AlertTriangle" },
  ]},
  { group: "Retention & Tax", items: [
    { key: "churn-risk", label: "Churn-risk radar", icon: "ShieldCheck" },
    { key: "tax-harvesting", label: "Tax-harvesting", icon: "TrendingUp" },
  ]},
  { group: "Complaint Register (SEBI)", items: [
    { key: "open_complaints", label: "Open Complaints", icon: "AlertTriangle" },
    { key: "resolved_complaints", label: "Resolved Complaints", icon: "CheckCircle2" },
    { key: "complaint_tat", label: "Complaint TAT Report", icon: "Clock" },
    { key: "complaint_category", label: "Complaint Category Report", icon: "Shield" },
  ]},
  { group: "Family Mapping", items: [
    { key: "family_aum", label: "Family-wise AUM", icon: "Users" },
    { key: "family_sip", label: "Family-wise SIP", icon: "TrendingUp" },
    { key: "unmapped_family_members", label: "Unmapped Family Members", icon: "AlertTriangle" },
    { key: "family_review_due", label: "Family Review Due", icon: "Calendar" },
    { key: "next_gen_prospects", label: "Next-Gen Prospect List", icon: "Users" },
  ]},
  { group: "Goal Planning", items: [
    { key: "goal_clients", label: "Goal-wise Clients", icon: "Users" },
    { key: "goals_behind", label: "Goals Behind Track", icon: "AlertTriangle" },
    { key: "goals_5yr", label: "Goals Due in Next 5 Years", icon: "Calendar" },
    { key: "retirement_clients", label: "Retirement Planning Clients", icon: "TrendingUp" },
    { key: "child_edu_clients", label: "Child Education Planning", icon: "Users" },
  ]},
  { group: "Marketing Campaigns", items: [
    { key: "campaign_leads", label: "Campaign-wise Leads", icon: "Users" },
    { key: "campaign_conversion", label: "Campaign-wise Conversion", icon: "TrendingUp" },
    { key: "marketing_calendar", label: "Monthly Marketing Calendar", icon: "Calendar" },
    { key: "pending_approval_content", label: "Pending Approval Content", icon: "FileText" },
    { key: "marketing-assets", label: "Marketing assets & trust builders", icon: "Megaphone" },
  ]},
  { group: "Insurance", items: [
    { key: "insurance_production", label: "Advisor Production (Personal + Commercial)", icon: "ShieldCheck", href: "/dashboard/reports/insurance-production" },
    { key: "insurance_claims", label: "Claims Summary", icon: "ShieldCheck", href: "/dashboard/reports/insurance-claims" },
  ]},
  { group: "Back Office (Monthly)", items: [
    { key: "bo_other_services", label: "Other Services (IIN/CAN/KYC…) by Branch", icon: "ListChecks", href: "/dashboard/reports/other-services" },
    { key: "bo_work", label: "Back-Office Work (Rectifications)", icon: "CheckCircle2", href: "/dashboard/reports/back-office-work" },
  ]},
  { group: "Compliance", items: [
    { key: "ddq_readiness", label: "DDQ Readiness", icon: "FileText", href: "/dashboard/compliance" },
    { key: "arn-euin-tracker", label: "ARN / EUIN / NISM / DSC tracker", icon: "Shield" },
    { key: "kyc-tracker", label: "Client KYC tracker", icon: "ShieldCheck" },
    { key: "shortlisted-schemes", label: "AMC scheme shortlist (IC)", icon: "Briefcase" },
    { key: "suitability-matrix", label: "MF suitability matrix (IC)", icon: "Filter" },
    { key: "mf-selection-criteria", label: "MF selection criteria (IC)", icon: "ListChecks" },
  ]},
  { group: "Practice & Finances", items: [
    { key: "business-projections", label: "Business projections (AUM & income)", icon: "TrendingUp" },
    { key: "financial-checklist", label: "Finance management checklist", icon: "CheckCircle2" },
  ]},
];

export const dynamic = "force-dynamic";

export default function ReportsPage() {
  const total = REPORTS.reduce((n, g) => n + g.items.length, 0);
  const sections = REPORTS.map((g) => ({
    group: g.group,
    items: g.items.map((i) => ({
      key: i.key,
      label: i.label,
      iconName: i.icon,
      href: i.href ?? `/dashboard/reports/${i.key}`,
    })),
  }));

  return (
    <div className="space-y-6 max-w-7xl">
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Reports &amp; MIS</h1>
          <p className="text-muted-foreground text-sm">
            {total} canned reports. Click to open with date-range + RM + branch filters. Hover a card and hit
            × to hide reports you don't use.
          </p>
        </div>
        <Link href="/dashboard/reports/custom" className="btn-primary whitespace-nowrap">
          <BarChart3 className="size-4" /> Custom Reports
        </Link>
      </div>

      <ReportsGrid sections={sections} />
    </div>
  );
}
