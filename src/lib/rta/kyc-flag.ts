/**
 * Does a registrar's KYC cell say the holder's KYC is done? (2026-11-24, Attitude Financial / Akshar Invest:
 * clients whose KYC the registrar file carries still showed "Pending".)
 *
 * CAMS prints "KYC OK" in FH_KYC; KFintech prints "Y" in Kyc1Flag; other report codes and older layouts
 * spell it "YES", "Verified", "Validated", "KRA Verified", "Compliant" … The parsers matched ONE spelling
 * in ONE column, so any other file read every client as pending. An unrecognised word still reads as NOT
 * verified — a wrong "verified" is worse than a "pending" — and "KYC NOT OK", "N", "Pending", "Failed",
 * "On hold" never match. Whole-cell match only: "NOT OK" contains "OK".
 */
const OK = new Set([
  "Y", "YES", "TRUE", "1", "OK", "KYC OK", "KYC COMPLIANT", "COMPLIANT", "KYC DONE", "DONE",
  "VERIFIED", "KYC VERIFIED", "KRA VERIFIED", "VALIDATED", "KYC VALIDATED", "KRA VALIDATED",
  "REGISTERED", "KYC REGISTERED", "KRA REGISTERED",
]);

export function registrarKycOk(raw: string | null | undefined): boolean {
  const v = String(raw ?? "").toUpperCase().replace(/[^A-Z0-9]+/g, " ").trim();
  return v !== "" && OK.has(v);
}
