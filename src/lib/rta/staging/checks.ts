/**
 * Reconciliation checks for one staged batch. Every check is pass, fail or
 * UNVERIFIED — a check the available data cannot decide says so, it is never
 * passed by default. Failing checks never change a figure.
 *
 * `blocking` checks are about the pipeline itself (every row accounted for,
 * values carried through unchanged, isolation in place): one failing puts the
 * batch in `exception`. Data findings (a lot that does not reconcile, a folio
 * filed under another client) have already held their rows; their checks are
 * reported but do not stop the rest of the batch.
 */
import { sql } from "drizzle-orm";
import type { Tx } from "@/db/client";
import type { rtaStagingBatches } from "@/db/schema/rta_staging";
import type { Layout, NormRow } from "./layouts";
import type { EconOut } from "./group";

export type CheckOut = {
  code: string;
  scope: "batch" | "econ";
  scopeRef?: string;
  status: "pass" | "fail" | "unverified";
  expected?: string;
  actual?: string;
  tolerance?: string;
  detail?: Record<string, unknown>;
  blocking?: boolean;
};

type Ctx = {
  tenantId: string;
  batch: typeof rtaStagingBatches.$inferSelect;
  layout: Layout;
  norm: NormRow[];
  econs: Array<EconOut & { finalStatus: string }>;
  rowStates: Map<number, string>;
  matches: Map<number, { state: string; match_rule: string | null; exception_code: string | null }>;
};

const FINAL_ROW_STATES = new Set(["staged", "staged_as_part", "duplicate", "quarantined", "rejected", "invalid"]);
const STAGING_TABLES = ["rta_staging_batches", "rta_staging_economic_txns", "rta_staging_rows", "rta_staging_lots", "rta_staging_checks"];

/** An independent reading of a date cell: ISO, or D/M/YYYY in the given order. */
function independentDate(raw: string, dayFirst: boolean): string | null {
  const s = raw.trim();
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  if (m) {
    const [d, mo] = dayFirst ? [m[1], m[2]] : [m[2], m[1]];
    return `${m[3]}-${mo.padStart(2, "0")}-${d.padStart(2, "0")}`;
  }
  return null;
}

const bump = (o: Record<string, number>, k: string) => (o[k] = (o[k] ?? 0) + 1);

export async function buildChecks(tx: Tx, ctx: Ctx): Promise<CheckOut[]> {
  const { tenantId, batch, layout, norm, econs, rowStates, matches } = ctx;
  const out: CheckOut[] = [];

  // ── Row accounting ────────────────────────────────────────────────────
  const [{ n: persisted }] = (await tx.execute(sql`SELECT count(*)::int AS n FROM rta_staging_rows WHERE tenant_id = ${tenantId}::uuid AND batch_id = ${batch.id}::uuid`)).rows as Array<{ n: number }>;
  out.push({ code: "rows.raw_count", scope: "batch", status: Number(persisted) === batch.rowCount ? "pass" : "fail", expected: String(batch.rowCount), actual: String(persisted), detail: { meaning: "data rows in the file vs rows staged" }, blocking: true });
  const nos = norm.map((r) => r.rowNo).sort((a, b) => a - b);
  const contiguous = nos.every((n, i) => n === i + 1);
  out.push({ code: "rows.missing_source_rows", scope: "batch", status: contiguous && nos.length === batch.rowCount ? "pass" : "fail", expected: `1..${batch.rowCount}`, actual: `${nos.length} rows, ${contiguous ? "contiguous" : "gaps"}`, blocking: true });
  const byState: Record<string, number> = {};
  let unaccounted = 0;
  for (const r of norm) {
    const s = rowStates.get(r.rowNo) ?? "none";
    bump(byState, s);
    if (!FINAL_ROW_STATES.has(s)) unaccounted++;
  }
  out.push({ code: "rows.accounted", scope: "batch", status: unaccounted === 0 ? "pass" : "fail", expected: String(norm.length), actual: String(norm.length - unaccounted), detail: { byState }, blocking: true });

  // ── Source vs normalized values ───────────────────────────────────────
  const dayFirst = true;
  let dateChecked = 0, dateMismatch = 0;
  const numMismatch: Record<string, number> = {};
  let numChecked = 0;
  const fields: Array<[string, keyof NormRow]> = [["units", "units"], ["amount", "amount"], ["nav", "nav"], ["price", "price"], ["load", "loadAmount"], ["stt", "stt"], ["stampDuty", "stampDuty"], ["value", "holdingValue"]];
  for (const r of norm) {
    if (!r.valid) continue;
    for (const f of ["tradeDate", "asOfDate"] as const) {
      const raw = r.src[f];
      if (raw === undefined || raw === "") continue;
      dateChecked++;
      if (independentDate(raw, dayFirst) !== r[f]) dateMismatch++;
    }
    for (const [srcKey, key] of fields) {
      const raw = r.src[srcKey];
      if (raw === undefined || raw.trim() === "") continue;
      numChecked++;
      const v = r[key] as { text: string } | null;
      const independent = Number(raw.replace(/,/g, "").replace(/^\((.*)\)$/, "-$1"));
      if (!v || !Number.isFinite(independent) || Math.abs(independent - Number(v.text)) > 1e-9 * Math.max(1, Math.abs(independent))) bump(numMismatch, srcKey);
    }
  }
  out.push({ code: "values.dates", scope: "batch", status: dateMismatch === 0 ? "pass" : "fail", expected: "0 mismatches", actual: `${dateMismatch} of ${dateChecked}`, detail: { rule: "normalized date = independent ISO / day-first reading of the source cell" }, blocking: true });
  const totalNum = Object.values(numMismatch).reduce((s, n) => s + n, 0);
  out.push({ code: "values.figures", scope: "batch", status: totalNum === 0 ? "pass" : "fail", expected: "0 mismatches", actual: `${totalNum} of ${numChecked}`, detail: { byField: numMismatch, rule: "stored decimal text = the source digits, grouping removed" }, blocking: true });
  const invalid = norm.filter((r) => !r.valid);
  const invalidReasons: Record<string, number> = {};
  for (const r of invalid) for (const i of r.issues) bump(invalidReasons, i.field);
  out.push({ code: "rows.invalid", scope: "batch", status: "pass", actual: String(invalid.length), detail: { byField: invalidReasons, meaning: "rows whose mandatory values could not be read — staged as invalid with their reason, never as 0 / today" }, blocking: false });

  // ── Identity ──────────────────────────────────────────────────────────
  const rules: Record<string, number> = {};
  const idStates: Record<string, number> = {};
  for (const r of norm) {
    if (!r.valid) continue;
    const m = matches.get(r.rowNo);
    bump(rules, m?.match_rule ?? "none");
    bump(idStates, m?.state ?? "none");
  }
  const undecided = (rules["none"] ?? 0);
  out.push({ code: "identity.resolution", scope: "batch", status: undecided === 0 ? "pass" : "fail", actual: JSON.stringify(idStates), detail: { byRule: rules, note: "every valid row has an owner decision (lib/rta/owner.ts): the folio on record, the owner's own PAN, a provisional folio-keyed owner, or an exception" }, blocking: true });
  const conflicts = Object.entries(rules).filter(([k]) => k.startsWith("exception:")).reduce((s, [, n]) => s + n, 0);
  const ownerTypes: Record<string, number> = {};
  const holderFlags: Record<string, number> = {};
  for (const r of norm) {
    if (!r.valid || !r.owner) continue;
    bump(ownerTypes, `${r.owner.ownerType}${r.owner.ownerTypeSource === "pan_structure" ? " (from PAN letter)" : ""}`);
    for (const f of r.owner.flags) bump(holderFlags, f);
  }
  out.push({ code: "identity.owner_types", scope: "batch", status: "pass", actual: JSON.stringify(ownerTypes), detail: { flags: holderFlags, meaning: "the legal owner type each row states; a guardian's or Karta's PAN is never the owner" }, blocking: false });
  out.push({ code: "identity.conflicts", scope: "batch", status: conflicts === 0 ? "pass" : "fail", actual: String(conflicts), detail: { meaning: "rows held because ownership cannot be established safely (guardian-owned minor folio, owner type or PAN conflict, placeholder, HUF without HUF PAN, merge or Trash) — nothing reassigned" }, blocking: false });

  // ── Classification ────────────────────────────────────────────────────
  if (layout.recordKind === "transaction") {
    const byClass: Record<string, number> = {};
    const byConfidence: Record<string, number> = {};
    const held: Record<string, number> = {};
    for (const r of norm) {
      if (!r.cls) continue;
      bump(byClass, r.cls.rtaClass);
      bump(byConfidence, r.cls.confidence);
      if (r.cls.exception) bump(held, r.cls.exception);
    }
    const unclassified = norm.filter((r) => r.valid && !r.cls).length;
    out.push({ code: "class.coverage", scope: "batch", status: unclassified === 0 ? "pass" : "fail", actual: JSON.stringify(byClass), detail: { byConfidence, heldByClassification: held }, blocking: true });

    const stp = (byClass.stp_in ?? 0) + (byClass.stp_out ?? 0) + (byClass.switch_in ?? 0) + (byClass.switch_out ?? 0);
    out.push({
      code: "class.transfer_leg_pairing", scope: "batch", status: "unverified",
      actual: `${stp} switch / STP rows`,
      detail: { reason: "the counterpart leg of a transfer is in another folio or file and the link columns (ticob_trno / ToProductCode) do not identify it uniquely — pairing cannot be proven from this file" },
    });

    // ── Economic transactions ──────────────────────────────────────────
    const byStatus: Record<string, number> = {};
    const byException: Record<string, number> = {};
    for (const e of econs) {
      bump(byStatus, e.finalStatus);
      if (e.finalStatus !== "complete" && e.exception) bump(byException, e.exception);
    }
    out.push({ code: "econ.summary", scope: "batch", status: "pass", actual: JSON.stringify(byStatus), detail: { byException, multiLotGroups: econs.filter((e) => e.multiLot).length, lotsInMultiLotGroups: econs.filter((e) => e.multiLot).reduce((s, e) => s + e.lots.length, 0) }, blocking: false });
    const dupWithin = norm.filter((r) => r.valid).length - new Set(norm.filter((r) => r.valid).map((r) => r.rowHash)).size;
    out.push({ code: "rows.identical_in_file", scope: "batch", status: "pass", actual: String(dupWithin), detail: { meaning: "rows byte-identical to another row of this file — each is kept as its own source row (a lot can legitimately repeat values)" }, blocking: false });

    for (const e of econs.filter((x) => x.lots.length)) {
      const bad = e.lots.filter((l) => l.arithmeticOk === false).length;
      const unknown = e.lots.filter((l) => l.arithmeticOk === null).length;
      out.push({
        code: "econ.lot_arithmetic", scope: "econ", scopeRef: e.identityKey,
        status: bad ? "fail" : unknown ? "unverified" : "pass",
        expected: "|units × NAV − load − amount| ≤ tolerance on every lot",
        actual: `${e.lots.length - bad - unknown} pass, ${bad} fail, ${unknown} without figures`,
        tolerance: "½ulp(amount) + ½ulp(load) + ½ulp(units)·NAV + ½ulp(NAV)·units, per lot",
        detail: { lots: e.lots.length, maxAbsDelta: Math.max(0, ...e.lots.map((l) => Math.abs(l.delta ?? 0))) },
        blocking: false,
      });
      if (e.lots.length > 1 || e.rowNos.length > 1) {
        const d = e.arithmeticDelta === null ? null : Number(e.arithmeticDelta);
        const t = e.arithmeticTolerance === null ? null : Number(e.arithmeticTolerance);
        out.push({
          code: "econ.group_arithmetic", scope: "econ", scopeRef: e.identityKey,
          status: d === null || t === null ? "unverified" : Math.abs(d) <= t ? "pass" : "fail",
          expected: "Σ(units × NAV) − Σload − Σamount = 0", actual: e.arithmeticDelta ?? "—", tolerance: e.arithmeticTolerance ?? "—",
          detail: { rows: e.rowNos.length, lots: e.lots.length, reportedUnits: e.reportedUnits, reportedAmount: e.reportedAmount, reportedExitLoad: e.reportedExitLoad, reportedStt: e.reportedStt, derivedGross: e.derivedGrossAmount },
          blocking: false,
        });
      }
    }
    const multi = econs.filter((e) => e.multiLot);
    if (multi.length) {
      const oneStt = multi.filter((e) => norm.filter((r) => e.rowNos.includes(r.rowNo) && r.stt && r.stt.num !== 0).length === 1).length;
      out.push({ code: "econ.group_completeness", scope: "batch", status: "unverified", actual: `${multi.length} multi-lot groups; ${oneStt} carry STT on exactly one row`, detail: { reason: "the registrar reports no group total or lot count, so a lot row missing from the file cannot be detected from the file alone; a later file with different lots for the same transaction is detected (restated)" } });
      out.push({ code: "econ.payout_semantics", scope: "batch", status: "unverified", detail: { reason: "whether the investor received Σamount or Σamount − STT is not stated in the file; both figures are stored, neither is derived" } });
      out.push({ code: "econ.lot_purchase_history", scope: "batch", status: "unverified", detail: { reason: "a lot's purchase transaction can only be matched once the historical purchase feed is staged" } });
    }

    // Read-only comparison with the existing importer.
    const actions: Record<string, number> = {};
    for (const e of econs) bump(actions, (e as unknown as { action: string }).action ?? "none");
    out.push({ code: "legacy.comparison", scope: "batch", status: (actions.legacy_conflict ?? 0) === 0 ? "pass" : "fail", actual: JSON.stringify(actions), detail: { meaning: "adopt_legacy = the existing importer already holds the same transaction; legacy_conflict = it holds a different one under this number; post_new / unmatched = proposals only, nothing posted" }, blocking: false });
  } else {
    // ── Holdings / master ────────────────────────────────────────────────
    const asOf = new Set(norm.filter((r) => r.asOfDate).map((r) => r.asOfDate));
    out.push({ code: "holding.as_of_single", scope: "batch", status: asOf.size === 1 ? "pass" : asOf.size === 0 ? "unverified" : "fail", actual: `${asOf.size} distinct report date(s)`, blocking: false });
    if (layout.recordKind === "holding") {
      const sumText = (k: "units" | "holdingValue") => norm.reduce((s, r) => s + (r[k]?.num ?? 0), 0);
      const sumRaw = (k: string) => norm.reduce((s, r) => s + (r.src[k] && r.valid ? Number(r.src[k].replace(/,/g, "")) : 0), 0);
      const u = sumText("units"), uRaw = sumRaw("units"), v = sumText("holdingValue"), vRaw = sumRaw("value");
      out.push({ code: "holding.totals", scope: "batch", status: Math.abs(u - uRaw) < 1e-6 && Math.abs(v - vRaw) < 1e-6 ? "pass" : "fail", actual: `Σunits ${u.toFixed(4)}, Σvalue ${v.toFixed(2)}`, expected: `Σunits ${uRaw.toFixed(4)}, Σvalue ${vRaw.toFixed(2)} (source)`, blocking: true });
      const zero = norm.filter((r) => r.valid && r.units && r.units.num === 0).length;
      out.push({ code: "holding.zero_positions", scope: "batch", status: "pass", actual: String(zero), detail: { meaning: "positions the registrar reports as exactly 0 units — kept as an explicit zero, never as missing" }, blocking: false });
      const withNav = norm.filter((r) => r.valid && r.nav && r.units && r.holdingValue);
      if (withNav.length) {
        // value = units × NAV within the printed precision: ½ulp(value) + ½ulp(units)·NAV + ½ulp(NAV)·units.
        const off = withNav.filter((r) => {
          const d = Math.abs(r.units!.num * r.nav!.num - r.holdingValue!.num);
          const tol = 0.5 * 10 ** -r.holdingValue!.dp + 0.5 * 10 ** -r.units!.dp * Math.abs(r.nav!.num) + 0.5 * 10 ** -r.nav!.dp * Math.abs(r.units!.num) + 1e-9;
          return d > tol;
        }).length;
        out.push({ code: "holding.value_vs_nav", scope: "batch", status: off === 0 ? "pass" : "fail", actual: `${withNav.length - off} of ${withNav.length} positions`, tolerance: "½ulp(value) + ½ulp(units)·NAV + ½ulp(NAV)·units", blocking: false });
      } else {
        out.push({ code: "holding.value_vs_nav", scope: "batch", status: "unverified", detail: { reason: "the statement carries no NAV, so value = units × NAV cannot be checked from it" } });
      }
      out.push({ code: "holding.vs_transactions", scope: "batch", status: "unverified", detail: { reason: "no opening balance is available, so closing units cannot be rebuilt from transactions" } });
    }
  }

  if (layout.recordKind === "registration") {
    const v = norm.filter((r) => r.valid);
    const withId = v.filter((r) => r.registrarTxnNo).length;
    const withStatus = v.filter((r) => r.attrs.registrarStatus || r.attrs.ceaseDate || r.attrs.terminateDate || "registrarStatus" in r.attrs).length;
    out.push({ code: "registration.id_present", scope: "batch", status: withId === v.length ? "pass" : "fail", actual: `${withId} of ${v.length}`, detail: { meaning: "a registration without the registrar's own id cannot be keyed or matched to its instalments" }, blocking: false });
    const statusColumn = layout.id === "kfintech.mfsd243" ? "Status + TerminateDate" : layout.id === "cams.wbr49" ? "cease_date + pause dates" : null;
    out.push({ code: "registration.lifecycle_source", scope: "batch", status: statusColumn ? "pass" : "unverified", actual: statusColumn ?? "none", detail: { rowsWithAStatusOrCeaseFact: withStatus, meaning: statusColumn ? "the registrar states each registration's status or cease date" : "the file states no status — every registration's state is UNKNOWN" }, blocking: false });
    out.push({ code: "registration.scope", scope: "batch", status: "unverified", detail: { reason: "the file carries no report or as-of date and no statement of which registration period it covers; it cannot be shown to be the whole SIP book" } });
  }

  // ── Tenant isolation (structural, read from the catalogue) ──────────────
  const rls = (await tx.execute(sql`
    SELECT c.relname AS t, c.relrowsecurity AS en, c.relforcerowsecurity AS force,
           EXISTS (SELECT 1 FROM pg_policies p WHERE p.tablename = c.relname AND p.policyname = 'tenant_isolation') AS pol
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public' AND c.relname IN (${sql.join(STAGING_TABLES.map((t) => sql`${t}`), sql`, `)})
  `)).rows as Array<{ t: string; en: boolean; force: boolean; pol: boolean }>;
  const ok = rls.length === STAGING_TABLES.length && rls.every((r) => r.en && r.force && r.pol);
  out.push({ code: "tenant.isolation", scope: "batch", status: ok ? "pass" : "fail", actual: `${rls.filter((r) => r.en && r.force && r.pol).length}/${STAGING_TABLES.length} staging tables with RLS enabled, forced and a tenant_isolation policy`, detail: { relationships: "every staging relationship is a composite (tenant_id, id) foreign key" }, blocking: true });

  return out;
}
