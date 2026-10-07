/**
 * Regular or Direct for a scheme: the Scheme Master's own Plan field, else the
 * scheme name, which AMFI names carry ("… - Direct Plan - Growth Option").
 * Null when neither says.
 */

export type SchemePlan = "regular" | "direct";

export function schemePlan(plan: string | null | undefined, name: string | null | undefined): SchemePlan | null {
  if (plan === "regular" || plan === "direct") return plan;
  const n = name ?? "";
  // "Direct Plan" / "Regular Plan" first, so a word elsewhere in the name
  // ("… Direct Equity …") cannot outvote the plan the name states.
  if (/\bdirect\s+plan\b/i.test(n)) return "direct";
  if (/\bregular\s+plan\b/i.test(n)) return "regular";
  if (/\bdirect\b/i.test(n)) return "direct";
  if (/\bregular\b/i.test(n)) return "regular";
  return null;
}
