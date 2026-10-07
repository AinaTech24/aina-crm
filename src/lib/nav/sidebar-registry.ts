/**
 * Flat registry of every sidebar item (href + label + group), so platform
 * Module Controls can toggle ANY sidebar entry — including the ones that have no
 * package `module` key. Keep in sync with the NAV array in
 * `src/app/dashboard/layout.tsx` (same hrefs); a new nav item simply isn't
 * controllable here until it's added.
 *
 * Module Controls key on `href`; the dashboard layout filters / beta-tags its
 * NAV items by the same href.
 */
export type SidebarEntry = { group: string; href: string; label: string };

export const SIDEBAR_REGISTRY: SidebarEntry[] = [
  // Grouped like the ten-group sidebar. Entries that are not menu items (the
  // dashboard views, insurance and SIP tabs, the pages reached only through
  // Ctrl/Cmd+K) sit in the group they belong to. Disabling "/dashboard" hides
  // the Dashboard link for every tenant.
  // Home
  { group: "Home", href: "/dashboard", label: "Dashboard" },
  { group: "Home", href: "/dashboard/manage", label: "Manage dashboards" },
  { group: "Home", href: "/dashboard/team", label: "Team Dashboard" },
  { group: "Home", href: "/dashboard/team/scorecard", label: "Team Scorecard" },
  { group: "Home", href: "/dashboard/next-best-action", label: "Next Best Action" },
  // Work
  { group: "Work", href: "/dashboard/tasks", label: "Tasks" },
  { group: "Work", href: "/dashboard/tasks/daily", label: "Daily Tracker" },
  { group: "Work", href: "/dashboard/review-meetings", label: "Meetings" },
  { group: "Work", href: "/dashboard/calendar", label: "Calendar" },
  { group: "Work", href: "/dashboard/service-requests", label: "Service Requests" },
  // Clients
  { group: "Clients", href: "/dashboard/leads", label: "Leads" },
  { group: "Clients", href: "/dashboard/investors", label: "Clients" },
  { group: "Clients", href: "/dashboard/opportunities", label: "Opportunities" },
  { group: "Clients", href: "/dashboard/families", label: "Families" },
  { group: "Clients", href: "/dashboard/risk-profiles", label: "Risk Profiles" },
  { group: "Clients", href: "/dashboard/discovery", label: "Discovery (Fact-find)" },
  { group: "Clients", href: "/dashboard/support/feedback", label: "Client Feedback" },
  // Planning Tools (was "Advice" — renamed 2026-10-02: a distributor does not give advice)
  { group: "Planning Tools", href: "/dashboard/calculators", label: "Calculators" },
  { group: "Planning Tools", href: "/dashboard/goals", label: "Goals" },
  { group: "Planning Tools", href: "/dashboard/financial-plans", label: "Financial Health Check" },
  { group: "Planning Tools", href: "/dashboard/proposals", label: "Proposals" },
  { group: "Planning Tools", href: "/dashboard/insurance", label: "Insurance" },
  { group: "Planning Tools", href: "/dashboard/insurance-claims", label: "Insurance Claims" },
  { group: "Planning Tools", href: "/dashboard/insurance/renewals", label: "Insurance Renewals" },
  { group: "Planning Tools", href: "/dashboard/insurance/protection-gap", label: "Protection-Gap Radar" },
  { group: "Planning Tools", href: "/dashboard/insurance/commission", label: "Insurance Commission" },
  // Business
  { group: "Business", href: "/dashboard/sips", label: "SIP Book" },
  { group: "Business", href: "/dashboard/sip-rejections", label: "SIP Rejections" },
  { group: "Business", href: "/dashboard/sips/at-risk", label: "SIP At-Risk" },
  { group: "Business", href: "/dashboard/transactions", label: "MF Transactions" },
  { group: "Business", href: "/dashboard/business-entries", label: "Business Entries" },
  { group: "Business", href: "/dashboard/fixed-deposits", label: "Fixed Deposits" },
  { group: "Business", href: "/dashboard/expected-inflows", label: "Expected Inflows" },
  // Insights
  { group: "Insights", href: "/dashboard/reports", label: "Reports" },
  { group: "Insights", href: "/dashboard/reports/trail-forecast", label: "Trail Forecast" },
  { group: "Insights", href: "/dashboard/portfolio-intelligence", label: "Portfolio Insights" },
  { group: "Insights", href: "/dashboard/reports/churn-risk", label: "Churn-risk Radar" },
  { group: "Insights", href: "/dashboard/reports/tax-harvesting", label: "Tax-Harvesting" },
  { group: "Insights", href: "/dashboard/reports/cross-sell", label: "Cross-sell Radar" },
  { group: "Insights", href: "/dashboard/finances", label: "Practice Finances" },
  { group: "Insights", href: "/dashboard/ai-assistant", label: "Aina Copilot" },
  // Automation
  { group: "Automation", href: "/dashboard/workflows/rules", label: "Automations" },
  { group: "Automation", href: "/dashboard/workflows/actions", label: "Automation Actions" },
  { group: "Automation", href: "/dashboard/workflows/runs", label: "Automation Run History" },
  { group: "Automation", href: "/dashboard/templates", label: "Message Templates" },
  { group: "Automation", href: "/dashboard/campaigns", label: "Marketing Campaigns" },
  // In Settings → Connections, not the menu; kept here so its kill-switch stays.
  { group: "Automation", href: "/dashboard/communications", label: "Communications" },
  // Compliance
  { group: "Compliance", href: "/dashboard/documents", label: "Documents" },
  { group: "Compliance", href: "/dashboard/compliance", label: "DDQ Readiness" },
  { group: "Compliance", href: "/dashboard/reports/nomination-tracker", label: "Nomination Tracker" },
  { group: "Compliance", href: "/dashboard/sops", label: "SOP Library" },
  { group: "Compliance", href: "/dashboard/audit-log", label: "Audit Log" },
  { group: "Compliance", href: "/dashboard/legal-registrations", label: "Legal Registrations" },
  { group: "Compliance", href: "/dashboard/sub-distributors", label: "Sub-Distributors" },
  // Team
  { group: "Team", href: "/dashboard/employees", label: "Team Members" },
  { group: "Team", href: "/dashboard/attendance", label: "Attendance" },
  { group: "Team", href: "/dashboard/leave-applications", label: "Leave" },
  { group: "Team", href: "/dashboard/induction", label: "Induction" },
  { group: "Team", href: "/dashboard/announcements", label: "Announcements" },
  // Data & Admin
  { group: "Data & Admin", href: "/dashboard/rta-imports", label: "RTA File Imports" },
  { group: "Data & Admin", href: "/dashboard/reconciliation", label: "Holdings Reconciliation" },
  { group: "Data & Admin", href: "/dashboard/commission-reconciliation", label: "Brokerage Reconciliation" },
  { group: "Data & Admin", href: "/dashboard/schemes", label: "Scheme Master" },
  { group: "Data & Admin", href: "/dashboard/amc-empanelments", label: "AMC Empanelments" },
  { group: "Data & Admin", href: "/dashboard/duplicates", label: "Find Duplicates" },
  { group: "Data & Admin", href: "/dashboard/activities", label: "Activity Log" },
  { group: "Data & Admin", href: "/dashboard/product-offerings", label: "Products & Services" },
  { group: "Data & Admin", href: "/dashboard/merge-clients", label: "Merge Clients" },
  { group: "Data & Admin", href: "/dashboard/trash", label: "Trash" },
];
