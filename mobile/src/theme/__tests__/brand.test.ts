import { useBrand } from "../brand";
import { palette } from "../tokens";

describe("brand store", () => {
  afterEach(() => useBrand.getState().setBrand(null, null));

  it("falls back to the default palette when nothing is set", () => {
    useBrand.getState().setBrand(null, null);
    const s = useBrand.getState();
    expect(s.brand).toBe(palette.brand);
    expect(s.accent).toBe(palette.brand);
  });

  it("applies primary AND accent independently", () => {
    useBrand.getState().setBrand("#0E2557", "#0EA5E9");
    const s = useBrand.getState();
    expect(s.brand).toBe("#0E2557");
    expect(s.accent).toBe("#0EA5E9");
    expect(s.brandDark).not.toBe(s.brand);
    expect(s.accentLight).not.toBe(s.accent);
  });

  it("accent falls back to primary when unset (pre-accent tenants)", () => {
    useBrand.getState().setBrand("#123456", null);
    expect(useBrand.getState().accent).toBe("#123456");
  });

  it("rejects malformed hex", () => {
    useBrand.getState().setBrand("blue", "#12");
    expect(useBrand.getState().brand).toBe(palette.brand);
  });
});
