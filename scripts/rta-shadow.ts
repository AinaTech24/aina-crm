/**
 * Stage RTA files in SHADOW mode from the command line and print each batch's
 * reconciliation report (aggregates only — no PAN, name or contact detail).
 *
 *   RTA_PIPELINE_MODE=shadow ALLOW_SYSTEM_TX=1 \
 *     tsx scripts/rta-shadow.ts --tenant <tenant uuid> [--rerun-of <batch uuid>] <file> [<file> …]
 *
 * Writes ONLY to rta_staging_* (never to a financial table). Even so it refuses
 * to run unless RTA_PIPELINE_MODE=shadow, and against a database that is not on
 * localhost unless --not-local is passed: Phase 3B is development-only.
 *
 * Exit code: 0 when every batch reached ready_to_commit, 2 when any ended in
 * exception, 1 on an error.
 */
import { readFileSync } from "node:fs";
import { basename } from "node:path";

async function main() {
  const args = process.argv.slice(2);
  const take = (flag: string) => {
    const i = args.indexOf(flag);
    if (i === -1) return null;
    const v = args[i + 1];
    args.splice(i, 2);
    return v;
  };
  const tenantId = take("--tenant");
  const rerunOf = take("--rerun-of");
  const notLocal = args.includes("--not-local");
  const files = args.filter((a) => a !== "--not-local");

  if (!tenantId || !files.length) {
    console.error("usage: tsx scripts/rta-shadow.ts --tenant <tenant uuid> [--rerun-of <batch uuid>] <file> [<file> …]");
    process.exit(1);
  }
  const { rtaPipelineMode } = await import("@/lib/rta/staging/config");
  const mode = rtaPipelineMode(tenantId);
  if (mode.mode !== "shadow") {
    console.error(`refusing: RTA_PIPELINE_MODE must be "shadow" for this tenant${mode.refused ? ` (${mode.refused})` : ""}`);
    process.exit(1);
  }
  const host = (() => { try { return new URL(process.env.DATABASE_URL ?? "").hostname; } catch { return ""; } })();
  if (!["localhost", "127.0.0.1", "::1"].includes(host) && !notLocal) {
    console.error(`refusing: DATABASE_URL points at "${host || "?"}", not localhost — pass --not-local only for an isolated development database`);
    process.exit(1);
  }

  const { createShadowBatch, runShadowBatch } = await import("@/lib/rta/staging/pipeline");
  const { loadBatchReport } = await import("@/lib/rta/staging");
  let worst = 0;
  for (const file of files) {
    const buf = readFileSync(file);
    const batchId = await createShadowBatch({ tenantId, fileName: basename(file), fileRef: `cli:${basename(file)}`, buf, rerunOfBatchId: rerunOf });
    const r = await runShadowBatch(tenantId, batchId, buf, { workerId: `cli:${process.pid}` });
    const report = await loadBatchReport(tenantId, batchId);
    console.log(`\n${basename(file)} → batch ${batchId}: ${r.state}`);
    console.log("  counts:", JSON.stringify(report?.batch.counts));
    for (const c of report?.checks.filter((x) => x.scope === "batch") ?? []) {
      console.log(`  ${c.status.toUpperCase().padEnd(10)} ${c.code}${c.actual ? `: ${c.actual}` : ""}`);
    }
    const econFails = report?.checks.filter((x) => x.scope === "econ" && x.status !== "pass").length ?? 0;
    if (econFails) console.log(`  ${econFails} transaction-level check(s) not passing — see the batch report`);
    for (const e of report?.exceptions ?? []) console.log(`  held: ${e.code} (${e.state}) × ${e.rows}`);
    if (r.state !== "ready_to_commit") worst = 2;
  }
  process.exit(worst);
}

main().catch((e) => {
  console.error("rta-shadow failed:", String(e?.message ?? e).replace(/[A-Z]{5}[0-9]{4}[A-Z]/g, "<pan>"));
  process.exit(1);
});
