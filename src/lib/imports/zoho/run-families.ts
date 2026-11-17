/**
 * Families from a Zoho family sheet, for clients already in the CRM (We Care
 * Freedom Wealth, 2026-11-17). Preview and apply are the same code; a preview
 * rolls back (see run-contacts.ts).
 *
 *  - A row's client is the one whose Zoho Record ID (custom field, set by the
 *    Contacts import) is the row's Record Id. A client without one (We Care's
 *    were loaded by the Excel client import) is matched by EXACT name — any
 *    case, spacing or dots — only when that name belongs to exactly one live
 *    client in the CRM and one row in the sheet. Repeated names are reported,
 *    never guessed. A client matched by name gets the row's Zoho Record ID, so
 *    a second run (and the Meetings import) matches it exactly.
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
import { nameKey } from "./values";
import { customFieldDefs } from "@/db/schema";
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
  /** Clients found by Zoho Record ID / by exact unique name. */
  matchedById: number;
  matchedByName: number;
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
      matchedById: 0,
      matchedByName: 0,
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
    `)).rows as Array<{ id: string; name: string; family_id: string | null; zoho_id: string | null }>;
    const byZohoId = new Map(clients.filter((c) => c.zoho_id).map((c) => [c.zoho_id as string, c]));
    // Exact-name fallback: names held by exactly one live client AND one sheet row.
    const crmNames = new Map<string, (typeof clients)[number] | null>();
    for (const c of clients) {
      const k = nameKey(c.name);
      if (!k) continue;
      crmNames.set(k, crmNames.has(k) ? null : c);
    }
    const sheetNameCount = new Map<string, number>();
    for (const n of plan.nameOf.values()) {
      const k = nameKey(n);
      if (k) sheetNameCount.set(k, (sheetNameCount.get(k) ?? 0) + 1);
    }
    const stampIds: Array<{ id: string; zoho: string }> = [];
    const resolved = new Map<string, (typeof clients)[number] | undefined>();
    const why = new Map<string, string>();
    const resolve = (zoho: string) => {
      if (resolved.has(zoho)) return resolved.get(zoho);
      let c = byZohoId.get(zoho);
      if (c) result.matchedById++;
      else {
        const k = nameKey(plan.nameOf.get(zoho) ?? "");
        const hit = k ? crmNames.get(k) : undefined;
        if (!k) why.set(zoho, "no name on the row");
        else if (hit === undefined) why.set(zoho, "no client with this name in the CRM");
        else if (hit === null) why.set(zoho, "several clients in the CRM have this name");
        else if ((sheetNameCount.get(k) ?? 0) > 1) why.set(zoho, "several rows in the sheet have this name");
        else if (hit.zoho_id && hit.zoho_id !== zoho) why.set(zoho, "the client with this name has a different Zoho Record ID");
        else {
          c = hit;
          result.matchedByName++;
          stampIds.push({ id: hit.id, zoho });
        }
      }
      resolved.set(zoho, c);
      return c;
    };
    const byZoho = { get: (z: string) => resolve(z) };
    const settings = await loadFamilySettings(tx, actor.tenantId);

    for (const g of plan.groups) {
      const head = byZoho.get(g.headZohoId);
      if (!head) {
        note(`Family head not matched: ${why.get(g.headZohoId) ?? "not in the CRM"}`, g.memberZohoIds.length + 1, g.headName || g.headZohoId);
        continue;
      }
      const memberClients = g.memberZohoIds.map((z) => ({ z, c: byZoho.get(z) }));
      const missing = memberClients.filter((m) => !m.c);
      for (const m of missing) note(`Member not matched: ${why.get(m.z) ?? "not in the CRM"}`, 1, head.name, plan.nameOf.get(m.z) || m.z);
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

    // Clients matched by name keep the row's Zoho Record ID, so the next run and
    // the Meetings import find them exactly.
    if (stampIds.length) {
      const has = (await tx.execute(sql`
        SELECT 1 FROM custom_field_defs WHERE tenant_id = ${actor.tenantId}::uuid AND entity = 'investor' AND key = ${ZOHO_ID_FIELD.key}
      `)).rows.length;
      if (!has) {
        const next = (await tx.execute(sql`
          SELECT COALESCE(MAX(sort_order), 0)::int + 1 AS n FROM custom_field_defs WHERE tenant_id = ${actor.tenantId}::uuid AND entity = 'investor'
        `)).rows[0] as { n: number };
        await tx.insert(customFieldDefs).values({
          tenantId: actor.tenantId,
          entity: "investor",
          key: ZOHO_ID_FIELD.key,
          label: ZOHO_ID_FIELD.label,
          type: "text",
          options: null,
          required: false,
          sortOrder: Number(next.n),
          createdBy: actor.userId,
        });
      }
      for (let i = 0; i < stampIds.length; i += 500) {
        const part = stampIds.slice(i, i + 500);
        await tx.execute(sql`
          UPDATE investors AS inv
             SET custom_fields = COALESCE(inv.custom_fields, '{}'::jsonb) || jsonb_build_object(${ZOHO_ID_FIELD.key}::text, v.zoho),
                 updated_at = now()
            FROM (VALUES ${sql.join(part.map((p) => sql`(${p.id}::uuid, ${p.zoho}::text)`), sql`, `)}) AS v(id, zoho)
           WHERE inv.id = v.id AND inv.tenant_id = ${actor.tenantId}::uuid
             AND NOT (COALESCE(inv.custom_fields, '{}'::jsonb) ? ${ZOHO_ID_FIELD.key})
        `);
      }
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
        matchedById: result.matchedById,
        matchedByName: result.matchedByName,
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
