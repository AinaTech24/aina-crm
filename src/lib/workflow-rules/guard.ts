/**
 * Save-time guards for Workflow Rules (shared by POST + PATCH).
 *
 * record_action rules fire from the outbox; score_change rules piggyback on
 * edit events; date_field + recurrence rules fire from the time scanner
 * worker. Note / recommendation / competitor triggers (Zoho Zia concepts) and
 * the `create_record` / `custom_function` action stubs stay rejected at save
 * time so a user never builds an inert rule that silently never fires.
 */
const IMPLEMENTED_TRIGGERS = new Set(["record_action", "date_field", "score_change", "recurrence"]);
const UNIMPLEMENTED_ACTIONS = new Set(["create_record", "custom_function"]);

export function unsupportedRuleFeature(input: {
  triggerType: string;
  instantActions?: Array<{ type: string }>;
  scheduledActions?: Array<{ type: string }>;
}): string | null {
  if (!IMPLEMENTED_TRIGGERS.has(input.triggerType)) {
    return `Trigger "${input.triggerType}" isn't active yet — record create/edit/delete, date-based, score-based and recurring rules all fire; note-based triggers are coming soon.`;
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
