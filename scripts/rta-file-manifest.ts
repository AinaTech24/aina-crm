/**
 * RTA file manifest — READ ONLY, no database, no PII.
 *
 * For each registrar file on disk (already decrypted / unzipped), prints what an
 * operator records in the pilot ticket before importing it:
 *   report code · SHA-256 · bytes · data rows · Report Date value(s) ·
 *   Transaction Date range · the distributor codes (ARN) it carries, masked.
 * Names, PANs, folios and amounts are never printed.
 *
 *   npx tsx scripts/rta-file-manifest.ts <file> [<file> …] [--json out.json]
 *        [--calendar <from YYYY-MM-DD> <to YYYY-MM-DD>] [--arn <expected ARN>]
 *
 * --calendar lists every weekday in the window and the MFSD201 file(s) whose
 * own Report Date is that day. A weekday with none is printed as MISSING:
 * daily completeness is judged from the registrar's Report Date of each
 * delivered file, NEVER inferred from the span of Transaction Dates (one file
 * can carry many trade dates, and a day with no file has no trade dates at
 * all). Registrar holidays are not known to this script — the operator marks
 * each MISSING weekday as a holiday or a gap with the registrar's confirmation.
 *
 * --arn exits 2 when any file carries a distributor code other than the
 * expected one (compared on digits; printed masked).
 *
 * Exit: 0 clean · 2 a MISSING weekday, an unexpected ARN or an unrecognised file.
 */
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { readLines, tableFrom } from "@/lib/rta/staging/source";
import { identifyLayout } from "@/lib/rta/staging/layouts";

const ARN_COLS = ["Agent Code", "Broker Code", "AgentCode", "Agent", "brok_code", "broker_code"];
const REPORT_DATE_COLS = ["Report Date", "rep_date"];
const TRADE_DATE_COLS = ["Transaction Date", "traddate"];

const digits = (s: string) => s.replace(/\D/g, "");
export const maskArn = (a: string) => {
  const d = digits(a);
  return d ? `ARN-${"*".repeat(Math.max(0, d.length - 2))}${d.slice(-2)}` : "(no digits)";
};
export const maskFileName = (n: string) => n.replace(/\d{5,}/g, (d) => d.slice(0, 2) + "*".repeat(d.length - 2));

/** dd/mm/yyyy, d-m-yyyy, yyyy-mm-dd or an Excel serial → ISO date; anything else → null. */
export function isoDate(v: string): string | null {
  const s = v.trim();
  let m = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})/);
  if (m) return `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  if (/^\d{5}(\.\d+)?$/.test(s)) {
    const d = new Date(Date.UTC(1899, 11, 30) + Math.floor(Number(s)) * 864e5);
    return d.toISOString().slice(0, 10);
  }
  return null;
}

/** Weekdays (Mon–Fri) from `from` to `to`, inclusive, ISO. */
export function weekdays(from: string, to: string): string[] {
  const out: string[] = [];
  for (let t = Date.parse(`${from}T00:00:00Z`); t <= Date.parse(`${to}T00:00:00Z`); t += 864e5) {
    const d = new Date(t);
    if (d.getUTCDay() !== 0 && d.getUTCDay() !== 6) out.push(d.toISOString().slice(0, 10));
  }
  return out;
}

export type FileManifest = {
  file: string; report: string | null; recordKind: string | null; sha256: string; bytes: number; dataRows: number;
  reportDates: string[]; tradeDates: { min: string; max: string; distinct: number } | null; arns: Record<string, number>; arnDigits: string[];
};

export function manifestOf(fileName: string, buf: Buffer): FileManifest {
  const base: FileManifest = { file: maskFileName(path.basename(fileName)), report: null, recordKind: null, sha256: createHash("sha256").update(buf).digest("hex"), bytes: buf.length, dataRows: 0, reportDates: [], tradeDates: null, arns: {}, arnDigits: [] };
  const lines = readLines(new Uint8Array(buf), path.basename(fileName));
  const found = identifyLayout(lines);
  if (!found) return base;
  const t = tableFrom(lines, found.headerIndex);
  const col = (names: string[]) => names.map((n) => t.header.findIndex((h) => h.toLowerCase() === n.toLowerCase())).filter((i) => i >= 0);
  const values = (idx: number[]) => t.rows.flatMap((r) => idx.map((i) => String(r.cells[i] ?? "").trim())).filter(Boolean);
  const reportDates = [...new Set(values(col(REPORT_DATE_COLS)).map(isoDate).filter((d): d is string => !!d))].sort();
  const trades = values(col(TRADE_DATE_COLS)).map(isoDate).filter((d): d is string => !!d).sort();
  const arns: Record<string, number> = {};
  const arnDigits = new Set<string>();
  for (const v of values(col(ARN_COLS))) { arns[maskArn(v)] = (arns[maskArn(v)] ?? 0) + 1; if (digits(v)) arnDigits.add(digits(v)); }
  return { ...base, report: found.layout.reportCode, recordKind: found.layout.recordKind, dataRows: t.rows.length, reportDates,
    tradeDates: trades.length ? { min: trades[0], max: trades[trades.length - 1], distinct: new Set(trades).size } : null, arns, arnDigits: [...arnDigits] };
}

export function calendar(manifests: FileManifest[], from: string, to: string) {
  return weekdays(from, to).map((day) => {
    const files = manifests.filter((m) => m.report === "MFSD201" && m.reportDates.includes(day)).map((m) => m.sha256.slice(0, 12));
    return { day, mfsd201: files, status: files.length ? "present" : "MISSING" };
  });
}

function main() {
  const args = process.argv.slice(2);
  const files: string[] = []; let json: string | null = null; let cal: [string, string] | null = null; let arn: string | null = null;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--json") json = args[++i];
    else if (args[i] === "--calendar") cal = [args[++i], args[++i]];
    else if (args[i] === "--arn") arn = args[++i];
    else files.push(args[i]);
  }
  if (!files.length) { console.error("usage: npx tsx scripts/rta-file-manifest.ts <file> [...] [--json out.json] [--calendar <from> <to>] [--arn <expected ARN>]"); process.exit(1); }
  let bad = 0;
  const manifests = files.map((f) => manifestOf(f, readFileSync(f)));
  for (const m of manifests) {
    if (!m.report) bad++;
    const unexpected = arn ? m.arnDigits.filter((d) => d !== digits(arn!)) : [];
    if (unexpected.length) bad++;
    console.log([
      `${m.report ?? "UNRECOGNISED"}  ${m.file}`,
      `  sha256 ${m.sha256}  bytes ${m.bytes}  data rows ${m.dataRows}`,
      `  report date(s) ${m.reportDates.join(", ") || "(none printed)"}`,
      `  transaction dates ${m.tradeDates ? `${m.tradeDates.min} → ${m.tradeDates.max} (${m.tradeDates.distinct} distinct) — NOT evidence of daily completeness` : "(none)"}`,
      `  ARN ${Object.entries(m.arns).map(([k, n]) => `${k} ×${n}`).join(", ") || "(none printed)"}${unexpected.length ? `  ← ${unexpected.length} code(s) other than the expected ARN` : ""}`,
    ].join("\n"));
  }
  const days = cal ? calendar(manifests, cal[0], cal[1]) : null;
  if (days) {
    console.log(`\nMFSD201 by Report Date, weekdays ${cal![0]} → ${cal![1]}:`);
    for (const d of days) console.log(`  ${d.day}  ${d.status === "present" ? d.mfsd201.join(", ") : "MISSING — registrar holiday or a gap? confirm with KFintech and record"}`);
    bad += days.filter((d) => d.status === "MISSING").length;
  }
  if (json) writeFileSync(json, JSON.stringify({ files: manifests.map(({ arnDigits: _a, ...m }) => m), calendar: days }, null, 2));
  process.exit(bad ? 2 : 0);
}

if (process.argv[1] && /rta-file-manifest\.ts$/.test(process.argv[1])) main();
