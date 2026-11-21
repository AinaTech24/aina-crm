/**
 * The words on a client row — pure, so they are tested without rendering.
 * A null is not a zero: no AUM on record reads "—", never ₹0. A blank KYC
 * status is a record gap, not a problem, so it raises no flag.
 */

import { inr } from "../../lib/format";
import { ownPan } from "../investors/client-types";

/** AUM in Indian format; "—" when the record has none. */
export function aumLabel(aum: unknown): string {
  if (aum == null || aum === "") return "—";
  const n = Number(aum);
  return Number.isFinite(n) ? inr(n) : "—";
}

/** The client's own PAN masked to its last four, a PAN the server already
 *  masked as it came, else "PAN missing". */
export function panLabel(pan: string | null | undefined): string {
  const own = ownPan(pan);
  if (own) return `••••••${own.slice(-4)}`;
  return pan?.includes("•") ? pan : "PAN missing";
}

const KYC_ATTENTION = new Set(["pending", "hold", "rejected", "expired", "re_kyc_required"]);

/** True only for a KYC status someone has to act on. */
export function kycNeedsAttention(status: string | null | undefined): boolean {
  return !!status && KYC_ATTENTION.has(status);
}

/** Second line: PAN · RM. */
export function clientSubLine(pan: string | null | undefined, rmName?: string | null): string {
  return [panLabel(pan), rmName ? `RM ${rmName}` : null].filter(Boolean).join(" · ");
}
