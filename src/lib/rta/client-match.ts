/**
 * Which existing client does a registrar row belong to?
 *
 * Every RTA import used to answer that with `WHERE pan = $1`, and on a firm
 * whose book did not START with an RTA import that answer is wrong three ways,
 * each of which created a second client for a person the CRM already had:
 *
 *  1. A client loaded from the firm's Excel client list carries
 *     dedup_pan = false (migration 0137 lets a migrated book repeat a PAN). The
 *     importer's upsert targets the partial unique index
 *     `(tenant_id, pan) WHERE dedup_pan`, which cannot see that row, so the
 *     first registrar file INSERTED a second client with the same PAN — the
 *     firm's record (RM, branch, notes) on one, the folios and AUM on the other.
 *
 *  2. A merge keeps the PAN on the retired record (a merge never changes who
 *     the survivor legally is). So after an operator folded a duplicate away,
 *     the next file's upsert hit the RETIRED record, the folio upsert moved the
 *     folios onto it, and the client the firm kept was left empty: the merge
 *     "undid itself" and the holdings vanished from the client list.
 *
 *  3. A client the firm entered without a PAN — Ahpal Financial Services'
 *     8,568-client master of 9 Sep 2026 is all of them — can be matched on
 *     nothing, so every one of them got a registrar twin.
 *
 * The rules here, used by both import engines (import.ts and process.ts):
 *
 *  - A PAN resolves to its LIVE client, following merges to the survivor;
 *    among several live rows the one already holding the PAN slot wins, then
 *    the oldest. When that client does not hold the slot it is moved to it
 *    (dedup_pan cleared on the retired/duplicate rows, set on the live one),
 *    so the ordinary upsert updates the right record from then on.
 *  - A PAN nobody holds may ADOPT a client the firm entered without a PAN, but
 *    only on an unambiguous name: exactly one PAN-less client with that name,
 *    exactly one person of that name in the file, nobody with a PAN already
 *    called that, at least two name words, and no conflicting date of birth.
 *    A namesake is a person's call, never the importer's.
 */

import { sql } from "drizzle-orm";
import type { Tx } from "@/db/client";

const chunk = <T,>(arr: T[], n: number): T[][] => {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
};

/** What the file says about the person behind a key — enough to adopt by name. */
export type ClientHint = { name?: string | null; dob?: string | null; isMinor?: boolean };

const HONORIFICS = new Set(["MR", "MRS", "MS", "MISS", "DR", "SHRI", "SHREE", "SMT", "KUM", "KUMARI", "MAST", "MASTER", "LATE", "PROF", "CA", "ADV", "SRI"]);

/**
 * Name as a matching key: letters and digits only, honorifics dropped, words
 * sorted — the registrar writes "SHAH NIMESH C" where the firm typed
 * "Nimesh C Shah". Pure; exported for tests.
 */
export function nameMatchKey(name: string | null | undefined): string {
  const words = String(name ?? "")
    .toUpperCase()
    .replace(/[^A-Z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w && !HONORIFICS.has(w));
  return words.sort().join(" ");
}

const wordCount = (key: string) => (key ? key.split(" ").length : 0);
const day = (d: unknown) => (d ? String(d instanceof Date ? d.toISOString() : d).slice(0, 10) : null);

/**
 * Follow merges: id → the live client it ended up in (itself when not merged).
 * A chain ending in a deleted record maps to that record.
 */
export async function followMerges(tx: Tx, tenantId: string, ids: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const unique = [...new Set(ids.filter(Boolean))];
  for (const part of chunk(unique, 500)) {
    const rows = (await tx.execute(sql`
      WITH RECURSIVE c AS (
        SELECT i.id AS origin, i.id, i.merged_into_id, 0 AS depth
          FROM investors i
         WHERE i.tenant_id = ${tenantId}::uuid
           AND i.id IN (${sql.join(part.map((id) => sql`${id}::uuid`), sql`, `)})
        UNION ALL
        SELECT c.origin, s.id, s.merged_into_id, c.depth + 1
          FROM c JOIN investors s ON s.id = c.merged_into_id AND s.tenant_id = ${tenantId}::uuid
         WHERE c.depth < 8
      )
      SELECT DISTINCT ON (origin) origin, id FROM c ORDER BY origin, depth DESC
    `)).rows as Array<{ origin: string; id: string }>;
    for (const r of rows) out.set(String(r.origin), String(r.id));
  }
  return out;
}

type Canonical = { id: string; pan: string | null; dedupPan: boolean; live: boolean };

/**
 * key → the client each key's rows end up at. `column` is `pan` or
 * `rta_nopan_key`. Preference: live over deleted, a row holding the key itself
 * over a merge survivor, the PAN-slot holder, then the oldest.
 */
async function canonicalBy(tx: Tx, tenantId: string, column: "pan" | "rta_nopan_key", keys: string[]): Promise<Map<string, Canonical>> {
  const out = new Map<string, Canonical>();
  const col = sql.raw(`i.${column}`);
  for (const part of chunk([...new Set(keys.filter(Boolean))], 500)) {
    const rows = (await tx.execute(sql`
      WITH RECURSIVE c AS (
        SELECT ${col} AS key, i.id, i.merged_into_id, i.deleted_at, i.pan, i.dedup_pan,
               i.dedup_pan AS origin_dedup, i.created_at AS origin_created, 0 AS depth
          FROM investors i
         WHERE i.tenant_id = ${tenantId}::uuid
           AND ${col} IN (${sql.join(part.map((k) => sql`${k}`), sql`, `)})
        UNION ALL
        SELECT c.key, s.id, s.merged_into_id, s.deleted_at, s.pan, s.dedup_pan,
               c.origin_dedup, c.origin_created, c.depth + 1
          FROM c JOIN investors s ON s.id = c.merged_into_id AND s.tenant_id = ${tenantId}::uuid
         WHERE c.depth < 8
      )
      SELECT DISTINCT ON (key) key, id, pan, dedup_pan, (deleted_at IS NULL) AS live
        FROM c
       WHERE merged_into_id IS NULL
       ORDER BY key, (deleted_at IS NULL) DESC, depth ASC, origin_dedup DESC, origin_created ASC
    `)).rows as Array<{ key: string; id: string; pan: string | null; dedup_pan: boolean; live: boolean }>;
    for (const r of rows) out.set(String(r.key), { id: String(r.id), pan: r.pan, dedupPan: !!r.dedup_pan, live: !!r.live });
  }
  return out;
}

/** One client by PAN, the same way the batch resolver picks — for per-row lookups. */
export async function clientIdForPan(tx: Tx, tenantId: string, pan: string | null | undefined): Promise<string | null> {
  const p = String(pan ?? "").trim().toUpperCase();
  if (!p) return null;
  return (await canonicalBy(tx, tenantId, "pan", [p])).get(p)?.id ?? null;
}

/** The client that owns a folio number now (merges followed). */
export async function clientIdForFolio(tx: Tx, tenantId: string, folioNumber: string | null | undefined): Promise<string | null> {
  if (!folioNumber || !folioNumber.trim()) return null;
  const r = (await tx.execute(sql`
    SELECT investor_id FROM folios
     WHERE tenant_id = ${tenantId}::uuid AND folio_number = ${folioNumber} AND investor_id IS NOT NULL
     LIMIT 1
  `)).rows[0] as { investor_id?: string } | undefined;
  if (!r?.investor_id) return null;
  return (await followMerges(tx, tenantId, [String(r.investor_id)])).get(String(r.investor_id)) ?? String(r.investor_id);
}

export type PanResolution = {
  /** key → live client id. Keys with no live client are absent. */
  ids: Map<string, string>;
  /** Keys some row (live, merged or deleted) already carries — "updated", not "created". */
  known: Set<string>;
  /** Clients that took over the PAN slot from a retired or duplicate record. */
  claimed: number;
  /** PAN-less clients matched by name and given the key. */
  adopted: number;
  /** Keys resolved to a client that cannot carry this key (it holds another
   *  one) — the caller must not insert a row for them. */
  mappedOnly: Set<string>;
};

/**
 * Resolve PAN keys (real PANs, and the importer's `MINOR:` ids, which live in
 * the same column) to live clients. With `write`, the chosen client takes the
 * PAN slot and adopted clients get the PAN, so the caller's
 * `ON CONFLICT (tenant_id, pan) WHERE dedup_pan` upsert lands on them.
 */
export async function resolvePanClients(
  tx: Tx,
  tenantId: string,
  keys: string[],
  opts: { write: boolean; hints?: Map<string, ClientHint> },
): Promise<PanResolution> {
  const res: PanResolution = { ids: new Map(), known: new Set(), claimed: 0, adopted: 0, mappedOnly: new Set() };
  if (!keys.length) return res;
  const canon = await canonicalBy(tx, tenantId, "pan", keys);

  const claims: Array<{ pan: string; id: string }> = [];
  const claimedBy = new Set<string>();
  for (const [key, c] of canon) {
    res.known.add(key);
    if (!c.live) continue;
    res.ids.set(key, c.id);
    // A survivor holding a DIFFERENT PAN (merged on purpose across PANs), or
    // one already taking another PAN in this batch, is where the money goes —
    // but it cannot take this PAN, so the caller must not insert one either.
    if ((c.pan && c.pan !== key) || claimedBy.has(c.id)) {
      res.mappedOnly.add(key);
      continue;
    }
    if (!c.dedupPan || !c.pan) {
      claims.push({ pan: key, id: c.id });
      claimedBy.add(c.id);
    }
  }

  if (opts.write && claims.length) {
    for (const part of chunk(claims, 400)) {
      const values = sql.join(part.map((c) => sql`(${c.pan}, ${c.id}::uuid)`), sql`, `);
      // Release first: the partial unique index allows one slot holder per PAN.
      await tx.execute(sql`
        UPDATE investors i SET dedup_pan = false, updated_at = now()
          FROM (VALUES ${values}) AS v(pan, id)
         WHERE i.tenant_id = ${tenantId}::uuid AND i.pan = v.pan AND i.dedup_pan AND i.id <> v.id
      `);
      await tx.execute(sql`
        UPDATE investors i SET pan = v.pan, dedup_pan = true, updated_at = now()
          FROM (VALUES ${values}) AS v(pan, id)
         WHERE i.tenant_id = ${tenantId}::uuid AND i.id = v.id AND (i.pan IS NULL OR i.pan = v.pan)
      `);
    }
    res.claimed = claims.length;
  }

  // Adoption: only for keys NO row carries at all.
  const unknown = keys.filter((k) => !res.known.has(k));
  if (unknown.length && opts.hints?.size) {
    const adopted = await adoptByName(tx, tenantId, unknown, opts.hints, "pan");
    if (opts.write && adopted.size) {
      for (const part of chunk([...adopted.entries()], 400)) {
        const values = sql.join(part.map(([pan, id]) => sql`(${pan}, ${id}::uuid)`), sql`, `);
        await tx.execute(sql`
          UPDATE investors i SET pan = v.pan, dedup_pan = true, updated_at = now()
            FROM (VALUES ${values}) AS v(pan, id)
           WHERE i.tenant_id = ${tenantId}::uuid AND i.id = v.id AND i.pan IS NULL
        `);
      }
    }
    for (const [k, id] of adopted) {
      res.ids.set(k, id);
      res.known.add(k);
    }
    res.adopted = adopted.size;
  }
  return res;
}

export type NoPanResolution = PanResolution;

/**
 * The same for the importer's `NOPAN:` keys (rta_nopan_key, pan NULL). A key
 * nobody carries may adopt a PAN-less client the firm entered by hand (it gets
 * the key), or a placeholder an earlier report stood up under another spelling
 * of the key (mapped only — a client carries one key).
 */
export async function resolveNoPanClients(
  tx: Tx,
  tenantId: string,
  keys: string[],
  opts: { write: boolean; hints?: Map<string, ClientHint> },
): Promise<NoPanResolution> {
  const res: NoPanResolution = { ids: new Map(), known: new Set(), claimed: 0, adopted: 0, mappedOnly: new Set() };
  if (!keys.length) return res;
  const canon = await canonicalBy(tx, tenantId, "rta_nopan_key", keys);
  for (const [key, c] of canon) {
    res.known.add(key);
    if (c.live) res.ids.set(key, c.id);
  }
  const unknown = keys.filter((k) => !res.known.has(k));
  if (unknown.length && opts.hints?.size) {
    const adopted = await adoptByName(tx, tenantId, unknown, opts.hints, "nopan");
    if (adopted.size) {
      const ids = [...adopted.values()];
      const keyed = new Set<string>();
      for (const part of chunk(ids, 500)) {
        const rows = (await tx.execute(sql`
          SELECT id FROM investors
           WHERE tenant_id = ${tenantId}::uuid AND rta_nopan_key IS NOT NULL
             AND id IN (${sql.join(part.map((id) => sql`${id}::uuid`), sql`, `)})
        `)).rows as Array<{ id: string }>;
        for (const r of rows) keyed.add(String(r.id));
      }
      const give = [...adopted.entries()].filter(([, id]) => !keyed.has(id));
      if (opts.write && give.length) {
        for (const part of chunk(give, 400)) {
          const values = sql.join(part.map(([k, id]) => sql`(${k}, ${id}::uuid)`), sql`, `);
          await tx.execute(sql`
            UPDATE investors i SET rta_nopan_key = v.k, updated_at = now()
              FROM (VALUES ${values}) AS v(k, id)
             WHERE i.tenant_id = ${tenantId}::uuid AND i.id = v.id AND i.rta_nopan_key IS NULL AND i.pan IS NULL
          `);
        }
      }
      for (const [k, id] of adopted) {
        res.ids.set(k, id);
        res.known.add(k);
        if (keyed.has(id)) res.mappedOnly.add(k);
      }
      res.adopted = adopted.size;
    }
  }
  return res;
}

/**
 * Unambiguous name matches between unknown keys and the firm's PAN-less
 * clients. Read-only. See the module comment for the rule.
 */
async function adoptByName(
  tx: Tx,
  tenantId: string,
  unknown: string[],
  hints: Map<string, ClientHint>,
  kind: "pan" | "nopan",
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  // How many people in THIS file carry each name — two means it is not a match key.
  const inFile = new Map<string, number>();
  for (const h of hints.values()) {
    const k = nameMatchKey(h.name);
    if (k) inFile.set(k, (inFile.get(k) ?? 0) + 1);
  }
  const wanted = new Map<string, string>(); // name key → the one unknown key
  for (const key of unknown) {
    const nk = nameMatchKey(hints.get(key)?.name);
    if (wordCount(nk) < 2 || inFile.get(nk) !== 1) continue;
    wanted.set(nk, key);
  }
  if (!wanted.size) return out;

  const candidates = (await tx.execute(sql`
    SELECT id, name, dob, is_minor, rta_nopan_key
      FROM investors
     WHERE tenant_id = ${tenantId}::uuid AND pan IS NULL
       AND deleted_at IS NULL AND merged_into_id IS NULL
  `)).rows as Array<{ id: string; name: string | null; dob: unknown; is_minor: boolean | null; rta_nopan_key: string | null }>;
  const byName = new Map<string, typeof candidates>();
  for (const c of candidates) {
    const nk = nameMatchKey(c.name);
    if (!wanted.has(nk)) continue;
    byName.set(nk, [...(byName.get(nk) ?? []), c]);
  }
  if (!byName.size) return out;

  // Someone who already has a PAN and this name could be the person the
  // PAN-less record describes — that makes it ambiguous, so skip it.
  const panHolders = new Set<string>();
  const holders = (await tx.execute(sql`
    SELECT name FROM investors
     WHERE tenant_id = ${tenantId}::uuid AND pan IS NOT NULL
       AND deleted_at IS NULL AND merged_into_id IS NULL
  `)).rows as Array<{ name: string | null }>;
  for (const h of holders) {
    const nk = nameMatchKey(h.name);
    if (byName.has(nk)) panHolders.add(nk);
  }

  for (const [nk, cands] of byName) {
    if (panHolders.has(nk)) continue;
    const key = wanted.get(nk)!;
    const hint = hints.get(key) ?? {};
    // The firm's own record first; a placeholder from an earlier report only
    // when there is no such record.
    const firm = cands.filter((c) => !c.rta_nopan_key);
    const placeholders = cands.filter((c) => (c.rta_nopan_key ?? "").startsWith("NOPAN:"));
    const pick = firm.length === 1 ? firm[0] : firm.length === 0 && placeholders.length === 1 ? placeholders[0] : null;
    if (!pick) continue;
    const isMinorKey = kind === "pan" ? key.startsWith("MINOR:") : !!hint.isMinor;
    if (isMinorKey !== !!pick.is_minor) continue;
    const a = day(hint.dob), b = day(pick.dob);
    if (a && b && a !== b) continue;
    out.set(key, String(pick.id));
  }
  return out;
}
