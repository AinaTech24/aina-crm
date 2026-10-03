import { PageHeaderCard } from "@/components/layout/PageHeaderCard";
/**
 * Client responses — did the emails that ask for something actually work?
 *
 * Delivery reports answer "did it arrive". This answers "did they do it": one
 * row per send, tracked sent → opened → tapped the link → done, with the
 * evidence dated after the send. The filters double as worklists; the useful
 * one is "Opened, not finished" — clients who tapped the button and got stuck.
 */

import Link from "next/link";
import { MailCheck, ArrowLeft } from "lucide-react";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { requireAny, can } from "@/lib/auth/rbac";
import {
  loadFollowThrough,
  ACTION_TEMPLATES,
  ACTION_TEMPLATE_KEYS,
  type ActionTemplateKey,
  type Stage,
} from "@/lib/comms/follow-through";
import { FollowThroughTable } from "@/components/communications/FollowThroughTable";

export const dynamic = "force-dynamic";

const STAGE_FILTERS: Array<{ key: Stage | "all"; label: string }> = [
  { key: "all", label: "Everyone" },
  { key: "link_opened", label: "Opened, not finished" },
  { key: "delivered", label: "Never opened" },
  { key: "acted", label: "Done" },
  { key: "skipped", label: "Not sent" },
];

export default async function ResponsesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const session = await requireSession();
  requireAny(session.roles, ["investor.view.all", "investor.view.assigned"], session.permissions);
  const seesAll = can(session.roles, "investor.view.all", session.permissions);
  const canSend = can(session.roles, "communication.send", session.permissions) || seesAll;

  const sp = await searchParams;
  const tpl = (ACTION_TEMPLATE_KEYS as string[]).includes(sp.template ?? "")
    ? (sp.template as ActionTemplateKey)
    : undefined;
  const stage = (["link_opened", "delivered", "acted", "skipped"] as string[]).includes(sp.stage ?? "")
    ? (sp.stage as Stage)
    : undefined;

  const { rows, summary } = await withTenant(
    session.tenantId,
    (tx) =>
      loadFollowThrough(tx, {
        tenantId: session.tenantId,
        templateKey: tpl,
        stage,
        rmId: seesAll ? undefined : session.userId,
      }),
    { userId: session.userId, branchId: session.branchId, roles: session.roles }
  );

  const qs = (patch: Record<string, string | undefined>) => {
    const p = new URLSearchParams();
    const next = { template: tpl, stage, ...patch };
    for (const [k, v] of Object.entries(next)) if (v) p.set(k, String(v));
    const s = p.toString();
    return `/dashboard/communications/responses${s ? `?${s}` : ""}`;
  };

  const pct = (n: number) => (summary.sent ? Math.round((n / summary.sent) * 100) : 0);

  return (
    <div className="space-y-5 max-w-7xl">
      <PageHeaderCard breadcrumb={[{ label: "Settings", href: "/dashboard/settings" }, { label: "Communications", href: "/dashboard/communications" }, { label: "Client responses" }]} title={<><MailCheck className="size-6 text-primary" /> Client responses</>} actions={<><Link href="/dashboard/communications" className="btn-secondary text-xs inline-flex items-center gap-1.5">
          <ArrowLeft className="size-3.5" /> All messages
        </Link></>} />

      {/* Funnel — each number is a share of everything sent in this view. */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Stat label="Sent" value={String(summary.sent)} />
        <Stat label="Opened the email" value={`${summary.opened}`} sub={`${pct(summary.opened)}%`} />
        <Stat label="Tapped the link" value={`${summary.linkOpened}`} sub={`${pct(summary.linkOpened)}%`} />
        <Stat label="Finished" value={`${summary.acted}`} sub={`${pct(summary.acted)}%`} tone="good" />
      </div>

      {summary.stalled > 0 && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-800 flex items-center justify-between gap-3 flex-wrap">
          <span>
            <strong>{summary.stalled}</strong> client{summary.stalled === 1 ? "" : "s"} opened their link but never
            finished. They were interested and got stuck — a phone call works better than another email.
          </span>
          <Link href={qs({ stage: "link_opened" })} className="btn-secondary text-xs whitespace-nowrap">
            Show them
          </Link>
        </div>
      )}

      {/* Filters — both URL-driven, so a view is shareable. */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="inline-flex flex-wrap rounded-lg border border-border bg-secondary/40 p-0.5 gap-0.5 text-xs">
          <Link href={qs({ template: undefined })}
            className={`px-3 py-1.5 rounded-md font-medium ${!tpl ? "bg-card shadow-sm" : "text-muted-foreground hover:bg-secondary"}`}>
            All emails
          </Link>
          {ACTION_TEMPLATE_KEYS.map((k) => (
            <Link key={k} href={qs({ template: k })}
              className={`px-3 py-1.5 rounded-md font-medium ${tpl === k ? "bg-card shadow-sm" : "text-muted-foreground hover:bg-secondary"}`}>
              {ACTION_TEMPLATES[k].label}
            </Link>
          ))}
        </div>
        <div className="inline-flex flex-wrap items-center gap-1 text-xs">
          {STAGE_FILTERS.map((f) => {
            const active = (f.key === "all" && !stage) || f.key === stage;
            return (
              <Link key={f.key} href={qs({ stage: f.key === "all" ? undefined : f.key })}
                className={`px-2.5 py-1 rounded-md border ${active ? "bg-primary text-primary-foreground border-primary" : "border-border hover:bg-secondary"}`}>
                {f.label}
              </Link>
            );
          })}
        </div>
      </div>

      <FollowThroughTable rows={rows} canSend={canSend} />
    </div>
  );
}

function Stat({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: "good" }) {
  return (
    <div className="card-surface p-4">
      <div className="text-2xs uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="mt-1.5 flex items-baseline gap-2">
        <span className={`text-xl font-semibold tabular-nums ${tone === "good" ? "text-emerald-700" : ""}`}>{value}</span>
        {sub && <span className="text-xs text-muted-foreground tabular-nums">{sub}</span>}
      </div>
    </div>
  );
}
