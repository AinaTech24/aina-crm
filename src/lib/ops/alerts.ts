/**
 * Operational alerts that are not lost (final security patch, P1; migration
 * 0244, table ops_alerts).
 *
 * An alert is a ROW, written in the database before anyone is notified:
 *   raise → pending → (delivered | retrying … → undeliverable) → escalated? → acknowledged
 *
 *   - raiseOpsAlert: one OPEN alert per condition (dedup_key). A repeat of the
 *     same condition only counts an occurrence — no second notification.
 *   - deliverDueAlerts: POSTs due alerts to OPS_ALERT_WEBHOOK_URL (else
 *     OBSERVABILITY_WEBHOOK_URL / ERROR_WEBHOOK_URL), each attempt logged in the
 *     append-only ops_alert_deliveries. Failures retry with bounded exponential
 *     backoff (1, 2, 4 … ≤ 60 minutes; RTA_ALERT_MAX_ATTEMPTS, default 8), then
 *     the alert is `undeliverable`. Rows are claimed FOR UPDATE SKIP LOCKED, so
 *     two workers never send the same attempt; every request carries an
 *     Idempotency-Key (alert id + channel) so a receiver can drop a repeat.
 *   - escalation: an undeliverable alert, or a delivered one nobody has
 *     acknowledged within RTA_ALERT_ACK_MINUTES (default 60), is sent once to
 *     OPS_ALERT_ESCALATION_WEBHOOK_URL. Without that channel the escalation is
 *     still recorded, and the independent health probe reports it.
 *   - acknowledgeAlert: a signed-in platform operator closes it, by name.
 *
 * What leaves the system: kind, severity, a summary, counts, ids and times.
 * Never a PAN, a client's name or financial detail, a credential or a token —
 * every summary and detail passes maskSensitive before it is stored or sent.
 */
import { sql } from "drizzle-orm";
import { withSystem } from "@/db/client";

type Tx = any;
export type Fetch = (url: string, init: { method: string; headers: Record<string, string>; body: string; signal?: AbortSignal }) => Promise<{ ok: boolean; status: number }>;

export type AlertInput = {
  kind: string; severity: "critical" | "warning" | "info"; dedupKey: string; firmId?: string | null;
  summary: string; details?: Record<string, unknown>;
};

export const alertPolicy = (env: NodeJS.ProcessEnv = process.env) => ({
  maxAttempts: Math.min(Math.max(Number(env.RTA_ALERT_MAX_ATTEMPTS ?? 8) || 8, 1), 20),
  baseDelayMs: Math.max(Number(env.RTA_ALERT_RETRY_BASE_MS ?? 60_000) || 60_000, 10),
  maxDelayMs: Math.max(Number(env.RTA_ALERT_RETRY_MAX_MS ?? 3_600_000) || 3_600_000, 10),
  ackWindowMinutes: Math.max(Number(env.RTA_ALERT_ACK_MINUTES ?? 60) || 60, 1),
  timeoutMs: Math.max(Number(env.RTA_ALERT_TIMEOUT_MS ?? 10_000) || 10_000, 100),
  primaryUrl: env.OPS_ALERT_WEBHOOK_URL || env.OBSERVABILITY_WEBHOOK_URL || env.ERROR_WEBHOOK_URL || "",
  escalationUrl: env.OPS_ALERT_ESCALATION_WEBHOOK_URL || "",
});

/** Backoff before attempt n+1, after n failed attempts: base·2^(n-1), capped. */
export const backoffMs = (attempts: number, env: NodeJS.ProcessEnv = process.env) => {
  const p = alertPolicy(env);
  return Math.min(p.baseDelayMs * 2 ** Math.max(attempts - 1, 0), p.maxDelayMs);
};

/** PAN-shaped tokens and URL credentials never leave the system. */
export function maskSensitive(text: string): string {
  return text
    .replace(/\b[A-Z]{5}[0-9]{4}[A-Z]\b/g, "<PAN>")
    .replace(/(\w+:\/\/)[^\s:@/]+:[^\s@/]+@/g, "$1<credentials>@");
}
const cleanDetails = (d: Record<string, unknown> | undefined) => JSON.parse(maskSensitive(JSON.stringify(d ?? {})));

/** Write (or count a repeat of) an alert. Returns whether this call created it. */
export async function raiseOpsAlert(tx: Tx, a: AlertInput): Promise<{ id: string; created: boolean; occurrences: number }> {
  const row = (await tx.execute(sql`
    INSERT INTO ops_alerts (kind, severity, dedup_key, firm_id, summary, details)
    VALUES (${a.kind}, ${a.severity}, ${a.dedupKey}, ${a.firmId ?? null}::uuid, ${maskSensitive(a.summary).slice(0, 500)}, ${JSON.stringify(cleanDetails(a.details))}::jsonb)
    ON CONFLICT (dedup_key) WHERE status = 'open'
    DO UPDATE SET last_seen_at = now(), occurrences = ops_alerts.occurrences + 1
    RETURNING id::text, (xmax = 0) AS created, occurrences`)).rows[0] as { id: string; created: boolean; occurrences: number };
  return row;
}

const payloadOf = (r: any, channel: "primary" | "escalation") => JSON.stringify({
  source: "mfd-crm", channel, alertId: r.id, kind: r.kind, severity: r.severity, summary: r.summary, firmId: r.firm_id ?? null,
  occurrences: r.occurrences, firstSeenAt: r.first_seen_at, lastSeenAt: r.last_seen_at, details: r.details,
  attempt: Number(r.delivery_attempts) + 1, escalationReason: r.escalation_reason ?? null,
  acknowledge: "POST /api/super-admin/ops-alerts { action: \"acknowledge\", id, note } (signed-in platform operator)",
});

async function post(fetchImpl: Fetch, url: string, body: string, key: string, timeoutMs: number): Promise<{ ok: boolean; status: number | null; error: string | null }> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const res = await fetchImpl(url, { method: "POST", headers: { "content-type": "application/json", "idempotency-key": key }, body, signal: ctl.signal });
    return { ok: res.ok, status: res.status, error: res.ok ? null : `HTTP ${res.status}` };
  } catch (e) {
    return { ok: false, status: null, error: maskSensitive(String((e as Error)?.message ?? e)).slice(0, 200) };
  } finally {
    clearTimeout(timer);
  }
}

export type DeliveryReport = { delivered: number; retrying: number; undeliverable: number; escalated: number };

/** Deliver every due alert once, then escalate what needs it. Safe to run from several workers at once. */
export async function deliverDueAlerts(opts: { fetchImpl?: Fetch; env?: NodeJS.ProcessEnv } = {}): Promise<DeliveryReport> {
  const env = opts.env ?? process.env;
  const p = alertPolicy(env);
  const fetchImpl = opts.fetchImpl ?? (fetch as unknown as Fetch);
  const out: DeliveryReport = { delivered: 0, retrying: 0, undeliverable: 0, escalated: 0 };

  await withSystem(async (tx: Tx) => {
    const due = (await tx.execute(sql`
      SELECT * FROM ops_alerts WHERE status = 'open' AND delivery_state IN ('pending', 'retrying') AND next_attempt_at <= now()
       ORDER BY next_attempt_at LIMIT 20 FOR UPDATE SKIP LOCKED`)).rows as any[];
    for (const r of due) {
      const attempt = Number(r.delivery_attempts) + 1;
      const res = p.primaryUrl ? await post(fetchImpl, p.primaryUrl, payloadOf(r, "primary"), `${r.id}:primary`, p.timeoutMs)
        : { ok: false, status: null, error: "no alert webhook configured (OPS_ALERT_WEBHOOK_URL)" };
      await tx.execute(sql`
        INSERT INTO ops_alert_deliveries (alert_id, channel, attempt, outcome, http_status, error)
        VALUES (${r.id}::uuid, 'primary', ${attempt}, ${res.ok ? "delivered" : p.primaryUrl ? "failed" : "not_configured"}, ${res.status}, ${res.error})`);
      if (res.ok) {
        await tx.execute(sql`UPDATE ops_alerts SET delivery_state = 'delivered', delivered_at = now(), delivery_attempts = ${attempt}, last_attempt_at = now(), last_error = NULL WHERE id = ${r.id}::uuid`);
        out.delivered++;
      } else if (attempt >= p.maxAttempts) {
        await tx.execute(sql`UPDATE ops_alerts SET delivery_state = 'undeliverable', delivery_attempts = ${attempt}, last_attempt_at = now(), last_error = ${res.error} WHERE id = ${r.id}::uuid`);
        out.undeliverable++;
      } else {
        await tx.execute(sql`
          UPDATE ops_alerts SET delivery_state = 'retrying', delivery_attempts = ${attempt}, last_attempt_at = now(), last_error = ${res.error},
                 next_attempt_at = now() + make_interval(secs => ${backoffMs(attempt, env) / 1000})
           WHERE id = ${r.id}::uuid`);
        out.retrying++;
      }
    }

    // Escalation: undeliverable, or delivered and unacknowledged past the window. Once per alert.
    const toEscalate = (await tx.execute(sql`
      SELECT a.*, (SELECT count(*) FROM ops_alert_deliveries d WHERE d.alert_id = a.id AND d.channel = 'escalation')::int AS esc_attempts
        FROM ops_alerts a
       WHERE a.status = 'open' AND a.escalated_at IS NULL AND a.severity <> 'info'
         AND (a.delivery_state = 'undeliverable'
              OR (a.delivery_state = 'delivered' AND a.delivered_at < now() - make_interval(mins => ${p.ackWindowMinutes}::int)))
       ORDER BY a.first_seen_at LIMIT 20 FOR UPDATE OF a SKIP LOCKED`)).rows as any[];
    for (const r of toEscalate) {
      const reason = r.delivery_state === "undeliverable" ? `primary channel failed ${r.delivery_attempts} time(s)` : `not acknowledged within ${p.ackWindowMinutes} minutes of delivery`;
      r.escalation_reason = reason;
      const attempt = Number(r.esc_attempts) + 1;
      const res = p.escalationUrl ? await post(fetchImpl, p.escalationUrl, payloadOf(r, "escalation"), `${r.id}:escalation`, p.timeoutMs)
        : { ok: false, status: null, error: "no escalation channel configured (OPS_ALERT_ESCALATION_WEBHOOK_URL)" };
      await tx.execute(sql`
        INSERT INTO ops_alert_deliveries (alert_id, channel, attempt, outcome, http_status, error)
        VALUES (${r.id}::uuid, 'escalation', ${attempt}, ${res.ok ? "delivered" : p.escalationUrl ? "failed" : "not_configured"}, ${res.status}, ${res.error})`);
      // Recorded when sent, when no channel exists, or after the bounded attempts — never retried forever.
      if (res.ok || !p.escalationUrl || attempt >= p.maxAttempts) {
        await tx.execute(sql`UPDATE ops_alerts SET escalated_at = now(), escalation_reason = ${res.ok ? reason : `${reason}; escalation ${res.error}`} WHERE id = ${r.id}::uuid`);
        out.escalated++;
      }
    }
  });
  return out;
}

export class AlertError extends Error {
  constructor(message: string, public status = 400) { super(message); }
}

/** A signed-in platform operator acknowledges an alert by name; final. */
export async function acknowledgeAlert(tx: Tx, input: { id: string; by: string; note: string }) {
  const note = (input.note ?? "").trim();
  if (note.length < 5) throw new AlertError("say what was done (at least 5 characters)");
  const r = (await tx.execute(sql`SELECT status FROM ops_alerts WHERE id = ${input.id}::uuid FOR UPDATE`)).rows[0] as { status: string } | undefined;
  if (!r) throw new AlertError("alert not found", 404);
  if (r.status === "acknowledged") throw new AlertError("this alert is already acknowledged", 409);
  return (await tx.execute(sql`
    UPDATE ops_alerts SET status = 'acknowledged', acknowledged_at = now(), acknowledged_by = ${input.by}::uuid, ack_note = ${maskSensitive(note).slice(0, 1000)}
     WHERE id = ${input.id}::uuid RETURNING id::text, kind, status, acknowledged_at, acknowledged_by::text`)).rows[0];
}
