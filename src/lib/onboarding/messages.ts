/**
 * Onboarding's shared words and links — one place for the pricing page, the
 * setup wizard's "Start here", the welcome page, the checklist and the emails,
 * so they never say different things.
 */

import { CONTACT, DEMO_URL } from "@/lib/landing/links";

/** Step 1 of /pricing, and its API: the email already signs in somewhere. */
export const EMAIL_TAKEN_MESSAGE = "An account with this email already exists.";

/** Where a new firm brings its clients in: the CAMS / KFintech file import. */
export const IMPORT_CLIENTS_HREF = "/dashboard/rta-imports";
/** The same, from an Excel / CSV sheet. */
export const IMPORT_EXCEL_HREF = "/dashboard/investors/import";
export const INVITE_TEAM_HREF = "/dashboard/employees/new";

/** "Questions? WhatsApp us" — Aina's sales / support line. */
export const WHATSAPP_US_URL = DEMO_URL;

export const ONBOARDING_CALL_TEXT = "Hi, I've just joined AINA CRM — I'd like to book my onboarding call.";

/**
 * "Book your free onboarding call": `ONBOARDING_CALL_URL` (e.g. a Calendly
 * link) when the platform sets one, else WhatsApp to Aina with a first message.
 * Server-side only (the env is not exposed to the browser) — pages pass the
 * result down as a prop.
 */
export function onboardingCallUrl(env: Record<string, string | undefined> = process.env): string {
  const set = (env.ONBOARDING_CALL_URL ?? "").trim();
  if (/^https:\/\/\S+$/i.test(set)) return set;
  return `${CONTACT.whatsapp}?text=${encodeURIComponent(ONBOARDING_CALL_TEXT)}`;
}
