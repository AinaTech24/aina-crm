/**
 * What the public complaint form sends, read and checked — pure, so it is
 * tested (tests/complaint-web-form.test.ts) and the route stays thin.
 *
 * The messages are written for the person filling the form in, not for us:
 * they are shown on the page as they are.
 */

import { SEBI_COMPLAINT_CATEGORIES } from "@/db/schema/service_requests";

export const COMPLAINT_NAME_MAX = 120;
export const COMPLAINT_DETAILS_MIN = 10;
export const COMPLAINT_DETAILS_MAX = 4000;

export type ComplaintSubmission = {
  name: string;
  /** Lower-cased. */
  email: string | null;
  /** As typed (trimmed) — shown to staff. */
  phone: string | null;
  /** The last ten digits, for matching a client. */
  phoneLast10: string | null;
  /** Upper-cased, ABCDE1234F. */
  pan: string | null;
  folio: string | null;
  /** One of SEBI_COMPLAINT_CATEGORIES. */
  category: string;
  details: string;
};

export type ComplaintParse =
  | { kind: "ok"; value: ComplaintSubmission }
  | { kind: "invalid"; error: string }
  /** The hidden honeypot field was filled in: a bot. Answer as if it worked. */
  | { kind: "trap" };

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PAN_RE = /^[A-Z]{5}[0-9]{4}[A-Z]$/;

const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");

export function parseComplaintSubmission(body: unknown): ComplaintParse {
  const b = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;

  // A person never sees these fields; a form-filling bot fills every field.
  if (str(b.website) || str(b._gotcha)) return { kind: "trap" };

  const name = str(b.name).replace(/\s+/g, " ");
  if (name.length < 2) return { kind: "invalid", error: "Please enter your full name." };
  if (name.length > COMPLAINT_NAME_MAX) return { kind: "invalid", error: "Please shorten your name." };

  const email = str(b.email).toLowerCase() || null;
  if (email && (email.length > 254 || !EMAIL_RE.test(email))) {
    return { kind: "invalid", error: "That email address doesn't look right." };
  }

  const phone = str(b.phone) || null;
  let phoneLast10: string | null = null;
  if (phone) {
    const digits = phone.replace(/[^0-9]/g, "");
    if (digits.length < 10 || digits.length > 13) {
      return { kind: "invalid", error: "That mobile number doesn't look right." };
    }
    phoneLast10 = digits.slice(-10);
  }

  if (!email && !phone) {
    return { kind: "invalid", error: "Please give a mobile number or an email address, so the firm can reply to you." };
  }

  const pan = str(b.pan).toUpperCase().replace(/\s+/g, "") || null;
  if (pan && !PAN_RE.test(pan)) return { kind: "invalid", error: "PAN should look like ABCDE1234F." };

  const folio = str(b.folio).slice(0, 80) || null;

  const category = SEBI_COMPLAINT_CATEGORIES.some((c) => c.value === b.category) ? String(b.category) : "other";

  const details = str(b.details);
  if (details.length < COMPLAINT_DETAILS_MIN) {
    return { kind: "invalid", error: "Please describe your complaint in a sentence or two." };
  }
  if (details.length > COMPLAINT_DETAILS_MAX) {
    return { kind: "invalid", error: "Please keep the description under 4,000 characters." };
  }

  return { kind: "ok", value: { name, email, phone, phoneLast10, pan, folio, category, details } };
}
