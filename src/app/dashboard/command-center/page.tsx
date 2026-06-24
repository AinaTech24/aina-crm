/**
 * Command Center — the single screen an owner or RM opens every morning.
 *
 * One prioritised worklist across every module: SLA breaches, SIP bounces,
 * redemption risk, overdue reviews, KYC expiries, overdue tasks & lead
 * follow-ups, stale risk profiles, birthdays. Firm-wide for owners/branch
 * heads/compliance; "your book only" for RMs and ops.
 *
 * Pure read over current state (src/lib/command-center/queue.ts) — every row
 * deep-links to where you act.
 */

import Link from "next/link";
import {
  LifeBuoy, XOctagon, TrendingDown, CalendarClock, Calendar, CalendarOff, CalendarCheck, ShieldAlert, ListChecks,
  Sparkles, ShieldCheck, Cake, CheckCircle2, ArrowRight, Inbox, MessageCircle, FileText, Users, LayoutList,
} from "lucide-react";
import { requireSession } from "@/lib/auth/session";
import { can } from "@/lib/auth/rbac";
import { withTenant } from "@/db/client";
import { buildCommandQueue, type ActionGroup, type ActionItem, type Severity } from "@/lib/command-center/queue";
import { FilterBar } from "@/components/common/FilterBar";
import { AutoRefresh } from "@/components/common/AutoRefresh";
import { CommandClientPicker } from "@/components/command-center/CommandClientPicker";
import { CommandItemActions } from "@/components/command-center/CommandItemActions";
import { CommandDigestButton } from "@/components/command-center/CommandDigestButton";
import { sql } from "drizzle-orm";

export const dynamic = "force-dynamic";

const ICONS: Record<string, any> = {
  LifeBuoy, XOctagon, TrendingDown, CalendarClock, Calendar, CalendarOff, CalendarCheck, ShieldAlert,
  ListChecks, Sparkles, ShieldCheck, Cake, MessageCircle, FileText,
};

/** WhatsApp wish text for the inline "send wish" action. */
function wishText(actionType: ActionItem["actionType"], name: string): string {
  if (actionType === "anniversary") return `Dear ${name}, wishing you a very happy wedding anniversary! 💐`;
  return `Dear ${name}, wishing you a very happy birthday! 🎂 May the year ahead bring you health, happiness and prosperity.`;
}

const TONE: Record<string, { badge: string; bar: string; ring: string }> = {
  rose: { badge: "bg-rose-100 text-rose-700", bar: "bg-rose-500", ring: "border-rose-200" },
  amber: { badge: "bg-amber-100 text-amber-700", bar: "bg-amber-500", ring: "border-amber-200" },
  sky: { badge: "bg-sky-100 text-sky-700", bar: "bg-sky-500", ring: "border-sky-200" },
  violet: { badge: "bg-violet-100 text-violet-700", bar: "bg-violet-500", ring: "border-violet-200" },
  emerald: { badge: "bg-emerald-100 text-emerald-700", bar: "bg-emerald-500", ring: "border-emerald-200" },
};

const BANDS: { key: Severity; label: string; sub: string }[] = [
  { key: "now", label: "Act now", sub: "Money or relationships at risk today" },
  { key: "today", label: "Today", sub: "Service promises & pipeline" },
  { key: "soon", label: "This week", sub: "Stay ahead of it" },
];

export default async function CommandCenterPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const session = await requireSession();
  const sp = await searchParams;
  const firmWide = can(session.roles, "dashboard.view.owner", session.permissions);
  const sevFilter = (sp.severity ?? "").split(",").filter(Boolean);
  const catFilter = (sp.category ?? "").split(",").filter(Boolean);
  // Owners can scope the whole queue to one user; everyone else only sees their
  // own book, so the user filter is owner-only.
  const userParam = firmWide ? (sp.user ?? "").trim() : "";
  // Scope the whole board to a single client (search-as-you-type picker).
  const clientId = (sp.client ?? "").trim();
  // Layout: group by urgency band (default) or consolidate by client.
  const clientView = (sp.view ?? "") === "client";

  const { allGroups, userOptions, clientName } = await withTenant(
    session.tenantId,
    async (tx) => {
      const groups = await buildCommandQueue(
        tx as any,
        {
          ...(userParam ? { userId: userParam, firmWide: false } : { userId: session.userId, firmWide }),
          clientId,
        }
      );
      // Resolve the selected client's name for the picker chip.
      let clientName = "";
      if (clientId) {
        const cr = await tx.execute(sql`SELECT name FROM investors WHERE id = ${clientId} LIMIT 1`);
        clientName = ((cr.rows[0] as any)?.name as string) ?? "";
      }
      // Roster for the User filter — active users, so any newly-added user shows
      // up automatically.
      let users: { value: string; label: string }[] = [];
      if (firmWide) {
        const r = await tx.execute(sql`
          SELECT id, name FROM users
          WHERE tenant_id = ${session.tenantId}::uuid AND status = 'active'
          ORDER BY name ASC
        `);
        users = (r.rows as { id: string; name: string }[]).map((u) => ({ value: String(u.id), label: u.name ?? "—" }));
      }
      return { allGroups: groups, userOptions: users, clientName };
    },
    { userId: session.userId, branchId: session.branchId, roles: session.roles }
  );

  // Category options come from whatever the queue produced — so the filter only
  // ever offers categories that actually have open items.
  const categoryOptions = Array.from(
    new Map(allGroups.map((g) => [g.key, g.label] as const)).entries()
  ).map(([value, label]) => ({ value, label }));

  const dateFrom = (sp.date_from ?? "").slice(0, 10);
  const dateTo = (sp.date_to ?? "").slice(0, 10);
  const inRange = (d?: string | null) => {
    if (!dateFrom && !dateTo) return true;
    if (!d) return true; // undated = always-current (e.g. SLA breach) — never hide
    if (dateFrom && d < dateFrom) return false;
    if (dateTo && d > dateTo) return false;
    return true;
  };

  let groups = allGroups;
  if (sevFilter.length) groups = groups.filter((g) => sevFilter.includes(g.severity));
  if (catFilter.length) groups = groups.filter((g) => catFilter.includes(g.key));
  // Date-range filter — narrows dated items (reviews, meetings, KYC, tasks,
  // follow-ups…) to the window; undated "act now" items always stay. Count
  // reflects what's shown.
  if (dateFrom || dateTo) {
    groups = groups
      .map((g) => {
        const items = g.items.filter((it) => inRange(it.date));
        return { ...g, items, count: items.length };
      })
      .filter((g) => g.items.length > 0);
  }

  const totalItems = groups.reduce((n, g) => n + g.count, 0);
  const nowCount = groups.filter((g) => g.severity === "now").reduce((n, g) => n + g.count, 0);

  return (
    <div className="space-y-6 max-w-6xl">
      {/* Triage queue is "act now" — keep it fresh as work completes elsewhere. */}
      <AutoRefresh intervalMs={30000} />
      {/* Header */}
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <Inbox className="size-6 text-brand-cyan" /> Command Center
          </h1>
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          <ViewToggle current={clientView ? "client" : "urgency"} sp={sp} />
          <CommandDigestButton />
          <Stat label="Act now" value={nowCount} tone={nowCount ? "rose" : "emerald"} />
          <Stat label="Total open" value={totalItems} tone="sky" />
        </div>
      </div>

      <FilterBar
        totalCount={totalItems}
        leftSlot={<CommandClientPicker selectedId={clientId} selectedName={clientName} />}
        filters={[
          ...(firmWide && userOptions.length
            ? [{ type: "select" as const, key: "user", label: "User", allLabel: "All users", options: userOptions }]
            : []),
          { type: "date_range" as const, key: "date", label: "Date" },
          {
            type: "multi",
            key: "severity",
            label: "Urgency",
            options: [
              { value: "now", label: "Act now" },
              { value: "today", label: "Today" },
              { value: "soon", label: "This week" },
            ],
          },
          ...(categoryOptions.length
            ? [{ type: "multi" as const, key: "category", label: "Category", options: categoryOptions }]
            : []),
        ]}
      />

      {(dateFrom || dateTo) && (
        <p className="text-[11px] text-muted-foreground -mt-3">
          Date filter narrows dated items (reviews, meetings, follow-ups…). Always-current items like SLA breaches stay visible.
        </p>
      )}

      {groups.length === 0 ? (
        <div className="card-surface p-12 text-center">
          <CheckCircle2 className="size-10 text-emerald-500 mx-auto mb-3" />
          <div className="font-semibold text-lg">All clear 🎉</div>
          <p className="text-sm text-muted-foreground mt-1">
            No overdue reviews, SIP bounces, SLA breaches or follow-ups in {firmWide ? "the firm" : "your book"} right now.
          </p>
        </div>
      ) : clientView ? (
        <ByClientView groups={groups} />
      ) : (
        BANDS.map((band) => {
          const bandGroups = groups.filter((g) => g.severity === band.key);
          if (!bandGroups.length) return null;
          return (
            <section key={band.key} className="space-y-3">
              <div className="flex items-baseline gap-2 px-0.5">
                <h2 className="text-sm font-bold uppercase tracking-wide">{band.label}</h2>
                <span className="text-xs text-muted-foreground">{band.sub}</span>
              </div>
              <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                {bandGroups.map((g) => (
                  <GroupCard key={g.key} group={g} />
                ))}
              </div>
            </section>
          );
        })
      )}
    </div>
  );
}

/** Header toggle: group by urgency band (default) or consolidate by client. */
function ViewToggle({ current, sp }: { current: "urgency" | "client"; sp: Record<string, string | undefined> }) {
  const mk = (view: "urgency" | "client") => {
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(sp)) if (v && k !== "view") params.set(k, v);
    if (view === "client") params.set("view", "client");
    const qs = params.toString();
    return `/dashboard/command-center${qs ? `?${qs}` : ""}`;
  };
  const base = "px-2.5 py-1 rounded-md text-xs font-medium inline-flex items-center gap-1.5 transition-colors";
  return (
    <div className="inline-flex rounded-lg border border-border bg-card p-0.5 gap-0.5">
      <Link href={mk("urgency")} className={`${base} ${current === "urgency" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}>
        <LayoutList className="size-3" /> By urgency
      </Link>
      <Link href={mk("client")} className={`${base} ${current === "client" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}>
        <Users className="size-3" /> By client
      </Link>
    </div>
  );
}

/** Consolidated view — one card per client listing everything open for them. */
function ByClientView({ groups }: { groups: ActionGroup[] }) {
  const order: Record<Severity, number> = { now: 0, today: 1, soon: 2 };
  type Row = ActionItem & { groupKey: string; groupLabel: string; icon: string; severity: Severity };
  const byClient = new Map<string, { name: string; rows: Row[]; topSeverity: Severity; amount: number }>();
  const general: Row[] = [];

  for (const g of groups) {
    for (const it of g.items) {
      const row: Row = { ...it, groupKey: g.key, groupLabel: g.label, icon: g.icon, severity: g.severity };
      if (it.client?.id) {
        const e = byClient.get(it.client.id) ?? { name: it.client.name, rows: [], topSeverity: "soon" as Severity, amount: 0 };
        e.rows.push(row);
        if (order[g.severity] < order[e.topSeverity]) e.topSeverity = g.severity;
        e.amount += Number(it.amount) || 0;
        byClient.set(it.client.id, e);
      } else {
        general.push(row);
      }
    }
  }

  const clients = Array.from(byClient.entries()).sort(
    (a, b) => order[a[1].topSeverity] - order[b[1].topSeverity] || b[1].amount - a[1].amount || b[1].rows.length - a[1].rows.length
  );

  return (
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
      {clients.map(([cid, c]) => {
        const tone = TONE[c.topSeverity === "now" ? "rose" : c.topSeverity === "today" ? "amber" : "sky"];
        return (
          <div key={cid} className={`card-surface overflow-hidden border ${tone.ring}`}>
            <Link href={`/dashboard/investors/${cid}`} className="flex items-center justify-between px-4 py-3 border-b bg-secondary/30 hover:bg-secondary/50">
              <span className="font-semibold text-sm truncate">{c.name}</span>
              <span className={`text-xs font-bold px-2 py-0.5 rounded-full tabular-nums ${tone.badge}`}>{c.rows.length}</span>
            </Link>
            <ul className="divide-y">
              {c.rows.map((r) => {
                const Icon = ICONS[r.icon] ?? Inbox;
                return (
                  <li key={`${r.groupKey}:${r.id}`} className="flex items-center gap-1 px-4 py-2.5 hover:bg-accent/40">
                    <Link href={r.href} className="flex items-center gap-2 min-w-0 flex-1">
                      <Icon className="size-3.5 shrink-0 text-muted-foreground" />
                      <div className="min-w-0 flex-1">
                        <div className="text-sm font-medium truncate">{r.groupLabel}</div>
                        {r.detail && <div className="text-[11px] text-muted-foreground truncate">{r.detail}</div>}
                      </div>
                    </Link>
                    <CommandItemActions
                      itemKey={r.itemKey ?? `${r.groupKey}:${r.id}`}
                      actionType={r.actionType}
                      taskId={r.actionType === "task" ? r.id : undefined}
                      phone={r.phone}
                      wishText={wishText(r.actionType, c.name)}
                    />
                  </li>
                );
              })}
            </ul>
          </div>
        );
      })}
      {general.length > 0 && (
        <div className="card-surface overflow-hidden border border-border">
          <div className="px-4 py-3 border-b bg-secondary/30 font-semibold text-sm">Not client-specific</div>
          <ul className="divide-y">
            {general.map((r) => {
              const Icon = ICONS[r.icon] ?? Inbox;
              return (
                <li key={`${r.groupKey}:${r.id}`} className="flex items-center gap-2 px-4 py-2.5 hover:bg-accent/40">
                  <Link href={r.href} className="flex items-center gap-2 min-w-0 flex-1">
                    <Icon className="size-3.5 shrink-0 text-muted-foreground" />
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-medium truncate">{r.title}</div>
                      {r.detail && <div className="text-[11px] text-muted-foreground truncate">{r.detail}</div>}
                    </div>
                  </Link>
                  <CommandItemActions itemKey={r.itemKey ?? `${r.groupKey}:${r.id}`} actionType={r.actionType} taskId={r.actionType === "task" ? r.id : undefined} phone={r.phone} wishText={wishText(r.actionType, r.title)} />
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}

function GroupCard({ group }: { group: ActionGroup }) {
  const Icon = ICONS[group.icon] ?? Inbox;
  const tone = TONE[group.tone] ?? TONE.sky;
  return (
    <div className={`card-surface overflow-hidden border ${tone.ring}`}>
      <div className="flex items-center justify-between px-4 py-3 border-b bg-secondary/30">
        <div className="flex items-center gap-2 min-w-0">
          <Icon className="size-4 shrink-0" />
          <span className="font-semibold text-sm truncate">{group.label}</span>
        </div>
        <span className={`text-xs font-bold px-2 py-0.5 rounded-full tabular-nums ${tone.badge}`}>
          {group.count}
        </span>
      </div>
      <ul className="divide-y">
        {group.items.map((it) => (
          <li key={it.id} className="flex items-center gap-1 px-4 py-2.5 hover:bg-accent/40 transition-colors">
            <Link href={it.href} className="flex items-center gap-2 min-w-0 flex-1">
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium truncate">{it.title}</div>
                {it.detail && (
                  <div className="text-[11px] text-muted-foreground truncate">{it.detail}</div>
                )}
              </div>
              {typeof it.ageDays === "number" && it.ageDays > 0 && (
                <span
                  className={`text-[10px] font-semibold px-1.5 py-0.5 rounded tabular-nums shrink-0 ${it.ageDays > 30 ? "bg-rose-100 text-rose-700" : it.ageDays > 7 ? "bg-amber-100 text-amber-700" : "bg-secondary text-muted-foreground"
                    }`}
                  title={`${it.ageDays} day(s) overdue / waiting`}
                >
                  {it.ageDays}d
                </span>
              )}
            </Link>
            <CommandItemActions
              itemKey={it.itemKey ?? `${group.key}:${it.id}`}
              actionType={it.actionType}
              taskId={it.actionType === "task" ? it.id : undefined}
              phone={it.phone}
              wishText={wishText(it.actionType, it.title)}
            />
          </li>
        ))}
      </ul>
      {group.count > group.items.length && (
        <Link
          href={group.href}
          className="block px-4 py-2 text-xs font-medium text-brand-cyan-deep hover:underline border-t bg-card"
        >
          View all {group.count} →
        </Link>
      )}
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: number; tone: "rose" | "sky" | "emerald" }) {
  const cls =
    tone === "rose" ? "text-rose-600" : tone === "emerald" ? "text-emerald-600" : "text-foreground";
  return (
    <div className="text-right">
      <div className={`text-2xl font-bold tabular-nums ${cls}`}>{value}</div>
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
    </div>
  );
}
