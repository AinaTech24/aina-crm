/**
 * What a lead's contact details must look like (audit L21). Pure — the New
 * lead form, POST / PATCH /api/leads, the CSV import and the tests read it.
 *
 *   - Name always; phone OR email (a lead nobody can reach is not a lead).
 *   - A phone is an Indian mobile — 10 digits starting 6–9, optionally
 *     written +91 / 91 / 0 first — or, for someone abroad, an international
 *     number written with its "+" and country code (8–15 digits).
 *   - An email is an email.
 *   - A PAN, when given, is a PAN — never silently dropped.
 */

import { indianMobile10 } from "@/lib/utils";

export type LeadFieldIssue = { field: "name" | "phone" | "email" | "pan"; error: string };

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const PAN_RE = /^[A-Z]{5}[0-9]{4}[A-Z]$/;

/** A phone a lead may carry: an Indian mobile, or "+<country><number>" abroad. */
export function isAcceptableLeadPhone(raw: string | null | undefined): boolean {
  const s = String(raw ?? "").trim();
  if (!s) return false;
  if (indianMobile10(s)) return true;
  const digits = s.replace(/\D/g, "");
  // International: written with "+", not India's code, 8–15 digits (E.164).
  return s.startsWith("+") && !digits.startsWith("91") && digits.length >= 8 && digits.length <= 15;
}

export function isAcceptableEmail(raw: string | null | undefined): boolean {
  return EMAIL_RE.test(String(raw ?? "").trim());
}

/** A typed PAN, upper-cased; null when blank. Throws nothing — see leadContactIssue. */
export function cleanPan(raw: string | null | undefined): string | null {
  const s = String(raw ?? "").trim().toUpperCase();
  return s ? s : null;
}

export function isValidPan(raw: string | null | undefined): boolean {
  const p = cleanPan(raw);
  return !!p && PAN_RE.test(p);
}

/**
 * The first thing wrong with a lead's identity / contact fields, or null.
 * `requireContact` (create) needs a phone or an email; an edit only checks
 * what it changes.
 */
export function leadContactIssue(
  v: { name?: string | null; phone?: string | null; email?: string | null; pan?: string | null },
  opts: { requireContact?: boolean; requireName?: boolean } = {},
): LeadFieldIssue | null {
  const name = String(v.name ?? "").trim();
  const phone = String(v.phone ?? "").trim();
  const email = String(v.email ?? "").trim();
  if (opts.requireName && name.length < 2) return { field: "name", error: "Enter the lead's name." };
  if (opts.requireContact && !phone && !email) {
    return { field: "phone", error: "Add a phone number or an email — a lead needs a way to be reached." };
  }
  if (phone && !isAcceptableLeadPhone(phone)) {
    return { field: "phone", error: "Enter a 10-digit Indian mobile number (optionally +91 or 0 first), or an overseas number starting with + and the country code." };
  }
  if (email && !isAcceptableEmail(email)) return { field: "email", error: "Enter a valid email address." };
  if (v.pan != null && String(v.pan).trim() && !isValidPan(v.pan)) {
    return { field: "pan", error: "PAN must be 10 characters: 5 letters, 4 digits, 1 letter (e.g. ABCDE1234F)." };
  }
  return null;
}
