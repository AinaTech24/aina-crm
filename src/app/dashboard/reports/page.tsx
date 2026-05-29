import Link from "next/link";
import { BarChart3, TrendingUp, TrendingDown, Users, Filter, AlertTriangle, FileText, Calendar, Briefcase, Shield, ShieldCheck, Clock, CheckCircle2 } from "lucide-react";

const REPORTS = [
  { group: "Sales & Business", items: [
    { key: "daily_sip_added", label: "Daily SIP Added", icon: TrendingUp },
    { key: "daily_lumpsum", label: "Daily Purchase", icon: TrendingUp },
    { key: "redemption", label: "Daily Redemption", icon: TrendingDown },
    { key: "net_sales", label: "Net Business", icon: BarChart3 },
    { key: "amc_business", label: "AMC-wise Business", icon: BarChart3 },
    { key: "scheme_category_business", label: "Scheme Category-wise", icon: BarChart3 },
    { key: "aum_movement", label: "AUM Movement", icon: BarChart3 },
  ]},
  { group: "SIP Tracker", items: [
    { key: "active_sip_book", label: "Active SIP Book", icon: BarChart3 },
    { key: "sip_added_mtd", label: "SIP Added This Month", icon: TrendingUp },
    { key: "sip_stopped", label: "SIP Stopped This Month", icon: TrendingDown },
    { key: "sip_expiring", label: "SIP Expiring Soon", icon: Calendar },
    { key: "sip_topup_opportunity", label: "SIP Top-Up Opportunity", icon: TrendingUp },
    { key: "rm_sip_book", label: "RM-wise SIP Book", icon: Users },
    { key: "sip_rejected", label: "SIP Rejected", icon: AlertTriangle },
    { key: "sip_recovery_monthly", label: "Monthly SIP Recovery", icon: TrendingUp },
  ]},
  { group: "Team & Branch", items: [
    { key: "rm_business", label: "RM-wise Business", icon: Users },
    { key: "rm_clients", label: "RM-wise Clients", icon: Users },
    { key: "rm_reviews", label: "RM-wise Reviews", icon: Calendar },
    { key: "rm_pending", label: "RM-wise Pending Work", icon: AlertTriangle },
    { key: "employee_tasks", label: "Employee-wise Tasks", icon: Users },
    { key: "branch_business", label: "Branch-wise Business", icon: Briefcase },
    { key: "team_productivity", label: "Team Productivity", icon: Users },
  ]},
  { group: "Lead Blueprint", items: [
    { key: "blueprint_drop_off", label: "Lead Drop-off Analysis", icon: TrendingDown },
    { key: "blueprint_delayed_leads", label: "SLA-overdue Leads", icon: AlertTriangle },
    { key: "blueprint_pipeline_by_rm", label: "RM-wise Blueprint Pipeline", icon: Users },
  ]},
  { group: "Clients", items: [
    { key: "lead_conversion", label: "Lead Conversion", icon: Filter },
    { key: "review_pending", label: "Review Pending", icon: Calendar },
    { key: "service_pending", label: "Service Requests Pending", icon: FileText },
    { key: "segmentation", label: "Client Segmentation", icon: Users },
    { key: "high_aum", label: "High-AUM Clients", icon: TrendingUp },
    { key: "dormant", label: "Dormant Clients", icon: AlertTriangle },
  ]},
  { group: "Complaint Register (SEBI)", items: [
    { key: "open_complaints", label: "Open Complaints", icon: AlertTriangle },
    { key: "resolved_complaints", label: "Resolved Complaints", icon: CheckCircle2 },
    { key: "complaint_tat", label: "Complaint TAT Report", icon: Clock },
    { key: "complaint_category", label: "Complaint Category Report", icon: Shield },
  ]},
  { group: "Family Mapping", items: [
    { key: "family_aum", label: "Family-wise AUM", icon: Users },
    { key: "family_sip", label: "Family-wise SIP", icon: TrendingUp },
    { key: "unmapped_family_members", label: "Unmapped Family Members", icon: AlertTriangle },
    { key: "family_review_due", label: "Family Review Due", icon: Calendar },
    { key: "next_gen_prospects", label: "Next-Gen Prospect List", icon: Users },
  ]},
  { group: "Goal Planning", items: [
    { key: "goal_clients", label: "Goal-wise Clients", icon: Users },
    { key: "goals_behind", label: "Goals Behind Track", icon: AlertTriangle },
    { key: "goals_5yr", label: "Goals Due in Next 5 Years", icon: Calendar },
    { key: "retirement_clients", label: "Retirement Planning Clients", icon: TrendingUp },
    { key: "child_edu_clients", label: "Child Education Planning", icon: Users },
  ]},
  { group: "Marketing Campaigns", items: [
    { key: "campaign_leads", label: "Campaign-wise Leads", icon: Users },
    { key: "campaign_conversion", label: "Campaign-wise Conversion", icon: TrendingUp },
    { key: "marketing_calendar", label: "Monthly Marketing Calendar", icon: Calendar },
    { key: "pending_approval_content", label: "Pending Approval Content", icon: FileText },
  ]},
  { group: "Compliance", items: [
    { key: "ddq_readiness", label: "DDQ Readiness", icon: FileText },
    { key: "arn-euin-tracker", label: "ARN / EUIN / NISM / DSC tracker", icon: Shield },
    { key: "kyc-tracker", label: "Client KYC tracker", icon: ShieldCheck },
    { key: "shortlisted-schemes", label: "AMC scheme shortlist (IC)", icon: Briefcase },
    { key: "suitability-matrix", label: "MF suitability matrix (IC)", icon: Filter },
  ]},
];

export const dynamic = "force-dynamic";

export default function ReportsPage() {
  return (
    <div className="space-y-6 max-w-7xl">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Reports & MIS</h1>
        <p className="text-muted-foreground text-sm">
          {REPORTS.reduce((n, g) => n + g.items.length, 0)} canned reports. Click to open with
          date-range + RM + branch filters.
        </p>
      </div>

      {REPORTS.map((g) => (
        <section key={g.group}>
          <h2 className="font-semibold text-sm uppercase tracking-wide text-muted-foreground mb-2">{g.group}</h2>
          <div className="grid grid-cols-4 gap-3">
            {g.items.map((r) => {
              const Icon = r.icon;
              return (
                <Link
                  key={r.key}
                  href={`/dashboard/reports/${r.key}`}
                  className="border rounded-lg p-4 bg-card hover:bg-accent/40 transition-colors"
                >
                  <Icon className="size-4 text-muted-foreground" />
                  <div className="mt-2 font-medium text-sm">{r.label}</div>
                </Link>
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
}
