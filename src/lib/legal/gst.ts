/**
 * GST identity helpers — states and their GST codes, GSTIN and PAN checks.
 * Pure; shared by the pricing sign-up, the onboarding wizard and the tax
 * invoice (which needs the recipient's state for CGST + SGST vs IGST).
 */

/** GST state / UT codes (CBIC). */
export const GST_STATES: ReadonlyArray<{ code: string; name: string }> = [
  { code: "01", name: "Jammu and Kashmir" },
  { code: "02", name: "Himachal Pradesh" },
  { code: "03", name: "Punjab" },
  { code: "04", name: "Chandigarh" },
  { code: "05", name: "Uttarakhand" },
  { code: "06", name: "Haryana" },
  { code: "07", name: "Delhi" },
  { code: "08", name: "Rajasthan" },
  { code: "09", name: "Uttar Pradesh" },
  { code: "10", name: "Bihar" },
  { code: "11", name: "Sikkim" },
  { code: "12", name: "Arunachal Pradesh" },
  { code: "13", name: "Nagaland" },
  { code: "14", name: "Manipur" },
  { code: "15", name: "Mizoram" },
  { code: "16", name: "Tripura" },
  { code: "17", name: "Meghalaya" },
  { code: "18", name: "Assam" },
  { code: "19", name: "West Bengal" },
  { code: "20", name: "Jharkhand" },
  { code: "21", name: "Odisha" },
  { code: "22", name: "Chhattisgarh" },
  { code: "23", name: "Madhya Pradesh" },
  { code: "24", name: "Gujarat" },
  { code: "26", name: "Dadra and Nagar Haveli and Daman and Diu" },
  { code: "27", name: "Maharashtra" },
  { code: "29", name: "Karnataka" },
  { code: "30", name: "Goa" },
  { code: "31", name: "Lakshadweep" },
  { code: "32", name: "Kerala" },
  { code: "33", name: "Tamil Nadu" },
  { code: "34", name: "Puducherry" },
  { code: "35", name: "Andaman and Nicobar Islands" },
  { code: "36", name: "Telangana" },
  { code: "37", name: "Andhra Pradesh" },
  { code: "38", name: "Ladakh" },
];

const norm = (s: string) => s.toLowerCase().replace(/&/g, "and").replace(/[^a-z]/g, "");
const ALIASES: Record<string, string> = {
  orissa: "21",
  pondicherry: "34",
  jammukashmir: "01",
  daman: "26",
  damananddiu: "26",
  dadranagarhaveli: "26",
  dadraandnagarhaveli: "26",
  newdelhi: "07",
  nctofdelhi: "07",
  andamannicobar: "35",
  uttaranchal: "05",
};

/** "Gujarat" / "GUJARAT" / "gujarat " → { code: "24", name: "Gujarat" }. */
export function gstState(nameOrCode: string | null | undefined): { code: string; name: string } | null {
  const raw = (nameOrCode ?? "").trim();
  if (!raw) return null;
  if (/^\d{2}$/.test(raw)) return GST_STATES.find((s) => s.code === raw) ?? null;
  const n = norm(raw);
  const byName = GST_STATES.find((s) => norm(s.name) === n);
  if (byName) return byName;
  const alias = ALIASES[n];
  return alias ? GST_STATES.find((s) => s.code === alias) ?? null : null;
}

const PAN_RE = /^[A-Z]{3}[ABCFGHLJPT][A-Z]\d{4}[A-Z]$/;

/** A PAN in the Income Tax Department's shape (holder-type letter included). */
export function isValidPan(pan: string | null | undefined): boolean {
  return PAN_RE.test((pan ?? "").trim().toUpperCase());
}

const GSTIN_CHARS = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ";

/** The GSTIN check character for its first 14 characters (GSTN's mod-36 scheme). */
export function gstinCheckChar(first14: string): string {
  let sum = 0;
  for (let i = 0; i < 14; i++) {
    const v = GSTIN_CHARS.indexOf(first14[i]);
    if (v < 0) return "?";
    const product = v * (i % 2 === 0 ? 1 : 2);
    sum += Math.floor(product / 36) + (product % 36);
  }
  return GSTIN_CHARS[(36 - (sum % 36)) % 36];
}

export type GstinCheck = { ok: true; gstin: string; stateCode: string; pan: string } | { ok: false; error: string };

/** Shape, state code, embedded PAN and check character. */
export function checkGstin(input: string | null | undefined): GstinCheck {
  const g = (input ?? "").trim().toUpperCase();
  if (!/^\d{2}[A-Z0-9]{10}[1-9A-Z]Z[0-9A-Z]$/.test(g)) {
    return { ok: false, error: "A GSTIN is 15 characters, e.g. 24ABCDE1234F1Z5." };
  }
  const stateCode = g.slice(0, 2);
  if (!GST_STATES.some((s) => s.code === stateCode) && stateCode !== "97" && stateCode !== "99") {
    return { ok: false, error: "The first two digits of the GSTIN are not a state code." };
  }
  const pan = g.slice(2, 12);
  if (!isValidPan(pan)) return { ok: false, error: "Characters 3–12 of a GSTIN are the PAN, and these are not a valid PAN." };
  if (gstinCheckChar(g.slice(0, 14)) !== g[14]) {
    return { ok: false, error: "This GSTIN's last character does not check out — please re-type it." };
  }
  return { ok: true, gstin: g, stateCode, pan };
}
