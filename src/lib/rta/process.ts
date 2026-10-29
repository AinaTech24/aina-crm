/**
 * RTA file processor.
 *
 * Takes the raw text of an uploaded RTA file plus its (source, kind) tuple
 * and applies it to the correct downstream tables.
 *
 * Idempotency: every row carries a deterministic `external_ref` (order id /
 * mandate id / brokerage row id). We upsert keyed on that ref so a
 * re-uploaded file is a no-op.
 *
 * Returns per-import counters that the API surfaces to the user.
 *
 * Note: this runs synchronously inside the upload request. Files larger than
 * ~50k rows should be queued via BullMQ — out of scope for v1.
 */

import { createHash } from "node:crypto";
import { sql } from "drizzle-orm";
import type { Tx } from "@/db/client";
import {
  parseCamsFeed,
  parseKfintechFeed,
  type CanonicalTransaction,
} from "@/lib/integrations/cams-feed-parser";
import type { RtaFileKind, RtaSource } from "@/db/schema/rta_imports";
import { refreshActiveSipAmount } from "@/lib/metrics/sip";
import { markSystematicTransfers, NOT_A_SIP_REMARK } from "@/lib/finance/sip-lifecycle";
import {
  parseSipRejectionReport,
  parseBrokerageStatement,
  parseFolioMasterDump,
  parseSipBook,
  parseMandateStatus,
  parseAumStatement,
  type CanonicalSipRejection,
  type CanonicalBrokerageRow,
  type CanonicalFolioRow,
  type CanonicalSipRow,
  type CanonicalMandateRow,
  type CanonicalAumRow,
} from "./parsers";
import { registrarSipState } from "./sip-registrar-status";
import { clientIdForFolio, clientIdForPan, followMerges, resolvePanClients, type ClientHint } from "./client-match";

// A registrar reason this import wrote earlier, replaced (not stacked) on the next report.
const REG_PREFIX_RE = "^(CAMS|KFintech|Registrar): [^·]*( · ceased [^·]*)?( · )?";

/**
 * Resolve an investor by PAN first, then by an existing folio number. Most RTA
 * reverse-feeds (transaction, AUM, redemption, brokerage) are FOLIO-keyed and
 * carry no PAN column — without this fallback every row would skip. The folio
 * must already exist (created by an Investor/Folio Master import or an earlier
 * feed), which is why masters should be imported before transaction feeds.
 */
async function resolveInvestorId(
  tx: Tx,
  tenantId: string,
  key: { pan?: string; folioNumber?: string }
): Promise<string | null> {
  // Through lib/rta/client-match: the live client, merges followed, never a
  // record an operator merged away.
  return (await clientIdForPan(tx, tenantId, key.pan)) ?? (await clientIdForFolio(tx, tenantId, key.folioNumber));
}

/** The live client a just-upserted id ended up in (merges followed). */
async function liveOf(tx: Tx, tenantId: string, id: string | null): Promise<string | null> {
  if (!id) return null;
  return (await followMerges(tx, tenantId, [String(id)])).get(String(id)) ?? String(id);
}

/**
 * A PAN we are willing to key a new investor on: the exact SEBI/IT format
 * AAAAA9999A. Deliberately strict — a provisional client created from a
 * malformed value could never be matched by the folio master later, which is
 * exactly the duplicate this guard exists to prevent.
 */
function isLikelyPan(pan?: string): boolean {
  return !!pan && /^[A-Z]{5}[0-9]{4}[A-Z]$/i.test(pan.trim());
}

/** Registrar names arrive padded, upper-cased and sometimes NUL-laden. */
function sanitizeName(name?: string): string | null {
  const s = (name ?? "").replace(/[\x00-\x1F]/g, " ").replace(/\s+/g, " ").trim();
  return s.length >= 2 ? s.slice(0, 160) : null;
}

/**
 * Registrars pack a minor and their guardian into ONE name field:
 * "KAVYAAN GOEL REP BY GAURAV GOEL". Stored verbatim that becomes a client
 * literally called that — and because the guardian's name rides along, the SAME
 * minor spells differently across folios, defeating name-based dedup.
 */
export function splitRepresentedBy(raw?: string): { name: string | null; guardian: string | null; isMinor: boolean } {
  const s = sanitizeName(raw);
  if (!s) return { name: null, guardian: null, isMinor: false };
  const m = s.match(/^(.*?)\s+(?:REP(?:RESENTED)?\b\.?\s*BY|C\s*\/\s*O|GUARDIAN\s*[:\-]?)\s+(.+)$/i);
  if (!m) return { name: s, guardian: null, isMinor: false };
  const name = sanitizeName(m[1]);
  const guardian = sanitizeName(m[2]);
  // Only treat it as a split when BOTH halves survive; "REP BY" with nothing
  // before it is a malformed row, not a minor.
  return name && guardian ? { name, guardian, isMinor: true } : { name: s, guardian: null, isMinor: false };
}

/**
 * Deterministic key for a client we can see but have no PAN for.
 *
 * Mirrors the rich importer's `NOPAN:N<slug>` (src/lib/rta/import.ts) ON
 * PURPOSE: keyed the same way, a PAN-less client stood up from a feed and one
 * stood up from a folio master converge on one row instead of two.
 *
 * The folio is only the fallback. Keying on it directly — as the first cut of
 * this did — gives one client PER FOLIO, so a person holding three folios
 * became three clients ("KAVYAAN GOEL REP BY GAURAV GOEL" x3 in the client
 * list). The name is the identity; the folio is just where the money sits.
 */
function nopanKeyFor(name: string | null, folioNumber: string): string {
  const slug = (name ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  return slug ? `NOPAN:N${slug}` : `NOPAN:FOLIO:${folioNumber}`;
}

/**
 * One Postgres array literal, bound as ONE parameter. A JS array interpolated
 * into sql`` expands to a tuple ($1, $2, …), which `::text[]` cannot cast.
 */
function pgArray(xs: readonly string[]): string {
  return `{${xs.map((x) => `"${x.replace(/[\\"]/g, (c) => "\\" + c)}"`).join(",")}}`;
}

/** A folio number as the registrar means it: case, spaces and slashes ignored. */
export function folioKey(folio?: string | null): string {
  return (folio ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
}

/** One folio row the book already holds under a folio number. */
export type FolioOwner = { amcCode: string; investorId: string; isMinor: boolean };

/**
 * Which client a row with this folio number belongs to.
 *
 * Folio numbers are unique only WITHIN an AMC. The old lookup took whichever
 * folio row came back first, so a row for AMC X attached to the client who
 * holds the same number at AMC Y. Rule: one candidate → it (AMC codes are
 * spelt differently across a registrar's own reports, so a lone candidate is
 * not second-guessed); several → the one whose AMC matches; several and none
 * matches → nobody, so the row is held back with a reason instead of guessed.
 */
export function pickFolioOwner(owners: FolioOwner[] | undefined, amcCode?: string | null): FolioOwner | null {
  if (!owners?.length) return null;
  const distinct = new Set(owners.map((o) => o.investorId));
  if (distinct.size === 1) return owners[0];
  const amc = (amcCode ?? "").trim().toUpperCase();
  if (!amc) return null;
  const hit = owners.filter((o) => o.amcCode.trim().toUpperCase() === amc);
  return new Set(hit.map((o) => o.investorId)).size === 1 ? hit[0] : null;
}

/**
 * The client a registrar row belongs to, from its PAN and its folio.
 *
 * PAN wins — except over a MINOR's folio. Registrars often print the
 * guardian's PAN on a minor's rows, so PAN-first moved the minor's
 * transactions and SIPs onto the guardian's record. A folio already mapped to
 * a minor stays the minor's.
 */
export function chooseClient(panClientId: string | null, folioOwner: FolioOwner | null): string | null {
  if (folioOwner?.isMinor && panClientId && panClientId !== folioOwner.investorId) return folioOwner.investorId;
  return panClientId ?? folioOwner?.investorId ?? null;
}

/** A folio row as the SIP-book and AUM paths read it. */
export type FolioCandidate = {
  id: string;
  investor_id: string | null;
  amc_code: string | null;
  amc_name: string | null;
  rta: string | null;
  schemes: Array<{ schemeCode?: string; schemeName?: string }> | null;
};

/**
 * The folio a SIP-register or AUM-statement row is about, when its report
 * names no AMC (CAMS WBR22 / WBR49 carry a product code, not an AMC).
 *
 * One client behind the number → that folio (the registrar's own one first).
 * Several clients → the folio that already holds this scheme, else the one
 * whose AMC code the CAMS product code starts with ("D157" is DSP's, AMC "D").
 * Still more than one → null: the row is held back with a reason rather than
 * written onto whichever client happened to come back first.
 */
export function pickFolioForScheme(
  candidates: FolioCandidate[],
  schemeCode: string,
  schemeName: string,
  source: string,
): { folio: FolioCandidate | null; ambiguous: boolean } {
  if (!candidates.length) return { folio: null, ambiguous: false };
  const owners = (list: FolioCandidate[]) => new Set(list.map((c) => c.investor_id ?? ""));
  const preferSource = (list: FolioCandidate[]) => list.find((c) => c.rta === source) ?? list[0];
  if (owners(candidates).size === 1) return { folio: preferSource(candidates), ambiguous: false };

  const norm = (s?: string) => (s ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
  const code = schemeCode.trim().toUpperCase();
  const name = norm(schemeName);
  const holding = candidates.filter((c) =>
    (c.schemes ?? []).some((s) => (code && (s.schemeCode ?? "").toUpperCase() === code) || (name && norm(s.schemeName) === name)),
  );
  if (holding.length && owners(holding).size === 1) return { folio: preferSource(holding), ambiguous: false };

  const byAmc = candidates.filter((c) => {
    const amc = (c.amc_code ?? "").trim().toUpperCase();
    return !!amc && !!code && code.startsWith(amc);
  });
  if (byAmc.length) {
    // The longest matching AMC code wins ("HLS" before "H").
    const best = Math.max(...byAmc.map((c) => (c.amc_code ?? "").trim().length));
    const top = byAmc.filter((c) => (c.amc_code ?? "").trim().length === best);
    if (owners(top).size === 1) return { folio: preferSource(top), ambiguous: false };
  }
  return { folio: null, ambiguous: true };
}

/**
 * Every folio the firm holds, keyed by folioKey — read ONCE per file. A
 * per-row lookup that ignores case and slashes cannot use an index, and the
 * SIP register runs one lookup per row (4,000+ rows against 15,000 folios).
 */
async function loadFolioIndex(tx: Tx, tenantId: string): Promise<Map<string, FolioCandidate[]>> {
  const r = await tx.execute(sql`
    SELECT id, investor_id, amc_code, amc_name, rta, schemes, folio_number FROM folios
     WHERE tenant_id = ${tenantId}::uuid
     ORDER BY created_at
  `);
  const map = new Map<string, FolioCandidate[]>();
  for (const row of r.rows as Array<FolioCandidate & { folio_number: string }>) {
    const k = folioKey(row.folio_number);
    if (!k) continue;
    const list = map.get(k) ?? [];
    list.push(row);
    map.set(k, list);
  }
  return map;
}

/** The live client to file a row under: PAN first, except over a minor's folio (chooseClient). */
async function clientForRow(tx: Tx, tenantId: string, pan: string | undefined, folioOwnerId: string | null): Promise<string | null> {
  const panId = pan ? await clientIdForPan(tx, tenantId, pan) : null;
  const owner = folioOwnerId ? await liveOf(tx, tenantId, folioOwnerId) : null;
  let ownerIsMinor = false;
  if (owner && panId && owner !== panId) {
    const m = await tx.execute(sql`SELECT is_minor FROM investors WHERE tenant_id = ${tenantId}::uuid AND id = ${owner}::uuid`);
    ownerIsMinor = !!(m.rows[0] as { is_minor?: boolean } | undefined)?.is_minor;
  }
  return chooseClient(panId, owner ? { amcCode: "", investorId: owner, isMinor: ownerIsMinor } : null);
}

/**
 * Bulk-resolve every investor referenced by a feed in TWO queries (by PAN, by
 * existing folio) instead of 1–2 queries per row. Returns lookup maps the row
 * loop consults in memory — the key fix for the per-row N+1 that made large
 * imports time out. `pan = ANY($1::text[])` binds the JS array as a single
 * Postgres array param (the correct pattern; never an `IN (...)` tuple).
 */
async function buildInvestorIndex(
  tx: Tx,
  tenantId: string,
  keys: Array<{ pan?: string; folioNumber?: string; name?: string }>
): Promise<{ panMap: Map<string, string>; folioOwners: Map<string, FolioOwner[]> }> {
  const pans = [...new Set(keys.map((k) => k.pan?.toUpperCase()).filter(Boolean))] as string[];
  const folios = [...new Set(keys.map((k) => k.folioNumber).filter(Boolean))] as string[];
  const panMap = new Map<string, string>();
  const folioOwners = new Map<string, FolioOwner[]>();

  if (pans.length) {
    // The live client per PAN (the firm's Excel-loaded record included, merges
    // followed), and a PAN-less client the firm entered by hand adopted on an
    // unambiguous name — see lib/rta/client-match.ts. Only a real PAN gets a
    // name hint: it is what a new client would be keyed on.
    const hints = new Map<string, ClientHint>();
    for (const k of keys) {
      const p = k.pan?.toUpperCase();
      if (p && isLikelyPan(p) && !hints.has(p)) hints.set(p, { name: splitRepresentedBy(k.name).name });
    }
    const res = await resolvePanClients(tx, tenantId, pans, { write: true, hints });
    for (const [p, id] of res.ids) panMap.set(p, id);
  }
  if (folios.length) {
    // Matched on the folio as the registrar means it (case / spaces / slashes
    // ignored), with every AMC that holds that number — see pickFolioOwner.
    const keysWanted = [...new Set(folios.map(folioKey).filter(Boolean))];
    const res = await tx.execute(sql`
      SELECT f.investor_id, f.folio_number, COALESCE(f.amc_code, '') AS amc_code
        FROM folios f
       WHERE f.tenant_id = ${tenantId}::uuid AND f.investor_id IS NOT NULL
         AND regexp_replace(upper(f.folio_number), '[^A-Z0-9]', '', 'g') = ANY(${pgArray(keysWanted)}::text[])
    `);
    const rows = res.rows as Array<{ investor_id: string; folio_number: string; amc_code: string }>;
    const live = await followMerges(tx, tenantId, [...new Set(rows.map((r) => String(r.investor_id)))]);
    const liveIds = [...new Set(rows.map((r) => live.get(String(r.investor_id)) ?? String(r.investor_id)))];
    const minors = new Set<string>();
    if (liveIds.length) {
      const m = await tx.execute(sql`
        SELECT id FROM investors WHERE tenant_id = ${tenantId}::uuid AND is_minor AND id = ANY(${pgArray(liveIds)}::uuid[])
      `);
      for (const r of m.rows as Array<{ id: string }>) minors.add(String(r.id));
    }
    for (const r of rows) {
      const id = live.get(String(r.investor_id)) ?? String(r.investor_id);
      const k = folioKey(r.folio_number);
      const list = folioOwners.get(k) ?? [];
      list.push({ amcCode: r.amc_code, investorId: id, isMinor: minors.has(id) });
      folioOwners.set(k, list);
    }
  }
  return { panMap, folioOwners };
}

export type ProcessOutcome = {
  rowsTotal: number;
  rowsImported: number;
  rowsSkipped: number;
  rowsFailed: number;
  errors: Array<{ row: number; reason: string }>;
  periodStart: string;
  periodEnd: string;
};

/**
 * Top-level entry point. Dispatches by file kind.
 */
async function processRtaFileUnsafe(
  tx: Tx,
  args: { tenantId: string; source: RtaSource; kind: RtaFileKind; text: string; importId?: string }
): Promise<ProcessOutcome> {
  // Large RTA files (100k+ rows) processed in one transaction can exceed the
  // 30s pool statement_timeout. Lift it for this import transaction only.
  await tx.execute(sql`SET LOCAL statement_timeout = '600s'`);
  switch (args.kind) {
    case "daily_transaction_feed":
    case "redemption_report":
      return processTransactionFeed(tx, args);
    case "sip_rejection_report":
      return processSipRejectionReport(tx, args);
    case "monthly_brokerage":
      return processBrokerageStatement(tx, args);
    case "folio_master_dump":
    case "cas_holdings":
      return processFolioMasterDump(tx, args);
    case "monthly_sip_book":
      return processSipBook(tx, args);
    case "nach_mandate_status":
      return processMandateStatus(tx, args);
    case "monthly_aum_statement":
      return processAumStatement(tx, args);
    // The rest fall through to a generic "store but don't parse"
    default:
      return {
        rowsTotal: 0,
        rowsImported: 0,
        rowsSkipped: 0,
        rowsFailed: 0,
        errors: [],
        periodStart: today(),
        periodEnd: today(),
      };
  }
}

// ── Transaction feed (daily) ─────────────────────────────────────────────

async function processTransactionFeed(
  tx: Tx,
  args: { tenantId: string; source: RtaSource; text: string; importId?: string }
): Promise<ProcessOutcome> {
  const rows: CanonicalTransaction[] =
    args.source === "kfintech"
      ? parseKfintechFeed(args.text)
      : parseCamsFeed(args.text);

  const errors: Array<{ row: number; reason: string }> = [];
  let imported = 0;
  let skipped = 0;
  let failed = 0;
  /** Clients stood up from the feed because their folio master hasn't arrived. */
  let createdInvestors = 0;
  let minDate = "9999-12-31";
  let maxDate = "0000-01-01";
  // Newest processed order_date per investor → bump last_transaction_at so
  // dormancy / health / churn reflect the freshly-ingested feed.
  const lastTxByInvestor = new Map<string, string>();

  // Large feeds can have 100k+ rows. A per-row investor lookup (the old N+1)
  // plus the 30s pool statement_timeout made big imports abort + roll back.
  //   1. Lift the timeout for THIS import transaction only.
  //   2. Resolve every investor up front in two bulk queries (by PAN, by folio)
  //      into in-memory maps — the loop then does zero resolution round-trips.
  const { panMap, folioOwners } = await buildInvestorIndex(
    tx,
    args.tenantId,
    rows.map((r) => ({ pan: r.pan, folioNumber: r.folioNumber, name: r.investorName }))
  );
  const resolveFast = (pan?: string, folio?: string, amc?: string): string | null =>
    chooseClient((pan && panMap.get(pan.toUpperCase())) || null, pickFolioOwner(folioOwners.get(folioKey(folio)), amc));
  /** Several AMCs hold this folio number and none is the row's: never guess. */
  const ambiguousFolio = (folio: string, amc?: string): boolean => {
    const owners = folioOwners.get(folioKey(folio));
    return !!owners && new Set(owners.map((o) => o.investorId)).size > 1 && !pickFolioOwner(owners, amc);
  };
  const rememberFolio = (folio: string, amc: string, investorId: string) => {
    const k = folioKey(folio);
    const list = folioOwners.get(k) ?? [];
    if (!list.some((o) => o.investorId === investorId && o.amcCode === amc)) list.push({ amcCode: amc, investorId, isMinor: false });
    folioOwners.set(k, list);
  };
  let reversals = 0;
  let reversalsMatched = 0;
  let collisions = 0;

  /**
   * (amc_code, folio_number) -> folios.id, resolved at most ONCE per folio.
   *
   * These feeds carry many rows per folio — a since-inception CAMS WBR2 for one
   * firm was 512,916 rows over a few thousand folios — and this loop used to run
   * an `INSERT ... ON CONFLICT ... RETURNING id` for every single row. That is a
   * round-trip per row on top of the transaction insert and the per-row
   * SAVEPOINT, which is why one file took hours and blocked every other firm's
   * imports behind it.
   *
   * Caching changes one thing: `updated_at` on an existing folio is now bumped
   * once per import rather than once per row. Nothing reads it at row
   * granularity, and the folio's real freshness is its valuation, not this.
   */
  const folioIdCache = new Map<string, string>();

  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    if (!r.folioNumber) {
      // Record the reason. A bare counter left "partial · 162 skip" with an
      // empty errors array, which is unactionable — the same silence that hid
      // the SIP-register PAN gap.
      skipped++;
      {
        errors.push({ row: i + 1, reason: "row carries no folio number — a transaction cannot be attached without one" });
      }
      continue;
    }
    if (r.orderDate < minDate) minDate = r.orderDate;
    if (r.orderDate > maxDate) maxDate = r.orderDate;

    // Resolve from the pre-built maps (no per-row query). PAN first, then folio.
    let investorId = resolveFast(r.pan, r.folioNumber, r.amcCode);
    if (!investorId && !(r.pan && isLikelyPan(r.pan)) && ambiguousFolio(r.folioNumber, r.amcCode)) {
      skipped++;
      errors.push({
        row: i + 1,
        reason: `Folio ${r.folioNumber} is held at more than one AMC in this book and the row's AMC (${r.amcCode || "blank"}) matches none — not attached`,
      });
      continue;
    }
    // A minor's row printed with the GUARDIAN's PAN ("KAVYAAN GOEL REP BY
    // GAURAV GOEL" + Gaurav's PAN) must not stand up a client called Kavyaan
    // keyed on Gaurav's PAN — the guardian's own record would then be that
    // minor. Such a row falls through to the name-keyed path below.
    const representedMinor = splitRepresentedBy(r.investorName).isMinor;

    // Not in the book yet. If the row carries a valid PAN we can stand the
    // client up from the feed itself rather than dropping the transaction:
    // the feed gives us PAN + name, and investors are PAN-deduped, so when the
    // folio master finally lands it UPDATES this row instead of duplicating it.
    //
    // Without a PAN we must still skip. A PAN-less provisional row would be
    // keyed on nothing the master can match, so the master would create a
    // SECOND client for the same person — worse than losing the row.
    //
    // VSN Financial Services: one KFintech feed skipped 1,849 rows this way,
    // 1,617 of which carried a PAN and are recoverable here.
    if (!investorId && isLikelyPan(r.pan) && !representedMinor) {
      const created = await tx.execute(sql`
        INSERT INTO investors (tenant_id, pan, name, investor_category, kyc_status)
        VALUES (
          ${args.tenantId}::uuid, ${r.pan.toUpperCase()},
          ${sanitizeName(r.investorName) ?? `PAN ${r.pan.toUpperCase()}`},
          'individual', 'pending'
        )
        ON CONFLICT (tenant_id, pan) WHERE dedup_pan AND pan IS NOT NULL
        DO UPDATE SET updated_at = now()
        RETURNING id
      `);
      investorId = (created.rows[0] as any)?.id ?? null;
      if (investorId) {
        // Feed the maps so the other rows for this client resolve without a
        // second insert — these feeds carry many rows per folio.
        panMap.set(r.pan.toUpperCase(), investorId);
        rememberFolio(r.folioNumber, r.amcCode, investorId);
        createdInvestors++;
      }
    }

    // Still nothing, so the row has no usable PAN AND its folio is not in the
    // book. Stand the client up keyed on the FOLIO rather than dropping the
    // transaction.
    //
    // The older reasoning here was that a PAN-less provisional row "is keyed on
    // nothing the master can match". That is not true: migration 0151 added
    // investors.rta_nopan_key with a unique index precisely so a PAN-less client
    // can be deduped deterministically, and the folio number is a stronger
    // natural key than the mobile/email/name the rich importer settles for. Its
    // real cost is narrower — if the master later arrives WITH a PAN it creates
    // a PAN-keyed client and the folio upsert re-points to it, leaving this
    // provisional row orphaned and mergeable. Losing the transaction outright is
    // worse: on VSN Financial Services these skips ran to ~104-232 rows per
    // feed, every one of them real money against a real folio.
    if (!investorId && r.folioNumber) {
      const who = splitRepresentedBy(r.investorName);
      const created = await tx.execute(sql`
        INSERT INTO investors (tenant_id, pan, rta_nopan_key, name, investor_category, is_minor, kyc_status)
        VALUES (
          ${args.tenantId}::uuid, NULL, ${nopanKeyFor(who.name, r.folioNumber)},
          ${who.name ?? `Folio ${r.folioNumber}`},
          ${who.isMinor ? "minor" : "individual"}, ${who.isMinor}, 'pending'
        )
        ON CONFLICT (tenant_id, rta_nopan_key) WHERE rta_nopan_key IS NOT NULL
        DO UPDATE SET updated_at = now()
        RETURNING id
      `);
      investorId = await liveOf(tx, args.tenantId, (created.rows[0] as any)?.id ?? null);
      if (investorId) {
        rememberFolio(r.folioNumber, r.amcCode, investorId);
        createdInvestors++;
      }
    }

    if (!investorId) {
      skipped++;
      errors.push({ row: i + 1, reason: `Folio ${r.folioNumber}${r.pan ? ` / PAN ${r.pan}` : ""} could not be attached to a client` });
      continue;
    }

    const rtaEnumVal = (args.source === "cams" || args.source === "kfintech") ? args.source : "other";

    // Declared outside the try: if this row rolls back, the cache entry it
    // created has to be evicted too (see the catch).
    const folioCacheKey = `${r.amcCode}::${r.folioNumber}`;
    let cachedFolioThisRow = false;

    await tx.execute(sql`SAVEPOINT rta_item`);
    try {
      // Resolve or create folio record — once per folio, not once per row.
      let folioId = folioIdCache.get(folioCacheKey);
      if (!folioId) {
        const folioRes = await tx.execute(sql`
          INSERT INTO folios (tenant_id, investor_id, folio_number, amc_code, amc_name, rta)
          VALUES (${args.tenantId}::uuid, ${investorId}::uuid, ${r.folioNumber}, ${r.amcCode}, ${r.amcCode}, ${rtaEnumVal})
          ON CONFLICT (tenant_id, amc_code, folio_number) DO UPDATE SET updated_at = now()
          RETURNING id
        `);
        folioId = (folioRes.rows[0] as any)?.id;
        if (folioId) {
          folioIdCache.set(folioCacheKey, folioId);
          cachedFolioThisRow = true;
        }
      }

      // UPSERT keyed by (tenant_id, order_id) so re-uploads no-op, but updates
      // status/NAV/units — ONLY when the stored row is the same folio.
      //
      // A registrar's transaction number is unique within ONE AMC, not across
      // the firm: CAMS numbers each AMC's transactions separately. Keyed on the
      // bare number, a second AMC's transaction with the same number landed on
      // the first one and REWROTE its folio, units and status while keeping its
      // amount, client and scheme — and the second transaction was never
      // stored. Found 29 Oct 2026: 6,508 transactions pointing at another
      // folio, 4,740 of them another client's (Sandeep Garg Rs 20.56 Cr, Ahpal
      // Rs 9.42 Cr). Now a number already taken by a different folio is stored
      // under `<number>@<folio>`, which is just as deterministic, so a re-import
      // of either file still lands on its own row.
      const status = r.isReversal ? "cancelled" : normaliseStatus(r.status);
      const reasonCode = r.isReversal ? "REVERSAL" : r.reasonCode ?? null;
      const reasonDescription = r.isReversal ? "Reversal of an earlier transaction (registrar)" : r.reasonDescription ?? null;
      const rawRow = JSON.stringify({ ...(r.raw ?? {}), ref: r.externalRef });
      const fk = folioKey(r.folioNumber);
      const upsert = (orderId: string) => tx.execute(sql`
        INSERT INTO transactions (
          tenant_id, investor_id, folio_id, folio_number, amc_code, amc_name, scheme_code, scheme_name,
          type, direction, amount, units, nav, order_id, order_date, status,
          reason_code, reason_description, source_feed, rta_import_id, raw_feed_row
        ) VALUES (
          ${args.tenantId}::uuid, ${investorId}::uuid, ${folioId}::uuid, ${r.folioNumber}, ${r.amcCode}, ${r.amcCode},
          ${r.schemeCode}, ${r.schemeName}, ${r.type}, ${r.direction},
          ${r.amount}, ${r.units}, ${r.nav}, ${orderId}, ${r.orderDate}::date,
          ${status}, ${reasonCode}, ${reasonDescription}, ${rtaEnumVal === "other" ? null : rtaEnumVal},
          ${args.importId ?? null}::uuid, ${rawRow}::jsonb
        )
        ON CONFLICT (tenant_id, order_id) WHERE order_id IS NOT NULL DO UPDATE SET
          folio_id = EXCLUDED.folio_id,
          direction = EXCLUDED.direction,
          -- A transaction a later reversal cancelled stays cancelled when its
          -- own file is re-read.
          status = CASE WHEN transactions.reason_code = 'REVERSED' THEN transactions.status ELSE EXCLUDED.status END,
          nav = EXCLUDED.nav,
          units = EXCLUDED.units,
          reason_code = CASE WHEN transactions.reason_code = 'REVERSED' THEN transactions.reason_code ELSE EXCLUDED.reason_code END,
          reason_description = CASE WHEN transactions.reason_code = 'REVERSED' THEN transactions.reason_description ELSE EXCLUDED.reason_description END,
          source_feed = COALESCE(transactions.source_feed, EXCLUDED.source_feed),
          rta_import_id = EXCLUDED.rta_import_id,
          raw_feed_row = EXCLUDED.raw_feed_row,
          updated_at = now()
        WHERE regexp_replace(upper(COALESCE(transactions.folio_number, '')), '[^A-Z0-9]', '', 'g') = ${fk}
        RETURNING id, (xmax = 0) AS inserted
      `);
      let res = await upsert(r.externalRef);
      if (!res.rows.length) {
        collisions++;
        res = await upsert(`${r.externalRef}@${fk}`);
      }
      const written = res.rows[0] as { id: string; inserted: boolean } | undefined;
      if (!written) throw new Error(`transaction ${r.externalRef} is already recorded against another folio`);

      // A reversal cancels the transaction it reverses: the latest processed
      // one in the same folio and scheme with the same units and amount, in the
      // 120 days before it. Only on first sight, so re-reading the file can
      // never cancel a second, genuine purchase of the same size.
      if (r.isReversal && written.inserted) {
        reversals++;
        const hit = await tx.execute(sql`
          UPDATE transactions o
             SET status = 'cancelled', reason_code = 'REVERSED',
                 reason_description = ${`Reversed by the registrar (${r.externalRef})`}, updated_at = now()
           WHERE o.id = (
             SELECT c.id FROM transactions c
              WHERE c.tenant_id = ${args.tenantId}::uuid
                AND c.id <> ${written.id}::uuid
                AND c.status IN ('processed', 'successful')
                AND COALESCE(c.reason_code, '') NOT IN ('REVERSAL', 'REVERSED')
                AND c.type = ${r.type}
                AND regexp_replace(upper(COALESCE(c.folio_number, '')), '[^A-Z0-9]', '', 'g') = ${fk}
                AND (c.scheme_code = ${r.schemeCode} OR (${r.schemeCode} = '' AND c.scheme_name = ${r.schemeName}))
                AND abs(abs(COALESCE(c.units, 0)) - ${Math.abs(r.units)}::numeric) <= 0.001
                AND abs(c.amount - ${r.amount}::numeric) <= 1
                AND c.order_date BETWEEN ${r.orderDate}::date - 120 AND ${r.orderDate}::date
              ORDER BY c.order_date DESC
              LIMIT 1)
          RETURNING o.id
        `);
        if (hit.rows.length) reversalsMatched++;
      }

      imported++;
      if (status === "processed") {
        const prev = lastTxByInvestor.get(investorId);
        if (!prev || r.orderDate > prev) lastTxByInvestor.set(investorId, r.orderDate);
      }
      await tx.execute(sql`RELEASE SAVEPOINT rta_item`);
    } catch (e: any) {
      await tx.execute(sql`ROLLBACK TO SAVEPOINT rta_item`);
      await tx.execute(sql`RELEASE SAVEPOINT rta_item`);
      // The rollback undid the folio this row inserted, so the id we cached no
      // longer exists. Leaving it would make every later row for the same folio
      // write a transaction pointing at a dead folio_id and fail on the foreign
      // key — turning one bad row into a bad folio.
      if (cachedFolioThisRow) folioIdCache.delete(folioCacheKey);
      failed++;
      errors.push({ row: i + 1, reason: e.message ?? "insert failed" });
    }
  }

  // Not errors — said so the import shows what it decided.
  if (reversals > 0) {
    errors.push({
      row: 0,
      reason: `${reversals} reversal(s) recorded as cancelled; ${reversalsMatched} of them cancelled the transaction they reverse`,
    });
  }
  if (collisions > 0) {
    errors.push({
      row: 0,
      reason: `${collisions} transaction number(s) were already used by another folio (another AMC's numbering) — stored separately instead of overwriting`,
    });
  }

  // Bump last_transaction_at (forward only) for each affected investor.
  for (const [investorId, maxOrderDate] of lastTxByInvestor) {
    await tx.execute(sql`
      UPDATE investors
         SET last_transaction_at = GREATEST(COALESCE(last_transaction_at, 'epoch'::timestamptz), ${maxOrderDate}::timestamptz),
             updated_at = now()
       WHERE id = ${investorId}::uuid
    `);
  }

  return {
    rowsTotal: rows.length,
    rowsImported: imported,
    rowsSkipped: skipped,
    rowsFailed: failed,
    errors,
    periodStart: minDate === "9999-12-31" ? today() : minDate,
    periodEnd: maxDate === "0000-01-01" ? today() : maxDate,
  };
}

// ── SIP rejection report (daily) ─────────────────────────────────────────

async function processSipRejectionReport(
  tx: Tx,
  args: { tenantId: string; source: RtaSource; text: string }
): Promise<ProcessOutcome> {
  const rows: CanonicalSipRejection[] = parseSipRejectionReport(args.text, args.source);
  const errors: Array<{ row: number; reason: string }> = [];
  let imported = 0;
  let skipped = 0;
  let failed = 0;
  let minDate = "9999-12-31";
  let maxDate = "0000-01-01";

  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    if (r.rejectionDate < minDate) minDate = r.rejectionDate;
    if (r.rejectionDate > maxDate) maxDate = r.rejectionDate;

    const investorId = await resolveInvestorId(tx, args.tenantId, { pan: r.pan, folioNumber: r.folioNumber });
    if (!investorId) {
      skipped++;
      errors.push({ row: i + 1, reason: `${r.pan ? `PAN ${r.pan}` : `Folio ${r.folioNumber}`} not in client master` });
      continue;
    }
    const rmRes = await tx.execute(sql`SELECT rm_id FROM investors WHERE id = ${investorId}::uuid LIMIT 1`);
    const investorRmId = (rmRes.rows[0] as any)?.rm_id ?? null;

    const reasonCode = classifyRejectionReason(r.reason, r.reasonCode);
    // 2-day follow-up from the rejection date — mirrors the manual create API so
    // imported rejections land in the tracker with an RM owner + an SLA clock,
    // not a blank "RM" column. The `transaction.failed.sip_rejection` event
    // (emitted below) still drives task/WhatsApp via the recipe — we don't
    // double-create a task here.
    const followUp = new Date(new Date(r.rejectionDate).getTime() + 2 * 864e5)
      .toISOString()
      .slice(0, 10);
    // The rejection is the same event whoever its client record is now, so the
    // client is NOT part of its identity. It used to be: after a merge (or a
    // folio moved to the right client) the same rejection hashed differently,
    // was inserted again and re-fired the follow-up, so the client got the
    // "your SIP bounced" message twice. The NOT EXISTS keeps rows written under
    // the old key from being duplicated by the new one.
    const dedupKey = naturalKeyHash(["v2", r.folioNumber, r.rejectionDate, r.amount, r.schemeName]);
    await tx.execute(sql`SAVEPOINT rta_item`);
    try {
      const ins = await tx.execute(sql`
        INSERT INTO sip_rejections (
          tenant_id, investor_id, rejection_date, rejection_amount,
          rejection_reason, scheme_name, folio_number, amc_name, recovery_status,
          assigned_rm_id, follow_up_date, reason_category, dedup_key
        )
        SELECT
          ${args.tenantId}::uuid, ${investorId}::uuid, ${r.rejectionDate}::date,
          ${r.amount}, ${r.reason}, ${r.schemeName}, ${r.folioNumber}, ${r.amcName}, 'pending',
          ${investorRmId}, ${followUp}::date, ${reasonCode}, ${dedupKey}
        WHERE NOT EXISTS (
          SELECT 1 FROM sip_rejections x
           WHERE x.tenant_id = ${args.tenantId}::uuid
             AND x.folio_number = ${r.folioNumber}
             AND x.rejection_date = ${r.rejectionDate}::date
             AND x.rejection_amount = ${r.amount}::numeric
             AND COALESCE(x.scheme_name, '') = ${r.schemeName ?? ""}
        )
        ON CONFLICT (tenant_id, dedup_key) DO NOTHING
        RETURNING id
      `);
      if ((ins as any).rows.length > 0) {
        imported++;
        // Emit the event the sip_rejection_followup recipe subscribes to — the
        // canonical rejection report previously produced NO automation event.
        // Only on a real insert, so re-uploads (ON CONFLICT) never re-fire.
        await tx.execute(sql`
          INSERT INTO events_outbox (tenant_id, kind, entity_type, entity_id, after, meta)
          VALUES (
            ${args.tenantId}::uuid, 'transaction.failed.sip_rejection', 'investor', ${investorId}::uuid,
            ${JSON.stringify({
              reason_code: reasonCode,
              reason: r.reason,
              scheme_name: r.schemeName,
              amount: r.amount,
              order_date: r.rejectionDate,
            })}::jsonb,
            ${JSON.stringify({ source: "rta-import", dedupKey })}::jsonb
          )
        `);
      } else {
        skipped++; // already imported — idempotent
      }
      await tx.execute(sql`RELEASE SAVEPOINT rta_item`);
    } catch (e: any) {
      await tx.execute(sql`ROLLBACK TO SAVEPOINT rta_item`);
      await tx.execute(sql`RELEASE SAVEPOINT rta_item`);
      failed++;
      errors.push({ row: i + 1, reason: e.message ?? "insert failed" });
    }
  }

  return {
    rowsTotal: rows.length,
    rowsImported: imported,
    rowsSkipped: skipped,
    rowsFailed: failed,
    errors,
    periodStart: minDate === "9999-12-31" ? today() : minDate,
    periodEnd: maxDate === "0000-01-01" ? today() : maxDate,
  };
}

// ── Monthly brokerage statement ──────────────────────────────────────────

async function processBrokerageStatement(
  tx: Tx,
  args: { tenantId: string; source: RtaSource; text: string }
): Promise<ProcessOutcome> {
  const rows: CanonicalBrokerageRow[] = parseBrokerageStatement(args.text, args.source);
  const errors: Array<{ row: number; reason: string }> = [];
  let imported = 0;
  let skipped = 0;
  let failed = 0;
  let minDate = "9999-12-31";
  let maxDate = "0000-01-01";

  // Brokerage flows into commission_rows (already exists). If commission
  // schema isn't available we degrade gracefully.
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    if (r.periodStart < minDate) minDate = r.periodStart;
    if (r.periodEnd > maxDate) maxDate = r.periodEnd;

    await tx.execute(sql`SAVEPOINT rta_item`);
    try {
      await tx.execute(sql`
        INSERT INTO commission_rows (
          tenant_id, amc_code, scheme_code, scheme_name, folio_number,
          pan, brokerage_type, period_start, period_end,
          aum_amount, brokerage_rate, brokerage_amount, source
        ) VALUES (
          ${args.tenantId}::uuid, ${r.amcCode}, ${r.schemeCode}, ${r.schemeName}, ${r.folioNumber},
          ${r.pan.toUpperCase()}, ${r.brokerageType}, ${r.periodStart}::date, ${r.periodEnd}::date,
          ${r.aumAmount}, ${r.brokerageRate}, ${r.brokerageAmount}, ${args.source}
        )
        ON CONFLICT DO NOTHING
      `);
      imported++;
      await tx.execute(sql`RELEASE SAVEPOINT rta_item`);
    } catch (e: any) {
      await tx.execute(sql`ROLLBACK TO SAVEPOINT rta_item`);
      await tx.execute(sql`RELEASE SAVEPOINT rta_item`);
      // Table may not exist yet on some envs — soft-skip.
      if (e.message?.includes("does not exist")) {
        skipped++;
      } else {
        failed++;
        errors.push({ row: i + 1, reason: e.message ?? "insert failed" });
      }
    }
  }

  return {
    rowsTotal: rows.length,
    rowsImported: imported,
    rowsSkipped: skipped,
    rowsFailed: failed,
    errors,
    periodStart: minDate === "9999-12-31" ? today() : minDate,
    periodEnd: maxDate === "0000-01-01" ? today() : maxDate,
  };
}

// ── Helpers ───────────────────────────────────────────────────────────────

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

/** CAMS feed status → our canonical transactions.status enum. */
function normaliseStatus(s: string): string {
  switch (s) {
    case "successful":
      return "processed";
    case "rejected":
    case "failed":
      return "rejected"; // canonical (a NACH bounce is a rejection)
    case "pending":
      return "pending";
    default:
      return "pending";
  }
}

/** Classify a free-text / coded rejection reason into the slugs the
 *  sip_rejection_followup recipe branches on (insufficient_balance /
 *  mandate_expired / technical). */
function classifyRejectionReason(reason: string, reasonCode?: string): string {
  const r = `${reason ?? ""} ${reasonCode ?? ""}`.toLowerCase();
  if (/insufficient|balance|funds|nsf|inqufd/.test(r)) return "insufficient_balance";
  if (/mandate|expired|umrn|nach|debit not|not registered/.test(r)) return "mandate_expired";
  return "technical";
}

/** Deterministic idempotency hash of a row's natural key. */
function naturalKeyHash(parts: Array<string | number | null | undefined>): string {
  return "nk:" + createHash("sha256").update(parts.map((p) => String(p ?? "")).join("|")).digest("hex").slice(0, 40);
}

// ── Additional kind handlers ─────────────────────────────────────────────

async function processFolioMasterDump(
  tx: Tx,
  args: { tenantId: string; source: RtaSource; text: string }
): Promise<ProcessOutcome> {
  const rows: CanonicalFolioRow[] = parseFolioMasterDump(args.text, args.source);

  const errors: Array<{ row: number; reason: string }> = [];
  let imported = 0;
  let skipped = 0;
  let failed = 0;

  // Group rows by folio number and amc code to do batch updates of the schemes array
  const folioRowsGrouped = new Map<string, CanonicalFolioRow[]>();
  for (const r of rows) {
    if (!r.pan || !r.folioNumber || !r.amcCode) {
      skipped++;
      continue;
    }
    const key = `${r.amcCode}__${r.folioNumber}`;
    if (!folioRowsGrouped.has(key)) {
      folioRowsGrouped.set(key, []);
    }
    folioRowsGrouped.get(key)!.push(r);
  }

  const rtaEnumVal = (args.source === "cams" || args.source === "kfintech") ? args.source : "other";

  for (const [key, fRows] of folioRowsGrouped) {
    const firstRow = fRows[0];
    const investorId = await clientIdForPan(tx, args.tenantId, firstRow.pan);
    if (!investorId) {
      skipped += fRows.length;
      errors.push({ row: rows.indexOf(firstRow) + 1, reason: `PAN ${firstRow.pan} not in client master — skipped` });
      continue;
    }

    await tx.execute(sql`SAVEPOINT rta_item`);
    try {
      // Find or create folio
      const folioRes = await tx.execute(sql`
        INSERT INTO folios (tenant_id, investor_id, folio_number, amc_code, amc_name, rta)
        VALUES (${args.tenantId}::uuid, ${investorId}::uuid, ${firstRow.folioNumber}, ${firstRow.amcCode}, ${firstRow.amcName}, ${rtaEnumVal})
        ON CONFLICT (tenant_id, amc_code, folio_number) DO UPDATE SET updated_at = now()
        RETURNING id, schemes
      `);
      const folioId = (folioRes.rows[0] as any)?.id;
      const existingSchemes = ((folioRes.rows[0] as any)?.schemes ?? []) as Array<{
        schemeCode: string;
        schemeName: string;
        category?: string;
        units?: number;
        nav?: number;
        value?: number;
      }>;

      // Merge new schemes with existing schemes
      const schemesMap = new Map<string, typeof existingSchemes[number]>();
      for (const s of existingSchemes) {
        if (s.schemeCode) schemesMap.set(s.schemeCode, s);
      }

      for (const r of fRows) {
        if (!r.schemeCode) continue;
        const current = schemesMap.get(r.schemeCode);
        schemesMap.set(r.schemeCode, {
          schemeCode: r.schemeCode,
          schemeName: r.schemeName || current?.schemeName || "",
          units: r.units,
          nav: current?.nav,
          value: current?.nav ? Math.round(r.units * current.nav * 100) / 100 : r.value || current?.value,
        });
      }

      const mergedSchemes = Array.from(schemesMap.values());
      const roundedAum = mergedSchemes.reduce((acc, s) => acc + (s.value ?? 0), 0);

      await tx.execute(sql`
        UPDATE folios
        SET schemes = ${JSON.stringify(mergedSchemes)}::jsonb,
            aum = ${roundedAum}::numeric,
            updated_at = now()
        WHERE id = ${folioId}::uuid
      `);

      imported += fRows.length;
      await tx.execute(sql`RELEASE SAVEPOINT rta_item`);
    } catch (e: any) {
      await tx.execute(sql`ROLLBACK TO SAVEPOINT rta_item`);
      await tx.execute(sql`RELEASE SAVEPOINT rta_item`);
      failed += fRows.length;
      errors.push({ row: rows.indexOf(firstRow) + 1, reason: e.message ?? "folio master import failed" });
    }
  }

  await tx.execute(sql`SAVEPOINT rta_refresh`);
  try {
    const { revalueAllFolios, recomputeCombinedAum } = await import("@/lib/finance/aum-persist");
    await revalueAllFolios(tx);
    // Roll the (just-imported) folio holdings up to investors.aum so the client
    // profile headline reflects them — combined with transaction-derived value
    // for any scheme the folios don't cover. Without this, a holdings-only book
    // (RTA folio-master / AUM import, no transaction feed) shows ₹0 AUM.
    await recomputeCombinedAum(tx);
    await tx.execute(sql`RELEASE SAVEPOINT rta_refresh`);
  } catch (err: any) {
    await tx.execute(sql`ROLLBACK TO SAVEPOINT rta_refresh`);
    await tx.execute(sql`RELEASE SAVEPOINT rta_refresh`);
    // Surface (don't swallow) — investor-level AUM is now stale; record it so
    // the import shows partial rather than a misleading clean "completed".
    console.error("[processFolioMasterDump] revalueAllFolios failed:", err);
    errors.push({ row: 0, reason: `Folio values imported but investor AUM revaluation failed: ${err?.message ?? err}` });
    failed++;
  }

  return {
    rowsTotal: rows.length,
    rowsImported: imported,
    rowsSkipped: skipped,
    rowsFailed: failed,
    errors,
    periodStart: today(),
    periodEnd: today(),
  };
}

async function processSipBook(
  tx: Tx,
  args: { tenantId: string; source: RtaSource; text: string }
): Promise<ProcessOutcome> {
  const rows: CanonicalSipRow[] = parseSipBook(args.text, args.source);
  const errors: Array<{ row: number; reason: string }> = [];
  let imported = 0;
  let skipped = 0;
  let failed = 0;

  // An unrecognised amount column is INVISIBLE without this. The header lookup
  // returns only the columns it matched, so an unknown spelling leaves the field
  // undefined, every row parses to 0, and the import still reports success —
  // which is how one firm ended up with 5,767 active SIPs worth Rs 0 and no
  // error to explain it. A whole book at zero is never a real SIP register, so
  // say so on the row where someone will actually see it.
  if (rows.length > 0 && rows.every((r) => !r.amount)) {
    const header = (args.text.split(/\r?\n/)[0] ?? "").slice(0, 300);
    errors.push({
      row: 1,
      reason:
        `every one of the ${rows.length} rows parsed to amount 0 — the instalment-amount column in this file ` +
        `was not recognised, so no amount was read. Header: ${header}`,
    });
  }

  // India's today, for reading the registration's dates.
  const todayIst = new Date(Date.now() + 5.5 * 36e5).toISOString().slice(0, 10);
  /** Every folio in the book, loaded on the first row that needs it. */
  let folioIndex: Map<string, FolioCandidate[]> | undefined;

  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];

    // A registration report is not only live SIPs. It also lists STPs and
    // SWPs (not SIPs at all) and registrations that were CANCELLED — CAMS gives
    // those a CEASE_DATE — and all of them used to import as 'active'.
    //
    // A past END date is deliberately NOT treated the same way: a SIP extended
    // at the AMC keeps collecting under its original end date (see
    // completeExpiredSips in lib/finance/sip-lifecycle.ts, which closes those
    // only on evidence that the instalments stopped). A cease date IS that
    // evidence.
    // Only a purchase registration is a SIP. CAMS WBR49 codes AUT_TRNTYP:
    //   P   SIP (systematic purchase)      SO  STP out (switch to a target)
    //   DTP dividend transfer plan         R   SWP (systematic redemption)
    // and only a transfer has a TARGET scheme. On Nimesh C Shah's 7 Oct file
    // the SO rows alone were Rs 68.56 L a month — they had all come in as SIPs.
    const regType = (r.registrationType ?? "").trim();
    const isSipType = !regType || /^(p|sip|isip|xsip|csip|micro ?sip|purchase|systematic purchase)$/i.test(regType);
    if (!isSipType || r.targetScheme) {
      // An earlier import may have stored it as a SIP: take that copy out of
      // the book, so re-importing the report also cleans up after itself.
      if (r.folioNumber && (r.schemeCode || r.schemeName)) {
        await tx.execute(sql`
          UPDATE sips SET status = 'stopped', remarks = ${NOT_A_SIP_REMARK}, updated_at = now()
           WHERE tenant_id = ${args.tenantId}::uuid AND folio_number = ${r.folioNumber} AND status = 'active'
             AND (scheme_code = ${r.schemeCode || r.schemeName}
                  OR lower(regexp_replace(COALESCE(scheme_name, ''), '[^a-zA-Z0-9]', '', 'g'))
                   = lower(regexp_replace(${r.schemeName || r.schemeCode}, '[^a-zA-Z0-9]', '', 'g')))
        `);
      }
      skipped++;
      continue;
    }
    // What the registrar says (KFintech's Status column, a CAMS cease date and
    // remark) is recorded as a LABEL the SIP book shows — never acted on: the
    // firm's decision of 9 Oct 2026 (Attitude Financial). Only a CAMS cease
    // date stops a SIP, as before (lib/rta/sip-registrar-status).
    const reg = registrarSipState(r, args.source, todayIst);
    const sipStatus: "active" | "stopped" = r.ceaseDate && r.ceaseDate <= todayIst ? "stopped" : "active";

    // The folio + scheme are what actually key a SIP. PAN is NOT required:
    // KFintech leaves the PAN column blank on a real minority of rows (minor
    // folios, older registrations), and every one of those was being dropped
    // — silently, because this branch recorded no reason. Measured on one VSN
    // batch: 213 of 5,699 rows, all with a valid folio and scheme, all with an
    // empty PAN, and an empty `errors` array to explain it.
    if (!r.folioNumber || !r.schemeCode) {
      skipped++;
      errors.push({
        row: i + 1,
        reason: `row carries no ${!r.folioNumber ? "folio number" : "scheme"} — a SIP cannot be keyed without it`,
      });
      continue;
    }

    // Resolve the folio FIRST: it carries the investor link, so it can identify
    // the client even when the registrar omitted the PAN.
    // Every folio holding this number — folio numbers repeat across AMCs, and
    // the old `LIMIT 1` filed the SIP under whichever came back first.
    folioIndex ??= await loadFolioIndex(tx, args.tenantId);
    const picked = pickFolioForScheme(folioIndex.get(folioKey(r.folioNumber)) ?? [], r.schemeCode, r.schemeName, args.source);
    const folioId = picked.folio?.id;
    const amcName = picked.folio?.amc_name || "Unknown AMC";
    const folioInvestorId = picked.folio?.investor_id ?? null;
    if (!folioId) {
      skipped++;
      errors.push({
        row: i + 1,
        reason: picked.ambiguous
          ? `Folio ${r.folioNumber} is held at more than one AMC by different clients and this row does not say which — not filed`
          : `Folio ${r.folioNumber} not found — import the folio master first`,
      });
      continue;
    }

    // PAN wins when the registrar supplies one (it is the platform's dedup key)
    // — except over a minor's folio, whose rows carry the guardian's PAN —
    // otherwise fall back to whoever owns the folio.
    let investorId: string | null = null;
    let rmId: string | null = null;
    const chosen = await clientForRow(tx, args.tenantId, r.pan || undefined, folioInvestorId ? String(folioInvestorId) : null);
    if (chosen) {
      const who = await tx.execute(sql`
        SELECT id, rm_id FROM investors WHERE tenant_id = ${args.tenantId}::uuid AND id = ${chosen}::uuid LIMIT 1
      `);
      investorId = (who.rows[0] as any)?.id ?? null;
      rmId = (who.rows[0] as any)?.rm_id ?? null;
    }
    if (!investorId) {
      skipped++;
      errors.push({
        row: i + 1,
        reason: r.pan
          ? `PAN ${r.pan} not in client master, and folio ${r.folioNumber} is not linked to a client`
          : `row has no PAN and folio ${r.folioNumber} is not linked to a client`,
      });
      continue;
    }

    // Resolve mandate (if reference is present)
    let mandateId: string | null = null;
    if (r.mandateRefNo) {
      const mandate = await tx.execute(sql`
        SELECT id FROM mandates WHERE tenant_id = ${args.tenantId}::uuid AND mandate_ref_no = ${r.mandateRefNo} LIMIT 1
      `);
      mandateId = (mandate.rows[0] as any)?.id ?? null;
    }

    await tx.execute(sql`SAVEPOINT rta_item`);
    try {
      // Match on the STABLE key (tenant, investor, folio, scheme) — NOT amount.
      // Including amount meant a step-up SIP (amount changes between monthly
      // books) failed to match and inserted a duplicate active SIP, inflating
      // active-SIP count + AUM projections. Update the amount on match instead.
      //
      // Match on folio_NUMBER, not folio_id. folio_id is a surrogate key that
      // CHANGES when the folio master is re-imported: the new folio row gets a
      // fresh uuid, the existing SIP still points at the old one, the lookup
      // misses and a duplicate active SIP is inserted. That is not theoretical —
      // it produced 96 byte-identical duplicate SIPs on one firm, same folio,
      // scheme, amount and start date, differing only in when they were written.
      //
      // The folio number is what the registrar actually keys on and survives a
      // re-import. investor_id is dropped from the match for the same reason:
      // a re-imported client is a new row, and the folio number already scopes
      // this tightly enough.
      // A registration already identified as an STP/SWP (not a SIP) stays out
      // of the book — the registrar re-sends it in every report.
      const transfer = await tx.execute(sql`
        SELECT 1 FROM sips
        WHERE tenant_id = ${args.tenantId}::uuid
          AND folio_number = ${r.folioNumber}
          AND scheme_code = ${r.schemeCode}
          AND remarks = ${NOT_A_SIP_REMARK}
        LIMIT 1
      `);
      if (transfer.rows.length) {
        await tx.execute(sql`RELEASE SAVEPOINT rta_item`);
        skipped++;
        continue;
      }

      const existing = await tx.execute(sql`
        SELECT id FROM sips
        WHERE tenant_id = ${args.tenantId}::uuid
          AND folio_number = ${r.folioNumber}
          AND scheme_code = ${r.schemeCode}
          AND status = 'active'
        LIMIT 1
      `);

      let existingId = (existing.rows[0] as any)?.id;

      // The same registration under a different scheme key: a report that
      // carried no code column was keyed on the scheme NAME, and the next one
      // (with a code column) missed it and inserted a second copy beside it —
      // 846 such pairs on one book. Same folio + same scheme name is the same
      // SIP; adopt that row and give it the proper code.
      if (!existingId && r.schemeName) {
        const byName = await tx.execute(sql`
          SELECT id FROM sips
          WHERE tenant_id = ${args.tenantId}::uuid
            AND folio_number = ${r.folioNumber}
            AND lower(regexp_replace(COALESCE(scheme_name, ''), '[^a-zA-Z0-9]', '', 'g'))
              = lower(regexp_replace(${r.schemeName}, '[^a-zA-Z0-9]', '', 'g'))
            AND status = 'active'
          ORDER BY amount DESC NULLS LAST
          LIMIT 1
        `);
        existingId = (byName.rows[0] as any)?.id;
        if (existingId) {
          await tx.execute(sql`UPDATE sips SET scheme_code = ${r.schemeCode} WHERE id = ${existingId}::uuid`);
        }
      }

      // The same registration, already CLOSED here — completed on evidence that
      // its instalments stopped (completeExpiredSips, scripts/mark-sip-transfers),
      // stopped on a cease date, or stopped by hand. Registrars keep listing a
      // registration long after it stops collecting, and matching only active
      // rows re-inserted every one of them as a fresh active SIP on the next
      // report, undoing the closure. Same folio + scheme + start date is the
      // same registration (an older CAMS import read 2/9 as 2 September, so the
      // swapped date matches too); a later start date is a new one.
      if (!existingId) {
        const closed = await tx.execute(sql`
          SELECT id, investor_id, status, amount, updated_at FROM sips
          WHERE tenant_id = ${args.tenantId}::uuid
            AND folio_number = ${r.folioNumber}
            AND status IN ('completed', 'stopped')
            AND (scheme_code = ${r.schemeCode}
                 OR lower(regexp_replace(COALESCE(scheme_name, ''), '[^a-zA-Z0-9]', '', 'g'))
                  = lower(regexp_replace(${r.schemeName || r.schemeCode}, '[^a-zA-Z0-9]', '', 'g')))
            AND (${r.startDate ?? null}::date IS NULL
                 OR start_date = ${r.startDate ?? null}::date
                 OR to_char(start_date, 'YYYY-DD-MM') = ${r.startDate ?? null}
                 OR (start_date IS NULL AND ${r.startDate ?? null}::date <= COALESCE(end_date, updated_at::date)))
          ORDER BY updated_at DESC
          LIMIT 1
        `);
        const c = closed.rows[0] as { id: string; investor_id: string; status: string; amount: string | null; updated_at: string } | undefined;
        if (c) {
          // Completed on evidence, so only evidence reopens it: an instalment
          // of this amount collected after it was closed (the feed can arrive
          // late). A stopped one — cease date, or a person — stays stopped.
          const amt = Number(c.amount ?? 0);
          const resumed = c.status === "completed" && sipStatus === "active" && amt > 0
            ? (await tx.execute(sql`
                SELECT 1 FROM transactions x
                WHERE x.tenant_id = ${args.tenantId}::uuid AND x.investor_id = ${c.investor_id}::uuid
                  AND x.folio_number = ${r.folioNumber} AND x.type = 'sip'
                  AND x.order_date > ${c.updated_at}::date
                  AND abs(x.amount - ${amt}::numeric) <= ${amt}::numeric * 0.02
                LIMIT 1
              `)).rows.length > 0
            : false;
          if (!resumed) {
            // Closed here already; label it with what the registrar says
            // ("KFintech: Terminated by Investor"). The status stays as it is.
            if (reg.reason) {
              await tx.execute(sql`
                UPDATE sips
                   SET updated_at = now(),
                       remarks = left(${reg.reason} || COALESCE(' · ' || NULLIF(regexp_replace(COALESCE(remarks, ''), ${REG_PREFIX_RE}, ''), ''), ''), 500)
                 WHERE id = ${c.id}::uuid AND COALESCE(remarks, '') NOT LIKE ${reg.reason + "%"}
              `);
            }
            await tx.execute(sql`RELEASE SAVEPOINT rta_item`);
            skipped++;
            continue;
          }
          existingId = c.id;
        }
      }

      if (existingId) {
        // `?? null` on every optional value here is load-bearing, not defensive
        // style: drizzle OMITS an `undefined` interpolation from the template
        // rather than binding NULL, so a SIP row with no next-installment date
        // emitted literal `COALESCE(::date, ...)` — malformed SQL. Postgres then
        // aborts the ENTIRE transaction, so one such row failed not only itself
        // but every remaining row in the file and the final status write too,
        // surfacing as an opaque "Failed query" with the real cause buried.
        // The INSERT branch below already did this correctly; this one was missed.
        await tx.execute(sql`
          UPDATE sips
          SET amount = ${r.amount}::numeric,
              next_installment_at = COALESCE(${r.nextInstallmentAt ?? null}::date, next_installment_at),
              start_date = COALESCE(${r.startDate ?? null}::date, start_date),
              end_date = COALESCE(${r.endDate ?? null}::date, end_date),
              mandate_id = COALESCE(${mandateId ?? null}::uuid, mandate_id),
              -- A deceased client's SIP stays stopped in the CRM (lib/investors/demise.ts).
              status = CASE WHEN ${sipStatus}::text = 'active'
                             AND EXISTS (SELECT 1 FROM investors dz WHERE dz.id = sips.investor_id AND dz.date_of_demise IS NOT NULL)
                            THEN sips.status ELSE ${sipStatus}::text END,
              remarks = CASE WHEN ${reg.reason ?? null}::text IS NULL THEN NULLIF(regexp_replace(COALESCE(remarks, ''), ${REG_PREFIX_RE}, ''), '')
                             ELSE left(${reg.reason ?? null}::text || COALESCE(' · ' || NULLIF(regexp_replace(COALESCE(remarks, ''), ${REG_PREFIX_RE}, ''), ''), ''), 500) END,
              updated_at = now()
          WHERE id = ${existingId}::uuid
        `);
      } else if (sipStatus !== "active") {
        // A cancelled SIP we never had on record: history, not part of the
        // book — nothing to add.
        await tx.execute(sql`RELEASE SAVEPOINT rta_item`);
        skipped++;
        continue;
      } else {
        await tx.execute(sql`
          INSERT INTO sips (
            tenant_id, investor_id, folio_id, folio_number, amc_code, amc_name, scheme_code, scheme_name,
            amount, frequency, sip_date, start_date, end_date, next_installment_at, mandate_id, status, rm_id
          ) VALUES (
            ${args.tenantId}::uuid, ${investorId}::uuid, ${folioId}::uuid, ${r.folioNumber}, ${r.schemeCode}, ${amcName},
            ${r.schemeCode}, ${r.schemeName}, ${r.amount}, ${r.frequency}, ${r.sipDate ?? null}, ${r.startDate ?? null}::date,
            ${r.endDate ?? null}::date, ${r.nextInstallmentAt ?? null}::date, ${mandateId}::uuid, 'active', ${rmId}::uuid
          )
        `);
      }

      imported++;
      await tx.execute(sql`RELEASE SAVEPOINT rta_item`);
    } catch (e: any) {
      await tx.execute(sql`ROLLBACK TO SAVEPOINT rta_item`);
      await tx.execute(sql`RELEASE SAVEPOINT rta_item`);
      failed++;
      errors.push({ row: i + 1, reason: e.message ?? "SIP import failed" });
    }
  }

  // The SIP book changed underneath the clients' cached "Monthly SIP" — and a
  // match by folio number can move a SIP between client records — so refresh
  // the whole firm's cache in one set-based pass (lib/metrics/sip.ts).
  // A Rs 0 copy of a registration this or an earlier report stored again WITH
  // its amount (a file keyed on scheme name, then one with a code column) is a
  // duplicate, not a second SIP.
  await tx.execute(sql`
    UPDATE sips z
       SET status = 'stopped', updated_at = now(),
           remarks = 'Duplicate: the same registration was re-imported with its amount'
     WHERE z.tenant_id = ${args.tenantId}::uuid AND z.status = 'active' AND COALESCE(z.amount, 0) = 0
       AND EXISTS (
         SELECT 1 FROM sips o
          WHERE o.tenant_id = z.tenant_id AND o.id <> z.id AND o.status = 'active'
            AND o.folio_number = z.folio_number AND COALESCE(o.amount, 0) > 0
            AND lower(regexp_replace(COALESCE(o.scheme_name, ''), '[^a-zA-Z0-9]', '', 'g'))
              = lower(regexp_replace(COALESCE(z.scheme_name, ''), '[^a-zA-Z0-9]', '', 'g'))
       )
  `);

  // Registrations the ledger shows to be STPs/SWPs leave the book
  // (lib/finance/sip-lifecycle.ts) before the cache is refreshed.
  const transfers = await markSystematicTransfers(tx, args.tenantId);
  if (imported > 0 || transfers > 0) await refreshActiveSipAmount(tx, { tenantId: args.tenantId });

  return {
    rowsTotal: rows.length,
    rowsImported: imported,
    rowsSkipped: skipped,
    rowsFailed: failed,
    errors,
    periodStart: today(),
    periodEnd: today(),
  };
}

async function processMandateStatus(
  tx: Tx,
  args: { tenantId: string; source: RtaSource; text: string }
): Promise<ProcessOutcome> {
  const rows: CanonicalMandateRow[] = parseMandateStatus(args.text, args.source);
  const errors: Array<{ row: number; reason: string }> = [];
  let imported = 0;
  let skipped = 0;
  let failed = 0;

  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    if (!r.pan || !r.mandateRefNo) {
      skipped++;
      continue;
    }

    const investorId = await clientIdForPan(tx, args.tenantId, r.pan);
    if (!investorId) {
      skipped++;
      errors.push({ row: i + 1, reason: `PAN ${r.pan} not in client master` });
      continue;
    }

    await tx.execute(sql`SAVEPOINT rta_item`);
    try {
      await tx.execute(sql`
        INSERT INTO mandates (
          tenant_id, investor_id, mandate_ref_no, bank_account_masked, ifsc, amount_limit, registered_at, expires_at, status
        ) VALUES (
          ${args.tenantId}::uuid, ${investorId}::uuid, ${r.mandateRefNo}, ${r.bankAccountMasked ?? null},
          ${r.ifsc ?? null}, ${r.amountLimit ?? null}, ${r.registeredAt ?? null}::date, ${r.expiresAt ?? null}::date, ${r.status}
        )
        ON CONFLICT (tenant_id, mandate_ref_no) DO UPDATE SET
          bank_account_masked = COALESCE(EXCLUDED.bank_account_masked, bank_account_masked),
          ifsc = COALESCE(EXCLUDED.ifsc, ifsc),
          amount_limit = COALESCE(EXCLUDED.amount_limit, amount_limit),
          status = EXCLUDED.status,
          expires_at = COALESCE(EXCLUDED.expires_at, expires_at),
          updated_at = now()
      `);

      imported++;
      await tx.execute(sql`RELEASE SAVEPOINT rta_item`);
    } catch (e: any) {
      await tx.execute(sql`ROLLBACK TO SAVEPOINT rta_item`);
      await tx.execute(sql`RELEASE SAVEPOINT rta_item`);
      failed++;
      errors.push({ row: i + 1, reason: e.message ?? "mandate import failed" });
    }
  }

  return {
    rowsTotal: rows.length,
    rowsImported: imported,
    rowsSkipped: skipped,
    rowsFailed: failed,
    errors,
    periodStart: today(),
    periodEnd: today(),
  };
}

async function processAumStatement(
  tx: Tx,
  args: { tenantId: string; source: RtaSource; text: string }
): Promise<ProcessOutcome> {
  const rows: CanonicalAumRow[] = parseAumStatement(args.text, args.source);
  const errors: Array<{ row: number; reason: string }> = [];
  let imported = 0;
  let skipped = 0;
  let failed = 0;
  /** Folios this report was the first to reveal — surfaced in the summary so a
   *  valuation-led import is visible rather than looking like a plain refresh. */
  let createdFolios = 0;

  // Group rows by folio number
  const aumRowsGrouped = new Map<string, CanonicalAumRow[]>();
  for (const r of rows) {
    if (!r.folioNumber || !r.schemeCode) {
      skipped++;
      continue;
    }
    const key = r.folioNumber;
    if (!aumRowsGrouped.has(key)) {
      aumRowsGrouped.set(key, []);
    }
    aumRowsGrouped.get(key)!.push(r);
  }

  const folioIndex = await loadFolioIndex(tx, args.tenantId);

  for (const [folioNum, fRows] of aumRowsGrouped) {
    const firstRow = fRows[0];
    // The folio this holding is in — see pickFolioForScheme. This report names
    // no AMC, and the old lookup took the first folio with the number.
    const picked = pickFolioForScheme(folioIndex.get(folioKey(folioNum)) ?? [], firstRow.schemeCode, firstRow.schemeName, args.source);
    if (picked.ambiguous) {
      skipped += fRows.length;
      errors.push({
        row: rows.indexOf(firstRow) + 1,
        reason: `Folio ${folioNum} is held at more than one AMC by different clients and this report does not say which — not filed`,
      });
      continue;
    }
    let investorId = picked.folio
      ? await clientForRow(tx, args.tenantId, firstRow.pan || undefined, picked.folio.investor_id)
      : await resolveInvestorId(tx, args.tenantId, { pan: firstRow.pan, folioNumber: folioNum });

    // Same gap the transaction feed had: the folio is not in the book yet and
    // this report cannot supply a PAN to match on. CAMS WBR22 has NO PAN COLUMN
    // AT ALL, so on a book whose master is incomplete every such folio was
    // dropped — 270 rows of one real file, each carrying units and a closing
    // value. Stand the client up keyed on the folio (migration 0151's
    // rta_nopan_key) so the holding lands; a later master with a real PAN
    // creates the PAN-keyed client and the folio upsert re-points to it.
    if (!investorId && folioNum) {
      const who = splitRepresentedBy(firstRow.investorName);
      const created = await tx.execute(sql`
        INSERT INTO investors (tenant_id, pan, rta_nopan_key, name, investor_category, is_minor, kyc_status)
        VALUES (
          ${args.tenantId}::uuid, NULL, ${nopanKeyFor(who.name, folioNum)},
          ${who.name ?? `Folio ${folioNum}`},
          ${who.isMinor ? "minor" : "individual"}, ${who.isMinor}, 'pending'
        )
        ON CONFLICT (tenant_id, rta_nopan_key) WHERE rta_nopan_key IS NOT NULL
        DO UPDATE SET updated_at = now()
        RETURNING id
      `);
      investorId = await liveOf(tx, args.tenantId, (created.rows[0] as any)?.id ?? null);
    }

    if (!investorId) {
      skipped += fRows.length;
      errors.push({ row: rows.indexOf(firstRow) + 1, reason: `Folio ${folioNum} could not be attached to a client` });
      continue;
    }

    // Find the folio — and CREATE it when this report is the first thing to
    // mention it. A valuation report legitimately arrives before any master:
    // CAMS WBR22 is pulled per-ARN on demand, while the folio master is a
    // separate subscription that may not cover the same ARNs. Refusing to
    // create the folio meant the holding was dropped even though we had the
    // folio number, the scheme, the units and the value in hand — 268 rows of
    // one real file, after the client-resolution gap above was already fixed.
    //
    // The transaction feed has always done this (processTransactionFeed inserts
    // the folio ON CONFLICT before writing the transaction); this path just
    // never did. amc_code is unknown here — WBR22 carries a PRODUCT code per
    // scheme, not a folio-level AMC — so it is left blank for a later master to
    // fill in, and the ON CONFLICT target below matches the same
    // (tenant, amc_code, folio_number) key the rest of the importer uses.
    let folio = picked.folio
      ? await tx.execute(sql`SELECT id, schemes FROM folios WHERE id = ${picked.folio.id}::uuid`)
      : await tx.execute(sql`
          SELECT id, schemes FROM folios
          WHERE tenant_id = ${args.tenantId}::uuid AND folio_number = ${folioNum} LIMIT 1
        `);
    if (!folio.rows[0]) {
      const rtaEnum = args.source === "cams" || args.source === "kfintech" ? args.source : "other";
      await tx.execute(sql`
        INSERT INTO folios (tenant_id, investor_id, folio_number, amc_code, amc_name, rta, schemes)
        VALUES (${args.tenantId}::uuid, ${investorId}::uuid, ${folioNum}, '', '', ${rtaEnum}, '[]'::jsonb)
        ON CONFLICT (tenant_id, amc_code, folio_number) DO UPDATE SET updated_at = now()
      `);
      folio = await tx.execute(sql`
        SELECT id, schemes FROM folios
        WHERE tenant_id = ${args.tenantId}::uuid AND folio_number = ${folioNum} LIMIT 1
      `);
      if (folio.rows[0]) createdFolios++;
    }
    const folioId = (folio.rows[0] as any)?.id;
    if (!folioId) {
      skipped += fRows.length;
      errors.push({ row: rows.indexOf(firstRow) + 1, reason: `Folio ${folioNum} could not be created` });
      continue;
    }

    await tx.execute(sql`SAVEPOINT rta_item`);
    try {
      const existingSchemes = ((folio.rows[0] as any)?.schemes ?? []) as Array<{
        schemeCode: string;
        schemeName: string;
        category?: string;
        units?: number;
        nav?: number;
        value?: number;
        /** ARN whose slice of the holding this leg is. Absent on legs written
         *  before per-ARN slicing existed. */
        arn?: string;
      }>;

      // Match an incoming holding to an existing leg by CODE **or by scheme
      // NAME**. The same holding is routinely already present under a different
      // code: the rich importer rewrites schemeCode to the AMFI code via
      // resolveSchemeIdentity, while this report carries the registrar's own
      // product code. Keying the merge on code alone stored it twice, with
      // identical units and identical value —
      //
      //   folio 1000073825   Y1035  = 16,206,449 / 890,757.88
      //                      150347 = 16,206,449 / 890,757.88
      //
      // Measured on VSN Financial Services: 3,632 duplicated legs worth
      // Rs 158.49 Cr, which is why firm AUM read Rs 779 Cr against an actual
      // Rs 640 Cr. Double-counted AUM is worse than missing AUM: it looks right.
      // The match is also keyed on ARN. A firm holding several ARNs gets one
      // statement per broker code, and a client who bought the same scheme in
      // the same folio through two of them has their units SPLIT across the two
      // files — complementary halves, not restatements. Keying on scheme alone
      // let the second statement overwrite the first, so the folio kept only
      // whichever ARN imported last:
      //
      //   folio 18069442/27  ICICI Large & Mid Cap
      //     ARN-114688  11,284.153 units   Rs 1,17,72,983
      //     ARN-90577    7,289.173 units   Rs   76,04,940
      //   stored: Rs 76,04,940 — the ARN-90577 slice alone.
      //
      // Measured on VSN Financial Services: 731 holdings under-valued by
      // Rs 32.93 Cr against the registrars' own statements.
      //
      // A leg with NO arn matches ANY incoming arn deliberately: legs written
      // before this change carry none, and treating them as a separate slice
      // would add the incoming one alongside and DOUBLE COUNT. Replacing them
      // instead lets the register converge as each ARN's statement lands,
      // without ever overstating on the way there.
      const normName = (s?: string) => (s ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
      // "0" and "NOT PROVIDED" are what some files put in an empty broker column.
      const realArn = (a?: string) => {
        const v = (a ?? "").trim().toUpperCase();
        return v && v !== "0" && v !== "NOT PROVIDED" ? v : null;
      };
      const merged = existingSchemes.map((s) => ({ ...s }));
      // A missing ARN is a wildcard on BOTH sides. Stored-none/incoming-one is
      // a leg written before slicing existed; stored-one/incoming-none is a
      // report whose layout has no broker column restating the same holding.
      // Either way it is the same holding and must REPLACE, not sit alongside —
      // handling only the first direction let arn-less restatements pile up as
      // second copies (721 folio+scheme pairs, Rs 37.27 Cr, 5-7 Sep).
      const slotFor = (code: string, name: string, arn: string | undefined, units: number): number | undefined => {
        const n = normName(name);
        let fallback: number | undefined;
        for (let idx = 0; idx < merged.length; idx++) {
          const s = merged[idx];
          const sameScheme = (s.schemeCode && s.schemeCode === code) || (n && normName(s.schemeName) === n);
          if (!sameScheme) continue;
          if (s.arn === arn) return idx;                    // same ARN's slice — restate it
          if ((s.arn == null || arn == null) && fallback == null) fallback = idx; // wildcard either way
        }
        if (fallback != null) return fallback;
        // This report names a holding by the REGISTRAR's code ("D157") and,
        // in the CAMS AUM statement, no scheme name at all, so neither key
        // finds the leg the folio master stored under the AMFI code and name.
        // Nimesh C Shah, 8 Oct 2026: 158 legs stored twice that way, Rs 8.19 Cr,
        //   folio 2305113/82  D157    ""                 25,862.605 units
        //                     105989  "DSP Small Cap…"   25,862.605 units
        // The same units in the same folio are the same holding when either
        // side has no name or no real ARN. Two named legs under real ARNs are
        // not matched this way: those can be a split, or two options of one
        // scheme.
        if (!(units > 0.001)) return undefined;
        for (let idx = 0; idx < merged.length; idx++) {
          const s = merged[idx];
          if (Math.abs(Number(s.units ?? 0) - units) > 0.001) continue;
          const a = realArn(s.arn), b = realArn(arn);
          if (!normName(s.schemeName) || !n ? !(a && b && a !== b) : (a == null) !== (b == null)) return idx;
        }
        return undefined;
      };

      for (const r of fRows) {
        if (!r.schemeCode) continue;
        const at = slotFor(r.schemeCode, r.schemeName, r.arn, r.units);
        const value = r.aumValue || (r.nav ? Math.round(r.units * r.nav * 100) / 100 : undefined);
        if (at != null) {
          const cur = merged[at];
          merged[at] = {
            ...cur,
            // Keep the EXISTING code. When it is the resolved AMFI code that is
            // what live-NAV revaluation joins on; overwriting it with the
            // registrar's product code would silently un-price the holding.
            schemeName: cur.schemeName || r.schemeName || "",
            units: r.units,
            nav: r.nav ?? cur.nav,
            value: value ?? cur.value,
            arn: r.arn ?? cur.arn,
          };
        } else {
          merged.push({
            schemeCode: r.schemeCode,
            schemeName: r.schemeName || "",
            units: r.units,
            nav: r.nav,
            value,
            arn: r.arn,
          });
        }
      }

      const mergedSchemes = merged;
      const roundedAum = mergedSchemes.reduce((acc, s) => acc + (s.value ?? 0), 0);

      await tx.execute(sql`
        UPDATE folios
        SET schemes = ${JSON.stringify(mergedSchemes)}::jsonb,
            aum = ${roundedAum}::numeric,
            updated_at = now()
        WHERE id = ${folioId}::uuid
      `);

      imported += fRows.length;
      await tx.execute(sql`RELEASE SAVEPOINT rta_item`);
    } catch (e: any) {
      await tx.execute(sql`ROLLBACK TO SAVEPOINT rta_item`);
      await tx.execute(sql`RELEASE SAVEPOINT rta_item`);
      failed += fRows.length;
      errors.push({ row: rows.indexOf(firstRow) + 1, reason: e.message ?? "AUM import failed" });
    }
  }

  if (createdFolios > 0) {
    // Not an error — recorded so a valuation-led import is visible as such,
    // rather than reading like a plain refresh of folios we already had.
    errors.push({ row: 0, reason: `${createdFolios} folio(s) were first seen in this report and created from it` });
  }

  await tx.execute(sql`SAVEPOINT rta_refresh`);
  try {
    const { revalueAllFolios, recomputeCombinedAum } = await import("@/lib/finance/aum-persist");
    await revalueAllFolios(tx);
    // Roll the (just-imported) folio holdings up to investors.aum so the client
    // profile headline reflects them — combined with transaction-derived value
    // for any scheme the folios don't cover. Without this, a holdings-only book
    // (RTA folio-master / AUM import, no transaction feed) shows ₹0 AUM.
    await recomputeCombinedAum(tx);
    await tx.execute(sql`RELEASE SAVEPOINT rta_refresh`);
  } catch (err: any) {
    await tx.execute(sql`ROLLBACK TO SAVEPOINT rta_refresh`);
    await tx.execute(sql`RELEASE SAVEPOINT rta_refresh`);
    console.error("[processAumStatement] revalueAllFolios failed:", err);
    errors.push({ row: 0, reason: `AUM values imported but investor AUM revaluation failed: ${err?.message ?? err}` });
    failed++;
  }

  return {
    rowsTotal: rows.length,
    rowsImported: imported,
    rowsSkipped: skipped,
    rowsFailed: failed,
    errors,
    periodStart: today(),
    periodEnd: today(),
  };
}

/** Preserve the caller's import-attempt row even if parsing/setup fails in SQL. */
export async function processRtaFile(
  tx: Tx,
  args: { tenantId: string; source: RtaSource; kind: RtaFileKind; text: string; importId?: string }
): Promise<ProcessOutcome> {
  await tx.execute(sql`SAVEPOINT rta_import`);
  try {
    const result = await processRtaFileUnsafe(tx, args);
    await tx.execute(sql`RELEASE SAVEPOINT rta_import`);
    return result;
  } catch (error) {
    await tx.execute(sql`ROLLBACK TO SAVEPOINT rta_import`);
    await tx.execute(sql`RELEASE SAVEPOINT rta_import`);
    throw error;
  }
}

