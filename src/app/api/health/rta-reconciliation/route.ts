/**
 * GET /api/health/rta-reconciliation
 *
 * The independent monitor for the RTA posting reconciliation (final security
 * patch, P1). Served by the WEB process from the database alone — it does not
 * depend on the worker or on Redis — so an external uptime monitor polling it
 * notices a stopped worker, a missed or crashed run, an alert that could not
 * be delivered, or a critical alert nobody acknowledged: 200 when all is well,
 * 503 with the reasons otherwise.
 *
 * When the worker's heartbeat is missing (or the day's run has not happened),
 * this request also raises that alert and delivers it from the web process —
 * a dead worker cannot notify anyone itself.
 *
 * Access: `Authorization: Bearer <OPS_MONITOR_TOKEN>` (or ?token=) when that
 * env is set, else HEALTH_TOKEN, else a platform-admin session. The body
 * holds aggregates only: no firm, client, PAN or figure.
 */
import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";
import { captureError } from "@/lib/observability/capture";
import { reconHealth, raiseHealthAlerts } from "@/lib/rta/posting/recon-schedule";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const expected = process.env.OPS_MONITOR_TOKEN || process.env.HEALTH_TOKEN || "";
  if (expected) {
    const bearer = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
    const token = bearer || req.nextUrl.searchParams.get("token") || "";
    if (token !== expected) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  } else {
    const session = await getSession();
    if (!session || !session.roles?.includes("platform_admin")) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  try {
    const health = await reconHealth();
    if (!health.ok) await raiseHealthAlerts(health).catch((e) => captureError("[rta-recon-health] could not raise the alert", e));
    return NextResponse.json(health, { status: health.ok ? 200 : 503, headers: { "cache-control": "no-store" } });
  } catch (e) {
    captureError("[rta-recon-health] probe failed", e);
    return NextResponse.json({ ok: false, problems: ["the reconciliation health could not be read from the database"] }, { status: 503 });
  }
}
