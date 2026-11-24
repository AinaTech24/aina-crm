/**
 * KYC from the registrar file (2026-11-24): the parsers matched ONE spelling in ONE column, and the import
 * let a client's FIRST folio decide the status, so clients whose KYC the file carries stayed "pending".
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { registrarKycOk } from "@/lib/rta/kyc-flag";
import { parseCamsFile } from "@/lib/rta/cams";
import { parseKfintechFolioMaster } from "@/lib/rta/kfintech";
import type { RtaFolioRecord } from "@/lib/rta/types";

describe("registrarKycOk", () => {
  it.each(["KYC OK", "kyc ok", "Y", "y", "YES", "Verified", "KYC Verified", "Validated", "KRA Verified", "Compliant", "Registered", " KYC  OK "])(
    "%j is done", (v) => expect(registrarKycOk(v)).toBe(true));
  it.each(["", "N", "NO", "KYC NOT OK", "NOT OK", "Pending", "KYC Pending", "Failed", "KYC Failed", "On Hold", "Rejected", "Under Process", "Not Verified", "Invalid", "0"])(
    "%j is not", (v) => expect(registrarKycOk(v)).toBe(false));
  it("empty / missing never verifies", () => {
    expect(registrarKycOk(undefined)).toBe(false);
    expect(registrarKycOk(null)).toBe(false);
  });
});

describe("the CAMS master", () => {
  const head = ["foliochk", "inv_name", "pan_no", "amc_code", "sch_name", "clos_bal", "rupee_bal"];
  const rows = (kycHead: string, ...cells: string[]) => [
    [...head, kycHead],
    ...cells.map((c, i) => ["F" + i, "Person " + i, "ABCDE123" + i + "F", "P", "Some Fund", "10", "1000", c]),
  ];
  it.each(["fh_kyc", "kyc_status", "fh_kyc_status"])("reads the verdict from the %s column", (h) => {
    const { folios } = parseCamsFile(rows(h, "KYC OK", "Y", "KYC NOT OK", ""));
    expect(folios.map((f) => !!f.investor.kycVerified)).toEqual([true, true, false, false]);
  });
});

describe("the KFintech master", () => {
  const head = ["Fund", "Folio", "Investor Name", "PAN", "Product Code", "Email"];
  const rows = (kycHead: string, ...cells: string[]) => [
    [...head, kycHead],
    ...cells.map((c, i) => ["100", "F" + i, "Person " + i, "ABCDE123" + i + "F", "P1", "a@x.in", c]),
  ];
  it.each(["Kyc1Flag", "KYC Flag", "KYC1 Flag", "KYC Status"])("reads the flag from %s", (h) => {
    const { folios } = parseKfintechFolioMaster(rows(h, "Y", "Verified", "N", ""));
    expect(folios.map((f) => !!f.investor.kycVerified)).toEqual([true, true, false, false]);
  });
});

const TEST_DB = process.env.TEST_DATABASE_URL;

describe.skipIf(!TEST_DB)("one client, several folios", () => {
  const tenant = randomUUID();
  let withSystem: typeof import("@/db/client").withSystem;
  let importRtaFolios: typeof import("@/lib/rta/import").importRtaFolios;
  let sql: typeof import("drizzle-orm").sql;
  const q = async <T = any>(t: ReturnType<typeof import("drizzle-orm").sql>) => withSystem(async (tx) => (await tx.execute(t)).rows as T[]);
  const rec = (pan: string, folio: string, kyc: boolean | undefined): RtaFolioRecord =>
    ({
      rta: "kfintech", folioNumber: folio, amcCode: "100", amcName: "Some AMC",
      investor: { pan, name: "Multi Folio", category: "individual", kycVerified: kyc },
      nominees: [], bank: {},
      schemes: [{ schemeCode: "S1", schemeName: "Fund", units: 10, nav: 100, value: 1000 }],
      aum: 1000,
    }) as unknown as RtaFolioRecord;
  const kyc = async (pan: string) => (await q<{ kyc_status: string }>(sql`SELECT kyc_status FROM investors WHERE tenant_id = ${tenant}::uuid AND pan = ${pan}`))[0]?.kyc_status;

  beforeAll(async () => {
    process.env.DATABASE_URL = TEST_DB!;
    process.env.APP_DATABASE_URL = "";
    process.env.ALLOW_SYSTEM_TX = "1";
    ({ withSystem } = await import("@/db/client"));
    ({ importRtaFolios } = await import("@/lib/rta/import"));
    ({ sql } = await import("drizzle-orm"));
    await q(sql`INSERT INTO tenants (id, legal_name, display_name, arn) VALUES (${tenant}::uuid, 'Kyc Multi', 'Kyc Multi', ${"ARN-KM-" + tenant.slice(0, 6)})`);
  });
  afterAll(async () => {
    if (!withSystem) return;
    for (const t of ["folios", "investors"]) await q(sql`DELETE FROM ${sql.raw(t)} WHERE tenant_id = ${tenant}::uuid`).catch(() => {});
    await q(sql`DELETE FROM tenants WHERE id = ${tenant}::uuid`).catch(() => {});
  });

  it("is verified when ANY of their folio records says so — not just the first", async () => {
    await withSystem((tx) => importRtaFolios(tx, tenant, [rec("AAAPA1111A", "F1", false), rec("AAAPA1111A", "F2", true)], { kind: "master" }));
    expect(await kyc("AAAPA1111A")).toBe("verified");
  });

  it("stays pending when none of them does", async () => {
    await withSystem((tx) => importRtaFolios(tx, tenant, [rec("BBBPB2222B", "G1", false), rec("BBBPB2222B", "G2", undefined)], { kind: "master" }));
    expect(await kyc("BBBPB2222B")).toBe("pending");
  });

  it("a later file without KYC never downgrades a verified client", async () => {
    await withSystem((tx) => importRtaFolios(tx, tenant, [rec("AAAPA1111A", "F1", false)], { kind: "master" }));
    expect(await kyc("AAAPA1111A")).toBe("verified");
  });
});
