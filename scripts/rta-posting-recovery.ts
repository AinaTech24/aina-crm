/**
 * Operator CLI for RTA posting controls and recovery (Phase 3G).
 * Procedures: docs/rta/PHASE3G_PRODUCTION_READINESS.md, "Recovery".
 *
 *   ALLOW_SYSTEM_TX=1 tsx scripts/rta-posting-recovery.ts <command> [flags]
 *
 *   status     --tenant <id>                         activation, halt state, recent batches
 *   requests   [--status pending]                    two-person control requests (read-only)
 *   halt       --scope global|emergency|<tenant id> --by <user id> --reason "…"
 *              a STOP — one operator. Recorded with actor_source 'cli': a name on
 *              a command line is NOT a verified identity (prefer the API halt).
 *   reverse    --tenant <id> --batch <id> --reason "…"   DRY RUN only (read-only)
 *   reconcile  --tenant <id>                         every count must be 0; exit 3 otherwise
 *
 * DISABLED (final pilot patch, migration 0243): release, reverse --commit and
 * undo. A command line cannot prove who is running it, so every START is a
 * two-person control request made and approved by two SIGNED-IN operators
 * through POST /api/super-admin/rta-pipeline; the database refuses a start
 * that does not cite one approved in the same transaction.
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
    case "halt": {
      await C.setPostingHalt({ scope: need("scope"), halted: true, reason: `[CLI — operator identity not server-verified] ${need("reason")}`, changedBy: need("by"), actorSource: "cli" });
      console.log(`halted: ${flags.scope}`);
      return;
    }
    case "release":
    case "undo":
      console.error(`${cmd} is disabled on the command line: it is a START and needs two separately signed-in operators. `
        + "File a request (POST /api/super-admin/rta-pipeline { action: \"request\", control: { … } }) and have a DIFFERENT operator approve it ({ action: \"approve\", requestId, payloadHash }).");
      process.exit(2);
      return;
    case "reverse": {
      if (flags.commit === true) {
        console.error("reverse --commit is disabled on the command line. Run this dry run, then file a 'reverse' control request through the API; a DIFFERENT signed-in operator approves it.");
        process.exit(2);
      }
      const res = await R.reversePostingBatch(need("tenant"), need("batch"), { reason: need("reason"), dryRun: true });
      console.log(JSON.stringify(res, null, 2));
      console.log("DRY RUN — nothing changed. To reverse, file a 'reverse' control request (two signed-in operators).");
      return;
    }
    case "requests": {
      const { withSystem } = await import("@/db/client");
      const { sql } = await import("drizzle-orm");
      const status = typeof flags.status === "string" ? flags.status : null;
      const rows = await withSystem(async (tx: any) => (await tx.execute(sql`
        SELECT id::text, action, scope, status, change_ref, requested_by::text, requested_at, expires_at, approved_by::text, decided_by::text, decided_at, payload_hash
          FROM rta_control_requests WHERE (${status}::text IS NULL OR status = ${status}) ORDER BY requested_at DESC LIMIT 50`)).rows);
      console.log(JSON.stringify(rows, null, 2));
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
      console.error("usage: tsx scripts/rta-posting-recovery.ts status|requests|halt|reverse (dry run)|reconcile [flags] — see the file header");
      process.exit(1);
  }
}

main().then(() => process.exit(0), (e) => { console.error(e?.cause?.message ?? e?.message ?? e); process.exit(1); });
