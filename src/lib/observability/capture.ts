/**
 * Pluggable error capture. There is no APM/Sentry wired in; this gives one
 * choke-point so operators get a real signal instead of a `console.error` that
 * scrolls past. Always logs; additionally POSTs a compact JSON payload to
 * ERROR_WEBHOOK_URL (Slack/Teams/Sentry-tunnel) when configured. Best-effort and
 * never throws.
 */

export function captureError(context: string, err: unknown, extra?: Record<string, unknown>): void {
  const message = err instanceof Error ? err.message : String(err);
  const stack = err instanceof Error ? err.stack : undefined;
  console.error(`[capture] ${context}: ${message}`, extra ?? "");

  const url = process.env.ERROR_WEBHOOK_URL;
  if (!url) return;
  try {
    void fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        service: "mfd-crm",
        env: process.env.NODE_ENV ?? "unknown",
        context,
        message,
        stack: stack?.split("\n").slice(0, 8).join("\n"),
        extra: extra ?? null,
        at: new Date().toISOString(),
      }),
    }).catch(() => {});
  } catch {
    /* never throw from the error path */
  }
}
