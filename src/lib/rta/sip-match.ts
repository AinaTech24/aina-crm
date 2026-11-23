/**
 * Which stored SIP an incoming SIP-register row IS — pure, used by processSipBook.
 *
 * A folio + scheme can hold SEVERAL registrations over time (and at once): a client
 * cancels a ₹2,000 SIP and starts a ₹5,000 one in the same scheme; or runs two SIPs
 * on different days. The register lists them all, cancelled ones too. Keying on
 * folio + scheme alone (the old rule) merged them into one row, so
 *   · a cancelled row stopped the live SIP beside it (book too LOW, ₹0 in the worst order),
 *   · two live SIPs collapsed into one (book too low), and
 *   · every re-import of a cancelled row added a fresh stopped copy.
 *
 * A registration is told apart by its START DATE (the day it was registered; it does not
 * change when the amount steps up). Where the file carries no start date the old
 * folio + scheme rule still applies. Registrations the CRM holds with no start date
 * (booked by hand, or imported from a report without one) are adopted rather than
 * duplicated.
 */

export type SipCandidate = {
  id: string;
  status: string;
  amount: number | null;
  /** YYYY-MM-DD, or null for a SIP held without one. */
  startDate: string | null;
  /** The "day of the month" the registrar gave, as imported. */
  sipDate: string | null;
  /** For a closed SIP: the day it closed (end date, else last change), YYYY-MM-DD. */
  closedBy: string | null;
};

export type SipRowFacts = {
  startDate?: string;
  amount: number;
  sipDate?: string;
  /** False for a registration the registrar shows cancelled (a cease date on or before today). */
  live: boolean;
};

export type FileFacts = {
  /** Start date → how many SIP-type rows of THIS file for the same folio + scheme carry it (live and cancelled). */
  starts: ReadonlyMap<string, number>;
  /** How many of those rows are live. */
  liveRows: number;
};

const ISO = /^\d{4}-\d{2}-\d{2}$/;

/** "2024-05-09" read the other way round ("2024-09-05") — an older CAMS import read 2/9 as 2 September. */
export function swapDayMonth(d: string): string | null {
  return ISO.test(d) ? `${d.slice(0, 4)}-${d.slice(8, 10)}-${d.slice(5, 7)}` : null;
}

export function sameStartDay(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return false;
  return a === b || a === swapDayMonth(b);
}

const amountClose = (a: number | null | undefined, b: number | null | undefined) => {
  const x = Number(a ?? 0);
  const y = Number(b ?? 0);
  return x > 0 && y > 0 && Math.abs(x - y) <= Math.max(x, y) * 0.01;
};

const daysEqual = (a?: string | null, b?: string | null) => (a ?? "").trim() === (b ?? "").trim();

/** Does the file itself list a registration that starts on `d` for this folio + scheme? */
const claimedByFile = (d: string | null, file: FileFacts) =>
  !!d && (file.starts.has(d) || (swapDayMonth(d) != null && file.starts.has(swapDayMonth(d) as string)));

export function matchRegistration(row: SipRowFacts, cands: SipCandidate[], file: FileFacts): SipCandidate | null {
  const D = row.startDate;
  const active = cands.filter((c) => c.status === "active");
  const closed = cands.filter((c) => c.status !== "active");

  // The file says nothing about when it started: the folio + scheme is all there is.
  // The same amount first (one of several), else the only / first active one.
  if (!D) {
    if (active.length) return active.find((c) => amountClose(c.amount, row.amount)) ?? active[0];
    // A cancelled row with no date must not reach for a closed row at random.
    return row.live ? (closed[0] ?? null) : null;
  }

  // 1. The same registration: the same start date. Live copy before a closed one.
  const same = cands.filter((c) => sameStartDay(c.startDate, D));
  if (same.length) {
    // Two registrations can start on the same day and differ in the day of the month they debit
    // (₹5,000 on the 5th, ₹3,000 on the 20th). The day then tells them apart; where the file lists
    // only one row for this start date a different day is the same SIP re-dated, not a second one.
    const day = (row.sipDate ?? "").trim();
    if (day) {
      const sameDay = same.filter((c) => daysEqual(c.sipDate, day));
      if (sameDay.length) return sameDay.find((c) => c.status === "active") ?? sameDay[0];
      if ((file.starts.get(D) ?? 0) > 1 && same.every((c) => !!c.sipDate)) return null;
    }
    return same.find((c) => c.status === "active") ?? same[0];
  }

  // A closed SIP held without a start date is the same registration when it began
  // before the day that SIP closed.
  const legacyClosed = closed.find((c) => !c.startDate && c.closedBy && D <= c.closedBy);

  if (!row.live) {
    // A cancelled row only ever stops ITS OWN registration. The one exception is a SIP the CRM holds
    // with no start date, when it is the only live one and the file lists nothing live for this
    // folio + scheme — then it is that registration.
    const undated = active.filter((c) => !c.startDate);
    if (undated.length === 1 && file.liveRows === 0) return undated[0];
    return legacyClosed ?? null;
  }

  // 2. A live registration the CRM has not seen under this start date.
  //    · a SIP held without a start date is adopted (and given this one);
  //    · or the same SIP re-dated at the registrar (same amount, same day of the month) that the
  //      file does not otherwise list. Anything else is a NEW registration, kept beside the others.
  const undated = active.filter((c) => !c.startDate);
  if (undated.length === 1) return undated[0];
  const redated = active.filter(
    (c) => c.startDate && !claimedByFile(c.startDate, file) && amountClose(c.amount, row.amount) && daysEqual(c.sipDate, row.sipDate),
  );
  if (redated.length === 1) return redated[0];
  return legacyClosed ?? null;
}
