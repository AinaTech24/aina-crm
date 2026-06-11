/**
 * Helpers for the calculator PDF / share routes (server-only).
 */

/** Best-effort fetch of the firm logo bytes for the PDF letterhead. HTTPS only,
 *  size- and time-capped; any failure just drops the logo (no hard error). */
export async function fetchBrandLogoBytes(logoUrl?: string | null): Promise<Uint8Array | null> {
  if (!logoUrl || !/^https:\/\//i.test(logoUrl)) return null;
  try {
    const res = await fetch(logoUrl, { signal: AbortSignal.timeout(6000) });
    if (!res.ok) return null;
    const ct = res.headers.get("content-type") ?? "";
    if (!/image\/(png|jpe?g)/i.test(ct)) return null;
    const buf = new Uint8Array(await res.arrayBuffer());
    return buf.length > 0 && buf.length < 3_000_000 ? buf : null;
  } catch {
    return null;
  }
}

/** Normalise an Indian-or-international phone to digits with country code for
 *  a wa.me link (defaults to +91 when a bare 10-digit number is given). */
export function normalizeWaPhone(raw: string): string | null {
  const digits = (raw ?? "").replace(/[^\d]/g, "");
  if (!digits) return null;
  if (digits.length === 10) return `91${digits}`;
  if (digits.length >= 11 && digits.length <= 15) return digits;
  return null;
}
