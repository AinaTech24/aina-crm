/**
 * DPDP Act s.9: a child's personal data is processed only with the parent's
 * or guardian's consent, and never for targeted advertising. A minor client
 * (investor_category "minor" sets `is_minor`) is therefore never sent
 * MARKETING; service messages about their own folios still go (to the
 * contact details the guardian gave). Enforced in dispatch() (lib/comms/pipeline.ts).
 */

export const MINOR_MARKETING_REASON =
  "This client is a minor. Marketing is never sent to a child (DPDP Act, section 9); send it to the guardian instead.";

/** Under 18 by the minor flag, or by date of birth when the flag was never set. */
export function isMinorRecord(r: { isMinor?: boolean | null; dob?: string | Date | null }, now: Date = new Date()): boolean {
  if (r.isMinor) return true;
  if (!r.dob) return false;
  const dob = new Date(r.dob);
  if (Number.isNaN(dob.getTime())) return false;
  const eighteenth = new Date(dob);
  eighteenth.setFullYear(dob.getFullYear() + 18);
  return eighteenth > now;
}
