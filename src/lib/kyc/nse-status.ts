/**
 * What NSE's KYC_CHECK answer means for the client's KYC status — pure.
 *
 * NSE returns a flag (S / F) and the KRA's own remark (protocol v1.9.6,
 * p. 192). The remark is the meaning; the flag only says whether the client
 * can transact. Each remark maps onto the CRM's existing kyc_status values,
 * so every report, filter and badge keeps working:
 *
 *   KYC Validated                                → verified
 *   KYC REGISTERED                               → registered
 *   UNDER_PROCESS                                → pending
 *   ON HOLD                                      → hold
 *   KYC REJECTED                                 → rejected
 *   NOT AVAILABLE                                → pending   (no KYC at any KRA)
 *   Deactivate                                   → re_kyc_required
 *   … - Incomplete KYC (Existing / OLD Record)   → re_kyc_required
 *   CVL MF KYC                                   → re_kyc_required (old MF-only KYC)
 *   KYC_CHECK_SERVICE_DOWN                       → no answer (status untouched)
 *
 * A remark this file does not know leaves the status untouched too: a new
 * wording from NSE must never silently downgrade a verified client.
 */

export type CrmKycStatus = "pending" | "registered" | "verified" | "hold" | "rejected" | "expired" | "re_kyc_required";

export type KycVerdict =
  | { kind: "status"; status: CrmKycStatus }
  | { kind: "service_down" }
  | { kind: "unknown" };

const norm = (s: string | null | undefined) => String(s ?? "").toUpperCase().replace(/[_\s]+/g, " ").trim();

export function kycVerdict(flag: string | null | undefined, remark: string | null | undefined): KycVerdict {
  const r = norm(remark);
  if (!r) return { kind: "unknown" };
  if (r.includes("SERVICE DOWN")) return { kind: "service_down" };
  // Before REGISTERED / UNDER PROCESS / ON HOLD: the incomplete variants carry those words too.
  if (r.includes("INCOMPLETE")) return { kind: "status", status: "re_kyc_required" };
  if (r.includes("CVL MF KYC")) return { kind: "status", status: "re_kyc_required" };
  if (r.includes("DEACTIVAT")) return { kind: "status", status: "re_kyc_required" };
  if (r.includes("VALIDATED")) return { kind: "status", status: "verified" };
  if (r.includes("REJECT")) return { kind: "status", status: "rejected" };
  if (r.includes("HOLD")) return { kind: "status", status: "hold" };
  if (r.includes("UNDER PROCESS")) return { kind: "status", status: "pending" };
  if (r.includes("NOT AVAILABLE")) return { kind: "status", status: "pending" };
  if (r.includes("REGISTERED")) return { kind: "status", status: "registered" };
  void flag;
  return { kind: "unknown" };
}

const KRA_LABEL: Record<string, string> = {
  camskra: "CAMS KRA",
  cvlkra: "CVL KRA",
  ndmlkra: "NDML KRA",
  dotexkra: "NSE DotEx KRA",
  karvykra: "KFintech KRA",
};

/** "cvlkra" → "CVL KRA"; anything else is kept as NSE sent it. */
export function kraLabel(code: string | null | undefined): string | null {
  const c = String(code ?? "").trim();
  if (!c) return null;
  return KRA_LABEL[c.toLowerCase()] ?? c;
}

/** NSE dates are "DD-MM-YYYY HH:MM:SS" → "YYYY-MM-DD", or null. */
export function nseDate(s: string | null | undefined): string | null {
  const m = /^(\d{2})-(\d{2})-(\d{4})/.exec(String(s ?? "").trim());
  if (!m) return null;
  const [, d, mo, y] = m;
  const iso = `${y}-${mo}-${d}`;
  const t = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(t.getTime()) || t.getUTCDate() !== Number(d)) return null;
  return iso;
}

export const PAN_RE = /^[A-Z]{5}[0-9]{4}[A-Z]$/;
