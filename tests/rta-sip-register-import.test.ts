/**
 * The SIP register import end to end (processSipBook): the cases that made a firm's SIP book
 * "not increase" however many registrar files were uploaded (Ahpal, 2026-11-23).
 *
 *   · cancelled + re-registered in the SAME scheme: the cancelled row used to stop the live one;
 *   · two live SIPs in one folio + scheme collapsed into one;
 *   · a transfer / withdrawal registration (STP, SWP) is not a SIP and must not stop one;
 *   · a closed client's SIPs are not in the book and the import now says so;
 *   · re-importing changes nothing (no fresh stopped copy per run).
 *
 * DB-backed (TEST_DATABASE_URL), skipped otherwise.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";

const TEST_DB = process.env.TEST_DATABASE_URL;

const HDR = "AMC_CODE|PRODUCT_CODE|FOLIO_NO|INV_NAME|PAN_NO|AUT_TRNTYP|SCHEME|TARGET_SCH|AUTO_AMOUN|PERIODICIT|PERIOD_DAY|FROM_DATE|TO_DATE|CEASE_DATE|REMARKS";
type R = Partial<Record<"folio" | "type" | "tgt" | "amt" | "day" | "from" | "cease", string>>;
const line = (o: R) =>
  ["P", "1746", o.folio ?? "1111", "A", "", o.type ?? "P", "Scheme X", o.tgt ?? "", o.amt ?? "5000", "OM", o.day ?? "5", o.from ?? "1/5/2024 12:00 AM", "12/5/2040 12:00 AM", o.cease ?? "", ""].join("|");
const register = (...rows: R[]) => [HDR, ...rows.map(line)].join("\n");

describe.skipIf(!TEST_DB)("importing a SIP register", () => {
  const tenant = randomUUID();
  let withSystem: typeof import("@/db/client").withSystem;
  let sql: typeof import("drizzle-orm").sql;
  let processRtaFile: typeof import("@/lib/rta/process").processRtaFile;
  let getSipBook: typeof import("@/lib/metrics/sip").getSipBook;

  const q = async <T = any>(t: ReturnType<typeof import("drizzle-orm").sql>) => withSystem(async (tx) => (await tx.execute(t)).rows as T[]);
  const load = (text: string) => withSystem((tx) => processRtaFile(tx, { tenantId: tenant, source: "cams", kind: "monthly_sip_book", text }));
  const sips = (folio: string) =>
    q<{ amount: number; status: string; start_date: string | null }>(
      sql`SELECT amount::float AS amount, status, start_date::text AS start_date FROM sips WHERE tenant_id = ${tenant}::uuid AND folio_number = ${folio} ORDER BY amount`,
    );
  const bookFor = async () => Number((await withSystem((tx) => getSipBook(tx, { tenantId: tenant } as never))).monthly);

  async function client(name: string, folio: string, status = "active") {
    const id = randomUUID();
    await q(sql`INSERT INTO investors (id, tenant_id, name, pan, dedup_pan, status) VALUES (${id}::uuid, ${tenant}::uuid, ${name}, ${"PAN" + id.slice(0, 7).toUpperCase()}, true, ${status})`);
    await q(sql`INSERT INTO folios (tenant_id, investor_id, folio_number, amc_code, amc_name, rta) VALUES (${tenant}::uuid, ${id}::uuid, ${folio}, 'P', 'ICICI Prudential', 'cams')`);
    return id;
  }
  const reset = async () => {
    await q(sql`DELETE FROM sips WHERE tenant_id = ${tenant}::uuid`);
  };

  beforeAll(async () => {
    process.env.DATABASE_URL = TEST_DB!;
    process.env.APP_DATABASE_URL = "";
    process.env.ALLOW_SYSTEM_TX = "1";
    ({ withSystem } = await import("@/db/client"));
    ({ sql } = await import("drizzle-orm"));
    ({ processRtaFile } = await import("@/lib/rta/process"));
    ({ getSipBook } = await import("@/lib/metrics/sip"));
    await q(sql`INSERT INTO tenants (id, legal_name, display_name, arn) VALUES (${tenant}::uuid, 'Sip Reg', 'Sip Reg', ${"ARN-SR-" + tenant.slice(0, 6)})`);
    await client("Asha", "1111");
    await client("Closed Client", "2222", "exited");
    await client("Ravi", "3333");
  });

  afterAll(async () => {
    if (!withSystem) return;
    for (const t of ["sips", "folios", "investors"]) await q(sql`DELETE FROM ${sql.raw(t)} WHERE tenant_id = ${tenant}::uuid`).catch(() => {});
    await q(sql`DELETE FROM tenants WHERE id = ${tenant}::uuid`).catch(() => {});
  });

  const cancelledOld: R = { amt: "2000", from: "1/5/2020 12:00 AM", cease: "1/5/2024 12:00 AM" };
  const liveNew: R = { amt: "5000", from: "1/5/2024 12:00 AM" };

  it.each([
    ["cancelled row first", [cancelledOld, liveNew]],
    ["live row first", [liveNew, cancelledOld]],
  ])("a SIP cancelled and started again in the same scheme keeps the live one (%s)", async (_n, rows) => {
    await reset();
    await load(register(...rows));
    const s = await sips("1111");
    expect(s.filter((x) => x.status === "active").map((x) => x.amount)).toEqual([5000]);
    // A cancelled registration the CRM never held is history: it is left out, not stored as a SIP.
    expect(s).toHaveLength(1);
    expect(await bookFor()).toBe(5000);
  });

  it("a second import changes nothing — no new copy, same book", async () => {
    await load(register(cancelledOld, liveNew));
    await load(register(liveNew, cancelledOld));
    expect(await sips("1111")).toHaveLength(1);
    expect(await bookFor()).toBe(5000);
  });

  it("two live SIPs in one folio and scheme are both kept", async () => {
    await reset();
    await load(register({ amt: "5000", from: "1/5/2024 12:00 AM", day: "5" }, { amt: "3000", from: "3/20/2025 12:00 AM", day: "20" }));
    expect((await sips("1111")).map((x) => x.amount)).toEqual([3000, 5000]);
    expect(await bookFor()).toBe(8000);
  });

  it("two SIPs registered the same day for different debit days stay two", async () => {
    await reset();
    await load(register({ amt: "5000", from: "1/5/2024 12:00 AM", day: "5" }, { amt: "3000", from: "1/5/2024 12:00 AM", day: "20" }));
    expect(await bookFor()).toBe(8000);
  });

  it("a step-up (same registration, higher amount) updates the SIP rather than adding one", async () => {
    await reset();
    await load(register({ amt: "5000", from: "1/5/2024 12:00 AM" }));
    await load(register({ amt: "6000", from: "1/5/2024 12:00 AM" }));
    expect((await sips("1111")).map((x) => x.amount)).toEqual([6000]);
    expect(await bookFor()).toBe(6000);
  });

  it("an STP / SWP registration is not a SIP and does not stop the SIP beside it", async () => {
    await reset();
    await load(register(liveNew));
    await load(register({ type: "SO", amt: "1000", from: "1/5/2024 12:00 AM" }, liveNew));
    expect(await bookFor()).toBe(5000);
    expect((await sips("1111")).filter((x) => x.status === "active")).toHaveLength(1);
  });

  it("a closed client's SIP is left out of the book and the import says so", async () => {
    await reset();
    const out = await load(register(liveNew, { folio: "2222", amt: "7000" }));
    expect(await bookFor()).toBe(5000);
    const note = String(out.errors?.[0]?.reason ?? "");
    expect(note).toMatch(/1 live SIP belongs to 1 client who is closed/);
  });

  it("a cancelled row stops only the registration it names — an earlier one the CRM held", async () => {
    await reset();
    await load(register({ amt: "2000", from: "1/5/2020 12:00 AM" }, liveNew)); // both live
    expect(await bookFor()).toBe(7000);
    await load(register(cancelledOld, liveNew)); // the old one is now cancelled
    const s = await sips("1111");
    expect(s.find((x) => x.amount === 2000)?.status).not.toBe("active");
    expect(s.find((x) => x.amount === 5000)?.status).toBe("active");
    expect(await bookFor()).toBe(5000);
  });

  it("a SIP the registrar marks Terminated / Expired stops, and a re-import of the same register corrects an active one", async () => {
    await reset();
    await load(register(liveNew));
    expect(await bookFor()).toBe(5000);
    // KFintech MFSD243 layout: the Status column says Terminated, with no cease date.
    const kfin = (status: string) =>
      [
        "Folio|SchCode|SchDesc|InvName|PAN|TrType|Freq|STARTDATE|ENDDATE|AMOUNT|Status",
        `1111|1746|Scheme X|A|ABCDE1234F|SIP|Monthly|01/05/2024|01/05/2040|5000|${status}`,
      ].join("\n");
    const kf = (text: string) => withSystem((tx) => processRtaFile(tx, { tenantId: tenant, source: "kfintech", kind: "monthly_sip_book", text }));
    await kf(kfin("Terminated by Investor"));
    expect(await bookFor()).toBe(0);
  });

  it("a register that is entirely cancelled leaves nothing live", async () => {
    await reset();
    await load(register(liveNew));
    await load(register({ ...liveNew, cease: "1/5/2026 12:00 AM" }));
    expect(await bookFor()).toBe(0);
  });
});
