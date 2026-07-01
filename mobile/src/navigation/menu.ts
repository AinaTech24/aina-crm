/**
 * The drawer ("sidebar") information architecture, as data.
 *
 * Bottom tabs (Home · Search · Tasks · Firm Profile · Settings) are defined in
 * the tab layout. EVERY OTHER module lives here, grouped, and is shown only if
 * the user holds one of `anyCap` (mirrors the server's `can()` matrix). `route`
 * points at the module's stack; during Phase A these resolve to the `/m/[module]`
 * placeholder and get swapped for real screens as each module ships.
 */

import { type ComponentProps } from "react";
import { Feather } from "@expo/vector-icons";

type FeatherName = ComponentProps<typeof Feather>["name"];

export interface MenuItem {
  key: string;
  label: string;
  icon: FeatherName;
  route: string;
  /** Visible if the user has ANY of these caps. Empty = always visible. */
  anyCap?: string[];
}

export interface MenuGroup {
  title: string;
  items: MenuItem[];
}

export const MENU: MenuGroup[] = [
  {
    title: "Clients",
    items: [
      { key: "investors", label: "Investors", icon: "users", route: "/m/investors", anyCap: ["investor.view.all", "investor.view.assigned"] },
      { key: "families", label: "Families", icon: "home", route: "/m/families", anyCap: ["investor.view.all", "investor.view.assigned"] },
      { key: "referrals", label: "Referrals", icon: "share-2", route: "/m/referrals" },
      { key: "duplicates", label: "Duplicates", icon: "copy", route: "/m/duplicates", anyCap: ["investor.edit.all"] },
    ],
  },
  {
    title: "Pipeline",
    items: [
      { key: "leads", label: "Leads", icon: "trending-up", route: "/m/leads", anyCap: ["lead.view.all", "lead.view.assigned"] },
      { key: "activities", label: "Activities", icon: "phone-call", route: "/m/activities" },
      { key: "discovery", label: "Discovery", icon: "compass", route: "/m/discovery" },
      { key: "campaigns", label: "Campaigns", icon: "send", route: "/m/campaigns", anyCap: ["campaign.send", "segments.view"] },
    ],
  },
  {
    title: "Planning",
    items: [
      { key: "financial-plans", label: "Financial Plans", icon: "clipboard", route: "/m/financial-plans", anyCap: ["financial_plan.view"] },
      { key: "goals", label: "Goals", icon: "target", route: "/m/goals", anyCap: ["goal.manage"] },
      { key: "risk-profiles", label: "Risk Profiles", icon: "activity", route: "/m/risk-profiles", anyCap: ["risk_profile.manage"] },
      { key: "proposals", label: "Proposals", icon: "file-text", route: "/m/proposals", anyCap: ["proposal.view"] },
      { key: "calculators", label: "Calculators", icon: "percent", route: "/m/calculators" },
    ],
  },
  {
    title: "Investments",
    items: [
      { key: "sips", label: "SIPs", icon: "repeat", route: "/m/sips", anyCap: ["transactions.view"] },
      { key: "sip-rejections", label: "SIP Rejections", icon: "x-circle", route: "/m/sip-rejections", anyCap: ["transactions.view"] },
      { key: "equity", label: "Equity", icon: "bar-chart-2", route: "/m/equity", anyCap: ["transactions.view"] },
      { key: "transactions", label: "Transactions", icon: "list", route: "/m/transactions", anyCap: ["transactions.view"] },
      { key: "portfolio-intelligence", label: "Portfolio Intelligence", icon: "pie-chart", route: "/m/portfolio-intelligence", anyCap: ["transactions.view"] },
      { key: "schemes", label: "Schemes", icon: "book-open", route: "/m/schemes" },
    ],
  },
  {
    title: "Insurance",
    items: [
      { key: "insurance", label: "Policies", icon: "shield", route: "/m/insurance", anyCap: ["insurance.view"] },
      { key: "insurance-claims", label: "Claims", icon: "shield-off", route: "/m/insurance-claims", anyCap: ["insurance.view"] },
    ],
  },
  {
    title: "Servicing",
    items: [
      { key: "review-meetings", label: "Review Meetings", icon: "calendar", route: "/m/review-meetings", anyCap: ["review_meeting.manage.all", "review_meeting.manage.assigned"] },
      { key: "service-requests", label: "Service Requests", icon: "headphones", route: "/m/service-requests", anyCap: ["service_request.view.all", "service_request.view.assigned"] },
      { key: "complaints", label: "Complaints", icon: "alert-octagon", route: "/m/complaints", anyCap: ["complaint.manage"] },
      { key: "communications", label: "Communications", icon: "message-circle", route: "/m/communications", anyCap: ["communication.send"] },
      { key: "documents", label: "Documents", icon: "folder", route: "/m/documents", anyCap: ["document.view"] },
    ],
  },
  {
    title: "Insights",
    items: [
      { key: "reports", label: "Reports", icon: "file-text", route: "/m/reports", anyCap: ["reports.business", "reports.team", "reports.commission"] },
      { key: "command-center", label: "Command Center", icon: "grid", route: "/m/command-center", anyCap: ["dashboard.view.owner", "dashboard.view.compliance", "dashboard.view.ops"] },
    ],
  },
  {
    title: "Compliance",
    items: [
      { key: "compliance", label: "Compliance", icon: "check-circle", route: "/m/compliance", anyCap: ["compliance.view"] },
      { key: "audit-log", label: "Audit Log", icon: "shield", route: "/m/audit-log", anyCap: ["compliance.view"] },
      { key: "sops", label: "SOPs", icon: "book", route: "/m/sops", anyCap: ["sop.manage"] },
      { key: "legal-registrations", label: "Legal Registrations", icon: "award", route: "/m/legal-registrations", anyCap: ["compliance.view"] },
    ],
  },
  {
    title: "Operations",
    items: [
      { key: "rta-imports", label: "RTA Imports", icon: "download-cloud", route: "/m/rta-imports", anyCap: ["transactions.view"] },
      { key: "reconciliation", label: "Reconciliation", icon: "git-merge", route: "/m/reconciliation", anyCap: ["transactions.view"] },
      { key: "commission-reconciliation", label: "Commission Recon", icon: "dollar-sign", route: "/m/commission-reconciliation", anyCap: ["reports.commission"] },
      { key: "business-entries", label: "Business Entries", icon: "edit-3", route: "/m/business-entries", anyCap: ["transactions.execute"] },
    ],
  },
  {
    title: "Marketing",
    items: [
      { key: "templates", label: "Templates", icon: "layout", route: "/m/templates", anyCap: ["template.view"] },
      { key: "content-library", label: "Content Library", icon: "image", route: "/m/content-library", anyCap: ["template.view", "segments.view"] },
      { key: "announcements", label: "Announcements", icon: "volume-2", route: "/m/announcements" },
      { key: "product-offerings", label: "Product Offerings", icon: "box", route: "/m/product-offerings" },
    ],
  },
  {
    title: "Automation",
    items: [
      { key: "workflows", label: "Workflows", icon: "zap", route: "/m/workflows", anyCap: ["workflow.view"] },
    ],
  },
  {
    title: "Team & HR",
    items: [
      { key: "team", label: "Team", icon: "users", route: "/m/team", anyCap: ["reports.team"] },
      { key: "employees", label: "Employees", icon: "user-check", route: "/m/employees", anyCap: ["settings.users"] },
      { key: "attendance", label: "Attendance", icon: "clock", route: "/m/attendance" },
      { key: "leave-applications", label: "Leave", icon: "calendar", route: "/m/leave-applications" },
    ],
  },
  {
    title: "Finance",
    items: [
      { key: "finances", label: "Finances", icon: "trending-up", route: "/m/finances", anyCap: ["finances.view"] },
      { key: "billing", label: "Billing", icon: "credit-card", route: "/m/billing", anyCap: ["settings.billing"] },
      { key: "sub-distributors", label: "Sub-Distributors", icon: "git-branch", route: "/m/sub-distributors" },
    ],
  },
  {
    title: "Help",
    items: [
      { key: "help", label: "Help & FAQ", icon: "help-circle", route: "/m/help" },
      { key: "support", label: "Support", icon: "life-buoy", route: "/m/support" },
      { key: "trash", label: "Trash", icon: "trash-2", route: "/m/trash" },
    ],
  },
];
