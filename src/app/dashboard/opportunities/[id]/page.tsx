/**
 * One opportunity — where its journey runs. The journey card (shared with the
 * client page) moves it on, checks the gates, records a needs analysis,
 * creates the proposal and sets the next follow-up; beside it, the details,
 * the client, the tasks it put on people's lists, and its history.
 */

import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { sql } from "drizzle-orm";
import { CheckCircle2, Circle, Mail, Phone, UserRound } from "lucide-react";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { requireInvestorView } from "@/lib/investors/access";
import { canWorkOpportunities, loadViewableOpportunity } from "@/lib/opportunities/access";
import { listOpportunities } from "@/lib/opportunities/journey";
import { stageName } from "@/lib/opportunities/stages";
import { PageHeaderCard } from "@/components/layout/PageHeaderCard";
import { Badge } from "@/components/ui/Badge";
import { buttonClass } from "@/components/ui/button-class";
import { OpportunityDetailsCard, OpportunityJourney } from "@/components/opportunities/OpportunityWorkspace";
import { formatDate, formatMoney } from "@/lib/format";
import { cn } from "@/lib/utils";
import { contactLogAttrs } from "@/lib/activities/contact-log";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const cleanName = (n: string | null | undefined) => (n ?? "").replace(/\s*\([^)]*\)\s*$/, "") || null;

export default async function OpportunityPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID.test(id)) redirect("/dashboard/opportunities");
  const session = await requireSession();
  requireInvestorView(session);
  const canWork = canWorkOpportunities(session);

  const data = await withTenant(session.tenantId, async (tx) => {
    try {
      await loadViewableOpportunity(tx, session, id);
    } catch {
      return null;
    }
    const [view] = await listOpportunities(tx, session.tenantId, { ids: [id] });
    if (!view) return null;
    const client = (await tx.execute(sql`
      SELECT i.id, i.name, i.phone, i.email, i.aum, u.name AS rm_name
        FROM investors i LEFT JOIN users u ON u.id = i.rm_id
       WHERE i.id = ${view.investorId}::uuid AND i.tenant_id = ${session.tenantId}::uuid
    `)).rows[0] as { id: string; name: string; phone: string | null; email: string | null; aum: string | null; rm_name: string | null };
    const history = (await tx.execute(sql`
      SELECT h.stage_key, h.entered_at, h.exited_at, h.remarks, u.name AS by_name
        FROM blueprint_stage_history h LEFT JOIN users u ON u.id = h.completed_by
       WHERE h.tenant_id = ${session.tenantId}::uuid AND h.subject_type = 'opportunity' AND h.subject_id = ${id}::uuid
       ORDER BY h.entered_at DESC LIMIT 60
    `)).rows as Array<{ stage_key: string; entered_at: string; exited_at: string | null; remarks: string | null; by_name: string | null }>;
    const tasks = (await tx.execute(sql`
      SELECT t.id, t.title, t.status, t.due_at, t.completed_at, u.name AS assignee
        FROM tasks t LEFT JOIN users u ON u.id = t.assignee_id
       WHERE t.tenant_id = ${session.tenantId}::uuid AND t.meta ->> 'opportunityId' = ${id}
       ORDER BY CASE WHEN t.status IN ('open', 'in_progress', 'blocked') THEN 0 ELSE 1 END, t.due_at ASC NULLS LAST
       LIMIT 30
    `)).rows as Array<{ id: string; title: string; status: string; due_at: string | null; completed_at: string | null; assignee: string | null }>;
    const staff = canWork
      ? ((await tx.execute(sql`
          SELECT id, name, roles FROM users
           WHERE tenant_id = ${session.tenantId}::uuid AND status = 'active'
             AND roles && ARRAY['rm', 'branch_head', 'insurance_team', 'back_office', 'ops', 'owner']::text[]
           ORDER BY name LIMIT 300`)).rows as Array<{ id: string; name: string; roles: string[] }>)
          .map((u) => ({ id: u.id, name: cleanName(u.name) ?? u.name, insurance: (u.roles ?? []).includes("insurance_team") }))
      : [];
    return { view, client, history, tasks, staff };
  }, { userId: session.userId, branchId: session.branchId ?? undefined, roles: session.roles });

  if (!data) notFound();
  const { view: o, client, history, tasks, staff } = data;
  const nowMs = Date.now();

  return (
    <div className="space-y-5">
      <PageHeaderCard
        title={<>{o.productLabel} <span className="font-normal text-muted-foreground">— {client.name}</span></>}
        breadcrumb={[{ label: "Opportunities", href: "/dashboard/opportunities" }, { label: `${o.productLabel} — ${client.name}` }]}
        actions={<Link href={`/dashboard/investors/${client.id}`} className={buttonClass("secondary")}>Open client</Link>}
      >
        {o.status === "won" ? <Badge tone="success" raw>Won</Badge>
          : o.status === "lost" ? <Badge tone="neutral" raw>Lost</Badge>
          : <Badge tone="info" raw>{o.current.name}</Badge>}
      </PageHeaderCard>

      <div className="grid gap-5 lg:grid-cols-3">
        <div className="min-w-0 space-y-5 lg:col-span-2">
          <OpportunityJourney o={o} canWork={canWork} staff={staff} />

          <section className="card-surface p-5">
            <h2 className="section-title">History</h2>
            {history.length === 0 ? (
              <p className="dash-empty mt-3 text-sm">No steps recorded yet.</p>
            ) : (
              <ol className="mt-3 space-y-3">
                {history.map((h, i) => (
                  <li key={`${h.stage_key}-${h.entered_at}-${i}`} className="flex gap-3 text-sm">
                    {h.exited_at
                      ? <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-success" aria-hidden />
                      : <Circle className="mt-0.5 size-4 shrink-0 fill-primary/20 text-primary" aria-hidden />}
                    <div className="min-w-0">
                      <div className="font-medium text-foreground">{stageName(h.stage_key)}</div>
                      <div className="text-xs text-muted-foreground">
                        Reached {formatDate(h.entered_at, "dateTime")}
                        {h.exited_at ? ` · done ${formatDate(h.exited_at, "dateTime")}` : " · current step"}
                        {h.by_name ? ` · ${cleanName(h.by_name)}` : ""}
                      </div>
                      {h.remarks && <div className="mt-0.5 text-xs text-muted-foreground">{h.remarks}</div>}
                    </div>
                  </li>
                ))}
              </ol>
            )}
          </section>
        </div>

        <div className="min-w-0 space-y-5">
          <section className="card-surface p-5">
            <h2 className="section-title">Client</h2>
            <Link href={`/dashboard/investors/${client.id}`} className="mt-2 block text-base font-semibold text-primary hover:underline">
              {client.name}
            </Link>
            <ul className="mt-2 space-y-1.5 text-sm text-muted-foreground">
              {client.rm_name && <li className="flex items-center gap-2"><UserRound className="size-3.5" aria-hidden /> RM {cleanName(client.rm_name)}</li>}
              {client.phone && <li className="flex items-center gap-2"><Phone className="size-3.5" aria-hidden /> <a {...contactLogAttrs({ type: "investor", id: String(client.id), name: String(client.name) })} href={`tel:${client.phone}`} className="hover:text-foreground">{client.phone}</a></li>}
              {client.email && <li className="flex items-center gap-2"><Mail className="size-3.5" aria-hidden /> <a {...contactLogAttrs({ type: "investor", id: String(client.id), name: String(client.name) })} href={`mailto:${client.email}`} className="truncate hover:text-foreground">{client.email}</a></li>}
              {client.aum != null && Number(client.aum) > 0 && <li>AUM with you {formatMoney(Number(client.aum))}</li>}
            </ul>
          </section>

          <OpportunityDetailsCard o={o} canWork={canWork} staff={staff} />

          <section className="card-surface p-5">
            <h2 className="section-title">Tasks</h2>
            {tasks.length === 0 ? (
              <p className="dash-empty mt-3 text-sm">No task linked to this opportunity.</p>
            ) : (
              <ul className="mt-3 divide-y divide-border/60">
                {tasks.map((t) => {
                  const open = ["open", "in_progress", "blocked"].includes(t.status);
                  const overdue = open && t.due_at && new Date(t.due_at).getTime() < nowMs;
                  return (
                    <li key={t.id} className="py-2 text-sm">
                      <Link href={`/dashboard/tasks/${t.id}`} className={cn("font-medium hover:underline", open ? "text-foreground" : "text-muted-foreground line-through")}>
                        {t.title}
                      </Link>
                      <div className={cn("text-xs", overdue ? "font-medium text-destructive" : "text-muted-foreground")}>
                        {open
                          ? t.due_at ? `Due ${formatDate(t.due_at)}${overdue ? " · overdue" : ""}` : "No due date"
                          : `Done ${t.completed_at ? formatDate(t.completed_at) : ""}`}
                        {t.assignee ? ` · ${cleanName(t.assignee)}` : ""}
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
