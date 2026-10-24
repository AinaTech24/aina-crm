/**
 * §14 relationship opportunities, §17 insurance view, §18 risk profiles,
 * §19 data quality, §20 contact gap.
 *
 * ── The one rule that shapes all five ───────────────────────────────────────
 *
 * A blank field is a RECORD GAP, not a fact about the client. The CRM holding
 * no policy does not establish that somebody is uninsured; it establishes that
 * nobody has captured a policy. Everything here is worded that way — "No CRM
 * record", "Not recorded", "No review date set" — and never as
 * "Needs cover" or "Uninsured".
 *
 * That is the brief's instruction and it is also the only defensible reading:
 * a dashboard that turns empty columns into sales prompts is manufacturing
 * recommendations out of missing data.
 */

import Link from "next/link";
import type { ReactNode } from "react";
import { Handshake, Shield, ShieldCheck, Database, PhoneOff } from "lucide-react";
import type { ContactGap, DataQuality, Opportunity, RiskDesk } from "@/lib/dashboard/my/clients";
import type { InsuranceView } from "@/lib/dashboard/my/pipeline";
import { CategoryTag, Figure, Num, Section, SectionLink, Stat, StatGrid, Table, Unavailable } from "./Shared";
import { formatCount, formatDate, formatMoney, formatPercent } from "@/lib/format";
import { cn } from "@/lib/utils";
import { MY_VOICE, type Voice } from "./voice";
import { ContactQuickActions } from "@/components/common/ContactQuickActions";

/* ──────────────────────────── §14 opportunities ──────────────────────────── */

export function MyOpportunities({ items, voice = MY_VOICE }: { items: Opportunity[]; voice?: Voice }) {
  return (
    <Section
      title={voice.say("Relationships requiring attention", "Relationship opportunities")}
      subtitle={voice.say(
        "Gaps the data shows on my own book — conversations to have, not products to push.",
        "Gaps the CRM records show across the branch's clients — conversations to have, not products to push.",
      )}
      icon={<Handshake className="size-4" />}
      note="These are relationship and service gaps, not product recommendations. A missing record says what the CRM holds, not what the client owns."
    >
      {items.length === 0 ? (
        <Unavailable>
          {voice.say(
            "Nothing stands out on your book right now — no clients without SIPs, overdue reviews or unconverted proposals. This fills in as the book grows.",
            "Nothing stands out in this view right now — no clients without SIPs, overdue reviews or unconverted proposals.",
          )}
        </Unavailable>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {items.map((o) => (
            <Link
              key={o.key}
              href={o.href}
              className="flex flex-col rounded-lg border border-transparent bg-secondary/70 p-4 transition-colors hover:border-primary/25 hover:bg-accent"
            >
              <div className="flex items-baseline justify-between gap-2">
                <span className="text-xs font-semibold text-foreground">{o.label}</span>
                <span className="shrink-0 text-lg font-semibold tabular-nums text-foreground">
                  {formatCount(o.count)}
                </span>
              </div>
              {o.aum != null && o.aum > 0 && (
                <span className="mt-0.5 text-2xs font-medium text-muted-foreground">
                  {formatMoney(o.aum)} of relationship value
                </span>
              )}
              {/* A gap covering the whole book is a module nobody has filled
                  in, not a list of conversations. Say which it is. */}
              {o.wholeBook && (
                <span className="mt-1.5 inline-flex w-fit rounded bg-secondary px-1.5 py-0.5 text-2xs font-medium text-secondary-foreground">
                  Every client — likely a data gap, not a per-client one
                </span>
              )}
              <p className="mt-1.5 text-2xs leading-relaxed text-muted-foreground">{o.basis}</p>
              {o.clients.length > 0 && (
                <ul className="mt-2.5 space-y-0.5 border-t border-border/60 pt-2">
                  {o.clients.map((c) => (
                    <li key={c.id} className="flex items-baseline justify-between gap-2 text-2xs">
                      <span className="truncate text-foreground">{c.name}</span>
                      {c.meta && <span className="shrink-0 text-muted-foreground">{c.meta}</span>}
                    </li>
                  ))}
                </ul>
              )}
            </Link>
          ))}
        </div>
      )}
    </Section>
  );
}

/* ──────────────────────────── §17 insurance ──────────────────────────── */

function Cell({ value }: { value: string }) {
  if (value === "No CRM record") {
    return (
      <span
        className="text-2xs text-muted-foreground"
        title="The CRM holds no policy of this kind. That is a record gap, not a statement about the client's cover."
      >
        No CRM record
      </span>
    );
  }
  return <span className="chip bg-success/10 text-success">{value}</span>;
}

export function MyInsurance({ data }: { data: InsuranceView }) {
  return (
    <Section
      title="Insurance relationship"
      subtitle="What the CRM holds for my clients — cover on record, renewals and claims."
      icon={<Shield className="size-4" />}
      action={<SectionLink href="/dashboard/insurance">Insurance module</SectionLink>}
      note="A blank column reads &ldquo;No CRM record&rdquo;, never &ldquo;needs product&rdquo;. Nothing here infers a client's suitability from an empty field."
    >
      {data.clientsWithCover == null ? (
        <Unavailable>
          None of your clients has a policy recorded in the CRM, so there is nothing to show. This
          fills in as policies are captured against clients.
        </Unavailable>
      ) : (
        <>
          <StatGrid cols={6}>
            <Stat label="Clients with cover on record" value={data.clientsWithCover} />
            <Stat label="Renewals in 30 days" value={data.renewals30} tone={data.renewals30 > 0 ? "warn" : "neutral"} href="/dashboard/insurance?due=1" />
            <Stat label="Renewals in 60 days" value={data.renewals60} />
            <Stat label="Open proposals" value={data.openProposals} />
            <Stat label="Open claims" value={data.openClaims} tone={data.openClaims > 0 ? "warn" : "neutral"} href="/dashboard/insurance-claims" />
            <Stat label="New premium this month" value={data.businessMtd} format="currency" />
            <Stat label="Renewal premium this month" value={data.renewalMtd} format="currency" hint="collected on existing cover" />
          </StatGrid>

          <div className="mt-4">
            <Table
              rows={data.rows.length}
              empty="No clients to show."
              head={
                <>
                  <th scope="col">Client</th>
                  <th scope="col">MF relationship</th>
                  <th scope="col">Life</th>
                  <th scope="col">Health</th>
                  <th scope="col">General</th>
                  <th scope="col">Next renewal</th>
                  <th scope="col">Claim status</th>
                </>
              }
            >
              {data.rows.map((r) => (
                <tr key={r.id}>
                  <td className="py-2.5">
                    <Link href={`/dashboard/investors/${r.id}`} className="font-medium hover:text-primary hover:underline">{r.client}</Link>
                  </td>
                  <td className="py-2.5">
                    {r.mf ? <span className="chip bg-secondary text-secondary-foreground">Invested</span>
                          : <span className="text-2xs text-muted-foreground">No AUM recorded</span>}
                  </td>
                  <td className="py-2.5"><Cell value={r.life} /></td>
                  <td className="py-2.5"><Cell value={r.health} /></td>
                  <td className="py-2.5"><Cell value={r.general} /></td>
                  <td className="py-2.5 text-xs">
                    {r.renewalDue ? formatDate(r.renewalDue) : <span className="text-muted-foreground">—</span>}
                  </td>
                  <td className="py-2.5">
                    {r.claimStatus
                      ? <span className={r.openClaim ? "chip bg-warning/10 text-warning-foreground" : "chip bg-secondary text-secondary-foreground"}>
                          {r.claimStatus.replace(/_/g, " ")}
                        </span>
                      : <span className="text-2xs text-muted-foreground">No claim on record</span>}
                  </td>
                </tr>
              ))}
            </Table>
          </div>
        </>
      )}
    </Section>
  );
}

/* ──────────────────────────── §18 risk profiles ──────────────────────────── */

export function MyRiskDesk({ data, voice = MY_VOICE, extra }: { data: RiskDesk; voice?: Voice; extra?: ReactNode }) {
  return (
    <Section
      title="Risk profile &amp; suitability"
      subtitle={voice.say(
        "Which of my clients have a signed profile, and which proposals are running without one.",
        "Which clients have a signed profile, and which proposals are running without one.",
      )}
      icon={<ShieldCheck className="size-4" />}
      action={<SectionLink href="/dashboard/risk-profiles">Risk profiles</SectionLink>}
      note="A client's risk category is never inferred from age, income or holdings. A missing profile shows as missing — a guessed one looks like a signed answer and is worse than a blank."
    >
      <StatGrid cols={4}>
        <Stat label="Signed profiles" value={data.completed} tone={data.completed > 0 ? "good" : "neutral"} />
        <Stat label="Not completed" value={data.pending} tone={data.pending > 0 ? "warn" : "neutral"} />
        <Stat
          label="Provisional"
          value={data.provisional}
          tone={data.provisional > 0 ? "warn" : "neutral"}
          hint="suggested, not yet confirmed by the client"
        />
        <Stat label="Due for review" value={data.dueForReview} tone={data.dueForReview > 0 ? "warn" : "neutral"} hint="signed over a year ago" />
        <Stat
          label="Proposals without suitability"
          value={data.proposalsWithoutSuitability}
          tone={(data.proposalsWithoutSuitability ?? 0) > 0 ? "bad" : "good"}
          unavailable={voice.say("You have not created a proposal yet.", "No proposal has been created in this view yet.")}
          hint="live proposal, no signed profile"
        />
      </StatGrid>

      <div className="mt-4">
        <Table
          rows={data.rows.length}
          empty={voice.say("Every client on your book has a current signed risk profile.", "Every client in this view has a current signed risk profile.")}
          head={
            <>
              <th scope="col">Client</th>
              <th scope="col">Category</th>
              <th scope="col" className="text-right">AUM</th>
              <th scope="col">Risk profile</th>
              <th scope="col">Last updated</th>
              <th scope="col">Next review</th>
              <th scope="col">Action</th>
            </>
          }
        >
          {data.rows.map((r) => (
            <tr key={r.id}>
              <td className="py-2.5">
                <Link href={`/dashboard/investors/${r.id}`} className="font-medium hover:text-primary hover:underline">{r.name}</Link>
              </td>
              <td className="py-2.5"><CategoryTag value={r.category} /></td>
              <Num>{formatMoney(r.aum)}</Num>
              <td className="py-2.5">
                <span
                  className={cn(
                    "chip",
                    r.status === "Completed" ? "bg-success/10 text-success"
                    : r.status === "Provisional" ? "bg-warning/10 text-warning-foreground"
                    : "bg-destructive/10 text-destructive",
                  )}
                >
                  {r.status}
                </span>
              </td>
              <td className="py-2.5 text-xs">
                {r.updated ? formatDate(r.updated) : <span className="text-muted-foreground">Never</span>}
              </td>
              <td className="py-2.5 text-xs">
                {/* A signed profile is re-done a year after signing. */}
                {r.updated && r.status !== "Not completed"
                  ? formatDate(new Date(new Date(r.updated).getTime() + 365 * 864e5).toISOString())
                  : <span className="text-muted-foreground">—</span>}
              </td>
              <td className="py-2.5">
                <Link href={`/dashboard/investors/${r.id}`} className="inline-flex min-h-6 items-center text-xs font-medium text-primary hover:underline">
                  {r.status === "Not completed" ? "Send questionnaire" : "Review"}
                </Link>
              </td>
            </tr>
          ))}
        </Table>
      </div>
      {extra}
    </Section>
  );
}

/* ──────────────────────── §19 data quality ──────────────────────── */

export function MyDataQuality({ data, voice = MY_VOICE, extra }: { data: DataQuality; voice?: Voice; extra?: ReactNode }) {
  const required = data.gaps.filter((g) => !g.optional);
  const optional = data.gaps.filter((g) => g.optional);
  return (
    <Section
      title={voice.say("My CRM data completion", "CRM data quality")}
      subtitle="The fields that block work when they are empty."
      icon={<Database className="size-4" />}
      action={<SectionLink href={voice.clients()}>Fix records</SectionLink>}
      note={voice.say(
        "Only fields that actually block servicing are scored — no PAN blocks a transaction, no mobile blocks a mandate, no category breaks the segmentation the rest of this page rests on. Optional fields are not counted against you.",
        "Only fields that actually block servicing are scored — no PAN blocks a transaction, no mobile blocks a mandate, no category breaks the segmentation the rest of this page rests on. Profession, company, risk profile and remarks are listed for follow-up but are optional in this CRM, so they are not counted against the score.",
      )}
    >
      <div className="flex flex-wrap items-center gap-4">
        <div className="rounded-lg bg-secondary/70 px-4 py-3">
          <div
            className={cn(
              "text-2xl font-semibold leading-none tabular-nums",
              // Incomplete data is an "attention" item (§38), never red: red is
              // kept for work that is overdue or has failed.
              data.completePct == null ? "text-muted-foreground"
              : data.completePct >= 0.9 ? "text-success"
              : "text-warning-foreground",
            )}
          >
            {data.completePct == null ? "—" : formatPercent(data.completePct * 100, 0)}
          </div>
          <div className="mt-1 text-2xs font-medium text-foreground">Complete records</div>
          <div className="text-2xs text-muted-foreground">{formatCount(data.clients)} clients checked</div>
        </div>

        {required.length === 0 ? (
          <p className="text-xs text-muted-foreground">Every checked field is filled on every client. Nothing to fix.</p>
        ) : (
          <div className="dash-stats flex-1" style={{ ["--cols-sm" as string]: Math.min(required.length, 3), ["--cols-lg" as string]: Math.min(required.length, 4) }}>
            {required.map((g) => (
              <Link
                key={g.key}
                href={g.href}
                className="rounded-lg border border-transparent bg-secondary/70 px-3 py-2 transition-colors hover:border-primary/25 hover:bg-accent"
              >
                <div className="text-base font-semibold tabular-nums text-warning-foreground">{formatCount(g.missing)}</div>
                <div className="text-2xs text-muted-foreground">missing {g.label}</div>
              </Link>
            ))}
          </div>
        )}
      </div>
      {optional.length > 0 && (
        <div className="mt-4">
          <h3 className="mb-2 text-2xs font-semibold text-muted-foreground">
            Optional fields &mdash; for follow-up, not scored
          </h3>
          <div className="dash-stats" style={{ ["--cols-sm" as string]: Math.min(optional.length, 3), ["--cols-lg" as string]: Math.min(optional.length, 4) }}>
            {optional.map((g) => (
              <Link
                key={g.key}
                href={g.href}
                className="rounded-lg border border-transparent bg-secondary/70 px-3 py-2 transition-colors hover:border-primary/25 hover:bg-accent"
              >
                <div className="text-base font-semibold tabular-nums text-foreground">{formatCount(g.missing)}</div>
                <div className="text-2xs text-muted-foreground">{g.label}</div>
              </Link>
            ))}
          </div>
        </div>
      )}
      {extra}
    </Section>
  );
}

/* ──────────────────────── §20 contact gap ──────────────────────── */

/**
 * The next step for a quiet relationship — and when NOT to call it a lapse.
 * A client whose review is booked ahead, inside their recorded review
 * cadence, is on schedule rather than neglected (§12): the gap is explained by
 * the calendar, so it reads neutral with the review date.
 */
function NextContactAction({ row }: { row: ContactGap["rows"][number] }) {
  const upcoming = row.nextReview && Date.parse(row.nextReview) >= Date.now() - 864e5;
  const withinCadence = row.cadenceDays != null && row.daysSince != null && row.daysSince <= row.cadenceDays;
  if (upcoming && (withinCadence || row.cadenceDays == null)) {
    return <span className="text-muted-foreground">On schedule — review {formatDate(row.nextReview!)}</span>;
  }
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="font-medium text-foreground">{row.daysSince == null ? "Make first contact" : "Call to reconnect"}</span>
      <ContactQuickActions phone={row.phone} email={row.email} show={["call", "whatsapp"]} logFor={{ type: "investor", id: row.id, name: row.name }} />
    </span>
  );
}

export function MyContactGap({ data, voice = MY_VOICE, extra }: { data: ContactGap; voice?: Voice; extra?: ReactNode }) {
  const total = data.bands.reduce((s, b) => s + b.clients, 0) + data.noRecord;
  return (
    <Section
      title="Client contact health"
      subtitle={voice.say(
        "How long it has been since I spoke to each client — weighted by what they are worth.",
        "How long it has been since each client heard from us — A and B clients first.",
      )}
      icon={<PhoneOff className="size-4" />}
      note="Clients with no recorded contact are counted separately rather than folded into 90+ days. A book imported last week has not neglected anybody."
    >
      <StatGrid cols={5}>
        {data.bands.map((b, i) => (
          <Stat
            key={b.key}
            label={b.label}
            value={b.clients}
            tone={b.clients === 0 ? "neutral" : i === 0 ? "good" : i === 3 ? "bad" : i === 2 ? "warn" : "neutral"}
            hint={
              b.abClients > 0 && i > 0
                ? `${b.abClients} A/B · ${formatMoney(b.aum)}`
                : b.aum > 0 ? formatMoney(b.aum) : undefined
            }
          />
        ))}
        <Stat
          label="No contact recorded"
          value={data.noRecord}
          tone={data.noRecord > 0 ? "warn" : "neutral"}
          hint="never logged, not necessarily never spoken to"
        />
      </StatGrid>

      <div className="mt-4">
        <Table
          rows={data.rows.length}
          empty="Every client has been contacted in the last 30 days."
          head={
            <>
              <th scope="col">Client</th>
              <th scope="col">Category</th>
              <th scope="col" className="text-right">AUM</th>
              {voice.showRm && <th scope="col">RM</th>}
              <th scope="col">Last interaction</th>
              <th scope="col" className="text-right">Days since</th>
              <th scope="col">Next review</th>
              <th scope="col">Next action</th>
            </>
          }
        >
          {data.rows.map((r) => {
            const ab = r.category === "A" || r.category === "B";
            return (
              <tr key={r.id}>
                <td className="py-2.5">
                  <Link href={`/dashboard/investors/${r.id}`} className="font-medium hover:text-primary hover:underline">{r.name}</Link>
                </td>
                <td className="py-2.5"><CategoryTag value={r.category} /></td>
                <Num>{formatMoney(r.aum)}</Num>
                {voice.showRm && (
                  <td className="py-2.5 text-xs">{r.rm ?? <span className="text-muted-foreground">No RM</span>}</td>
                )}
                <td className="py-2.5 text-xs">
                  {r.lastContact ? formatDate(r.lastContact) : <span className="text-muted-foreground">Not recorded</span>}
                </td>
                <Num tone={r.daysSince == null ? "neutral" : r.daysSince > 90 && ab ? "bad" : r.daysSince > 90 ? "warn" : "neutral"}>
                  {r.daysSince == null ? <span className="text-muted-foreground">—</span> : `${r.daysSince}`}
                </Num>
                <td className="py-2.5 text-xs">
                  {r.nextReview ? formatDate(r.nextReview) : <span className="text-muted-foreground">Not scheduled</span>}
                </td>
                <td className="py-2.5 text-xs">
                  <NextContactAction row={r} />
                </td>
              </tr>
            );
          })}
        </Table>
      </div>
      {total > 0 && (
        <p className="mt-2 text-2xs text-muted-foreground">
          A and B category clients are listed first — a top client silent for 100 days matters more
          than a smaller one silent for 200.
        </p>
      )}
      {extra}
    </Section>
  );
}
