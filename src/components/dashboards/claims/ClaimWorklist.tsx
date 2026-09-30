/**
 * §4 — today's claim worklist: every open claim, or the claims a card focused
 * it on, in the brief's order: SLA breached, then high value (the CRM has no
 * priority field), then oldest, then largest. Each row answers the seven
 * questions — status, pending with, since when, what is missing, next action,
 * owner, SLA — and carries its quick actions. Phones get one card per claim.
 */

import Link from "next/link";
import { ListTodo } from "lucide-react";
import type { ClaimRec } from "@/lib/dashboard/claims/set";
import { PENDING_WITH, claimModeLabel, claimTypeLabel } from "@/lib/insurance/claims-book";
import { Section } from "@/components/dashboards/my/Shared";
import { formatCount } from "@/lib/format";
import { ClaimLink } from "./ClaimLink";
import { ClaimRowActions } from "./ClaimRowActions";
import { AgeText, amountOf, dayOf, LevelBadge, Muted, NextActionText, ownerOf, productOf, SlaText, StatusBadge, type Names } from "./parts";

const pwLabel = (c: ClaimRec) => PENDING_WITH.find((p) => p.key === c.pendingWith)?.label ?? "—";
const docsText = (c: ClaimRec) =>
  c.docState === "complete" ? "Checklist complete" : c.docState === "partial" ? `${c.checklist.filter((i) => i.have).length} of ${c.checklist.length} documents` : "No documents on file";

export function WorklistPanel({ rows, names, focusLabel, clearHref, can, limit = 40, total }: {
  rows: ClaimRec[]; names: Names; focusLabel: string | null; clearHref: string;
  can: { write: boolean; task: boolean }; limit?: number; total: number;
}) {
  const shown = rows.slice(0, limit);
  const rmLine = (c: ClaimRec) => [
    c.clientRmId ? `RM ${names.user[c.clientRmId] ?? "former user"}` : null,
    c.branchId ? names.branch[c.branchId] ?? null : "No branch",
  ].filter(Boolean).join(" · ");
  return (
    <Section title="Today's claim worklist"
      subtitle={focusLabel ? `${focusLabel} — ${formatCount(rows.length)} claim${rows.length === 1 ? "" : "s"}.` : `${formatCount(total)} open claim${total === 1 ? "" : "s"}: SLA breached first, then high value, then oldest, then largest.`}
      icon={<ListTodo className="size-4" />}
      action={focusLabel ? <Link href={clearHref} scroll={false} className="text-xs font-medium text-primary hover:underline">Show every open claim</Link> : undefined}
      note="Pending with is read from the status — the CRM has no pending-with field. The next action is the claim's earliest open follow-up; the CRM has no priority field, so high value stands in for it in the order.">
      {rows.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border px-4 py-6 text-center text-xs text-muted-foreground">{focusLabel ? "No claim matches this card today." : "No open claims."}</p>
      ) : (
        <>
          {/* Desktop — overflow-x only: .table-scroll caps the height and would hide claims below the fold. */}
          <div className="hidden md:block">
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr>
                    <th scope="col" className="whitespace-nowrap px-2">Client · claim</th>
                    <th scope="col" className="whitespace-nowrap px-2 text-right">Claim amount</th>
                    <th scope="col" className="whitespace-nowrap px-2">Status · pending with</th>
                    <th scope="col" className="whitespace-nowrap px-2 text-right">Ageing · SLA</th>
                    <th scope="col" className="whitespace-nowrap px-2">Next action</th>
                    <th scope="col" className="whitespace-nowrap px-2">Owner</th>
                    <th scope="col" className="relative px-2"><span className="sr-only">Actions</span></th>
                  </tr>
                </thead>
                <tbody>
                  {shown.map((c) => (
                    <tr key={c.id}>
                      <td className="px-2 py-2.5 text-xs">
                        <div className="flex flex-wrap items-center gap-1.5"><ClaimLink id={c.id}>{c.client}</ClaimLink> <LevelBadge level={c.level} /></div>
                        <div className="text-2xs text-foreground">{productOf(c)} · {claimTypeLabel(c.type)} · {c.insurer ?? "Insurer not recorded"}</div>
                        <div className="text-2xs text-muted-foreground">{c.policyNumber ?? "No policy number"} · {dayOf(c.openedOn)} · {claimModeLabel(c.mode)}</div>
                      </td>
                      <td className="whitespace-nowrap px-2 py-2.5 text-right text-xs tabular-nums">{amountOf(c)}{c.highValue && <div className="text-2xs text-warning-foreground">High value</div>}</td>
                      <td className="px-2 py-2.5 text-xs">
                        <StatusBadge status={c.status} />
                        <div className="mt-0.5 text-2xs text-muted-foreground" title="From the status">{pwLabel(c)} · {formatCount(c.daysInStatus)} d in status</div>
                        <div className={c.docState === "none" ? "text-2xs text-warning-foreground" : "text-2xs text-muted-foreground"}
                          title={c.docsMissing.length ? `Missing: ${c.docsMissing.join(", ")}` : undefined}>{docsText(c)}</div>
                      </td>
                      <td className="whitespace-nowrap px-2 py-2.5 text-right text-xs"><AgeText c={c} /><div className="text-2xs"><SlaText c={c} /></div></td>
                      <td className="px-2 py-2.5 text-xs"><NextActionText c={c} n={names} /></td>
                      <td className="px-2 py-2.5 text-xs">
                        <div>{ownerOf(c, names)}</div>
                        <div className="text-2xs text-muted-foreground">{rmLine(c)}</div>
                      </td>
                      <td className="px-2 py-2.5 text-right"><ClaimRowActions id={c.id} canWrite={can.write} canTask={can.task} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
          {/* Phones */}
          <ul className="space-y-2.5 md:hidden">
            {shown.map((c) => (
              <li key={c.id} className="rounded-lg border border-border bg-card p-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <ClaimLink id={c.id} className="text-left text-sm font-semibold text-foreground hover:text-primary">{c.client}</ClaimLink>
                    <div className="text-2xs text-muted-foreground">{productOf(c)} · {claimTypeLabel(c.type)} · {c.insurer ?? "Insurer not recorded"}</div>
                  </div>
                  <ClaimRowActions id={c.id} canWrite={can.write} canTask={can.task} />
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-1.5 text-xs">
                  <StatusBadge status={c.status} /> <LevelBadge level={c.level} />
                  <span className="font-semibold tabular-nums">{amountOf(c)}</span>
                </div>
                <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-2xs">
                  <div><dt className="text-muted-foreground">Pending with</dt><dd>{pwLabel(c)}</dd></div>
                  <div><dt className="text-muted-foreground">Ageing</dt><dd><AgeText c={c} /> · <SlaText c={c} /></dd></div>
                  <div><dt className="text-muted-foreground">Owner</dt><dd>{ownerOf(c, names)}</dd></div>
                  <div><dt className="text-muted-foreground">Documents</dt><dd>{docsText(c)}</dd></div>
                  <div className="col-span-2"><dt className="text-muted-foreground">Next action</dt><dd><NextActionText c={c} n={names} /></dd></div>
                </dl>
              </li>
            ))}
          </ul>
          {rows.length > limit && (
            <p className="mt-3 text-center text-2xs text-muted-foreground">
              {formatCount(rows.length - limit)} more — narrow with the filters or a card above, or <Link href="/dashboard/insurance-claims" className="font-medium text-primary hover:underline">open the claims register</Link>.
            </p>
          )}
          {rows.some((c) => c.openedOnKeyed) && <p className="mt-2 text-2xs text-muted-foreground"><Muted>Where a claim has no intimation date, its age runs from the day it was keyed.</Muted></p>}
        </>
      )}
    </Section>
  );
}
