/**
 * Message tests — innovation and quantification (The E-Myth Revisited): try a
 * second way of saying something, measure which one clients answer, keep the
 * better one.
 *
 * Read from the communications log only (no schema of its own). A send counts
 * against the template it was rendered from: template_version_id → its
 * template, else template_key + channel. Templates are compared only with
 * templates for the SAME purpose on the SAME channel: the purpose is the
 * template key with a variant suffix taken off (birthday_wish, birthday_wish_v2
 * and birthday_wish_b are one purpose).
 *
 * Rates are over messages that left the CRM (sent, delivered, read, replied,
 * failed, bounced, unsubscribed). Skipped sends (consent, compliance, quota …)
 * never left; they are reported as their own share of every attempt.
 *
 * "No data is not zero": a rate a channel does not report (SMS read receipts,
 * any reply on SMS) — or that nothing on the channel reported in the period
 * (no read receipt came back at all) — is "Not reported", never 0%.
 *
 * SERVER-ONLY for the loader; the helpers at the top are pure.
 */

import { sql } from "drizzle-orm";
import type { Tx } from "@/db/client";

export type Channel = "whatsapp" | "email" | "sms";
export const TEST_CHANNELS: Channel[] = ["whatsapp", "email", "sms"];

/** What each channel's provider can tell us at all. */
export const CHANNEL_REPORTS: Record<Channel, { delivered: boolean; read: boolean; replied: boolean }> = {
  whatsapp: { delivered: true, read: true, replied: true },
  // Opens come from a tracking pixel; replies only when the mailbox is synced.
  email: { delivered: true, read: true, replied: true },
  sms: { delivered: true, read: false, replied: false },
};

export type RateKey = "delivered" | "read" | "replied";

/** At least this many sends on each side before two templates are compared. */
export const MIN_SENDS = 30;

/* ──────────────────────────── pure helpers ──────────────────────────── */

/**
 * The purpose a template key serves, with its variant suffix removed:
 * "sip_reminder_v2" → "sip_reminder", "birthday-b" → "birthday",
 * "welcome_alt" → "welcome". A bare number is NOT a variant: drip steps
 * ("day_1", "day_7") are different messages.
 */
export function purposeKey(key: string): string {
  const k = key.trim().toLowerCase();
  const stripped = k.replace(/(?:[_\-. ](?:v\d+|[ab]|alt\d*|variant\d*|test\d*|copy\d*))+$/i, "");
  return stripped || k;
}

/** A human label for a purpose key: "birthday_wish" → "Birthday wish". */
export function purposeLabel(purpose: string): string {
  const s = purpose.replace(/[_\-.]+/g, " ").trim();
  return s ? s[0].toUpperCase() + s.slice(1) : purpose;
}

/** Share as a percentage with one decimal; null when there is nothing to divide by. */
export function rate(x: number, n: number): number | null {
  if (!n || n <= 0) return null;
  return Math.round((x / n) * 1000) / 10;
}

/**
 * The two-proportion z statistic for x1/n1 against x2/n2 (pooled). Positive
 * when the first is the higher rate. 0 when either side is empty or the pooled
 * rate is 0 or 1 (no variance — nothing to tell apart).
 */
export function twoProportionZ(x1: number, n1: number, x2: number, n2: number): number {
  if (n1 <= 0 || n2 <= 0) return 0;
  const p1 = x1 / n1;
  const p2 = x2 / n2;
  const p = (x1 + x2) / (n1 + n2);
  const se = Math.sqrt(p * (1 - p) * (1 / n1 + 1 / n2));
  if (!se) return 0;
  return (p1 - p2) / se;
}

export type ComparableRow = { id: string; sent: number; hits: number };

export type Comparison =
  | { kind: "single" }
  | { kind: "too_few"; eligible: number }
  | { kind: "no_metric" }
  | { kind: "better"; winnerId: string; runnerUpId: string; z: number }
  | { kind: "no_difference"; leaderId: string; runnerUpId: string; z: number };

/**
 * Within one purpose: the two best templates with at least MIN_SENDS sends
 * each, by `hits ÷ sent`. "better" when the difference is significant at 95%
 * (|z| ≥ 1.96), else "no_difference". `hits` null = the metric is not
 * reported, so nothing can be compared.
 */
export function compareGroup(rows: Array<{ id: string; sent: number; hits: number | null }>, minSends = MIN_SENDS): Comparison {
  if (rows.length < 2) return { kind: "single" };
  if (rows.some((r) => r.hits == null)) return { kind: "no_metric" };
  const eligible = rows.filter((r) => r.sent >= minSends) as ComparableRow[];
  if (eligible.length < 2) return { kind: "too_few", eligible: eligible.length };
  const ranked = [...eligible].sort((a, b) => b.hits / b.sent - a.hits / a.sent || b.sent - a.sent);
  const [a, b] = ranked;
  const z = twoProportionZ(a.hits, a.sent, b.hits, b.sent);
  return Math.abs(z) >= 1.96
    ? { kind: "better", winnerId: a.id, runnerUpId: b.id, z }
    : { kind: "no_difference", leaderId: a.id, runnerUpId: b.id, z };
}

/** The rate a purpose is judged on: replies where reported, else reads, else delivery. */
export function outcomeMetric(reported: Record<RateKey, boolean>): RateKey | null {
  if (reported.replied) return "replied";
  if (reported.read) return "read";
  if (reported.delivered) return "delivered";
  return null;
}

/* ──────────────────────────── loader ──────────────────────────── */

export type TemplateStats = {
  /** templates.id, or "key:<template_key>" for sends whose template row is gone. */
  id: string;
  templateId: string | null;
  key: string;
  name: string;
  category: string | null;
  channel: Channel;
  attempted: number;
  sent: number;
  delivered: number;
  read: number;
  replied: number;
  failed: number;
  skipped: number;
  /** Rates (%) over sent; null = not reported (see `reported`). */
  deliveredPct: number | null;
  readPct: number | null;
  repliedPct: number | null;
  /** Over attempted. */
  failedPct: number | null;
  skippedPct: number | null;
};

export type PurposeGroup = {
  channel: Channel;
  purpose: string;
  label: string;
  /** The channel's reporting in the period. */
  reported: Record<RateKey, boolean>;
  metric: RateKey | null;
  templates: TemplateStats[];
  comparison: Comparison;
};

export type TemplatePerformance = {
  days: number;
  groups: PurposeGroup[];
  /** Outbound sends in the period with no template (statements, one-off messages). */
  untemplated: number;
};

export type PerformanceRow = {
  template_id: string | null;
  key: string;
  name: string | null;
  category: string | null;
  channel: Channel;
  attempted: number;
  sent: number;
  delivered: number;
  read: number;
  replied: number;
  failed: number;
  skipped: number;
};

const LEFT = sql`('sent', 'delivered', 'read', 'replied', 'failed', 'bounced', 'unsubscribed')`;

/** Per template, over the last `days`: sent, delivered / read / replied %, failed / skipped %. */
export async function templatePerformance(
  tx: Tx, tenantId: string, opts: { days?: number; channel?: Channel | null } = {},
): Promise<TemplatePerformance> {
  const days = Math.min(365, Math.max(7, Math.round(opts.days ?? 90)));
  const channels = opts.channel ? [opts.channel] : TEST_CHANNELS;
  const chanList = sql.join(channels.map((c) => sql`${c}`), sql`, `);
  const res = await tx.execute(sql`
    WITH m AS (
      SELECT c.channel, c.status, c.delivered_at, c.read_at, c.replied_at,
             COALESCE(t.id, tk.id) AS template_id,
             COALESCE(t.key, tk.key, c.template_key) AS key,
             COALESCE(t.name, tk.name) AS name,
             COALESCE(t.category, tk.category) AS category
        FROM communications c
        LEFT JOIN template_versions tv ON tv.id = c.template_version_id AND tv.tenant_id = ${tenantId}::uuid
        LEFT JOIN templates t ON t.id = tv.template_id AND t.tenant_id = ${tenantId}::uuid
        LEFT JOIN LATERAL (
          SELECT t2.id, t2.key, t2.name, t2.category FROM templates t2
           WHERE c.template_version_id IS NULL AND c.template_key IS NOT NULL
             AND t2.tenant_id = ${tenantId}::uuid AND t2.key = c.template_key AND t2.channel = c.channel
           ORDER BY t2.updated_at DESC LIMIT 1
        ) tk ON TRUE
       WHERE c.tenant_id = ${tenantId}::uuid AND c.direction = 'outbound'
         AND c.channel IN (${chanList})
         AND c.created_at >= now() - make_interval(days => ${days}::int)
         AND c.status NOT IN ('scheduled', 'cancelled')
    )
    SELECT template_id, key, MAX(name) AS name, MAX(category) AS category, channel,
           COUNT(*)::int AS attempted,
           COUNT(*) FILTER (WHERE status IN ${LEFT})::int AS sent,
           COUNT(*) FILTER (WHERE status IN ${LEFT} AND (delivered_at IS NOT NULL OR read_at IS NOT NULL OR replied_at IS NOT NULL
                                  OR status IN ('delivered', 'read', 'replied')))::int AS delivered,
           COUNT(*) FILTER (WHERE status IN ${LEFT} AND (read_at IS NOT NULL OR replied_at IS NOT NULL OR status IN ('read', 'replied')))::int AS read,
           COUNT(*) FILTER (WHERE status IN ${LEFT} AND (replied_at IS NOT NULL OR status = 'replied'))::int AS replied,
           COUNT(*) FILTER (WHERE status IN ('failed', 'bounced'))::int AS failed,
           COUNT(*) FILTER (WHERE status LIKE 'skipped%')::int AS skipped
      FROM m
     WHERE key IS NOT NULL
     GROUP BY template_id, key, channel
  `);
  const untemplated = (await tx.execute(sql`
    SELECT COUNT(*)::int AS n FROM communications c
     WHERE c.tenant_id = ${tenantId}::uuid AND c.direction = 'outbound' AND c.channel IN (${chanList})
       AND c.created_at >= now() - make_interval(days => ${days}::int)
       AND c.status NOT IN ('scheduled', 'cancelled')
       AND c.template_version_id IS NULL AND c.template_key IS NULL
  `)).rows[0] as { n: number } | undefined;

  return { days, groups: groupPerformance(res.rows as PerformanceRow[]), untemplated: Number(untemplated?.n ?? 0) };
}

/**
 * Pure: rows per template → groups per (channel, purpose) with rates and the
 * comparison. A rate is reported only when the channel can report it AND
 * something on that channel reported it in the period.
 */
export function groupPerformance(rows: PerformanceRow[]): PurposeGroup[] {
  const seen: Record<Channel, Record<RateKey, boolean>> = {
    whatsapp: { delivered: false, read: false, replied: false },
    email: { delivered: false, read: false, replied: false },
    sms: { delivered: false, read: false, replied: false },
  };
  for (const r of rows) {
    const s = seen[r.channel];
    if (!s) continue;
    if (Number(r.delivered) > 0) s.delivered = true;
    if (Number(r.read) > 0) s.read = true;
    if (Number(r.replied) > 0) s.replied = true;
  }
  const reportedFor = (c: Channel): Record<RateKey, boolean> => ({
    delivered: CHANNEL_REPORTS[c].delivered && seen[c].delivered,
    read: CHANNEL_REPORTS[c].read && seen[c].read,
    replied: CHANNEL_REPORTS[c].replied && seen[c].replied,
  });

  const groups = new Map<string, PurposeGroup>();
  for (const r of rows) {
    if (!CHANNEL_REPORTS[r.channel]) continue;
    const rep = reportedFor(r.channel);
    const sent = Number(r.sent);
    const attempted = Number(r.attempted);
    const stat: TemplateStats = {
      id: r.template_id ?? `key:${r.channel}:${r.key}`,
      templateId: r.template_id,
      key: r.key,
      name: r.name ?? r.key,
      category: r.category,
      channel: r.channel,
      attempted,
      sent,
      delivered: Number(r.delivered),
      read: Number(r.read),
      replied: Number(r.replied),
      failed: Number(r.failed),
      skipped: Number(r.skipped),
      deliveredPct: rep.delivered ? rate(Number(r.delivered), sent) : null,
      readPct: rep.read ? rate(Number(r.read), sent) : null,
      repliedPct: rep.replied ? rate(Number(r.replied), sent) : null,
      failedPct: rate(Number(r.failed), attempted),
      skippedPct: rate(Number(r.skipped), attempted),
    };
    const purpose = purposeKey(r.key);
    const gk = `${r.channel}:${purpose}`;
    let g = groups.get(gk);
    if (!g) {
      g = {
        channel: r.channel, purpose, label: purposeLabel(purpose),
        reported: rep, metric: outcomeMetric(rep), templates: [], comparison: { kind: "single" },
      };
      groups.set(gk, g);
    }
    g.templates.push(stat);
  }
  for (const g of groups.values()) {
    g.templates.sort((a, b) => b.sent - a.sent || a.name.localeCompare(b.name));
    const m = g.metric;
    g.comparison = m
      ? compareGroup(g.templates.map((t) => ({ id: t.id, sent: t.sent, hits: t[m] })))
      : g.templates.length < 2 ? { kind: "single" } : { kind: "no_metric" };
  }
  // Groups with something to compare first, then by volume.
  return [...groups.values()].sort((a, b) =>
    Number(b.templates.length > 1) - Number(a.templates.length > 1)
    || b.templates.reduce((s, t) => s + t.sent, 0) - a.templates.reduce((s, t) => s + t.sent, 0)
    || a.label.localeCompare(b.label));
}
