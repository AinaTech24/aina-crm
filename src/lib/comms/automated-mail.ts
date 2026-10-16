/**
 * Is this email machine-made or passed on, rather than a person writing to the
 * firm? Used by scripts/close-auto-email-tickets.ts to find the service
 * requests the old email intake opened by mistake.
 *
 * (An email no longer opens a service request at all — clients ask through the
 * firm's service request form. Nimesh C Shah Financial Services, 6–16 Oct 2026:
 * 483 tickets, 332 of them the firm's own "SIP INSTALLMENT REMINDER" mail whose
 * footer says "bank account".)
 */

const AUTOMATED_SENDER = /(^|[._-])(no-?reply|do-?not-?reply|donotreply|mailer-daemon|postmaster|notifications?|alerts?|newsletter|bounces?|autoresponder)([._-]|@)/i;
const AUTOMATED_WORDS =
  /\b(unsubscribe|view (this )?(e-?mail )?in (your )?browser|do not reply|auto-?generated|this is an automated|newsletter|one[- ]time password)\b/i;
const REMINDER = /\b(upcoming sip|sip instal+ment reminder|instal+ment reminder|sip reminder)\b/i;
const LINK = /https?:\/\/|javascript:/gi;

/** Why this mail is automated, or null when a person seems to have written it. */
export function automatedReason(m: { from?: string | null; subject?: string | null; text?: string | null }): string | null {
  const from = (m.from ?? "").toLowerCase();
  const subject = m.subject ?? "";
  const head = (m.text ?? "").slice(0, 600);
  if (AUTOMATED_SENDER.test(from)) return "sent from a no-reply / notification address";
  if (REMINDER.test(subject) || REMINDER.test(head)) return "a SIP reminder";
  if (AUTOMATED_WORDS.test(subject) || AUTOMATED_WORDS.test((m.text ?? "").slice(0, 4000))) return "an automated or bulk message";
  // A templated HTML mail turns into text that is mostly links.
  if ((head.match(LINK) ?? []).length >= 3) return "a templated message (mostly links)";
  return null;
}

export const isForwarded = (subject: string | null | undefined): boolean => /^\s*(fwd?|fw)\s*:/i.test(subject ?? "");
