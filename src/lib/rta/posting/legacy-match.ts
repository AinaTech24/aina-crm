/**
 * Is the CRM row already holding this registrar number the SAME transaction?
 * (final pilot patch, P1)
 *
 * A validate-first transaction whose registrar number is already on a CRM
 * transaction (typically one the existing importer wrote) is linked to it —
 * `matched_existing` — only when every fact agrees: the registrar, the client,
 * the AMC, the folio, the scheme, the date, the type, the direction, the
 * status, the amount and the units. Anything else is held as
 * `identity_conflict` naming what differs, and neither row is changed.
 *
 * The scheme is compared by identity, never by name:
 *   • the registrar's own product code (what the existing importer stores in
 *     `scheme_code` for KFintech), or
 *   • the AMFI scheme code the registrar code resolves to by an approved
 *     mapping (firm confirmation or platform map, never a revoked one), or
 *   • another code of the same registrar that an approved mapping ties to
 *     that same AMFI scheme (a historical identifier), at the same AMC or an
 *     AMC verified as its successor (registrar_amc_identity).
 * With the mapping unresolved or in conflict, only the registrar's own code
 * can prove the scheme; an AMFI code on the CRM row cannot be verified and the
 * transaction is held.
 */
import { sql } from "drizzle-orm";
import { isResolved, type SchemeResolution } from "@/lib/rta/scheme-resolution";

type Tx = any;

export type LegacyRow = {
  id: string; investorId: string | null; folioRta: string | null; amcCode: string | null; folioNumber: string | null;
  schemeCode: string | null; rtaSchemeCode: string | null; date: string | null; type: string | null; direction: string | null;
  amount: number | null; units: number | null; status: string | null;
};

export type IncomingTxn = {
  rta: string; investorId: string | null; amcCode: string | null; folioNumber: string | null; schemeCode: string | null;
  date: string | null; type: string | null; direction: string | null; amount: number | null; units: number; rejected: boolean;
};

export type SchemeEvidence = {
  /** Registrar codes that name this scheme: its own, plus historical ones tied by an approved mapping to the same AMFI scheme. */
  registrarCodes: Set<string>;
  /** The AMFI code the registrar code resolves to (empty when unresolved). */
  amfiCodes: Set<string>;
  /** Registrar AMC codes verified as the same AMC (its own, plus verified predecessor / successor codes). */
  amcCodes: Set<string>;
  status: string;
};

export type LegacyDecision = { match: true; id: string } | { match: false; differs: string[]; reason: string };

const near = (a: number | null, b: number | null, tol: number) => Math.abs(Math.abs(a ?? 0) - Math.abs(b ?? 0)) <= tol;

/** Pure: the decision for one incoming transaction against the CRM rows that hold its registrar number. */
export function legacyMatch(rows: LegacyRow[], inc: IncomingTxn, ev: SchemeEvidence): LegacyDecision {
  if (rows.length !== 1) {
    const differs = [`registrar number held by ${rows.length} CRM transactions`];
    return { match: false, differs, reason: reasonOf(differs) };
  }
  const t = rows[0];
  const differs: string[] = [];
  if (t.folioRta && t.folioRta !== inc.rta) differs.push("registrar");
  if (!t.investorId || t.investorId !== inc.investorId) differs.push("client");
  if (t.amcCode && !ev.amcCodes.has(t.amcCode)) differs.push("AMC");
  if ((t.folioNumber ?? "") !== (inc.folioNumber ?? "")) differs.push("folio");
  const scheme = schemeVerdict(t, ev);
  if (scheme) differs.push(scheme);
  if ((t.date ?? "") !== (inc.date ?? "")) differs.push("date");
  if ((t.type ?? "") !== (inc.type ?? "")) differs.push("transaction type");
  if ((t.direction ?? "") !== (inc.direction ?? "")) differs.push("direction");
  if (inc.rejected ? t.status !== "rejected" : t.status !== "processed") differs.push("status");
  if (!near(t.amount, inc.amount, 0.005)) differs.push("amount");
  if (!near(t.units, inc.units, 0.0005)) differs.push("units");
  return differs.length ? { match: false, differs, reason: reasonOf(differs) } : { match: true, id: t.id };
}

/** Null when the CRM row's scheme identifiers all name the registrar's scheme; else what is wrong. */
function schemeVerdict(t: LegacyRow, ev: SchemeEvidence): string | null {
  const ids = [t.schemeCode, t.rtaSchemeCode].filter((x): x is string => !!x && !!x.trim());
  if (!ids.length) return "scheme (not recorded on the CRM row)";
  // A registrar-code column must hold a registrar code of this scheme.
  if (t.rtaSchemeCode && !ev.registrarCodes.has(t.rtaSchemeCode)) return "scheme";
  if (t.schemeCode && !ev.registrarCodes.has(t.schemeCode)) {
    if (ev.amfiCodes.has(t.schemeCode)) return null;
    if (!isResolved(ev.status)) return `scheme (the registrar → AMFI mapping is ${ev.status || "unresolved"}, so the CRM row's scheme cannot be verified)`;
    return "scheme";
  }
  return null;
}

const reasonOf = (differs: string[]) =>
  `identity_conflict: the CRM holds a different transaction under this registrar number (differs in: ${differs.join(", ")}) — neither is changed. `
  + "Compare the two under RTA File Imports → Held; correct the CRM record or the scheme mapping, then re-run.";

/** The scheme / AMC identifiers an approved mapping ties to this registrar code. */
export async function schemeEvidence(tx: Tx, tenantId: string, k: { rta: string; amcCode: string | null; schemeCode: string | null }, scheme: SchemeResolution): Promise<SchemeEvidence> {
  const amcCodes = new Set<string>(k.amcCode ? [k.amcCode] : []);
  if (k.amcCode) {
    const rows = (await tx.execute(sql`
      SELECT DISTINCT o.rta_amc_code FROM registrar_amc_identity o
       WHERE o.rta = ${k.rta} AND o.status <> 'revoked' AND o.revoked_at IS NULL
         AND o.amfi_amc IN (SELECT i.amfi_amc FROM registrar_amc_identity i WHERE i.rta = ${k.rta} AND i.rta_amc_code = ${k.amcCode} AND i.status <> 'revoked' AND i.revoked_at IS NULL)`)).rows as Array<{ rta_amc_code: string }>;
    for (const r of rows) amcCodes.add(r.rta_amc_code);
  }
  const registrarCodes = new Set<string>(k.schemeCode ? [k.schemeCode] : []);
  const amfiCodes = new Set<string>();
  const amfi = isResolved(scheme.status) ? scheme.amfiSchemeCode : null;
  if (amfi) {
    amfiCodes.add(amfi);
    const amcs = [...amcCodes];
    if (amcs.length) {
      const rows = (await tx.execute(sql`
        SELECT rta_scheme_code FROM scheme_rta_codes
         WHERE tenant_id = ${tenantId}::uuid AND rta = ${k.rta} AND amfi_scheme_code = ${amfi} AND status IN ('resolved_isin', 'confirmed')
           AND rta_amc_code IN (${sql.join(amcs.map((a) => sql`${a}`), sql`, `)})
        UNION
        SELECT rta_scheme_code FROM scheme_registrar_map
         WHERE rta = ${k.rta} AND amfi_scheme_code = ${amfi} AND status <> 'revoked' AND revoked_at IS NULL
           AND rta_amc_code IN (${sql.join(amcs.map((a) => sql`${a}`), sql`, `)})`)).rows as Array<{ rta_scheme_code: string }>;
      for (const r of rows) registrarCodes.add(r.rta_scheme_code);
    }
  }
  return { registrarCodes, amfiCodes, amcCodes, status: scheme.status };
}

/** The CRM rows holding a registrar number, with the registrar of the folio each is filed under. */
export async function legacyRowsFor(tx: Tx, tenantId: string, registrarTxnNo: string): Promise<LegacyRow[]> {
  const rows = (await tx.execute(sql`
    SELECT t.id::text AS id, t.investor_id::text AS investor_id, f.rta AS folio_rta, t.amc_code, t.folio_number, t.scheme_code, t.rta_scheme_code,
           t.order_date::text AS d, t.type, t.direction, t.amount::text AS amount, t.units::text AS units, t.status
      FROM transactions t LEFT JOIN folios f ON f.id = t.folio_id
     WHERE t.tenant_id = ${tenantId}::uuid AND t.order_id = ${registrarTxnNo}`)).rows as any[];
  return rows.map((r) => ({
    id: r.id, investorId: r.investor_id, folioRta: r.folio_rta ?? null, amcCode: r.amc_code, folioNumber: r.folio_number, schemeCode: r.scheme_code,
    rtaSchemeCode: r.rta_scheme_code, date: r.d, type: r.type, direction: r.direction, amount: r.amount == null ? null : Number(r.amount),
    units: r.units == null ? null : Number(r.units), status: r.status,
  }));
}
