/**
 * The "Download errors (CSV)" body for an RTA import — a plain module so the
 * client button and the tests share it (a "use client" .tsx cannot be imported
 * by a server component's logic or by the node test runner).
 *
 * PANs are masked here even though the page already masks them on read, so the
 * file can never carry a full PAN whatever the caller passes in; a cell that
 * starts like a formula (= + - @, tab, CR) is prefixed with an apostrophe so
 * Excel / Sheets keep it as text.
 */
import { maskPansInText } from "@/lib/rta/values";

function csvEscape(value: string): string {
  const v = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  // Quote-wrap and double up embedded quotes — RFC 4180 style.
  return `"${v.replace(/"/g, '""')}"`;
}

export function errorsToCsv(errors: { row: number; reason: string }[]): string {
  const header = "Row,Reason";
  const lines = errors.map(
    (e) => `${csvEscape(String(e.row))},${csvEscape(maskPansInText(String(e.reason ?? "")))}`
  );
  return [header, ...lines].join("\n");
}
