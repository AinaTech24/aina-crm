/**
 * The SIP rejection report → sip_rejections (the SIP Rejections page).
 *
 * The report names a client by folio, often with no PAN. The import used to
 * look the folio up by exact text, so "1234567 / 89" in the report never met
 * "1234567/89" in the book and every row was skipped "not in client master":
 * the upload "worked" and the page stayed empty.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { parseSipRejectionReport } from "@/lib/rta/parsers";

const HEAD = "AMC_CODE|FOLIO_NO|PAN|SCHEME|REJ_DATE|SIP_AMT|REASON";
const row = (o: Partial<Record<string, string>> = {}) =>
  [o.amc ?? "P", o.folio ?? "1234567/89", o.pan ?? "", o.scheme ?? "ICICI Bluechip", o.date ?? "25-05-2026", o.amt ?? "5,000.00", o.reason ?? "Insufficient funds"].join("|");

describe("parseSipRejectionReport", () => {
  it("reads the usual CAMS column names, a comma amount and no PAN", () => {
    const [r] = parseSipRejectionReport([HEAD, row()].join("\n"), "cams");
    expect(r.amcName).toBe("P");
    expect(r.folioNumber).toBe("1234567/89");
    expect(r.rejectionDate).toBe("2026-05-25");
    expect(r.amount).toBe(5000);
    expect(r.reason).toBe("Insufficient funds");
  });

  it("an unreadable date is blank, not today", () => {
    const [r] = parseSipRejectionReport([HEAD, row({ date: "soon" })].join("\n"), "cams");
    expect(r.rejectionDate).toBe("");
  });
});

const TEST_DB = process.env.TEST_DATABASE_URL;

describe.skipIf(!TEST_DB)("importing a SIP rejection report", () => {
  const tenant = randomUUID();
  const asha = randomUUID();
  const ravi = randomUUID();
  const bina = randomUUID();
  let withSystem: typeof import("@/db/client").withSystem;
  let sql: typeof import("drizzle-orm").sql;
  let processRtaFile: typeof import("@/lib/rta/process").processRtaFile;
  const q = (t: ReturnType<typeof import("drizzle-orm").sql>) => withSystem((tx) => tx.execute(t));
  const load = (text: string) =>
    withSystem((tx) => processRtaFile(tx, { tenantId: tenant, source: "cams", kind: "sip_rejection_report", text }));
  const count = async () => Number(((await q(sql`SELECT count(*) AS n FROM sip_rejections WHERE tenant_id = ${tenant}::uuid`)).rows[0] as any).n);

  beforeAll(async () => {
    process.env.DATABASE_URL = TEST_DB!;
    process.env.APP_DATABASE_URL = "";
    process.env.ALLOW_SYSTEM_TX = "1";
    ({ withSystem } = await import("@/db/client"));
    ({ sql } = await import("drizzle-orm"));
    ({ processRtaFile } = await import("@/lib/rta/process"));
    await q(sql`INSERT INTO tenants (id, legal_name, display_name, arn) VALUES (${tenant}::uuid, 'Rej', 'Rej', ${"ARN-RJ-" + tenant.slice(0, 6)})`);
    for (const [id, name, pan] of [[asha, "Asha", "AAAAA1111A"], [ravi, "Ravi", "BBBBB2222B"], [bina, "Bina", "CCCCC3333C"]]) {
      await q(sql`INSERT INTO investors (id, tenant_id, pan, name, dedup_pan) VALUES (${id}::uuid, ${tenant}::uuid, ${pan}, ${name}, true)`);
    }
    // Asha's folio is stored as "1234567 / 89"; Ravi and Bina hold the SAME number at two AMCs.
    await q(sql`INSERT INTO folios (tenant_id, investor_id, folio_number, amc_code, amc_name, rta) VALUES
      (${tenant}::uuid, ${asha}::uuid, '1234567 / 89', 'P', 'ICICI', 'cams'),
      (${tenant}::uuid, ${ravi}::uuid, '555/1', 'H', 'HDFC', 'cams'),
      (${tenant}::uuid, ${bina}::uuid, '555/1', 'D', 'DSP', 'cams')`);
  }, 60_000);

  afterAll(async () => {
    if (!withSystem) return;
    for (const t of ["events_outbox", "sip_rejections", "folios", "investors"]) await q(sql.raw(`DELETE FROM ${t} WHERE tenant_id = '${tenant}'`)).catch(() => {});
    await q(sql`DELETE FROM tenants WHERE id = ${tenant}::uuid`).catch(() => {});
  });

  it("finds the client by folio however the number is written, with no PAN", async () => {
    const r = await load([HEAD, row({ folio: "1234567/89" })].join("\n"));
    expect(r.rowsImported).toBe(1);
    expect(r.rowsSkipped).toBe(0);
    const rec = (await q(sql`SELECT investor_id, rejection_amount::float8 AS amt FROM sip_rejections WHERE tenant_id = ${tenant}::uuid`)).rows[0] as any;
    expect(rec.investor_id).toBe(asha);
    expect(rec.amt).toBe(5000);
  });

  it("uploading the same report again is a clean no-op, not 'failed'", async () => {
    const r = await load([HEAD, row({ folio: "1234567/89" })].join("\n"));
    expect(r.rowsImported).toBe(0);
    expect(r.rowsSkipped).toBe(0);
    expect(r.rowsFailed).toBe(0);
    expect(r.errors.some((e: any) => /already in the CRM/.test(e.reason))).toBe(true);
    expect(await count()).toBe(1);
  });

  it("a folio held at two AMCs goes to the client of the row's AMC — or nowhere, never a guess", async () => {
    const r = await load([HEAD, row({ folio: "555/1", amc: "D", date: "26-05-2026" }), row({ folio: "555/1", amc: "", date: "27-05-2026" })].join("\n"));
    expect(r.rowsImported).toBe(1);
    expect(r.rowsSkipped).toBe(1);
    const rec = (await q(sql`SELECT investor_id FROM sip_rejections WHERE tenant_id = ${tenant}::uuid AND rejection_date = '2026-05-26'`)).rows[0] as any;
    expect(rec.investor_id).toBe(bina);
    expect(r.errors.some((e: any) => /more than one client/.test(e.reason))).toBe(true);
  });

  it("a row with no readable date is skipped with the reason, never dated today", async () => {
    const before = await count();
    const r = await load([HEAD, row({ folio: "1234567/89", date: "" })].join("\n"));
    expect(r.rowsSkipped).toBe(1);
    expect(await count()).toBe(before);
    expect(r.errors[0].reason).toMatch(/rejection date/);
  });
});
