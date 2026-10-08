/**
 * The canonical SIP Master (Phase 3D) — one registration per registrar
 * registration, built from every registration report and instalment row the
 * firm receives, and the Active SIP Book derived from it. Pure: no database,
 * no clock (the "as of" date is an argument).
 *
 * Evidence (real mailbacks, 2026-10-08; docs/rta/PHASE3D_SOURCE_SELECTION.md):
 *   - KFintech's registration id is MFSD243 `RegSlno`, the same value MFSD201
 *     prints as `sipregslno` on every instalment (8 of 9 registrations seen in
 *     both; STP legs share their registration's id 16/16). Key:
 *     `reg:kfintech:<Fund>:<RegSlno>`.
 *   - CAMS WBR49's id is `auto_trno`. R2's `siptrxnno` is a DIFFERENT number
 *     whose link to auto_trno is not evidenced, so R2 instalments are keyed in
 *     their own namespace (`sipref:cams:…`) and never merged into a WBR49
 *     registration by guesswork.
 *   - MFSD230 has no id and no status. Its rows attach to a keyed registration
 *     only on a UNIQUE exact match of (registrar, AMC, folio, scheme, amount,
 *     frequency, start date); otherwise they stay unkeyed and their state is
 *     UNKNOWN. Two candidates is an exception, never a pick.
 *   - Overlapping files describe the same registration more than once; the
 *     master holds it ONCE. Attributes and status come from the latest dated
 *     observation; the earliest registration date is kept; a contradiction in
 *     what cannot change (AMC, folio, scheme) is an exception.
 *   - State is `sipStateOn` (sip-lifecycle.ts): a future start is PENDING, no
 *     status is UNKNOWN, a failed instalment never stops a registration.
 *
 * The Active SIP Book counts kind SIP in state ACTIVE — nothing else: not an
 * STP or SWP, not a PENDING SIP, not an UNKNOWN one. Those are reported beside
 * it, never folded in.
 */
import { monthlySipAmount } from "@/lib/metrics/sip";
import { sipStateOn, type SipState } from "./sip-lifecycle";

/**
 * SIP Master states (Phase 3F). ACTIVE here is VERIFIED active: a registrar
 * status or lifecycle report that speaks for the date. OBSERVED_ACTIVITY is a
 * processed instalment within one cycle of the date while the registration's
 * status is NOT verified — activity on the instalment's date, not proof of the
 * registration's status today. A missing instalment never makes a SIP
 * stopped: STOPPED needs a registrar cease / terminate date or status.
 */
export type MasterState = SipState | "OBSERVED_ACTIVITY";

/** One cycle of a frequency, in days, with a grace for debit dates and holidays. */
export function cycleWindowDays(frequency: Frequency | null, fallback = 35): number {
  const period = frequency === "weekly" ? 7 : frequency === "fortnightly" ? 14 : frequency === "monthly" ? 31 : frequency === "quarterly" ? 92 : frequency === "yearly" ? 366 : null;
  return period == null ? fallback : Math.ceil(period * 1.25) + 5;
}
import type { NormRow } from "./staging/layouts";

export type RegistrationSource = "cams.wbr49" | "kfintech.mfsd243" | "kfintech.mfsd230";
export type SipKind = "sip" | "stp" | "swp" | "other" | "unknown";
export type Frequency = "monthly" | "weekly" | "fortnightly" | "quarterly" | "yearly";

/** One registration as one report printed it. */
export type RegistrationObservation = {
  source: RegistrationSource;
  /** The report's own date (mail / report date) — the date its status speaks for. */
  reportDate: string;
  rta: "cams" | "kfintech";
  amcCode: string;
  /** auto_trno / RegSlno; null where the report has none (MFSD230). */
  registrationId: string | null;
  folio: string;
  scheme: string;
  targetScheme?: string | null;
  /** aut_trntyp (CAMS) / Trtype (KFintech), as printed. */
  kindCode: string;
  amount: number | null;
  frequencyText: string;
  startDate: string | null;
  endDate?: string | null;
  registeredOn?: string | null;
  statusText?: string | null;
  ceaseDate?: string | null;
  terminateDate?: string | null;
  pauseFrom?: string | null;
  pauseTo?: string | null;
  totalInstalments?: number | null;
  paidInstalments?: number | null;
  pendingInstalments?: number | null;
};

/** One instalment as a transaction file reported it. */
export type InstalmentEvent = {
  rta: "cams" | "kfintech";
  amcCode: string;
  /** sipregslno (KFintech) or siptrxnno (CAMS R2); null when the row has none. */
  registrationRef: string | null;
  folio: string;
  scheme: string;
  date: string;
  outcome: "processed" | "rejected";
  amount: number | null;
  /** Minimised registrar reason for a rejected instalment. */
  reason?: string;
  /** What the instalment says the registration is (SIN → sip, STPA/STPO → stp, SWD → swp). */
  kind?: SipKind;
};

export type MasterException = {
  code:
    | "registration_attribute_conflict"
    | "unkeyed_ambiguous"
    | "unknown_kind"
    | "unknown_frequency"
    | "instalment_unlinked"
    | "registration_not_described";
  key: string;
  detail: string;
};

export type LifecycleEvent = { kind: "stop" | "pause" | "instalment_rejected" | "registration_rejected"; date: string | null; source: string };

export type SipMasterEntry = {
  key: string;
  keyed: boolean;
  /** A registration report (MFSD243 / WBR49 / MFSD230) describes it. False = known only from its instalments. */
  described: boolean;
  /** The client and folio it belongs to, when the caller resolved them (owner rules of lib/rta/owner.ts). */
  owner: { investorId: string; folioId: string | null; rule: string } | null;
  /** The date the state speaks from: the status report's date, the stop / pause date, or the start date of a PENDING SIP. */
  statusEffectiveDate: string | null;
  lastSuccessfulInstalment: string | null;
  /** A processed instalment within the cycle window before the as-of date. */
  operational: boolean;
  /** Stops, pauses and rejections the registrar reported — never inferred. */
  lifecycleEvents: LifecycleEvent[];
  /** verified: described and its lifecycle stated in time · partial: keyed, but its status is not established · unverified: no registration id. */
  confidence: "verified" | "partial" | "unverified";
  rta: "cams" | "kfintech";
  amcCode: string;
  registrationId: string | null;
  folio: string;
  scheme: string;
  targetScheme: string | null;
  kind: SipKind;
  kindConfidence: "verified" | "inferred" | "none";
  amount: number | null;
  frequency: Frequency | null;
  startDate: string | null;
  endDate: string | null;
  registeredOn: string | null;
  status: { text: string; asOf: string; source: RegistrationSource } | null;
  ceaseDate: string | null;
  terminateDate: string | null;
  pauseFrom: string | null;
  pauseTo: string | null;
  /** MFSD230's counts, from its latest row (the only source of them). */
  instalmentCounts: { total: number | null; paid: number | null; pending: number | null; asOf: string } | null;
  instalments: { processed: number; rejected: number; lastProcessed: string | null; lastRejected: string | null; lastRejectionReason: string | null };
  sources: RegistrationSource[];
  observations: number;
  /** Date the latest observation speaks for. */
  lastSeen: string;
  /** Date of the latest report that states lifecycle (MFSD243 / WBR49); null if none did. */
  lifecycleAsOf: string | null;
  state: MasterState;
  stateBasis: string;
};

/**
 * How complete the master is, measured against the instalments: registrations
 * the transaction feeds prove exist (by reference) but no registration report
 * has described. Non-zero means the Active SIP Book is NOT the firm's whole book.
 */
export type MasterCoverage = Record<"cams" | "kfintech", { referencedByInstalments: number; describedInMaster: number; missingFromMaster: number }>;

export type SipMaster = { asOf: string; entries: SipMasterEntry[]; exceptions: MasterException[]; coverage: MasterCoverage };

/** Registration kind from the registrar's code. Only codes seen on real files are "verified". */
export function sipKind(rta: "cams" | "kfintech", code: string): { kind: SipKind; confidence: "verified" | "inferred" | "none" } {
  const c = (code ?? "").trim().toUpperCase();
  if (rta === "cams") {
    // WBR49 aut_trntyp. P verified on the 2026-10-08 sample; SO / R / DTP are
    // the meanings this importer has documented from earlier real WBR49 files.
    if (c === "P") return { kind: "sip", confidence: "verified" };
    if (c === "SO") return { kind: "stp", confidence: "inferred" };
    if (c === "R") return { kind: "swp", confidence: "inferred" };
    if (c === "DTP") return { kind: "other", confidence: "inferred" };
    return { kind: "unknown", confidence: "none" };
  }
  // MFSD243 / MFSD230 Trtype: SIP and STP verified; SWP is the plain word.
  if (c === "SIP") return { kind: "sip", confidence: "verified" };
  if (c === "STP") return { kind: "stp", confidence: "verified" };
  if (c === "SWP") return { kind: "swp", confidence: "inferred" };
  return { kind: "unknown", confidence: "none" };
}

/** Frequency from the registrar's text; anything else is null, never "monthly". */
export function sipFrequency(raw: string): Frequency | null {
  const f = (raw ?? "").trim().toLowerCase();
  if (f === "om" || f === "monthly" || f === "m") return "monthly";
  if (f === "ow" || f === "weekly" || f === "w") return "weekly";
  if (f === "of" || f === "fn" || f === "fortnightly") return "fortnightly";
  if (f === "oq" || f === "q" || f === "quarterly") return "quarterly";
  if (f === "oy" || f === "y" || f === "yearly" || f === "annual") return "yearly";
  return null;
}

const clean = (s: string | null | undefined) => (s ?? "").trim();
const regKey = (rta: string, amc: string, id: string) => `reg:${rta}:${clean(amc)}:${clean(id)}`;
/** Who an instalment's registration reference points at. CAMS R2 refs are their own namespace. */
const eventKey = (e: InstalmentEvent) =>
  e.rta === "kfintech" ? regKey("kfintech", e.amcCode, e.registrationRef ?? "") : `sipref:cams:${clean(e.amcCode)}:${clean(e.registrationRef)}`;

function blankEntry(key: string, o: RegistrationObservation, keyed: boolean): SipMasterEntry {
  return {
    key, keyed, described: true, owner: null, statusEffectiveDate: null, lastSuccessfulInstalment: null, operational: false,
    lifecycleEvents: [], confidence: "unverified",
    rta: o.rta, amcCode: clean(o.amcCode), registrationId: keyed ? clean(o.registrationId) : null,
    folio: clean(o.folio), scheme: clean(o.scheme), targetScheme: null,
    kind: "unknown", kindConfidence: "none", amount: null, frequency: null,
    startDate: null, endDate: null, registeredOn: null, status: null,
    ceaseDate: null, terminateDate: null, pauseFrom: null, pauseTo: null,
    instalmentCounts: null,
    instalments: { processed: 0, rejected: 0, lastProcessed: null, lastRejected: null, lastRejectionReason: null },
    sources: [], observations: 0, lastSeen: o.reportDate, lifecycleAsOf: null, state: "UNKNOWN", stateBasis: "",
  };
}

/** Fold one observation into its entry: latest dated observation wins, earliest registration date kept. */
function absorb(e: SipMasterEntry, o: RegistrationObservation, ex: MasterException[]) {
  for (const [field, val] of [["amcCode", clean(o.amcCode)], ["folio", clean(o.folio)], ["scheme", clean(o.scheme)]] as const) {
    if (e.observations > 0 && val && e[field] && e[field] !== val) {
      ex.push({ code: "registration_attribute_conflict", key: e.key, detail: `${field} differs between ${e.sources.join(", ")} and ${o.source}` });
    }
  }
  e.observations++;
  if (!e.sources.includes(o.source)) e.sources.push(o.source);
  if (o.registeredOn && (!e.registeredOn || o.registeredOn < e.registeredOn)) e.registeredOn = o.registeredOn;
  if (o.source === "kfintech.mfsd230" && (o.totalInstalments != null || o.paidInstalments != null)) {
    if (!e.instalmentCounts || e.instalmentCounts.asOf <= o.reportDate) {
      e.instalmentCounts = { total: o.totalInstalments ?? null, paid: o.paidInstalments ?? null, pending: o.pendingInstalments ?? null, asOf: o.reportDate };
    }
  }
  const latest = e.observations === 1 || o.reportDate >= e.lastSeen;
  if (!latest) return;
  e.lastSeen = o.reportDate;
  const k = sipKind(o.rta, o.kindCode);
  // A report that cannot say the kind (or the frequency) never erases what another said.
  if (k.kind !== "unknown") Object.assign(e, { kind: k.kind, kindConfidence: k.confidence });
  const f = sipFrequency(o.frequencyText);
  if (f) e.frequency = f;
  if (o.amount != null) e.amount = o.amount;
  if (o.startDate) e.startDate = o.startDate;
  if (o.endDate) e.endDate = o.endDate;
  if (o.targetScheme) e.targetScheme = clean(o.targetScheme);
  // Lifecycle facts come only from a report that states them (WBR49 cease /
  // pause, MFSD243 status / terminate) — MFSD230 states none and changes none.
  if (o.source !== "kfintech.mfsd230") {
    e.lifecycleAsOf = o.reportDate;
    e.status = clean(o.statusText) ? { text: clean(o.statusText), asOf: o.reportDate, source: o.source } : e.status;
    e.ceaseDate = o.ceaseDate ?? e.ceaseDate;
    e.terminateDate = o.terminateDate ?? e.terminateDate;
    if (o.source === "cams.wbr49") { e.pauseFrom = o.pauseFrom ?? null; e.pauseTo = o.pauseTo ?? null; }
  }
}

export type SipMasterOptions = {
  /** How recent a processed instalment must be to call a registration operational (default 35 days). */
  cycleDays?: number;
  /** Resolve the owner of a registration's folio (owner rules); null when not resolvable. */
  ownerOf?: (r: { rta: "cams" | "kfintech"; amcCode: string; folio: string }) => SipMasterEntry["owner"];
};

export function buildSipMaster(observations: RegistrationObservation[], events: InstalmentEvent[], asOf: string, opts: SipMasterOptions = {}): SipMaster {
  const cycleDays = opts.cycleDays ?? 35;
  const ex: MasterException[] = [];
  const byKey = new Map<string, SipMasterEntry>();
  const ordered = [...observations].sort((a, b) => a.reportDate.localeCompare(b.reportDate));

  // 1. Keyed observations: one entry per registrar registration.
  for (const o of ordered.filter((x) => clean(x.registrationId))) {
    const key = regKey(o.rta, o.amcCode, o.registrationId!);
    const e = byKey.get(key) ?? blankEntry(key, o, true);
    absorb(e, o, ex);
    byKey.set(key, e);
  }

  // 2. Unkeyed observations (MFSD230): a unique exact match, else their own entry.
  const keyed = [...byKey.values()];
  const unkeyed = new Map<string, SipMasterEntry>();
  for (const o of ordered.filter((x) => !clean(x.registrationId))) {
    const freq = sipFrequency(o.frequencyText);
    const same = keyed.filter((e) =>
      e.rta === o.rta && e.amcCode === clean(o.amcCode) && e.folio === clean(o.folio) && e.scheme === clean(o.scheme) &&
      e.amount != null && o.amount != null && e.amount === o.amount && !!freq && e.frequency === freq &&
      !!o.startDate && e.startDate === o.startDate);
    if (same.length === 1) { absorb(same[0], o, ex); continue; }
    const key = `unkeyed:${o.rta}:${clean(o.amcCode)}:${clean(o.folio)}:${clean(o.scheme)}:${o.amount ?? ""}:${freq ?? clean(o.frequencyText)}:${o.startDate ?? ""}`;
    if (same.length > 1) ex.push({ code: "unkeyed_ambiguous", key, detail: `${o.source} row matches ${same.length} registrations on every attribute — not attached to any` });
    const e = unkeyed.get(key) ?? blankEntry(key, o, false);
    absorb(e, o, ex);
    unkeyed.set(key, e);
  }

  const entries = [...byKey.values(), ...unkeyed.values()];

  // 3. Instalments: attach by registration reference only. An STP reports one
  // instalment as two legs under one registration — counted once per date.
  // A reference no registration report describes is still a registration
  // (the registrar's own id): it is held as an EVIDENCED entry — kind and
  // amount from its instalments, state UNKNOWN — never merged into another.
  const seen = new Set<string>();
  const evidenced = new Map<string, SipMasterEntry>();
  for (const ev of [...events].sort((a, b) => a.date.localeCompare(b.date))) {
    const k = clean(ev.registrationRef) ? eventKey(ev) : "";
    if (!k) {
      ex.push({ code: "instalment_unlinked", key: `${ev.rta}:${clean(ev.amcCode)}:${clean(ev.folio)}`, detail: `${ev.outcome} instalment of ${ev.date} names no registration` });
      continue;
    }
    let e = byKey.get(k) ?? evidenced.get(k);
    if (!e) {
      e = blankEntry(k, { source: "kfintech.mfsd243", reportDate: ev.date, rta: ev.rta, amcCode: ev.amcCode, registrationId: ev.registrationRef, folio: ev.folio, scheme: ev.scheme, kindCode: "", amount: null, frequencyText: "", startDate: null }, true);
      e.described = false;
      e.sources = [];
      e.observations = 0;
      evidenced.set(k, e);
      ex.push({ code: "registration_not_described", key: k, detail: "instalments name this registration, but no registration report on file describes it" });
    }
    if (!e.described) {
      if (ev.kind && e.kind === "unknown") e.kind = ev.kind;
      if (ev.outcome === "processed" && ev.amount != null) e.amount = ev.amount;
    }
    const once = `${e.key}|${ev.date}|${ev.outcome}`;
    if (seen.has(once)) continue;
    seen.add(once);
    const i = e.instalments;
    if (ev.outcome === "processed") { i.processed++; if (!i.lastProcessed || ev.date > i.lastProcessed) i.lastProcessed = ev.date; }
    else { i.rejected++; if (!i.lastRejected || ev.date > i.lastRejected) { i.lastRejected = ev.date; i.lastRejectionReason = ev.reason ?? null; } }
  }

  // 4. State, as of the requested date.
  for (const e of evidenced.values()) entries.push(e);
  for (const e of entries) {
    if (!e.described) {
      e.state = "UNKNOWN";
      e.stateBasis = `no registration report describes this registration${e.instalments.lastProcessed ? `; last processed instalment ${e.instalments.lastProcessed}` : ""}`;
      continue;
    }
    if (e.kind === "unknown") ex.push({ code: "unknown_kind", key: e.key, detail: "registration kind not stated in a form this code reads" });
    if (!e.frequency) ex.push({ code: "unknown_frequency", key: e.key, detail: "frequency not stated in a form this code reads — not assumed monthly" });
    const r = sipStateOn({
      registrarStatus: e.status?.text ?? null,
      reportStatesLifecycle: !!e.lifecycleAsOf,
      startDate: e.startDate, endDate: e.endDate, ceaseDate: e.ceaseDate, terminateDate: e.terminateDate,
      pauseFrom: e.pauseFrom, pauseTo: e.pauseTo,
      // The register that can speak for the status is the latest lifecycle report.
      registerAsOf: e.lifecycleAsOf,
    }, asOf);
    e.state = r.state;
    e.stateBasis = r.basis;
  }
  for (const e of entries) {
    e.lastSuccessfulInstalment = e.instalments.lastProcessed;
    // "Recent" depends on the frequency (a quarterly SIP is not late after 35 days); unknown frequency → the fallback window.
    const windowDays = cycleWindowDays(e.frequency, cycleDays);
    e.operational = !!e.lastSuccessfulInstalment && e.lastSuccessfulInstalment <= asOf && Date.parse(asOf) - Date.parse(e.lastSuccessfulInstalment) <= windowDays * 86_400_000;
    if (e.state === "UNKNOWN" && e.operational) {
      e.state = "OBSERVED_ACTIVITY";
      e.stateBasis = `${e.stateBasis}; a processed instalment on ${e.lastSuccessfulInstalment} (within ${windowDays} days, ${e.frequency ?? "frequency unknown"}) — activity observed, registration status not verified`;
    }
    const ev: LifecycleEvent[] = [];
    const lifeSrc = e.status?.source ?? e.sources.find((x) => x !== "kfintech.mfsd230") ?? "registration report";
    if (e.ceaseDate) ev.push({ kind: "stop", date: e.ceaseDate, source: lifeSrc });
    if (e.terminateDate) ev.push({ kind: "stop", date: e.terminateDate, source: lifeSrc });
    if (e.pauseFrom) ev.push({ kind: "pause", date: e.pauseFrom, source: lifeSrc });
    if (e.state === "REJECTED") ev.push({ kind: "registration_rejected", date: e.status?.asOf ?? null, source: lifeSrc });
    if (e.instalments.rejected) ev.push({ kind: "instalment_rejected", date: e.instalments.lastRejected, source: "transaction feed" });
    e.lifecycleEvents = ev;
    e.statusEffectiveDate =
      e.state === "STOPPED" ? [e.ceaseDate, e.terminateDate].filter((x): x is string => !!x).sort()[0] ?? e.status?.asOf ?? e.lifecycleAsOf
      : e.state === "PENDING" ? e.startDate
      : e.state === "PAUSED" ? e.pauseFrom
      : e.state === "UNKNOWN" ? null
      : e.state === "OBSERVED_ACTIVITY" ? e.lastSuccessfulInstalment
      : e.status?.asOf ?? e.lifecycleAsOf;
    e.confidence = e.described && e.keyed && e.state !== "UNKNOWN" && e.state !== "OBSERVED_ACTIVITY" ? "verified" : e.keyed ? "partial" : "unverified";
    e.owner = opts.ownerOf ? opts.ownerOf({ rta: e.rta, amcCode: e.amcCode, folio: e.folio }) : null;
  }
  entries.sort((a, b) => a.key.localeCompare(b.key));
  const coverage = {} as MasterCoverage;
  for (const rta of ["cams", "kfintech"] as const) {
    const refs = new Set(events.filter((e) => e.rta === rta && clean(e.registrationRef)).map(eventKey));
    const missing = [...refs].filter((k) => !byKey.has(k)).length;
    coverage[rta] = { referencedByInstalments: refs.size, describedInMaster: refs.size - missing, missingFromMaster: missing };
  }
  return { asOf, entries, exceptions: ex, coverage };
}

export type ActiveSipBook = {
  asOf: string;
  /** Kind SIP, state ACTIVE, frequency known. */
  active: { count: number; monthlyAmount: number };
  /** Reported beside the book, never in it. */
  pending: { count: number; monthlyAmount: number };
  unknown: { count: number; monthlyAmount: number };
  stoppedOrExpired: number;
  paused: number;
  activeWithUnknownFrequency: number;
  nonSip: { stp: number; swp: number; other: number; unknownKind: number };
  /**
   * SIPs known only from their instalments (no registration report on file):
   * operating = an instalment within the cycle; their frequency is not known,
   * so only the last instalment amount is summed. Never in the book.
   */
  notDescribed: { operating: number; operatingLastInstalmentTotal: number; notOperating: number };
  /** SIPs in OBSERVED_ACTIVITY (described or not): activity seen, status unverified — never in the book. */
  observedActivity: number;
};

export function activeSipBook(master: SipMaster): ActiveSipBook {
  const out: ActiveSipBook = {
    asOf: master.asOf,
    active: { count: 0, monthlyAmount: 0 }, pending: { count: 0, monthlyAmount: 0 }, unknown: { count: 0, monthlyAmount: 0 },
    stoppedOrExpired: 0, paused: 0, activeWithUnknownFrequency: 0,
    nonSip: { stp: 0, swp: 0, other: 0, unknownKind: 0 },
    notDescribed: { operating: 0, operatingLastInstalmentTotal: 0, notOperating: 0 },
    observedActivity: 0,
  };
  const add = (b: { count: number; monthlyAmount: number }, e: SipMasterEntry) => {
    b.count++;
    if (e.frequency && e.amount != null) b.monthlyAmount = Math.round((b.monthlyAmount + monthlySipAmount(e.amount, e.frequency)) * 100) / 100;
  };
  for (const e of master.entries) {
    if (e.kind === "sip" && e.state === "OBSERVED_ACTIVITY") out.observedActivity++;
    if (!e.described && e.kind === "sip") {
      if (e.operational) {
        out.notDescribed.operating++;
        out.notDescribed.operatingLastInstalmentTotal = Math.round((out.notDescribed.operatingLastInstalmentTotal + (e.amount ?? 0)) * 100) / 100;
      } else out.notDescribed.notOperating++;
      continue;
    }
    if (e.kind !== "sip") {
      if (e.kind === "stp") out.nonSip.stp++;
      else if (e.kind === "swp") out.nonSip.swp++;
      else if (e.kind === "other") out.nonSip.other++;
      else out.nonSip.unknownKind++;
      continue;
    }
    if (e.state === "ACTIVE") {
      if (!e.frequency || e.amount == null) { out.activeWithUnknownFrequency++; continue; }
      add(out.active, e);
    } else if (e.state === "PENDING") add(out.pending, e);
    else if (e.state === "UNKNOWN" || e.state === "OBSERVED_ACTIVITY") add(out.unknown, e);
    else if (e.state === "PAUSED") out.paused++;
    else out.stoppedOrExpired++;
  }
  return out;
}

// ── From staged rows ─────────────────────────────────────────────────────────

type StagedRow = Pick<NormRow, "valid" | "amcCode" | "folioNumber" | "schemeCode" | "registrarTxnNo" | "amount" | "tradeDate" | "cls" | "attrs">;
const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);
const int = (v: unknown) => (str(v) && /^-?\d+$/.test(str(v)!) ? Number(str(v)) : null);

/** Registration observations from a staged registration file (WBR49 / MFSD243 / MFSD230). */
export function observationsFromStaged(layoutId: RegistrationSource, reportDate: string, rows: StagedRow[]): RegistrationObservation[] {
  const rta = layoutId.startsWith("cams") ? "cams" : "kfintech";
  return rows.filter((n) => n.valid && n.folioNumber && n.schemeCode).map((n) => {
    const a = n.attrs;
    const total = int(a.installments), paid = int(a.paidInstallments);
    return {
      source: layoutId, reportDate, rta, amcCode: n.amcCode ?? "", registrationId: n.registrarTxnNo,
      folio: n.folioNumber!, scheme: n.schemeCode!, targetScheme: str(a.target),
      kindCode: str(a.kind) ?? "", amount: n.amount?.num ?? null, frequencyText: str(a.frequency) ?? "",
      startDate: n.tradeDate, endDate: str(a.endDate), registeredOn: str(a.registrationDate),
      statusText: str(a.registrarStatus), ceaseDate: str(a.ceaseDate), terminateDate: str(a.terminateDate),
      pauseFrom: str(a.pauseFrom), pauseTo: str(a.pauseTo),
      totalInstalments: total, paidInstalments: paid,
      pendingInstalments: total != null && paid != null ? total - paid : null,
    };
  });
}

/** Instalment events from a staged transaction file (MFSD201 / R2): processed systematic rows and failed instalments. */
export function eventsFromStaged(rta: "cams" | "kfintech", rows: StagedRow[]): InstalmentEvent[] {
  const out: InstalmentEvent[] = [];
  for (const n of rows) {
    if (!n.valid || !n.cls || !n.tradeDate || !n.folioNumber || !n.schemeCode) continue;
    const ref = rta === "kfintech" ? str(n.attrs.sipRegistrationId) : str(n.attrs.sipRef);
    const failed = n.cls.exception === "instalment_rejected";
    const systematic = !n.cls.exception && ["sip_investment", "stp_in", "stp_out", "swp_withdrawal"].includes(n.cls.rtaClass);
    if (!failed && !systematic) continue;
    const cls = n.cls.rtaClass;
    out.push({
      rta, amcCode: n.amcCode ?? "", registrationRef: ref, folio: n.folioNumber, scheme: n.schemeCode, date: n.tradeDate,
      outcome: failed ? "rejected" : "processed", amount: n.amount?.num ?? null,
      kind: cls === "sip_investment" ? "sip" : cls === "stp_in" || cls === "stp_out" ? "stp" : cls === "swp_withdrawal" ? "swp" : undefined,
      reason: failed ? str(n.attrs.rejectionReason) ?? undefined : undefined,
    });
  }
  return out;
}
