/**
 * Statutory upload files from a pay run (docs/PAYROLL_MODULE_DESIGN.md §4).
 * The CRM prepares them; the firm uploads them on the EPFO and ESIC portals.
 * Pure, so they are tested on their own.
 *
 * - PF ECR, version 2: one line per member, fields joined by "#~#", no header —
 *   UAN · name · gross wages · EPF wages · EPS wages · EDLI wages · EPF (employee
 *   share) · EPS · EPF−EPS difference (employer) · NCP days · refund of advances.
 *   Amounts are whole rupees. Due by the 15th of the next month.
 * - ESIC monthly contribution: IP number · name · days paid · wages · reason
 *   code for zero days · last working day. Reason 2 = left service, with the
 *   date (dd/mm/yyyy). Due by the 15th of the next month.
 *
 * Runs calculated before phase 2 have no `statutory` block; their wages are
 * worked back from the lines (12% PF → wages), which is exact for them.
 */

import type { PayResult } from "./calc";

type R = Partial<PayResult> & Pick<PayResult, "deductions" | "employer" | "gross">;

const sum = (lines: Array<{ code: string; amount: number }> | undefined, codes: string[]) =>
  (lines ?? []).filter((l) => codes.includes(l.code)).reduce((t, l) => t + l.amount, 0);

/** PF / ESI wages and NCP days, from the frozen result. */
export function statutoryOf(r: R): PayResult["statutory"] {
  if (r.statutory) return r.statutory;
  const pf = sum(r.deductions, ["pf"]);
  const pfWages = pf ? Math.round(pf / 0.12) : 0;
  const ceil = Math.min(pfWages, 15000);
  return {
    pfWages,
    epsWages: pf ? ceil : 0,
    edliWages: pf ? ceil : 0,
    esiWages: sum(r.deductions, ["esi"]) ? r.gross : 0,
    ncpDays: Math.round((r.lopDays ?? 0) + (r.notEmployedDays ?? 0)),
  };
}

/** Wages for the ECR "gross" column: pay less repaid expenses. */
const wageGross = (r: R) => Math.round(r.gross - sum(r.earnings, ["claim"]));

/** One ECR line, or null when the person had no PF this month. */
export function ecrLine(uan: string, name: string, r: R): string | null {
  const ee = sum(r.deductions, ["pf"]);
  if (!ee) return null;
  const st = statutoryOf(r);
  const eps = sum(r.employer, ["eps"]);
  const diff = sum(r.employer, ["epf"]);
  const clean = name.replace(/#~#|[\r\n]/g, " ").trim().toUpperCase();
  return [uan.trim(), clean, wageGross(r), Math.round(st.pfWages), Math.round(st.epsWages), Math.round(st.edliWages), ee, eps, diff, st.ncpDays, 0].join("#~#");
}

const dmy = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}`;

/** One ESIC row, or null when the person had no ESI this month. */
export function esicRow(ipNumber: string, name: string, r: R, exitDate: string | null): Array<string | number> | null {
  if (!sum(r.deductions, ["esi"])) return null;
  const days = Math.max(0, Math.round((r.daysInMonth ?? 30) - (r.lopDays ?? 0) - (r.notEmployedDays ?? 0)));
  const period = r.period ?? "";
  const leftThisMonth = !!exitDate && !!period && exitDate.slice(0, 7) === period.slice(0, 7);
  return [ipNumber, name, days, Math.round(statutoryOf(r).esiWages || wageGross(r)), days === 0 ? 1 : leftThisMonth ? 2 : 0, leftThisMonth ? dmy(exitDate!) : ""];
}
