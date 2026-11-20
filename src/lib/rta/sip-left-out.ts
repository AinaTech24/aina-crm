/**
 * A SIP register's rows LEFT OUT ON PURPOSE (pure; used by processSipBook in
 * process.ts). STP / SWP / dividend-transfer registrations and SIPs the
 * registrar shows cancelled are not missing data, so they are counted apart
 * from skipped rows and explained in one note (errors row 0).
 */

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
