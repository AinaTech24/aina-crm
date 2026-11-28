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
  { key: "taskRequestTable", label: "Tasks: requests as a table (several per task, any family member)", description: "The New task form's Client requests is a Zoho-style table: one row per request — any mix of financial (SIP, lumpsum, redemption, switch …), non-financial (KYC, nominee, bank change …) and insurance — each row for the client or a member of their family, with its own scheme, amount, SIP day, folio, mode and note. One task holds them all; each member's financial rows book their own draft Business entry, and the sub-tasks of every request are added. On for Investment Options (2026-11-25).", type: "boolean", group: "Tasks" },
  { key: "taskAttachmentsMulti", label: "Tasks: attach files while creating, several at once", description: "The New task form gets an Attachments box: pick several files in one go (or drag them in), remove any before saving, and they are all uploaded to the task when it is created. The task's own Attachments panel also takes several files at once. Max 25 MB per file. On for Investment Options (2026-11-27).", type: "boolean", group: "Tasks" },
  { key: "taskHeaderSubject", label: "Tasks: client / lead name at the top of the task page", description: "The task page shows the client (or lead) the task is about right under its title, as a link to their record. On for Investment Options (2026-11-27).", type: "boolean", group: "Tasks" },
  { key: "insuranceExtraFields", label: "Insurance: extra policy & claim fields", description: "The policy form and page add the fields Zoho kept per line — motor (PA owner-driver, LL paid driver, CNG kit premium, OD+TP term, owned by), personal accident (AD / PTD / PPD sum insured and cumulative bonus, optional covers), WC (medical expense limit), marine (transit mode), fire (category, insured as, item-wise and add-on covers), travel (trip days), the premium per insured member, and basic premium / payment mode & date / issue date on every policy. The claim form and page add claim no., intimation no., hospital, diagnosis, patient, deduction, discharge / process / payment dates and who intimated, submitted, visited and called. On for Investment Options (2026-11-24).", type: "boolean", group: "Insurance" },
  { key: "clientReportPdf", label: "Client report (PDF)", description: "A \"Client report\" button on the client page downloads one PDF with everything on the client's record — profile, KYC, bank and nominees, family, mutual fund holdings, SIPs, transactions, FDs, goals, insurance policies (with cover details and insured members) and claims, meetings, opportunities, calls / visits / notes, tasks, service requests, messages, documents and record gaps. A \"Client copy\" leaves out the internal sections. The family page gets a \"Family report\" the same way: the family summary and every member, then each section across all members. On for Investment Options (2026-11-25).", type: "boolean", group: "Clients" },
  { key: "zohoImport", label: "Zoho CRM import", description: "Clients → Import → \"From Zoho CRM\": load a Zoho Contacts export (clients, families, referrals, products) and a Meetings export. Switch on only for a firm moving off Zoho.", type: "boolean", group: "Data migration" },
  { key: "riskPdfNoAnswers", label: "Risk profile PDF: say when there are no answers", description: "A risk profile with no questionnaire answers (imported, set directly or provisional) prints \"No questionnaire answers on record\", \"Not scored\" and \"Not confirmed by the client\" instead of an empty questionnaire and a client signature line. On for We Care Freedom Wealth.", type: "boolean", group: "Risk profiling" },
  { key: "dashboardAllTime", label: "Dashboard period: All time", description: "The dashboard's Period menu offers \"All time\" (everything on record up to today) after Last FY. On for We Care Freedom Wealth.", type: "boolean", group: "Dashboards" },
  { key: "reportsOwnOnly", label: "Reports: only the firm's own reports", description: "Hide the CRM's built-in report library (MIS, SIP, team, tax …). Reports opens the firm's own custom reports, and a link to a built-in report lands there. For We Care Freedom Wealth, who rebuild their Zoho reports one by one (2026-11-19).", type: "boolean", group: "Reports" },
  { key: "deskHeadAccess", label: "Desk heads see their desk's clients", description: "Someone people report to (Reporting manager) sees their own clients AND their reports' clients wherever an RM sees only their own book — client list, client pages, reports, transactions, SIP rejections. For desk heads inside a branch (We Care: Anand 1 / 2 / 3, 2026-11-21). Leads and tasks stay personal.", type: "boolean", group: "Access" },
  { key: "sharedClientBook", label: "One shared client book (mobile app too)", description: "Every user who can see clients sees the whole client book in the mobile app as well — an RM is not narrowed to their own clients nor a branch head to their branch (the app otherwise always does). Use with the firm's data wall off, which does the same on the web. On for Investment Options (2026-11-25).", type: "boolean", group: "Access" },
  { key: "clientBookEverywhere", label: "Every screen shows the whole client book", description: "An RM, branch head or insurance team member on the role's default access counts as \"View all clients\" on every screen — business entries, activities, calendar, communications, goals, plans, reports and the rest — not only the client list and client pages. Someone whose access was customised keeps exactly what was ticked. Leads stay as they are. On for Investment Options (2026-11-27).", type: "boolean", group: "Access" },
  { key: "insuranceFolder", label: "Insurance folder in the sidebar", description: "One \"Insurance\" group in the sidebar, after Business, with every insurance page as its own item — Insurance Policies, Renewals, Claims, Protection-Gap Radar and Commission — instead of a single Insurance item under Planning Tools. The insurance team sees it too. Same access rules as before. On for Investment Options (2026-11-27).", type: "boolean", group: "Insurance" },
  { key: "noAutoFamilies", label: "Do not create families automatically", description: "An RTA import never creates or fills a family on its own — today it makes a \"<guardian> Family\" for every guardian of a minor and places the minors in it. Families are then only the ones people make (New family, Map clients, Merge). For Shah Financial Services (2026-11-23).", type: "boolean", group: "Families" },
  { key: "visitorRegister", label: "Visitor Register", description: "A Visitor Register under Work in the sidebar: record who visited the office — name, email, mobile, company, visit date, entry and exit time, purpose, whom they met and remarks — with search and a date filter. Off, the menu item, pages and API do not exist for the firm. For Akshar Invest (2026-11-26).", type: "boolean", group: "Office" },
  { key: "courierRegister", label: "Couriers", description: "A Couriers register under Work in the sidebar: incoming and outgoing couriers — company, tracking number, dates, category, status, sender or recipient details, charges and payment mode — with filters, Excel / CSV import and export. Off, the menu item, pages and API do not exist for the firm. For Akshar Invest (2026-11-27).", type: "boolean", group: "Office" },
  { key: "maxMessagesPerMonth",label: "Monthly message quota", description: "Cap on WhatsApp/SMS/email sends per month (0 or blank = plan default).", type: "number", group: "Limits" },
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
