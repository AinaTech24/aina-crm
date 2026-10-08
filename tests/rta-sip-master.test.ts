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
    expect(m.entries[0].instalments.processed).toBe(0);
    expect(m.exceptions.map((x) => x.code)).toContain("instalment_unlinked");
  });
});

describe("SIP Master — coverage", () => {
  it("registrations the instalments prove exist but no report described are counted as missing", () => {
    const m = buildSipMaster([k243()], [ev(), ev({ registrationRef: "999" }), ev({ registrationRef: "999", date: "2026-09-05" }), ev({ rta: "cams", amcCode: "B", registrationRef: "77" })], AS_OF);
    expect(m.coverage.kfintech).toEqual({ referencedByInstalments: 2, describedInMaster: 1, missingFromMaster: 1 });
    expect(m.coverage.cams).toEqual({ referencedByInstalments: 1, describedInMaster: 0, missingFromMaster: 1 });
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
