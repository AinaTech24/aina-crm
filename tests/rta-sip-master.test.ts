/**
 * Phase 3D — the canonical SIP Master and the Active SIP Book derived from it.
 * Synthetic registrations only; the shapes follow the verified MFSD243 /
 * MFSD230 / WBR49 / MFSD201 layouts (tests/rta-real-layouts.ts).
 */
import { describe, expect, it } from "vitest";
import { activeSipBook, buildSipMaster, sipFrequency, sipKind, type InstalmentEvent, type RegistrationObservation } from "@/lib/rta/sip-master";

const AS_OF = "2026-10-08";
const k243 = (o: Partial<RegistrationObservation> = {}): RegistrationObservation => ({
  source: "kfintech.mfsd243", reportDate: "2026-10-08", rta: "kfintech", amcCode: "117", registrationId: "202609010000001",
  folio: "9100001", scheme: "117EQG", kindCode: "SIP", amount: 5000, frequencyText: "Monthly", startDate: "2026-09-05",
  endDate: "2036-09-05", registeredOn: "2026-09-01", statusText: "Live SIP", ...o,
});
const k230 = (o: Partial<RegistrationObservation> = {}): RegistrationObservation => ({
  source: "kfintech.mfsd230", reportDate: "2026-10-07", rta: "kfintech", amcCode: "117", registrationId: null,
  folio: "9100001", scheme: "117EQG", kindCode: "SIP", amount: 5000, frequencyText: "Monthly", startDate: "2026-09-05",
  endDate: "2036-09-05", registeredOn: "2026-09-01", totalInstalments: 120, paidInstalments: 1, pendingInstalments: 119, ...o,
});
const w49 = (o: Partial<RegistrationObservation> = {}): RegistrationObservation => ({
  source: "cams.wbr49", reportDate: "2026-10-08", rta: "cams", amcCode: "B", registrationId: "654321",
  folio: "81000001", scheme: "B12G", kindCode: "P", amount: 2000, frequencyText: "OM", startDate: "2024-01-10",
  endDate: "2034-01-10", registeredOn: "2023-12-20", ceaseDate: null, pauseFrom: null, pauseTo: null, ...o,
});
const ev = (o: Partial<InstalmentEvent> = {}): InstalmentEvent => ({
  rta: "kfintech", amcCode: "117", registrationRef: "202609010000001", folio: "9100001", scheme: "117EQG",
  date: "2026-10-05", outcome: "processed", amount: 5000, ...o,
});

describe("SIP Master — identity", () => {
  it("overlapping reports describe one registration once (keyed by registrar + AMC + registration id)", () => {
    const m = buildSipMaster([k243({ reportDate: "2026-09-08" }), k243(), k243({ reportDate: "2026-10-01", amount: 4000 })], [], AS_OF);
    expect(m.entries).toHaveLength(1);
    expect(m.entries[0]).toMatchObject({ key: "reg:kfintech:117:202609010000001", keyed: true, observations: 3, amount: 5000, lastSeen: "2026-10-08" });
  });

  it("the same id at two AMCs is two registrations", () => {
    expect(buildSipMaster([k243(), k243({ amcCode: "118" })], [], AS_OF).entries).toHaveLength(2);
  });

  it("an MFSD230 row with no id attaches only on a unique exact match, and brings its instalment counts", () => {
    const m = buildSipMaster([k243(), k230()], [], AS_OF);
    expect(m.entries).toHaveLength(1);
    expect(m.entries[0].instalmentCounts).toEqual({ total: 120, paid: 1, pending: 119, asOf: "2026-10-07" });
    expect(m.entries[0].sources).toEqual(["kfintech.mfsd243", "kfintech.mfsd230"]);
  });

  it("an MFSD230 row that matches nothing exactly stays unkeyed with state UNKNOWN; two matches is an exception", () => {
    const loose = buildSipMaster([k243(), k230({ amount: 5001 })], [], AS_OF);
    expect(loose.entries.map((e) => [e.keyed, e.state])).toEqual([[true, "ACTIVE"], [false, "UNKNOWN"]]);
    const twin = buildSipMaster([k243(), k243({ registrationId: "202609010000002" }), k230()], [], AS_OF);
    expect(twin.exceptions.map((x) => x.code)).toContain("unkeyed_ambiguous");
    expect(twin.entries.filter((e) => e.keyed).every((e) => e.instalmentCounts === null)).toBe(true);
  });

  it("a contradiction in what cannot change is an exception", () => {
    const m = buildSipMaster([k243(), k243({ reportDate: "2026-10-09", folio: "9100002" })], [], AS_OF);
    expect(m.exceptions.map((x) => x.code)).toContain("registration_attribute_conflict");
  });
});

describe("SIP Master — lifecycle", () => {
  it("a future start is PENDING; a live status within the register's reach is ACTIVE", () => {
    expect(buildSipMaster([k243({ startDate: "2026-10-20" })], [], AS_OF).entries[0].state).toBe("PENDING");
    expect(buildSipMaster([k243()], [], AS_OF).entries[0].state).toBe("ACTIVE");
  });

  it("a terminate date or cease date that has passed is STOPPED; a pause in force is PAUSED", () => {
    expect(buildSipMaster([k243({ terminateDate: "2026-10-01", statusText: "Live SIP" })], [], AS_OF).entries[0].state).toBe("STOPPED");
    expect(buildSipMaster([w49({ ceaseDate: "2026-09-30" })], [], AS_OF).entries[0].state).toBe("STOPPED");
    expect(buildSipMaster([w49({ pauseFrom: "2026-10-01", pauseTo: "2026-12-31" })], [], AS_OF).entries[0].state).toBe("PAUSED");
  });

  it("a register too old to speak for the date is UNKNOWN, never assumed active", () => {
    expect(buildSipMaster([k243({ reportDate: "2026-07-01" })], [], AS_OF).entries[0].state).toBe("UNKNOWN");
  });

  it("MFSD230 alone states no lifecycle — UNKNOWN", () => {
    expect(buildSipMaster([k230()], [], AS_OF).entries[0]).toMatchObject({ keyed: false, state: "UNKNOWN" });
  });

  it("a newer MFSD230 never erases the lifecycle MFSD243 stated", () => {
    const m = buildSipMaster([k243({ reportDate: "2026-10-01" }), k230({ reportDate: "2026-10-08" })], [], AS_OF);
    expect(m.entries[0]).toMatchObject({ state: "ACTIVE", lifecycleAsOf: "2026-10-01", lastSeen: "2026-10-08" });
  });

  it("a failed instalment is recorded and never stops the registration", () => {
    const m = buildSipMaster([k243()], [ev({ date: "2026-09-05" }), ev({ date: "2026-10-05", outcome: "rejected", reason: "Insufficient balance" })], AS_OF);
    expect(m.entries[0]).toMatchObject({ state: "ACTIVE", instalments: { processed: 1, rejected: 1, lastRejected: "2026-10-05", lastRejectionReason: "Insufficient balance" } });
  });

  it("an STP's two legs on one date count as one instalment", () => {
    const m = buildSipMaster([k243({ kindCode: "STP", targetScheme: "117DBG" })], [ev(), ev({ scheme: "117DBG" })], AS_OF);
    expect(m.entries[0].instalments.processed).toBe(1);
  });

  it("a CAMS R2 reference is never merged into a WBR49 registration by guesswork", () => {
    const m = buildSipMaster([w49()], [ev({ rta: "cams", amcCode: "B", registrationRef: "654321", folio: "81000001", scheme: "B12G" })], AS_OF);
    const wbr49 = m.entries.find((e) => e.key.startsWith("reg:cams"))!;
    expect(wbr49.instalments.processed).toBe(0);
    // The R2 reference is its own registration (its own namespace), known only from instalments.
    expect(m.entries.find((e) => e.key.startsWith("sipref:cams"))).toMatchObject({ described: false, state: "OBSERVED_ACTIVITY", confidence: "partial" });
    expect(m.exceptions.map((x) => x.code)).toContain("registration_not_described");
  });
});

describe("SIP Master — coverage", () => {
  it("registrations the instalments prove exist but no report described are counted as missing", () => {
    const m = buildSipMaster([k243()], [ev(), ev({ registrationRef: "999" }), ev({ registrationRef: "999", date: "2026-09-05" }), ev({ rta: "cams", amcCode: "B", registrationRef: "77" })], AS_OF);
    expect(m.coverage.kfintech).toEqual({ referencedByInstalments: 2, describedInMaster: 1, missingFromMaster: 1 });
    expect(m.coverage.cams).toEqual({ referencedByInstalments: 1, describedInMaster: 0, missingFromMaster: 1 });
  });
});

describe("SIP Master — Phase 3E fields", () => {
  it("status effective date, last successful instalment, confidence and the registrar's lifecycle events", () => {
    const m = buildSipMaster([
      k243(),
      k243({ registrationId: "2", startDate: "2026-11-01" }),
      k243({ registrationId: "3", terminateDate: "2026-09-20" }),
      w49({ pauseFrom: "2026-10-01", pauseTo: "2026-12-31" }),
    ], [ev({ date: "2026-09-05" }), ev({ date: "2026-10-05", outcome: "rejected", reason: "Insufficient balance" })], AS_OF);
    const by = (id: string) => m.entries.find((e) => e.registrationId === id)!;
    expect(by("202609010000001")).toMatchObject({ state: "ACTIVE", statusEffectiveDate: "2026-10-08", lastSuccessfulInstalment: "2026-09-05", operational: true, confidence: "verified" });
    expect(by("202609010000001").lifecycleEvents).toEqual([{ kind: "instalment_rejected", date: "2026-10-05", source: "transaction feed" }]);
    expect(by("2")).toMatchObject({ state: "PENDING", statusEffectiveDate: "2026-11-01" });
    expect(by("3")).toMatchObject({ state: "STOPPED", statusEffectiveDate: "2026-09-20" });
    expect(by("3").lifecycleEvents).toEqual([{ kind: "stop", date: "2026-09-20", source: "kfintech.mfsd243" }]);
    expect(by("654321")).toMatchObject({ state: "PAUSED", statusEffectiveDate: "2026-10-01" });
  });

  it("a registration known only from its instalments is evidenced, never in the book, and counted as operating only within the cycle", () => {
    const m = buildSipMaster([], [ev({ registrationRef: "77", date: "2026-10-01", kind: "sip", amount: 3000 }), ev({ registrationRef: "78", date: "2026-07-01", kind: "sip", amount: 1000 })], AS_OF);
    expect(m.entries.map((e) => [e.registrationId, e.described, e.kind, e.state, e.operational, e.amount])).toEqual([
      ["77", false, "sip", "OBSERVED_ACTIVITY", true, 3000],
      ["78", false, "sip", "UNKNOWN", false, 1000],
    ]);
    const b = activeSipBook(m);
    expect(b.active.count).toBe(0);
    expect(b.notDescribed).toEqual({ operating: 1, operatingLastInstalmentTotal: 3000, notOperating: 1 });
    expect(m.coverage.kfintech.missingFromMaster).toBe(2);
  });

  it("the owner comes from the caller's resolver", () => {
    const m = buildSipMaster([k243()], [], AS_OF, { ownerOf: (r) => (r.folio === "9100001" ? { investorId: "inv-1", folioId: "f-1", rule: "existing_folio_owner" } : null) });
    expect(m.entries[0].owner).toEqual({ investorId: "inv-1", folioId: "f-1", rule: "existing_folio_owner" });
  });
});

describe("SIP Master — observed activity is not verified status (Phase 3F)", () => {
  it("an instalment within ONE cycle of the frequency is observed activity; outside it the state stays UNKNOWN — never STOPPED", () => {
    // A stale register (90 days) cannot state the status; the instalment decides only OBSERVED vs UNKNOWN.
    const stale = { reportDate: "2026-07-01" };
    const q = buildSipMaster([k243({ ...stale, frequencyText: "Quarterly" })], [ev({ date: "2026-08-10" })], AS_OF).entries[0];
    expect(q).toMatchObject({ state: "OBSERVED_ACTIVITY", confidence: "partial", statusEffectiveDate: "2026-08-10" });
    const m = buildSipMaster([k243(stale)], [ev({ date: "2026-08-10" })], AS_OF).entries[0];
    expect(m.state).toBe("UNKNOWN");
    expect(m.state).not.toBe("STOPPED");
    expect(activeSipBook(buildSipMaster([k243({ ...stale, frequencyText: "Quarterly" })], [ev({ date: "2026-08-10" })], AS_OF))).toMatchObject({ active: { count: 0 }, observedActivity: 1 });
  });

  it("verified active needs a registrar status that speaks for the date — an instalment alone is not enough", () => {
    const e = buildSipMaster([k243()], [ev({ date: "2026-10-05" })], AS_OF).entries[0];
    expect(e).toMatchObject({ state: "ACTIVE", confidence: "verified" });
    const onlyInstalment = buildSipMaster([], [ev({ date: "2026-10-05", kind: "sip" })], AS_OF).entries[0];
    expect(onlyInstalment).toMatchObject({ state: "OBSERVED_ACTIVITY", confidence: "partial" });
  });
});

describe("Active SIP Book", () => {
  it("counts only SIPs in state ACTIVE; pending, unknown, STP and SWP are reported beside it", () => {
    const m = buildSipMaster([
      k243(), // active 5000 monthly
      k243({ registrationId: "2", startDate: "2026-11-01" }), // pending
      k243({ registrationId: "3", kindCode: "STP" }),
      w49({ kindCode: "R" }), // SWP
      w49({ registrationId: "7", frequencyText: "OW", amount: 1000 }), // active weekly
      k230({ folio: "9100009" }), // unkeyed → unknown
      k243({ registrationId: "4", terminateDate: "2026-09-01" }), // stopped
    ], [], AS_OF);
    const b = activeSipBook(m);
    expect(b.active.count).toBe(2);
    expect(b.active.monthlyAmount).toBe(Math.round((5000 + (1000 * 52) / 12) * 100) / 100);
    expect(b.pending.count).toBe(1);
    expect(b.unknown.count).toBe(1);
    expect(b.stoppedOrExpired).toBe(1);
    expect(b.nonSip).toEqual({ stp: 1, swp: 1, other: 0, unknownKind: 0 });
  });

  it("an active SIP whose frequency cannot be read is counted aside, not assumed monthly", () => {
    const b = activeSipBook(buildSipMaster([k243({ frequencyText: "Daily" })], [], AS_OF));
    expect(b.active.count).toBe(0);
    expect(b.activeWithUnknownFrequency).toBe(1);
  });

  it("the codes it reads are the verified ones; anything else is unknown", () => {
    expect(sipKind("kfintech", "SIP")).toEqual({ kind: "sip", confidence: "verified" });
    expect(sipKind("cams", "P")).toEqual({ kind: "sip", confidence: "verified" });
    expect(sipKind("cams", "SO").kind).toBe("stp");
    expect(sipKind("kfintech", "XYZ").kind).toBe("unknown");
    expect(sipFrequency("OM")).toBe("monthly");
    expect(sipFrequency("Weekly")).toBe("weekly");
    expect(sipFrequency("Daily")).toBeNull();
  });
});
