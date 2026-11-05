/**
 * A firm's switch for AI features (tenants.ai_enabled, migration 0258,
 * Settings → Security). The firm is the data fiduciary: switching AI off means
 * none of its data goes to the AI provider. Enforced in the provider for every
 * call made while a firm is in context (lib/tenant-context.ts), and checked
 * up front by the AI routes so they refuse with a clear message.
 */

import { sql } from "drizzle-orm";
import { withTenant } from "@/db/client";
import { noteTenant } from "@/lib/tenant-context";

const TTL_MS = 30_000;
const cache = new Map<string, { on: boolean; at: number }>();

export const AI_OFF_MESSAGE = "AI features are switched off for your firm. An owner can turn them on in Settings → Security.";

export class AiDisabledError extends Error {
  status = 403;
  constructor() {
    super(AI_OFF_MESSAGE);
    this.name = "AiDisabledError";
  }
}

export async function aiEnabledFor(tenantId: string): Promise<boolean> {
  const hit = cache.get(tenantId);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.on;
  let on = true;
  try {
    const r = await withTenant(tenantId, (tx) => tx.execute(sql`SELECT ai_enabled FROM tenants WHERE id = ${tenantId}::uuid`));
    const row = r.rows[0] as { ai_enabled?: boolean } | undefined;
    on = row?.ai_enabled !== false;
  } catch {
    // Before migration 0258 the column does not exist: AI stays as it was.
    on = true;
  }
  cache.set(tenantId, { on, at: Date.now() });
  return on;
}

/** Forget the cached switch — called when an owner changes it. */
export function forgetAiSwitch(tenantId: string): void {
  cache.delete(tenantId);
}

/** For an AI route: note the firm, then refuse if its AI is off. */
export async function assertAiEnabled(tenantId: string): Promise<void> {
  noteTenant(tenantId);
  if (!(await aiEnabledFor(tenantId))) throw new AiDisabledError();
}
