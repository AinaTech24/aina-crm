/**
 * What of `investors.pan` may be shown on a list screen.
 *
 * The column does not always hold a PAN. The RTA importer stores a dedup key
 * there for clients who have none of their own: `MINOR:<guardian PAN>:<NAME>`
 * for a minor filed under a guardian, `NOPAN:<…>` for an adult with no PAN on
 * the feed. Those keys are internal and must never reach the screen; a minor's
 * key would also show the GUARDIAN's PAN against the child's name.
 *
 * Plain module (no "use client") so server pages mask before anything is sent
 * to the browser.
 */

const PAN_RE = /^[A-Z]{5}[0-9]{4}[A-Z]$/;

/** The client's own PAN, or null when the stored value is an import key. */
export function ownPan(stored: string | null | undefined): string | null {
  const v = (stored ?? "").trim().toUpperCase();
  if (PAN_RE.test(v)) return v;
  // `MINOR:<PAN>` with nothing after it is the minor's OWN PAN; with a name
  // after it, the PAN is the guardian's.
  const m = /^MINOR:([A-Z]{5}[0-9]{4}[A-Z])$/.exec(v);
  return m ? m[1] : null;
}

/** ABCDE1234F → ABC••••4F, the same shape PanReveal shows before a reveal. */
export function maskPan(pan: string): string {
  return `${pan.slice(0, 3)}••••${pan.slice(-2)}`;
}

/** Masked own PAN for display, or null when there is none to show. */
export function displayPan(stored: string | null | undefined): string | null {
  const pan = ownPan(stored);
  return pan ? maskPan(pan) : null;
}

/** True when the stored key marks the client as a minor, whatever `is_minor` says. */
export function isMinorKey(stored: string | null | undefined): boolean {
  return (stored ?? "").trim().toUpperCase().startsWith("MINOR:");
}
