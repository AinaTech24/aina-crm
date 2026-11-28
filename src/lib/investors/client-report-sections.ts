/**
 * The sections of the consolidated client report (client-report.ts), shared
 * by the download dialog and the API. A plain module: safe on both sides.
 */

export const CLIENT_REPORT_FLAG = "clientReportPdf";

export const CLIENT_REPORT_SECTIONS = [
  { key: "profile", label: "Profile, KYC, bank & nominees", client: true },
  { key: "family", label: "Family", client: true },
  { key: "portfolio", label: "Mutual fund portfolio", client: true },
  { key: "sips", label: "SIPs", client: true },
  { key: "transactions", label: "Transactions (last 24 months)", client: true },
  { key: "fds", label: "Fixed deposits", client: true },
  { key: "goals", label: "Goals", client: true },
  { key: "insurance", label: "Insurance policies", client: true },
  { key: "claims", label: "Insurance claims", client: true },
  { key: "meetings", label: "Meetings", client: true },
  { key: "opportunities", label: "Opportunities", client: false },
  { key: "activity", label: "Calls, visits & notes", client: false },
  { key: "tasks", label: "Tasks", client: false },
  { key: "service", label: "Service requests", client: false },
  { key: "messages", label: "Emails & WhatsApp sent", client: false },
  { key: "documents", label: "Documents on file", client: false },
  { key: "gaps", label: "Record gaps", client: false },
] as const;

export type ClientReportSection = (typeof CLIENT_REPORT_SECTIONS)[number]["key"];

export const ALL_CLIENT_REPORT_SECTIONS: ClientReportSection[] = CLIENT_REPORT_SECTIONS.map((s) => s.key);
export const CLIENT_COPY_SECTIONS: ClientReportSection[] = CLIENT_REPORT_SECTIONS.filter((s) => s.client).map((s) => s.key);

/** The family report has no "Family" section: its members table is the summary. */
export const FAMILY_REPORT_SECTIONS: ClientReportSection[] = ALL_CLIENT_REPORT_SECTIONS.filter((k) => k !== "family");

/** `?sections=a,b` → the known keys, in report order; nothing valid → all. */
export function parseClientReportSections(raw: string | null | undefined): ClientReportSection[] {
  const asked = new Set(String(raw ?? "").split(",").map((s) => s.trim()).filter(Boolean));
  const keys = ALL_CLIENT_REPORT_SECTIONS.filter((k) => asked.has(k));
  return keys.length ? keys : ALL_CLIENT_REPORT_SECTIONS;
}

/**
 * Which insurance policies the report prints (Investment Options, 2026-11-27):
 * the dialog asks for statuses and types once "Insurance policies" is ticked.
 * `null` = no filter (every policy, as before).
 *   ?insStatus=active,lapsed   ?insType=health,term
 */
export type PolicyFilter = { statuses: string[] | null; types: string[] | null };

const KEY_RE = /^[a-z][a-z0-9_]{0,39}$/;
/** Stands for a policy whose type was never recorded. */
export const NO_POLICY_TYPE = "none";

function keyList(raw: string | null | undefined): string[] | null {
  if (raw == null || raw === "") return null;
  const keys = [...new Set(String(raw).split(",").map((s) => s.trim()).filter((s) => KEY_RE.test(s)))].slice(0, 40);
  return keys.length ? keys : null;
}

export function parsePolicyFilter(sp: { get(name: string): string | null }): PolicyFilter {
  return { statuses: keyList(sp.get("insStatus")), types: keyList(sp.get("insType")) };
}
