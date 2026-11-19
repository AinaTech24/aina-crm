/**
 * Aina Admin → Pricing quotes. Every "Get pricing" request: who asked, their
 * AUM and users, the package they chose, and whether it became a paying firm.
 */
import Link from "next/link";
import { sql } from "drizzle-orm";
import { withSystem } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { requirePlatform } from "@/lib/auth/rbac";
import { Badge } from "@/components/ui/Badge";
import { InlineEmpty } from "@/components/common/EmptyState";
import { cycleLabel, inr, parseCycle, type CycleQuote } from "@/lib/billing/aum-pricing";
import { formatDate } from "@/lib/format";
import { quoteStage, STAGE_LABEL } from "@/lib/onboarding/quote-followup";

export const dynamic = "force-dynamic";

type Row = {
  id: string;
  created_at: string;
  contact_name: string;
  firm_name: string;
  email: string;
  mobile: string;
  arn: string | null;
  aum_crore: string;
  users: number;
  quote: { tierLabel?: string; cycles?: CycleQuote[] };
  chosen_cycle: string | null;
  converted_tenant_id: string | null;
  converted_at: string | null;
  paid_at: string | null;
  followup_sent_at: string | null;
  mobile_verified_at: string | null;
  tenant_name: string | null;
};

export default async function PricingQuotesPage({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  const session = await requireSession();
  requirePlatform(session.roles, "platform.settings.manage");
  const { status } = await searchParams;
  // One state per quote (lib/onboarding/quote-followup.ts `quoteStage`).
  const filter =
    status === "paid"
      ? sql`q.paid_at IS NOT NULL`
      : status === "open"
        ? sql`q.paid_at IS NULL`
        : status === "firm_unpaid"
          ? sql`q.paid_at IS NULL AND q.converted_tenant_id IS NOT NULL`
          : status === "followed_up"
            ? sql`q.paid_at IS NULL AND q.converted_tenant_id IS NULL AND q.followup_sent_at IS NOT NULL`
            : status === "new"
              ? sql`q.paid_at IS NULL AND q.converted_tenant_id IS NULL AND q.followup_sent_at IS NULL`
              : sql`true`;

  const { rows, totals } = await withSystem(async (tx) => {
    const r = await tx.execute(sql`
      SELECT q.id, q.created_at, q.contact_name, q.firm_name, q.email, q.mobile, q.arn, q.aum_crore, q.users,
             q.quote, q.chosen_cycle, q.converted_tenant_id, q.converted_at, q.paid_at, q.followup_sent_at, q.mobile_verified_at,
             t.display_name AS tenant_name
        FROM pricing_quotes q LEFT JOIN tenants t ON t.id = q.converted_tenant_id
       WHERE ${filter}
       ORDER BY q.created_at DESC
       LIMIT 300
    `);
    const t = await tx.execute(sql`
      SELECT count(*)::int AS quotes, count(*) FILTER (WHERE converted_tenant_id IS NOT NULL)::int AS accounts,
             count(*) FILTER (WHERE paid_at IS NOT NULL)::int AS paid
        FROM pricing_quotes
    `);
    return { rows: r.rows as Row[], totals: t.rows[0] as { quotes: number; accounts: number; paid: number } };
  });

  const tab = (key: string | undefined, label: string) => (
    <Link
      href={key ? `/super-admin/pricing/quotes?status=${key}` : "/super-admin/pricing/quotes"}
      aria-current={status === key ? "page" : undefined}
      className={status === key ? "chip bg-primary text-primary-foreground" : "chip bg-secondary text-secondary-foreground"}
    >
      {label}
    </Link>
  );

  return (
    <div className="space-y-6 max-w-6xl">
      <div>
        <h1 className="page-title">Pricing quotes</h1>
        <p className="text-muted-foreground text-sm">
          {totals.quotes} quote{totals.quotes === 1 ? "" : "s"} · {totals.accounts} created an account · {totals.paid} paid.
          Back to <Link className="text-primary underline" href="/super-admin/pricing">pricing</Link> ·{" "}
          <Link className="text-primary underline" href="/super-admin/pricing/stalled">stalled onboarding</Link>.
        </p>
      </div>
      <div className="flex flex-wrap gap-2">
        {tab(undefined, "All")}
        {tab("new", STAGE_LABEL.new)}
        {tab("followed_up", STAGE_LABEL.followed_up)}
        {tab("firm_unpaid", STAGE_LABEL.firm_unpaid)}
        {tab("paid", STAGE_LABEL.paid)}
      </div>
      {rows.length === 0 ? (
        <InlineEmpty message="No quotes yet." />
      ) : (
        <div className="table-scroll card-surface">
          <table className="table-modern w-full text-sm">
            <caption className="sr-only">Pricing quotes, newest first</caption>
            <thead>
              <tr>
                <th scope="col">When</th>
                <th scope="col">Who</th>
                <th scope="col" className="text-right">AUM</th>
                <th scope="col" className="text-right">Users</th>
                <th scope="col">Chosen</th>
                <th scope="col">Outcome</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const cycle = parseCycle(r.chosen_cycle);
                const chosen = cycle ? r.quote?.cycles?.find((c) => c.cycle === cycle) : null;
                const stage = quoteStage({ paidAt: r.paid_at, convertedTenantId: r.converted_tenant_id, followupSentAt: r.followup_sent_at });
                return (
                  <tr key={r.id}>
                    <td className="whitespace-nowrap">{formatDate(r.created_at, "dateTime")}</td>
                    <td>
                      <div className="font-medium">{r.firm_name}</div>
                      <div className="text-xs text-muted-foreground">
                        {r.contact_name} · {r.email} · {r.mobile}
                        {r.arn ? ` · ${r.arn}` : ""}
                      </div>
                    </td>
                    <td className="text-right tabular-nums whitespace-nowrap">
                      ₹{Number(r.aum_crore).toLocaleString("en-IN")} Cr
                      <div className="text-xs text-muted-foreground">{r.quote?.tierLabel ?? ""}</div>
                    </td>
                    <td className="text-right tabular-nums">{r.users}</td>
                    <td className="whitespace-nowrap">
                      {cycle ? (
                        <>
                          {cycleLabel(cycle, chosen?.months)}
                          {chosen && <div className="text-xs text-muted-foreground">{inr(chosen.totalPaise)}</div>}
                        </>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td>
                      {stage === "paid" ? (
                        <Badge tone="success" raw>{STAGE_LABEL.paid} {formatDate(r.paid_at!)}</Badge>
                      ) : stage === "firm_unpaid" ? (
                        <Badge tone="warning" raw>{STAGE_LABEL.firm_unpaid}</Badge>
                      ) : stage === "followed_up" ? (
                        <Badge tone="info" raw>{STAGE_LABEL.followed_up} {formatDate(r.followup_sent_at!)}</Badge>
                      ) : (
                        <Badge tone="neutral" raw>{STAGE_LABEL.new}</Badge>
                      )}
                      <div className="text-xs text-muted-foreground mt-1">Mobile {r.mobile_verified_at ? "verified" : "not verified"}</div>
                      {r.converted_tenant_id && (
                        <div className="text-xs mt-1">
                          <Link className="text-primary underline" href={`/super-admin/tenants/${r.converted_tenant_id}`}>
                            {r.tenant_name ?? "Open firm"}
                          </Link>
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
