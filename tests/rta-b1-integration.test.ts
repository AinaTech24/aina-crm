/**
 * B-1 integration (2026-10-12): main's production fixes merged into the RTA
 * release. Each test pins one place where both sides' behaviour had to be kept
 * together — see docs/rta/B1_INTEGRATION.md for the decision behind each.
 *
 * The DB-backed part needs a migrated Postgres in TEST_DATABASE_URL (the
 * non-superuser app role) and ADMIN_DATABASE_URL for the global NAV table;
 * skipped otherwise.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { parseSipBook } from "@/lib/rta/parsers";
import { parseKfintechHoldings } from "@/lib/rta/kfintech";
import type { RtaFolioRecord } from "@/lib/rta/types";

// KFintech MFSD243 header, verbatim (as in tests/sip-registrar-status.test.ts); rows invented.
const MFSD243 =
  "Zone|Branch|Location|Ihno|Folio|Investor Name|RegistrationDate|Start Date|End Date|No Of Installments|Amount|Scheme|Plan|AgentCode|AgentName|Subbroker|Scheme Name|PAN|SipType|SIP Mode|Fund Code|Product Code|Frequency|Trtype|To Scheme|To Plan|TerminateDate|Status|ToProductCode|ToSchemeName|ECSNO|ECSBankName|ECSAcno|ECSHolderName|RegSlno|InvDpId|InvClientId|DP_InvName|ModifyFlag|umrncode";
const fields = (folio: string, terminate: string, status: string) =>
  `W|Pune|Pune|1|${folio}|A Client|01/01/2020|05/01/2020|05/12/2040|240|5000|BC|GP|ARN-1|X||Sundaram Business Cycle Fund|ABCDE1234F|EXISTING FOLIO WITH SIP|ECS|176|176BCGP|Monthly|SIP|||${terminate}|${status}||||||||||||`.split("|");

describe("SIP register: main's registrar columns are labels, never a reason to reject a row", () => {
  it("a row that ends before trailing optional Status / Remarks columns is read, not rejected as short", () => {
    // A register whose LAST columns are the registrar's status and remark; an
    // exporter that drops empty trailing cells leaves those rows shorter.
    const header = "FOLIO_NO|PAN|SCHEME_CODE|SCHEME_NAME|AMOUNT|FREQUENCY|START_DATE|STATUS|REMARKS";
    const short = "6201|ABCDE1234F|176BCGP|Sundaram Business Cycle Fund|5000|Monthly|05/01/2020";
    const full = "6202|ABCDE1234F|176BCGP|Sundaram Business Cycle Fund|5000|Monthly|05/01/2020|Live SIP|ok";
    const parsed = parseSipBook([header, short, full].join("\n"), "kfintech");
    expect(parsed.rejects ?? []).toHaveLength(0);
    expect(parsed.rows.map((r) => r.folioNumber)).toEqual(["6201", "6202"]);
    expect(parsed.rows[0].registrarStatus).toBeUndefined();
    expect(parsed.rows[1].registrarStatus).toBe("Live SIP");
  });

  it("an unreadable TerminateDate leaves the label empty; the SIP row itself stands", () => {
    const parsed = parseSipBook([MFSD243, fields("6202", "31/02/2024", "Terminated").join("|")].join("\n"), "kfintech");
    expect(parsed.rows).toHaveLength(1);
    expect(parsed.rows[0].registrarEndDate).toBeUndefined();
    expect(parsed.rows[0].registrarStatus).toBe("Terminated");
  });

  it("a required column cut off still rejects the row (strict reading kept)", () => {
    const cut = fields("6203", "", "").slice(0, 20).join("|"); // loses Product Code, Frequency, Trtype
    const parsed = parseSipBook([MFSD243, cut].join("\n"), "kfintech");
    expect(parsed.rows).toHaveLength(0);
    expect(parsed.rejects?.length).toBe(1);
  });
});

describe("KFintech holdings: main's PAN column aliases go through the strict PAN reader", () => {
  it("placeholder text in a 'PAN Number' column is no PAN, never a key", () => {
    const header = ["Product Code", "Fund", "Folio Number", "Fund Description", "Balance", "NAV", "AUM", "Investor Name", "Email", "PAN Number", "Mobile Number"];
    const ok = ["P1746", "117", "1234567", "Test Fund Growth", "10", "100", "1000", "ASHA MEHTA", "a@x.in", "aaapa1111a", "9876543210"];
    const bad = ["P1746", "117", "7654321", "Test Fund Growth", "10", "100", "1000", "RAVI MEHTA", "r@x.in", "PANNOTAVBL", "9876543211"];
    const { folios } = parseKfintechHoldings([header, ok, bad]);
    const byFolio = new Map(folios.map((f) => [f.folioNumber, f]));
    expect(byFolio.get("1234567")?.investor.pan).toBe("AAAPA1111A");
    expect(byFolio.get("7654321")?.investor.pan ?? null).toBeNull();
  });
});

describe("mail poller: every log line the merge touched keeps main's log-safe references", () => {
  // main (206486b6) took file names, sender addresses and URLs out of the
  // worker logs; the release added new log lines. None may print them raw.
  const src = readFileSync("src/workers/rta-inbox-poller.ts", "utf8");
  const logLines = src.split("\n").filter((l) => /console\.(log|warn|error)|captureError\(/.test(l));
  it("no file name, sender address or link is interpolated unwrapped", () => {
    for (const l of logLines) {
      expect(l).not.toMatch(/\$\{(att|file)\.filename\}/);
      expect(l).not.toMatch(/\$\{msg\.from\}/);
      expect(l).not.toMatch(/\$\{link\}/);
      expect(l).not.toMatch(/file: (att|file)\.filename\b/);
    }
  });
  it("the release's blocked-report and ingest-failure lines use fileRef / safeError", () => {
    expect(src).toMatch(/\$\{fileRef\(att\.filename\)\} blocked/);
    expect(src).toMatch(/captureError\("\[rta-inbox\] attachment ingest failed", safeError\(e\)/);
  });
});

// main's repair scripts (2026-10-08/09) write client, folio, SIP and AUM
// records; the release's rule is that no script rewrites a firm under RTA
// governance (scripts/lib/rta-script-guard.ts).
const MAIN_WRITE_SCRIPTS = [
  "repair-rta-duplicates", "repair-folio-owners", "close-silent-sips", "dedupe-folio-legs",
  "close-sips-by-feed-window", "repair-client-duplicates", "revalue-tenant-aum",
];

describe("main's repair scripts carry the release's RTA write guard", () => {
  it.each(MAIN_WRITE_SCRIPTS)("%s refuses before writing when --apply is given", (name) => {
    const src = readFileSync(`scripts/${name}.ts`, "utf8");
    expect(src).toMatch(/import \{ refuseIfRtaWritesStopped \} from "\.\/lib\/rta-script-guard";/);
    expect(src).toMatch(/if \(APPLY\) await refuseIfRtaWritesStopped\(/);
  });
});

const TEST_DB = process.env.TEST_DATABASE_URL;
const ADMIN_DB = process.env.ADMIN_DATABASE_URL;

describe.skipIf(!TEST_DB || !ADMIN_DB)("integrated importer behaviour (DB)", () => {
  let withSystem: typeof import("@/db/client").withSystem;
  let importRtaFolios: typeof import("@/lib/rta/import").importRtaFolios;
  let adoptUnknownPansByName: typeof import("@/lib/rta/process").adoptUnknownPansByName;
  let InvestorDirectory: typeof import("@/lib/rta/identity").InvestorDirectory;
  let loadValuationRows: typeof import("@/lib/finance/valuation").loadValuationRows;
  let sql: typeof import("drizzle-orm").sql;
  let admin: import("pg").Client;
  let H2p: typeof import("./helpers/two-person");
  let ops2p: import("./helpers/two-person").Operators | null = null;

  const tenant = randomUUID();
  const navCode = `B1T${tenant.slice(0, 6)}`;
  const navName = `B1 Integration Test Fund ${tenant.slice(0, 6)} - Regular Plan - Growth`;

  const rec = (pan: string | undefined, name: string, folio: string, extra: Partial<RtaFolioRecord["investor"]> = {}, schemes?: unknown[]): RtaFolioRecord =>
    ({
      rta: "kfintech",
      folioNumber: folio,
      amcCode: "117",
      amcName: "Test AMC",
      investor: { pan, name, category: "individual", ...extra },
      nominees: [],
      bank: {},
      schemes: schemes ?? [{ schemeCode: "117TFGP", schemeName: "Test Fund Growth", units: 10, nav: 100, value: 1000 }],
      aum: 1000,
    }) as unknown as RtaFolioRecord;

  const q = async <T = any>(text: ReturnType<typeof import("drizzle-orm").sql>) =>
    withSystem(async (tx) => (await tx.execute(text)).rows as T[]);
  const insertClient = (id: string, v: { name: string; pan?: string | null; isMinor?: boolean }) =>
    q(sql`
      INSERT INTO investors (id, tenant_id, name, pan, dedup_pan, is_minor)
      VALUES (${id}::uuid, ${tenant}::uuid, ${v.name}, ${v.pan ?? null}, true, ${v.isMinor ?? false})
    `);
  const withPan = (pan: string) =>
    q<{ id: string }>(sql`SELECT id FROM investors WHERE tenant_id = ${tenant}::uuid AND pan = ${pan} AND merged_into_id IS NULL`);
  const legsOf = async (folio: string) =>
    (await q<{ schemes: Array<Record<string, unknown>> }>(sql`SELECT schemes FROM folios WHERE tenant_id = ${tenant}::uuid AND folio_number = ${folio}`))[0]?.schemes ?? [];

  beforeAll(async () => {
    process.env.DATABASE_URL = TEST_DB!;
    process.env.APP_DATABASE_URL = "";
    process.env.ALLOW_SYSTEM_TX = "1";
    ({ withSystem } = await import("@/db/client"));
    ({ importRtaFolios } = await import("@/lib/rta/import"));
    ({ adoptUnknownPansByName } = await import("@/lib/rta/process"));
    ({ InvestorDirectory } = await import("@/lib/rta/identity"));
    ({ loadValuationRows } = await import("@/lib/finance/valuation"));
    ({ sql } = await import("drizzle-orm"));
    const { Client } = await import("pg");
    admin = new Client({ connectionString: ADMIN_DB });
    await admin.connect();
    await admin.query(
      `INSERT INTO scheme_nav (scheme_code, scheme_name, nav, nav_date) VALUES ($1, $2, 200, (now() AT TIME ZONE 'Asia/Kolkata')::date - 1)`,
      [navCode, navName],
    );
    await q(sql`INSERT INTO tenants (id, legal_name, display_name, arn) VALUES (${tenant}::uuid, 'B1 Integration Test', 'B1 Integration Test', ${"ARN-B1-" + tenant.slice(0, 6)})`);
    H2p = await import("./helpers/two-person");
  });

  afterAll(async () => {
    if (typeof withSystem === "function") {
      for (const t of ["investor_merges", "audit_log", "transactions", "sips", "folios"]) {
        await q(sql`DELETE FROM ${sql.raw(t)} WHERE tenant_id = ${tenant}::uuid`).catch(() => {});
      }
      await q(sql`UPDATE investors SET merged_into_id = NULL, guardian_investor_id = NULL WHERE tenant_id = ${tenant}::uuid`).catch(() => {});
      await q(sql`DELETE FROM investors WHERE tenant_id = ${tenant}::uuid`).catch(() => {});
      await q(sql`DELETE FROM tenants WHERE id = ${tenant}::uuid`).catch(() => {});
    }
    await H2p?.retireOperators(ops2p);
    if (admin) {
      await admin.query(`DELETE FROM scheme_nav WHERE scheme_code = $1`, [navCode]).catch(() => {});
      await admin.end();
    }
  });

  it("validate-first (a staging batch) never adopts a client by name; the legacy importer does", async () => {
    const firm = randomUUID();
    await insertClient(firm, { name: "Mr Kavya Rohan Desai" });
    const vf = await withSystem((tx) => importRtaFolios(tx, tenant, [rec("AAAPK1111K", "DESAI KAVYA ROHAN", "B1-VF-1")], { kind: "master", sourceBatchId: randomUUID() }));
    expect(vf.investors.matchedByName ?? 0).toBe(0);
    const created = await withPan("AAAPK1111K");
    expect(created).toHaveLength(1);
    expect(created[0].id).not.toBe(firm);

    const firm2 = randomUUID();
    await insertClient(firm2, { name: "Mr Ishaan Vir Kapoor" });
    const legacy = await withSystem((tx) => importRtaFolios(tx, tenant, [rec("AAAPI2222I", "KAPOOR ISHAAN VIR", "B1-LG-1")], { kind: "master" }));
    expect(legacy.investors.matchedByName).toBe(1);
    expect((await withPan("AAAPI2222I")).map((r) => r.id)).toEqual([firm2]);
  });

  it("a minor is never adopted by name, even on the legacy path", async () => {
    const firmMinor = randomUUID();
    await insertClient(firmMinor, { name: "Aarav Nikhil Mehta", isMinor: true });
    const s = await withSystem((tx) =>
      importRtaFolios(tx, tenant, [rec(undefined, "AARAV NIKHIL MEHTA", "B1-MN-1", { category: "minor", isMinor: true, guardianPan: "AAAPG3333G", guardianName: "NIKHIL MEHTA" } as Partial<RtaFolioRecord["investor"]>)], { kind: "master" }),
    );
    expect(s.investors.matchedByName ?? 0).toBe(0);
    const [f] = await q<{ investor_id: string }>(sql`SELECT investor_id FROM folios WHERE tenant_id = ${tenant}::uuid AND folio_number = 'B1-MN-1'`);
    expect(f.investor_id).not.toBe(firmMinor);
    const [firmRow] = await q<{ pan: string | null }>(sql`SELECT pan FROM investors WHERE id = ${firmMinor}::uuid`);
    expect(firmRow.pan).toBeNull();
  });

  it("feed processing offers only PANs nobody holds for name adoption", async () => {
    const holder = randomUUID();
    await insertClient(holder, { name: "Meera Anil Joshi", pan: "AAAPJ4444J" });
    const pll = randomUUID();
    await insertClient(pll, { name: "Meera Anil Joshi Second" }); // not a match: different words
    const firm = randomUUID();
    await insertClient(firm, { name: "Tara Suresh Iyer" });
    const adopted = await withSystem(async (tx) => {
      const dir = new InvestorDirectory(tx, tenant);
      await dir.preload({ pans: ["AAAPJ4444J", "AAAPT5555T"], folios: [] });
      return adoptUnknownPansByName(tx, tenant, dir, [
        { pan: "AAAPJ4444J", investorName: "MEERA ANIL JOSHI" }, // already held: never re-decided
        { pan: "AAAPT5555T", investorName: "IYER TARA SURESH" }, // unknown: adopts the firm's PAN-less client
      ]);
    });
    expect(adopted.has("AAAPJ4444J")).toBe(false);
    expect(adopted.get("AAAPT5555T")).toBe(firm);
    expect((await withPan("AAAPJ4444J")).map((r) => r.id)).toEqual([holder]);
  });

  it("leg merge: main's units rule never merges two legs the registrar codes apart", async () => {
    const f = "B1-LEG-1";
    await withSystem((tx) => importRtaFolios(tx, tenant, [rec("AAAPL6666L", "LEG CLIENT", f, {}, [
      { schemeCode: "117AAGP", rtaSchemeCode: "AAGP", schemeName: "", units: 50, value: 500 },
    ])], { kind: "holdings" }));
    await withSystem((tx) => importRtaFolios(tx, tenant, [rec("AAAPL6666L", "LEG CLIENT", f, {}, [
      { schemeCode: "117BBGP", rtaSchemeCode: "BBGP", schemeName: "", units: 50, value: 700 },
    ])], { kind: "holdings" }));
    expect((await legsOf(f)).map((l) => l.schemeCode).sort()).toEqual(["117AAGP", "117BBGP"]);
  });

  it("leg merge: a nameless leg with the same units restates a named one without a registrar code (main's fix)", async () => {
    const f = "B1-LEG-2";
    await withSystem((tx) => importRtaFolios(tx, tenant, [rec("AAAPL6666L", "LEG CLIENT", f, {}, [
      { schemeCode: "105989", schemeName: "DSP Small Cap Fund - Growth", units: 25.5, value: 2550, arn: "ARN-1" },
    ])], { kind: "holdings" }));
    await withSystem((tx) => importRtaFolios(tx, tenant, [rec("AAAPL6666L", "LEG CLIENT", f, {}, [
      { schemeCode: "D157", schemeName: "", units: 25.5, value: 2600, arn: "0" },
    ])], { kind: "holdings" }));
    const legs = await legsOf(f);
    expect(legs).toHaveLength(1);
    expect(legs[0].schemeCode).toBe("D157");
  });

  it("leg merge: ARN '0' / 'NOT PROVIDED' is no ARN, so it never splits a holding", async () => {
    const f = "B1-LEG-3";
    await withSystem((tx) => importRtaFolios(tx, tenant, [rec("AAAPL6666L", "LEG CLIENT", f, {}, [
      { schemeCode: "117CCGP", schemeName: "C Fund Growth", units: 30, value: 300, arn: "ARN-9" },
    ])], { kind: "holdings" }));
    await withSystem((tx) => importRtaFolios(tx, tenant, [rec("AAAPL6666L", "LEG CLIENT", f, {}, [
      { schemeCode: "117CCGP", schemeName: "C Fund Growth", units: 31, value: 310, arn: "NOT PROVIDED" },
    ])], { kind: "holdings" }));
    const legs = await legsOf(f);
    expect(legs).toHaveLength(1);
    expect(Number(legs[0].units)).toBe(31);
  });

  it("valuation: an evidence-tracked leg is never priced by name; an ordinary leg still is (main's fallback)", async () => {
    const inv = randomUUID();
    await insertClient(inv, { name: "Valuation Client", pan: "AAAPV7777V" });
    await q(sql`
      INSERT INTO folios (tenant_id, investor_id, folio_number, amc_code, amc_name, rta, schemes) VALUES
        (${tenant}::uuid, ${inv}::uuid, 'B1-VAL-E', '117', 'Test AMC', 'kfintech',
         ${JSON.stringify([{ schemeCode: "117XXGP", rtaSchemeCode: "XXGP", schemeName: navName, units: 10, value: 1000, schemeStatus: "unresolved", sourceAsOf: "2026-10-07" }])}::jsonb),
        (${tenant}::uuid, ${inv}::uuid, 'B1-VAL-O', '117', 'Test AMC', 'kfintech',
         ${JSON.stringify([{ schemeCode: "117XXGP", schemeName: navName, units: 10, value: 1000 }])}::jsonb)
    `);
    const { snapshots } = await withSystem((tx) => loadValuationRows(tx, [inv]));
    const byFolio = new Map(snapshots.map((s) => [s.folio_number, s]));
    expect(byFolio.get("B1-VAL-E")?.latest_nav ?? null).toBeNull();
    expect(Number(byFolio.get("B1-VAL-O")?.latest_nav)).toBe(200);
  });
  it("each of main's repair scripts refuses --apply for a validate-first firm (and writes nothing)", async () => {
    const firm = randomUUID();
    await q(sql`INSERT INTO tenants (id, legal_name, display_name, arn) VALUES (${firm}::uuid, 'B1 Script Guard', 'B1 Script Guard', ${"ARN-B1G-" + firm.slice(0, 6)})`);
    ops2p = await H2p.createOperators("b1");
    await H2p.activate(ops2p, { tenantId: firm, mode: "validate_first", postingEnabled: false, reason: "B-1 test: pilot firm" });
    try {
      for (const name of MAIN_WRITE_SCRIPTS) {
        const r = spawnSync(process.execPath, ["--import", "tsx", `scripts/${name}.ts`, "--tenant", firm, "--apply"],
          { env: { ...process.env, DATABASE_URL: TEST_DB!, APP_DATABASE_URL: "", ALLOW_SYSTEM_TX: "1" }, encoding: "utf8", timeout: 120_000 });
        expect({ name, status: r.status }).toEqual({ name, status: 1 });
        expect(r.stderr).toMatch(new RegExp(`\\[${name}\\] refused for firm`));
      }
    } finally {
      await H2p.activate(ops2p, { tenantId: firm, mode: "off", postingEnabled: false, reason: "B-1 test: back to legacy" }).catch(() => {});
    }
  }, 600_000);
});
