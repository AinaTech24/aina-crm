/**
 * The Monthly Brokerage Statement → commission_rows → the dashboard's Brokerage
 * card. Three ways the firm's figure came out wrong:
 *   - "12,345.67" read as 12, and "(500.00)" / "500.00-" (a clawback) read as +500;
 *   - the statement's own Total line stored as a fund house, counting the month twice;
 *   - several lines for one folio / scheme / period keeping only the first.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { isStatementTotalRow, parseAmount, parseBrokerageStatement } from "@/lib/rta/parsers";

const HEAD = "AMCCode|SchemeCode|SchemeName|Folio|PAN|Type|PeriodStart|PeriodEnd|AUM|Rate|BrokerageAmount";
const line = (o: Partial<Record<string, string>> = {}) =>
  [o.amc ?? "ICICI", o.sch ?? "IC-EQ", o.name ?? "ICICI Bluechip", o.folio ?? "111/1", o.pan ?? "ABCPP1236G", o.type ?? "TRAIL",
   o.from ?? "01-04-2026", o.to ?? "30-04-2026", o.aum ?? "450000", o.rate ?? "0.0075", o.amt ?? "3375.00"].join("|");

describe("parseAmount", () => {
  it("reads the way a statement prints money", () => {
    expect(parseAmount("12,345.67")).toBe(12345.67);
    expect(parseAmount("Rs. 1,20,000.50")).toBe(120000.5);
    expect(parseAmount("₹ 500")).toBe(500);
    expect(parseAmount("0.0075")).toBe(0.0075);
  });
  it("a bracket, a leading or trailing minus, or Dr is a clawback", () => {
    expect(parseAmount("(500.00)")).toBe(-500);
    expect(parseAmount("-500.00")).toBe(-500);
    expect(parseAmount("500.00-")).toBe(-500);
    expect(parseAmount("500.00 Dr")).toBe(-500);
  });
  it("blank or unreadable is 0", () => {
    expect(parseAmount("")).toBe(0);
    expect(parseAmount(undefined)).toBe(0);
    expect(parseAmount("n/a")).toBe(0);
  });
});

describe("parseBrokerageStatement", () => {
  it("keeps thousands separators and negative lines", () => {
    const rows = parseBrokerageStatement([HEAD, line({ amt: "1,234.50", aum: "4,50,000" }), line({ folio: "222/2", amt: "(200.00)" })].join("\n"), "cams");
    expect(rows.map((r) => r.brokerageAmount)).toEqual([1234.5, -200]);
    expect(rows[0].aumAmount).toBe(450000);
  });

  it("leaves the statement's own total line out", () => {
    const text = [HEAD, line(), line({ folio: "222/2", amt: "100.00" }), "Total|||||||||0|3475.00"].join("\n");
    const rows = parseBrokerageStatement(text, "cams");
    expect(rows).toHaveLength(2);
    expect(rows.reduce((s, r) => s + r.brokerageAmount, 0)).toBe(3475);
    expect(isStatementTotalRow(["Grand Total", ""])).toBe(true);
    expect(isStatementTotalRow(["TOTAL"])).toBe(true);
    expect(isStatementTotalRow(["Totalitarian Fund"])).toBe(false);
    expect(isStatementTotalRow(["ICICI", "Bluechip"])).toBe(false);
  });
});

const TEST_DB = process.env.TEST_DATABASE_URL;

describe.skipIf(!TEST_DB)("importing a brokerage statement", () => {
  const tenant = randomUUID();
  let withSystem: typeof import("@/db/client").withSystem;
  let sql: typeof import("drizzle-orm").sql;
  let processRtaFile: typeof import("@/lib/rta/process").processRtaFile;
  let getBrokerage: typeof import("@/lib/metrics/practice").getBrokerage;
  const q = (t: ReturnType<typeof import("drizzle-orm").sql>) => withSystem((tx) => tx.execute(t));
  const load = (text: string) =>
    withSystem((tx) => processRtaFile(tx, { tenantId: tenant, source: "cams", kind: "monthly_brokerage", text }));
  const total = async () => Number(((await q(sql`SELECT COALESCE(SUM(brokerage_amount), 0) AS t FROM commission_rows WHERE tenant_id = ${tenant}::uuid`)).rows[0] as any).t);

  beforeAll(async () => {
    process.env.DATABASE_URL = TEST_DB!;
    process.env.APP_DATABASE_URL = "";
    process.env.ALLOW_SYSTEM_TX = "1";
    ({ withSystem } = await import("@/db/client"));
    ({ sql } = await import("drizzle-orm"));
    ({ processRtaFile } = await import("@/lib/rta/process"));
    ({ getBrokerage } = await import("@/lib/metrics/practice"));
    await q(sql`INSERT INTO tenants (id, legal_name, display_name, arn) VALUES (${tenant}::uuid, 'Brokerage', 'Brokerage', ${"ARN-BR-" + tenant.slice(0, 6)})`);
  }, 60_000);

  afterAll(async () => {
    if (!withSystem) return;
    await q(sql`DELETE FROM commission_rows WHERE tenant_id = ${tenant}::uuid`).catch(() => {});
    await q(sql`DELETE FROM tenants WHERE id = ${tenant}::uuid`).catch(() => {});
  });

  it("adds lines that share a key instead of keeping the first, and a clawback takes away", async () => {
    const text = [
      HEAD,
      line({ type: "UPFRONT", amt: "1,000.00" }),
      line({ type: "UPFRONT", amt: "500.00" }), // a second upfront line, same folio / scheme / period
      line({ type: "UPFRONT", amt: "(150.00)" }), // a clawback on it
      line({ folio: "222/2", amt: "2,000.00" }),
    ].join("\n");
    await load(text);
    expect(await total()).toBe(3350);
  });

  it("uploading the same statement again changes nothing; a corrected one replaces it", async () => {
    const text = [HEAD, line({ type: "UPFRONT", amt: "1,000.00" }), line({ type: "UPFRONT", amt: "500.00" }), line({ type: "UPFRONT", amt: "(150.00)" }), line({ folio: "222/2", amt: "2,000.00" })].join("\n");
    await load(text);
    expect(await total()).toBe(3350);
    await load([HEAD, line({ type: "UPFRONT", amt: "1,200.00" }), line({ folio: "222/2", amt: "2,000.00" })].join("\n"));
    expect(await total()).toBe(3200);
  });

  it("the card ignores a Total line already stored, and counts the rest", async () => {
    await q(sql`INSERT INTO commission_rows (tenant_id, amc_code, scheme_code, folio_number, brokerage_type, period_start, period_end, brokerage_amount)
                VALUES (${tenant}::uuid, 'Total', '', '', 'other', '2026-04-01', '2026-04-30', 3200)`);
    const b = await withSystem((tx) => getBrokerage(tx, tenant, { from: "2026-04-01", to: "2026-04-30" } as any));
    expect(b.byMonth.find((m) => m.month === "2026-04")?.amount).toBe(3200);
    expect(b.byAmc.map((a) => a.amc)).not.toContain("TOTAL");
  });
});

describe("a header whose brokerage column is not recognised", () => {
  it("fails the import instead of storing ₹0 for every line", () => {
    expect(() => parseBrokerageStatement(["Folio|PAN|Weird|Other", "1/1|ABCPP1236G|1|2"].join("\n"), "cams")).toThrow(/amount column was not recognised/);
  });
});
