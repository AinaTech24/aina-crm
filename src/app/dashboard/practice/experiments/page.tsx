import Link from "next/link";
import { FlaskConical, ShieldAlert } from "lucide-react";
import { PageHeaderCard } from "@/components/layout/PageHeaderCard";
import { PracticeNav } from "@/components/practice/PracticeNav";
import { ExperimentGroups } from "@/components/practice/ExperimentGroups";
import { EmptyState } from "@/components/common/EmptyState";
import { buttonClass } from "@/components/ui/button-class";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { canViewPractice } from "@/lib/practice/access";
import { TEST_CHANNELS, templatePerformance, type Channel } from "@/lib/practice/experiments";

export const dynamic = "force-dynamic";

const PERIODS = [30, 90, 180] as const;
const CHANNEL_LABEL: Record<Channel, string> = { whatsapp: "WhatsApp", email: "Email", sms: "SMS" };

function href(days: number, channel: Channel | null): string {
  const qs = new URLSearchParams();
  if (days !== 90) qs.set("days", String(days));
  if (channel) qs.set("channel", channel);
  const s = qs.toString();
  return `/dashboard/practice/experiments${s ? `?${s}` : ""}`;
}

function Seg({ items }: { items: Array<{ label: string; href: string; active: boolean }> }) {
  return (
    <div className="inline-flex flex-wrap gap-1 rounded-lg bg-secondary/70 p-1">
      {items.map((i) => (
        <Link
          key={i.href}
          href={i.href}
          aria-current={i.active ? "page" : undefined}
          className={`inline-flex h-8 items-center rounded-md px-3 text-sm ${i.active ? "bg-background font-medium text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}
        >
          {i.label}
        </Link>
      ))}
    </div>
  );
}

export default async function MessageTestsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const session = await requireSession();
  const header = (
    <>
      <PageHeaderCard
        title="Message Tests"
        subtitle="Two templates for the same purpose? See which one clients answer."
        actions={<Link href="/dashboard/templates" className={buttonClass("secondary", "sm")}>Message Templates</Link>}
      />
      <PracticeNav active="experiments" />
    </>
  );
  if (!canViewPractice(session)) {
    return (
      <div className="space-y-5">
        {header}
        <EmptyState
          icon={ShieldAlert}
          title="For the people who run the firm"
          description="Message tests are read by the owner, branch heads and compliance."
        />
      </div>
    );
  }

  const sp = await searchParams;
  const days = PERIODS.includes(Number(sp.days) as (typeof PERIODS)[number]) ? Number(sp.days) : 90;
  const channel = TEST_CHANNELS.includes(sp.channel as Channel) ? (sp.channel as Channel) : null;

  const perf = await withTenant(
    session.tenantId,
    (tx) => templatePerformance(tx, session.tenantId, { days, channel }),
    { userId: session.userId, branchId: session.branchId ?? undefined, roles: session.roles },
  );

  return (
    <div className="space-y-5">
      {header}

      <div className="flex flex-wrap items-center gap-3">
        <Seg items={PERIODS.map((d) => ({ label: `${d} days`, href: href(d, channel), active: d === days }))} />
        <Seg
          items={[
            { label: "All channels", href: href(days, null), active: channel == null },
            ...TEST_CHANNELS.map((c) => ({ label: CHANNEL_LABEL[c], href: href(days, c), active: channel === c })),
          ]}
        />
      </div>

      <p className="text-sm text-muted-foreground">
        Templates are grouped by purpose: the same key with a variant ending (<code>_v2</code>, <code>_b</code>, <code>_alt</code>) on the
        same channel. Rates are over messages that left the CRM; a channel that does not report reads or replies says so rather than showing 0%.
        A template is called better only when both have at least 30 sends and the difference is unlikely to be chance (95%).
      </p>

      {perf.groups.length ? (
        <ExperimentGroups groups={perf.groups} />
      ) : (
        <EmptyState
          icon={FlaskConical}
          title="No template sends in this period"
          description="When workflows and campaigns send through Message Templates, each template's delivery, read and reply rates appear here."
          primary={{ href: "/dashboard/templates", label: "Open Message Templates" }}
          tip="To test a message, copy a template and give the copy the same key with _v2 at the end, then send both for the same purpose."
        />
      )}

      {perf.untemplated > 0 && (
        <p className="text-xs text-muted-foreground">
          {perf.untemplated.toLocaleString("en-IN")} outbound {perf.untemplated === 1 ? "message" : "messages"} in the period had no template
          (statements, one-off messages) and are not compared.
        </p>
      )}
    </div>
  );
}
