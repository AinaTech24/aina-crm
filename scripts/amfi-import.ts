/**
 * Apply an AMFI NAVAll export from a FILE (Phase 3I) — for a host that cannot
 * reach portal.amfiindia.com. The file must be the unmodified download of
 * https://portal.amfiindia.com/spages/NAVAll.txt (or the "Download" on
 * https://www.amfiindia.com/net-asset-value/nav-download). AMFI publishes no
 * signature, so authenticity rests on where the file came from: its SHA-256,
 * size and your note are recorded in amfi_feed_imports — compare the hash with
 * a second, independent download where you can.
 *
 *   ALLOW_SYSTEM_TX=1 npx tsx scripts/amfi-import.ts --file NAVAll.txt --note "downloaded 08-Oct 21:40 IST by …" [--allow-stale] [--check]
 *
 * --check   validate and report only; nothing is written.
 * Exit 0 applied (or valid with --check), 2 refused.
 */
import { readFileSync, statSync } from "node:fs";
import { createHash } from "node:crypto";

async function main() {
  const args = process.argv.slice(2);
  const val = (f: string) => { const i = args.indexOf(f); return i === -1 ? null : args[i + 1] ?? null; };
  const file = val("--file");
  if (!file) { console.error("usage: tsx scripts/amfi-import.ts --file NAVAll.txt --note \"where it came from\" [--allow-stale] [--check]"); process.exit(1); }
  const buf = readFileSync(file);
  // AMFI serves ASCII / UTF-8 text; anything else is not the export.
  const body = buf.toString("utf8");
  if (body.includes("�")) { console.error("refused: the file is not UTF-8 text — not an unmodified AMFI export"); process.exit(2); }
  const { analyseNavAll, importNavAll } = await import("../src/lib/finance/nav-feed");
  const a = analyseNavAll(body);
  const summary = {
    file, bytes: statSync(file).size, sha256: createHash("sha256").update(body, "utf8").digest("hex"), layout: a.layout, feedDate: a.feedDate,
    schemes: a.rows.length, withNav: a.rows.filter((r) => r.nav != null).length, withoutNav: a.rows.filter((r) => r.nav == null).length,
    explicitPlan: a.rows.filter((r) => r.plan).length, explicitOption: a.rows.filter((r) => r.option).length,
    malformedRows: a.malformed, invalidIsins: a.invalidIsins, duplicateCodes: a.duplicateCodes.length, conflictingDuplicates: a.conflictingDuplicates.length, isinOnManyCodes: a.isinOnManyCodes.length,
    amcs: new Set(a.rows.map((r) => r.amcName)).size, errors: a.errors,
  };
  console.log(JSON.stringify(summary, null, 2));
  if (args.includes("--check")) process.exit(a.errors.length || a.conflictingDuplicates.length ? 2 : 0);
  const r = await importNavAll(body, { source: "file", sourceRef: file, note: val("--note"), allowStale: args.includes("--allow-stale") });
  console.log(JSON.stringify(r, null, 2));
  process.exit(r.status === "applied" ? 0 : 2);
}

main().catch((e) => { console.error(e?.message ?? e); process.exit(1); });
