import { PageHeaderCard } from "@/components/layout/PageHeaderCard";
import Link from "next/link";
import { eq } from "drizzle-orm";
import { CreditCard, Package, Users, FolderOpen, HardDrive, MessageSquare, Clock, AlertTriangle, FileText, Download, CalendarClock } from "lucide-react";
import { withTenant } from "@/db/client";
import { subscriptions, packages, subscriptionEvents } from "@/db/schema";
import { desc } from "drizzle-orm";
import { requireSession } from "@/lib/auth/session";
import { formatDate, formatRelative } from "@/lib/utils";
import { BillingCycleChooser } from "@/components/billing/BillingCycleChooser";
import { AutoPaySetup } from "@/components/billing/AutoPaySetup";
import { computeAnnualAmountPaise, razorpayConfigured } from "@/lib/billing/razorpay";
import { getBillingUsage, type UsageMetric } from "@/lib/billing/usage";
import { StatusChip, type Tone } from "@/components/common/StatusChip";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { buttonClass } from "@/components/ui/button-class";
import { InlineEmpty } from "@/components/common/EmptyState";
import { AumBillingPanel } from "@/components/billing/AumBillingPanel";
import { can } from "@/lib/auth/rbac";
import { loadPricingSettings } from "@/lib/billing/pricing-settings";
import { loadAumBillingView, loadInvoices, type AumBillingView, type BillingInvoiceRow } from "@/lib/billing/billing-view";
import { CYCLE_LABEL, cycleLabel, inr } from "@/lib/billing/aum-pricing";
import { aumSourceText } from "@/lib/billing/renewal-review";

const STATUS_TONE: Record<string, Tone> = {
  trial: "info",
  active: "success",
  past_due: "warning",
  suspended: "danger",
  expired: "danger",
  cancelled: "neutral",
};

export const dynamic = "force-dynamic";

export default async function BillingPage() {
  const session = await requireSession();
  const settings = await loadPricingSettings();
  const { sub, pkg, events, usage, aum, invoices } = await withTenant(session.tenantId, async (tx) => {
    const s = (await tx.select().from(subscriptions).where(eq(subscriptions.tenantId, session.tenantId)).limit(1))[0] ?? null;
    const p = s ? (await tx.select().from(packages).where(eq(packages.id, s.packageId)).limit(1))[0] ?? null : null;
    const ev = s
      ? await tx
          .select()
          .from(subscriptionEvents)
          .where(eq(subscriptionEvents.tenantId, session.tenantId))
          .orderBy(desc(subscriptionEvents.at))
          .limit(20)
      : [];
    const u = p
      ? await getBillingUsage(tx, session.tenantId, {
          seatLimit: s?.seatsOverride ?? p.maxUsers,
          investorLimit: p.maxInvestors,
          storageGb: p.storageLimitGb,
          messageCap: Number((p.featureFlags as any)?.maxMessagesPerMonth ?? 0),
        })
      : null;
    const view = s ? await loadAumBillingView(tx, session.tenantId, settings) : null;
    const inv = await loadInvoices(tx, session.tenantId);
    return { sub: s, pkg: p, events: ev, usage: u, aum: view, invoices: inv };
  });

  const razorpayReady = await razorpayConfigured();
  const canManage = can(session.roles, "settings.billing", session.permissions);

  if (sub && aum) {
    return (
      <div className="space-y-6 max-w-5xl">
        <PageHeaderCard title={<>Billing & Subscription</>} />
        <AumStatus view={aum} />
        {aum.mode !== "pay_first" && <AumCurrent view={aum} />}
        <AumBillingPanel
          mode={aum.mode}
          cycle={aum.cycle}
          users={aum.users}
          aumCrore={aum.quoteAumCrore}
          quotes={aum.quotes}
          late={aum.late}
          canManage={canManage}
          paymentsOn={razorpayReady}
          renewalDueLabel={aum.licenseEndAt ? formatDate(aum.licenseEndAt) : null}
          scheduledChange={aum.scheduledChange}
          minUsers={settings.minUsers}
          maxUsers={settings.maxUsers}
          commitment={aum.commitment ? { months: aum.commitment.months, endsLabel: aum.commitment.endsOn ? formatDate(aum.commitment.endsOn) : null } : null}
        />
        {usage && (
          <Card>
            <CardHeader title="Plan usage" />
            <CardBody className="grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-4">
              <UsageRow icon={Users} label="Users" m={usage.users} unit="" />
              <UsageRow icon={FolderOpen} label="Clients" m={usage.investors} unit="" />
              <UsageRow icon={HardDrive} label="Storage" m={usage.storage} unit=" GB" />
              <UsageRow icon={MessageSquare} label="Messages this month" m={usage.messages} unit="" />
            </CardBody>
          </Card>
        )}
        <Invoices rows={invoices} canDownload={canManage} />
        <History events={events} />
      </div>
    );
  }

  // Trial / expiry countdown.
  const endDate = sub?.licenseEndAt ? new Date(sub.licenseEndAt) : null;
  const daysLeft = endDate ? Math.ceil((endDate.getTime() - Date.now()) / 86_400_000) : null;
  const isTrial = sub?.status === "trial";
  const nextDebit = pkg && sub ? computeAnnualAmountPaise(pkg as any, sub as any).amountPaise : 0;

  return (
    <div className="space-y-6 max-w-4xl">
      <PageHeaderCard title={<>Billing & Subscription</>} />

      {sub && pkg ? (
        <>
          {/* Trial / expiry countdown */}
          {isTrial && daysLeft != null && (
            <div className={`rounded-lg border p-4 flex items-start gap-3 ${daysLeft <= 14 ? "border-amber-300 bg-amber-50" : "border-blue-200 bg-blue-50/60"}`}>
              <Clock className={`size-5 mt-0.5 ${daysLeft <= 14 ? "text-amber-600" : "text-blue-600"}`} />
              <div className="flex-1">
                <div className="font-semibold text-sm">
                  {daysLeft > 0 ? `Your trial ends in ${daysLeft} day${daysLeft === 1 ? "" : "s"}` : "Your trial has ended"}
                  {endDate ? ` · ${formatDate(endDate)}` : ""}
                </div>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Set up auto-pay below to keep uninterrupted access — when a license lapses, the workspace is limited to
                  billing &amp; support until payment resumes.
                </p>
              </div>
              <a href="#autopay" className="btn-primary text-xs whitespace-nowrap print:hidden">Set up auto-pay</a>
            </div>
          )}

          {/* Usage vs plan limits */}
          {usage && (
            <div className="border rounded-lg bg-card p-6">
              <h2 className="font-semibold flex items-center gap-2 mb-4">Plan usage</h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-4">
                <UsageRow icon={Users} label="Users" m={usage.users} unit="" />
                <UsageRow icon={FolderOpen} label="Clients" m={usage.investors} unit="" />
                <UsageRow icon={HardDrive} label="Storage" m={usage.storage} unit=" GB" />
                <UsageRow icon={MessageSquare} label="Messages this month" m={usage.messages} unit="" />
              </div>
            </div>
          )}

          <div className="border rounded-lg bg-card p-6">
            <div className="flex items-start justify-between">
              <div>
                <div className="text-xs text-muted-foreground">Current package</div>
                <h2 className="text-xl font-bold mt-1 flex items-center gap-2">
                  <Package className="size-5" /> {pkg.name}
                </h2>
                <p className="text-sm text-muted-foreground mt-1 max-w-md">{pkg.description}</p>
              </div>
              <StatusChip tone={STATUS_TONE[sub.status] ?? "neutral"} className="text-sm px-3 py-1 capitalize">
                {sub.status}
              </StatusChip>
            </div>
            <div className="grid grid-cols-3 gap-4 mt-4 pt-4 border-t text-sm">
              <Row label="Billing cycle" value={sub.billingCycle ?? "—"} />
              <Row label="Setup (one-time)" value={`₹${(pkg.setupCostPaise / 100).toLocaleString("en-IN")}`} />
              <Row label="Users" value={String(sub.seatsOverride ?? pkg.maxUsers)} />
              <Row label="Max investors" value={String(pkg.maxInvestors)} />
              <Row label="Storage" value={`${pkg.storageLimitGb} GB`} />
              <Row label="Next renewal" value={sub.nextRenewalAt ? formatDate(sub.nextRenewalAt) : "—"} />
              <Row label="License start" value={sub.licenseStartAt ? formatDate(sub.licenseStartAt) : "—"} />
              <Row label="License end" value={sub.licenseEndAt ? formatDate(sub.licenseEndAt) : "—"} />
            </div>
          </div>

          <BillingCycleChooser
            current={sub.billingCycle === "commitment" ? null : sub.billingCycle ?? null}
            seats={sub.seatsOverride ?? pkg.maxUsers}
            monthlyPaise={pkg.monthlyPricePaise}
            yearlyPaise={pkg.yearlyPricePaise}
            perUserMonthlyPaise={pkg.perUserMonthlyPaise}
            perUserYearlyPaise={pkg.perUserYearlyPaise}
            canManage={(session.roles ?? []).includes("owner")}
          />

          <div id="autopay" className="scroll-mt-20 space-y-2">
            {nextDebit > 0 && (
              <p className="text-xs text-muted-foreground px-1">
                {(sub as any).mandateStatus === "active"
                  ? `Auto-pay is active — ₹${(nextDebit / 100).toLocaleString("en-IN")} will be debited on ${sub.nextRenewalAt ? formatDate(sub.nextRenewalAt) : "renewal"} via your saved mandate.`
                  : `Next charge: ₹${(nextDebit / 100).toLocaleString("en-IN")} on ${sub.nextRenewalAt ? formatDate(sub.nextRenewalAt) : "renewal"}. Set up auto-pay so it's collected automatically.`}
              </p>
            )}
            <AutoPaySetup
              configured={razorpayReady}
              mandateStatus={(sub as any).mandateStatus ?? "none"}
              status={sub.status}
              amountPaise={computeAnnualAmountPaise(pkg as any, sub as any).amountPaise}
              seats={computeAnnualAmountPaise(pkg as any, sub as any).seats}
              canManage={(session.roles ?? []).includes("owner")}
            />
          </div>

          <div className="border rounded-lg bg-card p-6">
            <h2 className="font-semibold">Modules enabled</h2>
            <div className="flex flex-wrap gap-2 mt-3">
              {(pkg.enabledModules as string[]).map((m) => (
                <span key={m} className="text-xs px-2 py-1 rounded bg-muted">
                  {m.replace(/_/g, " ")}
                </span>
              ))}
            </div>
          </div>

          {invoices.length > 0 && <Invoices rows={invoices} canDownload={canManage} />}

          <div className="border rounded-lg bg-card p-6">
            <h2 className="font-semibold flex items-center gap-2">
              <CreditCard className="size-4" /> Activity history
            </h2>
            {events.length === 0 ? (
              <p className="text-sm text-muted-foreground mt-3">No events yet.</p>
            ) : (
              <ul className="mt-3 space-y-2 text-sm">
                {events.map((e) => (
                  <li key={e.id} className="border-l-2 border-muted pl-3 py-1">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-medium">
                        {e.eventType.replace(/_/g, " ")}
                        {e.amountPaise != null && (
                          <span className="text-muted-foreground font-normal"> · ₹{(e.amountPaise / 100).toLocaleString("en-IN")}</span>
                        )}
                      </span>
                      <span className="flex items-center gap-2">
                        {e.amountPaise != null && (
                          <Link href={`/dashboard/billing/receipt/${e.id}`} className="text-xs text-brand-cyan-deep hover:underline inline-flex items-center gap-1">
                            <FileText className="size-3" /> Receipt
                          </Link>
                        )}
                        <span className="text-xs text-muted-foreground">{formatRelative(e.at)}</span>
                      </span>
                    </div>
                    {e.notes && <div className="text-xs text-muted-foreground mt-0.5">{e.notes}</div>}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </>
      ) : (
        <div className="border rounded-lg bg-card p-12 text-center">
          <Package className="size-12 mx-auto text-muted-foreground/50" />
          <h2 className="text-lg font-semibold mt-3">No active subscription</h2>
          <p className="text-sm text-muted-foreground mt-2">Contact AINA support to provision your license.</p>
        </div>
      )}
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="font-medium mt-0.5 capitalize">{value}</div>
    </div>
  );
}

function UsageRow({ icon: Icon, label, m, unit }: { icon: any; label: string; m: UsageMetric; unit: string }) {
  const fmt = (n: number) => n.toLocaleString("en-IN");
  const pct = m.pct;
  const tone = pct == null ? "bg-brand-cyan" : pct >= 90 ? "bg-rose-500" : pct >= 75 ? "bg-amber-500" : "bg-emerald-500";
  return (
    <div>
      <div className="flex items-center justify-between text-sm">
        <span className="flex items-center gap-1.5 text-muted-foreground">
          <Icon className="size-3.5" /> {label}
        </span>
        <span className="tabular-nums font-medium">
          {fmt(m.used)}{unit}
          {m.limit != null ? <span className="text-muted-foreground font-normal"> / {fmt(m.limit)}{unit}</span> : <span className="text-muted-foreground font-normal"> · unlimited</span>}
        </span>
      </div>
      <div className="h-2 rounded-full bg-secondary overflow-hidden mt-1.5">
        <div className={`h-full rounded-full ${tone}`} style={{ width: `${pct ?? 4}%` }} />
      </div>
      {m.limit != null && m.used > m.limit ? (
        <div className="text-2xs text-rose-600 mt-0.5">{fmt(m.used - m.limit)} over your plan — upgrade to add more</div>
      ) : pct != null && pct >= 90 && (
        <div className="text-2xs text-rose-600 mt-0.5">{pct}% used — approaching your plan limit</div>
      )}
    </div>
  );
}

const KIND_LABEL: Record<string, string> = { first: "First payment", renewal: "Renewal", late_renewal: "Late renewal" };

function AumStatus({ view }: { view: AumBillingView }) {
  const r = view.renewal;
  const c = view.commitment;
  if (c?.choiceOpen && c.endsOn) {
    return (
      <div role="status" className="rounded-xl border border-warning/50 bg-warning/5 p-4 text-sm flex items-start gap-3">
        <CalendarClock className="size-5 mt-0.5 shrink-0" />
        <div>
          <div className="font-semibold">
            Your {c.months}-month commitment ends on {formatDate(c.endsOn)} — {c.chosen ? `you chose ${CYCLE_LABEL[c.chosen].toLowerCase()}` : "choose how to continue"}
          </div>
          <p className="text-muted-foreground mt-0.5">
            {c.chosen
              ? "You can still change it below until then."
              : `Pick monthly, half-yearly or yearly below. If you do not choose, your subscription continues monthly at ${inr(c.monthlyDefaultPaise)} incl. GST.`}
          </p>
        </div>
      </div>
    );
  }
  if (view.mode === "pay_first") {
    return (
      <div role="status" className="rounded-xl border border-warning/50 bg-warning/5 p-4 text-sm flex items-start gap-3">
        <AlertTriangle className="size-5 mt-0.5 shrink-0" />
        <div>
          <div className="font-semibold">Complete your payment to open the CRM</div>
          <p className="text-muted-foreground mt-0.5">
            Your package is saved below{view.pendingCheckout ? " — a payment was started but not finished" : ""}. Until it is paid, only Billing and Support are open.
          </p>
        </div>
      </div>
    );
  }
  if (r?.phase === "grace") {
    return (
      <div role="status" className="rounded-xl border border-warning/50 bg-warning/5 p-4 text-sm flex items-start gap-3">
        <Clock className="size-5 mt-0.5 shrink-0" />
        <div>
          <div className="font-semibold">
            Your renewal was due on {formatDate(r.dueAt)} — {r.daysLeft === 0 ? "today is the last day" : `${r.daysLeft} day${r.daysLeft === 1 ? "" : "s"} left`} to renew at no extra cost
          </div>
          <p className="text-muted-foreground mt-0.5">Full access continues until {formatDate(r.graceEndsOn)}. After that the CRM is limited to Billing and Support, and the grace days are charged pro-rata.</p>
        </div>
      </div>
    );
  }
  if (r?.phase === "lapsed") {
    return (
      <div role="alert" className="rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-sm flex items-start gap-3">
        <AlertTriangle className="size-5 mt-0.5 shrink-0" />
        <div>
          <div className="font-semibold">Your renewal was not paid within the grace period</div>
          <p className="text-muted-foreground mt-0.5">Renew below to reopen the CRM. {view.late ? `It includes the ${view.late.graceDays} grace days pro-rata: ${inr(view.late.totalPaise)} incl. GST.` : ""}</p>
        </div>
      </div>
    );
  }
  return null;
}

function AumCurrent({ view }: { view: AumBillingView }) {
  const f = view.inForce;
  const n = view.nextRenewal;
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card>
        <CardHeader title="Your package" subtitle="In force for the current cycle." icon={<Package className="size-4" />} />
        <CardBody>
          <dl className="grid grid-cols-2 gap-3 text-sm">
            <Item label="Cycle" value={cycleLabel(view.inForce.quote?.cycle ?? view.cycle, view.inForce.quote?.months)} />
            <Item label="Users (seats)" value={String(view.users)} />
            <Item label="AUM tier" value={f.tierLabel ?? "—"} />
            <Item label="Per cycle, incl. GST" value={f.cycleTotalPaise != null ? inr(f.cycleTotalPaise) : "—"} />
            <Item label="Paid through" value={view.licenseEndAt ? formatDate(view.licenseEndAt) : "—"} />
            <Item label="Auto-pay" value={view.mandateStatus === "active" ? "Active" : view.mandateStatus === "none" ? "Not set up" : view.mandateStatus.replace(/_/g, " ")} />
          </dl>
          {f.aumCrore != null && (
            <p className="text-xs text-muted-foreground mt-3">
              Priced at ₹{f.aumCrore.toLocaleString("en-IN")} Cr — {f.source === "declared" ? "the AUM you declared" : `from your CRM data${f.asOf ? ` on ${formatDate(f.asOf)}` : ""}`}.
            </p>
          )}
        </CardBody>
      </Card>
      {n && (
        <Card>
          <CardHeader
            title="Your next renewal"
            subtitle={n.renewalOn ? `On ${formatDate(n.renewalOn)}${n.decided ? "" : " — re-checked 7 days before"}` : undefined}
            icon={<CalendarClock className="size-4" />}
          />
          <CardBody className="space-y-2 text-sm">
            <p>
              AUM used for your next renewal: <strong>₹{n.aum.aumCrore.toLocaleString("en-IN")} Cr</strong> ({aumSourceText(n.aum)}) → <strong>{n.tierLabel}</strong> →{" "}
              <strong>{inr(n.quote.totalPaise)}</strong> incl. GST, {CYCLE_LABEL[n.quote.cycle].toLowerCase()}.
            </p>
            {n.aum.source === "declared" && <p className="text-muted-foreground">Import your clients and RTA files and the tier follows your real AUM.</p>}
            {n.razorpayAction === "reauth_required" && (
              <p className="rounded-lg border border-warning/50 bg-warning/5 p-2">Your bank mandate cannot be moved to the new amount automatically — renew or re-authorise below when it is due.</p>
            )}
            {n.decided ? <Badge tone="info" raw>Decided — applies from the next cycle only</Badge> : <Badge tone="neutral" raw>Estimate if renewed today</Badge>}
          </CardBody>
        </Card>
      )}
    </div>
  );
}

function Item({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="font-medium mt-0.5">{value}</dd>
    </div>
  );
}

function Invoices({ rows, canDownload }: { rows: BillingInvoiceRow[]; canDownload: boolean }) {
  return (
    <Card>
      <CardHeader title="Tax invoices" subtitle="One GST tax invoice for every payment, emailed to the owner." icon={<FileText className="size-4" />} />
      <CardBody>
        {rows.length === 0 ? (
          <InlineEmpty message="No invoices yet." />
        ) : (
          <ul className="divide-y divide-border">
            {rows.map((r) => (
              <li key={r.id} className="py-3 flex flex-wrap items-center justify-between gap-2 text-sm">
                <div className="min-w-0">
                  <Link href={`/dashboard/billing/receipt/${r.id}`} className="font-medium text-primary hover:underline">{r.invoiceNo}</Link>
                  <div className="text-xs text-muted-foreground">
                    {formatDate(r.issuedAt)} · {KIND_LABEL[r.kind] ?? r.kind}
                    {r.periodStart ? ` · ${formatDate(r.periodStart)} – ${formatDate(r.periodEnd)}` : ""}
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <span className="tabular-nums font-medium">{inr(r.totalPaise)}</span>
                  {canDownload && (
                    <a className={buttonClass("ghost", "sm")} href={`/api/billing/invoices/${r.id}/pdf`}>
                      <Download className="size-4" /> PDF
                    </a>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardBody>
    </Card>
  );
}

function History({ events }: { events: Array<{ id: string; eventType: string; amountPaise: number | null; notes: string | null; at: Date }> }) {
  return (
    <Card>
      <CardHeader title="Activity history" icon={<CreditCard className="size-4" />} />
      <CardBody>
        {events.length === 0 ? (
          <InlineEmpty message="No activity yet." />
        ) : (
          <ul className="space-y-2 text-sm">
            {events.map((e) => (
              <li key={e.id} className="border-l-2 border-border pl-3 py-1">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium">
                    {e.eventType.replace(/_/g, " ")}
                    {e.amountPaise != null && <span className="text-muted-foreground font-normal"> · {inr(e.amountPaise)}</span>}
                  </span>
                  <span className="text-xs text-muted-foreground">{formatRelative(e.at)}</span>
                </div>
                {e.notes && <div className="text-xs text-muted-foreground mt-0.5">{e.notes}</div>}
              </li>
            ))}
          </ul>
        )}
      </CardBody>
    </Card>
  );
}
