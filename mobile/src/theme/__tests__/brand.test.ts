import { useBrand } from "../brand";
import { palette, PALETTES } from "../tokens";
import { accentTokens, firmPrimary, DEFAULT_ACCENT } from "../accent";
import { contrast } from "../color";

describe("one accent", () => {
  afterEach(() => useBrand.getState().setBrand(null, null));

  it("an unbranded firm gets the stock accent everywhere — never red", () => {
    useBrand.getState().setBrand(null, null);
    const s = useBrand.getState();
    expect(s.brand).toBe(DEFAULT_ACCENT);
    expect(s.accent).toBe(s.brand);
    expect(palette.brand).toBe(s.brand);
    expect(palette.brand).not.toBe(palette.danger);
  });

  it("the firm's PRIMARY is the accent; the secondary colour never becomes a second one", () => {
    useBrand.getState().setBrand("#0E2557", "#0EA5E9");
    const s = useBrand.getState();
    expect(s.brand).toBe("#0E2557");
    expect(s.accent).toBe(s.brand);
    expect(s.accentDark).toBe(s.brandDark);
    expect(s.brandDark).not.toBe(s.brand);
  });

  it("writes the accent into palette so inline reads follow mid-session", () => {
    useBrand.getState().setBrand("#064E3B", null);
    expect(palette.brand).toBe(useBrand.getState().brand);
    expect(palette.brandDark).toBe(useBrand.getState().brandDark);
    expect(palette.brandLight).toBe(useBrand.getState().brandLight);
  });

  it("rejects malformed hex and the legacy column default", () => {
    useBrand.getState().setBrand("blue", "#12");
    expect(useBrand.getState().brand).toBe(DEFAULT_ACCENT);
    expect(firmPrimary("#1f2937")).toBeNull();
    expect(firmPrimary("#1F2937")).toBeNull();
    expect(firmPrimary("123456")).toBe("#123456");
  });

  it("keeps a bright firm colour dark enough to carry white text (light)", () => {
    const t = accentTokens("#F97316", "light");
    expect(contrast(t.brand, "#FFFFFF")).toBeGreaterThanOrEqual(4.5);
  });

  it("dark mode: the accent reads as text on a dark card and still carries white text", () => {
    for (const firm of [null, "#0E2557", "#F97316", "#064E3B", "#1E293B"]) {
      const t = accentTokens(firm, "dark");
      expect(contrast(t.brand, PALETTES.dark.surface)).toBeGreaterThanOrEqual(4.5);
      expect(contrast("#FFFFFF", t.brand)).toBeGreaterThanOrEqual(3.4);
      expect(contrast(t.brandDark, PALETTES.dark.surface)).toBeGreaterThanOrEqual(7);
    }
  });
});

describe("palettes", () => {
  it("both sets define every token", () => {
    expect(Object.keys(PALETTES.dark).sort()).toEqual(Object.keys(PALETTES.light).sort());
  });

  it("secondary text meets 4.5:1 on every surface", () => {
    for (const p of [PALETTES.light, PALETTES.dark]) {
      for (const bg of [p.surface, p.surfaceAlt, p.surfaceSunken]) {
        expect(contrast(p.muted, bg)).toBeGreaterThanOrEqual(4.5);
        expect(contrast(p.faint, bg)).toBeGreaterThanOrEqual(4.5);
        expect(contrast(p.ink, bg)).toBeGreaterThanOrEqual(7);
      }
    }
  });

  it("red stays the danger signal in both sets", () => {
    expect(PALETTES.light.danger.toUpperCase()).toBe("#DC2626");
    expect(PALETTES.dark.danger.toUpperCase()).toBe("#EF4444");
  });
});
