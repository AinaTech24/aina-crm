/**
 * Registrar transactions from source rows — pure, no database.
 *
 * Rows are grouped by their identity key (registrar scheme + AMC + the
 * registrar's transaction number). A group is ONE economic transaction:
 *
 *   one row                 the ordinary case
 *   several rows, KFintech  a redemption reported lot by lot (MFSD201: nine
 *   outflow with lot data   such groups, 143 rows) — totals are the SUMS of the
 *                           rows, every row is kept as its own lot
 *   several rows, otherwise not a layout the registrar has been seen to use —
 *                           the whole group is held
 *
 * A group is all-or-nothing: one invalid, unclassifiable or inconsistent row
 * holds every row of it. Reported figures are summed exactly as reported and
 * never adjusted; derived figures (gross = Σ units × NAV, the arithmetic
 * delta) are stored beside them, never over them.
 *
 * ── Tolerances (explicit, from the precision the registrar printed) ─────────
 * A reported figure printed with d decimals is exact to ±½·10^-d. For a lot,
 *     delta = units × nav − load − amount
 * so its tolerance is the propagated rounding of the four inputs:
 *     tol = ½ulp(amount) + ½ulp(load) + ½ulp(units)·|nav| + ½ulp(nav)·|units|
 * (ulp = 10^-decimals as printed; a blank load contributes nothing). A group's
 * tolerance is the sum of its lots'. No fixed "₹1" or percentage allowance is
 * used anywhere: a tolerance that is not derived from printed precision would
 * hide real discrepancies. Any figure outside it is a failed check and holds
 * the group; nothing is rounded or re-computed to make totals agree.
 */
import { keyedDigest } from "./pan-token";
import { CLASS_META, postable, type RtaClass } from "./classify";
import type { Decimal, NormRow } from "./layouts";

export type LotOut = {
  rowNo: number;
  registrarLotId: string | null;
  lotPart: number;
  purchaseTxnNo: string | null;
  purchaseDate: string | null;
  purchaseUnits: string | null;
  purchaseAmount: string | null;
  units: string | null;
  amount: string | null;
  price: string | null;
  nav: string | null;
  loadAmount: string | null;
  stt: string | null;
  delta: number | null;
  tolerance: number | null;
  arithmeticOk: boolean | null;
};

export type EconOut = {
  identityKey: string;
  registrarTxnNo: string;
  amcCode: string | null;
  folioNumber: string | null;
  schemeCode: string | null;
  tradeDate: string | null;
  rtaClass: RtaClass;
  classConfidence: "verified" | "inferred";
  direction: "inflow" | "outflow" | null;
  /** complete, or quarantined with `exception` + `reason`. (duplicate / restated / conflict are decided later, against earlier batches.) */
  status: "complete" | "quarantined";
  exception: string | null;
  reason: string | null;
  rowNos: number[];
  lots: LotOut[];
  reportedUnits: string | null;
  reportedAmount: string | null;
  reportedNav: string | null;
  reportedExitLoad: string | null;
  reportedStt: string | null;
  reportedStampDuty: string | null;
  derivedGrossAmount: string | null;
  arithmeticDelta: string | null;
  arithmeticTolerance: string | null;
  invariantHash: string;
  lotSignature: string;
  multiLot: boolean;
};

// ── Exact decimal sums (scaled BigInt, no float drift) ──────────────────────

const SCALE = 10;
function toScaled(d: Decimal): bigint {
  const neg = d.text.startsWith("-");
  const [i, f = ""] = d.text.replace("-", "").split(".");
  const v = BigInt(i || "0") * 10n ** BigInt(SCALE) + BigInt((f + "0".repeat(SCALE)).slice(0, SCALE) || "0");
  return neg ? -v : v;
}
/** Scaled integer → decimal text with exactly `dp` decimals (the inputs' printed precision). */
function fromScaled(v: bigint, dp: number): string {
  const neg = v < 0n;
  const a = neg ? -v : v;
  const i = a / 10n ** BigInt(SCALE);
  const f = (a % 10n ** BigInt(SCALE)).toString().padStart(SCALE, "0").slice(0, dp);
  return (neg && a !== 0n ? "-" : "") + i.toString() + (dp ? "." + f : "");
}
/** Σ of the reported values, printed to the finest precision any of them carried; null only when NO row reported one. */
export function sumReported(values: Array<Decimal | null>): string | null {
  const present = values.filter((v): v is Decimal => v !== null);
  if (!present.length) return null;
  return fromScaled(present.reduce((s, v) => s + toScaled(v), 0n), Math.min(SCALE, Math.max(...present.map((v) => v.dp))));
}

const halfUlp = (d: Decimal | null) => (d ? 0.5 * 10 ** -d.dp : 0);

/** A lot's arithmetic: delta and tolerance, or null when a figure it needs is absent. */
export function lotArithmetic(r: Pick<NormRow, "units" | "amount" | "nav" | "loadAmount">): { delta: number; tolerance: number } | null {
  if (!r.units || !r.amount || !r.nav) return null;
  const units = Math.abs(r.units.num);
  const load = r.loadAmount ? r.loadAmount.num : 0;
  const delta = units * r.nav.num - load - Math.abs(r.amount.num);
  const tolerance = halfUlp(r.amount) + halfUlp(r.loadAmount) + halfUlp(r.units) * Math.abs(r.nav.num) + halfUlp(r.nav) * units + 1e-9;
  return { delta, tolerance };
}

const round6 = (n: number) => (Math.round(n * 1e6) / 1e6).toString();

function fail(e: Omit<EconOut, "status" | "exception" | "reason">, exception: string, reason: string): EconOut {
  return { ...e, status: "quarantined", exception, reason };
}

/** Group a batch's transaction rows into economic transactions. Rows without an identity key are left out (they are invalid rows). */
export function groupTransactions(tenantId: string, rows: NormRow[], rta: "cams" | "kfintech"): EconOut[] {
  const byKey = new Map<string, NormRow[]>();
  for (const r of rows) {
    if (r.recordKind !== "transaction" || !r.economicKey) continue;
    const list = byKey.get(r.economicKey) ?? [];
    list.push(r);
    byKey.set(r.economicKey, list);
  }

  const out: EconOut[] = [];
  for (const [key, list] of byKey) {
    list.sort((a, b) => a.rowNo - b.rowNo);
    const first = list[0];
    const cls = first.cls!;
    const isOutflowLots = rta === "kfintech" && list.every((r) => r.lot) && CLASS_META[cls.rtaClass].direction === "outflow";

    // Lots: one per source row with lot data, split parts numbered by row order.
    const partNo = new Map<string, number>();
    const lots: LotOut[] = list.filter((r) => r.lot).map((r) => {
      const lotKey = r.lot!.registrarLotId ?? `row:${r.rowNo}`;
      const part = (partNo.get(lotKey) ?? 0) + 1;
      partNo.set(lotKey, part);
      const a = lotArithmetic(r);
      return {
        rowNo: r.rowNo, registrarLotId: r.lot!.registrarLotId, lotPart: part,
        purchaseTxnNo: r.lot!.purchaseTxnNo, purchaseDate: r.lot!.purchaseDate,
        purchaseUnits: r.lot!.purchaseUnits?.text ?? null, purchaseAmount: r.lot!.purchaseAmount?.text ?? null,
        units: r.units?.text ?? null, amount: r.amount?.text ?? null, price: r.price?.text ?? null, nav: r.nav?.text ?? null,
        loadAmount: r.loadAmount?.text ?? null, stt: r.stt?.text ?? null,
        delta: a ? a.delta : null, tolerance: a ? a.tolerance : null, arithmeticOk: a ? Math.abs(a.delta) <= a.tolerance : null,
      };
    });

    // Group arithmetic (only meaningful where the rows are lots).
    let gross: number | null = null, delta: number | null = null, tol: number | null = null;
    if (lots.length) {
      const parts = list.map((r) => ({ r, a: lotArithmetic(r) }));
      if (parts.every((p) => p.a)) {
        gross = parts.reduce((s, p) => s + Math.abs(p.r.units!.num) * p.r.nav!.num, 0);
        delta = parts.reduce((s, p) => s + p.a!.delta, 0);
        tol = parts.reduce((s, p) => s + p.a!.tolerance, 0);
      }
    }

    const sortedLotText = list
      .map((r) => [r.lot?.registrarLotId ?? "", r.lot?.purchaseTxnNo ?? "", r.units?.text ?? "", r.amount?.text ?? "", r.price?.text ?? "", r.loadAmount?.text ?? "", r.stt?.text ?? "", r.stampDuty?.text ?? ""].join("|"))
      .sort()
      .join("\n");

    const base: Omit<EconOut, "status" | "exception" | "reason"> = {
      identityKey: key,
      registrarTxnNo: first.registrarTxnNo!,
      amcCode: first.amcCode, folioNumber: first.folioNumber, schemeCode: first.schemeCode, tradeDate: first.tradeDate,
      rtaClass: cls.rtaClass, classConfidence: cls.confidence, direction: cls.direction,
      rowNos: list.map((r) => r.rowNo),
      lots,
      reportedUnits: sumReported(list.map((r) => r.units)),
      reportedAmount: sumReported(list.map((r) => r.amount)),
      reportedNav: first.nav?.text ?? null,
      reportedExitLoad: sumReported(list.map((r) => r.loadAmount)),
      reportedStt: sumReported(list.map((r) => r.stt)),
      reportedStampDuty: sumReported(list.map((r) => r.stampDuty)),
      derivedGrossAmount: gross === null ? null : round6(gross),
      arithmeticDelta: delta === null ? null : round6(delta),
      arithmeticTolerance: tol === null ? null : round6(tol),
      invariantHash: first.invariants ?? keyedDigest(tenantId, "invariants", ""),
      lotSignature: keyedDigest(tenantId, "lots", sortedLotText),
      multiLot: list.length > 1 && isOutflowLots,
    };

    // ── All-or-nothing decision, most fundamental reason first ─────────────
    const invalid = list.filter((r) => !r.valid);
    if (invalid.length) {
      out.push(fail(base, "group_row_invalid", list.length > 1
        ? `${invalid.length} of the ${list.length} rows of this transaction could not be read (${invalid[0].issues[0]?.reason ?? "invalid"}) — the whole transaction is held`
        : `the row could not be read: ${invalid[0].issues.map((i) => i.reason).join("; ")}`));
      continue;
    }
    if (list.some((r) => r.cls!.rtaClass !== cls.rtaClass)) {
      out.push(fail(base, "group_class_mixed", "rows sharing this transaction number classify differently — held"));
      continue;
    }
    const classIssue = list.find((r) => r.cls!.exception)?.cls;
    if (classIssue) { out.push(fail(base, classIssue.exception!, classIssue.reason)); continue; }
    if (!postable(cls)) { out.push(fail(base, "unknown_transaction_code", cls.reason)); continue; }

    if (list.length > 1) {
      if (!isOutflowLots) {
        out.push(fail(base, "repeated_reference_unverified",
          `transaction number appears on ${list.length} rows of a ${rta === "cams" ? "CAMS" : "KFintech"} ${cls.rtaClass} — the registrar has not been seen to report this transaction in parts, so it is held`));
        continue;
      }
      if (list.some((r) => r.invariants !== first.invariants)) {
        out.push(fail(base, "group_invariants_differ", "the rows of this redemption disagree on folio, scheme, date, NAV, head or another column that must be the same on every lot — held"));
        continue;
      }
      const sttRows = list.filter((r) => r.stt && r.stt.num !== 0).length;
      if (sttRows > 1) {
        out.push(fail(base, "group_stt_multiple", `STT is reported on ${sttRows} rows of one redemption (the verified layout carries it on one) — held`));
        continue;
      }
    }
    const badLot = lots.find((l) => l.arithmeticOk === false);
    if (badLot) {
      out.push(fail(base, "lot_arithmetic", `lot on source row ${badLot.rowNo}: units × NAV − load differs from the amount by ${badLot.delta!.toFixed(6)}, outside the printed-precision tolerance ${badLot.tolerance!.toFixed(6)} — held, nothing adjusted`));
      continue;
    }
    if (delta !== null && tol !== null && Math.abs(delta) > tol) {
      out.push(fail(base, "group_arithmetic", `Σ(units × NAV) − Σload − Σamount = ${delta.toFixed(6)}, outside the tolerance ${tol.toFixed(6)} — held`));
      continue;
    }
    if (list.length > 1 && lots.some((l) => l.arithmeticOk === null)) {
      out.push(fail(base, "group_figures_missing", "a lot of this redemption lacks units, amount or NAV, so the group cannot be reconciled — held"));
      continue;
    }
    out.push({ ...base, status: "complete", exception: null, reason: null });
  }
  return out;
}
