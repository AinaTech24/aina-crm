/**
 * Investment Options' other Zoho modules → the CRM (agreed 2026-11-20). Pure:
 * records in (API names, as COQL returns them), CRM-shaped rows out.
 *
 *  - Every user lookup is rewritten to the user's EMAIL (`ioUsers`), because
 *    Zoho returns only a partial name ("- Investment Options"); a user who has
 *    left Zoho resolves to Keval Ashar.
 *  - Insurance: the "Insurance" register (2,944 general-insurance policies) and
 *    the newer per-line modules (Health, Motor, WC, Travel, PA, Marine, Fire,
 *    Cyber) all become insurance policies; a policy number already brought in
 *    from a line module is not added again from the register.
 *  - Tasks: Zoho's own Tasks (mostly recurring SIP / birthday reminders) and the
 *    "IO Task" service desk (Task_Assignment) both become tasks.
 *  - MF Folio, NSE MF Orders and SIP Rejection are NOT imported: the registrar
 *    feeds own folios, transactions and rejections (the firm's choice).
 */

import { cell, isoDate, zohoId } from "../values";
import { num, ref, when, type MappedTask, type ZohoRecord } from "../modules";
import { ioUserEmail } from "./users";
import { na } from "./contacts";

const key = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");

/** Names of the firm's people as Zoho's picklists spell them → their email. */
const PEOPLE_BY_NAME: Record<string, string> = {
  "keval ashar": "asharkeval@gmail.com",
  "harshad ashar": "harshad@investmentoptions.in",
  harshad: "harshad@investmentoptions.in",
  harshadbhai: "harshad@investmentoptions.in",
  "jugal ashar": "jugal@investmentoptions.in",
  jugal: "jugal@investmentoptions.in",
  "aryan kakkad": "aryan@investmentoptions.in",
  beena: "beena@investmentoptions.in",
  kirti: "kirti@investmentoptions.in",
  divya: "divya@investmentoptions.in",
  "devendrasinh jadeja": "devendrasinh.jadeja@investmentoptions.in",
  devendrasinh: "devendrasinh.jadeja@investmentoptions.in",
  "kinnari sampat": "kinnari@investmentoptions.in",
  kinnari: "kinnari@investmentoptions.in",
  "mahesh khatra": "mahesh@investmentoptions.in",
  mehul: "mehul@investmentoptions.in",
  "nikita sampat": "nikita@investmentoptions.in",
  priyanka: "priyanka@investmentoptions.in",
  "rajeshwari gadhvi": "rajeshwari@investmentoptions.in",
  rajeshwari: "rajeshwari@investmentoptions.in",
  sumeet: "sumeet@investmentoptions.in",
  sumeetbhai: "sumeet@investmentoptions.in",
};
/** A person's name as typed in a Zoho picklist → their email, or "". */
export const personEmail = (name: string) => PEOPLE_BY_NAME[key(name)] ?? "";

/** A Zoho user lookup → { id, name: email } (left users → their current login or Keval). Record lookups are untouched. */
function userRef(v: unknown): unknown {
  if (!v || typeof v !== "object" || Array.isArray(v)) return v;
  const email = ioUserEmail(v);
  return email ? { id: String((v as Record<string, unknown>).id), name: email } : v;
}

const USER_FIELDS = ["Owner", "CFE", "Assign_By", "Check_In_By", "Created_By", "Modified_By"];

/** Rewrite every user lookup of a record to the user's email. */
export function ioUsers<T extends ZohoRecord>(r: T): T {
  const out: ZohoRecord = { ...r };
  for (const f of USER_FIELDS) if (f in out) out[f] = userRef(out[f]);
  return out as T;
}

// ── Insurance ────────────────────────────────────────────────────────────

export type PolicyType =
  | "term" | "ulip" | "health" | "critical_illness" | "personal_accident" | "motor" | "travel" | "home" | "life_other"
  | "general_other" | "fire" | "marine" | "burglary" | "workmen_comp" | "group_personal_accident" | "group_health";

/** The product name Zoho keeps → the CRM's policy type. Unknown products stay "general_other" with the name kept. */
const TYPE_RULES: Array<[RegExp, PolicyType]> = [
  [/group mediclaim|\bgmc\b|\bghi\b/i, "group_health"],
  [/\bgpa\b|group p ?a\b|group personal/i, "group_personal_accident"],
  [/critical|criti care|cancer|cardiac/i, "critical_illness"],
  [/motor|two wheeler|four wheeler|\bcar\b|private car|vehicle/i, "motor"],
  [/travel/i, "travel"],
  [/personal accident|personal guard|accident care|nagarik suraksha|\bpa\b/i, "personal_accident"],
  [/workm[ae]n|employees? compensation|\bwc\b/i, "workmen_comp"],
  [/marine/i, "marine"],
  [/burglary/i, "burglary"],
  [/fire|s ?f ?& ?s ?p|laghu udyam|sookshma udyam|griha raksha|home insurance|householder/i, "fire"],
  [/health|medi ?claim|medicare|mediclassic|medi classic|optima|care|floater|star|assure|hospital cash|diabetes|senior citizen|top.?up|surplus|my health/i, "health"],
  [/ulip/i, "ulip"],
  [/term/i, "term"],
  [/life/i, "life_other"],
];

export function policyTypeOf(product: string, module?: string): PolicyType {
  switch (module) {
    case "Health_Insurance": return /critical/i.test(product) ? "critical_illness" : "health";
    case "Motor_Insurance": return "motor";
    case "WC_Insurance": return "workmen_comp";
    case "Travel_Insurance": return "travel";
    case "Personal_Accident_Policy": return "personal_accident";
    case "Marine_Insurance": return "marine";
    case "Fire_Insurance": return "fire";
  }
  // "Bharat Griha Raksha" is a home policy — fire-and-allied in the firm's MIS, but the CRM has "home".
  if (/griha raksha|home insurance/i.test(product)) return "home";
  for (const [re, t] of TYPE_RULES) if (re.test(product)) return t;
  return "general_other";
}

/** Zoho's short insurer names → the company's name. */
const INSURERS: Array<[RegExp, string]> = [
  [/^bajaj/i, "Bajaj Allianz General Insurance"],
  [/^go ?digit/i, "Go Digit General Insurance"],
  [/^oriental/i, "The Oriental Insurance Company"],
  [/^tata/i, "Tata AIG General Insurance"],
  [/^star/i, "Star Health and Allied Insurance"],
  [/^icici/i, "ICICI Lombard General Insurance"],
  [/^reliance/i, "Reliance General Insurance"],
  [/^hdfc/i, "HDFC ERGO General Insurance"],
  [/^future/i, "Future Generali India Insurance"],
  [/^sbi/i, "SBI General Insurance"],
  [/^liberty/i, "Liberty General Insurance"],
  [/^zuno/i, "Zuno General Insurance"],
  [/^chola/i, "Cholamandalam MS General Insurance"],
  [/^iffco/i, "IFFCO Tokio General Insurance"],
  [/^united/i, "United India Insurance"],
  [/^new india/i, "The New India Assurance"],
  [/^national/i, "National Insurance Company"],
  [/^sundaram/i, "Royal Sundaram General Insurance"],
  [/^apollo/i, "Apollo Munich Health Insurance"],
  [/^care/i, "Care Health Insurance"],
  [/^niva|^max bupa/i, "Niva Bupa Health Insurance"],
  [/^aditya/i, "Aditya Birla Health Insurance"],
  [/^manipal|^cigna/i, "ManipalCigna Health Insurance"],
  [/^lic\b|life insurance corporation/i, "Life Insurance Corporation of India"],
];
export function insurerName(v: string): string {
  const s = na(v);
  if (!s) return "";
  for (const [re, name] of INSURERS) if (re.test(s)) return name;
  return s;
}

const FREQ: Record<string, "single" | "annual" | "semi_annual" | "quarterly" | "monthly"> = {
  yearly: "annual",
  "half yearly": "semi_annual",
  quaterly: "quarterly",
  quarterly: "quarterly",
  monthly: "monthly",
  single: "single",
};

/** "2027-08-03" − 1 year + 1 day = "2026-08-04" (a one-year policy's start). */
function startFromExpiry(expiry: string): string {
  const d = new Date(`${expiry}T00:00:00Z`);
  d.setUTCFullYear(d.getUTCFullYear() - 1);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}
function expiryFromStart(start: string, months = 12): string {
  const d = new Date(`${start}T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + months);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

export type MappedPolicy = {
  zohoId: string;
  module: string;
  policyNumber: string | null;
  clientZohoId: string;
  clientName: string;
  owner: string;
  agentEmail: string;
  insurer: string;
  planName: string;
  policyType: PolicyType;
  sumAssured: number | null;
  premium: number | null;
  frequency: "single" | "annual" | "semi_annual" | "quarterly" | "monthly";
  startDate: string | null;
  /** The policy's expiry / renewal date — when the next premium falls due. */
  renewalDate: string | null;
  startDerived: boolean;
  maturityDate: string | null;
  termYears: number | null;
  payingTermYears: number | null;
  nominee: { name: string; relation: string | null; dob: string | null } | null;
  details: Record<string, unknown>;
  remarks: string | null;
  test: boolean;
};

const looksLikeTest = (policyNo: string) => /^(test|demo|dd|\d)$/i.test(policyNo.trim());

/** One record of the Insurance register or a line module (`_module` set on line-module records). */
export function mapIoPolicy(raw: ZohoRecord): MappedPolicy {
  const r = ioUsers(raw);
  const zModule = cell(r._module) || "Insurance";
  const register = zModule === "Insurance";
  const client = ref(register ? r.Client_Name : r.Policy_Holder_Name);
  const product = na(register ? r.Policy : r.Product) || na(r.Plan_Name1) || na(r.Plan_Name);
  const plan = na(r.Plan_Name1) || na(r.Plan_Name) || product;
  const policyType = policyTypeOf(product || zModule, register ? undefined : zModule);
  let start = isoDate(na(r.DOC) || na(r.Commencement_Date) || na(r.Policy_Start_Date)) ?? null;
  let renewal = isoDate(na(r.FUP) || na(r.Renewal_Expiry_Date) || na(r.Date_7)) ?? null;
  const termMonths = num(r.Policy_Term_in_months);
  let startDerived = false;
  // General insurance runs a year: a policy with one of the two dates gets the other.
  const life = policyType === "term" || policyType === "ulip" || policyType === "life_other";
  if (!life) {
    if (!start && renewal) { start = startFromExpiry(renewal); startDerived = true; }
    if (start && !renewal) renewal = expiryFromStart(start, termMonths > 0 && termMonths <= 36 ? termMonths : 12);
  }
  const type = key(na(r.Type));
  const businessType = /renew/.test(type) ? "renewal" : /new/.test(type) ? "new" : /port|migrat|rollover/.test(type) ? "portability" : null;
  const nomineeName = na(r.Nominee_Name);
  const details: Record<string, unknown> = {
    zohoId: zohoId(r.id),
    zohoModule: zModule,
    ...(product ? { zohoProduct: product } : {}),
    ...(businessType ? { businessType } : {}),
    ...(na(r.Type) ? { zohoType: na(r.Type) } : {}),
    ...(num(r.Bacic_Premium) || num(r.Basic_Premium) ? { basicPremium: num(r.Bacic_Premium) || num(r.Basic_Premium) } : {}),
    ...(na(r.Payment_Mode) ? { paymentMode: na(r.Payment_Mode) } : {}),
    ...(na(r.Payment_Date) ? { paymentDate: na(r.Payment_Date) } : {}),
    ...(na(r.Agency) || na(r.Agent_Code) ? { agency: na(r.Agency) || na(r.Agent_Code) } : {}),
    ...(na(r.Previous_Policy_No) ? { previousPolicyNo: na(r.Previous_Policy_No) } : {}),
    ...(na(r.Family_Floter) || na(r.Family_Floater) ? { familyFloater: na(r.Family_Floter) || na(r.Family_Floater) } : {}),
    ...(na(r.Login_Date) ? { issueDate: na(r.Login_Date) } : {}),
    // Motor
    ...(na(r.Vehicle_No) ? { vehicleRegNo: na(r.Vehicle_No) } : {}),
    ...(na(r.Vehicle_Make) || na(r.Vehicle_Model) ? { makeModel: [na(r.Vehicle_Make), na(r.Vehicle_Model)].filter(Boolean).join(" ") } : {}),
    ...(na(r.Vehicle_Type) ? { vehicleType: na(r.Vehicle_Type) } : {}),
    ...(na(r.Vehicle_Policy_Type) ? { coverType: na(r.Vehicle_Policy_Type) } : {}),
    ...(na(r.Fuel_Type) ? { fuelType: na(r.Fuel_Type) } : {}),
    ...(num(r.Year_of_Manufacturer) ? { yearOfManufacture: num(r.Year_of_Manufacturer) } : {}),
    ...(num(r.IDV) ? { idv: num(r.IDV) } : {}),
    ...(num(r.NCB) ? { ncbPercent: num(r.NCB) } : {}),
    ...(num(r.Basic_Third_Party_Premium_TP) ? { tpPremium: num(r.Basic_Third_Party_Premium_TP) } : {}),
    ...(na(r.Chassis_Number) ? { chassisNumber: na(r.Chassis_Number) } : {}),
    ...(na(r.Engine_Number) ? { engineNumber: na(r.Engine_Number) } : {}),
    ...(Array.isArray(r.Add_ons) && r.Add_ons.length ? { addOns: r.Add_ons } : {}),
    ...(startDerived ? { startDateFrom: "renewal date" } : {}),
  };
  const agent = na(r.Agency) || na(r.Agent_Code);
  return {
    zohoId: zohoId(r.id),
    module: zModule,
    policyNumber: na(r.Name) || null,
    clientZohoId: client.id,
    clientName: client.name,
    owner: ref(r.Owner).name,
    agentEmail: agent ? personEmail(agent.replace(/\s*-.*$/, "")) : "",
    insurer: insurerName(cell(r.Insurance_Company)),
    planName: (plan || product || "Policy").slice(0, 300),
    policyType,
    sumAssured: num(r.Sum_Assured) || num(r.Sum_Insured) || null,
    premium: num(r.Total_Premium) || num(r.Bacic_Premium) || num(r.Basic_Premium) || null,
    frequency: FREQ[key(na(r.Mode))] ?? "annual",
    startDate: start,
    renewalDate: renewal,
    startDerived,
    maturityDate: isoDate(na(r.Date_of_maturity)) ?? null,
    termYears: num(r.Term) || null,
    payingTermYears: num(r.Premium_Paying_Term) || null,
    nominee: nomineeName ? { name: nomineeName, relation: na(r.Nominee_Relation) || null, dob: isoDate(na(r.Nominee_Birth_Date)) ?? null } : null,
    details,
    remarks: [startDerived ? "Start date worked out from Zoho's renewal date (one-year policy)." : "", na(r.Remarks)].filter(Boolean).join(" ") || null,
    test: looksLikeTest(cell(r.Name)),
  };
}

// ── Claims ───────────────────────────────────────────────────────────────

export type MappedClaim = {
  zohoId: string;
  title: string;
  owner: string;
  clientZohoId: string;
  clientName: string;
  holderZohoId: string;
  policyNumber: string | null;
  insurer: string;
  status:
    | "claim_intimated" | "file_awaited" | "file_received" | "add_info_awaited" | "query" | "under_process"
    | "settled_fully" | "settled_partially" | "rejected" | "withdrawn";
  claimType: "main_claim" | "supplementary" | "other";
  claimMode: "cashless" | "reimbursement" | null;
  intimationMode: "email" | "portal" | "phone" | null;
  admissionDate: string | null;
  intimationDate: string | null;
  submissionDate: string | null;
  settlementDate: string | null;
  claimed: number;
  settled: number;
  comments: string | null;
  policyDetails: string | null;
  details: Record<string, unknown>;
};

/** Zoho claim status (+ "Recent Claim Status", "Claim Status" Open/Close) → the CRM's. */
export function claimStatusOf(r: ZohoRecord): MappedClaim["status"] {
  const s = key(`${na(r.Status)} ${na(r.Recent_Claim_Status)}`);
  const settledAmt = num(r.Settled_Amount) || num(r.Settlement_Amount);
  const claimed = num(r.Claim_Amount);
  if (/settled/.test(s)) return claimed > 0 && settledAmt > 0 && settledAmt < claimed ? "settled_partially" : "settled_fully";
  if (/reject|repudiat/.test(s)) return "rejected";
  if (/withdraw/.test(s)) return "withdrawn";
  if (/query/.test(s)) return "query";
  if (/document pending|doc.* pending/.test(s)) return "add_info_awaited";
  if (/in process|under process|pre-post|uploaded/.test(s)) return "under_process";
  if (/file recieved|file received/.test(s)) return "file_received";
  if (/pending/.test(s)) return "file_awaited";
  if (key(na(r.Claim_Status)) === "close") return "settled_fully";
  return "claim_intimated";
}

export function mapIoClaim(raw: ZohoRecord): MappedClaim {
  const r = ioUsers(raw);
  const holder = ref(r.Policy_Holder_Name);
  const claimant = ref(r.Claim_Holder_Name);
  const insured = ref(r.Insured_Name);
  const client = holder.id ? holder : claimant.id ? claimant : insured;
  const type = key(na(r.Claim_Type));
  const job = key(na(r.Job_Transaction_Type));
  const mode = key(na(r.Intimation_Mode));
  const lines = [
    na(r.Note),
    na(r.Remarks),
    na(r.Diagnosis_Loss_Details) ? `Diagnosis / loss: ${na(r.Diagnosis_Loss_Details)}` : "",
    na(r.Hospital_Name) ? `Hospital / garage: ${na(r.Hospital_Name)}` : "",
    na(r.Doctor_Name) && na(r.Doctor_Name).toLowerCase() !== "doctor" ? `Doctor: ${na(r.Doctor_Name)}` : "",
    na(r.Patient_Name) ? `Patient: ${na(r.Patient_Name)}` : claimant.id && claimant.id !== client.id ? `Claimant: ${claimant.name}` : "",
    num(r.Deduction) ? `Deduction ₹${num(r.Deduction)}` : "",
    na(r.Recent_Claim_Status) ? `Zoho: ${na(r.Recent_Claim_Status)}` : "",
  ].filter(Boolean);
  return {
    zohoId: zohoId(r.id),
    title: na(r.Name) || "Claim",
    owner: ref(r.Owner).name,
    clientZohoId: client.id,
    clientName: client.name,
    holderZohoId: holder.id,
    policyNumber: na(r.Policy_No) || null,
    insurer: insurerName(cell(r.Company)),
    status: claimStatusOf(r),
    claimType: job === "claim" || !job ? "main_claim" : /additional/.test(job) ? "supplementary" : "other",
    claimMode: /cashless/.test(type) ? "cashless" : /reum|reim/.test(type) ? "reimbursement" : null,
    intimationMode: mode === "email" ? "email" : mode === "portal" ? "portal" : /toll/.test(mode) ? "phone" : null,
    admissionDate: isoDate(na(r.Admission_Date_Loss_Date) || na(r.Date_of_Admitted)) ?? null,
    intimationDate: isoDate(na(r.Claim_Intimation_Date) || na(r.Intimation_Date)) ?? null,
    submissionDate: isoDate(na(r.Submission_Date) || na(r.File_Recieved_Date)) ?? null,
    settlementDate: isoDate(na(r.Claim_Settlement_Date) || na(r.Settlement_Date)) ?? null,
    claimed: num(r.Claim_Amount) || num(r.Settlement_Amount),
    settled: num(r.Settled_Amount) || (/settled/i.test(`${na(r.Status)} ${na(r.Recent_Claim_Status)}`) ? num(r.Settlement_Amount) : 0),
    comments: lines.join("\n").slice(0, 4000) || null,
    policyDetails: [na(r.Product_Name), na(r.Policy_Type), na(r.Policy_Period_From_Date) && na(r.Policy_Period_To_Date) ? `${na(r.Policy_Period_From_Date)} to ${na(r.Policy_Period_To_Date)}` : "", num(r.Sum_Insured) ? `Sum insured ₹${num(r.Sum_Insured)}` : ""].filter(Boolean).join(" · ") || null,
    details: {
      zohoId: zohoId(r.id),
      claimNo: na(r.Claim_No) || undefined,
      intimationNo: na(r.Claim_Intimation_No) || undefined,
      intimationBy: na(r.Intimation_By) || undefined,
      job: na(r.Job_Transaction_Type) || undefined,
    },
  };
}

// ── Tasks ────────────────────────────────────────────────────────────────

const TASK_STATUS: Record<string, MappedTask["status"]> = {
  "not started": "open",
  "in progress": "in_progress",
  "waiting for input": "in_progress",
  "awaiting input": "in_progress",
  completed: "completed",
  deferred: "cancelled",
};

/** Zoho's own Tasks module (reminders the firm set itself: SIP, birthday report, STP / SWP checks). */
export function mapIoTask(raw: ZohoRecord): MappedTask {
  const r = ioUsers(raw);
  const status = na(r.Status);
  const who = ref(r.Who_Id);
  const what = r.What_Id && typeof r.What_Id === "object" ? (r.What_Id as Record<string, unknown>) : {};
  const assignee = personEmail(na(r.Assigned_To)) || personEmail(na(r.Back_Office_Owner));
  const p = key(na(r.Priority));
  const due = when(r.Due_Date);
  return {
    zohoId: zohoId(r.id),
    number: "",
    title: (na(r.Subject) || "Zoho task").slice(0, 300),
    owner: ref(r.Owner).name,
    assignee: assignee || ref(r.Owner).name,
    clientZohoId: who.id,
    clientName: who.name,
    leadZohoId: /lead/i.test(cell(what.module)) ? ref(r.What_Id).id : "",
    status: TASK_STATUS[key(status)] ?? "open",
    statusText: status,
    priority: p === "high" || p === "highest" ? "high" : p === "low" || p === "lowest" ? "low" : "normal",
    department: na(r.Back_Office_Owner) ? "back_office" : null,
    start: when(r.Start_Date_Time) ?? due,
    // The task's due date; a finished one, when it was closed.
    end: (TASK_STATUS[key(status)] === "completed" ? when(r.Closed_Time) : null) ?? due ?? when(r.End_Date),
    created: when(r.Created_Time),
    description: [na(r.Description), na(r.Tim) ? `Time: ${na(r.Tim)}` : ""].filter(Boolean).join("\n").slice(0, 8000) || null,
    remarks: null,
    meta: {
      zohoId: zohoId(r.id),
      zohoTask: `Task ${zohoId(r.id)}`,
      zohoModule: "Tasks",
      zohoStatus: status || undefined,
      ...(na(r.Assigned_To) ? { zohoAssignedTo: na(r.Assigned_To) } : {}),
      ...(na(r.Back_Office_Owner) ? { zohoBackOffice: na(r.Back_Office_Owner) } : {}),
    },
  };
}

/** Task Type → the CRM department. */
const IO_DEPARTMENT: Record<string, string> = {
  financial: "operations",
  "non financial": "back_office",
  queries: "support",
  reports: "back_office",
  "life insurance": "operations",
  "gi claim": "operations",
  "gi financial": "operations",
  "gi non-financial": "back_office",
  "gi insurance - new business": "sales",
  "gi insurance - renewal": "operations",
  "gi marketing / business development": "marketing",
};

/** The "IO Task" service desk (Task_Assignment): the team's own work queue. */
export function mapIoAssignment(raw: ZohoRecord): MappedTask {
  const r = ioUsers(raw);
  const status = na(r.Status);
  const kind = na(r.Type) === "Other" || na(r.Type) === "Others" ? na(r.Other_Task) || na(r.Other_Query) || na(r.Type) : na(r.Type);
  const detail = [na(r.Servicing_Transaction_Type), na(r.Client_Life_Claim_Type)].filter(Boolean).join(" · ");
  const title = [na(r.Task_Type), kind, detail].filter(Boolean).join(" — ") || "IO task";
  const created = when(r.Date) ?? when(r.Start_Date);
  const closed = when(r.Closing_Date);
  // Zoho leaves the status blank on many finished rows that have a closing date.
  const mapped: MappedTask["status"] = TASK_STATUS[key(status)] ?? (closed ? "completed" : "open");
  return {
    zohoId: zohoId(r.id),
    number: na(r.Name),
    title: title.slice(0, 300),
    owner: ref(r.Assign_By).name || ref(r.Owner).name,
    assignee: ref(r.Owner).name,
    clientZohoId: ref(r.Client_Name).id,
    clientName: ref(r.Client_Name).name,
    leadZohoId: ref(r.Lead).id,
    status: mapped,
    statusText: status,
    priority: "normal",
    department: IO_DEPARTMENT[key(na(r.Task_Type))] ?? null,
    start: when(r.Start_Date) ?? created,
    end: closed,
    created,
    description: [na(r.Remarks), na(r.Required_Input) ? `Required input: ${na(r.Required_Input)}` : "", na(r.Other_Query) && kind !== na(r.Other_Query) ? `Query: ${na(r.Other_Query)}` : ""]
      .filter(Boolean).join("\n").slice(0, 8000) || null,
    remarks: null,
    meta: {
      zohoId: zohoId(r.id),
      zohoTask: na(r.Name),
      zohoModule: "Task_Assignment",
      zohoStatus: status || undefined,
      zohoType: na(r.Type) || undefined,
      zohoTaskType: na(r.Task_Type) || undefined,
      transactThrough: na(r.Through) || undefined,
    },
  };
}

// ── Notes ────────────────────────────────────────────────────────────────

export type MappedNote = {
  zohoId: string;
  owner: string;
  parentModule: string;
  parentZohoId: string;
  text: string;
  at: Date | null;
};

export function mapIoNote(raw: ZohoRecord): MappedNote {
  const r = ioUsers(raw);
  const parent = (r.Parent_Id && typeof r.Parent_Id === "object" ? r.Parent_Id : {}) as Record<string, unknown>;
  const mod = parent.module && typeof parent.module === "object" ? cell((parent.module as Record<string, unknown>).api_name) : cell(parent.module);
  return {
    zohoId: zohoId(r.id),
    owner: ref(r.Owner).name,
    parentModule: mod,
    parentZohoId: zohoId(parent.id),
    text: [na(r.Note_Title), na(r.Note_Content)].filter(Boolean).join(" — ").slice(0, 8000),
    at: when(r.Created_Time),
  };
}

// ── Meetings → the export-shaped rows run-meetings.ts reads ──────────────

/** One Events record → the row mapZohoMeeting reads. */
export function ioMeetingRow(raw: ZohoRecord): Record<string, unknown> {
  const r = ioUsers(raw);
  const who = ref(r.Who_Id);
  const what = ref(r.What_Id);
  const notes = [
    na(r.Description),
    na(r.Key_Discussion_Points) ? `Key discussion points: ${na(r.Key_Discussion_Points)}` : "",
    na(r.Next_Steps_for_Action) ? `Next steps: ${na(r.Next_Steps_for_Action)}` : "",
  ].filter(Boolean).join("\n\n");
  return {
    "Record Id": zohoId(r.id),
    Host: ref(r.Owner).name,
    Title: na(r.Event_Title),
    "Contact Name.id": who.id,
    "Contact Name": who.name,
    "Related To": what.name,
    From: na(r.Start_DateTime),
    To: na(r.End_DateTime),
    "All day": r.All_day === true ? "true" : "false",
    "Meeting Status": na(r.Meeting_Status) === "Due" ? "" : na(r.Meeting_Status),
    "Checked In Status": na(r.Check_In_Status) === "PLANNED" ? "" : na(r.Check_In_Status),
    "Meeting Venue": na(r.Meeting_Venue__s),
    Location: na(r.Venue),
    "Meeting Type": na(r.Meeting_Type),
    Description: notes,
  };
}

// ── Leads → the record shape the shared lead mapper (modules.ts mapLead) reads ──

const LEAD_PRODUCT: Record<string, string> = {
  mf: "Mutual Fund",
  motor: "Motor Insurance",
  "non-motor": "Non-Motor Insurance",
  "health and pa": "Health and PA Insurance",
  li: "Life Insurance",
  insurance: "Insurance",
};

/**
 * The firm keeps three status fields (MF, Insurance, LI) and the product in
 * "Product"; the lead's owner is its CFE when set, as for clients.
 */
export function ioLeadRecord(raw: ZohoRecord): ZohoRecord {
  const r = ioUsers(raw);
  const product = na(r.Product);
  const extra = [
    na(r.Contact_Person_Name) ? `Contact person: ${na(r.Contact_Person_Name)}` : "",
    na(r.Lead_Source_Specification) ? `Source detail: ${na(r.Lead_Source_Specification)}` : "",
    na(r.Type) ? `Type: ${na(r.Type)}` : "",
  ].filter(Boolean).join("\n");
  return {
    ...r,
    Owner: r.CFE && typeof r.CFE === "object" ? r.CFE : r.Owner,
    Lead_Status: na(r.Lead_Status) || na(r.Insurance_Lead_Status) || na(r.LIC_Lead_Status),
    Expected_Business: product ? LEAD_PRODUCT[key(product)] ?? product : "",
    Remarks: extra,
  };
}
