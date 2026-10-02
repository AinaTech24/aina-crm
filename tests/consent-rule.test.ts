/** One consent rule for every send: opt-out always blocks; marketing needs a grant; service messages go out. */
import { describe, expect, it } from "vitest";
import { consentDecision } from "@/lib/comms/consent-rule";

describe("consentDecision", () => {
  it("a service message goes out with no consent on record", () => {
    expect(consentDecision("transactional", null, "email")).toEqual({ blocked: false });
    expect(consentDecision("utility", { status: "pending" }, "whatsapp")).toEqual({ blocked: false });
  });

  it("an opt-out stops everything, service messages included", () => {
    expect(consentDecision("transactional", { status: "revoked" }, "email")).toMatchObject({ blocked: true, reason: "opted_out" });
    expect(consentDecision("marketing", { status: "revoked" }, "sms")).toMatchObject({ blocked: true, reason: "opted_out" });
  });

  it("marketing needs a recorded grant", () => {
    expect(consentDecision("marketing", null, "whatsapp")).toMatchObject({ blocked: true, reason: "marketing_needs_consent" });
    expect(consentDecision("marketing", { status: "pending" }, "whatsapp")).toMatchObject({ blocked: true });
    expect(consentDecision("marketing", { status: "granted" }, "whatsapp")).toEqual({ blocked: false });
  });
});
