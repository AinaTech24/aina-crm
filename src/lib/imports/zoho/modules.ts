/**
 * Zoho CRM modules beyond Contacts / Meetings / MF Transactions — the pure
 * mapping half (tested). Records arrive in Zoho API shape (field api_name →
 * value; a lookup is { id, name }), as read through Zoho's API / COQL, one
 * JSON file per module. run-modules.ts writes them.
 *
 * We Care Freedom Wealth's modules, agreed 2026-11-18:
 *  - Leads           → leads (Zoho's status and source kept as text too)
 *  - Risk_Profiles   → risk profile history, CONFIRMED, signed on the Zoho date;
 *                      the band is the FIRM'S OWN band for Zoho's score
 *  - Query_Tracker   → tasks ("Task Tracker"; finished ones and "Link Approved"
 *                      come in closed, and so does anything unfinished older
 *                      than 30 days — Zoho's status stays in the remarks)
 *  - Calls           → the activity log
 *  - SWP             → SIP rejections ("SIP Tracking"; only Rejected rows, all
 *                      open as Zoho has them)
 *  - Equity          → monthly equity brokerage ("Equity Brokerage")
 */

import { cell, isoDate, zohoId } from "./values";

export const ZOHO_MODULES = ["Leads", "Risk_Profiles", "Query_Tracker", "Calls", "SWP", "Equity"] as const;
export type ZohoModule = (typeof ZOHO_MODULES)[number];

export const MODULE_LABEL: Record<ZohoModule, string> = {
  Leads: "Leads",
  Risk_Profiles: "Risk Profiles",
  Query_Tracker: "Task Tracker",
  Calls: "Calls",
  SWP: "SIP Tracking (rejected SIPs)",
  Equity: "Equity Brokerage",
};

export type ZohoRecord = Record<string, unknown>;

/** A lookup / owner value: { id, name } in the API, or a bare id. */
export function ref(v: unknown): { id: string; name: string } {
  if (v && typeof v === "object" && !Array.isArray(v)) {
    const o = v as Record<string, unknown>;
    return { id: zohoId(o.id), name: cell(o.name) };
  }
  return { id: zohoId(v), name: "" };
}

export const num = (v: unknown): number => {
  const n = Number(String(v ?? "").replace(/[,₹\s]/g, ""));
  return Number.isFinite(n) ? n : 0;
};

/** An API datetime ("2026-11-17T16:51:54+05:30") as a Date, or null. */
export function when(v: unknown): Date | null {
  const s = cell(v);
  if (!s) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return new Date(`${s}T10:00:00+05:30`);
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}

const key = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");

// ── Leads ────────────────────────────────────────────────────────────────

/** Zoho Lead Status → the CRM's lead stage. Product names typed into the
 *  status (Motor, Health …) and blanks are "new"; the Zoho text is kept. */
const LEAD_STAGE: Record<string, string> = {
  "call done": "call_done",
  "meeting done": "meeting_done",
  "documents pending": "documents_pending",
  "document collected": "documents_received",
  "kyc pending": "kyc_pending",
  "kyc in process": "kyc_pending",
  "physical kyc in process": "physical_kyc",
  "kyc done": "kyc_validated",
  "iin created": "ucc_create",
  "can created": "ucc_create",
  "iin activated": "ucc_activated",
  "can activated": "ucc_activated",
  "mandate created": "mandate_create",
  "mandate activated": "mandate_activated",
  "mandate rejected": "mandate_rejected",
  "ready for transaction": "make_transaction",
  transact: "transaction_successful",
  "won lead": "won_lead",
  "not qualified": "not_qualified",
  "call not connected": "call_not_connected",
  "call back later": "call_back_later",
  "lost lead": "lost",
  "pre qualified": "contacted",
  "pre-qualified": "contacted",
  "in progress": "contacted",
  "process for the quote": "proposal_drafted",
  "work on the quote": "proposal_drafted",
  "quote regeneration": "proposal_drafted",
  "explain client quote": "proposal_shared",
  "quote share to client": "proposal_shared",
  "approved by client": "proposal_approved",
  "process to the comapny": "proposal_approved",
  "payment link genereted": "proposal_approved",
  "payment link sent to client": "proposal_approved",
  "policy generated": "won_lead",
  "policy mail": "won_lead",
  "policy whatsapp": "won_lead",
  "call and guide about the policy to client": "won_lead",
  "policy entry done in zoho": "won_lead",
  "policy entry done in software": "won_lead",
};

const INSURANCE_STATUSES = new Set([
  "process for the quote", "work on the quote", "quote regeneration", "explain client quote", "quote share to client",
  "approved by client", "process to the comapny", "payment link genereted", "payment link sent to client", "policy generated",
  "policy mail", "policy whatsapp", "call and guide about the policy to client", "policy entry done in zoho",
  "policy entry done in software", "commercial", "fire & burglary", "gpa/ghi", "health", "marine", "motor", "personal lines",
  "professional indemnity", "wc",
]);

/** Zoho Lead Source → the CRM's source bucket; the Zoho name is kept as the campaign. */
export function leadSource(z: string): string {
  const k = key(z);
  if (!k) return "manual";
  if (["family member", "client referrals", "external referral", "partner", "bni", "jbn", "jci", "vbn", "lion's club", "employee referral"].includes(k)) return "referral";
  if (["chat", "website", "online store", "web research", "sales mail alias"].includes(k)) return "website";
  if (k === "facebook" || k === "twitter" || k.startsWith("whatsapp")) return "social_media";
  if (k === "cold call") return "cold_call";
  if (k.startsWith("seminar") || k === "trade show") return "seminar";
  if (k === "existing clients") return "existing_client";
  return "other";
}

const INTEREST: Record<string, string> = {
  "mutual fund": "sip",
  siso: "lumpsum",
};

export type MappedLead = {
  zohoId: string;
  name: string;
  owner: string;
  email: string | null;
  phone: string | null;
  city: string | null;
  pincode: string | null;
  source: string;
  sourceText: string;
  stage: string;
  statusText: string;
  pipeline: "mf" | "insurance";
  interest: string[];
  expectedText: string;
  referrerZohoId: string;
  referrerName: string;
  convertedZohoId: string;
  convertedAt: Date | null;
  followUp: string | null;
  createdAt: Date | null;
  notes: string | null;
};

export function mapLead(r: ZohoRecord): MappedLead {
  const status = cell(r.Lead_Status);
  const expected = Array.isArray(r.Expected_Business) ? (r.Expected_Business as unknown[]).map(cell).join("; ") : cell(r.Expected_Business);
  const converted = r.Converted__s === true || cell(r.Converted__s) === "true" || !!ref(r.Converted_Contact).id;
  let stage = LEAD_STAGE[key(status)] ?? "new";
  if (converted) stage = "converted";
  const insurance = INSURANCE_STATUSES.has(key(status)) || (!!expected && !/mutual fund|siso/i.test(expected));
  const name = cell(r.Full_Name) || [cell(r.First_Name), cell(r.Last_Name)].filter(Boolean).join(" ") || cell(r.Company);
  const extra = [
    status ? `Zoho status: ${status}` : "",
    expected ? `Expected business: ${expected}` : "",
    cell(r.Company) && cell(r.Company) !== name ? `Company: ${cell(r.Company)}` : "",
    [cell(r.Street), cell(r.State)].filter(Boolean).join(", "),
    cell(r.KYC_Type) ? `KYC: ${cell(r.KYC_Type)}` : "",
    cell(r.Mandate_Type) ? `Mandate: ${cell(r.Mandate_Type)}` : "",
    cell(r.NSE_MFU) ? `Platform: ${cell(r.NSE_MFU)}` : "",
    cell(r.Family_Individual),
    cell(r.Remarks),
    cell(r.Description),
  ].filter(Boolean);
  return {
    zohoId: zohoId(r.id),
    name: name.slice(0, 200),
    owner: ref(r.Owner).name,
    email: cell(r.Email) || null,
    phone: cell(r.Mobile) || null,
    city: cell(r.City) || null,
    pincode: cell(r.Zip_Code) || null,
    source: leadSource(cell(r.Lead_Source)),
    sourceText: cell(r.Lead_Source),
    stage,
    statusText: status,
    pipeline: insurance ? "insurance" : "mf",
    interest: expected
      ? [...new Set(expected.split(/;\s*/).map((e) => INTEREST[key(e)] ?? (/insurance|ulip|gpa|ghi|indemnity|liability|wc|marine|contractor/i.test(e) ? "insurance" : "other")))]
      : [],
    expectedText: expected,
    referrerZohoId: ref(r.Referal_Client_Name).id,
    referrerName: ref(r.Referal_Client_Name).name,
    convertedZohoId: ref(r.Converted_Contact).id,
    convertedAt: converted ? when(r.Converted_Date_Time) : null,
    followUp: isoDate(r.Follow_Up_Date),
    createdAt: when(r.Date) ?? when(r.Created_Time),
    notes: extra.length ? extra.join("\n").slice(0, 4000) : null,
  };
}

// ── Risk profiles ────────────────────────────────────────────────────────

/** Zoho's five bands → the CRM's four. Never riskier than Zoho said: a band
 *  between two rounds DOWN (Moderately Conservative → Conservative,
 *  Moderately Aggressive → Moderate). Zoho's own band is kept in the remarks. */
const RISK_BAND: Record<string, "conservative" | "moderate" | "aggressive"> = {
  conservative: "conservative",
  "moderately conservative": "conservative",
  moderate: "moderate",
  "moderately aggressive": "moderate",
  aggressive: "aggressive",
};

const RP_QUESTIONS: Array<[field: string, key: string, question: string]> = [
  ["Q1_About_Tolerance_whne_market_falls_20", "tolerance", "If the market falls 20%"],
  ["Q2_About_Capacity_in_terms_of_Income", "capacity", "Income and years to retirement"],
  ["Q3_Objective_or_need", "objective", "Objective or need"],
];

export type RiskBand = { id: string; minScore: number; maxScore: number };

/** The CRM's default bands (lib/risk-profile/questions.ts), when a firm has none. */
export const DEFAULT_RISK_BANDS: RiskBand[] = [
  { id: "conservative", minScore: 8, maxScore: 18 },
  { id: "moderate", minScore: 19, maxScore: 29 },
  { id: "aggressive", minScore: 30, maxScore: 40 },
];

/** The firm's band for a score (the first band whose range holds it), as a
 *  CRM risk category; null for no score or a score outside every band.
 *  We Care's choice (2026-11-18): a Zoho profile takes the band the CRM's own
 *  questionnaire gives its score, not Zoho's band name. */
export function categoryFromScore(score: number, bands: RiskBand[]): "conservative" | "moderate" | "aggressive" | "very_aggressive" | null {
  if (!(score > 0)) return null;
  const b = bands.find((x) => score >= Number(x.minScore) && score <= Number(x.maxScore));
  return b && ["conservative", "moderate", "aggressive", "very_aggressive"].includes(b.id) ? (b.id as any) : null;
}

export type MappedRiskProfile = {
  zohoId: string;
  clientZohoId: string;
  clientName: string;
  owner: string;
  zohoBand: string;
  category: "conservative" | "moderate" | "aggressive" | null;
  score: number;
  responses: Array<{ key: string; question: string; answer: string; score: number }>;
  signedAt: Date | null;
};

export function mapRiskProfile(r: ZohoRecord): MappedRiskProfile {
  const band = cell(r.Risk_Assignments);
  return {
    zohoId: zohoId(r.id),
    clientZohoId: ref(r.Clients).id,
    clientName: ref(r.Clients).name || cell(r.Name),
    owner: ref(r.Owner).name,
    zohoBand: band,
    category: RISK_BAND[key(band)] ?? null,
    score: Math.round(num(r.Risk_Score_Calculations)),
    responses: RP_QUESTIONS.filter(([f]) => cell(r[f])).map(([f, k, q]) => ({ key: k, question: q, answer: cell(r[f]), score: 0 })),
    signedAt: when(r.Created_Time),
  };
}

// ── Task Tracker ─────────────────────────────────────────────────────────

const TASK_STATUS: Record<string, "open" | "in_progress" | "completed" | "cancelled"> = {
  started: "in_progress",
  "in process": "in_progress",
  "link sent": "in_progress",
  // The client approved the transaction link: the firm counts that as done (2026-11-18).
  "link approved": "completed",
  completed: "completed",
  "link not approved": "cancelled",
  rejected: "cancelled",
  "not solved": "cancelled",
};

const TASK_DEPARTMENT: Record<string, string> = {
  financial: "operations",
  "non financial": "back_office",
  "equity team": "operations",
  "daily work": "other",
  "insurance team": "operations",
  "it team": "support",
};

export type MappedTask = {
  zohoId: string;
  number: string;
  title: string;
  owner: string;
  assignee: string;
  clientZohoId: string;
  clientName: string;
  leadZohoId: string;
  status: "open" | "in_progress" | "completed" | "cancelled";
  statusText: string;
  priority: "low" | "normal" | "high";
  department: string | null;
  start: Date | null;
  end: Date | null;
  created: Date | null;
  description: string | null;
  remarks: string | null;
  meta: Record<string, unknown>;
};

export function mapTask(r: ZohoRecord): MappedTask {
  const status = cell(r.Status);
  const request = cell(r.Request_For);
  const subject = cell(r.Task_Subject);
  const p = key(cell(r.Priority));
  const reason = [cell(r.Reason), cell(r.If_Not_Solved_Type_a_Reason)].filter(Boolean).join(" · ");
  return {
    zohoId: zohoId(r.id),
    number: cell(r.Name),
    title: (subject && request ? `${request} — ${subject}` : subject || request || cell(r.Type_of_Request) || "Zoho task").slice(0, 300),
    owner: ref(r.Owner).name,
    assignee: ref(r.Assign_To).name,
    clientZohoId: ref(r.Client_Name).id,
    clientName: ref(r.Client_Name).name,
    leadZohoId: ref(r.Lead).id,
    status: TASK_STATUS[key(status)] ?? "open",
    statusText: status,
    priority: p === "high" ? "high" : p === "low" ? "low" : "normal",
    department: TASK_DEPARTMENT[key(cell(r.Type_of_Request))] ?? null,
    start: when(r.Start_From),
    end: when(r.End_From),
    created: when(r.Created_Time),
    description: [cell(r.Write_Note), cell(r.Remarks)].filter(Boolean).join("\n\n").slice(0, 8000) || null,
    remarks: reason ? (status ? `${status}: ${reason}` : reason).slice(0, 4000) : null,
    meta: {
      zohoId: zohoId(r.id),
      zohoTask: cell(r.Name),
      zohoStatus: status || undefined,
      zohoType: cell(r.Type_of_Request) || undefined,
      zohoRequest: request || undefined,
      transactThrough: cell(r.Transact_Through) || undefined,
      euin: cell(r.EUIN_No) || undefined,
      count: num(r.Number_Of) || undefined,
      zohoMft: ref(r.MF_Transac).name || undefined,
    },
  };
}

// ── Calls ────────────────────────────────────────────────────────────────

export type MappedCall = {
  zohoId: string;
  owner: string;
  contactZohoId: string;
  contactName: string;
  relatedZohoId: string;
  relatedModule: string;
  relatedName: string;
  direction: "outbound" | "inbound" | null;
  status: "completed" | "no_answer" | null;
  scheduled: boolean;
  subject: string | null;
  notes: string | null;
  at: Date | null;
  durationSec: number | null;
};

function durationSeconds(r: ZohoRecord): number | null {
  const s = num(r.Call_Duration_in_seconds);
  if (s > 0) return Math.round(s);
  const m = /^(\d+):(\d{2})$/.exec(cell(r.Call_Duration));
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

export function mapCall(r: ZohoRecord): MappedCall {
  const type = key(cell(r.Call_Type));
  const outgoing = key(cell(r.Outgoing_Call_Status));
  const what = r.What_Id && typeof r.What_Id === "object" ? (r.What_Id as Record<string, unknown>) : {};
  const moduleName = cell(r.se_module) || cell(what.module) || "";
  const notes = [cell(r.Description), cell(r.Call_Result) ? `Result: ${cell(r.Call_Result)}` : "", cell(r.Call_Agenda) ? `Agenda: ${cell(r.Call_Agenda)}` : ""]
    .filter(Boolean)
    .join("\n");
  return {
    zohoId: zohoId(r.id),
    owner: ref(r.Owner).name,
    contactZohoId: ref(r.Who_Id).id,
    contactName: ref(r.Who_Id).name,
    relatedZohoId: ref(r.What_Id).id,
    relatedModule: moduleName,
    relatedName: ref(r.What_Id).name,
    direction: type === "inbound" ? "inbound" : type === "outbound" || type === "missed" ? (type === "missed" ? "inbound" : "outbound") : null,
    status: type === "missed" ? "no_answer" : outgoing === "scheduled" || outgoing === "overdue" || outgoing === "cancelled" ? null : "completed",
    scheduled: outgoing === "scheduled" || outgoing === "overdue",
    subject: cell(r.Subject).slice(0, 300) || null,
    notes: notes.slice(0, 8000) || null,
    at: when(r.Call_Start_Time) ?? when(r.Created_Time),
    durationSec: durationSeconds(r),
  };
}

// ── SIP Tracking → SIP rejections ────────────────────────────────────────

export type MappedSipRejection = {
  zohoId: string;
  owner: string;
  clientZohoId: string;
  clientName: string;
  scheme: string | null;
  amount: number;
  date: string | null;
  status: string;
  sipType: string;
  debitDay: number | null;
  mft: string;
};

export function mapSipTracking(r: ZohoRecord): MappedSipRejection {
  return {
    zohoId: zohoId(r.id),
    owner: ref(r.Owner).name,
    clientZohoId: ref(r.Client_Name).id,
    clientName: ref(r.Client_Name).name,
    scheme: cell(r.Scheme_Name) || null,
    amount: num(r.Amount) || num(r.SIP_Stop_Amount),
    date: isoDate(r.SWP_Date) ?? isoDate(r.Created_Time),
    status: cell(r.Status),
    sipType: cell(r.SIP_Type),
    debitDay: num(r.ECS_Date) || null,
    mft: ref(r.Source_MF_Transaction).name,
  };
}

// ── Equity Brokerage → monthly brokerage ─────────────────────────────────

export type BrokerageMonth = { period: string; amount: number; turnover: number; rows: number; activeClients: string[] };

/** Zoho keeps one row per date (Name = active clients, Brokerage, Turn Over);
 *  the CRM keeps one figure per month, so rows are summed by month. */
export function brokerageByMonth(records: ZohoRecord[]): { months: BrokerageMonth[]; undated: number } {
  const by = new Map<string, BrokerageMonth>();
  let undated = 0;
  for (const r of records) {
    const d = isoDate(r.Date);
    if (!d) {
      undated++;
      continue;
    }
    const period = d.slice(0, 7);
    const m = by.get(period) ?? { period, amount: 0, turnover: 0, rows: 0, activeClients: [] };
    m.amount += num(r.Brokerge_Amount);
    m.turnover += num(r.Turn_Over);
    m.rows++;
    if (cell(r.Name)) m.activeClients.push(cell(r.Name));
    by.set(period, m);
  }
  return { months: [...by.values()].sort((a, b) => a.period.localeCompare(b.period)), undated };
}
