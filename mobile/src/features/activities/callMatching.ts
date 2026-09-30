import type { SimCall } from "../../../modules/aina-call-log";
export interface CallContact { id: string; name: string; phone: string; subjectType: "investor" | "lead" }
/** Indian local/prefixed numbers match; do not collapse foreign country codes. */
export function phoneKey(value: string): string | null {
  let digits = value.replace(/\D/g, "");
  if (digits.startsWith("00")) digits = digits.slice(2);
  if (digits.length === 11 && digits.startsWith("0")) digits = digits.slice(1);
  if (digits.length === 10) digits = `91${digits}`;
  return digits.length >= 11 && digits.length <= 15 ? digits : null;
}
export function matchCall(call: SimCall, contacts: CallContact[]): CallContact | null {
  const key = phoneKey(call.number);
  if (!key) return null;
  const matches = contacts.filter(c => phoneKey(c.phone) === key);
  return matches.length === 1 ? matches[0] : null;
}
export function callBody(call: SimCall, contact: CallContact) {
  return { subjectType: contact.subjectType, subjectId: contact.id, kind: "call",
    direction: call.type === 2 ? "outbound" : "inbound",
    status: call.type === 3 || call.type === 5 ? "no_answer" : call.duration > 0 ? "answered" : "no_answer",
    subject: call.type === 3 ? "Missed SIM call" : "SIM call",
    durationSec: Math.max(0, Math.min(86400, call.duration)), occurredAt: new Date(call.date).toISOString() };
}
/** phoneKey → contacts, built once per contact download rather than per call. */
export function indexContacts(contacts: CallContact[]): Map<string, CallContact[]> {
  const index = new Map<string, CallContact[]>();
  for (const c of contacts) {
    const k = phoneKey(c.phone);
    if (!k) continue;
    const list = index.get(k);
    if (list) list.push(c); else index.set(k, [c]);
  }
  return index;
}
/** Same rule as matchCall — exactly one contact or nothing — against an index. */
export function matchIndexed(call: SimCall, index: Map<string, CallContact[]>): CallContact | null {
  const key = phoneKey(call.number);
  const matches = key ? index.get(key) : undefined;
  return matches && matches.length === 1 ? matches[0] : null;
}
