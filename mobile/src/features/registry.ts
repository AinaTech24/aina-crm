/**
 * Module registry — the config that drives the generic /m/[module] list + detail
 * screens. Each entry maps a module to its endpoint, how a row renders as a card,
 * and how the record renders as a detail. Adding a simple list+detail module is a
 * single entry here — no new screen files.
 *
 * Modules with bespoke behaviour (Investors 360, Leads board+convert, Tasks
 * complete, etc.) have their own folders and are NOT in this registry.
 */

import { inr, inrFull, titleCase, fmtDate, timeAgo } from "../lib/format";
import type { Tone } from "../theme";
import {
  campaignStatusBadge,
  proposalStatusBadge,
  insuranceStatusBadge,
  srStatusBadge,
  type Badge,
} from "../lib/status";

type FeatherName = string;

export interface CardProps {
  icon: FeatherName;
  iconTone?: "brand" | "violet" | "success" | "warning" | "danger" | "info";
  title: string;
  subtitle?: string;
  badge?: Badge;
  badge2?: Badge;
  rightLabel?: string;
  rightValue?: string;
}

export interface DetailSpec {
  subtitle?: string;
  heroLabel?: string;
  heroValue?: string;
  badges?: { label: string; tone: Tone; dot?: boolean }[];
  fields?: { label: string; value?: string | null }[];
  sections?: { title: string; body?: string | null }[];
}

export interface ModuleConfig {
  title: string;
  endpoint: string;
  envelope: string;
  detailEnvelope?: string;
  unit?: [string, string];
  chips?: { key: string; label: string }[];
  card: (item: any) => CardProps;
  detail: (item: any) => DetailSpec;
  searchPlaceholder?: string;
  emptyIcon?: FeatherName;
  emptyTitle?: string;
  emptyMessage?: string;
}

/** Best-effort status → tone for modules without a bespoke status map. */
const gStatus = (v?: string | null): Badge => {
  const s = (v ?? "").toLowerCase();
  if (!s) return { label: "—", tone: "neutral" };
  let tone: Tone = "neutral";
  if (/(active|approved|completed|settled|recovered|resolved|published|verified|empanelled|onboarded|success|final)/.test(s)) tone = "success";
  else if (/(pending|draft|scheduled|awaiting|in_progress|processing|submitted|underwriting|open)/.test(s)) tone = "info";
  else if (/(rejected|lapsed|expired|terminated|failed|cancelled|escalated|overdue|red)/.test(s)) tone = "danger";
  else if (/(warning|hold|paused|watch|amber|renewal)/.test(s)) tone = "warning";
  return { label: titleCase(v), tone };
};

const riskTone = (c?: string): Tone => {
  const s = (c ?? "").toLowerCase();
  if (s.includes("aggressive") || s.includes("high")) return "danger";
  if (s.includes("moderate") || s.includes("balanced")) return "warning";
  if (s.includes("conservative") || s.includes("low")) return "success";
  return "info";
};

export const REGISTRY: Record<string, ModuleConfig> = {
  campaigns: {
    title: "Campaigns",
    endpoint: "/api/campaigns",
    envelope: "campaigns",
    unit: ["campaign", "campaigns"],
    chips: [
      { key: "", label: "All" },
      { key: "draft", label: "Draft" },
      { key: "scheduled", label: "Scheduled" },
      { key: "sending", label: "Sending" },
      { key: "sent", label: "Sent" },
    ],
    searchPlaceholder: "Search campaigns…",
    emptyIcon: "send",
    emptyTitle: "No campaigns",
    card: (c) => ({
      icon: "send",
      title: c.name ?? "Campaign",
      subtitle: `${titleCase(c.channel)} · ${titleCase(c.kind)}`,
      badge: campaignStatusBadge(c.status),
    }),
    detail: (c) => ({
      badges: [campaignStatusBadge(c.status)],
      fields: [
        { label: "Channel", value: titleCase(c.channel) },
        { label: "Kind", value: titleCase(c.kind) },
        { label: "Theme", value: titleCase(c.theme) },
        { label: "Recurrence", value: titleCase(c.recurrence) },
        { label: "A/B split", value: c.abSplitPct != null ? `${c.abSplitPct}%` : "—" },
      ],
      sections: [{ title: "DESCRIPTION", body: c.description }],
    }),
  },

  proposals: {
    title: "Proposals",
    endpoint: "/api/proposals",
    envelope: "proposals",
    detailEnvelope: "proposal",
    unit: ["proposal", "proposals"],
    chips: [
      { key: "", label: "All" },
      { key: "draft", label: "Draft" },
      { key: "sent", label: "Sent" },
      { key: "accepted", label: "Accepted" },
      { key: "rejected", label: "Rejected" },
    ],
    searchPlaceholder: "Search proposals…",
    emptyIcon: "file-text",
    emptyTitle: "No proposals",
    card: (p) => ({
      icon: "file-text",
      title: p.title ?? p.proposalNumber ?? "Proposal",
      subtitle: `${p.recipientName ?? ""} · ${titleCase(p.type)}`,
      badge: proposalStatusBadge(p.status),
      rightLabel: "Investment",
      rightValue: inr(p.totalInvestment),
    }),
    detail: (p) => ({
      subtitle: p.proposalNumber,
      heroLabel: "TOTAL INVESTMENT",
      heroValue: inrFull(p.totalInvestment),
      badges: [proposalStatusBadge(p.status), ...(p.riskRating ? [{ label: titleCase(p.riskRating), tone: riskTone(p.riskRating), dot: false }] : [])],
      fields: [
        { label: "Proposal #", value: p.proposalNumber },
        { label: "Recipient", value: p.recipientName },
        { label: "Type", value: titleCase(p.type) },
        { label: "Expected corpus", value: inr(p.expectedCorpus) },
        { label: "Valid until", value: fmtDate(p.validUntil) },
        { label: "Sent", value: fmtDate(p.sentAt) },
        { label: "Accepted", value: fmtDate(p.acceptedAt) },
      ],
      sections: [
        { title: "SUMMARY", body: p.summary },
        { title: "COVER LETTER", body: p.coverLetter },
      ],
    }),
  },

  goals: {
    title: "Goals",
    endpoint: "/api/goals",
    envelope: "goals",
    unit: ["goal", "goals"],
    searchPlaceholder: "Search goals…",
    emptyIcon: "target",
    emptyTitle: "No goals",
    card: (g) => ({
      icon: "target",
      iconTone: "violet",
      title: g.name ?? "Goal",
      subtitle: `${titleCase(g.category)}${g.targetDate ? ` · ${fmtDate(g.targetDate)}` : ""}`,
      badge: { label: `${Math.round(g.progressPct ?? 0)}%`, tone: (g.progressPct ?? 0) >= 100 ? "success" : "info" },
      rightLabel: "Target",
      rightValue: inr(g.targetAmount),
    }),
    detail: (g) => ({
      heroLabel: "TARGET",
      heroValue: inrFull(g.targetAmount),
      badges: [{ label: `${Math.round(g.progressPct ?? 0)}% funded`, tone: (g.progressPct ?? 0) >= 100 ? "success" : "info" }],
      fields: [
        { label: "Category", value: titleCase(g.category) },
        { label: "Target date", value: fmtDate(g.targetDate) },
        { label: "Current value", value: inr(g.currentValue) },
        { label: "Monthly contribution", value: inr(g.monthlyContribution) },
        { label: "Required monthly SIP", value: inr(g.requiredMonthlySip) },
        { label: "Gap", value: inr(g.gapAmount) },
        { label: "Next review", value: fmtDate(g.nextReviewAt) },
      ],
      sections: [{ title: "REMARKS", body: g.remarks }],
    }),
  },

  "financial-plans": {
    title: "Financial Plans",
    endpoint: "/api/financial-plans",
    envelope: "plans",
    detailEnvelope: "plan",
    unit: ["plan", "plans"],
    searchPlaceholder: "Search plans…",
    emptyIcon: "clipboard",
    emptyTitle: "No financial plans",
    card: (p) => ({
      icon: "clipboard",
      title: p.planNumber ? `Plan ${p.planNumber}` : "Financial Plan",
      subtitle: titleCase(p.riskProfile),
      badge: { label: titleCase(p.status) || "Draft", tone: p.status === "final" ? "success" : "info" },
      rightLabel: "Income",
      rightValue: inr(p.monthlyIncome),
    }),
    detail: (p) => ({
      subtitle: p.planNumber ? `Plan ${p.planNumber}` : undefined,
      badges: [{ label: titleCase(p.status) || "Draft", tone: p.status === "final" ? "success" : "info" }],
      fields: [
        { label: "Client age", value: p.clientAge != null ? String(p.clientAge) : "—" },
        { label: "Monthly income", value: inr(p.monthlyIncome) },
        { label: "Monthly expenses", value: inr(p.monthlyExpenses) },
        { label: "Savings rate", value: p.savingsRate != null ? `${p.savingsRate}%` : "—" },
        { label: "Risk profile", value: titleCase(p.riskProfile) },
        { label: "Equity %", value: p.recommendedEquityPct != null ? `${p.recommendedEquityPct}%` : "—" },
        { label: "Debt %", value: p.recommendedDebtPct != null ? `${p.recommendedDebtPct}%` : "—" },
        { label: "Prepared", value: fmtDate(p.preparedAt) },
      ],
      sections: [{ title: "NOTES", body: p.notes }],
    }),
  },

  insurance: {
    title: "Insurance",
    endpoint: "/api/insurance",
    envelope: "policies",
    detailEnvelope: "policy",
    unit: ["policy", "policies"],
    chips: [
      { key: "", label: "All" },
      { key: "active", label: "Active" },
      { key: "proposed", label: "Proposed" },
      { key: "lapsed", label: "Lapsed" },
      { key: "matured", label: "Matured" },
    ],
    searchPlaceholder: "Search policies…",
    emptyIcon: "shield",
    emptyTitle: "No policies",
    card: (p) => ({
      icon: "shield",
      title: p.planName ?? titleCase(p.policyType) ?? "Policy",
      subtitle: `${p.insurer ?? ""}${p.policyNumber ? ` · ${p.policyNumber}` : ""}`,
      badge: insuranceStatusBadge(p.status),
      rightLabel: "Sum assured",
      rightValue: inr(p.sumAssured),
    }),
    detail: (p) => ({
      subtitle: p.policyNumber,
      heroLabel: "SUM ASSURED",
      heroValue: inrFull(p.sumAssured),
      badges: [insuranceStatusBadge(p.status), ...(p.policyType ? [{ label: titleCase(p.policyType), tone: "neutral" as const, dot: false }] : [])],
      fields: [
        { label: "Policy #", value: p.policyNumber },
        { label: "Insurer", value: p.insurer },
        { label: "Plan", value: p.planName },
        { label: "Annual premium", value: inr(p.annualPremium) },
        { label: "Premium frequency", value: titleCase(p.premiumFrequency) },
        { label: "Start", value: fmtDate(p.policyStartDate) },
        { label: "Maturity", value: fmtDate(p.maturityDate) },
        { label: "Next premium", value: fmtDate(p.nextPremiumDueDate) },
        { label: "Nominee", value: p.nomineeName },
      ],
      sections: [{ title: "REMARKS", body: p.remarks }],
    }),
  },

  "risk-profiles": {
    title: "Risk Profiles",
    endpoint: "/api/risk-profiles",
    envelope: "profiles",
    unit: ["profile", "profiles"],
    searchPlaceholder: "Search profiles…",
    emptyIcon: "activity",
    emptyTitle: "No risk profiles",
    card: (r) => ({
      icon: "activity",
      title: titleCase(r.finalCategory) || "Risk Profile",
      subtitle: `Score ${r.totalScore ?? "—"}${r.profileDate ? ` · ${fmtDate(r.profileDate)}` : ""}`,
      badge: { label: titleCase(r.finalCategory) || "—", tone: riskTone(r.finalCategory) },
    }),
    detail: (r) => ({
      badges: [{ label: titleCase(r.finalCategory) || "—", tone: riskTone(r.finalCategory) }],
      fields: [
        { label: "Total score", value: r.totalScore != null ? String(r.totalScore) : "—" },
        { label: "Profile date", value: fmtDate(r.profileDate) },
        { label: "Horizon", value: titleCase(r.investmentHorizon) },
        { label: "Risk capacity", value: titleCase(r.riskCapacity) },
        { label: "Risk tolerance", value: titleCase(r.riskTolerance) },
        { label: "Objective", value: titleCase(r.investmentObjective) },
        { label: "Next review", value: fmtDate(r.nextReviewAt) },
      ],
      sections: [{ title: "RM REMARKS", body: r.rmRemarks }],
    }),
  },

  activities: {
    title: "Activities",
    endpoint: "/api/activities",
    envelope: "activities",
    unit: ["activity", "activities"],
    chips: [
      { key: "", label: "All" },
      { key: "call", label: "Calls" },
      { key: "visit", label: "Visits" },
      { key: "note", label: "Notes" },
    ],
    searchPlaceholder: "Search activities…",
    emptyIcon: "phone-call",
    emptyTitle: "No activities",
    card: (a) => ({
      icon: a.kind === "visit" ? "map-pin" : a.kind === "note" ? "edit-3" : "phone",
      title: a.subject ?? titleCase(a.kind) ?? "Activity",
      subtitle: `${a.subjectName ?? ""}${a.occurredAt ? ` · ${timeAgo(a.occurredAt)}` : ""}`,
      badge: a.status ? { label: titleCase(a.status), tone: "neutral" } : undefined,
    }),
    detail: (a) => ({
      badges: a.status ? [{ label: titleCase(a.status), tone: "neutral" }] : [],
      fields: [
        { label: "Kind", value: titleCase(a.kind) },
        { label: "Direction", value: titleCase(a.direction) },
        { label: "Client / Lead", value: a.subjectName },
        { label: "Occurred", value: fmtDate(a.occurredAt) },
        { label: "Duration", value: a.durationSec ? `${Math.round(a.durationSec / 60)} min` : "—" },
      ],
      sections: [{ title: "NOTES", body: a.notes }],
    }),
  },

  schemes: {
    title: "Schemes",
    endpoint: "/api/schemes",
    envelope: "schemes",
    unit: ["scheme", "schemes"],
    searchPlaceholder: "Search schemes…",
    emptyIcon: "book-open",
    emptyTitle: "No schemes",
    card: (s) => ({
      icon: "book-open",
      title: s.schemeName ?? s.name ?? "Scheme",
      subtitle: `${s.fundHouse ?? s.amc ?? ""}${s.category ? ` · ${s.category}` : ""}`,
    }),
    detail: (s) => ({
      fields: [
        { label: "Fund house", value: s.fundHouse ?? s.amc },
        { label: "Category", value: s.category },
        { label: "Sub-category", value: s.subCategory },
        { label: "ISIN", value: s.isin },
      ],
    }),
  },

  equity: {
    title: "Equity",
    endpoint: "/api/equity/dmat",
    envelope: "accounts",
    unit: ["account", "accounts"],
    searchPlaceholder: "Search DMAT…",
    emptyIcon: "bar-chart-2",
    emptyTitle: "No DMAT accounts",
    card: (a) => ({
      icon: "bar-chart-2",
      title: a.brokerName ?? a.dpName ?? "DMAT Account",
      subtitle: a.clientId ?? a.dpId ?? a.demateAccountNo ?? "",
    }),
    detail: (a) => ({
      fields: [
        { label: "Broker", value: a.brokerName ?? a.dpName },
        { label: "Client ID", value: a.clientId },
        { label: "DP ID", value: a.dpId },
      ],
    }),
  },

  discovery: {
    title: "Discovery",
    endpoint: "/api/discovery",
    envelope: "discoveries",
    unit: ["discovery", "discoveries"],
    searchPlaceholder: "Search…",
    emptyIcon: "compass",
    emptyTitle: "No discovery sessions",
    card: (d) => ({
      icon: "compass",
      title: d.clientName ?? d.name ?? d.title ?? "Discovery",
      subtitle: d.status ? titleCase(d.status) : d.createdAt ? timeAgo(d.createdAt) : "",
      badge: d.status ? { label: titleCase(d.status), tone: "info" } : undefined,
    }),
    detail: (d) => ({
      badges: d.status ? [{ label: titleCase(d.status), tone: "info" }] : [],
      fields: [
        { label: "Client", value: d.clientName ?? d.name },
        { label: "Status", value: titleCase(d.status) },
        { label: "Created", value: fmtDate(d.createdAt) },
      ],
      sections: [{ title: "NOTES", body: d.notes }],
    }),
  },

  "sip-rejections": {
    title: "SIP Rejections",
    endpoint: "/api/sip-rejections",
    envelope: "rejections",
    unit: ["rejection", "rejections"],
    searchPlaceholder: "Search scheme, folio…",
    emptyIcon: "x-circle",
    emptyTitle: "No SIP rejections",
    card: (r) => ({
      icon: "x-circle",
      iconTone: "danger",
      title: r.schemeName ?? "SIP Rejection",
      subtitle: `${r.amcName ?? ""}${r.rejectionDate ? ` · ${fmtDate(r.rejectionDate)}` : ""}`,
      badge: gStatus(r.recoveryStatus),
      rightLabel: "Amount",
      rightValue: inr(r.rejectionAmount),
    }),
    detail: (r) => ({
      heroLabel: "REJECTED AMOUNT",
      heroValue: inrFull(r.rejectionAmount),
      badges: [gStatus(r.recoveryStatus)],
      fields: [
        { label: "Scheme", value: r.schemeName },
        { label: "AMC", value: r.amcName },
        { label: "Folio", value: r.folioNumber },
        { label: "Rejection date", value: fmtDate(r.rejectionDate) },
        { label: "Reason", value: titleCase(r.reasonCategory) },
        { label: "Follow-up", value: fmtDate(r.followUpDate) },
        { label: "Recovered", value: fmtDate(r.recoveryDate) },
      ],
      sections: [{ title: "REJECTION REASON", body: r.rejectionReason }, { title: "REMARKS", body: r.remarks }],
    }),
  },

  employees: {
    title: "Employees",
    endpoint: "/api/employees",
    envelope: "rows",
    unit: ["employee", "employees"],
    searchPlaceholder: "Search team…",
    emptyIcon: "user-check",
    emptyTitle: "No employees",
    card: (e) => ({
      icon: "user-check",
      title: e.name ?? "Employee",
      subtitle: `${titleCase(e.department)}${Array.isArray(e.roles) ? ` · ${e.roles.map(titleCase).join(", ")}` : ""}`,
    }),
    detail: (e) => ({
      fields: [
        { label: "Email", value: e.email },
        { label: "Department", value: titleCase(e.department) },
        { label: "Roles", value: Array.isArray(e.roles) ? e.roles.map(titleCase).join(", ") : titleCase(e.roles) },
        { label: "Status", value: titleCase(e.status) },
        { label: "Phone", value: e.phone },
      ],
    }),
  },

  "rta-imports": {
    title: "RTA Imports",
    endpoint: "/api/rta-imports",
    envelope: "rows",
    unit: ["import", "imports"],
    chips: [
      { key: "", label: "All" },
      { key: "parsed", label: "Parsed" },
      { key: "imported", label: "Imported" },
      { key: "failed", label: "Failed" },
    ],
    searchPlaceholder: "Search files…",
    emptyIcon: "download-cloud",
    emptyTitle: "No imports",
    card: (r) => ({
      icon: "download-cloud",
      title: r.file_name ?? "Import",
      subtitle: `${titleCase(r.source)} · ${titleCase(r.kind)}`,
      badge: gStatus(r.status),
      rightLabel: "Imported",
      rightValue: r.rows_imported != null ? String(r.rows_imported) : undefined,
    }),
    detail: (r) => ({
      badges: [gStatus(r.status)],
      fields: [
        { label: "Source", value: titleCase(r.source) },
        { label: "Kind", value: titleCase(r.kind) },
        { label: "Period", value: `${fmtDate(r.period_start)} – ${fmtDate(r.period_end)}` },
        { label: "Rows total", value: r.rows_total != null ? String(r.rows_total) : "—" },
        { label: "Imported", value: r.rows_imported != null ? String(r.rows_imported) : "—" },
        { label: "Skipped", value: r.rows_skipped != null ? String(r.rows_skipped) : "—" },
        { label: "Failed", value: r.rows_failed != null ? String(r.rows_failed) : "—" },
        { label: "Uploaded by", value: r.uploaded_by_name },
        { label: "Parsed", value: fmtDate(r.parsed_at) },
      ],
      sections: [{ title: "REMARKS", body: r.remarks }],
    }),
  },

  "legal-registrations": {
    title: "Legal Registrations",
    endpoint: "/api/legal-registrations",
    envelope: "registrations",
    unit: ["registration", "registrations"],
    searchPlaceholder: "Search registrations…",
    emptyIcon: "award",
    emptyTitle: "No registrations",
    card: (r) => ({
      icon: "award",
      title: titleCase(r.registrationFor) || r.registrationNumber || "Registration",
      subtitle: titleCase(r.authority),
      badge: gStatus(r.status),
    }),
    detail: (r) => ({
      badges: [gStatus(r.status)],
      fields: [
        { label: "Registration #", value: r.registrationNumber },
        { label: "Authority", value: titleCase(r.authority) },
        { label: "In name of", value: r.registeredInNameOf },
        { label: "Registered", value: fmtDate(r.registrationDate) },
        { label: "Expires", value: fmtDate(r.expiryAt) },
        { label: "Renewal", value: titleCase(r.renewalFrequency) },
      ],
      sections: [{ title: "REMARKS", body: r.remarks }],
    }),
  },

  announcements: {
    title: "Announcements",
    endpoint: "/api/announcements",
    envelope: "announcements",
    unit: ["announcement", "announcements"],
    searchPlaceholder: "Search announcements…",
    emptyIcon: "volume-2",
    emptyTitle: "No announcements",
    card: (a) => ({
      icon: "volume-2",
      title: a.title ?? "Announcement",
      subtitle: `${titleCase(a.category)}${a.publishedAt ? ` · ${timeAgo(a.publishedAt)}` : ""}`,
      badge: a.isPinned ? { label: "Pinned", tone: "warning" } : undefined,
    }),
    detail: (a) => ({
      badges: a.isPinned ? [{ label: "Pinned", tone: "warning" }] : [],
      fields: [
        { label: "Category", value: titleCase(a.category) },
        { label: "Published", value: fmtDate(a.publishedAt) },
        { label: "Expires", value: fmtDate(a.expiresAt) },
      ],
      sections: [{ title: "MESSAGE", body: a.body }],
    }),
  },

  "product-offerings": {
    title: "Product Offerings",
    endpoint: "/api/product-offerings",
    envelope: "offerings",
    unit: ["offering", "offerings"],
    searchPlaceholder: "Search products…",
    emptyIcon: "box",
    emptyTitle: "No product offerings",
    card: (p) => ({
      icon: "box",
      title: p.name ?? "Product",
      subtitle: titleCase(p.category),
      badge: gStatus(p.status),
    }),
    detail: (p) => ({
      badges: [gStatus(p.status)],
      fields: [
        { label: "Category", value: titleCase(p.category) },
        { label: "Regulator", value: p.regulator },
        { label: "Launched", value: fmtDate(p.launchedAt) },
      ],
      sections: [{ title: "REMARKS", body: p.remarks }],
    }),
  },

  "leave-applications": {
    title: "Leave",
    endpoint: "/api/leave-applications",
    envelope: "leaveApplications",
    unit: ["application", "applications"],
    chips: [
      { key: "", label: "All" },
      { key: "pending", label: "Pending" },
      { key: "approved", label: "Approved" },
      { key: "rejected", label: "Rejected" },
    ],
    searchPlaceholder: "Search leave…",
    emptyIcon: "calendar",
    emptyTitle: "No leave applications",
    card: (l) => ({
      icon: "calendar",
      title: titleCase(l.leaveType) || "Leave",
      subtitle: `${fmtDate(l.fromDate)} – ${fmtDate(l.toDate)} · ${l.noOfDays ?? "—"}d`,
      badge: gStatus(l.status),
    }),
    detail: (l) => ({
      badges: [gStatus(l.status)],
      fields: [
        { label: "Type", value: titleCase(l.leaveType) },
        { label: "Duration", value: titleCase(l.duration) },
        { label: "From", value: fmtDate(l.fromDate) },
        { label: "To", value: fmtDate(l.toDate) },
        { label: "Days", value: l.noOfDays != null ? String(l.noOfDays) : "—" },
        { label: "Decided", value: fmtDate(l.decidedAt) },
      ],
      sections: [{ title: "REASON", body: l.reason }, { title: "DECISION NOTES", body: l.decisionNotes }],
    }),
  },

  "sub-distributors": {
    title: "Sub-Distributors",
    endpoint: "/api/sub-distributors",
    envelope: "subDistributors",
    unit: ["partner", "partners"],
    searchPlaceholder: "Search partners…",
    emptyIcon: "git-branch",
    emptyTitle: "No sub-distributors",
    card: (s) => ({
      icon: "git-branch",
      title: s.name ?? "Partner",
      subtitle: `${s.code ?? ""}${s.city ? ` · ${s.city}` : ""}`,
      badge: gStatus(s.status),
    }),
    detail: (s) => ({
      badges: [gStatus(s.status)],
      fields: [
        { label: "Code", value: s.code },
        { label: "Association", value: titleCase(s.typeOfAssociation) },
        { label: "City", value: s.city },
        { label: "Mobile", value: s.mobile },
        { label: "ARN", value: s.arnNumber },
        { label: "ARN expiry", value: fmtDate(s.arnExpiryAt) },
        { label: "EUIN", value: s.euin },
        { label: "Commission split", value: s.commissionSplitPct != null ? `${s.commissionSplitPct}%` : "—" },
      ],
      sections: [{ title: "REMARKS", body: s.remarks }],
    }),
  },

  templates: {
    title: "Templates",
    endpoint: "/api/templates",
    envelope: "templates",
    unit: ["template", "templates"],
    searchPlaceholder: "Search templates…",
    emptyIcon: "layout",
    emptyTitle: "No templates",
    card: (t) => ({
      icon: "layout",
      title: t.name ?? "Template",
      subtitle: `${titleCase(t.channel)} · ${titleCase(t.category)}`,
      badge: gStatus(t.approvalStatus ?? t.status),
    }),
    detail: (t) => ({
      badges: [gStatus(t.approvalStatus ?? t.status)],
      fields: [
        { label: "Channel", value: titleCase(t.channel) },
        { label: "Category", value: titleCase(t.category) },
        { label: "Locale", value: t.locale },
        { label: "Approval", value: titleCase(t.approvalStatus) },
        { label: "Approved", value: fmtDate(t.approvedAt) },
      ],
      sections: [{ title: "DESCRIPTION", body: t.description }, { title: "BODY", body: t.body }],
    }),
  },

  "content-library": {
    title: "Content Library",
    endpoint: "/api/content-library",
    envelope: "assets",
    unit: ["asset", "assets"],
    searchPlaceholder: "Search content…",
    emptyIcon: "image",
    emptyTitle: "No content",
    card: (a) => ({
      icon: "image",
      title: a.title ?? a.fileName ?? "Asset",
      subtitle: `${titleCase(a.type)}${a.category ? ` · ${titleCase(a.category)}` : ""}`,
      badge: a.isActive ? { label: "Active", tone: "success" } : { label: "Inactive", tone: "neutral" },
    }),
    detail: (a) => ({
      badges: [a.isActive ? { label: "Active", tone: "success" } : { label: "Inactive", tone: "neutral" }],
      fields: [
        { label: "Type", value: titleCase(a.type) },
        { label: "Category", value: titleCase(a.category) },
        { label: "File", value: a.fileName },
        { label: "Source", value: titleCase(a.source) },
        { label: "Publish", value: fmtDate(a.publishAt) },
        { label: "Expires", value: fmtDate(a.expireAt) },
      ],
      sections: [{ title: "DESCRIPTION", body: a.description }],
    }),
  },

  finances: {
    title: "Expenses",
    endpoint: "/api/business-expenses",
    envelope: "expenses",
    unit: ["expense", "expenses"],
    searchPlaceholder: "Search expenses…",
    emptyIcon: "trending-up",
    emptyTitle: "No expenses",
    card: (e) => ({
      icon: "credit-card",
      iconTone: "warning",
      title: e.description ?? titleCase(e.category) ?? "Expense",
      subtitle: `${titleCase(e.category)}${e.expenseDate ? ` · ${fmtDate(e.expenseDate)}` : ""}`,
      rightLabel: "Amount",
      rightValue: inr(e.amount),
    }),
    detail: (e) => ({
      heroLabel: "AMOUNT",
      heroValue: inrFull(e.amount),
      fields: [
        { label: "Category", value: titleCase(e.category) },
        { label: "Paid from", value: titleCase(e.paidFrom) },
        { label: "Date", value: fmtDate(e.expenseDate) },
        { label: "Recurring", value: titleCase(e.recurringPeriod) },
      ],
      sections: [{ title: "NOTES", body: e.notes }],
    }),
  },

  documents: {
    title: "Documents",
    endpoint: "/api/compliance/documents",
    envelope: "documents",
    unit: ["document", "documents"],
    searchPlaceholder: "Search documents…",
    emptyIcon: "folder",
    emptyTitle: "No documents",
    card: (d) => ({
      icon: "file",
      title: d.name ?? d.fileName ?? d.title ?? "Document",
      subtitle: `${titleCase(d.category ?? d.kind)}${d.createdAt ? ` · ${timeAgo(d.createdAt)}` : ""}`,
      badge: d.status ? gStatus(d.status) : undefined,
    }),
    detail: (d) => ({
      fields: [
        { label: "Category", value: titleCase(d.category ?? d.kind) },
        { label: "Type", value: d.mimeType },
        { label: "Uploaded", value: fmtDate(d.createdAt) },
      ],
    }),
  },

  "amc-empanelments": {
    title: "AMC Empanelments",
    endpoint: "/api/amc-empanelments",
    envelope: "empanelments",
    unit: ["empanelment", "empanelments"],
    searchPlaceholder: "Search AMCs…",
    emptyIcon: "briefcase",
    emptyTitle: "No empanelments",
    card: (e) => ({
      icon: "briefcase",
      title: e.amcName ?? "AMC",
      subtitle: `${e.amcCode ?? ""}${e.rmName ? ` · RM ${e.rmName}` : ""}`,
      badge: gStatus(e.status),
    }),
    detail: (e) => ({
      badges: [gStatus(e.status)],
      fields: [
        { label: "AMC code", value: e.amcCode },
        { label: "Distributor code", value: e.distributorCode },
        { label: "Empanelled", value: fmtDate(e.empanelmentDate) },
        { label: "RM", value: e.rmName },
        { label: "RM email", value: e.rmEmail },
        { label: "RM phone", value: e.rmPhone },
      ],
      sections: [{ title: "REMARKS", body: e.remarks }, { title: "PHILOSOPHY", body: e.investmentPhilosophy }],
    }),
  },
};

/** Default filter: status chip + text search over the card's title + subtitle. */
export function defaultFilter(cfg: ModuleConfig, item: any, q: string, f: string): boolean {
  if (f && item.status !== f) return false;
  if (!q) return true;
  const c = cfg.card(item);
  return `${c.title} ${c.subtitle ?? ""}`.toLowerCase().includes(q.toLowerCase());
}
