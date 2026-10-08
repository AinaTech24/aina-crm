/**
 * Operator CLI for RTA posting controls and recovery (Phase 3G).
 * Procedures: docs/rta/PHASE3G_PRODUCTION_READINESS.md, "Recovery".
 *
 *   ALLOW_SYSTEM_TX=1 tsx scripts/rta-posting-recovery.ts <command> [flags]
 *
 *   status     --tenant <id>                         activation, halt state, recent batches
 *   halt       --scope global|<tenant id> --by <user id> --reason "…"
 *   release    --scope global|<tenant id> --by <user id> --approver <user id> --reason "…"
 *   reverse    --tenant <id> --batch <id> --by <user id> --approver <user id> --reason "…" [--commit]
 *              (dry run unless --commit; posting must be halted for the firm)
 *   undo       --tenant <id> --reversal <id> --by <user id> --reason "…"
 *   reconcile  --tenant <id>                         every count must be 0; exit 3 otherwise
 *
 * Prints counts and ids only — never a PAN, name or contact detail. Every
 * write is the library's: two people where the library demands it, an
 * append-only control or reversal record, and an audit_log row.
 */

async function main() {
  const [cmd, ...rest] = process.argv.slice(2);
  const flags: Record<string, string | true> = {};
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i];
    if (!a.startsWith("--")) continue;
    const next = rest[i + 1];
    if (next === undefined || next.startsWith("--")) flags[a.slice(2)] = true;
    else { flags[a.slice(2)] = next; i++; }
  }
  const need = (k: string) => {
    const v = flags[k];
    if (typeof v !== "string" || !v) { console.error(`--${k} is required for ${cmd}`); process.exit(1); }
    return v;
  };

  const C = await import("@/lib/rta/posting/controls");
  const R = await import("@/lib/rta/posting/reversal");

  switch (cmd) {
    case "status": {
      const tenantId = need("tenant");
      const s = await C.controlState(tenantId);
      const { withTenant } = await import("@/db/client");
      const { sql } = await import("drizzle-orm");
      const batches = await withTenant(tenantId, async (tx: any) => (await tx.execute(sql`
        SELECT b.id::text, b.state, b.posting_state, b.posted_at, f.kind AS file_kind, f.status AS import_status
          FROM rta_staging_batches b LEFT JOIN rta_file_imports f ON f.id = b.import_id
         WHERE b.tenant_id = ${tenantId}::uuid ORDER BY b.created_at DESC LIMIT 15`)).rows);
      console.log(JSON.stringify({ activation: s.activation, halt: s.halt, activations: s.history.length, recentBatches: batches }, null, 2));
      return;
    }
    case "halt":
    case "release": {
      await C.setPostingHalt({
        scope: need("scope"), halted: cmd === "halt", reason: need("reason"),
        changedBy: need("by"), approvedBy: cmd === "release" ? need("approver") : (typeof flags.approver === "string" ? flags.approver : null),
      });
      console.log(`${cmd === "halt" ? "halted" : "released"}: ${flags.scope}`);
      return;
    }
    case "reverse": {
      const res = await R.reversePostingBatch(need("tenant"), need("batch"), {
        requestedBy: need("by"), approvedBy: need("approver"), reason: need("reason"), dryRun: flags.commit !== true,
      });
      console.log(JSON.stringify(res, null, 2));
      if (res.dryRun) console.log("DRY RUN — nothing changed. Re-run with --commit to reverse.");
      return;
    }
    case "undo": {
      const counts = await R.undoReversal(need("tenant"), need("reversal"), { by: need("by"), reason: need("reason") });
      console.log(JSON.stringify({ restored: counts }, null, 2));
      return;
    }
    case "reconcile": {
      const r = await R.reconcilePosting(need("tenant"));
      console.log(JSON.stringify(r, null, 2));
      if (Object.values(r).some((n) => n !== 0)) { console.error("RECONCILIATION FAILED — see the non-zero counts"); process.exit(3); }
      console.log("reconciled: every check is 0");
      return;
    }
    default:
      console.error("usage: tsx scripts/rta-posting-recovery.ts status|halt|release|reverse|undo|reconcile [flags] — see the file header");
      process.exit(1);
  }
}

main().then(() => process.exit(0), (e) => { console.error(e?.cause?.message ?? e?.message ?? e); process.exit(1); });
