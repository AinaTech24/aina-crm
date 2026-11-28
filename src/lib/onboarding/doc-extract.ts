/**
 * Read the client's details out of the documents they upload on the public
 * onboarding link (/d/<token>), so the form asks only for what the documents
 * do not show. NO AI: the text comes from the PDF text layer or OCR
 * (lib/insurance/extract-text.ts), and these pure parsers pick the fields out
 * with patterns — tested in tests/doc-extract.test.ts.
 *
 *   PAN card            PAN, name, father's name, date of birth (incorporation
 *                       date for a company / firm / HUF / trust PAN)
 *   Aadhaar             name, date of birth, gender, the number MASKED to its
 *                       last four digits, and the address (back side)
 *   Address proof       address line, city, state, PIN code
 *   Cheque / statement  IFSC, bank name (from the IFSC), account number,
 *                       account type
 *
 * Output keys are the KYC field keys of lib/onboarding/kyc-fields.ts, so the
 * form can drop them straight in. OCR is imperfect: everything read is shown
 * to the client to check, never submitted unseen. A full Aadhaar number is
 * never returned (UIDAI: only the last four digits are kept).
 */

export type DocKind = "pan" | "aadhaar" | "address" | "bank";
export type Extracted = { kind: DocKind | null; fields: Record<string, string> };

const lines = (t: string) =>
  t
    .split(/\r?\n/)
    .map((l) => l.replace(/\s+/g, " ").trim())
    .filter(Boolean);

const PAN_RE = /\b([A-Z]{5}[0-9]{4}[A-Z])\b/;
const IFSC_RE = /\b([A-Z]{4})[0O]([A-Z0-9]{6})\b/;
const DATE_RE = /\b(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{4})\b/;
const PIN_RE = /\b([1-9]\d{5})\b/;

/** dd/mm/yyyy → yyyy-mm-dd, when it is a real date. */
export function isoDate(d: string, m: string, y: string): string | null {
  const dd = Number(d), mm = Number(m), yy = Number(y);
  if (!(yy >= 1900 && yy <= 2100 && mm >= 1 && mm <= 12 && dd >= 1 && dd <= 31)) return null;
  const dt = new Date(Date.UTC(yy, mm - 1, dd));
  if (dt.getUTCMonth() !== mm - 1) return null;
  return `${yy}-${String(mm).padStart(2, "0")}-${String(dd).padStart(2, "0")}`;
}

function firstDate(text: string): string | null {
  const re = new RegExp(DATE_RE.source, "g");
  for (const m of text.matchAll(re)) {
    const iso = isoDate(m[1], m[2], m[3]);
    if (iso) return iso;
  }
  return null;
}

/** "RAHUL KUMAR SHARMA" → "Rahul Kumar Sharma" (keeps initials like "R. K."). */
export function titleCase(s: string): string {
  return s
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim()
    .replace(/(^|[\s.'-])([a-z])/g, (_, p, c) => p + c.toUpperCase());
}

const HEADER_WORDS = /\b(INCOME|TAX|DEPARTMENT|DEPT|GOVT|GOVERNMENT|INDIA|PERMANENT|ACCOUNT|NUMBER|CARD|SIGNATURE|NAME|FATHER|DATE|BIRTH|OF)\b/i;

/** A line that looks like a person's name: letters, spaces, dots only, 2–60 chars, not a header. */
function nameLike(l: string): boolean {
  const clean = l.replace(/[^A-Za-z .']/g, "").trim();
  if (clean.length < 3 || clean.length > 60) return false;
  if (clean.length < l.replace(/\s/g, "").length * 0.8) return false; // mostly other characters
  return !HEADER_WORDS.test(clean);
}

const cleanName = (l: string) => titleCase(l.replace(/[^A-Za-z .']/g, " "));

// ── PAN card ─────────────────────────────────────────────────────────────────
export function parsePanCard(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  const flat = text.replace(/\s+/g, " ").toUpperCase();
  const pan = flat.match(PAN_RE)?.[1];
  if (pan) out.pan = pan;
  const ls = lines(text);
  let name: string | null = null;
  let father: string | null = null;
  // New format: the value is on the line after its label.
  for (let i = 0; i < ls.length - 1; i++) {
    if (/father/i.test(ls[i]) && !father && nameLike(ls[i + 1])) father = ls[i + 1];
    else if (/\bname\b/i.test(ls[i]) && !/father/i.test(ls[i]) && !name && nameLike(ls[i + 1])) name = ls[i + 1];
  }
  // Old format: the first two name-like lines are the holder and the father.
  if (!name) {
    const candidates = ls.filter((l) => nameLike(l) && l === l.toUpperCase());
    name = candidates[0] ?? null;
    if (!father) father = candidates[1] ?? null;
  }
  if (name) out.name_as_per_pan = cleanName(name);
  if (father) out.father_name = cleanName(father);
  const date = firstDate(text);
  // The PAN's fourth letter says who holds it: P = a person; C, H, F, T, A… = an entity.
  if (date) {
    if (!pan || pan[3] === "P") out.dob = date;
    else out.date_of_incorporation = date;
  }
  return out;
}

// ── Aadhaar ─────────────────────────────────────────────────────────────────
export function parseAadhaar(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  const ls = lines(text);
  // 12 digits in groups of four — but not a 16-digit VID.
  const num = text.match(/(?<!\d[ ]?)\b(\d{4}) ?(\d{4}) ?(\d{4})\b(?! ?\d{4})/);
  if (num && num[1][0] !== "0" && num[1][0] !== "1") out.aadhaar = `XXXX XXXX ${num[3]}`;
  const gender = /\bfemale\b/i.test(text) ? "Female" : /\bmale\b/i.test(text) ? "Male" : /\btransgender\b/i.test(text) ? "Other" : null;
  if (gender) out.gender = gender;
  const dobIdx = ls.findIndex((l) => /\b(DOB|D\.O\.B|date of birth|year of birth)\b/i.test(l) || DATE_RE.test(l));
  if (dobIdx >= 0) {
    const d = firstDate(ls[dobIdx]);
    if (d) out.dob = d;
    for (let i = dobIdx - 1; i >= 0 && i >= dobIdx - 3; i--) {
      const l = ls[i];
      if (/government|india|aadhaar|unique|authority/i.test(l)) break;
      if (/^[A-Za-z .']+$/.test(l) && nameLike(l)) {
        out.name_as_per_pan = cleanName(l);
        break;
      }
    }
  }
  Object.assign(out, parseAddress(text));
  return out;
}

// ── Address (Aadhaar back, utility bill, passport last page…) ──────────────
const STATES = [
  "Andhra Pradesh", "Arunachal Pradesh", "Assam", "Bihar", "Chhattisgarh", "Goa", "Gujarat", "Haryana", "Himachal Pradesh",
  "Jharkhand", "Karnataka", "Kerala", "Madhya Pradesh", "Maharashtra", "Manipur", "Meghalaya", "Mizoram", "Nagaland", "Odisha",
  "Punjab", "Rajasthan", "Sikkim", "Tamil Nadu", "Telangana", "Tripura", "Uttar Pradesh", "Uttarakhand", "West Bengal",
  "Andaman and Nicobar Islands", "Chandigarh", "Dadra and Nagar Haveli and Daman and Diu", "Delhi", "Jammu and Kashmir",
  "Ladakh", "Lakshadweep", "Puducherry",
];

export function parseAddress(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  const flat = text.replace(/\s+/g, " ");
  const at = flat.search(/\baddress\b\s*[:\-]?/i);
  if (at < 0) return out;
  let rest = flat.slice(at).replace(/^address\s*[:\-]?\s*/i, "");
  const pin = rest.match(PIN_RE);
  if (!pin) return out;
  rest = rest.slice(0, (pin.index ?? 0) + pin[0].length);
  out.address_pincode = pin[1];
  let body = rest.slice(0, pin.index).replace(/[\s,\-]+$/, "");
  // Care-of ("S/O Suresh Sharma,") is not part of the postal address.
  body = body.replace(/^\s*[SDWC]\s*\/\s*O\s*[:\-]?\s*[^,]+,\s*/i, "");
  const state = STATES.find((s) => new RegExp(`\\b${s.replace(/ /g, "\\s+")}\\b`, "i").test(body));
  if (state) {
    out.address_state = state;
    body = body.replace(new RegExp(`[,\\s]*\\b${state.replace(/ /g, "\\s+")}\\b[,\\s]*$`, "i"), "").replace(new RegExp(`\\b${state.replace(/ /g, "\\s+")}\\b`, "i"), "");
  }
  const dist = body.match(/\b(?:dist(?:rict)?|dt)\.?\s*[:\-]?\s*([A-Za-z ]{3,30}?)(?:,|$)/i);
  const parts = body.split(",").map((p) => p.trim()).filter(Boolean);
  let city: string | null = dist ? dist[1].trim() : null;
  if (!city && parts.length > 1) city = parts[parts.length - 1];
  if (city && /^[A-Za-z .]+$/.test(city)) {
    out.address_city = titleCase(city);
    const idx = parts.findIndex((p) => p.toLowerCase().includes(city!.toLowerCase()));
    if (idx > 0) parts.splice(idx);
  }
  const line = parts.join(", ").replace(/\s+,/g, ",").trim();
  if (line.length >= 5) out.address_line1 = line;
  return out;
}

// ── Cheque / bank statement / passbook ──────────────────────────────────────
const BANKS: Record<string, string> = {
  SBIN: "State Bank of India", HDFC: "HDFC Bank", ICIC: "ICICI Bank", UTIB: "Axis Bank", KKBK: "Kotak Mahindra Bank",
  PUNB: "Punjab National Bank", BARB: "Bank of Baroda", CNRB: "Canara Bank", UBIN: "Union Bank of India", IDIB: "Indian Bank",
  BKID: "Bank of India", YESB: "Yes Bank", INDB: "IndusInd Bank", IDFB: "IDFC FIRST Bank", FDRL: "Federal Bank",
  CBIN: "Central Bank of India", MAHB: "Bank of Maharashtra", IOBA: "Indian Overseas Bank", UCBA: "UCO Bank",
  PSIB: "Punjab & Sind Bank", KVBL: "Karur Vysya Bank", SIBL: "South Indian Bank", KARB: "Karnataka Bank", RATN: "RBL Bank",
  AUBL: "AU Small Finance Bank", DBSS: "DBS Bank India", SCBL: "Standard Chartered Bank", HSBC: "HSBC", CITI: "Citibank",
  ESFB: "Equitas Small Finance Bank", UJVN: "Ujjivan Small Finance Bank", DLXB: "Dhanlaxmi Bank", CSBK: "CSB Bank",
  TMBL: "Tamilnad Mercantile Bank", JAKA: "Jammu & Kashmir Bank", BDBL: "Bandhan Bank", IBKL: "IDBI Bank",
  GSCB: "Gujarat State Co-operative Bank", SVCB: "SVC Co-operative Bank", COSB: "Cosmos Bank", SRCB: "Saraswat Bank",
  APGB: "Andhra Pragathi Grameena Bank", NKGS: "NKGSB Co-operative Bank", AIRP: "Airtel Payments Bank", PYTM: "Paytm Payments Bank",
};

export function parseBank(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  const flat = text.replace(/\s+/g, " ");
  const upper = flat.toUpperCase();
  // Prefer an IFSC printed after its label; OCR often reads the 5th character 0 as O.
  // After the label, a space OCR slipped into the code ("SBIN O001234") is tolerated.
  const labelled = upper.match(/IFS(?:C)?\s*(?:CODE)?\s*[:\-.]?\s*([A-Z]{4})\s?[0O]([A-Z0-9]{6})\b/);
  const any = labelled ?? upper.match(IFSC_RE);
  if (any) {
    out.bank_ifsc = `${any[1]}0${any[2]}`;
    const bank = BANKS[any[1]];
    if (bank) out.bank_name = bank;
  }
  if (!out.bank_name) {
    const named = flat.match(/\b([A-Z][A-Za-z&.]*(?: [A-Z][A-Za-z&.]*){0,4} Bank(?: Ltd\.?| Limited)?)\b/);
    if (named) out.bank_name = named[1].replace(/ (Ltd\.?|Limited)$/i, "");
  }
  const acc =
    flat.match(/\b(?:A\/?C|ACCOUNT|ACCT)\.?\s*(?:NO|NUMBER|NUM)?\.?\s*[:\-.]?\s*((?:\d[\s-]?){9,18})\b/i) ??
    flat.match(/\b(?:SB|CA|CC|OD)\s*A\/?C\s*[:\-.]?\s*((?:\d[\s-]?){9,18})\b/i);
  if (acc) {
    const digits = acc[1].replace(/\D/g, "");
    if (digits.length >= 9 && digits.length <= 18) out.bank_account_number = digits;
  }
  if (/\b(NRE)\b/.test(upper)) out.bank_account_type = "NRE";
  else if (/\b(NRO)\b/.test(upper)) out.bank_account_type = "NRO";
  else if (/\bCURRENT\b|\bCA\s*A\/?C\b/.test(upper)) out.bank_account_type = "Current";
  else if (/\bSAVINGS?\b|\bSB\s*A\/?C\b/.test(upper)) out.bank_account_type = "Savings";
  return out;
}

// ── Which document is it, and whose details does it carry ──────────────────

/** What a document slot is expected to hold, from its key in doc-checklists.ts. */
export function expectedKind(docKey: string): DocKind | null {
  if (/pan$|_pan$|^pan/.test(docKey)) return "pan";
  if (/aadha?r/.test(docKey)) return "aadhaar";
  if (/cheque|bank_statement|nre_nro_statement|statement/.test(docKey)) return "bank";
  if (/address_proof/.test(docKey)) return "address";
  return null;
}

/** What the text looks like, whatever slot it was uploaded to. */
export function detectKind(text: string): DocKind | null {
  const t = text.toUpperCase();
  if (/INCOME\s*TAX|PERMANENT\s*ACCOUNT/.test(t)) return "pan";
  if (/AADHAAR|AADHAR|UNIQUE IDENTIFICATION|आधार/.test(t) || /\b\d{4} \d{4} \d{4}\b/.test(t)) return "aadhaar";
  if (IFSC_RE.test(t)) return "bank";
  if (/\bADDRESS\b/.test(t) && PIN_RE.test(t)) return "address";
  if (PAN_RE.test(t)) return "pan";
  return null;
}

/**
 * A guardian's or authorised person's document fills THEIR fields, not the
 * client's: rename the keys. Documents of people whose details the form does
 * not ask for (a karta's or guardian's Aadhaar) fill nothing.
 */
export function forSlot(slotKey: string, fields: Record<string, string>): Record<string, string> {
  // "guardian_aadhar_back" is the back of the guardian's Aadhaar — same owner.
  const docKey = slotKey.replace(/_back$/, "");
  const pick = (map: Record<string, string>) =>
    Object.fromEntries(Object.entries(map).flatMap(([from, to]) => (fields[from] ? [[to, fields[from]]] : [])));
  if (docKey === "guardian_pan") return pick({ name_as_per_pan: "guardian_name", pan: "guardian_pan" });
  if (docKey === "karta_pan") return pick({ name_as_per_pan: "authorised_person_name", pan: "authorised_person_pan" });
  if (docKey === "guardian_aadhar" || docKey === "karta_aadhar") return {};
  return fields;
}

/** Read one document's text: decide what it is and pick out its fields. */
export function extractFromText(text: string, docKey: string): Extracted {
  const kind = detectKind(text) ?? expectedKind(docKey);
  let fields: Record<string, string> = {};
  if (kind === "pan") fields = parsePanCard(text);
  else if (kind === "aadhaar") fields = parseAadhaar(text);
  else if (kind === "address") fields = parseAddress(text);
  else if (kind === "bank") fields = parseBank(text);
  // A bank statement or address proof often also prints the address — take it when the slot is an address slot.
  if (kind === "bank" && expectedKind(docKey) === "address") Object.assign(fields, parseAddress(text));
  return { kind, fields: forSlot(docKey, fields) };
}

/** Plain-English name of what was read, for "Read from your PAN card". */
export const KIND_LABEL: Record<DocKind, string> = {
  pan: "PAN card",
  aadhaar: "Aadhaar",
  address: "address proof",
  bank: "bank document",
};
