/**
 * Phase 3D — the owner rules on the LEGACY import processors (SIP rejection
 * report, SIP register, AUM statement, folio master), against a real Postgres.
 *
 * The staging engine already resolves owners folio-first (owner.ts); these
 * processors used to resolve PAN-first and without the AMC, so a guardian's
 * PAN could attach a minor's rejection to the guardian and one folio number at
 * two AMCs read as one folio. Synthetic data only.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";

const TEST_DB = process.env.TEST_DATABASE_URL;

describe.skipIf(!TEST_DB)("RTA legacy processors — folio-first owner rules (DB)", () => {
  let withTenant: typeof import("@/db/client").withTenant;
  let withSystem: typeof import("@/db/client").withSystem;
  let sql: typeof import("drizzle-orm").sql;
  let processRtaFile: typeof import("@/lib/rta/process").processRtaFile;

  const t = randomUUID();
  const id = {
    guardian: randomUUID(), // GGGPG1111G — recorded guardian of `minor`
    minor: randomUUID(), // no PAN of its own
    x: randomUUID(), // XXXPX2222X
    y: randomUUID(), // YYYPY3333Y
    placeholder: randomUUID(), // PAN-less, folio-keyed
  };
  const PAN = { g: "GGGPG1111G", x: "XXXPX2222X", y: "YYYPY3333Y" };

  type Kind = "sip_rejection_report" | "monthly_sip_book" | "monthly_aum_statement" | "folio_master_dump";
  const run = (kind: Kind, text: string) =>
    withTenant(t, (tx) => processRtaFile(tx, { tenantId: t, source: "cams", kind, text }));
  const q = async <T = any>(query: ReturnType<typeof import("drizzle-orm").sql>) =>
    withTenant(t, async (tx) => (await tx.execute(query)).rows as T[]);

  beforeAll(async () => {
    process.env.DATABASE_URL = TEST_DB!;
    process.env.APP_DATABASE_URL = "";
    process.env.ALLOW_SYSTEM_TX = "1";
    ({ withTenant, withSystem } = await import("@/db/client"));
    ({ sql } = await import("drizzle-orm"));
    ({ processRtaFile } = await import("@/lib/rta/process"));

    await withSystem(async (tx) => {
      await tx.execute(sql`INSERT INTO tenants (id, legal_name, display_name, arn) VALUES (${t}::uuid, 'Owner Test', 'Owner Test', ${"ARN-OW" + t.slice(0, 6)})`);
      const inv = (i: string, pan: string | null, name: string) =>
        tx.execute(sql`INSERT INTO investors (id, tenant_id, pan, name) VALUES (${i}::uuid, ${t}::uuid, ${pan}, ${name})`);
      await inv(id.guardian, PAN.g, "Test Guardian");
      await inv(id.minor, null, "Test Minor");
      await inv(id.x, PAN.x, "Test X");
      await inv(id.y, PAN.y, "Test Y");
      await inv(id.placeholder, null, "Folio 700/1");
      await tx.execute(sql`UPDATE investors SET is_minor = true, investor_category = 'minor', guardian_investor_id = ${id.guardian}::uuid WHERE id = ${id.minor}::uuid`);
      await tx.execute(sql`UPDATE investors SET rta_nopan_key = 'NOPAN:FOLIO:700/1' WHERE id = ${id.placeholder}::uuid`);
      const folio = (owner: string, number: string, amc: string) =>
        tx.execute(sql`INSERT INTO folios (tenant_id, investor_id, folio_number, amc_code, amc_name, rta) VALUES (${t}::uuid, ${owner}::uuid, ${number}, ${amc}, ${"AMC " + amc}, 'cams')`);
      await folio(id.minor, "500/1", "B");
      await folio(id.x, "600/1", "B"); // the same number at two AMCs,
      await folio(id.y, "600/1", "K"); // held by two different clients
      await folio(id.placeholder, "700/1", "B");
      await folio(id.x, "800/1", "B");
    });
  });

  afterAll(async () => {
    const tryRun = async (stmt: ReturnType<typeof sql>) => {
      try {
        await withSystem((tx) => tx.execute(stmt));
      } catch {
        /* best effort */
      }
    };
    for (const table of ["events_outbox", "sip_rejections", "sips", "transactions", "folios"]) {
      await tryRun(sql.raw(`DELETE FROM ${table} WHERE tenant_id = '${t}'`));
    }
    await tryRun(sql`UPDATE investors SET guardian_investor_id = NULL WHERE tenant_id = ${t}::uuid`);
    await tryRun(sql`DELETE FROM investors WHERE tenant_id = ${t}::uuid`);
    await tryRun(sql`DELETE FROM audit_log WHERE tenant_id = ${t}::uuid`);
    await tryRun(sql`DELETE FROM tenants WHERE id = ${t}::uuid`);
  });

  it("SIP rejection report: folio decides, a guardian's PAN never takes a minor's rejection", async () => {
    const H = "FOLIO_NO|PAN|AMC_CODE|TAX_STATUS|SCH_NAME|REJECT_DATE|AMOUNT|REASON";
    const rows = [
      `500/1|${PAN.g}|B||Scheme A|01/10/2026|1000|Insufficient balance`, // minor's folio, guardian's PAN → minor
      `999/1|${PAN.g}|B||Scheme A|01/10/2026|1001|Insufficient balance`, // folio unknown, PAN guards a minor → held
      `800/1|${PAN.y}|B||Scheme A|01/10/2026|1002|Insufficient balance`, // X's folio, Y's PAN → held
      `998/1|${PAN.x}|B|Minor|Scheme A|01/10/2026|1003|Insufficient balance`, // a minor's row, folio unknown → held
      `997/1|${PAN.x}|B||Scheme A|01/10/2026|1004|Insufficient balance`, // folio unknown, X's own PAN → X
      `700/1|${PAN.y}|B||Scheme A|01/10/2026|1005|Insufficient balance`, // placeholder's folio, Y's PAN → held
      `600/1||K||Scheme A|01/10/2026|1006|Insufficient balance`, // exact AMC → Y
      `800/1|${PAN.y}|K||Scheme A|01/10/2026|1007|Insufficient balance`, // 800/1 is on record only at AMC B: Y's own folio at K → Y
    ];
    const out = await run("sip_rejection_report", [H, ...rows].join("\n"));
    expect(out.rowsImported).toBe(4);
    const got = await q<{ investor_id: string; amount: string }>(sql`SELECT investor_id, rejection_amount::text AS amount FROM sip_rejections WHERE tenant_id = ${t}::uuid ORDER BY rejection_amount`);
    expect(got.map((r) => [r.investor_id, Number(r.amount)])).toEqual([
      [id.minor, 1000],
      [id.x, 1004],
      [id.y, 1006],
      [id.y, 1007],
    ]);
    const reason = (line: number) => out.errors.find((e) => e.row === line)?.reason ?? "";
    expect(reason(3)).toMatch(/recorded guardian of a minor/);
    expect(reason(4)).toMatch(/different client/);
    expect(reason(5)).toMatch(/minor's — its PAN is the guardian's/);
    expect(reason(7)).toMatch(/different client/);
    // Errors never carry a full PAN.
    expect(JSON.stringify(out.errors)).not.toMatch(/[A-Z]{5}[0-9]{4}[A-Z]/);
  });

  it("SIP register: the AMC column picks the folio; a guardian's PAN keeps a minor's SIP on the minor", async () => {
    const H = "FOLIO_NO|PAN|AMC_CODE|SCH_CODE|SCH_NAME|AUTO_AMOUNT|PERIODICITY|FROM_DATE|AUT_TRNTYP";
    const out = await run("monthly_sip_book", [
      H,
      `600/1||K|S01|Scheme One|2000|OM|01/01/2025|P`,
      `500/1|${PAN.g}|B|S02|Scheme Two|3000|OM|01/01/2025|P`,
      `600/1|${PAN.x}|Z|S03|Scheme Three|4000|OM|01/01/2025|P`, // AMC Z not on record; the number alone has two owners → held
    ].join("\n"));
    expect(out.rowsImported).toBe(2);
    const sips = await q<{ investor_id: string; amc: string; amount: string }>(sql`
      SELECT s.investor_id, f.amc_code AS amc, s.amount::text AS amount FROM sips s JOIN folios f ON f.id = s.folio_id
       WHERE s.tenant_id = ${t}::uuid ORDER BY s.amount`);
    expect(sips.map((s) => [s.investor_id, s.amc, Number(s.amount)])).toEqual([
      [id.y, "K", 2000],
      [id.minor, "B", 3000],
    ]);
    expect(out.errors.find((e) => e.row === 4)?.reason).toMatch(/held back/);
  });

  it("AUM statement: one folio number at two AMCs stays two holdings with two owners", async () => {
    const H = "FOLIO_NO|PAN|AMC_CODE|SCH_CODE|UNITS|NAV|AUM";
    const out = await run("monthly_aum_statement", [H, `600/1||K|K01|10|10|100`, `600/1||B|B01|20|10|200`].join("\n"));
    expect(out.rowsFailed).toBe(0);
    const f = await q<{ investor_id: string; amc_code: string; schemes: string }>(sql`
      SELECT investor_id, amc_code, schemes::text AS schemes FROM folios WHERE tenant_id = ${t}::uuid AND folio_number = '600/1' ORDER BY amc_code`);
    expect(f.map((r) => [r.investor_id, r.amc_code])).toEqual([[id.x, "B"], [id.y, "K"]]);
    expect(f[0].schemes).toContain("B01");
    expect(f[0].schemes).not.toContain("K01");
    expect(f[1].schemes).toContain("K01");
    expect(f[1].schemes).not.toContain("B01");
  });

  it("folio master: minor stays the owner, an HUF row with a Karta's PAN is held, a stated adult guardian keeps their own folio", async () => {
    const H = "FOLIO_NO|PAN|AMC_CODE|SCH_CODE|UNITS|TAX_STATUS";
    const out = await run("folio_master_dump", [
      H,
      `500/1|${PAN.g}|B|S09|5|Minor`,
      `996/1|${PAN.x}|B|S09|5|HUF`,
      `995/1|${PAN.g}|B|S09|5|Individual`,
    ].join("\n"));
    const f = await q<{ folio_number: string; investor_id: string }>(sql`
      SELECT folio_number, investor_id FROM folios WHERE tenant_id = ${t}::uuid AND folio_number IN ('500/1', '995/1', '996/1') ORDER BY folio_number`);
    expect(f.map((r) => [r.folio_number, r.investor_id])).toEqual([
      ["500/1", id.minor],
      ["995/1", id.guardian],
    ]);
    expect(out.errors.find((e) => e.row === 3)?.reason).toMatch(/HUF's with an individual \(Karta's\) PAN/);
  });
});
