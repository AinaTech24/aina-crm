/**
 * Who may open the Documents vault, and how much of it they see.
 *
 * The vault used to be gated on `compliance.view || kyc.manage`, i.e. the
 * compliance and back-office team only. That was too narrow in a way users hit
 * constantly: an RM can already open a client's documents from the client
 * record (`/api/investors/[id]/documents` gates on `document.view`, which RMs
 * and branch heads hold), and the in-app guide tells them to request documents
 * from this very page — but the hub itself answered "available to the
 * compliance and back-office team". The sidebar showed them the link anyway.
 *
 * So the rule is now: anyone who may view documents AND may view clients can
 * open the hub, and WHAT IT SHOWS is scoped instead of the door being shut.
 *
 *   compliance / back-office / ops / owner  → the whole vault, firm documents
 *                                             (ARN certificate, audit reports,
 *                                             complaints) included
 *   RM / branch head                        → documents filed against THEIR
 *                                             OWN clients, and nothing else
 *   everyone else                           → no access, and no sidebar link
 *
 * Firm-level documents deliberately stay with the first group: they are the
 * firm's regulatory file, not client paperwork.
 */

import { and, eq, sql, type SQL } from "drizzle-orm";
import { can } from "@/lib/auth/rbac";
import { complianceDocuments } from "@/db/schema";

/** The parts of a session this module needs — keeps it usable from pages and routes alike. */
export type VaultViewer = {
  roles?: string[];
  permissions?: string[] | null;
  userId: string;
  tenantId: string;
};

/**
 * Sees every document in the firm, including documents not tied to a client.
 * `can()` grants the owner everything, so owners land here.
 */
export function seesWholeVault(v: VaultViewer): boolean {
  return (
    can(v.roles, "compliance.view", v.permissions) ||
    can(v.roles, "kyc.manage", v.permissions) ||
    can(v.roles, "investor.view.all", v.permissions)
  );
}

/**
 * May open the hub at all.
 *
 * Both halves are required. `document.view` alone is held by marketing, who
 * have no client-view capability whatsoever — letting them in would show an
 * empty vault, which is a worse dead end than being told it isn't theirs.
 */
export function canOpenVault(v: VaultViewer): boolean {
  if (seesWholeVault(v)) return true;
  return (
    can(v.roles, "document.view", v.permissions) &&
    can(v.roles, "investor.view.assigned", v.permissions)
  );
}

/**
 * Restrict `compliance_documents` to this viewer's own clients.
 *
 * Returns undefined for a whole-vault viewer so callers can drop it into an
 * `and(...)` unchanged. Written against the real column names because it is
 * also spliced into the hand-written stats query.
 */
export function ownClientDocsOnly(v: VaultViewer): SQL | undefined {
  if (seesWholeVault(v)) return undefined;
  return and(
    eq(complianceDocuments.relatedEntityType, "investor"),
    sql`${complianceDocuments.relatedEntityId} IN (
      SELECT id FROM investors
      WHERE tenant_id = ${v.tenantId}::uuid
        AND rm_id = ${v.userId}::uuid
        AND deleted_at IS NULL
    )`
  );
}

/**
 * The same restriction as a bare fragment, for raw `tx.execute(sql\`…\`)`
 * queries where there is no Drizzle table object to reference. `TRUE` for a
 * whole-vault viewer so it can always be AND-ed in.
 */
export function vaultScopeFragment(v: VaultViewer): SQL {
  if (seesWholeVault(v)) return sql`TRUE`;
  return sql`(
    related_entity_type = 'investor'
    AND related_entity_id IN (
      SELECT id FROM investors
      WHERE tenant_id = ${v.tenantId}::uuid
        AND rm_id = ${v.userId}::uuid
        AND deleted_at IS NULL
    )
  )`;
}
