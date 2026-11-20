/**
 * CAMS mailback parser.
 *
 * CAMS ships its folio statement as a binary `.xls` (read into rows by xls.ts).
 * The report is a COMBINED master + holdings feed — one row per
 * (amc_code × foliochk × product/scheme) carrying units (clos_bal), market value
 * (rupee_bal), full KYC (tax_status, DOB, CKYC), bank, up to 3 nominees, plus
 * occupation and ARN. So it imports as kind="full": master fields AND folio
 * valuations + AUM. Dates are Excel serials (e.g. 46188 → 2026-06-15).
 */

import type { RtaFolioRecord, RtaNominee, InvestorCategory, Residency } from "./types";
import { clientTypeFromTaxStatus } from "@/lib/investors/client-types";
import { num, amcNameFromDescription, canonicalizeAmcNames, maskAccount, pct, dmyToIso } from "./kfintech";

/**
 * Columns that identify the CAMS folio statement (investor static details WITH
 * balance). Two layouts exist:
 *   · the older one — FOLIOCHK, PAN_NO, PRODUCT, SCH_NAME, CLOS_BAL, RUPEE_BAL …
 *   · the "R9C" one (files named …R9C.csv, Shah Financial 20 Nov 2026) —
 *     AMC_CODE, PRODUCT_CODE, FOLIOCHK, INV_NAME … PAN_PEKRN … CLOS_BAL, RUPEE_BAL,
 *     with NO scheme name and dates written "9/14/1982  12:00:00 AM" (month first).
 * The R9C file was refused as "header did not match any known report" because the
 * signature demanded pan_no and sch_name, which it does not carry.
 */
const SIGNATURE = ["foliochk", "rupee_bal", "clos_bal"];
const PAN_COLS = ["pan_no", "pan_pekrn"];
const SCHEME_COLS = ["sch_name", "product", "product_code"];

export function isCamsFile(header: string[]): boolean {
  const have = new Set(header.map((h) => h.trim().toLowerCase()));
  return (
    SIGNATURE.every((h) => have.has(h)) &&
    PAN_COLS.some((h) => have.has(h)) &&
    SCHEME_COLS.some((h) => have.has(h))
  );
}

/**
 * A CAMS file that is the DEMOGRAPHICS-ONLY investor feed (WBR9 "Investor Static details
 * feed": FOLIOCHK, INV_NAME, ADDRESS1 … and no balance columns). It can never satisfy the
 * with-balance signature above, so the importer says exactly that instead of the generic
 * "did not match any known report". From the vittmantra copy, 2026-11-19.
 */
export function isCamsStaticOnlyFile(header: string[]): boolean {
  const have = new Set(header.map((h) => h.trim().toLowerCase()));
  const looksCams = have.has("foliochk") && (have.has("inv_name") || have.has("pan_no"));
  const hasBalances = have.has("rupee_bal") || have.has("clos_bal");
  return looksCams && !hasBalances;
}

/**
 * Excel serial (e.g. "46188"), bare "YYYYMMDD", or "DD/MM/YYYY" → ISO yyyy-mm-dd.
 *
 * The bare-YYYYMMDD branch is not optional. CAMS ships dates of birth as plain
 * 8-digit numbers in some exports; without this they fell through to the Excel
 * branch, where 19850612 days past 1899 lands in the year 56249 and
 * `toISOString()` returns "+056249-02-11...". That went straight into
 * `investors.dob` (a `date` column), Postgres rejected it, and the WHOLE tenant
 * transaction aborted — a 5,000-folio master lost to one cell.
 *
 * The serial branch is bounded to a plausible window for the same reason: a
 * value outside it is not a date we can trust, and returning null loses one
 * field instead of the entire file.
 */
const EXCEL_SERIAL_MAX = 60000; // ~year 2064
function camsDate(s?: string): string | null {
  const v = (s ?? "").trim();
  if (!v) return null;
  if (/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(v)) return dmyToIso(v);

  // "9/14/1982  12:00:00 AM" — the R9C layout prints a US-locale date-time:
  // MONTH first, then a 12-hour clock. Measured on a 27,119-row file: the first
  // part is never above 12, the second is above 12 in more than half the rows.
  // The AM/PM clock is what marks the US order; without it a slash date stays
  // day-first, as before. An impossible month with a possible day is read the
  // other way round rather than dropped.
  const us = v.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})\s+\d{1,2}:\d{2}(?::\d{2})?\s*[AaPp][Mm]$/);
  if (us) {
    let mo = Number(us[1]), dy = Number(us[2]);
    const yr = Number(us[3]);
    if (mo > 12 && dy <= 12) [mo, dy] = [dy, mo];
    if (yr < 1900 || yr > 2100 || mo < 1 || mo > 12 || dy < 1 || dy > 31) return null;
    const d = new Date(Date.UTC(yr, mo - 1, dy));
    if (d.getUTCMonth() !== mo - 1) return null; // 2/30 and the like
    return d.toISOString().slice(0, 10);
  }
  // A day-first date with a 24-hour time after it: drop the time.
  const dmyTime = v.match(/^(\d{1,2}\/\d{1,2}\/\d{4})\s+\d{1,2}:\d{2}(?::\d{2})?$/);
  if (dmyTime) return dmyToIso(dmyTime[1]);

  // Bare YYYYMMDD, e.g. "19850612". Must be tested BEFORE the serial branch.
  const ymd = v.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (ymd) {
    const [, y, m, d] = ymd;
    const yr = Number(y), mo = Number(m), dy = Number(d);
    if (yr < 1900 || yr > 2100 || mo < 1 || mo > 12 || dy < 1 || dy > 31) return null;
    return `${y}-${m}-${d}`;
  }

  const n = Number(v);
  if (Number.isFinite(n) && n > 0 && n <= EXCEL_SERIAL_MAX) {
    // Excel epoch 1899-12-30 (covers the 1900 leap-year bug for n >= 60).
    const d = new Date(Math.round(n) * 86400000 + Date.UTC(1899, 11, 30));
    return isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
  }
  return null;
}

/** The registrar's tax status as a client type — one reading for every importer.
 *  A partnership, LLP or sole proprietorship is its own type now, not "company". */
function mapCategory(tax: string): InvestorCategory {
  return clientTypeFromTaxStatus(tax);
}

function mapResidency(tax: string): Residency | null {
  const s = tax.toLowerCase();
  if (s.includes("nri")) return "nri";
  if (/resident|individual|minor|huf/.test(s)) return "indian_resident";
  return null;
}

const HOLD_MODE: Record<string, string> = {
  SI: "SINGLE",
  AS: "ANYONE OR SURVIVOR",
  JO: "JOINTLY",
  ES: "EITHER OR SURVIVOR",
};

export function parseCamsFile(rows: string[][]): {
  reportType: string;
  folios: RtaFolioRecord[];
  missingPan: number;
  warnings: string[];
} {
  if (!rows.length) return { reportType: "", folios: [], missingPan: 0, warnings: ["Empty CAMS file"] };
  const header = rows[0].map((h) => h.trim());
  const H: Record<string, number> = {};
  header.forEach((h, i) => (H[h.toLowerCase()] = i));
  const col = (name: string) => (name.toLowerCase() in H ? H[name.toLowerCase()] : -1);
  /** The first of several spellings the file carries (the two CAMS layouts differ). */
  const colAny = (...names: string[]) => {
    for (const n of names) {
      const i = col(n);
      if (i >= 0) return i;
    }
    return -1;
  };

  const C = {
    folio: col("foliochk"),
    name: col("inv_name"),
    addr1: col("address1"),
    addr2: col("address2"),
    addr3: col("address3"),
    city: col("city"),
    pincode: col("pincode"),
    country: col("country"),
    product: colAny("product", "product_code"),
    schName: col("sch_name"),
    closBal: col("clos_bal"),
    rupeeBal: col("rupee_bal"),
    joint1: col("jnt_name1"),
    joint2: col("jnt_name2"),
    phoneRes: col("phone_res"),
    email: col("email"),
    holdNature: col("holding_nature"),
    pan: colAny("pan_no", "pan_pekrn"),
    taxStatus: col("tax_status"),
    broker: colAny("broker_code", "brok_dlr_code"),
    bankName: col("bank_name"),
    acType: col("ac_type"),
    acNo: col("ac_no"),
    ifsc: col("ifsc_code"),
    dob: col("inv_dob"),
    mobile: col("mobile_no"),
    occupation: col("occupation"),
    ckyc: col("fh_ckyc_no"),
    fhKyc: col("fh_kyc"),
    amcCode: col("amc_code"),
    isin: col("isin"),
    repDate: col("rep_date"),
    nom1: col("nom_name"),
    nom1Rel: col("relation"),
    nom1Pct: col("nom_percentage"),
    nom2: col("nom2_name"),
    nom2Rel: col("nom2_relation"),
    nom2Pct: col("nom2_percentage"),
    nom3: col("nom3_name"),
    nom3Rel: col("nom3_relation"),
    nom3Pct: col("nom3_percentage"),
    guardPan: col("guard_pan"),
    guardName: col("guard_name"),
  };

  const groups = new Map<string, RtaFolioRecord>();
  let missingPan = 0;

  for (let r = 1; r < rows.length; r++) {
    const row = rows[r];
    if (!row || row.length < 5) continue;
    const get = (i: number) => (i >= 0 && i < row.length ? (row[i] ?? "").trim() : "");

    const amc = get(C.amcCode) || get(C.product).slice(0, 1) || "?";
    const folio = get(C.folio);
    if (!folio) continue;
    const key = `${amc}::${folio}`;

    let rec = groups.get(key);
    if (!rec) {
      const pan = get(C.pan).toUpperCase() || null;
      if (!pan) missingPan++;

      const nominees: RtaNominee[] = [];
      const addNom = (n: number, rel: number, p: number) => {
        const name = get(n);
        if (name) nominees.push({ name, relation: get(rel) || undefined, sharePct: pct(get(p)) });
      };
      addNom(C.nom1, C.nom1Rel, C.nom1Pct);
      addNom(C.nom2, C.nom2Rel, C.nom2Pct);
      addNom(C.nom3, C.nom3Rel, C.nom3Pct);

      const jointNames = [get(C.joint1), get(C.joint2)].filter(Boolean);
      const line1 = [get(C.addr1), get(C.addr2), get(C.addr3)].filter(Boolean).join(", ");
      const tax = get(C.taxStatus);

      rec = {
        rta: "cams",
        amcCode: amc,
        // R9C has no scheme name to read the fund house from. Leave it blank (the
        // importer then keeps the name the folio already has) rather than "Unknown AMC".
        amcName: get(C.schName) ? amcNameFromDescription(get(C.schName)) : "",
        folioNumber: folio,
        schemes: [],
        investor: {
          pan,
          name: get(C.name),
          nameAsPerPan: get(C.name) || undefined,
          dob: camsDate(get(C.dob)),
          email: get(C.email) || null,
          mobile: get(C.mobile) || null,
          occupation: get(C.occupation) || null,
          category: mapCategory(tax),
          residency: mapResidency(tax),
          isMinor: mapCategory(tax) === "minor",
          guardianPan: get(C.guardPan).toUpperCase() || null,
          guardianName: get(C.guardName) || null,
          // R9C carries the KRA verdict itself ("KYC OK", "KYC Pending", "KYC Failed" …).
          kycVerified: !!get(C.ckyc) || get(C.fhKyc).toUpperCase() === "KYC OK",
          ckycNumber: get(C.ckyc) || null,
          taxStatus: tax || null,
          modeOfHolding: HOLD_MODE[get(C.holdNature).toUpperCase()] ?? (get(C.holdNature) || null),
          jointNames: jointNames.length ? jointNames : undefined,
          address: {
            line1: line1 || undefined,
            city: get(C.city) || undefined,
            pincode: get(C.pincode) || undefined,
            country: get(C.country) || undefined,
          },
        },
        nominees,
        bank: {
          bankName: get(C.bankName) || undefined,
          accountMasked: maskAccount(get(C.acNo)),
          ifsc: get(C.ifsc) || undefined,
          accountType: get(C.acType) || undefined,
        },
        aum: 0,
        lastTransactionAt: null,
        brokerCode: get(C.broker) || undefined,
        reportDate: camsDate(get(C.repDate)),
      };
      groups.set(key, rec);
    }

    const product = get(C.product);
    const units = num(get(C.closBal));
    const value = num(get(C.rupeeBal));
    const rowArn = get(C.broker) || undefined;
    if (product) {
      // A folio can list the same product across multiple rows (lots) — merge
      // them so AUM reconciles to the registrar's total to the paisa.
      //
      // Lots merge only WITHIN one ARN. The same folio+scheme under a second
      // broker code is a different slice of the holding, not another lot of the
      // same one, and collapsing the two would hide which ARN earns on it.
      const existing = rec.schemes.find((s) => s.schemeCode === product && s.arn === rowArn);
      if (existing) {
        existing.units = (existing.units ?? 0) + units || undefined;
        existing.value = (existing.value ?? 0) + value || undefined;
        existing.nav = existing.units && existing.value ? +(existing.value / existing.units).toFixed(4) : existing.nav;
      } else {
        rec.schemes.push({
          schemeCode: product,
          schemeName: get(C.schName),
          isin: get(C.isin).toUpperCase() || undefined,
          units: units || undefined,
          nav: units > 0 && value > 0 ? +(value / units).toFixed(4) : undefined,
          value: value || undefined,
          arn: rowArn,
        });
      }
      rec.aum = (rec.aum ?? 0) + value;
    }
  }

  const folios = [...groups.values()];
  canonicalizeAmcNames(folios);
  return { reportType: "R9", folios, missingPan, warnings: [] };
}
