/**
 * RTA file imports, every firm, the last N days (default 7) — READ ONLY.
 *
 *   docker exec -e ALLOW_SYSTEM_TX=1 app-worker-1 npx tsx scripts/rta-import-status.ts
 *   docker exec -e ALLOW_SYSTEM_TX=1 app-worker-1 npx tsx scripts/rta-import-status.ts --days 14
 *
 * Prints, per firm: files by status per registrar, rows imported, the last
 * COMPLETED daily transaction feed per registrar (and how many days ago), files
 * stuck in the queue, then the distinct problems (refused passwords, failures,
 * skipped rows) with how many files each. Writes nothing. No passwords, PANs or
 * client names are printed — only firm names, file types and the CRM's own
 * messages (which can name a folio number or a CAMS Query Ref).
 */
import "dotenv/config";
import { sql } from "drizzle-orm";
import { withSystem } from "@/db/client";
import { PLATFORM_TENANT_ID } from "@/lib/platform";

const argDays = process.argv.indexOf("--days");
const DAYS = Math.min(90, Math.max(1, Number(argDays > 0 ? process.argv[argDays + 1] : 7) || 7));

type Row = Record<string, unknown>;
const n = (v: unknown) => Number(v ?? 0);
const pad = (s: unknown, w: number) => String(s ?? "").slice(0, w).padEnd(w);
const rpad = (s: unknown, w: number) => String(s ?? "").slice(0, w).padStart(w);

async function main() {
  const { perFirm, lastFeed, problems, silent } = await withSystem(async (tx) => {
    const perFirm = (
      await tx.execute(sql`
        SELECT t.id, COALESCE(NULLIF(t.display_name, ''), t.legal_name) AS firm, r.source,
               COUNT(*)::int AS files,
               COUNT(*) FILTER (WHERE r.status = 'completed')::int AS completed,
               COUNT(*) FILTER (WHERE r.status = 'partial')::int AS partial,
               COUNT(*) FILTER (WHERE r.status = 'failed')::int AS failed,
               COUNT(*) FILTER (WHERE r.status = 'rejected')::int AS rejected,
               COUNT(*) FILTER (WHERE r.status IN ('uploaded', 'parsing') AND r.created_at < now() - interval '1 hour')::int AS stuck,
               COALESCE(SUM(r.rows_imported), 0)::bigint AS rows_imported,
               COALESCE(SUM(r.rows_skipped), 0)::bigint AS rows_skipped
          FROM rta_file_imports r
          JOIN tenants t ON t.id = r.tenant_id
         WHERE r.deleted_at IS NULL AND r.created_at >= now() - make_interval(days => ${DAYS})
         GROUP BY t.id, firm, r.source
         ORDER BY firm, r.source
      `)
    ).rows as Row[];

    // The newest COMPLETED / partial daily transaction feed per firm and registrar, whenever it was.
    const lastFeed = (
      await tx.execute(sql`
        SELECT r.tenant_id, r.source, max(r.created_at) AS last_at
          FROM rta_file_imports r
         WHERE r.deleted_at IS NULL AND r.kind = 'daily_transaction_feed' AND r.status IN ('completed', 'partial')
         GROUP BY r.tenant_id, r.source
      `)
    ).rows as Row[];

    // What went wrong, grouped by firm + status + the first words of the CRM's message.
    const problems = (
      await tx.execute(sql`
        SELECT COALESCE(NULLIF(t.display_name, ''), t.legal_name) AS firm, r.source, r.kind, r.status,
               left(regexp_replace(COALESCE(NULLIF(r.remarks, ''), r.errors->0->>'reason', '(no message)'), '\\s+', ' ', 'g'), 160) AS msg,
               COUNT(*)::int AS files, max(r.created_at) AS last_at
          FROM rta_file_imports r
          JOIN tenants t ON t.id = r.tenant_id
         WHERE r.deleted_at IS NULL AND r.created_at >= now() - make_interval(days => ${DAYS})
           AND (r.status IN ('failed', 'rejected') OR (r.status = 'partial' AND COALESCE(r.rows_skipped, 0) + COALESCE(r.rows_failed, 0) > 0))
         GROUP BY firm, r.source, r.kind, r.status, msg
         ORDER BY firm, files DESC
      `)
    ).rows as Row[];

    // Live firms that imported nothing at all in the window.
    const silent = (
      await tx.execute(sql`
        SELECT COALESCE(NULLIF(t.display_name, ''), t.legal_name) AS firm,
               (SELECT max(r.created_at) FROM rta_file_imports r WHERE r.tenant_id = t.id AND r.deleted_at IS NULL) AS last_ever
          FROM tenants t
         WHERE t.deleted_at IS NULL AND COALESCE(t.status, 'active') IN ('active', 'trial')
           AND t.id <> ${PLATFORM_TENANT_ID}::uuid
           AND NOT EXISTS (
             SELECT 1 FROM rta_file_imports r
              WHERE r.tenant_id = t.id AND r.deleted_at IS NULL AND r.created_at >= now() - make_interval(days => ${DAYS}))
           AND EXISTS (SELECT 1 FROM users u WHERE u.tenant_id = t.id)
         ORDER BY firm
      `)
    ).rows as Row[];

    return { perFirm, lastFeed, problems, silent };
  });

  const ago = (v: unknown) => {
    if (!v) return "never";
    const d = Math.floor((Date.now() - new Date(String(v)).getTime()) / 864e5);
    return d <= 0 ? "today" : `${d}d ago`;
  };
  const feedOf = (tenantId: unknown, source: unknown) =>
    lastFeed.find((f) => f.tenant_id === tenantId && f.source === source)?.last_at;

  console.log(`\nRTA FILE IMPORTS — every firm, last ${DAYS} days (as of ${new Date().toISOString().slice(0, 16)} UTC)\n`);
  console.log(
    `${pad("Firm", 34)} ${pad("RTA", 9)} ${rpad("Files", 5)} ${rpad("Done", 5)} ${rpad("Part", 5)} ${rpad("Fail", 5)} ${rpad("Refused", 7)} ${rpad("Stuck", 5)} ${rpad("Rows in", 9)}  Last daily feed`
  );
  console.log("-".repeat(118));
  for (const r of perFirm) {
    const flag = n(r.failed) + n(r.rejected) + n(r.stuck) > 0 ? "  <-- check" : "";
    console.log(
      `${pad(r.firm, 34)} ${pad(String(r.source).toUpperCase(), 9)} ${rpad(r.files, 5)} ${rpad(r.completed, 5)} ${rpad(r.partial, 5)} ${rpad(r.failed, 5)} ${rpad(r.rejected, 7)} ${rpad(r.stuck, 5)} ${rpad(r.rows_imported, 9)}  ${ago(feedOf(r.id, r.source))}${flag}`
    );
  }

  console.log(`\nFIRMS WITH NO RTA FILE IN THE LAST ${DAYS} DAYS (${silent.length})`);
  for (const s of silent) console.log(`  ${pad(s.firm, 40)} last file ever: ${ago(s.last_ever)}`);

  console.log(`\nPROBLEMS (${problems.length} distinct)`);
  let current = "";
  for (const p of problems) {
    if (p.firm !== current) {
      current = String(p.firm);
      console.log(`\n  ${current}`);
    }
    console.log(`    [${p.status}] ${String(p.source).toUpperCase()} ${p.kind} × ${p.files} (last ${ago(p.last_at)}): ${p.msg}`);
  }
  console.log("");
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
