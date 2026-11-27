/**
 * Where every rupee of a SIP register went (2026-11-27, Akshar / Urmi: the SIP book read below the figure the client
 * quotes from the registrar, and nobody could say how much, or why).
 *
 * `processSipBook` tallies the registrar's LIVE registrations by what became of each one, in monthly-equivalent rupees,
 * and the SIP Book page shows it per registrar. The buckets add up to the register's live total, so the gap between the
 * registrar's figure and the book is always accounted for — and the page says which bucket holds it.
 */

export type Bucket = { n: number; amt: number };

export type SipRegisterSummary = {
  /** Non-blank lines after the header, and how many the reader had to take short (cells missing) or leave out (no folio and no amount). */
  dataLines: number;
  shortRows: number;
  blankRows: number;
  /** Registrations read from the file. */
  rows: number;
  /** The registrar lists them as live SIPs. */
  live: Bucket;
  /** …filed in the book, under a client the dashboards count. */
  inBook: Bucket;
  /** …filed, but under a client who is closed, exited, in the Trash or merged — kept, not counted. */
  hiddenClient: Bucket;
  /** …the CRM holds the registration CLOSED (completed on evidence that its instalments stopped); it reopens when one is collected. */
  closedHere: Bucket;
  /** …could not be placed: no folio, or no client for it. */
  notPlaced: Bucket;
  /** …the database refused the row. */
  failed: Bucket;
  /** The registrar lists them as stopped, completed or rejected. */
  notLive: Bucket;
  /** STP / SWP / dividend-transfer registrations — not SIPs. */
  notSip: number;
};

export const emptyBucket = (): Bucket => ({ n: 0, amt: 0 });

export function emptySummary(): SipRegisterSummary {
  return {
    dataLines: 0, shortRows: 0, blankRows: 0, rows: 0,
    live: emptyBucket(), inBook: emptyBucket(), hiddenClient: emptyBucket(), closedHere: emptyBucket(),
    notPlaced: emptyBucket(), failed: emptyBucket(), notLive: emptyBucket(), notSip: 0,
  };
}

export function add(b: Bucket, amount: number): void {
  b.n += 1;
  b.amt += Number.isFinite(amount) ? amount : 0;
}

function inr(n: number): string {
  if (n >= 1e7) return `₹${(n / 1e7).toFixed(2)} Cr`;
  if (n >= 1e5) return `₹${(n / 1e5).toFixed(2)} L`;
  return `₹${Math.round(n).toLocaleString("en-IN")}`;
}
const n0 = (n: number) => n.toLocaleString("en-IN");

/** Live registrations of the register that are NOT in the book, in rupees a month. */
export function missingFromBook(s: SipRegisterSummary): Bucket {
  return { n: Math.max(0, s.live.n - s.inBook.n), amt: Math.max(0, s.live.amt - s.inBook.amt) };
}

/** Plain-language reasons, largest rupee amount first. Pure, so it is tested without a database. */
export function summaryNotes(s: SipRegisterSummary): string[] {
  const notes: string[] = [];
  const parts: Array<[number, string]> = [];
  if (s.notPlaced.n) {
    parts.push([s.notPlaced.amt,
      `${n0(s.notPlaced.n)} (${inr(s.notPlaced.amt)} a month) could not be placed — no folio or client for them in the CRM. Import the folio master (CAMS WBR9 / WBR4, KFintech MFSD211) and Re-import this register.`]);
  }
  if (s.hiddenClient.n) {
    parts.push([s.hiddenClient.amt,
      `${n0(s.hiddenClient.n)} (${inr(s.hiddenClient.amt)} a month) belong to clients who are closed, exited, in the Trash or merged, so the dashboards do not count them. Reopen or restore a client who still invests.`]);
  }
  if (s.closedHere.n) {
    parts.push([s.closedHere.amt,
      `${n0(s.closedHere.n)} (${inr(s.closedHere.amt)} a month) are listed live by the registrar but closed in the CRM, which completes a SIP only when its end date has passed and no instalment has been collected for 120 days. One more instalment in the transaction feed reopens it.`]);
  }
  if (s.failed.n) parts.push([s.failed.amt, `${n0(s.failed.n)} (${inr(s.failed.amt)} a month) were refused by the database — see the file's errors.`]);
  parts.sort((a, b) => b[0] - a[0]);
  for (const [, t] of parts) notes.push(t);
  if (s.shortRows > 0) {
    notes.push(`${n0(s.shortRows)} lines of the file had fewer cells than its header (trailing empty cells cut off); they were read, not dropped.`);
  }
  if (s.blankRows > 0) {
    notes.push(`${n0(s.blankRows)} lines had neither a folio nor an amount (a footer or total) and were left out.`);
  }
  const accounted = s.inBook.n + s.hiddenClient.n + s.closedHere.n + s.notPlaced.n + s.failed.n;
  if (s.live.n > accounted) {
    notes.push(`${n0(s.live.n - accounted)} live registrations were already identified as STP / SWP and stay out of the book.`);
  }
  return notes;
}

/** One line for the SIP Book page: what the registrar says live, what the book holds, and the difference. */
export function summaryHeadline(s: SipRegisterSummary): string {
  const gap = missingFromBook(s);
  return (
    `The register lists ${n0(s.live.n)} live SIPs worth ${inr(s.live.amt)} a month; ${n0(s.inBook.n)} (${inr(s.inBook.amt)}) of them are in the book` +
    (gap.n > 0 ? `, ${n0(gap.n)} (${inr(gap.amt)}) are not.` : ".")
  );
}
