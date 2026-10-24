import Link from "next/link";
import { ShieldAlert } from "lucide-react";
import { PageHeaderCard } from "@/components/layout/PageHeaderCard";
import { PracticeNav } from "@/components/practice/PracticeNav";
import { PromiseEditor } from "@/components/practice/PromiseEditor";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { EmptyState } from "@/components/common/EmptyState";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { can } from "@/lib/auth/rbac";
import { isBranchScoped } from "@/lib/leads/access";
import { canManagePractice, canViewPractice } from "@/lib/practice/access";
import { SERVICE_TIERS, type ServiceTier } from "@/lib/practice/catalog";
import {
  PROMISE_ITEM_KEYS,
  PROMISE_ITEM_LABEL,
  describePromise,
  evaluatePromise,
  itemStateNote,
  loadPromises,
  promiseGaps,
  type PromiseItemKey,
} from "@/lib/practice/promise";
import { GapsTable, RmKeptTable, type GapRowView, type RmRowView } from "./PromiseTables";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const pct = (v: number | null) => (v == null ? "—" : `${v.toFixed(1)}%`);

function href(params: Record<string, string | null | undefined>): string {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v) qs.set(k, v);
  return `/dashboard/practice/promise?${qs.toString()}#gaps`;
}

export default async function ServicePromisePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const session = await requireSession();
  const header = (
    <>
      <PageHeaderCard
        title="Service Promise"
        subtitle="What every client of a tier gets, whoever their RM is — and how often the firm keeps it."
      />
      <PracticeNav active="promise" />
    </>
  );
  if (!canViewPractice(session)) {
    return (
      <div className="space-y-5">
        {header}
        <EmptyState
          icon={ShieldAlert}
          title="For the people who run the firm"
          description="The service promise is set and reviewed by the owner, branch heads and compliance."
        />
      </div>
    );
  }

  const sp = await searchParams;
  const tier = SERVICE_TIERS.includes(sp.tier as ServiceTier) ? (sp.tier as ServiceTier) : null;
  const item = sp.item === "all" || PROMISE_ITEM_KEYS.includes(sp.item as PromiseItemKey) ? (sp.item as PromiseItemKey | "all") : null;
  const rm = sp.rm === "none" || (sp.rm && UUID.test(sp.rm)) ? sp.rm : null;
  // A branch head locked to their branch sees that branch's clients only.
  const branchId = isBranchScoped(session) && !can(session.roles, "dashboard.view.all_branches", session.permissions)
    ? session.branchId ?? null
    : null;
  const canEdit = canManagePractice(session);

  const data = await withTenant(session.tenantId, async (tx) => {
    const stored = await loadPromises(tx, session.tenantId);
    const evaluation = await evaluatePromise(tx, session.tenantId, { branchId });
    const gaps = item ? await promiseGaps(tx, session.tenantId, { tier, item, rmId: rm, branchId, limit: 200 }) : null;
    return { stored, evaluation, gaps };
  }, { userId: session.userId, branchId: session.branchId ?? undefined, roles: session.roles });

  const { evaluation, stored, gaps } = data;
  const tierClients = new Map(evaluation.tiers.map((t) => [t.tier, t.clients]));

  const rmRows: RmRowView[] = evaluation.byRm.map((r) => ({
    rmId: r.rmId,
    rmName: r.rmName ?? "No RM",
    clients: r.clients,
    keptPct: r.keptPct,
    worstKey: r.worst?.key ?? null,
    worstLabel: r.worst ? PROMISE_ITEM_LABEL[r.worst.key] : null,
    worstPct: r.worst?.pct ?? null,
  }));
  const gapRows: GapRowView[] = (gaps?.rows ?? []).map((g) => ({
    id: g.id, name: g.name, rmName: g.rmName, tier: g.tier, missed: g.missed, daysSince: g.daysSince, detail: g.detail,
  }));
  const rmName = rm === "none" ? "No RM" : rm ? evaluation.byRm.find((r) => r.rmId === rm)?.rmName ?? "This RM" : null;
  const gapTitle = item
    ? `${tier ? `Tier ${tier} clients` : "Clients"}${rmName ? ` of ${rmName}` : ""} missing ${item === "all" ? "part of the promise" : PROMISE_ITEM_LABEL[item].toLowerCase()}`
    : "";

  return (
    <div className="space-y-5">
      {header}

      <section aria-labelledby="promise-heading" className="space-y-3">
        <h2 id="promise-heading" className="section-title">The promise</h2>
        <div className="grid gap-4 md:grid-cols-3">
          {SERVICE_TIERS.map((t) => (
            <Card key={t} equal>
              <CardHeader title={`Tier ${t}`} />
              <CardBody>
                <PromiseEditor
                  tier={t}
                  items={stored.promises[t]}
                  description={describePromise(t, stored.promises[t])}
                  clients={tierClients.get(t) ?? 0}
                  isDefault={!stored.stored.has(t)}
                  canEdit={canEdit}
                />
              </CardBody>
            </Card>
          ))}
        </div>
        {evaluation.untiered > 0 && (
          <p className="text-sm text-muted-foreground">
            {evaluation.untiered.toLocaleString("en-IN")} live {evaluation.untiered === 1 ? "client has" : "clients have"} no
            service tier, so no promise.{" "}
            <Link href="/dashboard/investors" className="text-primary hover:underline">Open Clients</Link> to grade them.
          </p>
        )}
      </section>

      <section aria-labelledby="kept-heading" className="space-y-3">
        <h2 id="kept-heading" className="section-title">Promise kept</h2>
        <p className="text-sm text-muted-foreground">
          A client counts as kept when every part of their tier&apos;s promise the CRM records was met. Click a figure to see the clients behind it.
        </p>
        <div className="grid gap-4 md:grid-cols-3">
          {evaluation.tiers.map((t) => (
            <Card key={t.tier} equal>
              <CardHeader
                title={`Tier ${t.tier}`}
                subtitle={`${t.clients.toLocaleString("en-IN")} live ${t.clients === 1 ? "client" : "clients"}`}
              />
              <CardBody className="space-y-3">
                <div>
                  {t.keptPct == null ? (
                    <p className="text-2xl font-semibold text-muted-foreground">—</p>
                  ) : (
                    <Link href={href({ tier: t.tier, item: "all" })} className="text-2xl font-semibold tabular-nums hover:underline">
                      {pct(t.keptPct)}
                    </Link>
                  )}
                  <p className="text-xs text-muted-foreground">
                    {t.keptPct == null
                      ? t.clients ? "Nothing the CRM records can be judged yet." : "No client in this tier."
                      : `${t.keptAll.toLocaleString("en-IN")} of ${t.clients.toLocaleString("en-IN")} got everything promised`}
                  </p>
                </div>
                <ul className="divide-y divide-border text-sm">
                  {t.items.map((it) => {
                    const note = itemStateNote(it.state, it.key);
                    return (
                      <li key={it.key} className="flex items-baseline justify-between gap-3 py-1.5">
                        <span>{PROMISE_ITEM_LABEL[it.key]}</span>
                        {it.state === "measured" ? (
                          <Link href={href({ tier: t.tier, item: it.key })} className="tabular-nums hover:underline" title={`${it.kept} of ${it.eligible}`}>
                            {pct(it.pct)}
                          </Link>
                        ) : (
                          <span className="text-right text-xs text-muted-foreground">{note}</span>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </CardBody>
            </Card>
          ))}
        </div>
      </section>

      <Card>
        <CardHeader title="By relationship manager" subtitle="Each client judged on their own tier's promise. Lowest first." />
        <CardBody padded={false}>
          <RmKeptTable rows={rmRows} />
        </CardBody>
      </Card>

      {gaps && (
        <div id="gaps">
          <Card>
            <CardHeader
              title={gapTitle}
              subtitle={gaps.total > gapRows.length
                ? `Showing the ${gapRows.length} longest gaps of ${gaps.total.toLocaleString("en-IN")}`
                : `${gaps.total.toLocaleString("en-IN")} ${gaps.total === 1 ? "client" : "clients"}`}
              action={<Link href="/dashboard/practice/promise" className="text-sm text-primary hover:underline">Clear</Link>}
            />
            <CardBody padded={false}>
              <GapsTable rows={gapRows} itemLabels={PROMISE_ITEM_LABEL} />
            </CardBody>
          </Card>
        </div>
      )}
    </div>
  );
}
