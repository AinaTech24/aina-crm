/**
 * Read-only RTA mailback diagnostic.
 *
 * Answers, for one firm: is the forwarding mailbox actually registered, what
 * mail arrived, what each attachment's verdict was, and what imported today.
 *
 *   DATABASE_URL=... npx tsx scripts/diagnose-rta-mailback.ts vsnchd@gmail.com
 *   DATABASE_URL=... npx tsx scripts/diagnose-rta-mailback.ts vsnchd@gmail.com --days 7
 *
 * Runs SELECTs only — it never writes, and never prints client data.
 */

import "dotenv/config";
import { Pool } from "pg";

const needle = process.argv[2];
const daysArg = process.argv.indexOf("--days");
const days = daysArg > -1 ? Math.max(1, Number(process.argv[daysArg + 1]) || 1) : 3;

if (!needle) {
  console.error("usage: tsx scripts/diagnose-rta-mailback.ts <forwarding-mailbox-or-firm-name> [--days N]");
  process.exit(1);
}

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

function table(rows: any[]) {
  if (!rows.length) return console.log("   (none)\n");
  console.table(rows);
}

async function main() {
  console.log(`\n=== 1. Is the mailbox registered? (matching "${needle}") ===\n`);
  const reg = await pool.query(
    `SELECT t.name AS firm, f.address AS alias, f.source_addresses,
            f.verified_at, f.last_received_at, f.forwarding_confirm_code
       FROM rta_forward_addresses f
       JOIN tenants t ON t.id = f.tenant_id
      WHERE f.is_active
        AND (t.name ILIKE '%'||$1||'%' OR f.source_addresses::text ILIKE '%'||$1||'%')`,
    [needle]
  );
  table(reg.rows);
  if (!reg.rows.length) {
    console.log("   -> NOT REGISTERED. Mail to the shared rta@ address cannot route.\n");
  } else if (reg.rows.length > 1) {
    console.log("   -> AMBIGUOUS: claimed by >1 firm. resolveTenantBySenders refuses to route.\n");
  } else if (!reg.rows[0].last_received_at) {
    console.log("   -> Registered, but NO mail has ever routed to this firm.\n");
  }

  console.log(`=== 2. Inbound mail, last ${days} day(s) ===\n`);
  const inbound = await pool.query(
    `SELECT m.received_at, m.from_address, m.to_address, left(m.subject, 70) AS subject,
            m.outcome, left(m.reason, 90) AS reason, COALESCE(t.name, '(unrouted)') AS firm
       FROM rta_inbound_messages m
       LEFT JOIN tenants t ON t.id = m.tenant_id
      WHERE m.created_at > now() - ($1 || ' days')::interval
      ORDER BY m.received_at DESC NULLS LAST LIMIT 100`,
    [String(days)]
  );
  table(inbound.rows);

  console.log(`=== 3. Per-attachment verdicts, last ${days} day(s) ===\n`);
  const atts = await pool.query(
    `SELECT m.received_at, left(m.subject, 45) AS subject,
            a->>'filename' AS file, a->>'source' AS src, a->>'kind' AS kind,
            a->>'outcome' AS verdict, left(a->>'reason', 70) AS reason
       FROM rta_inbound_messages m
       CROSS JOIN LATERAL jsonb_array_elements(COALESCE(m.attachments, '[]'::jsonb)) a
      WHERE m.created_at > now() - ($1 || ' days')::interval
      ORDER BY m.received_at DESC NULLS LAST LIMIT 200`,
    [String(days)]
  );
  table(atts.rows);

  console.log(`=== 4. Imports created TODAY ===\n`);
  const imports = await pool.query(
    `SELECT t.name AS firm, i.created_at, i.file_name, i.source, i.kind, i.status,
            i.rows_total, i.rows_imported, i.rows_skipped, i.rows_failed,
            left(i.remarks, 80) AS remarks
       FROM rta_file_imports i
       JOIN tenants t ON t.id = i.tenant_id
      WHERE i.created_at::date = current_date AND i.deleted_at IS NULL
      ORDER BY i.created_at DESC LIMIT 100`
  );
  table(imports.rows);

  console.log(`=== 5. Failed / stuck imports, last ${days} day(s) ===\n`);
  const failed = await pool.query(
    `SELECT t.name AS firm, i.created_at, i.file_name, i.status,
            left(COALESCE(i.remarks, i.errors::text), 120) AS why
       FROM rta_file_imports i
       JOIN tenants t ON t.id = i.tenant_id
      WHERE i.created_at > now() - ($1 || ' days')::interval
        AND i.deleted_at IS NULL
        AND i.status NOT IN ('imported', 'completed')
      ORDER BY i.created_at DESC LIMIT 50`,
    [String(days)]
  );
  table(failed.rows);
}

main()
  .catch((e) => { console.error(e.message); process.exitCode = 1; })
  .finally(() => pool.end());
