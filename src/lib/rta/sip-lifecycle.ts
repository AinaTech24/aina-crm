/**
 * A SIP registration's state on a date — from what the REGISTRAR states, never
 * inferred from instalments. SIP Master is every registration with this state
 * and its history; the SIP Book is the ACTIVE ones. Same data, two views.
 *
 *   ACTIVE    the registrar's own register lists it live ("Live SIP" in
 *             MFSD243; no cease date in WBR49), the start has passed, the end
 *             has not, it is not in a pause window, and that register is
 *             fresh enough to speak for date D
 *   PENDING   registered, start date still ahead
 *   PAUSED    inside a registrar-stated pause window (WBR49 pause dates)
 *   STOPPED   a registrar-stated cease / terminate date on or before D, or a
 *             registrar status that says terminated / cancelled / ceased
 *   EXPIRED   the registrar's own status says expired / matured / completed.
 *             An end date alone is not enough: SIPs are extended at the AMC
 *             under their original end date — a passed end date with a live
 *             status stays ACTIVE, and with no status it is UNKNOWN
 *   REJECTED  the registrar rejected the registration
 *   UNKNOWN   anything else — a register with no status (MFSD230), a stale
 *             register, a status this code does not know. Never shown ACTIVE.
 *
 * A rejected or bounced INSTALMENT is an event on the registration, not a
 * state: it never stops a SIP (owner decision of 2026-10-08).
 */
export type SipState = "ACTIVE" | "PENDING" | "PAUSED" | "STOPPED" | "EXPIRED" | "REJECTED" | "UNKNOWN";

export type RegistrationFacts = {
  /** Registrar status text as printed (MFSD243 "Status"); null when the report has none. */
  registrarStatus?: string | null;
  /** True when the report's layout carries a status / cease column at all. */
  reportStatesLifecycle: boolean;
  startDate?: string | null;
  endDate?: string | null;
  ceaseDate?: string | null;
  terminateDate?: string | null;
  pauseFrom?: string | null;
  pauseTo?: string | null;
  /** When the register this row came from was produced (mail / report date). */
  registerAsOf?: string | null;
};

export type SipEvent = { kind: "instalment_processed" | "instalment_rejected"; date: string };

export type SipStateResult = { state: SipState; basis: string };

const LIVE = /^LIVE\b|^ACTIVE$|^REGISTERED$/i;
const STOPPED = /TERMINAT|CANCEL|CEASE|STOP|CLOSED/i;
const REJECTED = /REJECT/i;
const EXPIRED_TEXT = /EXPIR|MATUR|COMPLETED/i;

export function sipStateOn(r: RegistrationFacts, d: string, opts: { maxRegisterAgeDays: number } = { maxRegisterAgeDays: 35 }, _events: SipEvent[] = []): SipStateResult {
  const status = (r.registrarStatus ?? "").trim();
  const stop = [r.ceaseDate, r.terminateDate].filter((x): x is string => !!x).sort()[0];
  if (stop && stop <= d) return { state: "STOPPED", basis: `registrar ${r.terminateDate ? "terminate" : "cease"} date ${stop}` };
  if (status && REJECTED.test(status)) return { state: "REJECTED", basis: `registrar status "${status}"` };
  if (status && STOPPED.test(status)) return { state: "STOPPED", basis: `registrar status "${status}"` };
  if (status && EXPIRED_TEXT.test(status)) return { state: "EXPIRED", basis: `registrar status "${status}"` };
  if (!r.reportStatesLifecycle) return { state: "UNKNOWN", basis: "the report states no status or cease date for its registrations" };
  if (status && !LIVE.test(status)) return { state: "UNKNOWN", basis: `registrar status "${status}" is not one this code reads` };
  if (!r.registerAsOf) return { state: "UNKNOWN", basis: "the register's date is not known, so it cannot speak for this date" };
  const ageDays = (Date.parse(d) - Date.parse(r.registerAsOf)) / 86_400_000;
  if (ageDays < 0 || ageDays > opts.maxRegisterAgeDays) return { state: "UNKNOWN", basis: `the register is dated ${r.registerAsOf}, too far from ${d} to state its status` };
  if (r.pauseFrom && r.pauseFrom <= d && (!r.pauseTo || d <= r.pauseTo)) return { state: "PAUSED", basis: `registrar pause ${r.pauseFrom} → ${r.pauseTo ?? "open"}` };
  if (r.startDate && d < r.startDate) return { state: "PENDING", basis: `starts ${r.startDate}` };
  if (r.endDate && r.endDate < d) {
    // The registrar still calling it live past its end date (an extension at the
    // AMC) keeps it ACTIVE; with no status at all, a passed end date is not
    // evidence either way.
    if (!status) return { state: "UNKNOWN", basis: `end date ${r.endDate} has passed and the register states no status to confirm expiry or extension` };
  }
  return { state: "ACTIVE", basis: status ? `registrar status "${status}" on a register dated ${r.registerAsOf}` : `registrar register dated ${r.registerAsOf} with no cease date` };
}
