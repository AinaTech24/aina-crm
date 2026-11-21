/**
 * The lead form's body must pass the API's zod schema (src/app/api/leads
 * CreateBody / [id] Patch), and its follow-up time is 10:00 IST.
 */
jest.mock("../LeadDuplicateNotice", () => ({ LeadDuplicateNotice: () => null }));
jest.mock("../../../api/client", () => ({ api: { get: jest.fn(), post: jest.fn(), patch: jest.fn(), del: jest.fn() } }));
jest.mock("../../../lib/offlineQueue", () => ({ queuedPost: jest.fn() }));

import { leadForm } from "../../forms/leads";

const initial = () => ({ ...(leadForm.initial as Record<string, unknown>) });

describe("lead form validation", () => {
  it("asks for 2+ characters and a real email, as the API does", () => {
    expect(leadForm.validate!({ ...initial(), name: "A" })?.name).toBeTruthy();
    expect(leadForm.validate!({ ...initial(), name: "Asha", email: "asha@" })?.email).toBeTruthy();
    expect(leadForm.validate!({ ...initial(), name: "Asha", email: "asha@x.in" })).toBeNull();
  });
  it("needs a referrer for a referral only when creating", () => {
    expect(leadForm.validate!({ ...initial(), name: "Asha", source: "referral" })?.referredByInvestorId).toBeTruthy();
    expect(leadForm.validate!({ ...initial(), _edit: "1", name: "Asha", source: "referral" })).toBeNull();
  });
});

describe("lead form body", () => {
  it("puts the first follow-up at 10:00 IST on the day picked", () => {
    const body = leadForm.buildBody({ ...initial(), name: "Asha", followUpDate: "2026-11-21" }, {});
    expect(body.followUpDate).toBe("2026-11-21T04:30:00.000Z");
  });

  const rec = { name: "Asha", phone: "9876543210", city: "Surat", source: "website", ownerId: "u1", nextFollowUpAt: "2026-11-20T04:30:00.000Z", notes: null };
  const edit = () => ({ ...initial(), ...leadForm.editInitial!(rec, {}) });

  it("reads a stored follow-up as its India day", () => {
    expect(edit().nextFollowUpAt).toBe("2026-11-20");
  });
  it("sends the RM change and clears only fields the record had", () => {
    const body = leadForm.buildBody({ ...edit(), ownerId: "u2", city: "", phone: "9876543210" }, {});
    expect(body.ownerId).toBe("u2");
    expect(body.city).toBe(""); // had one → cleared
    expect(body.pincode).toBeUndefined(); // never had one → left alone
    expect(body.notes).toBeUndefined();
  });
  it("clears the follow-up when it is removed", () => {
    expect(leadForm.buildBody({ ...edit(), nextFollowUpAt: "" }, {}).nextFollowUpAt).toBe("");
  });
});
