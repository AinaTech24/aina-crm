/**
 * Small pure rules behind the policy form's family panel (kept out of the
 * client component so they can be tested and shared).
 */
import type { FamilyLite, FamilyMemberLite } from "@/lib/families/lookup";

/** Whole years between a yyyy-mm-dd date of birth and today (India date not needed to the day). */
export function ageFromDob(dob: string | null | undefined, today = new Date()): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(dob ?? "");
  if (!m) return "";
  let age = today.getFullYear() - Number(m[1]);
  if (today.getMonth() + 1 < Number(m[2]) || (today.getMonth() + 1 === Number(m[2]) && today.getDate() < Number(m[3]))) age--;
  return age >= 0 && age < 130 ? String(age) : "";
}

/** "daughter_in_law" → "Daughter in law"; the head reads "Self" only against themselves. */
export function roleLabel(role: string | null | undefined): string {
  const r = (role ?? "").replace(/_/g, " ").trim();
  return r ? r.charAt(0).toUpperCase() + r.slice(1) : "";
}

/** How `member` is related to the policyholder, as far as the mapping says. */
export function relationToHolder(member: FamilyMemberLite, holderId: string | null, family: FamilyLite | null): string {
  if (holderId && member.id === holderId) return "Self";
  const holder = family?.members.find((m) => m.id === holderId);
  // The mapping stores each member's relation to the HEAD, which is the policyholder's relation only when they are the head.
  if (holder?.isHead) return member.isHead ? "Self" : roleLabel(member.familyRole);
  return "";
}
