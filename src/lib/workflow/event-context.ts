/** One event shape for historical snapshots, outbox records and direct starts.
 * Payload fields remain addressable as event.after.* and event.*. */
export function normalizeWorkflowEvent(input: Record<string, unknown> | null | undefined): Record<string, unknown> | null {
  if (!input) return null;
  const after = input.after && typeof input.after === "object" ? input.after as Record<string, unknown> : {};
  const meta = input.meta && typeof input.meta === "object" ? input.meta as Record<string, unknown> : {};
  const merged = { ...meta, ...after, ...input };
  for (const [key, value] of Object.entries(merged)) {
    const snake = key.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);
    if (!(snake in merged)) merged[snake] = value;
  }
  return merged;
}
