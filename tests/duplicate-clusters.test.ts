/**
 * Find Duplicates must find what the client search shows twice — by PAN,
 * name + date of birth, name + email / mobile, and name alone — and must never
 * call two people one: different PANs or different dates of birth stay apart,
 * and a household sharing one email under different names is only "shared".
 */
import { describe, expect, it } from "vitest";
import { findClusters } from "@/lib/investors/duplicate-clusters";

let n = 0;
const rec = (v: Partial<{ name: string; pan: string; phone: string; email: string; dob: string; is_minor: boolean; whatsapp_phone: string }>) => ({
  id: `c${++n}`, name: v.name ?? null, pan: v.pan ?? null, phone: v.phone ?? null, alternate_phone: null,
  whatsapp_phone: v.whatsapp_phone ?? null, email: v.email ?? null, dob: v.dob ?? null, is_minor: v.is_minor ?? false,
  aum: 0, rm_name: null,
});
const kinds = (rows: ReturnType<typeof rec>[]) =>
  findClusters(rows).map((c) => `${c.kind}:${c.ids.length}`).sort();

describe("findClusters", () => {
  it("same PAN", () => {
    expect(kinds([rec({ name: "A B", pan: "AAAPA1111A" }), rec({ name: "Other Name", pan: "aaapa1111a" })])).toEqual(["PAN:2"]);
  });

  it("an RTA placeholder beside the real client: same name, word order and honorific aside", () => {
    expect(kinds([rec({ name: "RAMILABEN NARENDRAKUMAR SHAH", pan: "ADAPS6650B" }), rec({ name: "Mrs Shah Ramilaben Narendrakumar" })])).toEqual(["Name:2"]);
  });

  it("same name + shared mobile (any phone column, +91 ignored) is reported as such", () => {
    expect(kinds([rec({ name: "Shalvi Krupesh Shah", phone: "+91 98765 43210" }), rec({ name: "SHALVI KRUPESH SHAH", whatsapp_phone: "9876543210" })])).toEqual(["NameContact:2"]);
  });

  it("same name + date of birth", () => {
    expect(kinds([rec({ name: "Asha Mehta", dob: "1980-01-02" }), rec({ name: "ASHA MEHTA", dob: "1980-01-02" })])).toEqual(["NameDob:2"]);
  });

  it("never two different PANs or two different dates of birth", () => {
    expect(kinds([rec({ name: "Nimesh Shah", pan: "AAAPN1111A", email: "x@y.in" }), rec({ name: "Nimesh Shah", pan: "BBBPN2222B", email: "x@y.in" })])).toEqual(["Email:2"]);
    expect(kinds([rec({ name: "Raj Patel", dob: "1970-01-01" }), rec({ name: "Raj Patel", dob: "1999-05-05" })])).toEqual([]);
  });

  it("a household on one email under different names is shared, not a duplicate", () => {
    expect(kinds([rec({ name: "Swati Shah", email: "home@x.in" }), rec({ name: "Nimesh Shah", email: "home@x.in" })])).toEqual(["Email:2"]);
  });

  it("one-word names match only with a shared contact", () => {
    expect(kinds([rec({ name: "Ramesh" }), rec({ name: "RAMESH" })])).toEqual([]);
    expect(kinds([rec({ name: "Ramesh", phone: "9123456780" }), rec({ name: "RAMESH", phone: "9123456780" })])).toEqual(["NameContact:2"]);
  });

  it("a minor is not PAN-matched (guardian's PAN) but still found by name", () => {
    expect(kinds([rec({ name: "Yaksh Jignesh Amin", pan: "AEHPA6722L", is_minor: true }), rec({ name: "Kid Two Amin", pan: "AEHPA6722L", is_minor: true })])).toEqual([]);
    expect(kinds([rec({ name: "Yaksh Jignesh Amin", pan: "MINOR:AEHPA6722L:YAKSH" }), rec({ name: "Yaksh Jignesh Amin", pan: "GLMPA6179R" })])).toEqual(["Name:2"]);
  });

  it("an import's stand-in name never matches", () => {
    expect(kinds([rec({ name: "Unnamed (no PAN)" }), rec({ name: "Unnamed (no PAN)" }), rec({ name: "UNKNOWN INVESTOR" }), rec({ name: "Unknown Investor" })])).toEqual([]);
  });

  it("a stronger rule hides the weaker group with the same records", () => {
    expect(kinds([rec({ name: "Asha Mehta", pan: "AAAPA1111A", dob: "1980-01-02", email: "a@x.in" }), rec({ name: "Asha Mehta", pan: "AAAPA1111A", dob: "1980-01-02", email: "a@x.in" })])).toEqual(["PAN:2"]);
  });
});
