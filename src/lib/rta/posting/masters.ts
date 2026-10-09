/**
 * Committing a validated MASTER or HOLDINGS file (R9, WBR4, MFSD211, MFSD203)
 * — DEVELOPMENT ONLY, behind the posting gate.
 *
 * The file has already been staged, validated and owner-resolved. Only folios
 * whose every staged row is clean (staged or an identical duplicate) and whose
 * owner decision is not an exception reach the client-and-folio importer
 * (importRtaFolios, which applies the same owner rules again at commit time).
 * A folio with any quarantined, invalid or exception row is not written at
 * all — never half a folio. All of it commits in ONE transaction.
 *
 * Holder relationships are written to folio_holders from the staged facts
 * (tokens and masks only): first holder, a minor's guardian, joint holders.
 * They describe the folio; they never move it, and AUM still counts the folio
 * once under its one owner. A changed holder closes the old row and opens a
 * new one; nothing is edited in place.
 */
import { observeSchemeCodes } from "../scheme-resolution";
import { sql } from "drizzle-orm";
import { withTenant } from "@/db/client";
import { importRtaFolios } from "../import";
import { parseRtaCsv, parseRtaRows } from "..";
import { decodeTextBytes } from "../file-kind";
import { isSpreadsheet, readSpreadsheetToRows } from "../xls";
import { revalueAllFolios, recomputeCombinedAum } from "@/lib/finance/aum-persist";
import { assertPostingAllowed } from "./gate";
import { maskPansIn } from "../exceptions";

type Tx = any;

/**
 * The holder roles each report's layout carries. A report manages only these:
 * MFSD203 has no joint-holder or guardian columns, so it never closes the
 * joint holders or guardian a master reported (it used to, and the next master
 * reopened them).
 */
const ROLES_REPORTED: Record<string, string[]> = {
  R9: ["first", "guardian", "second", "third"],
  WBR4: ["first", "guardian", "second", "third"],
  MFSD211: ["first", "guardian", "second", "third"],
  MFSD203: ["first"],
};

export type MasterPostResult = {
  batchId: string;
  state: "posted" | "partially_posted" | "nothing_to_post";
  folios: { eligible: number; held: number; written: number; heldByImporter: number };
  holders: { opened: number; closed: number; unchanged: number; skippedOlder: number };
  /** Possible matches the importer would not make on its own (e.g. a minor at another registrar matching only by name). */
  reviews: number;
  /** The review items themselves (folio and why — never a PAN), kept on the batch. */
  reviewItems: string[];
  replayed: boolean;
};

export async function postMasterBatch(tenantId: string, batchId: string, file: { name: string; buf: Uint8Array }, opts: { userId?: string | null; importId?: string | null } = {}): Promise<MasterPostResult> {
  return withTenant(tenantId, async (tx: Tx) => {
    await assertPostingAllowed(tx, tenantId);
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${"rta_posting:" + tenantId}, 0))`);
    const b = (await tx.execute(sql`
      SELECT id, state, record_kind, report_code, posting_state, posting_counts, as_of_date::text AS as_of FROM rta_staging_batches
       WHERE tenant_id = ${tenantId}::uuid AND id = ${batchId}::uuid FOR UPDATE`)).rows[0] as
      { id: string; state: string; record_kind: string; report_code: string; posting_state: string; posting_counts: any; as_of: string | null } | undefined;
    if (!b) throw new Error("staging batch not found for this firm");
    if (!["master", "holding"].includes(b.record_kind)) throw new Error(`batch is a ${b.record_kind} file, not a master or holdings file`);
    if (!["ready_to_commit", "exception"].includes(b.state)) throw new Error(`batch is "${b.state}" — validation has not finished, nothing can post`);
    if (["posted", "partially_posted", "nothing_to_post"].includes(b.posting_state)) {
      return { batchId, state: b.posting_state as MasterPostResult["state"], ...(b.posting_counts as any), replayed: true };
    }

    // Folio eligibility from the staged rows.
    const folios = (await tx.execute(sql`
      SELECT amc_code, folio_number,
             bool_and(state IN ('staged', 'duplicate') AND coalesce(match_rule, '') NOT LIKE 'exception:%') AS eligible
        FROM rta_staging_rows WHERE tenant_id = ${tenantId}::uuid AND batch_id = ${batchId}::uuid AND folio_number IS NOT NULL
       GROUP BY 1, 2`)).rows as Array<{ amc_code: string | null; folio_number: string; eligible: boolean }>;
    const eligible = new Set(folios.filter((f) => f.eligible).map((f) => `${f.amc_code ?? ""}|${f.folio_number}`));

    // The same file, read by the client-and-folio importer, cut to the eligible folios.
    const parsed = isSpreadsheet(file.buf, file.name) ? parseRtaRows(readSpreadsheetToRows(file.buf, file.name)) : parseRtaCsv(decodeTextBytes(file.buf));
    const records = parsed.folios.filter((r) => eligible.has(`${r.amcCode ?? ""}|${r.folioNumber}`));
    const kind = parsed.kind === "holdings" ? "holdings" : parsed.kind === "full" ? "full" : "master";
    // Record this file's registrar scheme codes (and the ISINs MFSD203 prints)
    // before the legs are resolved against the Scheme Master (Phase 3H).
    await observeSchemeCodes(tx, tenantId, batchId);
    const batchReport = ((await tx.execute(sql`SELECT report_code FROM rta_staging_batches WHERE id = ${batchId}::uuid`)).rows[0] as { report_code: string | null } | undefined)?.report_code ?? null;
    const summary = records.length
      ? await importRtaFolios(tx, tenantId, records, { kind, reportType: parsed.reportType, sourceReport: batchReport ?? parsed.reportType, sourceBatchId: batchId })
      : null;
    if (kind !== "master" && records.length) { await revalueAllFolios(tx); await recomputeCombinedAum(tx); }

    // Holder relationships for every eligible folio now on record.
    const holders = { opened: 0, closed: 0, unchanged: 0, skippedOlder: 0 };
    const rows = (await tx.execute(sql`
      SELECT DISTINCT ON (r.amc_code, r.folio_number) r.amc_code, r.folio_number, r.pan_token, r.guardian_pan_token, r.attrs->'holder' AS holder,
             f.id AS folio_id, f.investor_id, i.guardian_investor_id
        FROM rta_staging_rows r
        JOIN folios f ON f.tenant_id = r.tenant_id AND f.amc_code = r.amc_code AND f.folio_number = r.folio_number
        JOIN investors i ON i.id = f.investor_id
       WHERE r.tenant_id = ${tenantId}::uuid AND r.batch_id = ${batchId}::uuid AND r.attrs ? 'holder'
       ORDER BY r.amc_code, r.folio_number, r.row_no`)).rows as Array<{ amc_code: string; folio_number: string; pan_token: string | null; guardian_pan_token: string | null; holder: any; folio_id: string; investor_id: string; guardian_investor_id: string | null }>;
    for (const r of rows) {
      if (!eligible.has(`${r.amc_code ?? ""}|${r.folio_number}`)) continue;
      const h = r.holder ?? {};
      const want: Array<{ role: string; investorId: string | null; token: string | null; mask: string | null }> = [
        { role: "first", investorId: r.investor_id, token: r.pan_token, mask: h.ownerMask ?? null },
      ];
      // (Roles this report cannot carry are filtered out below, never closed.)
      if (r.guardian_pan_token) want.push({ role: "guardian", investorId: r.guardian_investor_id, token: r.guardian_pan_token, mask: h.guardianMask ?? null });
      (h.jointHolderTokens ?? []).slice(0, 2).forEach((t: string, k: number) => { if (t) want.push({ role: k === 0 ? "second" : "third", investorId: null, token: t, mask: (h.jointHolderMasks ?? [])[k] ?? null }); });
      const roles = ROLES_REPORTED[b.report_code] ?? ["first"];
      const current = ((await tx.execute(sql`
        SELECT id, role, investor_id, holder_pan_token, source_as_of::text AS source_as_of FROM folio_holders
         WHERE tenant_id = ${tenantId}::uuid AND folio_id = ${r.folio_id}::uuid AND effective_to IS NULL`)).rows as Array<{ id: string; role: string; investor_id: string | null; holder_pan_token: string | null; source_as_of: string | null }>)
        .filter((c) => roles.includes(c.role));
      // An older statement never overrides what a newer one said.
      if (b.as_of && current.some((c) => c.source_as_of && c.source_as_of > b.as_of!)) { holders.skippedOlder++; continue; }
      const same = (c: (typeof current)[number], w: (typeof want)[number]) => c.role === w.role && (c.holder_pan_token ?? null) === (w.token ?? null) && String(c.investor_id ?? "") === String(w.investorId ?? "");
      for (const c of current) {
        if (want.some((w) => same(c, w))) { holders.unchanged++; continue; }
        await tx.execute(sql`UPDATE folio_holders SET effective_to = ${b.as_of ?? new Date().toISOString().slice(0, 10)}::date, closed_reason = 'the registrar now reports a different holder', closed_by = ${opts.userId ?? null}::uuid, updated_at = now() WHERE id = ${c.id}::uuid`);
        holders.closed++;
      }
      for (const w of want) {
        if (!roles.includes(w.role) || current.some((c) => same(c, w))) continue;
        await tx.execute(sql`
          INSERT INTO folio_holders (tenant_id, folio_id, role, investor_id, holder_pan_token, holder_pan_masked, source, source_report, source_batch_id, source_as_of, verified, effective_from, created_by)
          VALUES (${tenantId}::uuid, ${r.folio_id}::uuid, ${w.role}, ${w.investorId}::uuid, ${w.token}, ${w.mask}, 'registrar', ${b.report_code}, ${batchId}::uuid,
                  ${b.as_of}::date, true, ${b.as_of}::date, ${opts.userId ?? null}::uuid)`);
        holders.opened++;
      }
    }

    const held = folios.length - eligible.size;
    const heldByImporter = summary?.exceptions?.length ?? 0;
    const state: MasterPostResult["state"] = !records.length && !held ? "nothing_to_post" : held || heldByImporter ? "partially_posted" : "posted";
    const counts = { folios: { eligible: eligible.size, held, written: records.length - heldByImporter, heldByImporter }, holders, reviews: summary?.reviews?.length ?? 0, reviewItems: (summary?.reviews ?? []).slice(0, 200).map((r) => maskPansIn(r.reason)) };
    await tx.execute(sql`
      UPDATE rta_staging_batches SET posting_state = ${state}, posted_at = now(), posting_counts = ${JSON.stringify(counts)}::jsonb, updated_at = now()
       WHERE tenant_id = ${tenantId}::uuid AND id = ${batchId}::uuid`);
    // Operator / file audit trail: one row per committed posting run, in the same transaction.
    await tx.execute(sql`
      INSERT INTO audit_log (tenant_id, actor_user_id, actor_type, action, entity_type, entity_id, after)
      VALUES (${tenantId}::uuid, ${opts.userId ?? null}::uuid, ${opts.userId ? "user" : "system"}, 'rta.posting.masters', 'rta_staging_batch', ${batchId}::uuid,
              ${JSON.stringify({ state, folios: counts.folios, holders: counts.holders, reviews: counts.reviews, importId: opts.importId ?? null })}::jsonb)`);
    if (opts.importId) {
      await tx.execute(sql`
        UPDATE rta_file_imports SET status = ${state === "posted" ? "completed" : records.length ? "partial" : "failed"}, parsed_at = now(),
               rows_imported = ${records.length - heldByImporter}, rows_skipped = ${held + heldByImporter}, rows_failed = 0,
               remarks = ${`Validate-first: ${records.length - heldByImporter} folio(s) committed, ${held + heldByImporter} held (see the staging exceptions). Counts are folios, not file rows.`}
         WHERE tenant_id = ${tenantId}::uuid AND id = ${opts.importId}::uuid`);
    }
    return { batchId, state, ...counts, replayed: false };
  });
}
