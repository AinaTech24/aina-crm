/**
 * Repair registrar transactions stored before the 29 Oct 2026 import fixes
 * (88b20ef3). Two parts, one firm at a time:
 *
 *   A  A transaction whose folio link points at ANOTHER folio. The old import
 *      key was the bare registrar number, which CAMS issues per AMC, so a second
 *      AMC's transaction with the same number rewrote the first one's folio,
 *      units and status (6,508 rows found). The row's own folio number, client,
 *      scheme and amount are intact, so its folio link is re-pointed from them
 *      (lib/rta/repair.ts chooseFolioFor). Its units / NAV / status may still
 *      be the other transaction's — only re-importing the firm's
 *      since-inception file restores those; this part fixes what can be fixed
 *      from the database.
 *
 *   B  A reversal stored as a purchase: a lumpsum / SIP / dividend-reinvest
 *      inflow with NEGATIVE units, counted as new money. It is cancelled
 *      (reason REVERSAL) and cancels the transaction it reverses (REVERSED;
 *      lib/rta/repair.ts matchReversals). A switch / STP row with negative
 *      units is the out-leg: its direction becomes outflow.
 *
 * Every changed row's previous values go to the audit trail
 * (action transaction.rta_repair, meta.label), so --revert <label> puts them
 * back. Client AUM is recomputed for the clients touched, and the report shows
 * the firm's AUM and RTA gross investment before and after.
 *
 * DRY RUN BY DEFAULT: the whole repair runs inside a transaction, is
 * measured, and is rolled back. --apply commits. Run it as a one-off, under
 * the production change lock, while no RTA import is running:
 *
 *   docker compose -f docker-compose.prod.yml run --rm migrate \
 *     npx tsx scripts/repair-rta-transactions.ts --tenant <uuid> [--part A|B] [--apply] [--label <name>]
 *   ... --tenant <uuid> --revert <label> [--apply]
 */
import "dotenv/config";
import { sql } from "drizzle-orm";
import { withTenant, type Tx } from "../src/db/client";
import { folioKey } from "../src/lib/rta/process";
import { chooseFolioFor, matchReversals, type FolioRef, type RepairTxn } from "../src/lib/rta/repair";
import { recomputeInvestorsAum } from "../src/lib/finance/aum-persist";
import { matchBookedBusinessAfterImport } from "../src/lib/business/rta-match";

const args = process.argv.slice(2);
const opt = (name: string) => (args.includes(name) ? args[args.indexOf(name) + 1] : null);
const T = opt("--tenant");
const APPLY = args.includes("--apply");
const PART = (opt("--part") ?? "AB").toUpperCase();
const REVERT = opt("--revert");
const LABEL = opt("--label") ?? `rta-repair-${new Date().toISOString().slice(0, 16).replace(/[-:T]/g, "")}`;
if (!T || !/^[0-9a-f-]{36}$/i.test(T)) {
  console.error("usage: --tenant <uuid> [--part A|B|AB] [--apply] [--label <name>]  |  --tenant <uuid> --revert <label> [--apply]");
  process.exit(2);
}

const DRY = new Error("dry run — rolled back");
const crore = (n: number) => `₹${(n / 1e7).toFixed(2)} Cr`;
const lakhDelta = (n: number) => `${n >= 0 ? "+" : "−"}₹${(Math.abs(n) / 1e5).toFixed(2)} L`;
const day = (d: unknown) => String(d instanceof Date ? d.toISOString() : d).slice(0, 10);
/** One Postgres array literal, bound as one parameter. */
const pgArray = (xs: readonly string[]) => `{${xs.map((x) => `"${x.replace(/[\\"]/g, (c) => "\\" + c)}"`).join(",")}}`;
const GROSS = ["purchase", "lumpsum", "additional_purchase", "sip", "sip_topup"];

type Change = {
  id: string;
  investorId: string | null;
  part: "A" | "B";
  before: Record<string, unknown>;
  set: { folio_id?: string; status?: string; reason_code?: string | null; reason_description?: string | null; direction?: string };
};

async function measure(tx: Tx) {
  const r = (await tx.execute(sql`
    SELECT
      (SELECT COALESCE(sum(aum), 0) FROM investors WHERE tenant_id = ${T}::uuid AND deleted_at IS NULL AND merged_into_id IS NULL)::numeric AS aum,
      (SELECT COALESCE(sum(amount), 0) FROM transactions WHERE tenant_id = ${T}::uuid AND status IN ('processed', 'successful')
          AND type IN (${sql.join(GROSS.map((g) => sql`${g}`), sql`, `)}))::numeric AS gross
  `)).rows[0] as { aum: string; gross: string };
  return { aum: Number(r.aum), gross: Number(r.gross) };
}

/** Part A — re-point folio links from the row's own folio number. */
async function planA(tx: Tx): Promise<{ changes: Change[]; unresolved: number }> {
  const bad = (await tx.execute(sql`
    SELECT t.id, t.folio_number, COALESCE(t.amc_code, '') AS amc_code, t.investor_id, t.folio_id
      FROM transactions t JOIN folios f ON f.id = t.folio_id
     WHERE t.tenant_id = ${T}::uuid
       AND regexp_replace(upper(COALESCE(f.folio_number, '')), '[^A-Z0-9]', '', 'g')
        <> regexp_replace(upper(COALESCE(t.folio_number, '')), '[^A-Z0-9]', '', 'g')
  `)).rows as Array<{ id: string; folio_number: string; amc_code: string; investor_id: string | null; folio_id: string }>;
  if (!bad.length) return { changes: [], unresolved: 0 };

  const keys = [...new Set(bad.map((b) => folioKey(b.folio_number)).filter(Boolean))];
  const folios = (await tx.execute(sql`
    SELECT id, folio_number, COALESCE(amc_code, '') AS amc_code, investor_id FROM folios
     WHERE tenant_id = ${T}::uuid
       AND regexp_replace(upper(COALESCE(folio_number, '')), '[^A-Z0-9]', '', 'g') = ANY(${pgArray(keys)}::text[])
  `)).rows as Array<{ id: string; folio_number: string; amc_code: string; investor_id: string | null }>;
  const byKey = new Map<string, FolioRef[]>();
  for (const f of folios) {
    const k = folioKey(f.folio_number);
    const list = byKey.get(k) ?? [];
    list.push({ id: String(f.id), folioNumber: f.folio_number, amcCode: f.amc_code, investorId: f.investor_id ? String(f.investor_id) : null });
    byKey.set(k, list);
  }

  const changes: Change[] = [];
  let unresolved = 0;
  for (const b of bad) {
    const target = chooseFolioFor(
      { folioNumber: b.folio_number, amcCode: b.amc_code, investorId: b.investor_id ? String(b.investor_id) : null },
      byKey.get(folioKey(b.folio_number)) ?? [],
    );
    if (!target) { unresolved++; continue; }
    if (target === String(b.folio_id)) continue;
    changes.push({ id: String(b.id), investorId: b.investor_id ? String(b.investor_id) : null, part: "A", before: { folio_id: b.folio_id }, set: { folio_id: target } });
  }
  return { changes, unresolved };
}

/** Part B — reversals stored as purchases, and switch-out legs stored as inflows. */
async function planB(tx: Tx): Promise<{ changes: Change[]; reversals: number; matched: number; byType: Record<string, { n: number; matched: number; amount: number }>; switches: number }> {
  type Row = { id: string; order_id: string | null; folio_number: string; scheme_code: string | null; type: string; order_date: unknown; u: string; amount: string; investor_id: string | null; status: string; reason_code: string | null; reason_description: string | null; direction: string };
  const revRows = (await tx.execute(sql`
    SELECT id, order_id, folio_number, scheme_code, type, order_date, abs(units) AS u, abs(amount) AS amount, investor_id,
           status, reason_code, reason_description, direction
      FROM transactions
     WHERE tenant_id = ${T}::uuid AND status IN ('processed', 'successful')
       AND COALESCE(reason_code, '') NOT IN ('REVERSAL', 'REVERSED')
       AND direction = 'inflow' AND units < 0 AND type IN ('lumpsum', 'sip', 'dividend_reinvest')
       AND order_date IS NOT NULL
  `)).rows as Row[];

  const key = (r: Row) => `${folioKey(r.folio_number)}|${r.scheme_code ?? ""}|${r.type}`;
  const toTxn = (r: Row): RepairTxn => ({ id: String(r.id), key: key(r), date: day(r.order_date), units: Number(r.u), amount: Number(r.amount) });

  let origRows: Row[] = [];
  if (revRows.length) {
    const folioKeys = [...new Set(revRows.map((r) => folioKey(r.folio_number)))];
    const earliest = revRows.map((r) => day(r.order_date)).sort()[0];
    origRows = (await tx.execute(sql`
      SELECT id, order_id, folio_number, scheme_code, type, order_date, abs(units) AS u, abs(amount) AS amount, investor_id,
             status, reason_code, reason_description, direction
        FROM transactions
       WHERE tenant_id = ${T}::uuid AND status IN ('processed', 'successful')
         AND COALESCE(reason_code, '') NOT IN ('REVERSAL', 'REVERSED')
         AND direction = 'inflow' AND units > 0 AND type IN ('lumpsum', 'sip', 'dividend_reinvest')
         AND order_date >= ${earliest}::date - 120
         AND regexp_replace(upper(COALESCE(folio_number, '')), '[^A-Z0-9]', '', 'g') = ANY(${pgArray(folioKeys)}::text[])
    `)).rows as Row[];
  }
  const pairs = matchReversals(revRows.map(toTxn), origRows.map(toTxn));
  const origById = new Map(origRows.map((o) => [String(o.id), o]));

  const changes: Change[] = [];
  const byType: Record<string, { n: number; matched: number; amount: number }> = {};
  for (const r of revRows) {
    const t = (byType[r.type] ??= { n: 0, matched: 0, amount: 0 });
    t.n++;
    t.amount += Number(r.amount);
    const before = { status: r.status, reason_code: r.reason_code, reason_description: r.reason_description };
    changes.push({
      id: String(r.id), investorId: r.investor_id ? String(r.investor_id) : null, part: "B", before,
      set: { status: "cancelled", reason_code: "REVERSAL", reason_description: "Reversal of an earlier transaction (registrar) — repaired 29 Oct 2026 audit" },
    });
    const origId = pairs.get(String(r.id));
    const o = origId ? origById.get(origId) : undefined;
    if (o) {
      t.matched++;
      changes.push({
        id: String(o.id), investorId: o.investor_id ? String(o.investor_id) : null, part: "B",
        before: { status: o.status, reason_code: o.reason_code, reason_description: o.reason_description },
        set: { status: "cancelled", reason_code: "REVERSED", reason_description: `Reversed by the registrar (${r.order_id ?? r.id})` },
      });
    }
  }

  const sw = (await tx.execute(sql`
    SELECT id, investor_id, direction FROM transactions
     WHERE tenant_id = ${T}::uuid AND type IN ('switch', 'stp') AND direction = 'inflow' AND units < 0
  `)).rows as Array<{ id: string; investor_id: string | null; direction: string }>;
  for (const s of sw) {
    changes.push({ id: String(s.id), investorId: s.investor_id ? String(s.investor_id) : null, part: "B", before: { direction: s.direction }, set: { direction: "outflow" } });
  }
  return { changes, reversals: revRows.length, matched: pairs.size, byType, switches: sw.length };
}

/** Write the changes, 500 rows per statement, and their audit rows. */
async function applyChanges(tx: Tx, changes: Change[], label: string, action: string) {
  for (let i = 0; i < changes.length; i += 500) {
    const part = changes.slice(i, i + 500);
    await tx.execute(sql`
      UPDATE transactions t SET
        folio_id = COALESCE(v.folio_id::uuid, t.folio_id),
        status = COALESCE(v.status, t.status),
        reason_code = CASE WHEN v.touch_reason THEN v.reason_code ELSE t.reason_code END,
        reason_description = CASE WHEN v.touch_reason THEN v.reason_description ELSE t.reason_description END,
        direction = COALESCE(v.direction, t.direction),
        updated_at = now()
      FROM (VALUES ${sql.join(part.map((c) => sql`(
        ${c.id}::uuid, ${c.set.folio_id ?? null}::text, ${c.set.status ?? null}::text,
        ${"reason_code" in c.set}::boolean, ${c.set.reason_code ?? null}::text, ${c.set.reason_description ?? null}::text,
        ${c.set.direction ?? null}::text)`), sql`, `)})
        AS v(id, folio_id, status, touch_reason, reason_code, reason_description, direction)
      WHERE t.id = v.id AND t.tenant_id = ${T}::uuid
    `);
    await tx.execute(sql`
      INSERT INTO audit_log (id, tenant_id, actor_type, action, entity_type, entity_id, before, after, meta, reason)
      VALUES ${sql.join(part.map((c) => sql`(
        gen_random_uuid(), ${T}::uuid, 'system', ${action}, 'transaction', ${c.id}::uuid,
        ${JSON.stringify(c.before)}::jsonb, ${JSON.stringify(c.set)}::jsonb,
        ${JSON.stringify({ label, part: c.part })}::jsonb, 'RTA import audit 29 Oct 2026')`), sql`, `)}
    `);
  }
}

async function repair() {
  const out = await withTenant(T!, async (tx) => {
    await tx.execute(sql`SET LOCAL statement_timeout = '600s'`);
    const before = await measure(tx);
    const a = PART.includes("A") ? await planA(tx) : { changes: [], unresolved: 0 };
    const b = PART.includes("B") ? await planB(tx) : { changes: [], reversals: 0, matched: 0, byType: {}, switches: 0 };
    // A row can be in both parts (re-pointed AND a reversal): merge so one
    // UPDATE carries both and the audit keeps both sets of old values.
    const merged = new Map<string, Change>();
    for (const c of [...a.changes, ...b.changes]) {
      const prev = merged.get(c.id);
      merged.set(c.id, prev ? { ...prev, before: { ...c.before, ...prev.before }, set: { ...prev.set, ...c.set } } : c);
    }
    const changes = [...merged.values()];
    await applyChanges(tx, changes, LABEL, "transaction.rta_repair");
    const touched = [...new Set(changes.map((c) => c.investorId).filter(Boolean) as string[])];
    await recomputeInvestorsAum(tx, touched);
    const after = await measure(tx);
    const result = { before, after, a, b, changes: changes.length, clients: touched.length };
    report(result);
    if (!APPLY) throw DRY;
    return result;
  }).catch((e) => { if (e === DRY) return null; throw e; });
  if (APPLY && out) {
    // Booked business is confirmed against these transactions; re-check it.
    await matchBookedBusinessAfterImport(T!);
    console.log("booked-business RTA matching re-run");
  }
}

function report(r: {
  before: { aum: number; gross: number }; after: { aum: number; gross: number };
  a: { changes: Change[]; unresolved: number };
  b: { reversals: number; matched: number; byType: Record<string, { n: number; matched: number; amount: number }>; switches: number };
  changes: number; clients: number;
}) {
  console.log(`\n${APPLY ? "APPLY" : "DRY RUN"} · tenant ${T} · label ${LABEL}`);
  console.log(`A  folio links re-pointed: ${r.a.changes.length}   (left alone, folio unclear: ${r.a.unresolved})`);
  console.log(`B  reversals cancelled: ${r.b.reversals}   of which paired with the transaction they reverse: ${r.b.matched}`);
  for (const [type, t] of Object.entries(r.b.byType)) {
    console.log(`     ${type.padEnd(18)} ${String(t.n).padStart(7)} rows  ${`₹${(t.amount / 1e5).toFixed(2)} L`.padStart(14)}   paired ${t.matched}`);
  }
  console.log(`   switch / STP out-legs turned to outflow: ${r.b.switches}`);
  console.log(`rows changed ${r.changes} · clients recomputed ${r.clients}`);
  console.log(`firm AUM            ${crore(r.before.aum)} → ${crore(r.after.aum)}   (${lakhDelta(r.after.aum - r.before.aum)})`);
  console.log(`RTA gross invested  ${crore(r.before.gross)} → ${crore(r.after.gross)}   (${lakhDelta(r.after.gross - r.before.gross)})`);
  if (!APPLY) console.log("dry run — nothing was written (re-run with --apply)");
}

async function revert(label: string) {
  await withTenant(T!, async (tx) => {
    await tx.execute(sql`SET LOCAL statement_timeout = '600s'`);
    const rows = (await tx.execute(sql`
      SELECT entity_id, before FROM audit_log
       WHERE tenant_id = ${T}::uuid AND action = 'transaction.rta_repair' AND meta->>'label' = ${label}
       ORDER BY at
    `)).rows as Array<{ entity_id: string; before: Record<string, unknown> }>;
    const changes: Change[] = rows.map((r) => {
      const b = r.before ?? {};
      const set: Change["set"] = {};
      if ("folio_id" in b) set.folio_id = String(b.folio_id);
      if ("status" in b) set.status = String(b.status);
      // A reason that was NULL before goes back to NULL.
      if ("reason_code" in b) {
        set.reason_code = (b.reason_code as string | null) ?? null;
        set.reason_description = (b.reason_description as string | null) ?? null;
      }
      if ("direction" in b) set.direction = String(b.direction);
      return { id: String(r.entity_id), investorId: null, part: "A", before: {}, set };
    });
    await applyChanges(tx, changes, label, "transaction.rta_repair_revert");
    const ids = changes.map((c) => c.id);
    const owners = ids.length
      ? ((await tx.execute(sql`SELECT DISTINCT investor_id FROM transactions WHERE tenant_id = ${T}::uuid AND id = ANY(${pgArray(ids)}::uuid[]) AND investor_id IS NOT NULL`)).rows as Array<{ investor_id: string }>).map((x) => String(x.investor_id))
      : [];
    await recomputeInvestorsAum(tx, owners);
    console.log(`${APPLY ? "REVERTED" : "DRY RUN revert"} ${changes.length} row(s) of ${label}`);
    if (!APPLY) throw DRY;
  }).catch((e) => { if (e !== DRY) throw e; });
}

(REVERT ? revert(REVERT) : repair())
  .then(() => process.exit(0))
  .catch((e) => { console.error("FAILED:", e?.cause?.message ?? e?.message ?? e); process.exit(1); });
