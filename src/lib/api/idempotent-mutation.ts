import { createHash } from "node:crypto";
import { sql } from "drizzle-orm";
import { withTenant, type Tx } from "@/db/client";
import type { SessionUser } from "@/lib/auth/jwt";

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.entries(value).filter(([, v]) => v !== undefined).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(",")}}`;
  return JSON.stringify(value) ?? "null";
}
export function mutationFingerprint(method: string, path: string, body: unknown) {
  return createHash("sha256").update(`${method}\n${path}\n${canonical(body)}`).digest("hex");
}
/** The business mutation and replay receipt commit together, or both roll back. */
export async function withIdempotentMutation<T>(
  session: SessionUser, request: Request, body: unknown, fn: (tx: Tx) => Promise<T>,
  options?: Parameters<typeof withTenant>[2],
): Promise<T> {
  const key = request.headers.get("idempotency-key");
  const context = options ?? { userId: session.userId, branchId: session.branchId, roles: session.roles };
  if (!key) return withTenant(session.tenantId, fn, context);
  if (!/^[a-zA-Z0-9_-]{8,128}$/.test(key)) throw Object.assign(new Error("Invalid idempotency key"), { status: 400 });
  const fingerprint = mutationFingerprint(request.method, new URL(request.url).pathname, body);
  return withTenant(session.tenantId, async (tx) => {
    // Colliding hashes only serialize unrelated requests; the exact tuple is checked below.
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${`${session.tenantId}:${session.userId}:${key}`}, 0))`);
    const previous = (await tx.execute(sql`SELECT fingerprint, result FROM api_mutation_receipts
      WHERE tenant_id = ${session.tenantId}::uuid AND user_id = ${session.userId}::uuid AND request_key = ${key}`)).rows[0];
    if (previous) {
      if (previous.fingerprint !== fingerprint) throw Object.assign(new Error("This request key was already used for a different change"), { status: 409 });
      return previous.result as T;
    }
    const result = await fn(tx);
    await tx.execute(sql`INSERT INTO api_mutation_receipts (tenant_id, user_id, request_key, fingerprint, result)
      VALUES (${session.tenantId}::uuid, ${session.userId}::uuid, ${key}, ${fingerprint}, ${JSON.stringify(result ?? null)}::jsonb)`);
    return result;
  }, context);
}
