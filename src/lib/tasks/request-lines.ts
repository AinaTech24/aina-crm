/**
 * The request TABLE — one task, many requests (flag `taskRequestTable`;
 * Investment Options, 2026-11-25). Safe for server and client.
 *
 * Zoho-style subform: each row is one request — a SIP, a lumpsum, a redemption,
 * a nominee update, a policy renewal — with its own family member, scheme,
 * amount, folio and mode. One client visit (or one family) is one task.
 *
 * What the rest of the CRM sees:
 *  - tasks.type — the request's own key when every row is the same request, so
 *    a task of three SIPs is a `sip_registration` like any other. Mixed rows are
 *    `multi_financial` (any row moves money) or `multi_service` (none does).
 *  - meta.request.lines — the rows (RequestLine).
 *  - meta.boValue — the total amount; meta.boChannel — the mode, when every
 *    row that has one agrees.
 *  - Business entries — one draft per (member, product) from the rows whose
 *    request books business (lib/tasks/book-business bookBusinessFromLines).
 *  - The checklist — each distinct request's own sub-tasks, then one
 *    "RTA data check".
 */

import {
  CATEGORY_LABEL,
  MULTI_FINANCIAL,
  MULTI_SERVICE,
  REDEMPTION_ROUTE_CHECKLISTS,
  REQUEST_TYPE_BY_KEY,
  RTA_DATA_CHECK,
  fieldLabel,
  rowFieldLabel,
  type RequestType,
} from "./request-types";

/** The per-firm flag (config/feature-flags.ts). */
export const TASK_REQUEST_TABLE_FLAG = "taskRequestTable";

export { MULTI_FINANCIAL, MULTI_SERVICE };

export type LineMode = "online" | "offline" | "physical";

/** One row as stored on the task (meta.request.lines). */
export type RequestLine = {
  /** The client the row is for — the task's client or a member of their family. */
  investorId: string;
  investorName: string;
  requestKey: string;
  schemeName?: string;
  schemeCode?: string;
  amcName?: string;
  assetCategory?: string;
  fromSchemeName?: string;
  fromSchemeCode?: string;
  amount?: number;
  units?: number;
  allUnits?: boolean;
  /** Folio — or the policy number for an insurance request. */
  folio?: string;
  sipDay?: string;
  frequency?: string;
  /** Online / offline; KYC: online / physical. */
  mode?: LineMode;
  note?: string;
};

/** The columns a request uses (what the table asks on its row). */
export type LineColumn = "scheme" | "fromScheme" | "amount" | "units" | "sipDay" | "frequency" | "folio" | "mode";

export function lineColumns(req: RequestType | undefined): Set<LineColumn> {
  const s = new Set<LineColumn>();
  if (!req) return s;
  for (const f of req.rowFields) {
    if (f === "scheme" || f === "fromScheme" || f === "amount" || f === "units" || f === "sipDay" || f === "frequency" || f === "folio") s.add(f);
  }
  if (req.fields.includes("amount")) s.add("amount");
  if (req.fields.includes("folio")) s.add("folio");
  if (req.fields.includes("mode") || req.key === "kyc_renewal") s.add("mode");
  return s;
}

/** The mode choices a request offers ("Online / Physical" for a KYC). */
export function modeOptions(requestKey: string): Array<[LineMode, string]> {
  return requestKey === "kyc_renewal"
    ? [["online", "Online KYC"], ["physical", "Physical KYC"]]
    : [["online", "Online"], ["offline", "Offline"]];
}

/** Placeholder / header text for a column on a given request's row. */
export function lineColumnLabel(c: LineColumn, req: RequestType | undefined): string {
  if (!req) return "";
  if (c === "mode") return req.key === "kyc_renewal" ? "KYC" : "Mode";
  if (c === "folio") return req.category === "insurance" ? fieldLabel("folio", req) : "Folio";
  if (c === "amount") return req.rowFields.includes("amount") ? "Amount" : fieldLabel("amount", req).replace(/\s*\(₹\)$/, "");
  return rowFieldLabel(c, req);
}

/** The stored task type for these rows. */
export function taskTypeForLines(lines: Pick<RequestLine, "requestKey">[]): string {
  const keys = [...new Set(lines.map((l) => l.requestKey).filter(Boolean))];
  if (keys.length === 1) return keys[0];
  if (keys.some((k) => REQUEST_TYPE_BY_KEY[k]?.category === "financial")) return MULTI_FINANCIAL;
  return MULTI_SERVICE;
}

/**
 * The starting sub-tasks: one request's own list; several requests each bring
 * theirs, named by the request ("SIP registration · Mandate in place…"), and
 * the RTA data check comes once, at the end. A redemption whose rows say
 * Online or Offline takes that route's list (redemptionOnlineOffline flag).
 */
export function checklistForLines(lines: Pick<RequestLine, "requestKey" | "mode">[], opts: { redemptionRoute?: boolean } = {}): string[] {
  const keys = [...new Set(lines.map((l) => l.requestKey).filter((k) => REQUEST_TYPE_BY_KEY[k]))];
  const listFor = (k: string): string[] => {
    if (k === "redemption" && opts.redemptionRoute) {
      const modes = new Set(lines.filter((l) => l.requestKey === k).map((l) => l.mode));
      if (modes.size === 1 && (modes.has("online") || modes.has("offline"))) return REDEMPTION_ROUTE_CHECKLISTS[[...modes][0] as "online" | "offline"];
    }
    return REQUEST_TYPE_BY_KEY[k].checklist;
  };
  if (keys.length === 1) return listFor(keys[0]);
  const out: string[] = [];
  let rta = false;
  for (const k of keys) {
    for (const item of listFor(k)) {
      if (item === RTA_DATA_CHECK) { rta = true; continue; }
      out.push(`${REQUEST_TYPE_BY_KEY[k].label} · ${item}`);
    }
  }
  if (rta) out.push(RTA_DATA_CHECK);
  return out;
}

/** "SIP registration — Rajesh Patel"; "SIP registration, Purchase (lumpsum) + 1 more — Rajesh Patel & family". */
export function titleForLines(lines: Pick<RequestLine, "requestKey" | "investorId" | "mode">[], clientName: string): string {
  const keys = [...new Set(lines.map((l) => l.requestKey).filter((k) => REQUEST_TYPE_BY_KEY[k]))];
  if (!keys.length) return "";
  const label = (k: string) => {
    if (k === "kyc_renewal" && keys.length === 1) {
      const modes = new Set(lines.filter((l) => l.requestKey === k).map((l) => l.mode));
      if (modes.size === 1 && modes.has("online")) return "Online KYC";
      if (modes.size === 1 && modes.has("physical")) return "Physical KYC";
    }
    return REQUEST_TYPE_BY_KEY[k].label;
  };
  const shown = keys.slice(0, 2).map(label).join(", ");
  const more = keys.length > 2 ? ` + ${keys.length - 2} more` : "";
  const members = new Set(lines.map((l) => l.investorId).filter(Boolean));
  const who = clientName ? ` — ${clientName}${members.size > 1 ? " & family" : ""}` : "";
  return `${shown}${more}${who}`;
}

/** The total amount across the rows (null when no row has one). */
export function totalOfLines(lines: Pick<RequestLine, "amount">[]): number | null {
  const xs = lines.map((l) => l.amount).filter((a): a is number => typeof a === "number" && Number.isFinite(a));
  return xs.length ? xs.reduce((s, a) => s + a, 0) : null;
}

/** The task's mode: every row that has an online/offline mode agrees, else none. */
export function channelOfLines(lines: Pick<RequestLine, "mode">[]): "online" | "offline" | null {
  const ms = new Set(lines.map((l) => l.mode).filter((m): m is "online" | "offline" => m === "online" || m === "offline"));
  return ms.size === 1 ? [...ms][0] : null;
}

/** What a row is missing, in the table's own words — null when it is complete. */
export function lineProblem(l: RequestLine, i: number): string | null {
  const req = REQUEST_TYPE_BY_KEY[l.requestKey];
  const n = `Row ${i + 1}`;
  if (!req) return `${n}: pick the request.`;
  if (!l.investorId) return `${n}: pick who it is for.`;
  const cols = lineColumns(req);
  if (cols.has("scheme") && !l.schemeName?.trim()) return `${n}: pick the ${req.catalog === false ? "product" : "scheme"}.`;
  if (cols.has("fromScheme") && !l.fromSchemeName?.trim()) return `${n}: pick the scheme it moves from.`;
  if (req.key === "kyc_renewal" && !l.mode) return `${n}: choose Online KYC or Physical KYC.`;
  return null;
}

export const categoryLabelOf = (key: string) => {
  const r = REQUEST_TYPE_BY_KEY[key];
  return r ? CATEGORY_LABEL[r.category] : "";
};
