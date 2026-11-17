/**
 * Families from a Zoho family sheet, for clients already in the CRM (We Care
 * Freedom Wealth, 2026-11-17). Preview and apply are the same code; a preview
 * rolls back (see run-contacts.ts).
 *
 *  - A row's client is the one whose Zoho Record ID (custom field, set by the
 *    Contacts import) is the row's Record Id. Nothing is matched by name.
 *  - The head's family is the one they already head, else a new FAM-####
 *    built from the head (headFamily in run-contacts.ts).
 *  - Members KEEP their own RM and address (the firm's choice for this sheet):
 *    only the family link is added. A member already in another family is
 *    left there and reported.
 *  - Nothing is sent and no workflow starts.
 */

import { sql } from "drizzle-orm";
import type { Tx } from "@/db/client";
import { withTenant } from "@/db/client";
import { recordAudit } from "@/lib/audit";
import { loadFamilySettings } from "@/lib/families/master";
import { recomputeFamilyHealth } from "@/lib/families/health-persist";
import { onClientFamilyMapped } from "@/lib/families/journey";
import { ZOHO_ID_FIELD } from "./contacts";
import { planFamilies } from "./family-groups";
import { headFamily, type ImportActor } from "./run-contacts";

export type FamilyImportResult = {
  dryRun: boolean;
  totalRows: number;
  familiesInSheet: number;
  created: number;
  existing: number;
  membersLinked: number;
  alreadyInFamily: number;
  nestedHeadsJoined: number;
  aloneSkipped: number;
  /** Rows that could not be placed, grouped by reason. */
  problems: Array<{ reason: string; count: number }>;
  /** Up to 300 named examples. */
  details: Array<{ head: string; member?: string; reason: string }>;
};

class Rollback extends Error {
  constructor(public result: FamilyImportResult) {
    super("dry run");
  }
}

export async function importZohoFamilies(
  actor: ImportActor,
  rows: Record<string, unknown>[],
  opts: { dryRun: boolean; now?: Date; tx?: Tx }
): Promise<FamilyImportResult> {
  const plan = planFamilies(rows);

  const run = async (tx: Tx): Promise<FamilyImportResult> => {
    const result: FamilyImportResult = {
      dryRun: opts.dryRun,
      totalRows: rows.length,
      familiesInSheet: plan.groups.length,
      created: 0,
      existing: 0,
      membersLinked: 0,
      alreadyInFamily: 0,
      nestedHeadsJoined: plan.groups.reduce((n, g) => n + g.nestedHeads, 0),
      aloneSkipped: plan.aloneSkipped,
      problems: [],
      details: [],
    };
    const problem = new Map<string, number>();
    const note = (reason: string, n: number, head: string, member?: string) => {
      problem.set(reason, (problem.get(reason) ?? 0) + n);
      if (result.details.length < 300) result.details.push({ head, member, reason });
    };
    for (const h of plan.headMissing) note("Family Owner is not in the sheet", h.rows, h.headName || h.headZohoId);

    const clients = (await tx.execute(sql`
      SELECT id, name, family_id, custom_fields->>${ZOHO_ID_FIELD.key} AS zoho_id
        FROM investors
       WHERE tenant_id = ${actor.tenantId}::uuid AND deleted_at IS NULL AND merged_into_id IS NULL
         AND custom_fields ? ${ZOHO_ID_FIELD.key}
    `)).rows as Array<{ id: string; name: string; family_id: string | null; zoho_id: string }>;
    const byZoho = new Map(clients.map((c) => [c.zoho_id, c]));
    const settings = await loadFamilySettings(tx, actor.tenantId);

    for (const g of plan.groups) {
      const head = byZoho.get(g.headZohoId);
      if (!head) {
        note("Family head is not in the CRM (import the client first)", g.memberZohoIds.length + 1, g.headName || g.headZohoId);
        continue;
      }
      const memberClients = g.memberZohoIds.map((z) => ({ z, c: byZoho.get(z) }));
      const missing = memberClients.filter((m) => !m.c);
      for (const m of missing) note("Member is not in the CRM (import the client first)", 1, head.name, m.z);
      const ids = [...new Set(memberClients.filter((m) => m.c && m.c.id !== head.id).map((m) => m.c!.id))];
      if (!ids.length) {
        note("No member of this family is in the CRM", 1, head.name);
        continue;
      }

      let familyId: string | null = null;
      await tx.transaction(async (spRaw) => {
        const sp = spRaw as unknown as Tx;
        const hf = await headFamily(sp, actor, head, settings, "Created from the Zoho family sheet (Family Owner).");
        if (hf.outcome === "head_in_other") {
          note("Family head is already a member of another family", ids.length + 1, head.name);
          return;
        }
        if (!hf.familyId) return;
        familyId = hf.familyId;
        if (hf.outcome === "created") result.created++;
        else result.existing++;

        const linked = (await sp.execute(sql`
          UPDATE investors SET family_id = ${familyId}::uuid, updated_at = now()
           WHERE tenant_id = ${actor.tenantId}::uuid
             AND id = ANY(ARRAY[${sql.join(ids.map((id) => sql`${id}`), sql`, `)}]::uuid[])
             AND family_id IS NULL
          RETURNING id
        `)).rows.map((r) => String((r as { id: string }).id));
        result.membersLinked += linked.length;
        const notLinked = ids.filter((id) => !linked.includes(id));
        if (notLinked.length) {
          const where = (await sp.execute(sql`
            SELECT id, name, family_id FROM investors
             WHERE tenant_id = ${actor.tenantId}::uuid AND id = ANY(ARRAY[${sql.join(notLinked.map((id) => sql`${id}`), sql`, `)}]::uuid[])
          `)).rows as Array<{ id: string; name: string; family_id: string | null }>;
          for (const w of where) {
            if (w.family_id === familyId) result.alreadyInFamily++;
            else note("Member is already in another family (left there)", 1, head.name, w.name);
          }
        }
        for (const id of linked) await onClientFamilyMapped(sp, actor.tenantId, id);
        await recomputeFamilyHealth(sp, familyId, opts.now ?? new Date());
        if (linked.length) {
          await recordAudit(sp, {
            tenantId: actor.tenantId,
            actorUserId: actor.userId,
            action: "family.member.add",
            entityType: "family",
            entityId: familyId,
            after: { investorIds: linked, source: "zoho_family_sheet" },
          });
        }
      });
    }

    result.problems = [...problem.entries()].map(([reason, count]) => ({ reason, count })).sort((a, b) => b.count - a.count);
    await recordAudit(tx, {
      tenantId: actor.tenantId,
      actorUserId: actor.userId,
      action: "family.bulk_import",
      entityType: "family",
      entityId: null,
      meta: {
        source: "zoho_family_sheet",
        totalRows: rows.length,
        created: result.created,
        existing: result.existing,
        membersLinked: result.membersLinked,
        problems: result.problems,
      },
    });

    if (opts.dryRun) throw new Rollback(result);
    return result;
  };

  try {
    if (opts.tx) return await opts.tx.transaction((sp) => run(sp as unknown as Tx));
    return await withTenant(actor.tenantId, run, { userId: actor.userId, branchId: actor.branchId ?? undefined, roles: actor.roles });
  } catch (err) {
    if (err instanceof Rollback) return err.result;
    throw err;
  }
}
