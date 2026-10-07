/**
 * Who may open the Documents vault, and how much of it they see.
 *
 * The vault used to be gated on `compliance.view || kyc.manage`, i.e. the
 * compliance and back-office team only. That was too narrow in a way users hit
 * constantly: an RM can already open a client's documents from the client
 * record (`/api/investors/[id]/documents` gates on `document.view`, which RMs
 * and branch heads hold), and the in-app guide points them at this very page to
 * request documents — but the hub itself answered "available to the compliance
 * and back-office team", while the sidebar showed them the link anyway.
 *
 * The rule is now: anyone who may view documents AND may view clients can open
 * the hub, and WHAT IT SHOWS is scoped rather than the door being shut.
 *
 *   compliance / back-office / ops / owner  → the whole vault, firm documents
 *                                             (ARN certificate, audit reports,
 *                                             complaints) included
 *   RM / branch head                        → documents filed against clients
 *                                             they can see, and nothing else
 *   everyone else                           → no access, and no sidebar link
 *
 * Firm-level documents deliberately stay with the first group: they are the
 * firm's regulatory file, not client paperwork.
 *
 * Which clients an RM "can see" is NOT decided here — it delegates to
 * `investorScopeSql`, the same per-tenant data wall the client list, the export
 * and the mobile API already use. A firm that has not switched the wall on
 * gives its RMs the whole book, and this page then agrees with every other page
 * instead of inventing a stricter rule of its own.
 */

import { and, eq, or, sql, type SQL } from "drizzle-orm";
import { can } from "@/lib/auth/rbac";
import { complianceDocuments } from "@/db/schema";
import { hasCustomPermissions, investorScopeSql } from "@/lib/investors/access";
import type { SessionUser } from "@/lib/auth/session";

/**
 * Sees the firm's own documents (ARN certificate, audit reports, complaints —
 * anything not filed against a client).
 */
function seesFirmDocuments(s: SessionUser): boolean {
  return (
    can(s.roles, "compliance.view", s.permissions) ||
    can(s.roles, "kyc.manage", s.permissions) ||
    can(s.roles, "investor.view.all", s.permissions)
  );
}

const hasClientView = (s: SessionUser) =>
  can(s.roles, "investor.view.all", s.permissions) || can(s.roles, "investor.view.assigned", s.permissions);

/**
 * Sees every document in the firm, including documents not tied to a client.
 * `can()` grants the owner everything, so owners land here.
 *
 * A person whose permissions the owner CUSTOMISED never does: their client
 * documents always go through the client data scope (lib/investors/access),
 * so "View assigned clients only" also limits the vault to their own book.
 */
export function seesWholeVault(s: SessionUser): boolean {
  if (hasCustomPermissions(s)) return false;
  return seesFirmDocuments(s);
}

/**
 * May open the hub at all.
 *
 * Both halves are required. `document.view` alone is held by marketing, who
 * have no client-view capability whatsoever — letting them in would show an
 * empty vault, which is a worse dead end than being told it isn't theirs. It
 * also keeps `investorScopeSql` below from throwing, since it requires a
 * client-view capability.
 */
export function canOpenVault(s: SessionUser): boolean {
  if (seesWholeVault(s) || seesFirmDocuments(s)) return true;
  return (
    can(s.roles, "document.view", s.permissions) &&
    can(s.roles, "investor.view.assigned", s.permissions)
  );
}

/**
 * Drizzle condition restricting `compliance_documents` to what this session may
 * see. `undefined` means "no restriction", so callers can drop it into an
 * `and(...)` without an extra branch.
 */
export async function vaultScopeCondition(tx: any, s: SessionUser): Promise<SQL | undefined> {
  if (seesWholeVault(s)) return undefined;
  const clientDocs = hasClientView(s)
    ? and(
        eq(complianceDocuments.relatedEntityType, "investor"),
        sql`${complianceDocuments.relatedEntityId} IN (
          SELECT id FROM investors
          WHERE tenant_id = ${s.tenantId}::uuid AND deleted_at IS NULL AND ${await investorScopeSql(tx, s)}
        )`
      )
    : sql`FALSE`;
  if (!seesFirmDocuments(s)) return clientDocs;
  return or(
    sql`${complianceDocuments.relatedEntityType} IS DISTINCT FROM 'investor'`,
    clientDocs
  );
}

/**
 * The same restriction as a bare fragment, for hand-written `sql` queries where
 * there is no Drizzle table object to reference. `TRUE` for a whole-vault
 * viewer so it can always be AND-ed in.
 */
export async function vaultScopeFragment(tx: any, s: SessionUser): Promise<SQL> {
  if (seesWholeVault(s)) return sql`TRUE`;
  const clientDocs = hasClientView(s)
    ? sql`(
        related_entity_type = 'investor'
        AND related_entity_id IN (
          SELECT id FROM investors
          WHERE tenant_id = ${s.tenantId}::uuid AND deleted_at IS NULL AND ${await investorScopeSql(tx, s)}
        )
      )`
    : sql`FALSE`;
  if (!seesFirmDocuments(s)) return clientDocs;
  return sql`(related_entity_type IS DISTINCT FROM 'investor' OR ${clientDocs})`;
}
