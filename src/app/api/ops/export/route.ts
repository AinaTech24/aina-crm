/**
 * GET /api/ops/export?kind=… — the Control Tower's operational tables as CSV
 * (§50): pending requests, SLA breaches, rejected transactions, SIP
 * rejections, documentation pending and query ageing.
 *
 * Same access and the same filters as the page (lib/dashboard/ops/access.ts,
 * params.ts), so an export never carries a row the viewer could not see on
 * screen. Cells that a spreadsheet would read as a formula are neutralised.
 */

import { NextRequest, NextResponse } from "next/server";
import { withTenant } from "@/db/client";
import { handleApiError } from "@/lib/api/error-handler";
import { requireSession } from "@/lib/auth/session";
import { loadDashboardThresholds } from "@/lib/dashboard/thresholds";
import { opsAccess } from "@/lib/dashboard/ops/access";
import { istToday, parseOpsFilter, parseOpsPeriod } from "@/lib/dashboard/ops/params";
import { loadQueue } from "@/lib/dashboard/ops/queue";
import { loadRejections } from "@/lib/dashboard/ops/sip";
import { loadDocs, loadQueries, loadRejected } from "@/lib/dashboard/ops/exceptions";
import { SLA_LABEL } from "@/lib/dashboard/ops/fmt";
import type { OpsWindow } from "@/lib/dashboard/ops/window";
import { formatDate } from "@/lib/format";
import { mayUseRoleDashboard } from "@/lib/dashboards/open-system";

export const dynamic = "force-dynamic";

const KINDS = ["pending", "sla", "rejected", "sip", "docs", "queries"] as const;
type Kind = (typeof KINDS)[number];
const MAX = 5000;

function cell(v: unknown): string {
  if (v == null) return "";
  let s = String(v);
  // A leading = + - @ turns a cell into a formula in Excel / Sheets.
  if (/^[=+\-@]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
const csv = (head: string[], rows: unknown[][]) =>
  "﻿" + [head, ...rows].map((r) => r.map(cell).join(",")).join("\r\n") + "\r\n";
const ist = (iso: string | null) =>
  iso ? formatDate(iso, "dateTime") : "";

export async function GET(req: NextRequest) {
  try {
    const session = await requireSession();
    const access = opsAccess(session);
    if (!(await mayUseRoleDashboard(session, "operations", access.allowed))) {
      return NextResponse.json({ error: "You do not have access to the operations dashboard." }, { status: 403 });
    }

    const sp = Object.fromEntries(req.nextUrl.searchParams.entries());
    const kind = sp.kind as Kind;
    if (!KINDS.includes(kind)) return NextResponse.json({ error: "Unknown export" }, { status: 400 });
    const filter = parseOpsFilter(sp, session.userId);
    const p = parseOpsPeriod(sp);
    const today = istToday();

    const body = await withTenant(
      session.tenantId,
      async (tx) => {
        const t = await loadDashboardThresholds(tx);
        const w: OpsWindow = {
          tenantId: session.tenantId, userId: session.userId, scope: access.scope,
          filter: kind === "sla" ? { ...filter, sla: ["breached"] } : filter,
          from: p.from, to: p.to, today, periodLabel: p.label, t,
        };
        if (kind === "pending" || kind === "sla") {
          const q = await loadQueue(tx, w, t.opsHighValue, MAX);
          return csv(
            ["Received", "Client", "RM", "Branch", "Request type", "Request", "Amount (₹)", "Mode", "Assigned to", "Status",
             "Pending with", "SLA due", "SLA", "Ageing (days)", "Priority", "Escalation", "Latest remark"],
            q.items.map((i) => [ist(i.receivedAt), i.client, i.rm, i.branch, i.kindLabel, i.title, i.amount, i.mode, i.assignee,
              i.statusLabel, i.pendingLabel, ist(i.slaDue), SLA_LABEL[i.slaState] ?? i.slaState, i.ageDays, i.priorityLabel,
              i.level > 0 ? `Level ${i.level} — ${i.levelWhy}` : "None", i.remark]),
          );
        }
        if (kind === "rejected") {
          const r = await loadRejected(tx, w, MAX);
          return csv(
            ["Client", "RM", "Branch", "Transaction", "Scheme", "Amount (₹)", "Instruction", "Legs in instruction", "Leg", "Rejection reason", "Rejection date", "Resolution", "Assigned to"],
            (r?.rows ?? []).map((x) => [x.client, x.rm, x.branch, x.type, x.scheme, x.amount, x.instructionRef, x.legsInInstruction,
              x.legsInInstruction > 1 ? (x.direction === "outflow" ? "source" : "destination") : "", x.reason ?? "Reason missing", x.date, x.resolution ?? "Not tracked", x.assignedTo]),
          );
        }
        if (kind === "sip") {
          const r = await loadRejections(tx, w, MAX);
          return csv(
            ["Client", "RM", "Branch", "SIP amount (₹)", "Rejection date", "Reason", "Follow-up status", "Follow-up date", "Repurchase",
             "Pending amount (₹)", "Assigned to", "Ageing (days)", "Past SLA", "Remarks"],
            r.rows.map((x) => [x.client, x.rm, x.branch, x.amount, x.date, x.reason ?? "Reason not updated", x.followUp, x.followUpDate,
              x.repurchase.replace(/_/g, " "), x.pending, x.assignedTo, x.ageDays, x.pastSla ? "Yes" : "No", x.remarks]),
          );
        }
        if (kind === "docs") {
          const r = await loadDocs(tx, w, MAX);
          return csv(
            ["Client", "Required document", "Requested", "Pending with", "Ageing (days)", "Assigned to", "Past SLA"],
            r.rows.map((x) => [x.client, x.document, ist(x.requested), x.pendingFrom, x.ageDays, x.assignee, x.breached ? "Yes" : "No"]),
          );
        }
        const r = await loadQueries(tx, w, MAX);
        return csv(
          ["Ticket", "Client", "RM", "Query type", "Created", "Assigned to", "Ageing (days)", "Status", "SLA due", "Past SLA", "Remarks"],
          r.rows.map((x) => [x.ticket, x.client, x.rm, x.type, ist(x.created), x.assignee, x.ageDays, x.status, ist(x.slaDue), x.breached ? "Yes" : "No", x.remarks]),
        );
      },
      { userId: session.userId, branchId: session.branchId ?? undefined, roles: session.roles },
    );

    const name = `operations-${kind}-${today}.csv`;
    return new NextResponse(body, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${name}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    return handleApiError(err);
  }
}
