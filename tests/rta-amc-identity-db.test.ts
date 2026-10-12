/**
 * Pilot preflight — CAMS review safety on a real Postgres. The verified
 * AMC-identity crosswalk (0241) confines name suggestions and approvals to the
 * registrar AMC's verified AMC (plus documented successors). Synthetic AMFI
 * rows reproduce the three bad suggestions seen on the real queue: a
 * same-named scheme at another AMC (K108 → SBI), a wrong scheme inside the
 * AMC (P121 → FMCG), and a scheme now under a successor AMC (OFIVFG).
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { cleanupSchemeMap } from "./scheme-map-cleanup";
import { GLOBAL_AMFI_LOCK_TIMEOUT_MS, lockGlobalAmfi } from "./helpers/global-amfi-lock";

const TEST_DB = process.env.TEST_DATABASE_URL;
const A = {
  lmRG: "9K0001", multi: "9K0002", fmcg: "9K0003", value: "9K0004", lmDG: "9K0005",
  muLM: "9K0011", muCons: "9K0012", nuValue: "9K0021",
};

describe.skipIf(!TEST_DB)("AMC-identity crosswalk and candidate safety (DB)", () => {
  // Global AMFI reference state: one such file at a time (tests/helpers/global-amfi-lock.ts).
  let unlockAmfi: (() => Promise<void>) | null = null;
  beforeAll(async () => { unlockAmfi = await lockGlobalAmfi(TEST_DB!); }, GLOBAL_AMFI_LOCK_TIMEOUT_MS);
  afterAll(async () => { await unlockAmfi?.(); });
  let withTenant: typeof import("@/db/client").withTenant;
  let withSystem: typeof import("@/db/client").withSystem;
  let sql: typeof import("drizzle-orm").sql;
  let S: typeof import("@/lib/rta/scheme-resolution");
  const t = randomUUID();
  const ops = { a: randomUUID(), b: randomUUID() };
  const user = randomUUID();
  const ids: Record<string, string> = {};
  const cand = (code: string) => withTenant(t, (tx) => S.schemeCandidates(tx, t, ids[code]));
  const confirm = (code: string, amfi: string) => withTenant(t, (tx) => S.confirmSchemeCode(tx, t, ids[code], { amfiSchemeCode: amfi, note: "checked against the AMC's scheme list", by: user, evidenceSource: "amc_scheme_list" }));
  const status = async (code: string) => (await withTenant(t, async (tx) => (await tx.execute(sql`SELECT status, reason_code, amfi_scheme_code FROM scheme_rta_codes WHERE id = ${ids[code]}::uuid`)).rows[0])) as any;
  const approveAmc = (amfiAmc: string, role: "primary" | "successor", by = ops.b) => withSystem((tx) => S.approveAmcIdentity(tx, { rta: "cams", amcCode: "LM", amfiAmc, role, note: "CAMS AMC code list and the AMC's merger notice", requestedBy: ops.a, approvedBy: by }));

  beforeAll(async () => {
    process.env.DATABASE_URL = TEST_DB!;
    process.env.APP_DATABASE_URL = "";
    process.env.ALLOW_SYSTEM_TX = "1";
    (process.env as Record<string, string>).NODE_ENV = "test";
    ({ withTenant, withSystem } = await import("@/db/client"));
    ({ sql } = await import("drizzle-orm"));
    S = await import("@/lib/rta/scheme-resolution");
    await withSystem(async (tx) => {
      const nav = (c: string, name: string, amc: string, plan: string, option: string) => tx.execute(sql`
        INSERT INTO scheme_nav (scheme_code, scheme_name, plan, option_name, amc_name, nav, nav_date) VALUES (${c}, ${name}, ${plan}, ${option}, ${amc}, 40, CURRENT_DATE - 1) ON CONFLICT (scheme_code) DO NOTHING`);
      await nav(A.lmRG, "Lambda Large & Midcap Fund - Regular Plan - Growth", "Lambda Mutual Fund", "Regular Plan", "Growth");
      await nav(A.lmDG, "Lambda Large & Midcap Fund - Direct Plan - Growth", "Lambda Mutual Fund", "Direct Plan", "Growth");
      await nav(A.multi, "Lambda Multicap Fund - Regular Plan - Growth", "Lambda Mutual Fund", "Regular Plan", "Growth");
      await nav(A.fmcg, "Lambda FMCG Fund - Regular Plan - Growth", "Lambda Mutual Fund", "Regular Plan", "Growth");
      await nav(A.value, "Lambda Value Fund - Regular Plan - IDCW", "Lambda Mutual Fund", "Regular Plan", "IDCW");
      // Another AMC with the SAME scheme name — the K108 → SBI case.
      await nav(A.muLM, "Mu Large & Midcap Fund - Regular Plan - Growth", "Mu Mutual Fund", "Regular Plan", "Growth");
      await nav(A.muCons, "Mu Consumption Fund - Regular Plan - Growth", "Mu Mutual Fund", "Regular Plan", "Growth");
      // The successor AMC that took over Lambda Value — the OFIVFG case.
      await nav(A.nuValue, "Nu Value Fund - Regular Plan - Growth", "Nu Mutual Fund", "Regular Plan", "Growth");
      await tx.execute(sql`INSERT INTO tenants (id, legal_name, display_name, arn) VALUES (${t}::uuid, 'AMC identity', 'AMC identity', ${"ARN-AI" + t.slice(0, 6)})`);
      await tx.execute(sql`INSERT INTO users (id, tenant_id, email, name, roles, status) VALUES (${user}::uuid, ${t}::uuid, ${`ai-${t.slice(0, 8)}@example.test`}, 'Reviewer', ARRAY['owner']::text[], 'active')`);
    });
    const codes: Array<[string, string]> = [
      ["LMLMG", "Lambda Large & Midcap Fund - Growth (Regular Plan)"],
      ["LMMCG", "Lambda Multicap Fund - Regular Growth"],
      ["LMDUP", "Lambda Multicap Fund Regular Plan Growth"],
      ["LMVAL", "Lambda Value Fund - Regular Growth"],
      ["LMFMC", "Lambda FMCG Fund"],
    ];
    await withTenant(t, async (tx) => {
      for (const [code, name] of codes) {
        const r = (await tx.execute(sql`INSERT INTO scheme_rta_codes (tenant_id, rta, rta_amc_code, rta_scheme_code, observed_name, status, reason_code)
          VALUES (${t}::uuid, 'cams', 'LM', ${code}, ${name}, 'unresolved', 'no_isin') RETURNING id`)).rows[0] as { id: string };
        ids[code] = r.id;
      }
      // Exposure: LMVAL carries the most money, then LMLMG.
      const inv = randomUUID();
      await tx.execute(sql`INSERT INTO investors (id, tenant_id, pan, name) VALUES (${inv}::uuid, ${t}::uuid, 'QQQPA1234Q', 'Exposure Client')`);
      await tx.execute(sql`INSERT INTO folios (tenant_id, investor_id, amc_code, amc_name, folio_number, rta, schemes) VALUES (${t}::uuid, ${inv}::uuid, 'LM', 'AMC LM', '7710001/11', 'cams',
        ${JSON.stringify([{ schemeCode: "LMVAL", rtaSchemeCode: "LMVAL", schemeStatus: "unresolved", units: 100, value: 90000, sourceValue: 90000 },
                          { schemeCode: "LMLMG", rtaSchemeCode: "LMLMG", schemeStatus: "unresolved", units: 10, value: 400, sourceValue: 400 }])}::jsonb)`);
    });
  });

  afterAll(async () => {
    const tryRun = async (s: ReturnType<typeof sql>) => { try { await withSystem((tx) => tx.execute(s)); } catch { /* best effort */ } };
    for (const table of ["scheme_rta_codes", "folios", "investors", "audit_log", "users"]) await tryRun(sql.raw(`DELETE FROM ${table} WHERE tenant_id = '${t}'`));
    await tryRun(sql`DELETE FROM tenants WHERE id = ${t}::uuid`);
    await cleanupSchemeMap(withSystem as any, sql, Object.values(A));
    await tryRun(sql`DELETE FROM scheme_nav WHERE scheme_code IN (${sql.join(Object.values(A).map((c) => sql`${c}`), sql`, `)})`);
  });

  it("no verified AMC identity: no name suggestions at all (never a cross-AMC lookalike), and no scheme can be approved", async () => {
    const c = await cand("LMLMG");
    expect(c).toMatchObject({ amcVerified: false, verifiedAmcs: [], candidates: [] });
    await expect(confirm("LMLMG", A.lmRG)).rejects.toThrow(/not verified yet/);
  });

  it("recording the AMC identity takes two operators, an AMC AMFI names, and evidence; it is append-only history and approves no scheme", async () => {
    await expect(approveAmc("Lambda Mutual Fund", "primary", ops.a)).rejects.toThrow(/different operators/);
    await expect(approveAmc("Lambda Asset Mgmt (not in AMFI)", "primary")).rejects.toThrow(/not named in the AMFI feed/);
    await expect(withSystem((tx) => tx.execute(sql`INSERT INTO registrar_amc_identity (rta, rta_amc_code, amfi_amc, role, basis, status, evidence_note, requested_by, approved_by)
      VALUES ('cams', 'LM', 'Lambda Mutual Fund', 'primary', 'platform_approval', 'approved', 'one person twice', ${ops.a}::uuid, ${ops.a}::uuid)`))).rejects.toThrow();
    await expect(approveAmc("Nu Mutual Fund", "successor")).rejects.toThrow(/primary AMC before any successor/);
    const r = await approveAmc("Lambda Mutual Fund", "primary");
    expect(r.unchanged).toBe(false);
    await expect(approveAmc("Mu Mutual Fund", "primary")).rejects.toThrow(/already verified as Lambda Mutual Fund/);
    const edit = await withSystem((tx) => tx.execute(sql`UPDATE registrar_amc_identity_events SET reason = 'edited' WHERE identity_id = ${r.id}::uuid`)).then(() => null, (e) => e);
    expect(String(edit?.cause?.message ?? edit?.message)).toMatch(/append-only/);
    for (const code of Object.keys(ids)) expect(await status(code)).toMatchObject({ status: "unresolved" });
  });

  it("suggestions come only from the verified AMC: the same-named scheme at another AMC and the Direct variant are gone; each is labelled as not proof", async () => {
    const c = await cand("LMLMG");
    expect(c).toMatchObject({ amcVerified: true, verifiedAmcs: ["Lambda Mutual Fund"] });
    const codes = c.candidates.map((x) => x.amfiSchemeCode);
    expect(codes[0]).toBe(A.lmRG);
    expect(codes).not.toContain(A.muLM); // K108 → SBI cannot recur
    expect(codes).not.toContain(A.lmDG); // the registrar says Regular
    expect(c.candidates.every((x) => x.amc === "Lambda Mutual Fund")).toBe(true);
    expect(c.candidates[0].warnings.join(" ")).toMatch(/similarity is not proof/);
    expect(c.history.map((h) => h.source)).toContain("platform_amc");
  });

  it("two registrar codes whose top suggestion is the same AMFI scheme are both warned", async () => {
    const a = (await cand("LMMCG")).candidates.find((x) => x.amfiSchemeCode === A.multi)!;
    const b = (await cand("LMDUP")).candidates.find((x) => x.amfiSchemeCode === A.multi)!;
    expect(a.warnings.join(" ")).toMatch(/also the top suggestion for registrar code LMDUP/);
    expect(b.warnings.join(" ")).toMatch(/also the top suggestion for registrar code LMMCG/);
    // The list is in registrar-code order, whatever order the rows sit in on
    // disk (an UPDATE elsewhere used to reorder it — I-7). LMVAL's top
    // suggestion is the same scheme, so it is listed too, always after LMDUP.
    expect(a.warnings.join(" ")).toMatch(/registrar code LMDUP, LMVAL — at most one/);
    await withSystem((tx) => tx.execute(sql`UPDATE scheme_rta_codes SET updated_at = now() WHERE tenant_id = ${t}::uuid AND rta_scheme_code IN ('LMDUP', 'LMLMG')`));
    const again = (await cand("LMMCG")).candidates.find((x) => x.amfiSchemeCode === A.multi)!;
    expect(again.warnings.join(" ")).toMatch(/registrar code LMDUP, LMVAL — at most one/);
  });

  it("a wrong-AMC approval is refused; a right one confirms ONE code — its siblings stay unresolved", async () => {
    await expect(confirm("LMLMG", A.muLM)).rejects.toThrow(/verified as Lambda Mutual Fund; this scheme is Mu Mutual Fund/);
    await expect(confirm("LMLMG", A.lmDG)).rejects.toThrow(/plan \/ option/);
    const d = await confirm("LMLMG", A.lmRG);
    expect(d).toMatchObject({ status: "confirmed", reasonCode: "firm_confirmed" });
    for (const code of ["LMMCG", "LMDUP", "LMVAL", "LMFMC"]) expect(await status(code)).toMatchObject({ status: "unresolved", amfi_scheme_code: null });
  });

  it("a plan / option the two sides cannot compare is warned, and a contradicting option is refused", async () => {
    const c = (await cand("LMFMC")).candidates.find((x) => x.amfiSchemeCode === A.fmcg)!;
    expect(c.warnings.join(" ")).toMatch(/does not state Direct \/ Regular/);
    expect(c.warnings.join(" ")).toMatch(/does not state Growth \/ IDCW/);
    // LMVAL says Growth; the Lambda Value scheme in AMFI is IDCW — never proposed, never approvable.
    expect((await cand("LMVAL")).candidates.map((x) => x.amfiSchemeCode)).not.toContain(A.value);
    await expect(confirm("LMVAL", A.value)).rejects.toThrow(/plan \/ option/);
  });

  it("a scheme under a successor AMC is approvable only after two operators document the succession", async () => {
    await expect(confirm("LMVAL", A.nuValue)).rejects.toThrow(/verified as Lambda Mutual Fund/);
    await approveAmc("Nu Mutual Fund", "successor");
    expect((await cand("LMVAL")).verifiedAmcs).toEqual(["Lambda Mutual Fund", "Nu Mutual Fund"]);
    expect(await confirm("LMVAL", A.nuValue)).toMatchObject({ status: "confirmed" });
    const platform = await withSystem((tx) => S.approvePlatformMapping(tx, { rta: "cams", amcCode: "LM", schemeCode: "LMMCG", amfiSchemeCode: A.muCons, note: "trying an unrelated AMC on the platform", requestedBy: ops.a, approvedBy: ops.b }).then(() => null, (e) => e));
    expect(String(platform?.message)).toMatch(/not approved: the registrar AMC is verified as Lambda Mutual Fund \/ Nu Mutual Fund/);
  });

  it("the review list is ordered by exposure, and carries the verified AMC", async () => {
    const list = await withTenant(t, (tx) => S.loadSchemeCodes(tx, t, { status: "unresolved" }));
    expect(list.rows.map((r) => r.rtaSchemeCode).slice(0, 1)).toEqual([list.rows.find((r) => r.holdingValue === Math.max(...list.rows.map((x) => x.holdingValue)))!.rtaSchemeCode]);
    expect(list.rows[0].verifiedAmcs).toEqual(["Lambda Mutual Fund", "Nu Mutual Fund"]);
    const all = await withTenant(t, (tx) => S.loadSchemeCodes(tx, t));
    expect(all.rows.find((r) => r.rtaSchemeCode === "LMVAL")).toMatchObject({ holdingValue: 90000 });
  });

  it("revoking the AMC identity (one operator) stops further approvals; the history keeps every decision", async () => {
    const rows = (await withSystem((tx) => tx.execute(sql`SELECT id FROM registrar_amc_identity WHERE rta = 'cams' AND rta_amc_code = 'LM' AND role = 'primary' AND status <> 'revoked'`))).rows as any[];
    await withSystem((tx) => S.revokeAmcIdentity(tx, { id: rows[0].id, by: ops.a, reason: "wrong AMC code list year" }));
    await expect(confirm("LMMCG", A.multi)).rejects.toThrow(/not verified yet/); // a successor alone is not an identity
    const h = (await cand("LMLMG")).history.map((x) => `${x.source}:${x.action}`);
    expect(h).toEqual(expect.arrayContaining(["platform_amc:approve", "platform_amc:revoke", "firm:rta.scheme.confirm"]));
  });
});
