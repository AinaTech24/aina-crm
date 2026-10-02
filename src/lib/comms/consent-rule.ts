/**
 * The consent rule, in one place, for every client send:
 *
 *   an opt-out (a REVOKED consent) always stops the message;
 *   MARKETING needs a recorded GRANTED consent;
 *   a transactional / utility message — a statement, a SIP bounce, a meeting
 *   confirmation, a proposal — goes out unless the client opted out.
 *
 * It used to be two rules. The template pipeline (dispatch) and Compose skipped
 * every message without a granted consent, while the ad-hoc routes (proposals,
 * statements, service acknowledgements, goal plans) sent transactional mail
 * unless the client had opted out — so with 0% consent recorded, template sends
 * were skipped and proposals went out, and the Compliance Center couldn't say
 * which rule applied. The firm chose the second rule (2026-09-29); every path
 * now asks this function.
 */

export type ConsentCategory = "transactional" | "utility" | "marketing" | "authentication" | string;

export type ConsentBlock =
  | { blocked: false }
  | { blocked: true; reason: "opted_out" | "marketing_needs_consent"; message: string };

export function consentDecision(
  category: ConsentCategory | null | undefined,
  consent: { status?: string | null } | null | undefined,
  channel: string
): ConsentBlock {
  const status = consent?.status ?? null;
  if (status === "revoked") {
    return { blocked: true, reason: "opted_out", message: `The client has opted out of ${channel}` };
  }
  if (category === "marketing" && status !== "granted") {
    return { blocked: true, reason: "marketing_needs_consent", message: `Marketing on ${channel} needs a recorded consent` };
  }
  return { blocked: false };
}
