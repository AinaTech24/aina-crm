/**
 * What a client's fact-find link may show. The link is a bearer credential for
 * 14 days and gets forwarded, so the PAN and mobile number on it are masked.
 * A masked value sent back by the form means "unchanged" (isMasked).
 */

/** "ABCDE1234F" → "AB*****34F". */
export function maskPan(v: unknown): string {
  const s = String(v ?? "").trim();
  return s.length >= 6 ? `${s.slice(0, 2)}${"*".repeat(s.length - 5)}${s.slice(-3)}` : s;
}

/** "9876543210" → "******3210". */
export function maskMobile(v: unknown): string {
  const s = String(v ?? "").trim();
  return s.length >= 6 ? `${"*".repeat(s.length - 4)}${s.slice(-4)}` : s;
}

export const isMasked = (v: unknown) => typeof v === "string" && v.includes("*");

/** The data as the client's link may show it: no advisor assessment, PAN and mobile masked. */
export function forClientLink(data: unknown): Record<string, any> {
  const out = { ...((data ?? {}) as Record<string, any>) };
  delete out.assessment;
  delete out.recommendations;
  out.identification = { ...(out.identification ?? {}) };
  if (out.identification.pan) out.identification.pan = maskPan(out.identification.pan);
  if (out.identification.mobile) out.identification.mobile = maskMobile(out.identification.mobile);
  return out;
}
