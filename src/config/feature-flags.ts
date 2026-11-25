/**
 * Registry of tenant feature flags — arbitrary capability toggles that can be
 * granted per PACKAGE (packages.feature_flags) and now OVERRIDDEN per tenant
 * (subscriptions.feature_flags_override). loadTenantLicense merges
 * { ...package.featureFlags, ...subscription.featureFlagsOverride }.
 *
 * Add a row here to make a flag appear in the Aina-Admin per-tenant editor and
 * to document what it does. `type` drives the editor control.
 */

export type FeatureFlagDef = {
  key: string;
  label: string;
  description: string;
  type: "boolean" | "number";
  group: string;
};

export const FEATURE_FLAGS: FeatureFlagDef[] = [
  { key: "customDomain", label: "Custom domain", description: "Serve the CRM on the firm's own domain (crm.theirfirm.in), not just a vanity subdomain.", type: "boolean", group: "White-label" },
  { key: "whiteLabel", label: "White-label branding", description: "Remove Aina branding from client-facing surfaces (emails, PDFs, portal).", type: "boolean", group: "White-label" },
  { key: "redemptionOnlineOffline", label: "Redemption task: Online / Offline", description: "On the New task form, a Redemption request asks Online or Offline and adds that route's sub-tasks (slip to client … payment check, or platform entry … payment to client).", type: "boolean", group: "Tasks" },
  { key: "insuranceTasks", label: "Tasks: Insurance category", description: "The New task form's Type of task adds Insurance (beside General, Financial and Non-financial) with insurance requests — quote, new policy, renewal, premium collection, endorsement, policy entry, claim intimation and follow-up, pre/post claim, life insurance service — each asking for the policy number and premium and starting with its own checklist. On for Investment Options (2026-11-20).", type: "boolean", group: "Tasks" },
  { key: "insuranceExtraFields", label: "Insurance: extra policy & claim fields", description: "The policy form and page add the fields Zoho kept per line — motor (PA owner-driver, LL paid driver, CNG kit premium, OD+TP term, owned by), personal accident (AD / PTD / PPD sum insured and cumulative bonus, optional covers), WC (medical expense limit), marine (transit mode), fire (category, insured as, item-wise and add-on covers), travel (trip days), the premium per insured member, and basic premium / payment mode & date / issue date on every policy. The claim form and page add claim no., intimation no., hospital, diagnosis, patient, deduction, discharge / process / payment dates and who intimated, submitted, visited and called. On for Investment Options (2026-11-24).", type: "boolean", group: "Insurance" },
  { key: "clientReportPdf", label: "Client report (PDF)", description: "A \"Client report\" button on the client page downloads one PDF with everything on the client's record — profile, KYC, bank and nominees, family, mutual fund holdings, SIPs, transactions, FDs, goals, insurance policies (with cover details and insured members) and claims, meetings, opportunities, calls / visits / notes, tasks, service requests, messages, documents and record gaps. A \"Client copy\" leaves out the internal sections. The family page gets a \"Family report\" the same way: the family summary and every member, then each section across all members. On for Investment Options (2026-11-25).", type: "boolean", group: "Clients" },
  { key: "zohoImport", label: "Zoho CRM import", description: "Clients → Import → \"From Zoho CRM\": load a Zoho Contacts export (clients, families, referrals, products) and a Meetings export. Switch on only for a firm moving off Zoho.", type: "boolean", group: "Data migration" },
  { key: "riskPdfNoAnswers", label: "Risk profile PDF: say when there are no answers", description: "A risk profile with no questionnaire answers (imported, set directly or provisional) prints \"No questionnaire answers on record\", \"Not scored\" and \"Not confirmed by the client\" instead of an empty questionnaire and a client signature line. On for We Care Freedom Wealth.", type: "boolean", group: "Risk profiling" },
  { key: "dashboardAllTime", label: "Dashboard period: All time", description: "The dashboard's Period menu offers \"All time\" (everything on record up to today) after Last FY. On for We Care Freedom Wealth.", type: "boolean", group: "Dashboards" },
  { key: "reportsOwnOnly", label: "Reports: only the firm's own reports", description: "Hide the CRM's built-in report library (MIS, SIP, team, tax …). Reports opens the firm's own custom reports, and a link to a built-in report lands there. For We Care Freedom Wealth, who rebuild their Zoho reports one by one (2026-11-19).", type: "boolean", group: "Reports" },
  { key: "deskHeadAccess", label: "Desk heads see their desk's clients", description: "Someone people report to (Reporting manager) sees their own clients AND their reports' clients wherever an RM sees only their own book — client list, client pages, reports, transactions, SIP rejections. For desk heads inside a branch (We Care: Anand 1 / 2 / 3, 2026-11-21). Leads and tasks stay personal.", type: "boolean", group: "Access" },
  { key: "noAutoFamilies", label: "Do not create families automatically", description: "An RTA import never creates or fills a family on its own — today it makes a \"<guardian> Family\" for every guardian of a minor and places the minors in it. Families are then only the ones people make (New family, Map clients, Merge). For Shah Financial Services (2026-11-23).", type: "boolean", group: "Families" },
  { key: "maxMessagesPerMonth", label: "Monthly message quota", description: "Cap on WhatsApp/SMS/email sends per month (0 or blank = plan default).", type: "number", group: "Limits" },
];

export const FEATURE_FLAG_KEYS = new Set(FEATURE_FLAGS.map((f) => f.key));

/** Only accept known flag keys (+ correct primitive types) from the admin editor. */
export function sanitizeFeatureFlagOverride(input: Record<string, unknown> | null | undefined): Record<string, boolean | number> {
  const out: Record<string, boolean | number> = {};
  if (!input) return out;
  for (const def of FEATURE_FLAGS) {
    const v = input[def.key];
    if (v === undefined || v === null || v === "") continue; // "inherit from package"
    if (def.type === "boolean") out[def.key] = !!v;
    else if (def.type === "number" && Number.isFinite(Number(v))) out[def.key] = Number(v);
  }
  return out;
}
