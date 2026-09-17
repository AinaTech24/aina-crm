/** Local data namespace only. The server remains responsible for JWT verification. */
let owner: string | null = null;
let generation = 0;
const listeners = new Set<() => void>();
export function accountFromToken(token: string): string {
  const encoded = token.split(".")[1];
  if (!encoded) throw new Error("Invalid session");
  const payload = JSON.parse(atob(encoded.replace(/-/g, "+").replace(/_/g, "/"))) as Record<string, unknown>;
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (typeof payload.tenantId !== "string" || typeof payload.userId !== "string" || !uuid.test(payload.tenantId) || !uuid.test(payload.userId)) throw new Error("Invalid account identity");
  return `${payload.tenantId}.${payload.userId}`;
}
export function getAccountScope() { return { owner, generation }; }
export function setAccountScope(next: string | null) {
  if (owner === next) return;
  owner = next;
  generation++;
  listeners.forEach((listener) => listener());
}
export function onAccountChange(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; }
