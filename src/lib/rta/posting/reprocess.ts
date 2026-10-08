/**
 * Dependency-aware re-evaluation of held transactions (Phase 3G).
 *
 * A transaction file that arrives before its master is held
 * ("owner_not_on_record") rather than guessed. When the authoritative master /
 * folio record later posts, this finds the held registrar transactions on the
 * folios it touched and re-evaluates each one from what was STAGED — never by
 * re-reading the file:
 *
 *   1. the latest staged occurrence of each held registrar transaction
 *      (identity key), not already in the posting ledger;
 *   2. its owner, re-resolved by lib/rta/owner.ts's own rules against the CRM
 *      as it is now — registrar + AMC + folio on record, then the owner's OWN
 *      PAN — compared through the keyed PAN tokens staging kept (no PAN is
 *      read back). A guardian or Karta never becomes the owner; a minor's row
 *      on a placeholder, an HUF row with an individual PAN, a PAN conflict or
 *      an ambiguous folio stay exceptions;
 *   3. its figures: the economic transaction must have reconciled (status
 *      complete / duplicate, or held for identity only with no failing
 *      figure check);
 *   4. independence: a folio with any transaction still held for identity or
 *      figures promotes none of its others;
 *   5. commit through the same commitEconomicTxn as first-time posting — the
 *      posting ledger keeps it to once, an existing CRM row is matched or is a
 *      conflict, never overwritten;
 *   6. history: the original batch, rows and every earlier outcome stay; the
 *      re-evaluation is appended to posting_history.
 *
 * What stays held keeps ONE open manual-resolution task per folio (meta
 * rtaHold), closed when nothing on the folio is held any more. Nothing here
 * merges clients or moves a folio.
 */
import { sql } from "drizzle-orm";
import { withTenant } from "@/db/client";
import { InvestorDirectory } from "../identity";
import { InvestorOwnerDirectory } from "../owner-directory";
import { panHolderType, resolveOwner, type DerivedHolder, type KnownInvestor, type Lookup, type OwnerDirectory } from "../owner";
import { panToken } from "../staging/pan-token";
import { validPan } from "../values";
import { assertPostingAllowed } from "./gate";
import { commitEconomicTxn, recordOutcome, type Econ } from "./post";

type Tx = any;

/** Held for ownership / identity — what a new master can settle. */
const IDENTITY_HOLD = /^(owner_not_on_record|folio_owner_conflict|folio_owned_by_guardian|owner_type_conflict|folio_pan_conflict|placeholder_owner|huf_owner_pan_unverified|pan_matches_minor_record|identity_blocked|identity_ambiguous|identity_split)\b/;
/** Holds that also hold the rest of the folio (same rule as batch posting). */
const TAINTS_FOLIO = /^(identity_|folio_|owner_|placeholder_|huf_|pan_matches_|group_|lot_|restated_by_registrar)/;

/**
 * The owner directory over staged PAN TOKENS: the row's PANs are tokens, so
 * every client is presented with its token as the comparison key and the
 * holder type its real PAN shows — owner.ts's rules run unchanged.
 */
class TokenOwnerDirectory implements OwnerDirectory {
  private base: InvestorOwnerDirectory;
  private tokenToPan = new Map<string, string>();
  constructor(private dir: InvestorDirectory, private tenantId: string) {
    this.base = new InvestorOwnerDirectory(dir);
  }
  async load(tx: Tx) {
    const rows = (await tx.execute(sql`SELECT DISTINCT pan FROM investors WHERE tenant_id = ${this.tenantId}::uuid AND pan ~ '^[A-Z]{5}[0-9]{4}[A-Z]$'`)).rows as Array<{ pan: string }>;
    for (const r of rows) { const k = panToken(this.tenantId, r.pan); if (k) this.tokenToPan.set(k, r.pan); }
  }
  folioOwner(amc: string | null, folio: string): Promise<Lookup> { return this.base.folioOwner(amc, folio); }
  async byPan(token: string): Promise<Lookup> {
    const pan = this.tokenToPan.get(token);
    return pan ? this.base.byPan(pan) : { kind: "none" };
  }
  investor(id: string): KnownInvestor | null {
    const i = this.base.investor(id);
    if (!i) return null;
    const pan = validPan(i.pan);
    return { ...i, panKey: pan ? panToken(this.tenantId, pan) : null, panType: panHolderType(pan) };
  }
}

export type ReprocessResult = {
  examined: number;
  promoted: number;
  matchedExisting: number;
  rejectedRecorded: number;
  stillHeld: Record<string, number>;
  tasksOpened: number;
  tasksClosed: number;
};

type Verdict = { e: Candidate; promote: boolean; write?: "new" | "rejected"; reason: string; investorId?: string; folioId?: string | null; rule?: string };
type Candidate = Econ & { posting_outcome: string; posting_reason: string | null; batch_id: string };

const code = (s: string | null | undefined) => (s ?? "").split(":")[0].trim();

export async function reprocessHeldTransactions(
  tenantId: string,
  opts: {
    folios?: Array<{ amcCode: string | null; folioNumber: string }>;
    /** Owner PAN tokens the trigger established (a master's holders): held transactions naming them are re-evaluated too, on any folio. */
    ownerTokens?: string[];
    userId?: string | null; triggerBatchId?: string | null;
  } = {},
): Promise<ReprocessResult> {
  return withTenant(tenantId, async (tx: Tx) => {
    await assertPostingAllowed(tx, tenantId);
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${"rta_posting:" + tenantId}, 0))`);
    const out: ReprocessResult = { examined: 0, promoted: 0, matchedExisting: 0, rejectedRecorded: 0, stillHeld: {}, tasksOpened: 0, tasksClosed: 0 };

    // A pass can open a folio (a transaction posted by the owner's own PAN); the
    // held transactions on that folio are then evaluated again — a bounded loop.
    const evaluatePass = async (folios: Array<{ amcCode: string | null; folioNumber: string }> | undefined, pass: number) => {
      const opened: Array<{ amcCode: string | null; folioNumber: string }> = [];
      const byFolio = folios?.length ? sql`(l.amc_code, l.folio_number) IN (${sql.join(folios.map((f) => sql`(${f.amcCode ?? ""}, ${f.folioNumber})`), sql`, `)})` : null;
      const tokens = pass === 0 ? (opts.ownerTokens ?? []).filter(Boolean) : [];
      const byOwner = tokens.length
        ? sql`EXISTS (SELECT 1 FROM rta_staging_rows rr WHERE rr.tenant_id = l.tenant_id AND rr.economic_txn_id = l.id AND rr.pan_token IN (${sql.join(tokens.map((t) => sql`${t}`), sql`, `)}))`
        : null;
      const folioFilter = byFolio && byOwner ? sql`AND (${byFolio} OR ${byOwner})` : byFolio ? sql`AND ${byFolio}` : byOwner ? sql`AND ${byOwner}` : folios ? sql`AND false` : sql``;
      // 1. The latest staging of every registrar transaction still held, on the folios concerned.
      const held = (await tx.execute(sql`
        WITH latest AS (
          SELECT DISTINCT ON (e.identity_key) e.*
            FROM rta_staging_economic_txns e
            JOIN rta_staging_batches b ON b.tenant_id = e.tenant_id AND b.id = e.batch_id AND b.mode = 'validate_first'
           WHERE e.tenant_id = ${tenantId}::uuid AND e.posting_outcome IS NOT NULL
           ORDER BY e.identity_key, e.created_at DESC
        )
        SELECT l.id, l.batch_id, l.identity_key, l.rta, l.amc_code, l.folio_number, l.scheme_code, l.registrar_txn_no, l.trade_date::text AS trade_date,
               l.rta_class, l.direction, l.status, l.reason, l.row_count, l.lot_count, l.reported_units::text AS reported_units,
               l.reported_amount::text AS reported_amount, l.reported_nav::text AS reported_nav, l.reported_exit_load::text AS reported_exit_load,
               l.reported_stt::text AS reported_stt, l.reported_stamp_duty::text AS reported_stamp_duty,
               l.match_investor_id, l.match_folio_id, l.match_rule, l.duplicate_of_id, l.posting_outcome, l.posting_reason,
               (SELECT r.attrs FROM rta_staging_rows r WHERE r.tenant_id = l.tenant_id AND r.economic_txn_id = l.id ORDER BY r.row_no LIMIT 1) AS first_attrs,
               (SELECT array_agg(r.row_no ORDER BY r.row_no) FROM rta_staging_rows r WHERE r.tenant_id = l.tenant_id AND r.economic_txn_id = l.id) AS row_nos
          FROM latest l
         WHERE l.posting_outcome IN ('quarantined', 'held_dependent')
           AND NOT EXISTS (SELECT 1 FROM rta_posted_transactions p WHERE p.tenant_id = l.tenant_id AND p.identity_key = l.identity_key)
           ${folioFilter}
         ORDER BY l.folio_number, l.trade_date, l.identity_key
      `)).rows as Candidate[];
      if (!held.length) return { verdicts: [] as Verdict[], newFolios: [] as Array<{ amcCode: string | null; folioNumber: string }> };

      const dir = new InvestorDirectory(tx, tenantId);
      await dir.preload({ folios: held.map((e) => e.folio_number) });
      const owners = new TokenOwnerDirectory(dir, tenantId);
      await owners.load(tx);

      const verdicts: Verdict[] = [];
      for (const e of held) {
        out.examined++;
        const prior = code(e.posting_reason) || e.posting_outcome;
        const rowReason = code(e.reason);
        // Only identity holds are re-evaluated; figures, codes, conflicts and corrections stay as they are.
        const identityOnly = e.posting_outcome === "held_dependent" || IDENTITY_HOLD.test(prior);
        const refused = rowReason === "instalment_rejected";
        if (!identityOnly || !["complete", "duplicate", "quarantined"].includes(e.status) || (e.status === "quarantined" && !refused && !IDENTITY_HOLD.test(rowReason))) {
          verdicts.push({ e, promote: false, reason: e.posting_reason ?? e.reason ?? e.posting_outcome });
          continue;
        }
        // 3. Figures: no failing check on this transaction.
        // A refused instruction allots nothing (0 units), so lot arithmetic cannot hold for it;
        // it is recorded as a rejection with 0 units, never as money — as in batch posting.
        const failing = refused ? 0 : (await tx.execute(sql`
          SELECT 1 FROM rta_staging_checks WHERE tenant_id = ${tenantId}::uuid AND batch_id = ${e.batch_id}::uuid AND scope = 'econ' AND scope_ref = ${e.identity_key} AND status = 'fail' LIMIT 1`)).rows.length;
        if (failing) { verdicts.push({ e, promote: false, reason: e.posting_reason ?? "figures did not reconcile" }); continue; }
        // 2. Owner, re-resolved for every row of the transaction from the staged facts.
        const rows = (await tx.execute(sql`
          SELECT pan_token, guardian_pan_token, attrs->'holder' AS holder, amc_code, folio_number FROM rta_staging_rows
           WHERE tenant_id = ${tenantId}::uuid AND economic_txn_id = ${e.id}::uuid ORDER BY row_no`)).rows as Array<{ pan_token: string | null; guardian_pan_token: string | null; holder: any; amc_code: string | null; folio_number: string }>;
        const decisions = [];
        for (const r of rows) {
          if (!r.holder) { decisions.push(null); continue; }
          const h: DerivedHolder = {
            ownerType: r.holder.ownerType ?? "unknown", ownerTypeSource: r.holder.ownerTypeSource ?? "none",
            ownerPan: r.pan_token, guardianPan: r.guardian_pan_token, jointPans: (r.holder.jointHolderTokens ?? []).filter(Boolean),
            sourcePanRole: r.holder.sourcePanRole ?? "none", flags: r.holder.flags ?? [],
          };
          decisions.push(await resolveOwner(owners, { rta: e.rta, amcCode: r.amc_code, folioNumber: r.folio_number }, h));
        }
        const first = decisions[0];
        const same = first && decisions.every((d) => d && d.kind === first.kind && (d as any).investorId === (first as any).investorId);
        if (!first || !same) { verdicts.push({ e, promote: false, reason: "identity_ambiguous: the rows of this transaction do not resolve to one owner" }); continue; }
        if (first.kind === "exception") { verdicts.push({ e, promote: false, reason: `${first.code}: ${first.reason}` }); continue; }
        if (first.kind === "existing_folio_owner") {
          verdicts.push({ e, promote: true, write: refused ? "rejected" : "new", reason: "", investorId: first.investorId, folioId: first.folioId, rule: `existing_folio_owner:${first.rule}` });
          continue;
        }
        if (first.kind === "owner_by_pan" && !refused) {
          verdicts.push({ e, promote: true, write: "new", reason: "", investorId: first.investorId, folioId: null, rule: `owner_by_pan:${first.rule}` });
          continue;
        }
        verdicts.push({ e, promote: false, reason: `owner_not_on_record: the owner decision is still "${first.kind}" — the folio's master has not posted` });
      }

      // 4. Independence: a folio with anything still held for identity / figures promotes nothing else.
      const folioKey = (e: Candidate) => `${e.amc_code ?? ""}|${e.folio_number}`;
      // "Master not imported yet" is waiting, not a conflict: it holds nothing else (as in batch posting).
      const tainted = new Set(verdicts.filter((v) => !v.promote && code(v.reason) !== "owner_not_on_record" && TAINTS_FOLIO.test(code(v.reason))).map((v) => folioKey(v.e)));
      // …and transactions held earlier on the same folios that this run did not re-examine.
      if (held.length) {
        const others = (await tx.execute(sql`
          WITH latest AS (
            SELECT DISTINCT ON (e.identity_key) e.identity_key, e.amc_code, e.folio_number, e.posting_outcome, e.posting_reason
              FROM rta_staging_economic_txns e WHERE e.tenant_id = ${tenantId}::uuid AND e.posting_outcome IS NOT NULL
             ORDER BY e.identity_key, e.created_at DESC)
          SELECT amc_code, folio_number, posting_reason FROM latest l
           WHERE l.posting_outcome = 'quarantined'
             AND NOT EXISTS (SELECT 1 FROM rta_posted_transactions p WHERE p.tenant_id = ${tenantId}::uuid AND p.identity_key = l.identity_key)
             AND (l.amc_code, l.folio_number) IN (${sql.join([...new Set(held.map((e) => folioKey(e)))].map((k) => { const [a, f] = k.split("|"); return sql`(${a}, ${f})`; }), sql`, `)})
             AND l.identity_key NOT IN (${sql.join(held.map((e) => sql`${e.identity_key}`), sql`, `)})`)).rows as Array<{ amc_code: string | null; folio_number: string; posting_reason: string | null }>;
        for (const o of others) if (code(o.posting_reason) !== "owner_not_on_record" && TAINTS_FOLIO.test(code(o.posting_reason))) tainted.add(`${o.amc_code ?? ""}|${o.folio_number}`);
      }

      // 5. Commit what is promotable; 6. record every verdict.
      const lastTx = new Map<string, string>();
      for (const v of verdicts) {
        const meta = { by: opts.userId ?? null, via: "reevaluation" as const, batchId: opts.triggerBatchId ?? null };
        if (v.promote && tainted.has(folioKey(v.e))) {
          v.promote = false;
          v.reason = "held_dependent: another transaction of this folio is still held for identity or figures — this one waits so the folio's history is not split";
        }
        if (!v.promote) {
          const outcome = /^held_dependent/.test(v.reason) ? "held_dependent" : "quarantined";
          const why = /^held_dependent/.test(v.reason) ? v.reason.replace(/^held_dependent:\s*/, "") : v.reason;
          out.stillHeld[code(v.reason) || outcome] = (out.stillHeld[code(v.reason) || outcome] ?? 0) + 1;
          if (outcome !== v.e.posting_outcome || why !== (v.e.posting_reason ?? "")) {
            await recordOutcome(tx, tenantId, v.e.id, outcome, why, { ...meta, extra: { previousOutcome: v.e.posting_outcome, previousReason: v.e.posting_reason } });
          }
          continue;
        }
        await tx.execute(sql`
          UPDATE rta_staging_economic_txns SET match_investor_id = ${v.investorId}::uuid, match_folio_id = ${v.folioId ?? null}::uuid, match_rule = ${v.rule}, updated_at = now()
           WHERE tenant_id = ${tenantId}::uuid AND id = ${v.e.id}::uuid`);
        const econ: Econ = { ...v.e, match_investor_id: v.investorId!, match_folio_id: v.folioId ?? null, match_rule: v.rule! };
        const r = await commitEconomicTxn(tx, tenantId, econ, v.write!, { batchId: v.e.batch_id, userId: opts.userId ?? null });
        await recordOutcome(tx, tenantId, v.e.id, r.outcome, r.reason ?? `re-evaluated after the folio's owner was established (${v.rule})`, {
          ...meta, extra: { previousOutcome: v.e.posting_outcome, previousReason: v.e.posting_reason, previousRule: v.e.match_rule, rule: v.rule },
        });
        if (r.outcome === "posted" && !v.folioId) opened.push({ amcCode: v.e.amc_code, folioNumber: v.e.folio_number! });
        if (r.outcome === "posted") out.promoted++;
        else if (r.outcome === "matched_existing") out.matchedExisting++;
        else if (r.outcome === "rejected_recorded") out.rejectedRecorded++;
        else out.stillHeld[code(r.reason)] = (out.stillHeld[code(r.reason)] ?? 0) + 1;
        if (r.posted?.tradeDate) {
          const prev = lastTx.get(r.posted.investorId);
          if (!prev || r.posted.tradeDate > prev) lastTx.set(r.posted.investorId, r.posted.tradeDate);
        }
      }
      for (const [inv, d] of lastTx) {
        await tx.execute(sql`UPDATE investors SET last_transaction_at = GREATEST(COALESCE(last_transaction_at, 'epoch'::timestamptz), ${d}::timestamptz), updated_at = now() WHERE id = ${inv}::uuid`);
      }

      return { verdicts, newFolios: opened };
    };
    const finalVerdicts = new Map<string, Verdict>();
    let folios = opts.folios;
    for (let pass = 0; pass < 3; pass++) {
      const r = await evaluatePass(folios, pass);
      for (const v of r.verdicts) finalVerdicts.set(v.e.identity_key, v);
      if (!r.newFolios.length) break;
      folios = r.newFolios;
    }
    const verdicts = [...finalVerdicts.values()];

    // Manual-resolution tasks: one open task per folio still held for identity.
    const stillIdentity = new Map<string, { rta: string; amc: string | null; folio: string; n: number; reason: string }>();
    for (const v of verdicts) {
      // "Master not imported yet" is waiting, not ambiguity: no task for it.
      if (v.promote || !IDENTITY_HOLD.test(code(v.reason)) || code(v.reason) === "owner_not_on_record") continue;
      const k = `${v.e.rta}|${v.e.amc_code ?? ""}|${v.e.folio_number}`;
      const cur = stillIdentity.get(k) ?? { rta: v.e.rta, amc: v.e.amc_code, folio: v.e.folio_number!, n: 0, reason: v.reason };
      cur.n++;
      stillIdentity.set(k, cur);
    }
    const t = await syncHoldTasks(tx, tenantId, verdicts.map((v) => `${v.e.rta}|${v.e.amc_code ?? ""}|${v.e.folio_number}`), stillIdentity);
    out.tasksOpened = t.opened; out.tasksClosed = t.closed + await closeSettledHoldTasks(tx, tenantId);

    await tx.execute(sql`
      INSERT INTO audit_log (tenant_id, actor_user_id, actor_type, action, entity_type, entity_id, after)
      VALUES (${tenantId}::uuid, ${opts.userId ?? null}::uuid, ${opts.userId ? "user" : "system"}, 'rta.posting.reevaluate', 'rta_staging_batch', ${opts.triggerBatchId ?? null}::uuid,
              ${JSON.stringify(out)}::jsonb)`);
    return out;
  });
}

/** Keep exactly one open manual-resolution task per folio held for identity; close it when nothing is held. */
async function syncHoldTasks(tx: Tx, tenantId: string, examinedFolios: string[], held: Map<string, { rta: string; amc: string | null; folio: string; n: number; reason: string }>) {
  let opened = 0, closed = 0;
  if (!examinedFolios.length) return { opened, closed };
  const open = (await tx.execute(sql`
    SELECT id, meta->>'rtaHold' AS k FROM tasks
     WHERE tenant_id = ${tenantId}::uuid AND meta ? 'rtaHold' AND status IN ('open', 'in_progress', 'blocked')
       AND meta->>'rtaHold' IN (${sql.join([...new Set(examinedFolios)].map((k) => sql`${k}`), sql`, `)})`)).rows as Array<{ id: string; k: string }>;
  const openKeys = new Set(open.map((o) => o.k));
  for (const o of open) {
    if (held.has(o.k)) continue;
    await tx.execute(sql`UPDATE tasks SET status = 'completed', completed_at = now(), remarks = 'Settled: no registrar transaction on this folio is held for identity any more.', updated_at = now() WHERE id = ${o.id}::uuid`);
    closed++;
  }
  if (![...held.keys()].some((k) => !openKeys.has(k))) return { opened, closed };
  const assignee = (await tx.execute(sql`
    SELECT id FROM users WHERE tenant_id = ${tenantId}::uuid AND status = 'active'
     ORDER BY ('compliance' = ANY(roles)) DESC, ('owner' = ANY(roles)) DESC, created_at LIMIT 1`)).rows[0] as { id: string } | undefined;
  for (const [k, h] of held) {
    if (openKeys.has(k)) continue;
    await tx.execute(sql`
      INSERT INTO tasks (tenant_id, subject_type, department, type, title, description, priority, status, assignee_id, created_by_id, due_at, meta)
      VALUES (${tenantId}::uuid, 'compliance', 'operations', 'custom',
              ${`RTA: decide the owner of folio ${h.folio} (${h.rta === "kfintech" ? "KFintech" : "CAMS"})`},
              ${`${h.n} registrar transaction(s) on this folio are held because ownership cannot be established automatically (${code(h.reason).replace(/_/g, " ")}). Open RTA File Imports → Held transactions; settle the client (merge a placeholder, record the minor or HUF), then choose the client or re-import. Nothing posts until then.`},
              'high', 'open', ${assignee?.id ?? null}::uuid, NULL, now() + interval '2 days',
              ${JSON.stringify({ rtaHold: k, source: "rta_validate_first" })}::jsonb)`);
    opened++;
  }
  return { opened, closed };
}

/** Close any open hold task whose folio has nothing held for identity any more (posted by a later file, resolved by hand…). */
async function closeSettledHoldTasks(tx: Tx, tenantId: string): Promise<number> {
  const r = await tx.execute(sql`
    WITH latest AS (
      SELECT DISTINCT ON (e.identity_key) e.identity_key, e.rta, e.amc_code, e.folio_number, e.posting_outcome, e.posting_reason
        FROM rta_staging_economic_txns e WHERE e.tenant_id = ${tenantId}::uuid AND e.posting_outcome IS NOT NULL
       ORDER BY e.identity_key, e.created_at DESC),
    still AS (
      SELECT DISTINCT l.rta || '|' || coalesce(l.amc_code, '') || '|' || l.folio_number AS k FROM latest l
       WHERE l.posting_outcome = 'quarantined'
         AND NOT EXISTS (SELECT 1 FROM rta_posted_transactions p WHERE p.tenant_id = ${tenantId}::uuid AND p.identity_key = l.identity_key))
    UPDATE tasks SET status = 'completed', completed_at = now(), updated_at = now(),
           remarks = 'Settled: no registrar transaction on this folio is held for identity any more.'
     WHERE tenant_id = ${tenantId}::uuid AND meta ? 'rtaHold' AND status IN ('open', 'in_progress', 'blocked')
       AND meta->>'rtaHold' NOT IN (SELECT k FROM still)
    RETURNING id`);
  return r.rows.length;
}
