/**
 * A registrar row with a pincode and no city / state is completed from the
 * pincode — and nothing anyone wrote is ever replaced.
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/pincode/lookup", () => ({
  lookupPincode: vi.fn(async (pin: string) =>
    pin === "380015" ? { city: "Ahmedabad", state: "Gujarat" } : pin === "395007" ? { city: "Surat", state: "Gujarat" } : null),
}));

import { fillCityStateFromPincode } from "@/lib/pincode/fill";

describe("fillCityStateFromPincode", () => {
  it("fills blanks and registrar stand-ins, never a written value", async () => {
    const a = [
      { pincode: "380015" },
      { pincode: "380015", city: "NA", state: "-" },
      { pincode: "380015", city: "Vastrapur", state: "" },
      { pincode: "395007", city: "Surat", state: "Gujarat" },
    ];
    expect(await fillCityStateFromPincode(a)).toBe(3);
    expect(a[0]).toMatchObject({ city: "Ahmedabad", state: "Gujarat" });
    expect(a[1]).toMatchObject({ city: "Ahmedabad", state: "Gujarat" });
    expect(a[2]).toMatchObject({ city: "Vastrapur", state: "Gujarat" });
    expect(a[3]).toMatchObject({ city: "Surat", state: "Gujarat" });
  });

  it("leaves an unknown pincode, a bad pincode and a foreign address alone", async () => {
    const a = [{ pincode: "999999" }, { pincode: "38001" }, { pincode: "380015", country: "United Kingdom" }, null, undefined];
    expect(await fillCityStateFromPincode(a)).toBe(0);
    expect(a[0]).toEqual({ pincode: "999999" });
    expect(a[2]).toEqual({ pincode: "380015", country: "United Kingdom" });
  });
});
