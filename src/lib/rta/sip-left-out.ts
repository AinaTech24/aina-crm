/**
 * A SIP register's rows LEFT OUT ON PURPOSE (pure; used by processSipBook in
 * process.ts). STP / SWP / dividend-transfer registrations and SIPs the
 * registrar shows cancelled are not missing data, so they are counted apart
 * from skipped rows and explained in one note (errors row 0).
 */

/**
 * A registration that MOVES or WITHDRAWS money rather than buys — an STP out / in, an SWP, a
 * dividend transfer — in the words the registrars use. Everything else in a SIP register is a
 * SIP, whatever it is called: "P", "SIP", "XSIP", "Systematic Investment Plan", "Normal SIP",
 * "Perpetual", "SIP - Regular", or no type at all.
 *
 * This used to be an allow-list of eight spellings, so a type spelt any other way was "not a
 * SIP": the row was left out AND every active SIP of that folio and scheme was stopped.
 *   CAMS WBR49 AUT_TRNTYP:  P SIP · SO STP out · SI STP in · R SWP · DTP dividend transfer
 */
export function isTransferRegistration(regType: string): boolean {
  const t = regType.trim();
  if (!t) return false;
  if (/^(so|si|dtp|tp|ti|r|sw|stp[a-z]*|swp[a-z]*)$/i.test(t)) return true;
  return /\b(stp|swp)\b|systematic\s+(transfer|withdraw|redemption)|\bswitch|\btransfer|withdraw|redemption|dividend/i.test(t);
}

/** What a non-SIP registration in a SIP register is, in the words a firm uses. */
export function notASipLabel(regType: string, hasTarget: boolean): string {
  const t = regType.trim().toUpperCase();
  if (t === "SO" || t === "STP" || t === "STPO") return "STPs (transfer to another scheme)";
  if (t === "R" || t === "SWP") return "SWPs (systematic withdrawal)";
  if (t === "DTP") return "dividend transfer plans";
  if (hasTarget) return "transfers to another scheme (STP)";
  return `"${regType.trim()}" registrations (not a SIP)`;
}

/**
 * The note (errors row 0) that says what a SIP register's left-out rows were.
 * Row 0 is never a data line, so the detail page and the upload dialog show it
 * as a note, not an error.
 */
export function leftOutNote(leftOut: Map<string, number>): string | null {
  const total = [...leftOut.values()].reduce((a, b) => a + b, 0);
  if (!total) return null;
  const parts = [...leftOut.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([why, n]) => `${n.toLocaleString("en-IN")} ${why}`);
  return `${total.toLocaleString("en-IN")} row${total === 1 ? "" : "s"} left out on purpose — not missing data: ${parts.join("; ")}.`;
}

/**
 * The note (errors row 0) for SIPs this register filed under a client the SIP book does not
 * count — closed, exited, in the Trash or merged away. The SIP is stored; the book simply
 * skips it, which read as "imported 1, book unchanged".
 */
export function hiddenSipsNote(sips: number, clients: number): string | null {
  if (!sips) return null;
  return (
    `${sips.toLocaleString("en-IN")} live SIP${sips === 1 ? "" : "s"} belong${sips === 1 ? "s" : ""} to ` +
    `${clients.toLocaleString("en-IN")} client${clients === 1 ? "" : "s"} who ${clients === 1 ? "is" : "are"} closed, exited, in the Trash or merged — ` +
    `${sips === 1 ? "it is" : "they are"} stored but not counted in the SIP book until the client is active again.`
  );
}
