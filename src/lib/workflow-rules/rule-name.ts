/**
 * An automation's name must say what it does and be the only one with that
 * name in the firm — "frew" and two rules both called "Send mail" were exactly
 * what made the Automations list unreadable. SERVER-ONLY (queries the DB).
 *
 * Checked on create and whenever a name is sent on update; a toggle or reorder
 * that doesn't touch the name never trips it, so an old short name can still
 * be switched off before it is renamed.
 */
import { sql } from "drizzle-orm";
import type { Tx } from "@/db/client";
import { RULE_NAME_MIN } from "./describe";

export async function ruleNameProblem(
  tx: Tx,
  tenantId: string,
  name: string,
  excludeId?: string
): Promise<string | null> {
  const n = name.trim();
  if (n.length < RULE_NAME_MIN) {
    return `Give the automation a name of at least ${RULE_NAME_MIN} characters that says what it does, e.g. “Birthday wish to clients”.`;
  }
  // Unique across the whole firm, ignoring case and outer spaces — the list
  // shows every module together, so a clash anywhere reads as a duplicate.
  const clash = await tx.execute(sql`
    SELECT name, module FROM workflow_rules
     WHERE tenant_id = ${tenantId}::uuid
       AND lower(btrim(name)) = lower(${n})
       ${excludeId ? sql`AND id <> ${excludeId}::uuid` : sql``}
     LIMIT 1
  `);
  if (clash.rows.length > 0) return "Another automation already has this name. Choose a different one.";
  return null;
}
