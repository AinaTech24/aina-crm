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

export type RtaImportSummary = {
  dryRun: boolean;
  rta: string;
  reportType: string;
  investors: { total: number; created: number; updated: number };
  folios: { total: number; created: number; updated: number; skippedNoPan: number };
  schemes: number;
  /** Total market value across the feed (holdings imports only). */
  aum?: number;
  amcs: { code: string; name: string; folios: number }[];
};

// Drizzle transaction — typed loosely to match the codebase's withTenant callers.
type Tx = any;

const chunk = <T,>(arr: T[], n: number): T[][] => {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
};

export async function importRtaFolios(
  tx: Tx,
  tenantId: string,
  records: RtaFolioRecord[],
  opts: { dryRun?: boolean; assignRmId?: string | null; reportType?: string; kind?: "master" | "holdings" | "full" } = {}
): Promise<RtaImportSummary> {
  const dryRun = !!opts.dryRun;
  const kind = opts.kind ?? "master";
  const rta = records[0]?.rta ?? "kfintech";

  // ── 1. Dedupe investors by PAN (first occurrence wins; one feed is consistent
  //       per person). Records without a PAN can't resolve an investor. ──────
  const investorByPan = new Map<string, RtaFolioRecord["investor"]>();
  let skippedNoPan = 0;
  for (const r of records) {
    const pan = r.investor.pan;
    if (!pan) {
      skippedNoPan++;
      continue;
    }
    if (!investorByPan.has(pan)) investorByPan.set(pan, r.investor);
  }
  const pans = [...investorByPan.keys()];

  // ── 2. Which PANs / folios already exist (for created-vs-updated counts) ───
  const existingPans = new Set<string>();
  for (const part of chunk(pans, 1000)) {
    if (!part.length) continue;
    const rows = await tx.execute(
      sql`SELECT pan FROM investors WHERE tenant_id = ${tenantId}::uuid AND pan = ANY(${part})`
    );
    for (const row of rows.rows as { pan: string }[]) existingPans.add(row.pan);
  }

  const folioRecords = records.filter((r) => r.investor.pan);
  const folioKeys = folioRecords.map((r) => `${r.amcCode}::${r.folioNumber}`);
  const allFolioNumbers = [...new Set(folioRecords.map((r) => r.folioNumber))];
  const existingFolios = new Set<string>();
  for (const part of chunk(allFolioNumbers, 1000)) {
    if (!part.length) continue;
    const rows = await tx.execute(
      sql`SELECT amc_code, folio_number FROM folios WHERE tenant_id = ${tenantId}::uuid AND folio_number = ANY(${part})`
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

  const investorsCreated = pans.filter((p) => !existingPans.has(p)).length;
  const investorsUpdated = pans.length - investorsCreated;
  const uniqueFolioKeys = [...new Set(folioKeys)];
  const foliosCreated = uniqueFolioKeys.filter((k) => !existingFolios.has(k)).length;
  const foliosUpdated = uniqueFolioKeys.length - foliosCreated;
  const schemes = records.reduce((n, r) => n + r.schemes.length, 0);

  const summary: RtaImportSummary = {
    dryRun,
    rta,
    reportType: opts.reportType ?? "",
    investors: { total: pans.length, created: investorsCreated, updated: investorsUpdated },
    folios: { total: uniqueFolioKeys.length, created: foliosCreated, updated: foliosUpdated, skippedNoPan },
    schemes,
    aum: kind !== "master" ? records.reduce((n, r) => n + (r.aum ?? 0), 0) : undefined,
    amcs,
  };

  if (dryRun) return summary;

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

  for (const part of chunk(pans, 400)) {
    const values = part.map((pan) => {
      const inv = investorByPan.get(pan)!;
      const rec = records.find((r) => r.investor.pan === pan)!;
      const firstNominee = rec.nominees[0];
      return {
        tenantId,
        pan,
        name: inv.name || pan,
        nameAsPerPan: inv.nameAsPerPan ?? inv.name ?? null,
        dob: inv.dob ?? null,
        email: inv.email ?? null,
        phone: inv.mobile ?? null,
        whatsappPhone: inv.mobile ?? null,
        occupation: inv.occupation ?? null,
        address: inv.address ?? null,
        investorCategory: inv.category,
        residencyStatus: inv.residency ?? null,
        isMinor: inv.category === "minor",
        kycStatus: inv.kycVerified ? ("verified" as const) : ("pending" as const),
        ckycNumber: inv.ckycNumber ?? null,
        nomineeName: firstNominee?.name ?? null,
        nomineeRelation: firstNominee?.relation ?? null,
        nomineeDob: firstNominee?.dob ?? null,
        nominees: rec.nominees.map((n) => ({ name: n.name, relation: n.relation, dob: n.dob ?? undefined, sharePct: n.sharePct })),
        bankName: rec.bank.bankName ?? null,
        bankAccountNumberMasked: rec.bank.accountMasked ?? null,
        bankIfsc: rec.bank.ifsc ?? null,
        bankAccounts: rec.bank.bankName
          ? [{ bankName: rec.bank.bankName, accountMasked: rec.bank.accountMasked, ifsc: rec.bank.ifsc, accountType: rec.bank.accountType }]
          : [],
        rmId: opts.assignRmId ?? null,
      };
    });

    await tx
      .insert(investors)
      .values(values)
      .onConflictDoUpdate({
        target: [investors.tenantId, investors.pan],
        set: investorSet,
      });
  }

  // ── 4. Resolve PAN → investor id, then upsert folios ───────────────────────
  const panToId = new Map<string, string>();
  for (const part of chunk(pans, 1000)) {
    if (!part.length) continue;
    const rows = await tx.execute(
      sql`SELECT id, pan FROM investors WHERE tenant_id = ${tenantId}::uuid AND pan = ANY(${part})`
    );
    for (const row of rows.rows as { id: string; pan: string }[]) panToId.set(row.pan, String(row.id));
  }

  // Dedupe folios by (amcCode, folioNumber); merge schemes across rows.
  const folioByKey = new Map<string, RtaFolioRecord>();
  for (const r of folioRecords) {
    const key = `${r.amcCode}::${r.folioNumber}`;
    const existing = folioByKey.get(key);
    if (!existing) {
      folioByKey.set(key, { ...r, schemes: [...r.schemes] });
    } else {
      for (const s of r.schemes) if (!existing.schemes.some((x) => x.schemeCode === s.schemeCode)) existing.schemes.push(s);
    }
  }

  const folioValues = [...folioByKey.values()]
    .map((r) => {
      const investorId = r.investor.pan ? panToId.get(r.investor.pan) : undefined;
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
  const folioSet =
    kind !== "master"
      ? {
          investorId: sql`excluded.investor_id`,
          amcName: sql`excluded.amc_name`,
          rta: sql`excluded.rta`,
          schemes: sql`excluded.schemes`,
          aum: sql`excluded.aum`,
          updatedAt: sql`now()`,
        }
      : {
          investorId: sql`excluded.investor_id`,
          amcName: sql`excluded.amc_name`,
          rta: sql`excluded.rta`,
          schemes: sql`case when jsonb_array_length(coalesce(${foliosTable.schemes}, '[]'::jsonb)) = 0 then excluded.schemes else ${foliosTable.schemes} end`,
          updatedAt: sql`now()`,
        };

  for (const part of chunk(folioValues, 400)) {
    await tx
      .insert(foliosTable)
      .values(part)
      .onConflictDoUpdate({
        target: [foliosTable.tenantId, foliosTable.amcCode, foliosTable.folioNumber],
        set: folioSet,
      });
  }

  // ── 5. Holdings/full feeds refresh the cached investor AUM + last-txn-at ────
  if (kind !== "master") {
    const ids = [...new Set([...panToId.values()])];
    for (const part of chunk(ids, 1000)) {
      if (!part.length) continue;
      await tx.execute(sql`
        UPDATE investors i SET aum = COALESCE(sub.total, 0), updated_at = now()
        FROM (
          SELECT investor_id, SUM(aum) AS total FROM folios
          WHERE tenant_id = ${tenantId}::uuid AND investor_id = ANY(${part}::uuid[])
          GROUP BY investor_id
        ) sub
        WHERE i.id = sub.investor_id AND i.tenant_id = ${tenantId}::uuid
      `);
    }
    const txnByPan = new Map<string, string>();
    for (const r of folioRecords) {
      if (r.investor.pan && r.lastTransactionAt) {
        const cur = txnByPan.get(r.investor.pan);
        if (!cur || r.lastTransactionAt > cur) txnByPan.set(r.investor.pan, r.lastTransactionAt);
      }
    }
    const txnPairs = [...txnByPan.entries()]
      .map(([pan, txn]) => ({ id: panToId.get(pan), txn }))
      .filter((x): x is { id: string; txn: string } => !!x.id);
    for (const part of chunk(txnPairs, 500)) {
      if (!part.length) continue;
      const idsArr = part.map((x) => x.id);
      const txnsArr = part.map((x) => x.txn);
      await tx.execute(sql`
        UPDATE investors i SET last_transaction_at = GREATEST(i.last_transaction_at, v.txn::timestamptz), updated_at = now()
        FROM (SELECT unnest(${idsArr}::uuid[]) AS id, unnest(${txnsArr}::date[]) AS txn) v
        WHERE i.id = v.id AND i.tenant_id = ${tenantId}::uuid
      `);
    }
  }

  return summary;
}
