/**
 * RTA reverse-feed — import / upsert service.
 *
 * Takes the normalized `RtaFolioRecord[]` from a parser and syncs them into the
 * CRM: upsert investors (by PAN) and folios (by AMC + folio number).
 *
 * Sync rules (the RTA is authoritative for the *master*, the CRM owns the
 * *relationship*):
 *   · Investor upsert FILLS contact / KYC / address / nominee / bank fields from
 *     the feed but NEVER clobbers CRM-owned fields (rmId, tags, riskProfile,
 *     aum, serviceTier, status, notes, health, clientCategory). Blank feed values
 *     never overwrite existing data.
 *   · Folios are feed-owned — amcName / rta / schemes / investorId are overwritten.
 *   · Rows without a PAN cannot resolve an investor and are skipped + counted.
 *   · Idempotent: re-importing the same file updates in place, never duplicates.
 *
 * Pass `dryRun: true` to compute the would-create / would-update counts via
 * read-only SELECTs without writing anything (powers the upload Preview).
 */

import { sql } from "drizzle-orm";
import { investors, folios as foliosTable } from "@/db/schema";
import type { RtaFolioRecord } from "./types";
import { resolveSchemeIdentity } from "./resolve-scheme";
import { ownersOfFolios, releaseFormerOwners } from "./former-owners";
import { InvestorDirectory, nopanFolioKey, type Resolution } from "./identity";
import { validPan } from "./values";

/**
 * Build a Postgres array literal that binds a JS array as ONE array value.
 *
 * Interpolating a JS array directly (`unnest(${arr}::uuid[])`) makes Drizzle
 * expand it to a *parenthesised parameter list* `($1, $2, …)`, so the SQL
 * becomes `unnest(($1,…)::uuid[])` — casting a ROW to an array, which Postgres
 * rejects ("UPDATE … FROM (SELECT unnest(($1,$2,…)…" → failed query). Wrapping
 * the params in `ARRAY[$1, $2, …]::type[]` is the correct array constructor.
 */
function pgArray(values: (string | null)[], pgType: "uuid" | "date" | "text") {
  return sql`ARRAY[${sql.join(values.map((v) => sql`${v}`), sql`, `)}]::${sql.raw(pgType)}[]`;
}

export type RtaImportSummary = {
  dryRun: boolean;
  rta: string;
  reportType: string;
  investors: { total: number; created: number; updated: number; minors: number };
  folios: { total: number; created: number; updated: number; skippedNoPan: number };
  schemes: number;
  /** Total market value across the feed (holdings imports only). */
  aum?: number;
  amcs: { code: string; name: string; folios: number }[];
  /**
   * Folios held back, with why: a client in Trash, an ambiguous match, or a
   * folio the CRM holds under a different (non-placeholder) client. Nothing in
   * them was written. `row` is the record's position in the parsed file.
   */
  exceptions: Array<{ row: number; reason: string }>;
  /** Folios that moved from an import placeholder to their PAN-keyed client,
   *  with how many transactions / SIPs moved with them. */
  moved: { folios: number; transactions: number; sips: number };
};

// Drizzle transaction — typed loosely to match the codebase's withTenant callers.
type Tx = any;

/**
 * Automatic re-pointing of a folio from an import PLACEHOLDER (a PAN-less
 * client the importer stood up, keyed on the folio) to the PAN-keyed client a
 * master file names — with that folio's transactions and SIPs.
 *
 * DISABLED (owner's instruction, 2026-10-08): the effect of moving money
 * between client records on valuations, business entries and reports is under
 * review. While off, such a folio is HELD BACK with a reason (Exceptions page)
 * and nothing is reassigned; the code path stays so the reviewed behaviour can
 * be switched on in one place.
 */
export const AUTO_REASSIGN_FROM_PLACEHOLDER = false;

const chunk = <T,>(arr: T[], n: number): T[][] => {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
};

export async function importRtaFolios(
  tx: Tx,
  tenantId: string,
  records: RtaFolioRecord[],
  opts: {
    dryRun?: boolean;
    assignRmId?: string | null;
    reportType?: string;
    kind?: "master" | "holdings" | "full";
    quotaCap?: number;
    /** Called after each upsert batch so the worker can report live progress. */
    onProgress?: (phase: "clients" | "folios", done: number, total: number) => void;
  } = {}
): Promise<RtaImportSummary> {
  const dryRun = !!opts.dryRun;
  const kind = opts.kind ?? "master";
  const rta = records[0]?.rta ?? "kfintech";

  // ── 0. Resolve canonical AMC + scheme names (and the AMFI scheme code, which
  //       unlocks live-NAV valuation) from the AMFI master via ISIN / name. This
  //       turns "P"/"K"/"117" into real AMC names and the file's descriptions
  //       into canonical scheme names. Read-only, so it runs for dry-run too.
  await resolveSchemeIdentity(tx, records);

  // ── 1. Resolve each folio to a CLIENT. Adults key on a VALID PAN. A minor
  //       folio is operated under a guardian and has no PAN of its own, so it
  //       keys on a deterministic synthetic id (guardian PAN + minor name) — it
  //       is NEVER merged into the guardian's own PAN. Each guardian is ensured
  //       to exist as their own client (stubbed from name if they don't
  //       otherwise appear).
  //
  //       A folio with no valid PAN keeps the client the CRM already files it
  //       under; a folio new to the CRM gets a placeholder keyed on the FOLIO.
  //       (It used to key on the holder's mobile, else email, else name — so a
  //       couple sharing one phone number, or two people called the same, were
  //       merged into ONE client.)
  //
  //       Every match obeys the client's lifecycle (lib/rta/identity.ts): a
  //       merged client resolves to its survivor; a client in Trash, or an
  //       ambiguous match, holds the folio back with a reason.
  const slug = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]/g, "");
  const dir = new InvestorDirectory(tx, tenantId);
  await dir.preload({
    pans: records.flatMap((r) => [r.investor.pan, r.investor.guardianPan]),
    folios: records.map((r) => r.folioNumber),
    nopanKeys: [...new Set(records.map((r) => nopanFolioKey(r.folioNumber)))],
  });
  const exceptions: Array<{ row: number; reason: string }> = [];

  /** The pool of CRM folio rows this record's folio is: same AMC code, else an AMC-less row. */
  const folioPool = async (r: RtaFolioRecord) => {
    const rows = await dir.foliosFor(r.folioNumber);
    const exact = rows.filter((f) => (f.amc_code ?? "").trim() === (r.amcCode ?? "").trim());
    return exact.length ? exact : rows.filter((f) => !(f.amc_code ?? "").trim());
  };
  /** Who the CRM files this folio under today. */
  const currentOwner = async (r: RtaFolioRecord): Promise<Resolution> => {
    const owners = [...new Set((await folioPool(r)).map((f) => f.investor_id).filter((x): x is string => !!x))];
    if (!owners.length) return { kind: "none" };
    if (owners.length > 1) return { kind: "ambiguous", reason: `the CRM files folio ${r.folioNumber} under ${owners.length} different clients` };
    return dir.lifecycle(owners[0]);
  };

  type KeyResult = { key: string | null; isMinor: boolean; guardianPan: string | null; noPan: boolean; block?: string };
  const clientKeyFor = async (r: RtaFolioRecord): Promise<KeyResult> => {
    const inv = r.investor;
    const isMinor = inv.category === "minor" || !!inv.isMinor;
    const own = validPan(inv.pan);
    if (isMinor) {
      const gp = validPan(inv.guardianPan);
      // ALWAYS "MINOR:"-prefixed so a minor key can never equal an adult's plain
      // PAN. Scope by guardian PAN + name when available, else the minor's own
      // PAN.
      const key = gp && inv.name ? `MINOR:${gp}:${slug(inv.name)}` : own ? `MINOR:${own}` : null;
      if (key) return { key, isMinor: true, guardianPan: gp, noPan: false };
    } else if (own) {
      return { key: own, isMinor: false, guardianPan: null, noPan: false };
    }
    // No usable PAN.
    const owner = await currentOwner(r);
    if (owner.kind === "found") return { key: `ID:${owner.id}`, isMinor, guardianPan: null, noPan: false };
    if (owner.kind !== "none") return { key: null, isMinor, guardianPan: null, noPan: false, block: owner.reason };
    // A row with NO identity at all (no PAN and no name) is a data-gap folio,
    // not a client — skip it rather than create a nameless stub.
    if (!(inv.name ?? "").trim()) return { key: null, isMinor, guardianPan: null, noPan: false };
    return { key: nopanFolioKey(r.folioNumber), isMinor, guardianPan: null, noPan: true };
  };

  type ClientEntry = {
    inv: RtaFolioRecord["investor"];
    isMinor: boolean;
    nominees: RtaFolioRecord["nominees"];
    bank: RtaFolioRecord["bank"];
  };
  const clientByKey = new Map<string, ClientEntry>();
  const recordKeys: (string | null)[] = []; // client key per record, by index
  const minorGuardianPan = new Map<string, string>(); // minor key -> guardian PAN
  const guardianNames = new Map<string, string>(); // guardian PAN -> name
  const noPanKeys = new Set<string>(); // keys whose client has NO PAN (pan stays NULL)
  /** Keys that resolve to an existing client id (no upsert): ID:<uuid> → uuid. */
  const idKeys = new Map<string, string>();
  let skippedNoPan = 0;

  for (let i = 0; i < records.length; i++) {
    const r = records[i];
    const { key, isMinor, guardianPan, noPan, block } = await clientKeyFor(r);
    if (block) {
      recordKeys.push(null);
      exceptions.push({ row: i + 1, reason: `folio ${r.folioNumber}: ${block}` });
      continue;
    }
    recordKeys.push(key);
    if (!key) {
      skippedNoPan++;
      continue;
    }
    if (key.startsWith("ID:")) {
      idKeys.set(key, key.slice(3));
      continue;
    }
    if (noPan) noPanKeys.add(key);
    if (!clientByKey.has(key)) clientByKey.set(key, { inv: r.investor, isMinor, nominees: r.nominees, bank: r.bank });
    if (isMinor && guardianPan) {
      minorGuardianPan.set(key, guardianPan);
      if (r.investor.guardianName && !guardianNames.get(guardianPan)) guardianNames.set(guardianPan, r.investor.guardianName);
      else if (!guardianNames.has(guardianPan)) guardianNames.set(guardianPan, "");
    }
  }
  // Ensure every guardian exists as an adult client.
  for (const [gp, gname] of guardianNames) {
    if (!clientByKey.has(gp)) {
      clientByKey.set(gp, {
        inv: { pan: gp, name: gname || gp, nameAsPerPan: gname || undefined, category: "individual" },
        isMinor: false,
        nominees: [],
        bank: {},
      });
    }
  }

  // Lifecycle of every key that would be upserted: an existing client in Trash
  // blocks the key (the upsert would otherwise write into the trashed row); a
  // merged one redirects to its survivor, which is NOT re-upserted.
  await dir.preloadPanColumn([...clientByKey.keys()].filter((k) => !noPanKeys.has(k)));
  const blockedKeys = new Map<string, string>();
  for (const key of [...clientByKey.keys()]) {
    const res = noPanKeys.has(key) ? await dir.byNopanKey(key) : await dir.byPanColumn(key);
    if (res.kind === "found" && res.viaMerge) {
      clientByKey.delete(key);
      noPanKeys.delete(key);
      idKeys.set(key, res.id);
    } else if (res.kind === "blocked" || res.kind === "ambiguous") {
      clientByKey.delete(key);
      noPanKeys.delete(key);
      blockedKeys.set(key, res.reason);
    }
  }
  for (let i = 0; i < records.length; i++) {
    const key = recordKeys[i];
    if (key && blockedKeys.has(key)) {
      exceptions.push({ row: i + 1, reason: `folio ${records[i].folioNumber}: ${blockedKeys.get(key)}` });
      recordKeys[i] = null;
    }
  }
  for (const [minorKey, gp] of [...minorGuardianPan]) if (blockedKeys.has(gp)) minorGuardianPan.delete(minorKey);

  const pans = [...clientByKey.keys()];
  // PAN-bearing keys (real PANs + MINOR: synthetic ids) go in the `pan` column;
  // NOPAN: keys are stored separately with pan NULL.
  const panKeys = pans.filter((k) => !noPanKeys.has(k));
  const noPanList = pans.filter((k) => noPanKeys.has(k));
  const minorsCount = [...clientByKey.values()].filter((c) => c.isMinor).length;

  // ── 2. Which PANs / folios already exist (for created-vs-updated counts) ───
  const existingPans = new Set<string>();
  for (const part of chunk(panKeys, 1000)) {
    if (!part.length) continue;
    const rows = await tx.execute(
      sql`SELECT pan FROM investors WHERE tenant_id = ${tenantId}::uuid AND pan IN (${sql.join(part.map((p) => sql`${p}`), sql`, `)})`
    );
    for (const row of rows.rows as { pan: string }[]) existingPans.add(row.pan);
  }
  // Which NOPAN clients already exist (deduped on rta_nopan_key).
  const existingNoPan = new Set<string>();
  for (const part of chunk(noPanList, 1000)) {
    if (!part.length) continue;
    const rows = await tx.execute(
      sql`SELECT rta_nopan_key FROM investors WHERE tenant_id = ${tenantId}::uuid AND rta_nopan_key IN (${sql.join(part.map((p) => sql`${p}`), sql`, `)})`
    );
    for (const row of rows.rows as { rta_nopan_key: string }[]) existingNoPan.add(row.rta_nopan_key);
  }

  const folioRecords = records.filter((_, i) => !!recordKeys[i]);
  const folioKeys = folioRecords.map((r) => `${r.amcCode}::${r.folioNumber}`);
  const allFolioNumbers = [...new Set(folioRecords.map((r) => r.folioNumber))];
  const existingFolios = new Set<string>();
  for (const part of chunk(allFolioNumbers, 1000)) {
    if (!part.length) continue;
    const rows = await tx.execute(
      sql`SELECT amc_code, folio_number FROM folios WHERE tenant_id = ${tenantId}::uuid AND folio_number IN (${sql.join(part.map((p) => sql`${p}`), sql`, `)})`
    );
    for (const row of rows.rows as { amc_code: string; folio_number: string }[]) {
      existingFolios.add(`${row.amc_code}::${row.folio_number}`);
    }
  }

  // AMC breakdown (for the summary UI).
  const amcCount = new Map<string, { name: string; folios: number }>();
  for (const r of records) {
    const e = amcCount.get(r.amcCode) ?? { name: r.amcName, folios: 0 };
    e.folios++;
    amcCount.set(r.amcCode, e);
  }
  const amcs = [...amcCount.entries()]
    .map(([code, v]) => ({ code, name: v.name, folios: v.folios }))
    .sort((a, b) => b.folios - a.folios);

  const investorsCreated =
    panKeys.filter((p) => !existingPans.has(p)).length +
    noPanList.filter((k) => !existingNoPan.has(k)).length;
  const linkedExisting = new Set(idKeys.values()).size;
  const investorsUpdated = pans.length - investorsCreated + linkedExisting;
  const uniqueFolioKeys = [...new Set(folioKeys)];
  const foliosCreated = uniqueFolioKeys.filter((k) => !existingFolios.has(k)).length;
  const foliosUpdated = uniqueFolioKeys.length - foliosCreated;
  const schemes = records.reduce((n, r) => n + r.schemes.length, 0);

  const summary: RtaImportSummary = {
    dryRun,
    rta,
    reportType: opts.reportType ?? "",
    investors: { total: pans.length + linkedExisting, created: investorsCreated, updated: investorsUpdated, minors: minorsCount },
    folios: { total: uniqueFolioKeys.length, created: foliosCreated, updated: foliosUpdated, skippedNoPan },
    schemes,
    aum: kind !== "master" ? records.reduce((n, r) => n + (r.aum ?? 0), 0) : undefined,
    amcs,
    exceptions,
    moved: { folios: 0, transactions: 0, sips: 0 },
  };

  if (dryRun) return summary;

  // ── 2b. Plan client-count gate. A bulk RTA master import was the one path that
  //       could add net-new clients past the plan's `maxInvestors` cap (the
  //       single-create + lead-convert paths enforce it; this didn't). Reject
  //       cleanly BEFORE any write so folio/family linkage is never half-built.
  //       `quotaCap` is passed by the caller from the tenant licence.
  if (opts.quotaCap && opts.quotaCap < 1e9 && investorsCreated > 0) {
    const countRow = (await tx.execute(
      sql`SELECT count(*)::int c FROM investors WHERE tenant_id = ${tenantId}::uuid AND status <> 'closed'`
    )).rows[0] as { c?: number } | undefined;
    const current = Number(countRow?.c ?? 0);
    if (current + investorsCreated > opts.quotaCap) {
      const room = Math.max(0, opts.quotaCap - current);
      throw Object.assign(
        new Error(`This RTA import would add ${investorsCreated} new client(s), but your plan (${opts.quotaCap} clients, ${current} in use) has ${room} remaining. Upgrade your plan or split the file.`),
        { status: 402 }
      );
    }
  }

  // ── 3. Upsert investors. The master feed fills KYC/contact/nominee/bank; the
  //       holdings feed only refreshes contact + address (never KYC/nominee/bank
  //       /category), so a holdings import can't degrade master data. ──────────
  const masterInvestorSet = {
    nameAsPerPan: sql`excluded.name_as_per_pan`,
    dob: sql`coalesce(${investors.dob}, excluded.dob)`,
    email: sql`coalesce(nullif(excluded.email, ''), ${investors.email})`,
    phone: sql`coalesce(nullif(excluded.phone, ''), ${investors.phone})`,
    whatsappPhone: sql`coalesce(nullif(excluded.whatsapp_phone, ''), ${investors.whatsappPhone})`,
    occupation: sql`coalesce(nullif(excluded.occupation, ''), ${investors.occupation})`,
    address: sql`case when excluded.address is not null then excluded.address else ${investors.address} end`,
    investorCategory: sql`excluded.investor_category`,
    residencyStatus: sql`coalesce(excluded.residency_status, ${investors.residencyStatus})`,
    isMinor: sql`excluded.is_minor`,
    // Only upgrade KYC to verified — never downgrade an existing status.
    kycStatus: sql`case when excluded.kyc_status = 'verified' then 'verified' else ${investors.kycStatus} end`,
    ckycNumber: sql`coalesce(nullif(excluded.ckyc_number, ''), ${investors.ckycNumber})`,
    nomineeName: sql`coalesce(nullif(excluded.nominee_name, ''), ${investors.nomineeName})`,
    nomineeRelation: sql`coalesce(nullif(excluded.nominee_relation, ''), ${investors.nomineeRelation})`,
    nomineeDob: sql`coalesce(${investors.nomineeDob}, excluded.nominee_dob)`,
    nominees: sql`case when jsonb_array_length(excluded.nominees) > 0 then excluded.nominees else ${investors.nominees} end`,
    bankName: sql`coalesce(nullif(excluded.bank_name, ''), ${investors.bankName})`,
    bankAccountNumberMasked: sql`coalesce(nullif(excluded.bank_account_masked, ''), ${investors.bankAccountNumberMasked})`,
    bankIfsc: sql`coalesce(nullif(excluded.bank_ifsc, ''), ${investors.bankIfsc})`,
    bankAccounts: sql`case when jsonb_array_length(excluded.bank_accounts) > 0 then excluded.bank_accounts else ${investors.bankAccounts} end`,
    updatedAt: sql`now()`,
  };
  const holdingsInvestorSet = {
    nameAsPerPan: sql`coalesce(nullif(excluded.name_as_per_pan, ''), ${investors.nameAsPerPan})`,
    email: sql`coalesce(nullif(excluded.email, ''), ${investors.email})`,
    phone: sql`coalesce(nullif(excluded.phone, ''), ${investors.phone})`,
    whatsappPhone: sql`coalesce(nullif(excluded.whatsapp_phone, ''), ${investors.whatsappPhone})`,
    address: sql`case when excluded.address is not null then excluded.address else ${investors.address} end`,
    updatedAt: sql`now()`,
  };
  const investorSet = kind === "holdings" ? holdingsInvestorSet : masterInvestorSet;

  const buildInvValues = (key: string) => {
    const entry = clientByKey.get(key)!;
    const inv = entry.inv;
    const firstNominee = entry.nominees[0];
    return {
      tenantId,
      pan: key, // real PAN for adults; synthetic "MINOR:" id for minors
      name: inv.name || key,
      nameAsPerPan: inv.nameAsPerPan ?? inv.name ?? null,
      dob: inv.dob ?? null,
      email: inv.email ?? null,
      phone: inv.mobile ?? null,
      whatsappPhone: inv.mobile ?? null,
      occupation: inv.occupation ?? null,
      address: inv.address ?? null,
      investorCategory: inv.category,
      residencyStatus: inv.residency ?? null,
      isMinor: entry.isMinor,
      kycStatus: inv.kycVerified ? ("verified" as const) : ("pending" as const),
      ckycNumber: inv.ckycNumber ?? null,
      nomineeName: firstNominee?.name ?? null,
      nomineeRelation: firstNominee?.relation ?? null,
      nomineeDob: firstNominee?.dob ?? null,
      nominees: entry.nominees.map((n) => ({ name: n.name, relation: n.relation, dob: n.dob ?? undefined, sharePct: n.sharePct })),
      bankName: entry.bank.bankName ?? null,
      bankAccountNumberMasked: entry.bank.accountMasked ?? null,
      bankIfsc: entry.bank.ifsc ?? null,
      bankAccounts: entry.bank.bankName
        ? [{ bankName: entry.bank.bankName, accountMasked: entry.bank.accountMasked, ifsc: entry.bank.ifsc, accountType: entry.bank.accountType }]
        : [],
      rmId: opts.assignRmId ?? null,
    };
  };

  let clientsDone = 0;
  for (const part of chunk(panKeys, 400)) {
    await tx
      .insert(investors)
      .values(part.map(buildInvValues))
      .onConflictDoUpdate({
        target: [investors.tenantId, investors.pan],
        // Match the PARTIAL unique index (migration 0137). RTA rows leave
        // dedup_pan at its `true` default, so they remain PAN-deduped.
        targetWhere: sql`dedup_pan AND pan IS NOT NULL`,
        set: investorSet,
      });
    clientsDone += part.length;
    opts.onProgress?.("clients", clientsDone, pans.length);
  }
  // PAN-less clients: pan stays NULL (we never fabricate a PAN), deduped on
  // rta_nopan_key (migration 0151). Raw SQL so the Drizzle schema needn't carry
  // the column. Re-importing the same file updates in place (idempotent).
  for (const part of chunk(noPanList, 200)) {
    if (!part.length) continue;
    const rowsSql = part.map((key) => {
      const entry = clientByKey.get(key)!;
      const inv = entry.inv;
      // Only safe scalar columns (text / bool / uuid) — never the jsonb address,
      // so a raw insert can't fail-and-roll-back the whole import.
      return sql`(${tenantId}::uuid, ${key}, ${inv.name || "Unnamed (no PAN)"}, ${inv.email ?? null}, ${inv.mobile ?? null}, ${inv.mobile ?? null}, ${inv.occupation ?? null}, ${inv.category ?? "individual"}, ${inv.residency ?? null}, ${entry.isMinor}, ${inv.kycVerified ? "verified" : "pending"}, ${opts.assignRmId ?? null}::uuid)`;
    });
    // Isolated in a SAVEPOINT: if this PAN-less batch ever fails, roll back JUST
    // it and continue — the PAN clients + folios still import (those folios just
    // skip). A no-PAN edge case must NEVER sink the whole master import.
    try {
      await tx.execute(sql`SAVEPOINT nopan_sp`);
      await tx.execute(sql`
        INSERT INTO investors (tenant_id, rta_nopan_key, name, email, phone, whatsapp_phone, occupation, investor_category, residency_status, is_minor, kyc_status, rm_id)
        VALUES ${sql.join(rowsSql, sql`, `)}
        ON CONFLICT (tenant_id, rta_nopan_key) WHERE rta_nopan_key IS NOT NULL
        DO UPDATE SET
          name = EXCLUDED.name,
          email = COALESCE(NULLIF(EXCLUDED.email, ''), investors.email),
          phone = COALESCE(NULLIF(EXCLUDED.phone, ''), investors.phone),
          whatsapp_phone = COALESCE(NULLIF(EXCLUDED.whatsapp_phone, ''), investors.whatsapp_phone),
          occupation = COALESCE(NULLIF(EXCLUDED.occupation, ''), investors.occupation),
          updated_at = now()
      `);
      await tx.execute(sql`RELEASE SAVEPOINT nopan_sp`);
    } catch (e) {
      await tx.execute(sql`ROLLBACK TO SAVEPOINT nopan_sp`).catch(() => {});
      console.error("[rta-import] PAN-less batch skipped:", (e as any)?.message ?? e);
    }
    clientsDone += part.length;
    opts.onProgress?.("clients", clientsDone, pans.length);
  }

  // ── 4. Resolve client key → investor id, then upsert folios ────────────────
  const keyToId = new Map<string, string>(idKeys);
  for (const part of chunk(panKeys, 1000)) {
    if (!part.length) continue;
    const rows = await tx.execute(
      sql`SELECT id, pan FROM investors WHERE tenant_id = ${tenantId}::uuid AND pan IN (${sql.join(part.map((p) => sql`${p}`), sql`, `)})`
    );
    for (const row of rows.rows as { id: string; pan: string }[]) keyToId.set(row.pan, String(row.id));
  }
  for (const part of chunk(noPanList, 1000)) {
    if (!part.length) continue;
    const rows = await tx.execute(
      sql`SELECT id, rta_nopan_key FROM investors WHERE tenant_id = ${tenantId}::uuid AND rta_nopan_key IN (${sql.join(part.map((p) => sql`${p}`), sql`, `)})`
    );
    for (const row of rows.rows as { id: string; rta_nopan_key: string }[]) keyToId.set(row.rta_nopan_key, String(row.id));
  }

  // Dedupe folios by (amcCode, folioNumber); merge schemes. Carry the client key
  // so a minor's folio attaches to the MINOR, not the guardian.
  const folioByKey = new Map<string, { r: RtaFolioRecord; clientKey: string }>();
  for (let i = 0; i < records.length; i++) {
    const clientKey = recordKeys[i];
    if (!clientKey) continue;
    const r = records[i];
    const fk = `${r.amcCode}::${r.folioNumber}`;
    const existing = folioByKey.get(fk);
    if (!existing) folioByKey.set(fk, { r: { ...r, schemes: [...r.schemes] }, clientKey });
    // Keyed on (scheme, ARN) — see the mergedSchemes note below. Two records for
    // one folio can legitimately carry the same scheme under different broker
    // codes, and dropping the second as a duplicate loses that ARN's units.
    else for (const s of r.schemes)
      if (!existing.r.schemes.some((x) => x.schemeCode === s.schemeCode && x.arn === s.arn)) existing.r.schemes.push(s);
  }

  const folioValues = [...folioByKey.values()]
    .map(({ r, clientKey }) => {
      const investorId = keyToId.get(clientKey);
      if (!investorId) return null;
      return {
        tenantId,
        investorId,
        folioNumber: r.folioNumber,
        amcCode: r.amcCode,
        amcName: r.amcName || r.amcCode,
        rta: r.rta,
        schemes: r.schemes,
        ...(r.aum != null ? { aum: String(r.aum) } : {}),
      };
    })
    .filter(Boolean) as Array<{ tenantId: string; investorId: string; folioNumber: string; amcCode: string; amcName: string; rta: "kfintech" | "cams"; schemes: RtaFolioRecord["schemes"]; aum?: string }>;

  // Holdings is authoritative for valuations; the master must NOT wipe schemes a
  // prior holdings import wrote (only set them when the folio has none yet).
  //
  // A holdings file MERGES its legs in — it must never replace the array. These
  // reports are scoped per subscription, so one file routinely covers a SUBSET
  // of a folio's schemes. `schemes = excluded.schemes` deleted every scheme the
  // incoming file happened not to mention.
  //
  // On VSN Financial Services, two MFSD203 files auto-imported at 23:22 on
  // 3 Sep and did exactly that across 943 folios — one went from 27 legs to 2,
  // another 9 to 1 — wiping Rs 83.64 Cr of holdings from 1,184 folios. The AUM
  // statement path was fixed for this in an earlier commit; cas_holdings still
  // ran through here.
  //
  // Match an existing leg by scheme code OR by normalised scheme name: the rich
  // importer rewrites schemeCode to the AMFI code via resolveSchemeIdentity, so
  // the same holding legitimately appears under two different codes and a
  // code-only match would leave a duplicate behind.
  //
  // AND BY ARN. A firm holding several ARNs gets one mailback file per broker
  // code, and a client who bought the same scheme in the same folio through two
  // of them has their units SPLIT across the two files — complementary halves,
  // not restatements. Matching on scheme alone made the second file's slice
  // overwrite the first, so the folio kept whichever ARN imported last and the
  // rest of the holding vanished.
  //
  // Measured on VSN Financial Services: 731 holdings under-valued by Rs 32.93 Cr
  // against the registrars' own statements. One example — folio 18069442/27,
  // ICICI Large & Mid Cap: ARN-114688 holds 11,284.153 units and ARN-90577
  // holds 7,289.173, so the folio owns 18,573.326 units worth Rs 1.94 Cr. The
  // CRM stored Rs 76.05 lakh, the ARN-90577 slice on its own.
  //
  // A leg with a NULL arn matches ANY incoming arn on purpose: legs written
  // before this change carry no ARN, and treating them as a distinct slice
  // would ADD the incoming one alongside and double count. They are replaced
  // instead, so the register converges on correct slices as each ARN's file
  // re-imports, and never overstates on the way there.
  const mergedSchemes = sql`(
    SELECT COALESCE(jsonb_agg(keep), '[]'::jsonb)
      FROM jsonb_array_elements(COALESCE(${foliosTable.schemes}, '[]'::jsonb)) AS keep
     WHERE NOT EXISTS (
       SELECT 1 FROM jsonb_array_elements(COALESCE(excluded.schemes, '[]'::jsonb)) AS incoming
        WHERE (
                (incoming->>'schemeCode') = (keep->>'schemeCode')
             OR lower(regexp_replace(COALESCE(incoming->>'schemeName',''), '[^a-zA-Z0-9]+', '', 'g'))
              = lower(regexp_replace(COALESCE(keep->>'schemeName',''),     '[^a-zA-Z0-9]+', '', 'g'))
              )
          -- A MISSING arn is a WILDCARD ON BOTH SIDES, and both directions
          -- matter:
          --   stored none, incoming one -> a leg written before per-ARN
          --      slicing; replace it, do not add a second copy.
          --   stored one, incoming none -> a report whose layout carries no
          --      broker column (some CAMS WBR9 and KFintech MFSD310/311
          --      variants). Replace too: a restatement, not a new slice.
          --   both present and different -> genuinely two ARNs' halves of one
          --      holding; keep both. That is the point of slicing.
          --
          -- Handling only the first direction was a real bug. Between 5 and
          -- 7 Sep, master and MFSD310 imports with no broker column appended
          -- arn-less copies beside the ARN'd legs they restated: 721
          -- folio+scheme pairs stored twice, the book Rs 37.27 Cr too high.
          --   folio 1000012686 Y1035 99,995 units ARN-114688 Rs 18,24,708.76
          --   folio 1000012686 Y1035 99,995 units (no arn)   Rs 18,22,008.90
          --
          -- Collapsing a split onto one arn-less leg loses which ARN earns on
          -- it until the next ARN'd statement restores it. That is the right
          -- way to be wrong: an understated split is recoverable, a double
          -- count looks correct.
          AND (
                (keep->>'arn') IS NULL
             OR (incoming->>'arn') IS NULL
             OR (keep->>'arn') = (incoming->>'arn')
              )
     )
  ) || COALESCE(excluded.schemes, '[]'::jsonb)`;

  const folioSet =
    kind !== "master"
      ? {
          investorId: sql`excluded.investor_id`,
          amcName: sql`excluded.amc_name`,
          rta: sql`excluded.rta`,
          schemes: mergedSchemes,
          // Re-total from the MERGED array — `excluded.aum` only covers the legs
          // in this file, so keeping it would under-report every folio the file
          // only partly covers.
          aum: sql`(
            SELECT COALESCE(SUM((leg->>'value')::numeric), 0)
              FROM jsonb_array_elements(${mergedSchemes}) AS leg
             WHERE (leg->>'value') ~ '^-?[0-9.]+$'
          )`,
          updatedAt: sql`now()`,
        }
      : {
          investorId: sql`excluded.investor_id`,
          amcName: sql`excluded.amc_name`,
          rta: sql`excluded.rta`,
          schemes: sql`case when jsonb_array_length(coalesce(${foliosTable.schemes}, '[]'::jsonb)) = 0 then excluded.schemes else ${foliosTable.schemes} end`,
          updatedAt: sql`now()`,
        };

  // ── 4a. Re-pointing an existing folio. When AUTO_REASSIGN_FROM_PLACEHOLDER
  //        is on (it is OFF — see the constant), the registrar's file may
  //        move a folio only off an import PLACEHOLDER (a client the importer
  //        stood up with no PAN of its own, keyed on the folio) onto the
  //        client the file names — and then that folio's transactions and SIPs
  //        move with it, so the money is never counted on both. A folio the CRM
  //        files under any other client is NOT reassigned: it is held back for
  //        review. (It used to be overwritten unconditionally, and the
  //        transactions stayed behind on the old client.)
  const moves: Array<{ folioNumber: string; amcCode: string; from: string; to: string }> = [];
  {
    const keep: typeof folioValues = [];
    for (const v of folioValues) {
      const rec = folioByKey.get(`${v.amcCode}::${v.folioNumber}`)!.r;
      const owners = [...new Set((await folioPool(rec)).map((f) => f.investor_id).filter((x): x is string => !!x))];
      let held: string | null = null;
      for (const owner of owners) {
        if (owner === v.investorId) continue;
        const life = await dir.lifecycle(owner);
        if (life.kind === "found" && life.id === v.investorId) continue; // merged into this client
        if (life.kind === "found" && dir.isPlaceholder(owner)) {
          if (AUTO_REASSIGN_FROM_PLACEHOLDER) {
            moves.push({ folioNumber: v.folioNumber, amcCode: v.amcCode, from: owner, to: v.investorId });
            continue;
          }
          held = `folio ${v.folioNumber} is filed under an import placeholder (a client created without a PAN); moving it and its transactions to the client this file names needs review — automatic reassignment is switched off, nothing was moved`;
          break;
        }
        held =
          life.kind === "blocked" || life.kind === "ambiguous"
            ? `folio ${v.folioNumber}: ${life.reason}`
            : `folio ${v.folioNumber} is filed under a different client in the CRM — not reassigned by this import; review it (Merge Clients, or correct the folio's client)`;
        break;
      }
      if (held) {
        exceptions.push({ row: records.indexOf(rec) + 1, reason: held });
        continue;
      }
      keep.push(v);
    }
    folioValues.splice(0, folioValues.length, ...keep);
  }

  // Who holds these folios before the upsert re-points them — a client that
  // loses folios is settled afterwards (lib/rta/former-owners.ts).
  const formerOwners = await ownersOfFolios(tx, tenantId, folioValues.map((v) => v.folioNumber));

  // Adopt any folio this tenant already holds under a BLANK amc_code before the
  // upsert runs.
  //
  // A CAMS monthly AUM statement (WBR22) carries a per-scheme product code, not
  // a folio-level AMC, so processAumStatement creates the folio with amc_code ''
  // and leaves a later master to fill it in. Nothing ever did: the conflict
  // target below is (tenant, amc_code, folio_number), so ('', '123/45') and
  // ('P', '123/45') are different keys and the master INSERTED A SECOND ROW —
  // same folio, same money, twice, under two different clients.
  //
  // Measured on Ahpal Financial Services: 9,188 folios duplicated exactly this
  // way, Rs 493.62 Cr double-counted, and 3,525 extra PAN-less clients, because
  // the AUM statement was uploaded four minutes before the folio master.
  //
  // Claiming the blank row here turns that second INSERT into the UPDATE it was
  // always meant to be. The NOT EXISTS guard skips the claim when a properly
  // coded row for the same folio already exists, so the update can never trip
  // the unique index.
  for (const part of chunk(folioValues, 400)) {
    await tx.execute(sql`
      UPDATE folios f
         SET amc_code = v.amc_code,
             amc_name = COALESCE(NULLIF(trim(f.amc_name), ''), v.amc_name),
             updated_at = now()
        FROM (VALUES ${sql.join(
          part.map((p) => sql`(${p.folioNumber}, ${p.amcCode}, ${p.amcName})`),
          sql`, `
        )}) AS v(folio_number, amc_code, amc_name)
       WHERE f.tenant_id = ${tenantId}::uuid
         AND f.folio_number = v.folio_number
         AND trim(COALESCE(f.amc_code, '')) = ''
         AND trim(COALESCE(v.amc_code, '')) <> ''
         AND NOT EXISTS (
           SELECT 1 FROM folios f2
            WHERE f2.tenant_id = f.tenant_id
              AND f2.folio_number = f.folio_number
              AND f2.amc_code = v.amc_code
         )
    `);
  }

  let foliosDone = 0;
  for (const part of chunk(folioValues, 400)) {
    await tx
      .insert(foliosTable)
      .values(part)
      .onConflictDoUpdate({
        target: [foliosTable.tenantId, foliosTable.amcCode, foliosTable.folioNumber],
        set: folioSet,
      });
    foliosDone += part.length;
    opts.onProgress?.("folios", foliosDone, folioValues.length);
  }

  // ── 4b. Move each re-pointed folio's transactions and SIPs off the
  //        placeholder — only rows on THAT folio row, nothing else of theirs.
  for (const m of moves) {
    const t = await tx.execute(sql`
      UPDATE transactions SET investor_id = ${m.to}::uuid, updated_at = now()
       WHERE tenant_id = ${tenantId}::uuid AND investor_id = ${m.from}::uuid
         AND folio_id = (SELECT id FROM folios WHERE tenant_id = ${tenantId}::uuid
                           AND amc_code = ${m.amcCode} AND folio_number = ${m.folioNumber})
      RETURNING id
    `);
    const sp = await tx.execute(sql`
      UPDATE sips SET investor_id = ${m.to}::uuid, updated_at = now()
       WHERE tenant_id = ${tenantId}::uuid AND investor_id = ${m.from}::uuid
         AND folio_id = (SELECT id FROM folios WHERE tenant_id = ${tenantId}::uuid
                           AND amc_code = ${m.amcCode} AND folio_number = ${m.folioNumber})
      RETURNING id
    `);
    summary.moved.folios++;
    summary.moved.transactions += t.rows.length;
    summary.moved.sips += sp.rows.length;
  }

  // ── 5. Holdings/full feeds refresh the cached investor AUM + last-txn-at ────
  if (kind !== "master") {
    const ids = [...new Set([...keyToId.values()])];
    for (const part of chunk(ids, 1000)) {
      if (!part.length) continue;
      await tx.execute(sql`
        UPDATE investors i SET aum = COALESCE(sub.total, 0), updated_at = now()
        FROM (
          SELECT investor_id, SUM(aum) AS total FROM folios
          WHERE tenant_id = ${tenantId}::uuid AND investor_id IN (${sql.join(part.map((p) => sql`${p}::uuid`), sql`, `)})
          GROUP BY investor_id
        ) sub
        WHERE i.id = sub.investor_id AND i.tenant_id = ${tenantId}::uuid
      `);
    }
    const txnByKey = new Map<string, string>();
    for (let i = 0; i < records.length; i++) {
      const key = recordKeys[i];
      const r = records[i];
      if (key && r.lastTransactionAt) {
        const cur = txnByKey.get(key);
        if (!cur || r.lastTransactionAt > cur) txnByKey.set(key, r.lastTransactionAt);
      }
    }
    const txnPairs = [...txnByKey.entries()]
      .map(([key, txn]) => ({ id: keyToId.get(key), txn }))
      .filter((x): x is { id: string; txn: string } => !!x.id);
    for (const part of chunk(txnPairs, 500)) {
      if (!part.length) continue;
      const idsArr = part.map((x) => x.id);
      const txnsArr = part.map((x) => x.txn);
      await tx.execute(sql`
        UPDATE investors i SET last_transaction_at = GREATEST(i.last_transaction_at, v.txn::timestamptz), updated_at = now()
        FROM (SELECT unnest(${pgArray(idsArr, "uuid")}) AS id, unnest(${pgArray(txnsArr, "date")}) AS txn) v
        WHERE i.id = v.id AND i.tenant_id = ${tenantId}::uuid
      `);
    }
  }

  // ── 5b. Settle the clients this import took folios from: a placeholder left
  //        empty is merged into the client who took them, anyone else is
  //        revalued — never left holding AUM for money that moved. ───────────
  await releaseFormerOwners(tx, tenantId, formerOwners);

  // ── 6. Link each minor to its guardian + group them into one family. ───────
  if (minorGuardianPan.size > 0) {
    const linkPairs = [...minorGuardianPan.entries()]
      .map(([minorKey, gp]) => ({ minorId: keyToId.get(minorKey), guardianId: keyToId.get(gp) }))
      .filter((x): x is { minorId: string; guardianId: string } => !!x.minorId && !!x.guardianId);

    // (a) guardian_investor_id + is_minor on each minor.
    for (const part of chunk(linkPairs, 500)) {
      if (!part.length) continue;
      const mids = part.map((x) => x.minorId);
      const gids = part.map((x) => x.guardianId);
      await tx.execute(sql`
        UPDATE investors m SET guardian_investor_id = v.gid::uuid, is_minor = true, updated_at = now()
        FROM (SELECT unnest(${pgArray(mids, "uuid")}) AS mid, unnest(${pgArray(gids, "uuid")}) AS gid) v
        WHERE m.id = v.mid AND m.tenant_id = ${tenantId}::uuid
      `);
    }

    // (b) One household family per guardian — reuse the guardian's existing
    //     family, or a family they already head (a prior import), else create one.
    const minorsByGuardian = new Map<string, string[]>();
    for (const { minorId, guardianId } of linkPairs) {
      const arr = minorsByGuardian.get(guardianId) ?? [];
      arr.push(minorId);
      minorsByGuardian.set(guardianId, arr);
    }
    const guardianIds = [...minorsByGuardian.keys()];
    const famByGuardian = new Map<string, string>();
    const gName = new Map<string, string>();
    const noFamily: string[] = [];
    for (const partIds of chunk(guardianIds, 1000)) {
      if (!partIds.length) continue;
      const rows = await tx.execute(
        sql`SELECT id, family_id, name FROM investors WHERE tenant_id = ${tenantId}::uuid AND id IN (${sql.join(partIds.map((p) => sql`${p}::uuid`), sql`, `)})`
      );
      for (const row of rows.rows as any[]) {
        const gid = String(row.id);
        gName.set(gid, row.name ?? "");
        if (row.family_id) famByGuardian.set(gid, String(row.family_id));
        else noFamily.push(gid);
      }
    }
    for (const partIds of chunk(noFamily, 1000)) {
      if (!partIds.length) continue;
      const rows = await tx.execute(
        sql`SELECT id, primary_investor_id FROM families WHERE tenant_id = ${tenantId}::uuid AND primary_investor_id IN (${sql.join(partIds.map((p) => sql`${p}::uuid`), sql`, `)})`
      );
      for (const row of rows.rows as any[]) famByGuardian.set(String(row.primary_investor_id), String(row.id));
    }
    const toCreate = noFamily.filter((gid) => !famByGuardian.has(gid));
    for (const partIds of chunk(toCreate, 300)) {
      if (!partIds.length) continue;
      const names = partIds.map((gid) => (gName.get(gid) || "Family").trim() || "Family");
      const ins = await tx.execute(sql`
        INSERT INTO families (tenant_id, head_name, family_name, primary_investor_id)
        SELECT ${tenantId}::uuid, v.nm, v.nm || ' Family', v.gid::uuid
        FROM (SELECT unnest(${pgArray(partIds, "uuid")}) AS gid, unnest(${pgArray(names, "text")}) AS nm) v
        RETURNING id, primary_investor_id
      `);
      for (const row of ins.rows as any[]) famByGuardian.set(String(row.primary_investor_id), String(row.id));
    }
    // Place the guardian in their family (only if they aren't already in one).
    const gPairs = [...famByGuardian.entries()].filter(([gid]) => minorsByGuardian.has(gid));
    for (const part of chunk(gPairs, 500)) {
      if (!part.length) continue;
      const gids = part.map(([gid]) => gid);
      const fids = part.map(([, fid]) => fid);
      await tx.execute(sql`
        UPDATE investors g SET family_id = v.fid::uuid, family_role = 'self', updated_at = now()
        FROM (SELECT unnest(${pgArray(gids, "uuid")}) AS gid, unnest(${pgArray(fids, "uuid")}) AS fid) v
        WHERE g.id = v.gid AND g.tenant_id = ${tenantId}::uuid AND g.family_id IS NULL
      `);
    }
    // Place each minor in their guardian's family.
    const mPairs: { mid: string; fid: string }[] = [];
    for (const [gid, minorIds] of minorsByGuardian) {
      const fid = famByGuardian.get(gid);
      if (!fid) continue;
      for (const mid of minorIds) mPairs.push({ mid, fid });
    }
    for (const part of chunk(mPairs, 500)) {
      if (!part.length) continue;
      const mids = part.map((x) => x.mid);
      const fids = part.map((x) => x.fid);
      await tx.execute(sql`
        UPDATE investors m SET family_id = v.fid::uuid, family_role = coalesce(m.family_role, 'minor'), updated_at = now()
        FROM (SELECT unnest(${pgArray(mids, "uuid")}) AS mid, unnest(${pgArray(fids, "uuid")}) AS fid) v
        WHERE m.id = v.mid AND m.tenant_id = ${tenantId}::uuid
          -- never pull a minor out of a family an RM already put them in
          AND (m.family_id IS NULL OR m.family_id = v.fid::uuid)
      `);
    }
  }

  return summary;
}
