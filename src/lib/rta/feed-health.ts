/**
 * RTA feed health — tell the firm when its registrar data has stopped updating.
 *
 * Two silent failures were found on 15 Oct 2026:
 *  - Ahpal's OWN daily CAMS and KFintech reports (addressed to its registered
 *    email, naming ARN-320014) arrived every day from 8 Oct and every one was
 *    "rejected": none of the saved passwords opened them, and the import log
 *    filed each as "Not this firm's file". Its ledger stopped on 5 / 7 Oct.
 *  - We Care Freedom Wealth's forwarding address had received nothing since
 *    11 Jul, so a Rs 1,100 Cr book was three months old.
 * Nobody was told either time. Run nightly from the daily-ops scanner; each
 * alert goes to the firm's owners at most once a week.
 */
import { sql } from "drizzle-orm";
import { createNotification } from "@/lib/notifications/create";

type Tx = any;
export type Registrar = "cams" | "kfintech";
export type RegistrarFacts = {
  source: Registrar;
  /** Last import that brought rows in. */
  lastGood: string | null;
  /** Archives no saved password opened, since lastGood. */
  lockedSince: number;
  firstLockedAt: string | null;
};
export type FeedAlert =
  | { kind: "rta.feed_locked"; source: Registrar; title: string; body: string }
  | { kind: "rta.no_mail"; title: string; body: string };

const LABEL: Record<Registrar, string> = { cams: "CAMS", kfintech: "KFintech" };
const day = (iso: string) =>
  new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short", timeZone: "Asia/Kolkata" });
const ageDays = (iso: string, now: Date) => (now.getTime() - new Date(iso).getTime()) / 864e5;

/**
 * What to tell the firm, from what its imports and mailbox show. Pure.
 * - A registrar whose reports keep arriving but cannot be opened, and has
 *   imported nothing for 3 days: the saved password is not the one its
 *   mailbacks use now.
 * - A forwarding address that has received nothing for 7 days.
 */
export function decideFeedAlerts(
  registrars: RegistrarFacts[],
  mailbox: { forwardingOn: boolean; lastMailAt: string | null; address?: string | null },
  now = new Date(),
): FeedAlert[] {
  const out: FeedAlert[] = [];
  for (const r of registrars) {
    if (!r.lastGood || r.lockedSince < 2 || ageDays(r.lastGood, now) < 3) continue;
    const L = LABEL[r.source];
    out.push({
      kind: "rta.feed_locked",
      source: r.source,
      title: `${L} files can't be opened — data not updating`,
      body: `${r.lockedSince} ${L} report${r.lockedSince === 1 ? "" : "s"} since ${day(r.firstLockedAt ?? r.lastGood)} could not be opened with the saved passwords, so ${L} data has not updated since ${day(r.lastGood)}. Save the password your ${L} mailbacks use now under Settings → Integrations → RTA mailback; the waiting files then import on their own.`,
    });
  }
  if (mailbox.forwardingOn && mailbox.lastMailAt && ageDays(mailbox.lastMailAt, now) >= 7) {
    out.push({
      kind: "rta.no_mail",
      title: "No registrar email received for a week",
      body: `Nothing has reached the CRM's mailback address${mailbox.address ? ` (${mailbox.address})` : ""} since ${day(mailbox.lastMailAt)}, so client holdings and transactions are not updating. Check that the firm's CAMS and KFintech mailbacks are still forwarded there.`,
    });
  }
  return out;
}

/** Load one firm's facts, decide, and notify its owners (once a week per alert). */
export async function checkRtaFeedHealth(tx: Tx, tenantId: string, now = new Date()): Promise<number> {
  const regs = (await tx.execute(sql`
    WITH good AS (
      SELECT source, max(created_at) AS last_good FROM rta_file_imports
       WHERE tenant_id = ${tenantId}::uuid AND deleted_at IS NULL AND status IN ('completed', 'partial') AND COALESCE(rows_imported, 0) > 0
         AND source IN ('cams', 'kfintech')
       GROUP BY 1)
    SELECT g.source, g.last_good::text AS last_good,
           (SELECT count(*) FROM rta_file_imports i WHERE i.tenant_id = ${tenantId}::uuid AND i.source = g.source AND i.deleted_at IS NULL
              AND i.status = 'rejected' AND i.created_at > g.last_good)::int AS locked,
           (SELECT min(i.created_at)::text FROM rta_file_imports i WHERE i.tenant_id = ${tenantId}::uuid AND i.source = g.source AND i.deleted_at IS NULL
              AND i.status = 'rejected' AND i.created_at > g.last_good) AS first_locked
      FROM good g`)).rows as Array<{ source: Registrar; last_good: string; locked: number; first_locked: string | null }>;
  const mb = (await tx.execute(sql`
    SELECT bool_or(is_active) AS on, max(last_received_at)::text AS last_mail,
           (array_agg(address ORDER BY is_active DESC, last_received_at DESC NULLS LAST))[1] AS address
      FROM rta_forward_addresses WHERE tenant_id = ${tenantId}::uuid`)).rows[0] as { on: boolean | null; last_mail: string | null; address: string | null } | undefined;
  const alerts = decideFeedAlerts(
    regs.map((r) => ({ source: r.source, lastGood: r.last_good, lockedSince: Number(r.locked), firstLockedAt: r.first_locked })),
    { forwardingOn: !!mb?.on, lastMailAt: mb?.last_mail ?? null, address: mb?.address ?? null },
    now,
  );
  if (!alerts.length) return 0;
  const owners = (await tx.execute(sql`
    SELECT id FROM users WHERE tenant_id = ${tenantId}::uuid AND status = 'active' AND 'owner' = ANY(roles)`)).rows as Array<{ id: string }>;
  if (!owners.length) return 0;
  let sent = 0;
  for (const a of alerts) {
    const key = a.kind === "rta.feed_locked" ? `${a.kind}:${a.source}` : a.kind;
    const recent = (await tx.execute(sql`
      SELECT 1 FROM notifications WHERE tenant_id = ${tenantId}::uuid AND kind = ${a.kind}
         AND COALESCE(meta->>'key', '') = ${key} AND created_at > now() - interval '7 days' LIMIT 1`)).rows.length;
    if (recent) continue;
    for (const o of owners) {
      await createNotification(tx, {
        tenantId, userId: o.id, kind: a.kind, title: a.title, body: a.body,
        linkUrl: "/dashboard/settings/integrations", severity: "warning", meta: { key, source: "rta_feed_health" },
      });
    }
    sent++;
  }
  return sent;
}
