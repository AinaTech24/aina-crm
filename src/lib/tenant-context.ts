/**
 * Which firm the current request or job is working for, carried across
 * awaits (AsyncLocalStorage). Set by `withTenant` (db/client.ts) before its
 * first await, so the caller's code after `await withTenant(...)` sees it too,
 * and by `assertAiEnabled` (lib/ai/firm-switch.ts) in the AI routes.
 *
 * Read by the AI provider so a firm that switched AI off is refused on every
 * path — routes, workflow actions, auto-replies — without each caller having
 * to remember. Node only: never import this from middleware (Edge).
 */

import { AsyncLocalStorage } from "node:async_hooks";

const store = new AsyncLocalStorage<{ tenantId: string }>();

/** Record the firm for everything that follows in this async flow. */
export function noteTenant(tenantId: string): void {
  if (!tenantId) return;
  const cur = store.getStore();
  if (cur?.tenantId === tenantId) return;
  store.enterWith({ tenantId });
}

export function currentTenant(): string | null {
  return store.getStore()?.tenantId ?? null;
}
