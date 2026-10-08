/**
 * CAMS mailback parser.
 *
 * CAMS ships its folio statement as a binary `.xls` (read into rows by xls.ts).
 * The report is a COMBINED master + holdings feed — one row per
 * (amc_code × foliochk × product/scheme) carrying units (clos_bal), market value
 * (rupee_bal), full KYC (tax_status, DOB, CKYC), bank, up to 3 nominees, plus
 * occupation and ARN. So it imports as kind="full": master fields AND folio
 * valuations + AUM. Dates arrive as ISO (a date-formatted cell, converted by
 * xls.ts), as bare Excel serials (e.g. 46188 → 2026-06-15) or as text.
 */

import type { RtaFolioRecord, RtaNominee, InvestorCategory, Residency } from "./types";
import { amcNameFromDescription, canonicalizeAmcNames, maskAccount, pct, PanTally } from "./kfintech";
import { excelSerialToIso, readDate, readNumber } from "./values";

/** Columns that uniquely identify the CAMS folio statement. */
const SIGNATURE = ["foliochk", "rupee_bal", "clos_bal", "pan_no", "sch_name"];

export function isCamsFile(header: string[]): boolean {
  const have = new Set(header.map((h) => h.trim().toLowerCase()));
  return SIGNATURE.every((h) => have.has(h));
}

/**
 * A CAMS date cell → ISO yyyy-mm-dd, or null.
 *
 * Accepted, in this order:
 *   - ISO YYYY-MM-DD — what xls.ts now emits for a date-FORMATTED spreadsheet
 *     cell (it converts the serial itself, timezone-proof). This form was
 *     missing, so it would have fallen through to null.
 *   - bare YYYYMMDD, D/M/YYYY and the other day-first text forms `readDate`
 *     knows, each checked against the calendar (31/02/2024 is null, not
 *     "2024-02-31" for Postgres to reject).
 *   - a bare Excel serial (e.g. "46188") — a date column the sheet did NOT
 *     format as a date — converted by pure arithmetic (`excelSerialToIso`),
 *     bounded to a plausible window.
 *
 * The bare-YYYYMMDD branch is not optional. CAMS ships dates of birth as plain
 * 8-digit numbers in some exports; without it they fell through to the Excel
 * branch, where 19850612 days past 1899 lands in the year 56249. That went
 * straight into `investors.dob` (a `date` column), Postgres rejected it, and
 * the WHOLE tenant transaction aborted — a 5,000-folio master lost to one cell.
 * `readDate` reads YYYYMMDD before anything treats the digits as a serial.
 */
const EXCEL_SERIAL_MAX = 60000; // ~year 2064
export function camsDate(s?: string): string | null {
  const v = (s ?? "").trim();
  if (!v) return null;
  const r = readDate(v, "dmy");
  if (r.ok) return r.value;
  if (/^\d+(?:\.\d+)?$/.test(v)) {
    const n = Number(v);
    if (n > 0 && n <= EXCEL_SERIAL_MAX) return excelSerialToIso(n);
  }
  return null;
}

function mapCategory(tax: string): InvestorCategory {
  const s = tax.toLowerCase();
  if (s.includes("minor")) return "minor";
  if (s.includes("huf")) return "huf";
  if (s.includes("nri")) return "nri";
  if (s.includes("trust")) return "trust";
  if (/partnership|proprietor|company|ltd|llp|corporate|body corp/.test(s)) return "company";
  if (s.includes("individual")) return "individual";
  return "individual";
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

  const C = {
    folio: col("foliochk"),
    name: col("inv_name"),
    addr1: col("address1"),
    addr2: col("address2"),
    addr3: col("address3"),
    city: col("city"),
    pincode: col("pincode"),
    country: col("country"),
    product: col("product"),
    schName: col("sch_name"),
    closBal: col("clos_bal"),
    rupeeBal: col("rupee_bal"),
    joint1: col("jnt_name1"),
    joint2: col("jnt_name2"),
    phoneRes: col("phone_res"),
    email: col("email"),
    holdNature: col("holding_nature"),
    pan: col("pan_no"),
    taxStatus: col("tax_status"),
    broker: col("broker_code"),
    bankName: col("bank_name"),
    acType: col("ac_type"),
    acNo: col("ac_no"),
    ifsc: col("ifsc_code"),
    dob: col("inv_dob"),
    mobile: col("mobile_no"),
    occupation: col("occupation"),
    ckyc: col("fh_ckyc_no"),
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
  let badBalances = 0;
  const pans = new PanTally();

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
      const pan = pans.pan(get(C.pan));
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
        amcName: amcNameFromDescription(get(C.schName)),
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
          guardianPan: pans.guardianPan(get(C.guardPan)),
          guardianName: get(C.guardName) || null,
          kycVerified: !!get(C.ckyc),
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
    // Strict read (Phase 2B): a blank balance is UNKNOWN, a stated 0 is ZERO.
    // The old `num(...) || undefined` did both wrong — blank became 0, and a
    // fully redeemed holding the registrar reports as 0 / 0 became "units
    // unknown" (19 of 1,237 legs of a real R9), so the stale units stayed.
    const unitsRead = readNumber(get(C.closBal));
    const valueRead = readNumber(get(C.rupeeBal));
    if (!unitsRead.ok || !valueRead.ok) badBalances++;
    const units = unitsRead.ok ? unitsRead.value : null;
    const value = valueRead.ok ? valueRead.value : null;
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
        existing.units = existing.units === undefined || units === null ? undefined : existing.units + units;
        existing.value = existing.value === undefined || value === null ? undefined : existing.value + value;
        existing.nav = existing.units && existing.value ? +(existing.value / existing.units).toFixed(4) : existing.nav;
      } else {
        rec.schemes.push({
          schemeCode: product,
          schemeName: get(C.schName),
          isin: get(C.isin).toUpperCase() || undefined,
          units: units ?? undefined,
          nav: units !== null && value !== null && units > 0 && value > 0 ? +(value / units).toFixed(4) : undefined,
          value: value ?? undefined,
          arn: rowArn,
        });
      }
      rec.aum = (rec.aum ?? 0) + (value ?? 0);
    }
  }

  const folios = [...groups.values()];
  canonicalizeAmcNames(folios);
  const warnings = pans.warnings();
  if (badBalances) warnings.push(`${badBalances} row(s) carried a closing balance or value that is not a readable number — stored as unknown, not as 0`);
  return { reportType: "R9", folios, missingPan, warnings };
}
