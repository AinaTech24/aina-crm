/**
 * The pincode fill gives the CRM's answers — the web suite's cases
 * (tests/pincode-autofill.test.ts), plus the client form's wiring: a fill
 * never replaces a typed value, and the pincode on file is not looked up.
 */

jest.mock("../../../api/client", () => ({
  api: { get: jest.fn((path: string) => (path.endsWith("/380015") ? Promise.resolve({ city: "Ahmedabad", state: "Gujarat" }) : Promise.reject({ status: 404 }))) },
}));
jest.mock("../../../lib/offlineQueue", () => ({ queuedPost: jest.fn(), queuedPatch: jest.fn() }));
// The form's PAN notice is UI (buttons, animation); the rules under test are not.
jest.mock("../PanExistsNotice", () => ({ PanExistsNotice: () => null }));

import { pincodeFill, shouldLookUpPincode, pincodeLookup, clearPincodeCache } from "../pincode";
import { investorForm } from "../../forms/investors";

const place = { city: "Ahmedabad", state: "Gujarat" };
const flush = () => new Promise((r) => setTimeout(r, 0));

describe("pincode auto-fill (web tests/pincode-autofill.test.ts)", () => {
  it("looks up only a complete Indian pincode", () => {
    expect(shouldLookUpPincode("380015", "")).toBe(true);
    expect(shouldLookUpPincode("380015", "India")).toBe(true);
    expect(shouldLookUpPincode("38001", "India")).toBe(false);
    expect(shouldLookUpPincode("080015", "India")).toBe(false);
    expect(shouldLookUpPincode("380015", "United Arab Emirates")).toBe(false);
  });
  it("fills a blank city, state and country", () => {
    expect(pincodeFill({ city: "", state: "", country: "" }, place)).toEqual({
      set: { city: "Ahmedabad", state: "Gujarat", country: "India" }, stateMismatch: null,
    });
  });
  it("never replaces a typed city or state", () => {
    const r = pincodeFill({ city: "Sanand", state: "Gujarat", country: "India" }, place);
    expect(r.set).toEqual({});
    expect(r.stateMismatch).toBeNull();
  });
  it("keeps a typed state that disagrees and offers the pincode's", () => {
    const r = pincodeFill({ city: "", state: "Maharashtra", country: "India" }, place);
    expect(r.set).toEqual({ city: "Ahmedabad" });
    expect(r.stateMismatch).toBe("Gujarat");
  });
  it("treats spelling variants of the same state as a match", () => {
    expect(pincodeFill({ city: "", state: "GUJARAT", country: "India" }, place).stateMismatch).toBeNull();
  });
});

describe("the client form's pincode wiring", () => {
  beforeEach(() => clearPincodeCache());
  const base = () => (investorForm.initial as (p: Record<string, string>) => Record<string, any>)({});

  it("fills only blanks once the answer is in, and keeps a typed city", async () => {
    pincodeLookup("380015");
    await flush();
    const typed = { ...base(), city: "Sanand", pincode: "380015" };
    const d = investorForm.derive!(typed)!;
    expect(d.city).toBeUndefined();
    expect(d.state).toBe("Gujarat");
    expect(d._pinDone).toBe("380015");
  });

  it("offers a disagreeing state without changing it, and switches on request", async () => {
    pincodeLookup("380015");
    await flush();
    const v = { ...base(), state: "Maharashtra", pincode: "380015" };
    const d = investorForm.derive!(v)!;
    expect(d.state).toBeUndefined();
    expect(d._pinState).toBe("Gujarat");
    const accepted = investorForm.derive!({ ...v, ...d, _useState: true })!;
    expect(accepted.state).toBe("Gujarat");
  });

  it("does not look up the pincode on file when the edit form opens", async () => {
    pincodeLookup("380015");
    await flush();
    const rec = { name: "A Client", pan: "ABCDE1234F", investorCategory: "individual", address: { pincode: "380015", city: "", state: "" } };
    const v = { ...base(), ...investorForm.editInitial!(rec, {}) };
    const d = investorForm.derive!(v);
    expect(d?.city).toBeUndefined();
    expect(d?.state).toBeUndefined();
  });

  it("fills blanks at save when the answer came after the last change", async () => {
    const v = { ...base(), name: "A Client", pan: "ABCDE1234F", pincode: "380015" };
    pincodeLookup("380015");
    await flush();
    const body = investorForm.buildBody(v, {});
    expect(body.address.city).toBe("Ahmedabad");
    expect(body.address.state).toBe("Gujarat");
  });
});
