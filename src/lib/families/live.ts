/**
 * Who counts as a member of a family, in SQL.
 *
 * The module summed family AUM six different ways — only `status = 'active'`
 * members on the list, every non-deleted member on the family page, deleted
 * ones too on the next-gen view — so one household could show ₹10 L in the
 * list and ₹2.1 Cr on its own page. A family member now counts exactly when
 * the client counts everywhere else in the CRM: LIVE — not deleted, not merged
 * into another record, not closed (lib/metrics `aliveClient`). A dormant or
 * redemption-risk client is still a client, and their money is still the
 * family's.
 */

import { sql, type SQL } from "drizzle-orm";
import { aliveClient } from "@/lib/metrics/scope";

/** LIVE member condition on an investors alias. */
export function liveMember(alias = "i"): SQL {
  return aliveClient(alias);
}

/** `LEFT JOIN investors i ON <this>` — the live members of family `f`. */
export const LIVE_MEMBER_JOIN = sql.raw(
  "i.family_id = f.id AND i.deleted_at IS NULL AND i.merged_into_id IS NULL AND i.status NOT IN ('closed', 'exited')"
);
