import Link from "next/link";
import { notFound } from "next/navigation";
import { and, desc, eq, sql } from "drizzle-orm";
import { ChevronLeft, Phone, Mail, MessageCircle, MapPin, AlertTriangle, User2 } from "lucide-react";
import { withTenant } from "@/db/client";
import {
  investors,
  folios,
  sips,
  goals,
  communications,
  tasks,
  serviceRequests,
  consents,
  auditLog,
  users,
  families,
} from "@/db/schema";
import { requireSession } from "@/lib/auth/session";
import { formatINR, formatDate, formatRelative } from "@/lib/utils";
import { InvestorEditPanel } from "@/components/investors/InvestorEditPanel";

export const dynamic = "force-dynamic";

export default async function InvestorDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await requireSession();

  const data = await withTenant(session.tenantId, async (tx) => {
    const inv = (await tx.select().from(investors).where(eq(investors.id, id)).limit(1))[0];
    if (!inv) return null;

    const [foliosRows, sipsRows, goalsRows, commsRows, tasksRows, srRows, consentsRows, rmRow, familyRow, lumpsumSum] = await Promise.all([
      tx.select().from(folios).where(eq(folios.investorId, id)),
      tx.select().from(sips).where(eq(sips.investorId, id)),
      tx.select().from(goals).where(eq(goals.investorId, id)),
      tx
        .select()
        .from(communications)
        .where(eq(communications.investorId, id))
        .orderBy(desc(communications.createdAt))
        .limit(10),
      tx
        .select()
        .from(tasks)
        .where(and(eq(tasks.subjectId, id), eq(tasks.subjectType, "investor")))
        .limit(20),
      tx.select().from(serviceRequests).where(eq(serviceRequests.investorId, id)).limit(20),
      tx.select().from(consents).where(eq(consents.investorId, id)),
      inv.rmId
        ? tx.select({ id: users.id, name: users.name, email: users.email }).from(users).where(eq(users.id, inv.rmId)).limit(1).then((r) => r[0] ?? null)
        : Promise.resolve(null),
      inv.familyId
        ? tx.select().from(families).where(eq(families.id, inv.familyId)).limit(1).then((r) => r[0] ?? null)
        : Promise.resolve(null),
      tx.execute(sql`
        SELECT COALESCE(SUM(amount::numeric), 0)::numeric AS total
        FROM transactions
        WHERE investor_id = ${id} AND type = 'lumpsum' AND status = 'successful'
      `).then((r) => Number((r.rows[0] as any)?.total ?? 0)),
    ]);

    // PII access log (DPDP)
    await tx.insert(auditLog).values({
      tenantId: session.tenantId,
      actorUserId: session.userId,
      actorType: "user",
      action: "investor.view",
      entityType: "investor",
      entityId: id,
      piiAccessed: { pan: true, dob: !!inv.dob, address: !!inv.address } as any,
      reason: "Investor 360 view",
    } as any);

    return {
      investor: inv,
      folios: foliosRows,
      sips: sipsRows,
      goals: goalsRows,
      communications: commsRows,
      tasks: tasksRows,
      serviceRequests: srRows,
      consents: consentsRows,
      rm: rmRow,
      family: familyRow,
      totalLumpsum: lumpsumSum,
    };
  }, { userId: session.userId, branchId: session.branchId, roles: session.roles });

  if (!data) notFound();

  const inv = data.investor;

  return (
    <div className="space-y-6 max-w-7xl">
      <div className="flex items-center justify-between">
        <Link
          href="/dashboard/investors"
          className="text-sm text-muted-foreground hover:underline flex items-center gap-1"
        >
          <ChevronLeft className="size-4" /> Back to investors
        </Link>
        <Link
          href={`/dashboard/investors/${inv.id}/review-report`}
          className="text-xs rounded-md border px-2.5 py-1 hover:bg-accent"
        >
          📄 Quarterly Review Report
        </Link>
      </div>

      {/* Header */}
      <div className="border rounded-lg bg-card p-6">
        <div className="flex items-start gap-4">
          <div className="size-16 rounded-full bg-primary/10 grid place-items-center text-xl font-bold flex-shrink-0">
            {inv.name
              .split(" ")
              .map((n) => n[0])
              .slice(0, 2)
              .join("")
              .toUpperCase()}
          </div>
          <div className="flex-1 min-w-0">
            <h1 className="text-2xl font-bold tracking-tight">{inv.name}</h1>
            <div className="flex items-center gap-4 mt-1 text-sm text-muted-foreground">
              <span className="font-mono">{inv.pan}</span>
              {inv.segmentTag && (
                <span className="text-xs px-2 py-0.5 rounded-full bg-violet-50 text-violet-700">
                  {inv.segmentTag}
                </span>
              )}
              <span
                className={`text-xs px-2 py-0.5 rounded-full ${
                  inv.kycStatus === "verified"
                    ? "bg-emerald-50 text-emerald-700"
                    : "bg-amber-50 text-amber-700"
                }`}
              >
                KYC: {inv.kycStatus}
              </span>
              <span className="text-xs">Onboarded {inv.onboardedAt ? formatDate(inv.onboardedAt) : "—"}</span>
            </div>
            <div className="flex gap-3 mt-3 text-sm">
              {inv.phone && (
                <a href={`tel:${inv.phone}`} className="flex items-center gap-1.5 text-muted-foreground hover:text-foreground">
                  <Phone className="size-4" /> {inv.phone}
                </a>
              )}
              {inv.email && (
                <a href={`mailto:${inv.email}`} className="flex items-center gap-1.5 text-muted-foreground hover:text-foreground">
                  <Mail className="size-4" /> {inv.email}
                </a>
              )}
              {inv.whatsappPhone && (
                <a
                  href={`https://wa.me/${inv.whatsappPhone.replace(/[^\d]/g, "")}`}
                  target="_blank"
                  rel="noreferrer"
                  className="flex items-center gap-1.5 text-muted-foreground hover:text-foreground"
                >
                  <MessageCircle className="size-4" /> WhatsApp
                </a>
              )}
              {inv.address && (inv.address as any).city && (
                <span className="flex items-center gap-1.5 text-muted-foreground">
                  <MapPin className="size-4" /> {(inv.address as any).city}, {(inv.address as any).state}
                </span>
              )}
            </div>
          </div>
          <div className="grid grid-cols-3 gap-4 text-right">
            <div>
              <div className="text-xs text-muted-foreground">AUM</div>
              <div className="text-xl font-bold">{formatINR(Number(inv.aum ?? 0))}</div>
            </div>
            <div>
              <div className="text-xs text-muted-foreground">Active SIP</div>
              <div className="text-xl font-bold">{formatINR(Number(inv.activeSipAmount ?? 0))}</div>
            </div>
            <div>
              <div className="text-xs text-muted-foreground">Lifetime inflow</div>
              <div className="text-xl font-bold">{formatINR(Number(inv.lifetimeInflow ?? 0))}</div>
            </div>
          </div>
        </div>
      </div>

      {/* Risk + meta — at-a-glance status */}
      <div className="grid grid-cols-4 gap-4">
        <InfoCard label="Risk profile" value={inv.riskProfile ?? "Not assessed"} sub={inv.riskProfileSignedAt ? `Signed ${formatDate(inv.riskProfileSignedAt)}` : "Pending"} tone={!inv.riskProfile ? "warn" : undefined} />
        <InfoCard label="Nominee" value={inv.nomineeName ?? "Not set"} sub={inv.nomineeRelation ?? undefined} tone={!inv.nomineeName ? "warn" : undefined} />
        <InfoCard label="CKYC expiry" value={inv.ckycExpiryAt ? formatDate(inv.ckycExpiryAt) : "—"} sub={inv.ckycNumber ?? undefined} />
        <InfoCard label="Last review" value={inv.lastReviewAt ? formatRelative(inv.lastReviewAt) : "Never"} sub={inv.nextReviewAt ? `Next: ${formatDate(inv.nextReviewAt)}` : undefined} tone={!inv.lastReviewAt ? "warn" : undefined} />
      </div>

      {/* Inline-editable form — falls through to read-only Master record below */}
      <InvestorEditPanel investor={JSON.parse(JSON.stringify(inv))} />

      {/* ----------------------------- Master record -----------------------------
        Every field the spec calls out under § 6 Module 4 Client Master, grouped
        logically so RM/back-office can scan it in one read.
      */}
      <div className="border rounded-lg bg-card p-5">
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-semibold flex items-center gap-2">
            <User2 className="size-4" /> Master record
          </h2>
          <span className="text-xs text-muted-foreground">
            Client ID <code className="font-mono">{inv.id.slice(0, 8)}…</code>
          </span>
        </div>

        <Group title="Identity">
          <KV label="Client ID" value={inv.id} mono />
          <KV label="PAN" value={inv.pan} mono />
          <KV label="Name" value={inv.name} />
          <KV label="DOB" value={inv.dob ? formatDate(inv.dob) : "—"} />
          <KV label="Gender" value={inv.gender === "M" ? "Male" : inv.gender === "F" ? "Female" : inv.gender === "O" ? "Other" : "—"} />
          <KV label="Client since" value={inv.onboardedAt ? formatDate(inv.onboardedAt) : "—"} />
        </Group>

        <Group title="Contact">
          <KV label="Mobile" value={inv.phone ?? "—"} />
          <KV label="Alternate mobile" value={inv.alternatePhone ?? "—"} />
          <KV label="Email" value={inv.email ?? "—"} />
          <KV label="WhatsApp" value={inv.whatsappPhone ?? "—"} />
          <KV
            label="Address"
            value={
              inv.address
                ? [
                    (inv.address as any).line1,
                    (inv.address as any).city,
                    (inv.address as any).state,
                    (inv.address as any).pincode,
                  ]
                    .filter(Boolean)
                    .join(", ") || "—"
                : "—"
            }
            colSpan={2}
          />
          <KV label="City" value={(inv.address as any)?.city ?? "—"} />
          <KV label="State" value={(inv.address as any)?.state ?? "—"} />
        </Group>

        <Group title="Profile">
          <KV label="Occupation" value={inv.occupation ?? "—"} />
          <KV label="Income range" value={inv.incomeRange ?? "—"} />
          <KV label="Client category" value={(inv.investorCategory ?? "—").replace("corporate", "Company")} cap />
          <KV label="Client type" value={inv.segmentTag ?? "—"} />
          <KV label="Assigned RM" value={data.rm?.name ?? "—"} sub={data.rm?.email} />
          <KV label="Family group" value={data.family?.familyName ?? "—"} sub={inv.familyRole ?? undefined} />
        </Group>

        <Group title="Compliance status">
          <Status label="KYC status" value={inv.kycStatus} good={inv.kycStatus === "verified"} />
          <Status label="Risk profile" value={inv.riskProfile ?? "not_assessed"} good={!!inv.riskProfile && !!inv.riskProfileSignedAt} />
          <Status label="Nominee" value={inv.nomineeName ? "set" : "missing"} good={!!inv.nomineeName} />
          <Status label="Bank details" value={inv.bankAccountNumberMasked ? "captured" : "missing"} good={!!inv.bankAccountNumberMasked} />
          <KV label="UCC (BSE)" value={inv.bseUccCode ?? "—"} mono />
          <KV label="CAN (NSE)" value={inv.nseCanCode ?? "—"} mono />
          <Status label="Mandate" value={inv.mandateStatus ?? "none"} good={inv.mandateStatus === "active"} />
          <KV label="Mandate ref" value={inv.mandateRefNo ?? "—"} mono />
        </Group>

        <Group title="Financials">
          <KV label="Current AUM" value={formatINR(Number(inv.aum ?? 0))} highlight />
          <KV label="Monthly SIP" value={formatINR(Number(inv.activeSipAmount ?? 0))} highlight />
          <KV label="Total lumpsum" value={formatINR(data.totalLumpsum)} sub="Successful purchases" />
          <KV label="Lifetime inflow" value={formatINR(Number(inv.lifetimeInflow ?? 0))} />
          <KV label="Lifetime outflow" value={formatINR(Number(inv.lifetimeOutflow ?? 0))} />
          <KV label="Service tier" value={inv.serviceTier ?? "—"} />
        </Group>

        <Group title="Review & lifecycle">
          <KV label="Last review" value={inv.lastReviewAt ? formatDate(inv.lastReviewAt) : "Never"} sub={inv.lastReviewAt ? formatRelative(inv.lastReviewAt) : undefined} />
          <KV label="Next review" value={inv.nextReviewAt ? formatDate(inv.nextReviewAt) : "—"} sub={inv.nextReviewAt ? formatRelative(inv.nextReviewAt) : undefined} />
          <KV label="Last transaction" value={inv.lastTransactionAt ? formatRelative(inv.lastTransactionAt) : "Never"} />
          <Status
            label="Client status"
            value={inv.status}
            good={inv.status === "active"}
            warn={inv.status === "dormant" || inv.status === "inactive"}
            bad={inv.status === "redemption_risk" || inv.status === "closed" || inv.status === "exited"}
          />
          {inv.status === "redemption_risk" && inv.redemptionRiskReason && (
            <KV label="Redemption-risk reason" value={inv.redemptionRiskReason} colSpan={2} />
          )}
        </Group>

        {inv.notes && (
          <div className="mt-4 pt-4 border-t">
            <div className="text-xs text-muted-foreground mb-1">Notes</div>
            <p className="text-sm whitespace-pre-wrap">{inv.notes}</p>
          </div>
        )}
      </div>

      <div className="grid grid-cols-3 gap-6">
        {/* Folios + SIPs */}
        <div className="col-span-2 space-y-6">
          <Section title="Folios" count={data.folios.length}>
            {data.folios.length === 0 ? (
              <EmptyRow text="No folios yet." />
            ) : (
              <table className="w-full text-sm">
                <thead className="text-xs text-muted-foreground border-b">
                  <tr>
                    <th className="text-left py-2 font-medium">AMC</th>
                    <th className="text-left py-2 font-medium">Folio #</th>
                    <th className="text-left py-2 font-medium">RTA</th>
                    <th className="text-right py-2 font-medium">AUM</th>
                  </tr>
                </thead>
                <tbody>
                  {data.folios.map((f) => (
                    <tr key={f.id} className="border-b last:border-0">
                      <td className="py-2">{f.amcName}</td>
                      <td className="py-2 font-mono text-xs">{f.folioNumber}</td>
                      <td className="py-2 text-xs uppercase text-muted-foreground">{f.rta}</td>
                      <td className="py-2 text-right tabular-nums">{formatINR(Number(f.aum ?? 0))}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Section>

          <Section title="Active SIPs" count={data.sips.filter((s) => s.status === "active").length}>
            {data.sips.length === 0 ? (
              <EmptyRow text="No SIPs yet." />
            ) : (
              <ul className="divide-y">
                {data.sips.map((s) => (
                  <li key={s.id} className="py-2.5 flex items-center justify-between">
                    <div>
                      <div className="font-medium text-sm">{s.schemeName ?? s.schemeCode}</div>
                      <div className="text-xs text-muted-foreground">{s.frequency} · day {s.sipDate}</div>
                    </div>
                    <div className="text-right">
                      <div className="font-medium tabular-nums">{formatINR(Number(s.amount))}</div>
                      <div
                        className={`text-xs ${
                          s.status === "active" ? "text-emerald-600" : "text-muted-foreground"
                        }`}
                      >
                        {s.status}
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Section>

          <Section title="Goals" count={data.goals.length}>
            {data.goals.length === 0 ? (
              <EmptyRow text="No goals set." />
            ) : (
              <ul className="space-y-3">
                {data.goals.map((g) => {
                  const pct = Number(g.progressPct ?? 0);
                  return (
                    <li key={g.id}>
                      <div className="flex items-center justify-between text-sm">
                        <div className="font-medium">{g.name}</div>
                        <div className="text-muted-foreground tabular-nums">
                          {formatINR(Number(g.currentValue ?? 0))} / {formatINR(Number(g.targetAmount))}
                        </div>
                      </div>
                      <div className="mt-1.5 h-1.5 bg-muted rounded-full overflow-hidden">
                        <div
                          className="h-full bg-emerald-500"
                          style={{ width: `${Math.min(100, pct)}%` }}
                        />
                      </div>
                      <div className="text-xs text-muted-foreground mt-1">
                        {pct.toFixed(0)}% · target {formatDate(g.targetDate)} · {g.category}
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </Section>

          <Section title="Recent communications" count={data.communications.length}>
            {data.communications.length === 0 ? (
              <EmptyRow text="No communications yet." />
            ) : (
              <ul className="divide-y">
                {data.communications.map((c) => (
                  <li key={c.id} className="py-2.5 flex items-center justify-between text-sm">
                    <div>
                      <span className="uppercase text-xs font-medium text-muted-foreground mr-2">
                        {c.channel}
                      </span>
                      <span className="font-mono text-xs text-muted-foreground">{c.templateKey ?? "—"}</span>
                      <span className="ml-2 text-xs">{c.status}</span>
                    </div>
                    <span className="text-xs text-muted-foreground">{formatRelative(c.createdAt)}</span>
                  </li>
                ))}
              </ul>
            )}
          </Section>
        </div>

        {/* Side panel */}
        <aside className="space-y-6">
          <Section title="Open tasks" count={data.tasks.filter((t) => t.status === "open").length}>
            {data.tasks.filter((t) => t.status === "open").length === 0 ? (
              <EmptyRow text="No open tasks." />
            ) : (
              <ul className="space-y-2">
                {data.tasks
                  .filter((t) => t.status === "open")
                  .slice(0, 5)
                  .map((t) => (
                    <li key={t.id} className="text-sm">
                      <div className="font-medium">{t.title}</div>
                      <div className="text-xs text-muted-foreground mt-0.5">
                        {t.priority} · {t.dueAt ? formatRelative(t.dueAt) : "no due"}
                      </div>
                    </li>
                  ))}
              </ul>
            )}
          </Section>

          <Section title="Service requests" count={data.serviceRequests.filter((s) => s.status !== "closed" && s.status !== "resolved").length}>
            {data.serviceRequests.length === 0 ? (
              <EmptyRow text="No tickets." />
            ) : (
              <ul className="space-y-2">
                {data.serviceRequests.slice(0, 5).map((s) => (
                  <li key={s.id} className="text-sm">
                    <div className="font-medium">{s.subject}</div>
                    <div className="text-xs text-muted-foreground mt-0.5">
                      #{s.ticketNo} · {s.status}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Section>

          <Section title="Consent matrix">
            <ul className="space-y-1 text-sm">
              {["whatsapp", "email", "sms"].map((channel) => {
                const tx = data.consents.find((c) => c.channel === channel && c.scope === "transactional");
                const mk = data.consents.find((c) => c.channel === channel && c.scope === "marketing");
                return (
                  <li key={channel} className="flex items-center justify-between py-1 border-b last:border-0">
                    <span className="capitalize">{channel}</span>
                    <div className="flex gap-2 text-xs">
                      <ConsentChip label="Tx" granted={tx?.status === "granted"} />
                      <ConsentChip label="Mkt" granted={mk?.status === "granted"} />
                    </div>
                  </li>
                );
              })}
            </ul>
          </Section>
        </aside>
      </div>
    </div>
  );
}

function Section({ title, count, children }: { title: string; count?: number; children: React.ReactNode }) {
  return (
    <div className="border rounded-lg bg-card p-5">
      <div className="font-semibold mb-3 flex items-center justify-between">
        <span>{title}</span>
        {count !== undefined && <span className="text-xs text-muted-foreground">{count}</span>}
      </div>
      {children}
    </div>
  );
}

function InfoCard({
  label,
  value,
  sub,
  tone,
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: "warn";
}) {
  return (
    <div className={`border rounded-lg bg-card p-4 ${tone === "warn" ? "border-amber-300" : ""}`}>
      <div className="text-xs text-muted-foreground flex items-center gap-1">
        {tone === "warn" && <AlertTriangle className="size-3 text-amber-600" />}
        {label}
      </div>
      <div className="font-medium mt-1 capitalize">{value}</div>
      {sub && <div className="text-xs text-muted-foreground mt-0.5">{sub}</div>}
    </div>
  );
}

function EmptyRow({ text }: { text: string }) {
  return <div className="text-sm text-muted-foreground text-center py-6">{text}</div>;
}

function ConsentChip({ label, granted }: { label: string; granted: boolean }) {
  return (
    <span
      className={`px-1.5 py-0.5 rounded ${
        granted ? "bg-emerald-50 text-emerald-700" : "bg-muted text-muted-foreground"
      }`}
    >
      {label} {granted ? "✓" : "—"}
    </span>
  );
}

/** Master-record group header + 3-col grid for KV rows. */
function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="border-t first:border-t-0 first:pt-0 pt-4 mt-4 first:mt-0">
      <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">
        {title}
      </div>
      <div className="grid grid-cols-3 gap-x-6 gap-y-2">{children}</div>
    </div>
  );
}

function KV({
  label,
  value,
  sub,
  mono,
  cap,
  highlight,
  colSpan,
}: {
  label: string;
  value: string;
  sub?: string;
  mono?: boolean;
  cap?: boolean;
  highlight?: boolean;
  colSpan?: number;
}) {
  return (
    <div className={colSpan === 2 ? "col-span-2" : ""}>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div
        className={`text-sm mt-0.5 ${mono ? "font-mono" : ""} ${cap ? "capitalize" : ""} ${
          highlight ? "font-semibold tabular-nums" : ""
        }`}
      >
        {value || "—"}
      </div>
      {sub && <div className="text-xs text-muted-foreground mt-0.5">{sub}</div>}
    </div>
  );
}

function Status({
  label,
  value,
  good,
  warn,
  bad,
}: {
  label: string;
  value: string;
  good?: boolean;
  warn?: boolean;
  bad?: boolean;
}) {
  const cls = good
    ? "bg-emerald-50 text-emerald-700"
    : bad
    ? "bg-rose-50 text-rose-700"
    : warn
    ? "bg-amber-50 text-amber-700"
    : "bg-muted text-muted-foreground";
  return (
    <div>
      <div className="text-xs text-muted-foreground">{label}</div>
      <span className={`text-xs px-2 py-0.5 rounded-full mt-1 inline-block capitalize ${cls}`}>
        {value.replace(/_/g, " ")}
      </span>
    </div>
  );
}
