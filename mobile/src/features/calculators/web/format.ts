// The one helper ppf.ts takes from the web's src/lib/format.ts (formatMoney),
// copied verbatim. Hand-kept (not by sync-from-web.mjs): the web module also
// builds a module-level Intl.DateTimeFormat the calculators never use.

export type MoneyScale = "auto" | "cr" | "lakh" | "full";

const CRORE = 1e7;
const LAKH = 1e5;

function toNumber(value: number | string | null | undefined): number | null {
  if (value == null) return null;
  const n = typeof value === "string" ? Number(value) : value;
  return Number.isFinite(n) ? n : null;
}

export function formatMoney(
  value: number | string | null | undefined,
  { scale = "auto", decimals = 2 }: { scale?: MoneyScale; decimals?: number } = {},
): string {
  const n = toNumber(value);
  if (n == null) return "—";

  const abs = Math.abs(n);
  const sign = n < 0 ? "-" : "";
  const resolved: MoneyScale =
    scale !== "auto" ? scale : abs >= CRORE ? "cr" : abs >= LAKH ? "lakh" : "full";

  if (resolved === "cr") return `${sign}₹${(abs / CRORE).toFixed(decimals)} Cr`;
  if (resolved === "lakh") return `${sign}₹${(abs / LAKH).toFixed(decimals)} Lakh`;
  return `${sign}₹${Math.round(abs).toLocaleString("en-IN")}`;
}
