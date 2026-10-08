/**
 * Owner decisions of 2026-10-08 — client identity for RTA rows (lib/rta/owner.ts),
 * SIP lifecycle (lib/rta/sip-lifecycle.ts) and holdings scope
 * (lib/rta/holdings-snapshot.ts). Synthetic people (fictitious PANs of valid
 * shape); the row shapes follow the verified real layouts (CAMS R2 prints the
 * guardian's PAN on a minor row; KFintech leaves it blank and gives GuardPanNo).
 *
 * Pure tests against an in-memory directory with the SAME semantics as
 * InvestorOwnerDirectory (folio = registrar + AMC + folio). The adapter itself
 * and the legacy feed rule are exercised against Postgres at the end.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { deriveHolder, resolveOwner, folioHolderRoles, provisionalOwnerKey, type KnownInvestor, type Lookup, type OwnerDirectory } from "@/lib/rta/owner";
import { sipStateOn } from "@/lib/rta/sip-lifecycle";
import { scopeView, firmAum, type HoldingStatement } from "@/lib/rta/holdings-snapshot";

const PAN = {
  adult: "AAAPA1001A", guardian: "GGGPG2002G", guardian2: "GGGPG3003G", sibling: "BBBPB4004B",
  huf: "HHHHH5005H".replace(/^(...)(.)/, "$1H"), // 4th char H → HUF
  karta: "KKKPK6006K", karta2: "KKKPK7007K", joint2: "JJJPJ8008J", joint3: "JJJPJ9009J", grown: "MMMPM1010M",
};

type Inv = KnownInvestor;
class MemDir implements OwnerDirectory {
  investors = new Map<string, Inv>();
  folios: Array<{ id: string; amc: string; folio: string; investorId: string }> = [];
  add(i: Partial<Inv> & { id?: string }): Inv {
    const inv: Inv = { id: i.id ?? randomUUID(), pan: i.pan ?? null, isMinor: !!i.isMinor, category: i.category ?? null, guardianId: i.guardianId ?? null, placeholder: !!i.placeholder };
    this.investors.set(inv.id, inv);
    return inv;
  }
  folio(amc: string, folio: string, investorId: string) { this.folios.push({ id: randomUUID(), amc, folio, investorId }); }
  async folioOwner(amc: string | null, folio: string): Promise<Lookup> {
    const f = this.folios.filter((x) => x.folio === folio && x.amc === (amc ?? ""));
    if (!f.length) return { kind: "none" };
    if (f.length > 1) return { kind: "ambiguous", reason: "twice" };
    return { kind: "found", investorId: f[0].investorId, folioId: f[0].id };
  }
  async byPan(pan: string): Promise<Lookup> {
    const m = [...this.investors.values()].filter((i) => i.pan === pan);
    if (!m.length) return { kind: "none" };
    if (m.length > 1) return { kind: "ambiguous", reason: "two clients" };
    return { kind: "found", investorId: m[0].id };
  }
  investor(id: string) { return this.investors.get(id) ?? null; }
}

const camsMinorRow = (guardianPan: string) => deriveHolder({ statusText: "On Behalf Of Minor", rowPan: guardianPan, rowPanRole: "owner_or_guardian" });
const kfinMinorRow = (guardianPan: string, dob?: string, asOf?: string) => deriveHolder({ statusText: "MINOR", rowPan: "", rowPanRole: "owner", guardianPan, dob, asOf });
const adultRow = (pan: string, joint: string[] = []) => deriveHolder({ statusText: "Individual", rowPan: pan, rowPanRole: "owner", jointPans: joint });
const hufRow = (pan: string) => deriveHolder({ statusText: "HUF", rowPan: pan, rowPanRole: "owner" });
const at = (amc: string, folio: string) => ({ rta: "cams", amcCode: amc, folioNumber: folio });

describe("owner identity — the fifteen required scenarios", () => {
  it("1. an adult with personal folios: the folio on record, then their own PAN for a new folio", async () => {
    const d = new MemDir();
    const a = d.add({ pan: PAN.adult, category: "individual" });
    d.folio("X", "100", a.id);
    expect(await resolveOwner(d, at("X", "100"), adultRow(PAN.adult))).toMatchObject({ kind: "existing_folio_owner", investorId: a.id });
    expect(await resolveOwner(d, at("X", "101"), adultRow(PAN.adult))).toMatchObject({ kind: "owner_by_pan", investorId: a.id });
  });

  it("2. two minors sharing one guardian PAN stay two separate owners; the guardian is only a link", async () => {
    const d = new MemDir();
    const g = d.add({ pan: PAN.guardian, category: "individual" });
    const m1 = await resolveOwner(d, at("X", "201"), camsMinorRow(PAN.guardian));
    const m2 = await resolveOwner(d, at("X", "202"), camsMinorRow(PAN.guardian));
    expect(m1).toMatchObject({ kind: "new_provisional_owner", ownerType: "minor", guardianInvestorId: g.id });
    expect(m2).toMatchObject({ kind: "new_provisional_owner", ownerType: "minor", guardianInvestorId: g.id });
    expect((m1 as any).provisionalKey).not.toBe((m2 as any).provisionalKey);
    expect((m1 as any).provisionalKey).toBe(provisionalOwnerKey("cams", "X", "201"));
    // The guardian's PAN never becomes the minor's owner PAN.
    expect(camsMinorRow(PAN.guardian)).toMatchObject({ ownerPan: null, guardianPan: PAN.guardian, sourcePanRole: "guardian" });
  });

  it("3. a minor and the guardian in the same AMC: each folio stays with its own owner; a minor folio found under the guardian is an exception", async () => {
    const d = new MemDir();
    const g = d.add({ pan: PAN.guardian, category: "individual" });
    const m = d.add({ pan: `MINOR:${PAN.guardian}:CHILD`, isMinor: true, category: "minor", guardianId: g.id });
    d.folio("X", "300", g.id); // the guardian's own folio
    d.folio("X", "301", m.id); // the minor's folio
    expect(await resolveOwner(d, at("X", "301"), camsMinorRow(PAN.guardian))).toMatchObject({ kind: "existing_folio_owner", investorId: m.id });
    expect(await resolveOwner(d, at("X", "300"), adultRow(PAN.guardian))).toMatchObject({ kind: "existing_folio_owner", investorId: g.id });
    // The defect found in the real files: a minor's folio filed under the guardian.
    d.folio("X", "302", g.id);
    expect(await resolveOwner(d, at("X", "302"), camsMinorRow(PAN.guardian))).toMatchObject({ kind: "exception", code: "folio_owned_by_guardian" });
  });

  it("4. minors sharing a phone and address are not merged: contact details are not identity inputs", async () => {
    const d = new MemDir();
    const a = await resolveOwner(d, at("X", "401"), kfinMinorRow(PAN.guardian));
    const b = await resolveOwner(d, at("X", "402"), kfinMinorRow(PAN.guardian2));
    expect((a as any).provisionalKey).not.toBe((b as any).provisionalKey);
    // deriveHolder takes no name / phone / email at all.
    expect(Object.keys(kfinMinorRow(PAN.guardian)).sort()).toEqual(["flags", "guardianPan", "jointPans", "ownerPan", "ownerType", "ownerTypeSource", "sourcePanRole"]);
  });

  it("5. one person with an individual identity and an HUF: two owners, never merged", async () => {
    const d = new MemDir();
    const person = d.add({ pan: PAN.karta, category: "individual" });
    const r = await resolveOwner(d, at("X", "501"), hufRow(PAN.huf));
    expect(r).toMatchObject({ kind: "new_owner_by_pan", ownerType: "huf" });
    const huf = d.add({ pan: PAN.huf, category: "huf" });
    expect(await resolveOwner(d, at("X", "502"), hufRow(PAN.huf))).toMatchObject({ kind: "owner_by_pan", investorId: huf.id });
    expect(await resolveOwner(d, at("X", "503"), adultRow(PAN.karta))).toMatchObject({ kind: "owner_by_pan", investorId: person.id });
  });

  it("6. HUF PAN vs Karta PAN: an HUF row carrying an individual PAN is never used as the HUF's PAN", async () => {
    const h = hufRow(PAN.karta);
    expect(h).toMatchObject({ ownerType: "huf", ownerPan: null });
    expect(h.flags).toContain("huf_owner_pan_not_huf");
    const d = new MemDir();
    d.add({ pan: PAN.karta, category: "individual" });
    expect(await resolveOwner(d, at("X", "601"), h)).toMatchObject({ kind: "exception", code: "huf_owner_pan_unverified" });
  });

  it("7. a Karta change does not change the HUF owner or its folio history", async () => {
    const d = new MemDir();
    const huf = d.add({ pan: PAN.huf, category: "huf" });
    d.folio("X", "701", huf.id);
    // The registrar row names the HUF; whoever represents it (Karta, a joint name) is not the owner.
    const before = deriveHolder({ statusText: "HUF", rowPan: PAN.huf, rowPanRole: "owner", jointPans: [PAN.karta] });
    const after = deriveHolder({ statusText: "HUF", rowPan: PAN.huf, rowPanRole: "owner", jointPans: [PAN.karta2] });
    expect(await resolveOwner(d, at("X", "701"), before)).toMatchObject({ kind: "existing_folio_owner", investorId: huf.id });
    expect(await resolveOwner(d, at("X", "701"), after)).toMatchObject({ kind: "existing_folio_owner", investorId: huf.id });
  });

  it("8. minor-to-major: flagged for verification, identity preserved, never re-owned automatically", async () => {
    const d = new MemDir();
    const m = d.add({ pan: `MINOR:${PAN.guardian}:CHILD`, isMinor: true, category: "minor" });
    d.folio("X", "801", m.id);
    // Still reported as a minor although the date of birth says 18+: action required.
    expect(kfinMinorRow(PAN.guardian, "2007-01-01", "2026-10-08").flags).toContain("minor_age_18_or_over");
    // The registrar now reports the person as an individual with their own PAN:
    const r = await resolveOwner(d, at("X", "801"), adultRow(PAN.grown));
    expect(r).toMatchObject({ kind: "exception", code: "owner_type_conflict", investorId: m.id });
    expect((r as any).reason).toMatch(/minor-to-major/);
    // Their own PAN arriving on a NEW folio, once recorded on the (former) minor, is also held.
    m.pan = PAN.grown;
    expect(await resolveOwner(d, at("X", "802"), adultRow(PAN.grown))).toMatchObject({ kind: "exception", code: "pan_matches_minor_record" });
  });

  it("9. joint holders are relationships on ONE owner's folio — no second owner, no double AUM", async () => {
    const d = new MemDir();
    const first = d.add({ pan: PAN.adult, category: "individual" });
    d.add({ pan: PAN.joint2, category: "individual" }); // the second holder is also a client in their own right
    d.folio("X", "901", first.id);
    const row = adultRow(PAN.adult, [PAN.joint2, PAN.joint3]);
    expect(await resolveOwner(d, at("X", "901"), row)).toMatchObject({ kind: "existing_folio_owner", investorId: first.id });
    expect(folioHolderRoles(row)).toEqual([{ role: "first", pan: PAN.adult }, { role: "second", pan: PAN.joint2 }, { role: "third", pan: PAN.joint3 }]);
    const v = scopeView([{ id: "s", rta: "cams", arn: "A", asOf: "2026-10-08", fullBook: true, positions: [{ amcCode: "X", folioNumber: "901", schemeCode: "XS", units: 10, value: 1000 }] }]);
    expect(v[0].value).toBe(1000); // counted once, whatever the number of holders
  });

  it("10. the same folio number under two AMCs is two folios with possibly different owners", async () => {
    const d = new MemDir();
    const a = d.add({ pan: PAN.adult, category: "individual" });
    d.folio("X", "1000", a.id);
    expect(await resolveOwner(d, at("Y", "1000"), adultRow(PAN.sibling))).toMatchObject({ kind: "new_owner_by_pan" });
  });

  it("11. a PAN missing or recorded wrongly is never repaired by name: provisional owner, or a flag", async () => {
    const missing = deriveHolder({ statusText: "Individual", rowPan: "N.A.", rowPanRole: "owner" });
    expect(missing.ownerPan).toBeNull();
    const d = new MemDir();
    expect(await resolveOwner(d, at("X", "1101"), missing)).toMatchObject({ kind: "new_provisional_owner", rule: "no_pan_folio_provisional" });
    const wrong = deriveHolder({ statusText: "Individual", rowPan: PAN.huf, rowPanRole: "owner" });
    expect(wrong.flags).toContain("owner_pan_type_mismatch");
  });

  it("12. a minor's transaction before the master: provisional minor owner, never the guardian", async () => {
    const d = new MemDir();
    const g = d.add({ pan: PAN.guardian, category: "individual" });
    const r = await resolveOwner(d, at("X", "1201"), camsMinorRow(PAN.guardian));
    expect(r.kind).toBe("new_provisional_owner");
    expect((r as any).investorId).toBeUndefined();
    expect((r as any).guardianInvestorId).toBe(g.id);
  });

  it("12b. a minor's row on a folio held by a PAN-less placeholder is held, never filed under the placeholder", async () => {
    const d = new MemDir();
    const ph = d.add({ pan: null, placeholder: true });
    d.folio("117", "903", ph.id);
    expect(await resolveOwner(d, { rta: "kfintech", amcCode: "117", folioNumber: "903" }, kfinMinorRow(PAN.guardian))).toMatchObject({ kind: "exception", code: "placeholder_owner", investorId: ph.id });
    // An adult row with no PAN of its own on the same placeholder still resolves to the folio on record.
    expect(await resolveOwner(d, { rta: "kfintech", amcCode: "117", folioNumber: "903" }, deriveHolder({ statusText: "Individual", rowPan: "", rowPanRole: "owner" }))).toMatchObject({ kind: "existing_folio_owner", investorId: ph.id });
  });

  it("14. holdings covering different dates / ARNs: never mixed, never replaced by older, zero kept", () => {
    const pos = (folio: string, units: number, value: number | null) => ({ amcCode: "X", folioNumber: folio, schemeCode: "XS", units, value });
    const st: HoldingStatement[] = [
      { id: "kf-may", rta: "kfintech", arn: "ARN-1", asOf: "2026-05-18", fullBook: true, positions: [pos("1", 10, 100), pos("2", 5, 50)] },
      { id: "kf-oct", rta: "kfintech", arn: "ARN-1", asOf: "2026-10-08", fullBook: true, positions: [pos("1", 12, 130), pos("3", 0, 0)] },
      { id: "kf-old-late", rta: "kfintech", arn: "ARN-1", asOf: "2026-04-01", fullBook: true, positions: [pos("9", 1, 1)] },
      { id: "cams-sub", rta: "cams", arn: "ARN-1", asOf: "2026-10-08", fullBook: false, positions: [pos("7", 3, 30)] },
      { id: "kf-other-arn", rta: "kfintech", arn: "ARN-2", asOf: "2026-10-08", fullBook: true, positions: [pos("1", 1, 10)] },
    ];
    const v = scopeView(st);
    const kf1 = v.find((s) => s.rta === "kfintech" && s.arn === "ARN-1")!;
    expect(kf1.baseStatement).toEqual({ id: "kf-oct", asOf: "2026-10-08" });
    expect(kf1.positions.map((p) => [p.folioNumber, p.units])).toEqual([["1", 12], ["3", 0]]); // folio 2 sold out; 3 kept at zero
    expect(kf1.zeroPositions).toBe(1);
    const firm = firmAum(v, [{ rta: "kfintech", arn: "ARN-1" }, { rta: "cams", arn: "ARN-1" }, { rta: "kfintech", arn: "ARN-2" }]);
    expect(firm.complete).toBe(false);
    expect(firm.label).toMatch(/PARTIAL.*cams\/ARN-1/);
    expect(firm.value).toBe(130 + 30 + 10);
  });

  it("15. a SIP stops only on a registrar lifecycle fact — never on failed instalments", () => {
    const live = { registrarStatus: "Live SIP", reportStatesLifecycle: true, startDate: "2026-01-05", endDate: "2056-01-05", registerAsOf: "2026-10-08" };
    const bounced = [{ kind: "instalment_rejected" as const, date: "2026-09-05" }, { kind: "instalment_rejected" as const, date: "2026-10-05" }];
    expect(sipStateOn(live, "2026-10-08", undefined, bounced).state).toBe("ACTIVE");
    expect(sipStateOn({ ...live, terminateDate: "2026-10-01" }, "2026-10-08").state).toBe("STOPPED");
    expect(sipStateOn({ ...live, registrarStatus: "Terminated" }, "2026-10-08").state).toBe("STOPPED");
    expect(sipStateOn({ reportStatesLifecycle: true, ceaseDate: null, pauseFrom: "2026-10-01", pauseTo: "2026-12-31", startDate: "2026-01-01", registerAsOf: "2026-10-08" }, "2026-10-08").state).toBe("PAUSED");
    expect(sipStateOn({ ...live, startDate: "2026-11-10" }, "2026-10-08").state).toBe("PENDING");
    expect(sipStateOn({ ...live, registrarStatus: "Rejected" }, "2026-10-08").state).toBe("REJECTED");
    // No status column (MFSD230) or a stale register: UNKNOWN, never ACTIVE.
    expect(sipStateOn({ reportStatesLifecycle: false, startDate: "2026-10-01", registerAsOf: "2026-10-08" }, "2026-10-08").state).toBe("UNKNOWN");
    expect(sipStateOn(live, "2027-03-01").state).toBe("UNKNOWN");
    // End date passed: live status = extended (ACTIVE); no status = UNKNOWN; "Expired" = EXPIRED.
    expect(sipStateOn({ ...live, endDate: "2026-09-30" }, "2026-10-08").state).toBe("ACTIVE");
    expect(sipStateOn({ reportStatesLifecycle: true, startDate: "2020-01-01", endDate: "2026-09-30", registerAsOf: "2026-10-08" }, "2026-10-08").state).toBe("UNKNOWN");
    expect(sipStateOn({ ...live, registrarStatus: "Expired" }, "2026-10-08").state).toBe("EXPIRED");
  });

  it("owner types from registrar status and the PAN's holder letter", () => {
    expect(deriveHolder({ statusText: "Partnership Firm", rowPan: "FFFFF1111F".replace(/^(...)(.)/, "$1F"), rowPanRole: "owner" }).ownerType).toBe("non_individual");
    expect(deriveHolder({ statusText: "Sole Proprietorship", rowPan: PAN.adult, rowPanRole: "owner" }).ownerType).toBe("individual");
    expect(deriveHolder({ statusText: "", rowPan: PAN.huf, rowPanRole: "owner" })).toMatchObject({ ownerType: "huf", ownerTypeSource: "pan_structure" });
    expect(deriveHolder({ statusText: "MINOR THROUGH GUARDIAN", rowPan: "", rowPanRole: "owner", guardianPan: PAN.guardian })).toMatchObject({ ownerType: "minor", ownerPan: null, guardianPan: PAN.guardian });
  });
});

// ── Against Postgres: the adapter (scenario 10) and the legacy feed (13 is in rta-staging-db) ──
const TEST_DB = process.env.TEST_DATABASE_URL;
describe.skipIf(!TEST_DB)("owner identity against the database", () => {
  let withTenant: typeof import("@/db/client").withTenant;
  let withSystem: typeof import("@/db/client").withSystem;
  let sql: typeof import("drizzle-orm").sql;
  const t = randomUUID();
  const ids = { a: randomUUID(), b: randomUUID() };

  beforeAll(async () => {
    process.env.DATABASE_URL = TEST_DB!;
    process.env.APP_DATABASE_URL = "";
    process.env.ALLOW_SYSTEM_TX = "1";
    ({ withTenant, withSystem } = await import("@/db/client"));
    ({ sql } = await import("drizzle-orm"));
    await withSystem(async (tx) => {
      await tx.execute(sql`INSERT INTO tenants (id, legal_name, display_name, arn) VALUES (${t}::uuid, 'Owner Test', 'Owner Test', ${"ARN-OT" + t.slice(0, 6)})`);
      await tx.execute(sql`INSERT INTO investors (id, tenant_id, pan, name) VALUES (${ids.a}::uuid, ${t}::uuid, ${PAN.adult}, 'Test A'), (${ids.b}::uuid, ${t}::uuid, ${PAN.sibling}, 'Test B')`);
      await tx.execute(sql`INSERT INTO folios (tenant_id, investor_id, amc_code, amc_name, folio_number) VALUES (${t}::uuid, ${ids.a}::uuid, 'X', 'X', '555'), (${t}::uuid, ${ids.b}::uuid, 'Y', 'Y', '555')`);
    });
  });
  afterAll(async () => {
    const run = async (s: ReturnType<typeof sql>) => { try { await withSystem((tx) => tx.execute(s)); } catch { /* best effort */ } };
    await run(sql`DELETE FROM folios WHERE tenant_id = ${t}::uuid`);
    await run(sql`DELETE FROM investors WHERE tenant_id = ${t}::uuid`);
    await run(sql`DELETE FROM tenants WHERE id = ${t}::uuid`);
  });

  it("10. same folio number, two AMCs, two owners — resolved per AMC, never by number alone", async () => {
    const { InvestorDirectory } = await import("@/lib/rta/identity");
    const { InvestorOwnerDirectory } = await import("@/lib/rta/owner-directory");
    await withTenant(t, async (tx) => {
      const dir = new InvestorOwnerDirectory(new InvestorDirectory(tx, t));
      expect(await dir.folioOwner("X", "555")).toMatchObject({ kind: "found", investorId: ids.a });
      expect(await dir.folioOwner("Y", "555")).toMatchObject({ kind: "found", investorId: ids.b });
      expect(await dir.folioOwner("Z", "555")).toEqual({ kind: "none" });
      expect(dir.investor(ids.a)).toMatchObject({ pan: PAN.adult, isMinor: false, placeholder: false });
    });
  });
});
