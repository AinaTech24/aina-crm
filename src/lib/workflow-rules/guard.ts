/**
 * Save-time guards for Workflow Rules (shared by POST + PATCH).
 *
 * Only `record_action` triggers are evaluated by the runner today, and
 * `create_record` / `custom_function` actions are unimplemented stubs. Reject
 * them at save time so a user never builds an inert rule that silently never
 * fires (or whose action silently no-ops).
 */
const IMPLEMENTED_TRIGGERS = new Set(["record_action"]);
const UNIMPLEMENTED_ACTIONS = new Set(["create_record", "custom_function"]);

export function unsupportedRuleFeature(input: {
  triggerType: string;
  instantActions?: Array<{ type: string }>;
  scheduledActions?: Array<{ type: string }>;
}): string | null {
  if (!IMPLEMENTED_TRIGGERS.has(input.triggerType)) {
    return `Trigger "${input.triggerType}" isn't active yet — only "on record create / edit / delete" rules currently fire. Date-field, score-change, note and recurrence triggers are coming soon.`;
  }
  const bad = [...(input.instantActions ?? []), ...(input.scheduledActions ?? [])]
    .map((a) => a.type)
    .find((t) => UNIMPLEMENTED_ACTIONS.has(t));
  if (bad) return `Action "${bad}" isn't implemented yet — use a Webhook (or another action) for now.`;
  return null;
}

/** Map a Postgres unique-violation on the rule-name index to a clean 409. */
export function isDuplicateNameError(e: any): boolean {
  return e?.code === "23505" || /wr_tenant_name_unique|duplicate key/i.test(String(e?.message ?? ""));
}
