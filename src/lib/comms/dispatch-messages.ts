/**
 * What an RM is told when dispatch() reports a message that did not go out.
 *
 * dispatch() returns a skipped or failed send as a normal RESULT (its audit row
 * is written either way), so a route has to turn it into a status code and a
 * sentence itself. One wording, shared by every route that sends.
 */

const REASONS: Record<string, string> = {
  skipped_consent: "Not sent - the client has opted out of this channel, or marketing consent is not recorded.",
  skipped_compliance: "Not sent - blocked by the compliance check.",
  skipped_session: "Not sent - the WhatsApp session with this client is not active.",
  skipped_rate_limit: "Not sent - the sending rate limit was reached. Try again shortly.",
  skipped_quota: "Not sent - the monthly message quota is used up.",
  skipped_frequency_cap: "Not sent - this client was messaged too recently.",
  skipped_no_contact: "Not sent - no valid address for this client (missing or suppressed).",
  template_not_approved: "Not sent - the template is not approved.",
};

export function dispatchFailureMessage(
  r: { status: string; error?: string; skipped?: { reason: string; detail?: string } },
  channel: "email" | "whatsapp" | "sms" = "email"
): string {
  const what = channel === "email" ? "email" : channel === "sms" ? "SMS" : "WhatsApp message";
  if (r.status === "failed") return r.error ? `The ${what} could not be sent: ${r.error}` : "The message could not be sent.";
  const reason = r.skipped?.reason ?? "";
  // A render error carries the real cause (e.g. no holdings to compare); the others have a standard line.
  if (reason === "render_error") return r.skipped?.detail ?? "The message could not be prepared.";
  const base = REASONS[reason] ?? `Not sent (${reason || "skipped"}).`;
  return reason === "skipped_consent" && r.skipped?.detail ? r.skipped.detail : base;
}

