import { describe, it, expect } from "vitest";
import { pincodeFill, shouldLookUpPincode } from "@/lib/pincode/autofill";

const place = { city: "Ahmedabad", state: "Gujarat" };

describe("pincode auto-fill (blanks only)", () => {
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
