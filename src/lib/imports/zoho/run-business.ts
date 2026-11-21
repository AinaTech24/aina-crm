/**
 * Import a Zoho MF Transaction export (three sheets) as Business Entries
 * (We Care Freedom Wealth, 2026-11-18). Preview and import are the same code;
 * a preview rolls back (see run-contacts.ts).
 *
 *  - Entries are CONFIRMED (booked business) and written directly: unlike the
 *    entry form there is no business_entry.created event (no confirmation
 *    email), no SIP added to the SIP book and no client journey moved — this is
 *    history. One audit row records the import.
 *  - The client is found by Zoho Record ID, else exact unique name
 *    (client-match.ts); an entry whose client is not found keeps the Zoho
 *    client name, unlinked.
 *  - MF Transaction Owner is the RM who booked it (matched to a user by name;
 *    an owner with no user goes to the person importing, if they choose).
 *  - A second run skips every MFT already imported (the "Zoho MFT…" marker at
 *    the start of the entry's notes, per product).
 */

import { v4 as uuid } from "uuid";
import { sql } from "drizzle-orm";
import type { Tx } from "@/db/client";
import { withTenant } from "@/db/client";
import { recordAudit } from "@/lib/audit";
import { businessEntries, businessEntryLines } from "@/db/schema";
import { computeTotals, normalizeLine, type LineInputT } from "@/lib/business/entry-input";
import { ENTRY_GROSS, ENTRY_REDEMPTION } from "@/lib/metrics/entries";
import { ownerKey } from "./contacts";
import { loadClientMatcher, stampZohoIds } from "./client-match";
import { entryKey, planBusiness, type PlannedEntry } from "./business";
import type { ImportActor, OwnerLine } from "./run-contacts";
import { ZohoFileError } from "./workbook";
import { refreshZohoEntries, type ExistingZohoEntry, type RefreshItem } from "./refresh-business";
import { matchBookedBusiness } from "@/lib/business/rta-match";

export type BusinessImportResult = {
  dryRun: boolean;
  parents: number;
  entries: number;
  created: number;
  lines: number;
  byProduct: Array<{ value: string; count: number }>;
  types: Array<{ value: string; count: number }>;
  owners: Array<Omit<OwnerLine, "clients"> & { entries: number }>;
  clients: { byId: number; byName: number; unlinked: number };
  unlinked: Array<{ mft: string; client: string; reason: string }>;
  skippedByReason: Array<{ reason: string; count: number }>;
  /** What the CRM will count vs Zoho's own totals. */
  totals: { gross: number; redemption: number; zohoPurchase: number; zohoRedemption: number };
  /** With refreshExisting: MFTs already in the CRM that changed in Zoho and were updated. */
  refreshed: number;
  /** With refreshExisting: MFTs already in the CRM and identical in Zoho. */
  unchanged: number;
  /** With refreshExisting: changed MFTs left alone (edited or cancelled in the CRM). */
  keptAsIs: Array<{ mft: string; reason: string }>;
};

class Rollback extends Error {
  constructor(public result: BusinessImportResult) {
    super("dry run");
  }
}

export async function importZohoBusiness(
  actor: ImportActor,
  sheets: { parent: Record<string, unknown>[]; sip: Record<string, unknown>[]; purchase: Record<string, unknown>[] },
  opts: { dryRun: boolean; unmatchedOwnersToMe: boolean; refreshExisting?: boolean; tx?: Tx }
): Promise<BusinessImportResult> {
  const plan = planBusiness(sheets.parent, sheets.sip, sheets.purchase);

  const run = async (tx: Tx): Promise<BusinessImportResult> => {
    const result: BusinessImportResult = {
      dryRun: opts.dryRun,
      parents: sheets.parent.length,
      entries: plan.entries.length,
      created: 0,
      lines: 0,
      byProduct: [],
      types: [],
      owners: [],
      clients: { byId: 0, byName: 0, unlinked: 0 },
      unlinked: [],
      skippedByReason: [],
      totals: { gross: 0, redemption: 0, zohoPurchase: plan.zohoTotals.purchase, zohoRedemption: plan.zohoTotals.redemption },
      refreshed: 0,
      unchanged: 0,
      keptAsIs: [],
    };
    const skipped = new Map<string, number>();
    const skip = (reason: string) => skipped.set(reason, (skipped.get(reason) ?? 0) + 1);
    for (const s of plan.skipped) skip(s.reason);
    if (plan.orphanLines) skipped.set("Subform row whose MF Transaction is not in the file", plan.orphanLines);

    // ── Owners → users ──
    const users = (await tx.execute(sql`
      SELECT id, name, email FROM users WHERE tenant_id = ${actor.tenantId}::uuid AND status <> 'offboarded'
    `)).rows as Array<{ id: string; name: string; email: string }>;
    const userByKey = new Map<string, (typeof users)[number]>();
    for (const u of users) {
      if (u.name) userByKey.set(ownerKey(u.name), u);
      if (u.email) userByKey.set(ownerKey(u.email), u);
    }
    const ownerCounts = new Map<string, number>();
    for (const e of plan.entries) ownerCounts.set(e.ownerText, (ownerCounts.get(e.ownerText) ?? 0) + 1);
    result.owners = [...ownerCounts.entries()]
      .map(([owner, entries]) => {
        const u = owner ? userByKey.get(ownerKey(owner)) : undefined;
        return { owner, entries, user: u ? { id: u.id, name: u.name } : null };
      })
      .sort((a, b) => b.entries - a.entries);
    const unmatched = result.owners.filter((o) => o.owner && !o.user);
    if (unmatched.length && !opts.dryRun && !opts.unmatchedOwnersToMe) {
      throw new ZohoFileError(`Create these users first (or choose to take their entries yourself): ${unmatched.map((o) => o.owner).join(", ")}.`);
    }

    // ── Clients ──
    const fileNames = new Map<string, string>();
    for (const e of plan.entries) if (e.clientZohoId && e.clientName && !fileNames.has(e.clientZohoId)) fileNames.set(e.clientZohoId, e.clientName);
    const matcher = await loadClientMatcher(tx, actor.tenantId, fileNames);

    // ── Already imported ──
    const existingRows = (await tx.execute(sql`
      SELECT id, split_part(notes, ' · ', 1) AS marker, product_type, status, to_char(business_date, 'YYYY-MM-DD') AS business_date,
             notes, platform, investor_id, client_name, rm_id
        FROM business_entries
       WHERE tenant_id = ${actor.tenantId}::uuid AND notes LIKE 'Zoho MFT%'
       ORDER BY created_at
    `)).rows as Array<ExistingZohoEntry & { marker: string; product_type: string }>;
    const existing = new Map<string, ExistingZohoEntry>();
    for (const r of existingRows) {
      const k = entryKey(r.marker.replace(/^Zoho /, ""), r.product_type);
      if (!existing.has(k)) existing.set(k, r);
    }
    const done = new Set(existing.keys());
    const toRefresh: RefreshItem[] = [];
    const refreshSeen = new Set<string>();

    const typeCounts = new Map<string, number>();
    const productCounts = new Map<string, number>();
    const unlinkedSeen = new Set<string>();
    const ready: Array<{ entry: typeof businessEntries.$inferInsert; lines: Array<typeof businessEntryLines.$inferInsert> }> = [];

    for (const e of plan.entries) {
      if (done.has(entryKey(e.mft, e.product))) {
        const k = entryKey(e.mft, e.product);
        const ex = existing.get(k);
        if (opts.refreshExisting && ex && e.businessDate && !refreshSeen.has(k)) {
          refreshSeen.add(k);
          const c = e.clientZohoId ? matcher.resolve(e.clientZohoId) : undefined;
          const o = e.ownerText ? userByKey.get(ownerKey(e.ownerText)) : undefined;
          toRefresh.push({ planned: e, existing: ex, client: c ? { id: c.id } : null, ownerId: o?.id ?? null });
        } else {
          skip("Already imported");
        }
        continue;
      }
      done.add(entryKey(e.mft, e.product));
      const client = e.clientZohoId ? matcher.resolve(e.clientZohoId) : undefined;
      if (!client) {
        result.clients.unlinked++;
        const why = e.clientZohoId ? matcher.why(e.clientZohoId) : "no client on the Zoho record";
        if (!unlinkedSeen.has(e.mft) && result.unlinked.length < 500) result.unlinked.push({ mft: e.mft, client: e.clientName || "(none)", reason: why });
        unlinkedSeen.add(e.mft);
      }
      const owner = e.ownerText ? userByKey.get(ownerKey(e.ownerText)) : undefined;
      const rmId = owner?.id ?? (e.ownerText ? actor.userId : client?.rm_id ?? actor.userId);

      const inputs: LineInputT[] = e.lines.map((l) => ({
        schemeName: l.schemeName,
        txnType: l.txnType,
        typeLabel: l.typeLabel,
        amount: l.amount,
        assetClass: l.assetClass,
        frequency: l.frequency,
        sipDate: l.sipDate,
        fromSchemeName: l.fromSchemeName,
        fromAssetClass: l.fromAssetClass,
        notes: l.notes,
      }));
      const lines = inputs.map(normalizeLine);
      const totals = computeTotals(lines);
      const entryId = uuid();
      ready.push({
        entry: entryRow(e, entryId, actor, rmId, client?.id ?? null, totals),
        lines: lines.map((l, i) => ({
          id: uuid(),
          tenantId: actor.tenantId,
          entryId,
          schemeName: l.schemeName,
          assetClass: l.assetClass,
          txnType: l.txnType,
          typeLabel: l.typeLabel || null,
          sourceType: e.lines[i]?.sourceType ?? null,
          sourceKind: e.lines[i]?.sourceKind ?? null,
          amount: String(l.amount),
          frequency: l.frequency ?? null,
          sipDate: l.txnType === "sip" ? l.sipDate ?? null : null,
          fromSchemeName: l.fromSchemeName ?? null,
          fromAssetClass: l.fromAssetClass ?? null,
          notes: l.notes ?? null,
          sortOrder: i,
          ...(e.lines[i].rtaNotApplicable ? { rtaStatus: "not_applicable" as const, rtaNote: e.lines[i].rtaNotApplicable } : {}),
        })),
      });
      for (const l of lines) {
        const label = l.typeLabel || l.txnType;
        typeCounts.set(label, (typeCounts.get(label) ?? 0) + 1);
        if ((ENTRY_GROSS as readonly string[]).includes(l.txnType)) result.totals.gross += Number(l.amount) || 0;
        if ((ENTRY_REDEMPTION as readonly string[]).includes(l.txnType)) result.totals.redemption += Number(l.amount) || 0;
      }
      productCounts.set(e.product, (productCounts.get(e.product) ?? 0) + 1);
    }
    result.clients.byId = matcher.matchedById();
    result.clients.byName = matcher.matchedByName();

    // ── Write, 300 entries at a time; a batch that fails is retried entry by entry ──
    const writeOne = async (sp: Tx, batch: typeof ready) => {
      await sp.insert(businessEntries).values(batch.map((b) => b.entry));
      const allLines = batch.flatMap((b) => b.lines);
      for (let i = 0; i < allLines.length; i += 1000) await sp.insert(businessEntryLines).values(allLines.slice(i, i + 1000));
    };
    for (let i = 0; i < ready.length; i += 300) {
      const batch = ready.slice(i, i + 300);
      try {
        await tx.transaction(async (sp) => writeOne(sp as unknown as Tx, batch));
        result.created += batch.length;
        result.lines += batch.reduce((n, b) => n + b.lines.length, 0);
      } catch {
        for (const b of batch) {
          try {
            await tx.transaction(async (sp) => writeOne(sp as unknown as Tx, [b]));
            result.created++;
            result.lines += b.lines.length;
          } catch (err: any) {
            skip(`Could not be saved: ${String(err?.message ?? err).slice(0, 120)}`);
          }
        }
      }
    }
    await stampZohoIds(tx, actor.tenantId, actor.userId, matcher.stamps());

    // ── Already imported but changed in Zoho since → refreshed (refresh-business.ts) ──
    if (toRefresh.length) {
      const r = await refreshZohoEntries(tx, actor.tenantId, toRefresh);
      result.refreshed = r.refreshed;
      result.unchanged = r.unchanged;
      result.keptAsIs = r.keptAsIs;
      if (r.unchanged) skipped.set("Already imported, unchanged in Zoho", r.unchanged);
      // Rebuilt lines get their RTA outcome decided again. Best effort: never fails the import.
      if (r.refreshed && !opts.dryRun) {
        try {
          await tx.transaction(async (sp) => {
            await matchBookedBusiness(sp as unknown as Tx, actor.tenantId);
          });
        } catch (err) {
          console.error("[zoho-business] RTA re-match after refresh failed", (err as Error)?.message);
        }
      }
    }

    result.byProduct = [...productCounts.entries()].map(([value, count]) => ({ value, count })).sort((a, b) => b.count - a.count);
    result.types = [...typeCounts.entries()].map(([value, count]) => ({ value, count })).sort((a, b) => b.count - a.count);
    result.skippedByReason = [...skipped.entries()].map(([reason, count]) => ({ reason, count })).sort((a, b) => b.count - a.count);

    await recordAudit(tx, {
      tenantId: actor.tenantId,
      actorUserId: actor.userId,
      action: "business_entry.bulk_import",
      entityType: "business_entry",
      entityId: null,
      meta: { source: "zoho_mf_transactions", parents: result.parents, created: result.created, lines: result.lines, refreshed: result.refreshed, keptAsIs: result.keptAsIs.length, clients: result.clients, skipped: result.skippedByReason },
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

function entryRow(
  e: PlannedEntry,
  id: string,
  actor: ImportActor,
  rmId: string,
  investorId: string | null,
  totals: ReturnType<typeof computeTotals>
): typeof businessEntries.$inferInsert {
  return {
    id,
    tenantId: actor.tenantId,
    investorId,
    clientName: (e.clientName || "Client not recorded in Zoho").slice(0, 200),
    productType: e.product,
    platform: e.platform,
    businessDate: e.businessDate!,
    status: "confirmed",
    rmId,
    totalAmount: String(totals.total),
    assetBreakup: totals.assetBreakup,
    liquidNet: String(totals.liquidNet),
    notes: e.notes,
    createdById: actor.userId,
  };
}
