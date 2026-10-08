/**
 * Who a registrar row belongs to — one set of rules for every RTA import path.
 *
 * The importers used to resolve a client with `SELECT … WHERE pan = $1 LIMIT 1`
 * and `SELECT investor_id FROM folios WHERE folio_number = $1 LIMIT 1`. Both
 * ignored the client's lifecycle (a client in Trash or merged into another
 * still matched, so new money landed on a record nobody sees and that the
 * Trash purge later hard-deletes), and the folio lookup ignored the AMC and
 * took whichever row came first when two folios share a number.
 *
 * Rules, in one place:
 *   - PAN is used only when it is a valid PAN (lib/rta/values.ts validPan).
 *   - A MERGED client resolves to the client it was merged into (following the
 *     chain), if that client is live.
 *   - A client in TRASH (deleted_at set), or a merge chain ending in one,
 *     BLOCKS the row with a reason. It is never silently attached, and the
 *     importer never creates a second client for the same PAN beside it.
 *   - A folio is matched on (AMC code, folio number) first. Failing that, on the
 *     folio number alone ONLY when every folio with that number belongs to the
 *     same live client; otherwise the row is AMBIGUOUS and held back.
 *
 * The directory is loaded in bulk (chunked, so a feed with more folios than
 * Postgres' 65,535 bind parameters still works) and then queried in memory;
 * keys not preloaded are fetched on demand and cached.
 */

import { sql } from "drizzle-orm";
import { validPan } from "./values";
import { panHolderType, statusOwnerType } from "./owner";

type Tx = any;

export type Resolution =
  | { kind: "found"; id: string; rmId: string | null; viaMerge?: boolean }
  | { kind: "none" }
  | { kind: "blocked"; reason: string }
  | { kind: "ambiguous"; reason: string };

type InvestorRow = {
  id: string;
  pan: string | null;
  rta_nopan_key: string | null;
  rm_id: string | null;
  deleted_at: string | null;
  merged_into_id: string | null;
  guardian_investor_id?: string | null;
  is_minor?: boolean | null;
  investor_category?: string | null;
};

type FolioRow = { id: string; amc_code: string | null; folio_number: string; investor_id: string | null };

const CHUNK = 1000;
const MAX_MERGE_HOPS = 10;

function chunks<T>(arr: T[], n = CHUNK): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
}

const norm = (s: string | null | undefined) => (s ?? "").trim();

export class InvestorDirectory {
  private byId = new Map<string, InvestorRow>();
  private panIndex = new Map<string, string[]>(); // PAN → investor ids holding it
  private rawPanIndex = new Map<string, string[]>(); // investors.pan as stored (incl. MINOR: keys)
  private loadedRawPan = new Set<string>();
  private nopanIndex = new Map<string, string[]>();
  private folioIndex = new Map<string, FolioRow[]>(); // folio number → folios
  private loadedPans = new Set<string>();
  private loadedNopan = new Set<string>();
  private loadedFolios = new Set<string>();

  constructor(private tx: Tx, private tenantId: string) {}

  /** Bulk-load everything the given keys can touch. Safe to call repeatedly. */
  async preload(keys: { pans?: Array<string | null | undefined>; folios?: Array<string | null | undefined>; nopanKeys?: string[] }) {
    const pans = [...new Set((keys.pans ?? []).map((p) => validPan(p)).filter((p): p is string => !!p))].filter((p) => !this.loadedPans.has(p));
    const folios = [...new Set((keys.folios ?? []).map(norm).filter(Boolean))].filter((f) => !this.loadedFolios.has(f));
    const nopan = [...new Set(keys.nopanKeys ?? [])].filter((k) => !this.loadedNopan.has(k));

    for (const part of chunks(pans)) {
      const rows = (await this.tx.execute(sql`
        SELECT id, pan, rta_nopan_key, rm_id, deleted_at, merged_into_id, guardian_investor_id, is_minor, investor_category FROM investors
         WHERE tenant_id = ${this.tenantId}::uuid AND pan IN (${sql.join(part.map((p) => sql`${p}`), sql`, `)})
      `)).rows as InvestorRow[];
      this.addInvestors(rows);
      part.forEach((p) => this.loadedPans.add(p));
    }
    for (const part of chunks(nopan)) {
      const rows = (await this.tx.execute(sql`
        SELECT id, pan, rta_nopan_key, rm_id, deleted_at, merged_into_id, guardian_investor_id, is_minor, investor_category FROM investors
         WHERE tenant_id = ${this.tenantId}::uuid AND rta_nopan_key IN (${sql.join(part.map((k) => sql`${k}`), sql`, `)})
      `)).rows as InvestorRow[];
      this.addInvestors(rows);
      part.forEach((k) => this.loadedNopan.add(k));
    }
    const ownerIds = new Set<string>();
    for (const part of chunks(folios)) {
      const rows = (await this.tx.execute(sql`
        SELECT id, amc_code, folio_number, investor_id FROM folios
         WHERE tenant_id = ${this.tenantId}::uuid AND folio_number IN (${sql.join(part.map((f) => sql`${f}`), sql`, `)})
      `)).rows as FolioRow[];
      for (const r of rows) {
        const list = this.folioIndex.get(r.folio_number) ?? [];
        list.push({ ...r, id: String(r.id), investor_id: r.investor_id ? String(r.investor_id) : null });
        this.folioIndex.set(r.folio_number, list);
        if (r.investor_id) ownerIds.add(String(r.investor_id));
      }
      part.forEach((f) => this.loadedFolios.add(f));
    }
    await this.loadIds([...ownerIds]);
    await this.loadMergeTargets();
  }

  private addInvestors(rows: InvestorRow[]) {
    for (const raw of rows) {
      const r: InvestorRow = {
        ...raw,
        id: String(raw.id),
        merged_into_id: raw.merged_into_id ? String(raw.merged_into_id) : null,
        guardian_investor_id: raw.guardian_investor_id ? String(raw.guardian_investor_id) : null,
        rm_id: raw.rm_id ? String(raw.rm_id) : null,
      };
      if (this.byId.has(r.id)) continue;
      this.byId.set(r.id, r);
      const pan = validPan(r.pan);
      if (pan) this.panIndex.set(pan, [...(this.panIndex.get(pan) ?? []), r.id]);
      if (r.pan) this.rawPanIndex.set(r.pan, [...(this.rawPanIndex.get(r.pan) ?? []), r.id]);
      if (r.rta_nopan_key) this.nopanIndex.set(r.rta_nopan_key, [...(this.nopanIndex.get(r.rta_nopan_key) ?? []), r.id]);
    }
  }

  private async loadIds(ids: string[]) {
    const need = ids.filter((id) => !this.byId.has(id));
    for (const part of chunks(need)) {
      const rows = (await this.tx.execute(sql`
        SELECT id, pan, rta_nopan_key, rm_id, deleted_at, merged_into_id, guardian_investor_id, is_minor, investor_category FROM investors
         WHERE tenant_id = ${this.tenantId}::uuid AND id IN (${sql.join(part.map((id) => sql`${id}::uuid`), sql`, `)})
      `)).rows as InvestorRow[];
      this.addInvestors(rows);
    }
  }

  /** Load the survivors of every merged client we hold, hop by hop. */
  private async loadMergeTargets() {
    for (let hop = 0; hop < MAX_MERGE_HOPS; hop++) {
      const targets = [...this.byId.values()]
        .map((r) => r.merged_into_id)
        .filter((id): id is string => !!id && !this.byId.has(id));
      if (!targets.length) return;
      await this.loadIds([...new Set(targets)]);
    }
  }

  /** Apply lifecycle rules to one investor id. */
  private live(id: string): Resolution {
    let cur = this.byId.get(id);
    const seen = new Set<string>();
    while (cur) {
      if (seen.has(cur.id) || seen.size > MAX_MERGE_HOPS) {
        return { kind: "ambiguous", reason: "the matching client's merge history loops — resolve it in Merge Clients first" };
      }
      seen.add(cur.id);
      if (cur.deleted_at) {
        return {
          kind: "blocked",
          reason: seen.size > 1
            ? "the matching client was merged into a client that is now in Trash — restore it (or delete it permanently) before importing"
            : "the matching client is in Trash — restore it (or delete it permanently) before importing",
        };
      }
      if (!cur.merged_into_id) return { kind: "found", id: cur.id, rmId: cur.rm_id, viaMerge: seen.size > 1 };
      cur = this.byId.get(cur.merged_into_id);
    }
    return { kind: "ambiguous", reason: "the matching client was merged into a record that no longer exists" };
  }

  /** Several ids for one key → one live client, or the reason it is not one. */
  private pick(ids: string[], what: string): Resolution {
    if (!ids.length) return { kind: "none" };
    const results = ids.map((id) => this.live(id));
    const found = [...new Map(results.filter((r): r is Extract<Resolution, { kind: "found" }> => r.kind === "found").map((r) => [r.id, r])).values()];
    if (found.length === 1) return found[0];
    if (found.length > 1) return { kind: "ambiguous", reason: `${what} matches ${found.length} different clients — held back for review` };
    return results.find((r) => r.kind !== "none") ?? { kind: "none" };
  }

  async byPan(raw: string | null | undefined): Promise<Resolution> {
    const pan = validPan(raw);
    if (!pan) return { kind: "none" };
    if (!this.loadedPans.has(pan)) await this.preload({ pans: [pan] });
    return this.pick(this.panIndex.get(pan) ?? [], "this PAN");
  }

  async byNopanKey(key: string): Promise<Resolution> {
    if (!this.loadedNopan.has(key)) await this.preload({ nopanKeys: [key] });
    return this.pick(this.nopanIndex.get(key) ?? [], "this client key");
  }

  /**
   * By the value stored in investors.pan — a real PAN or the importer's
   * `MINOR:<guardian PAN>:<NAME>` key for a minor — with the same lifecycle
   * rules as byPan.
   */
  async byPanColumn(key: string): Promise<Resolution> {
    if (!key) return { kind: "none" };
    if (!this.loadedRawPan.has(key)) {
      const rows = (await this.tx.execute(sql`
        SELECT id, pan, rta_nopan_key, rm_id, deleted_at, merged_into_id, guardian_investor_id, is_minor, investor_category FROM investors
         WHERE tenant_id = ${this.tenantId}::uuid AND pan = ${key}
      `)).rows as InvestorRow[];
      this.addInvestors(rows);
      this.loadedRawPan.add(key);
      await this.loadMergeTargets();
    }
    return this.pick(this.rawPanIndex.get(key) ?? [], "this client key");
  }

  /** Bulk version of byPanColumn's load, chunked. */
  async preloadPanColumn(keys: string[]) {
    const need = [...new Set(keys.filter(Boolean))].filter((k) => !this.loadedRawPan.has(k));
    for (const part of chunks(need)) {
      const rows = (await this.tx.execute(sql`
        SELECT id, pan, rta_nopan_key, rm_id, deleted_at, merged_into_id, guardian_investor_id, is_minor, investor_category FROM investors
         WHERE tenant_id = ${this.tenantId}::uuid AND pan IN (${sql.join(part.map((k) => sql`${k}`), sql`, `)})
      `)).rows as InvestorRow[];
      this.addInvestors(rows);
      part.forEach((k) => this.loadedRawPan.add(k));
    }
    await this.loadMergeTargets();
  }

  /** Lifecycle of a known investor id (live / merged → survivor / in Trash). */
  async lifecycle(id: string): Promise<Resolution> {
    await this.loadIds([id]);
    await this.loadMergeTargets();
    return this.byId.has(id) ? this.live(id) : { kind: "none" };
  }

  /** Folios on record under this number (all AMCs). */
  async foliosFor(folioNumber: string): Promise<FolioRow[]> {
    const f = norm(folioNumber);
    if (!f) return [];
    if (!this.loadedFolios.has(f)) await this.preload({ folios: [f] });
    return this.folioIndex.get(f) ?? [];
  }

  /**
   * The client a folio belongs to. Exact (AMC, folio) first; else by number
   * alone only when all folios under that number agree on one live client.
   */
  async byFolio(folioNumber: string, amcCode?: string | null): Promise<Resolution & { folioId?: string }> {
    const rows = await this.foliosFor(folioNumber);
    if (!rows.length) return { kind: "none" };
    const amc = norm(amcCode);
    if (amc) {
      const exact = rows.filter((r) => norm(r.amc_code) === amc);
      if (exact.length === 1) {
        const r = exact[0];
        if (!r.investor_id) return { kind: "none" };
        return { ...this.live(r.investor_id), folioId: r.id };
      }
    }
    const owners = [...new Set(rows.map((r) => r.investor_id).filter((x): x is string => !!x))];
    const res = this.pick(owners, `folio number ${norm(folioNumber)} (held under ${rows.length} AMC code(s))`);
    if (res.kind === "found" && rows.length === 1) return { ...res, folioId: rows[0].id };
    return res;
  }

  /** PAN first, then folio. A PAN that is in Trash blocks; it does not fall through. */
  async resolve(key: { pan?: string | null; folioNumber?: string | null; amcCode?: string | null }): Promise<Resolution> {
    const byPan = await this.byPan(key.pan);
    if (byPan.kind !== "none") return byPan;
    if (!key.folioNumber) return { kind: "none" };
    const byFolio = await this.byFolio(key.folioNumber, key.amcCode);
    // The row names a PAN the CRM does not hold, but the folio is filed under a
    // client with a DIFFERENT valid PAN: not the same person on the face of it.
    const rowPan = validPan(key.pan);
    const ownerPan = byFolio.kind === "found" ? validPan(this.byId.get(byFolio.id)?.pan) : null;
    if (rowPan && ownerPan && ownerPan !== rowPan) {
      return { kind: "ambiguous", reason: `folio ${norm(key.folioNumber)} is filed under a client with a different PAN — held back for review, nothing reassigned` };
    }
    return byFolio;
  }

  /**
   * Is `guardianId` the recorded guardian of the minor `minorId`? Either the
   * minor's guardian_investor_id points at them, or the minor carries the
   * importer's key `MINOR:<guardian PAN>:<NAME>` with that client's PAN.
   *
   * Evidence (Phase 2B, real CAMS R2 + R9): on every one of 22 minor folios the
   * R2 transaction row's `pan` is the GUARDIAN's PAN (R9 files the folio under
   * the minor with `guard_pan` = that PAN). Such a row belongs to the minor who
   * holds the folio, not to the guardian's own client record.
   */
  isGuardianOf(guardianId: string, minorId: string): boolean {
    const minor = this.byId.get(minorId);
    const guardian = this.byId.get(guardianId);
    if (!minor || !guardian) return false;
    if (minor.guardian_investor_id && minor.guardian_investor_id === guardianId) return true;
    const gp = validPan(guardian.pan);
    return !!gp && (minor.pan ?? "").toUpperCase().startsWith(`MINOR:${gp}:`);
  }

  /**
   * The guardian PAN a minor's record carries: its guardian client's own PAN,
   * else the one in the importer's key `MINOR:<guardian PAN>:<NAME>`.
   */
  private async guardianPanOf(minorId: string): Promise<string | null> {
    const minor = this.byId.get(minorId);
    if (!minor) return null;
    if (minor.guardian_investor_id) {
      await this.loadIds([minor.guardian_investor_id]);
      const g = validPan(this.byId.get(minor.guardian_investor_id)?.pan);
      if (g) return g;
    }
    const m = (minor.pan ?? "").toUpperCase().match(/^MINOR:([A-Z]{5}[0-9]{4}[A-Z]):/);
    return m ? m[1] : null;
  }

  private guardianCache = new Map<string, boolean>();
  /** Is this client the recorded guardian of any live minor in the firm? */
  private async guardsAMinor(id: string): Promise<boolean> {
    const hit = this.guardianCache.get(id);
    if (hit !== undefined) return hit;
    const pan = validPan(this.byId.get(id)?.pan);
    const r = await this.tx.execute(sql`
      SELECT 1 FROM investors
       WHERE tenant_id = ${this.tenantId}::uuid AND deleted_at IS NULL
         AND (guardian_investor_id = ${id}::uuid OR (${pan}::text IS NOT NULL AND upper(pan) LIKE ${`MINOR:${pan ?? ""}:%`}))
       LIMIT 1
    `);
    const yes = r.rows.length > 0;
    this.guardianCache.set(id, yes);
    return yes;
  }

  /**
   * Folio-first ownership for the legacy processors (SIP rejection report, SIP
   * register, AUM statement, folio master) — the owner decisions of
   * 2026-10-08, the same order `owner.ts` gives the staging engine:
   *
   *   1. The folio on record is the owner: matched on (AMC, folio) when the row
   *      names an AMC, by number alone only when every folio under it has the
   *      same live client. The row's PAN must then be the owner's own, or the
   *      recorded guardian's of a minor owner. A PAN that names ANOTHER client,
   *      or a different valid PAN when the owner has one, holds the row — PAN
   *      never overrides the folio. A provisional (PAN-less) owner is never
   *      displaced by a PAN: placeholder reassignment stays off.
   *   2. No folio on record (or one with no client): the row's PAN, as the
   *      owner's OWN PAN — never on a row the registrar marks minor (its PAN is
   *      the guardian's), never an individual PAN on an HUF row (it is the
   *      Karta's), and never when that PAN's client is the recorded guardian of
   *      a minor when the report does not state the holder type, since the row
   *      may be the child's. Those are held with the
   *      reason; importing the folio master settles them.
   *   3. Otherwise none.
   *
   * Nothing here writes; it decides. No historical row is moved by it.
   */
  async ownerOf(key: {
    pan?: string | null;
    folioNumber?: string | null;
    amcCode?: string | null;
    holderStatus?: string | null;
  }): Promise<Resolution & { via?: "folio" | "pan" }> {
    const rowPan = validPan(key.pan);
    const folio = norm(key.folioNumber);
    const held = (reason: string): Resolution => ({ kind: "ambiguous", reason });
    if (folio) {
      const f = await this.byFolio(folio, key.amcCode);
      if (f.kind === "blocked" || f.kind === "ambiguous") return f;
      // A number-only match is WEAK when the row names an AMC and every folio
      // on record under that number carries a different, non-blank AMC code:
      // the row may well be another folio at another AMC.
      const amc = norm(key.amcCode);
      const weak = !!amc && (await this.foliosFor(folio)).every((r) => !!norm(r.amc_code) && norm(r.amc_code) !== amc);
      let otherFolio = false;
      if (f.kind === "found") {
        const ownerPan = validPan(this.byId.get(f.id)?.pan);
        if (rowPan && rowPan !== ownerPan) {
          const p = await this.byPan(rowPan);
          const guardian =
            (p.kind === "found" && this.isGuardianOf(p.id, f.id)) ||
            (!!this.byId.get(f.id)?.is_minor && (await this.guardianPanOf(f.id)) === rowPan);
          if (!guardian) {
            if (p.kind === "found" && p.id !== f.id && weak) {
              // Another known client, at an AMC this folio is not on record
              // with: their own folio there — decided below on their PAN.
              otherFolio = true;
            } else if (p.kind === "found" && p.id !== f.id) {
              return held(`folio ${folio} is filed under a different client than the one this row's PAN names — held back for review, nothing reassigned`);
            } else if (ownerPan) {
              return held(`folio ${folio} is filed under a client with a different PAN — held back for review, nothing reassigned`);
            }
            // The owner has no PAN of its own (a minor or a provisional
            // record) and this PAN is not a client: the folio decides.
          }
        }
        if (!otherFolio) return { ...f, via: "folio" };
      }
    }
    if (!rowPan) return { kind: "none" };
    const status = statusOwnerType(key.holderStatus);
    const where = folio ? `folio ${folio}${norm(key.amcCode) ? ` at AMC ${norm(key.amcCode)}` : ""} is not on record` : "the row names no folio";
    if (status === "minor") {
      return held(`${where} and the row is a minor's — its PAN is the guardian's and never attaches it; import the folio master first`);
    }
    if (status === "huf" && panHolderType(rowPan) !== "huf") {
      return held(`${where} and the row is an HUF's with an individual (Karta's) PAN — the Karta is never made the owner; import the folio master first`);
    }
    const p = await this.byPan(rowPan);
    if (p.kind !== "found") return p;
    // A row the registrar states is NOT a minor's carries the owner's own PAN;
    // only when the report says nothing is a guardian's PAN a real possibility.
    const statedAdult = status === "individual" || status === "non_individual" || status === "huf";
    if (!statedAdult && (await this.guardsAMinor(p.id))) {
      return held(`${where} and this PAN's client is the recorded guardian of a minor — the row may be the minor's; import the folio master first`);
    }
    return { ...p, via: "pan" };
  }

  /** What the directory holds about one loaded client (read-only; null if not loaded). */
  info(id: string): { id: string; pan: string | null; isMinor: boolean; category: string | null; guardianId: string | null; placeholder: boolean } | null {
    const r = this.byId.get(String(id));
    if (!r) return null;
    return { id: r.id, pan: r.pan, isMinor: !!r.is_minor, category: r.investor_category ?? null, guardianId: r.guardian_investor_id ?? null, placeholder: this.isPlaceholder(r.id) };
  }

  /** Is this investor an import placeholder (no PAN of its own, keyed by the importer)? */
  isPlaceholder(id: string): boolean {
    const r = this.byId.get(id);
    return !!r && !validPan(r.pan) && !!r.rta_nopan_key;
  }

  /** Record a client the importer just created, so later rows resolve to it. */
  remember(row: { id: string; pan?: string | null; rta_nopan_key?: string | null; rm_id?: string | null }) {
    this.byId.delete(String(row.id));
    this.addInvestors([{ id: String(row.id), pan: row.pan ?? null, rta_nopan_key: row.rta_nopan_key ?? null, rm_id: row.rm_id ?? null, deleted_at: null, merged_into_id: null }]);
  }

  /** Record a folio the importer just created or touched. */
  rememberFolio(row: { id: string; amc_code: string; folio_number: string; investor_id: string }) {
    const list = (this.folioIndex.get(row.folio_number) ?? []).filter((r) => r.id !== String(row.id));
    list.push({ ...row, id: String(row.id) });
    this.folioIndex.set(row.folio_number, list);
    this.loadedFolios.add(row.folio_number);
  }
}

/** The single PAN-less client key: the folio the registrar filed it under. */
export function nopanFolioKey(folioNumber: string): string {
  return `NOPAN:FOLIO:${norm(folioNumber)}`;
}
