/**
 * Test fixtures for the two-person control requests (migration 0243).
 *
 * Every START (activation, kill-switch release, reversal, undo, platform
 * scheme approval) now needs a request filed by one signed-in platform
 * operator and approved by ANOTHER. In a test database that means two real
 * `users` rows — active, platform_admin, two-factor on — each holding a live
 * `user_sessions` row, exactly what requireSession() would hand the API.
 *
 * These identities exist only in the isolated test database and are disabled
 * (status 'disabled', sessions revoked) by retireOperators(); nothing here is
 * usable against a real deployment — the gate refuses non-loopback databases
 * and production markers before any of it matters.
 */
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import type { OperatorSession, ControlRequestInput, ControlRequest } from "@/lib/rta/posting/approvals";
import { REPORT_CODES, type Registrar } from "@/lib/rta/posting/controls";

export type Operators = { a: OperatorSession & { sid: string }; b: OperatorSession & { sid: string }; platformTenant: string };

/** A platform tenant and an operator in it: active platform_admin, 2FA on, one live session. */
export async function createOperator(platformTenant: string, label: string, opts: { twoFa?: boolean; roles?: string[]; status?: string } = {}) {
  const { withSystem } = await import("@/db/client");
  const userId = randomUUID();
  const sid = `test-sid-${randomUUID()}`;
  await withSystem(async (tx) => {
    await tx.execute(sql`
      INSERT INTO users (id, tenant_id, email, name, roles, status, two_fa_enabled)
      VALUES (${userId}::uuid, ${platformTenant}::uuid, ${`${label}-${userId.slice(0, 8)}@ops.test.invalid`}, ${`Test operator ${label}`},
              ${sql.raw(`ARRAY[${(opts.roles ?? ["platform_admin"]).map((r) => `'${r.replace(/'/g, "")}'`).join(",")}]::text[]`)},
              ${opts.status ?? "active"}, ${opts.twoFa ?? true})`);
    await tx.execute(sql`INSERT INTO user_sessions (tenant_id, user_id, session_id) VALUES (${platformTenant}::uuid, ${userId}::uuid, ${sid})`);
  });
  return { userId, sid };
}

/** Two operators in a fresh platform tenant. */
export async function createOperators(label = "2p"): Promise<Operators> {
  const { withSystem } = await import("@/db/client");
  const platformTenant = randomUUID();
  await withSystem((tx) => tx.execute(sql`
    INSERT INTO tenants (id, legal_name, display_name, arn)
    VALUES (${platformTenant}::uuid, ${`Ops platform ${label}`}, ${`Ops platform ${label}`}, ${`ARN-OPS${platformTenant.slice(0, 8)}`})`));
  return { a: await createOperator(platformTenant, `${label}-a`), b: await createOperator(platformTenant, `${label}-b`), platformTenant };
}

/** Disable the test operators and revoke their sessions (control requests are never deleted, so the rows stay). */
export async function retireOperators(ops: Operators | null | undefined) {
  if (!ops) return;
  const { withSystem } = await import("@/db/client");
  await withSystem(async (tx) => {
    await tx.execute(sql`UPDATE user_sessions SET revoked_at = now() WHERE user_id IN (${ops.a.userId}::uuid, ${ops.b.userId}::uuid) AND revoked_at IS NULL`);
    await tx.execute(sql`UPDATE users SET status = 'disabled' WHERE id IN (${ops.a.userId}::uuid, ${ops.b.userId}::uuid)`);
  }).catch(() => {});
}

/** File as A, approve as B — the normal two-person path. Returns the executed request. */
export async function twoPerson(ops: Operators, input: ControlRequestInput): Promise<ControlRequest> {
  const A = await import("@/lib/rta/posting/approvals");
  const req = await A.requestControlAction(ops.a, input);
  return A.approveControlAction(ops.b, { requestId: req.id, payloadHash: req.payloadHash });
}

/** Release a kill-switch scope through a two-person request. */
export const release = (ops: Operators, scope: string, reason = "test database: posting released by two operators") =>
  twoPerson(ops, { action: "release", scope, changeRef: "CHG-TEST-RELEASE", reason });

/** Every report code the given registrars send (a test that is not about report scope). */
export const allCodes = (registrars: Registrar[]) => registrars.flatMap((r) => REPORT_CODES[r]);

/** Start an activation through a two-person request. Posting activations get every code of their registrars and a 7-day expiry unless told otherwise. */
export function activate(ops: Operators, a: {
  tenantId: string; mode: "off" | "shadow" | "validate_first"; postingEnabled: boolean; reason?: string; changeRef?: string;
  registrars?: Registrar[] | null; reportCodes?: string[] | null; expiresAt?: string | null;
}) {
  const registrars = a.registrars ?? (a.postingEnabled ? (["cams", "kfintech"] as Registrar[]) : null);
  return twoPerson(ops, {
    action: "activate", tenantId: a.tenantId, mode: a.mode, postingEnabled: a.postingEnabled,
    registrars, reportCodes: a.reportCodes ?? (a.postingEnabled && registrars ? allCodes(registrars) : null),
    expiresAt: a.expiresAt ?? (a.postingEnabled ? new Date(Date.now() + 7 * 864e5).toISOString() : null),
    changeRef: a.changeRef ?? "CHG-TEST-ACTIVATE", reason: a.reason ?? "test activation by two operators",
  });
}
