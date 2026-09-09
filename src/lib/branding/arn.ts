/**
 * One way to print an AMFI ARN.
 *
 * Firms type their ARN inconsistently — "90577", "ARN-90577", "arn 90577" —
 * and several client-facing pages rendered a hard-coded `ARN-{tenant.arn}`,
 * which printed **ARN-ARN-90577** to the investor whenever the stored value
 * already carried the prefix. Normalise once, here, and use it everywhere the
 * ARN is shown.
 */

/** "90577" | "ARN-90577" | "arn 90577" → "ARN-90577"; empty/absent → "". */
export function formatArn(raw: string | null | undefined): string {
  const bare = String(raw ?? "").trim().replace(/^arn[\s\-–—]*/i, "").trim();
  return bare ? `ARN-${bare}` : "";
}

/** The digits alone, for places that supply their own "ARN" label. */
export function bareArn(raw: string | null | undefined): string {
  return String(raw ?? "").trim().replace(/^arn[\s\-–—]*/i, "").trim();
}
