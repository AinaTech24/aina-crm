"use client";

/**
 * §3 Today's processing queue — every open operations request, in the brief's
 * order: SLA breached, then due today, then high priority, then oldest.
 *
 * A row opens the detail drawer (§43), where the full set of actions lives —
 * assign, change status, request information, remark, complete — beside the
 * record's context. The two commonest actions (complete, remark) are also on
 * the row. Every action goes through the task API, which re-checks the
 * viewer's permission; buttons are only shown where it would pass.
 */

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Download, MessageSquarePlus, PanelRightOpen } from "lucide-react";
import type { QueueItem } from "@/lib/dashboard/ops/queue";
import { fmtIstShort, SLA_LABEL, SLA_TONE, STATUS_TONE } from "@/lib/dashboard/ops/fmt";
import { DownloadButton } from "@/components/common/SecureLinkButtons";
import { Badge } from "@/components/ui/Badge";
import { promptDialog } from "@/components/ui/ConfirmProvider";
import { notify } from "@/components/ui/Toast";
import { buttonClass } from "@/components/ui/button-class";
import { formatMoney } from "@/lib/format";
import { cn } from "@/lib/utils";
import { CompleteTaskButton } from "../desk/CompleteTaskButton";
import { OpsDrawer } from "./OpsDrawer";

const LEVEL: Record<number, { label: string; tone: "danger" | "warning" } | null> = {
  3: { label: "Escalate", tone: "danger" },
  2: { label: "Overdue", tone: "danger" },
  1: { label: "Attention", tone: "warning" },
  0: null,
};

export async function addRemark(taskId: string, body: string): Promise<boolean> {
  const res = await fetch(`/api/tasks/${taskId}/comments`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ body }),
  });
  if (!res.ok) {
    const j = await res.json().catch(() => null);
    notify.error(j?.error ?? "Could not add the remark.");
    return false;
  }
  return true;
}

export function ProcessingQueue({
  items, total, canEditAll, canEditOwn, userId, team, exportQuery, highValue,
}: {
  items: QueueItem[];
  total: number;
  canEditAll: boolean;
  canEditOwn: boolean;
  userId: string;
  team: Array<{ value: string; label: string }>;
  /** The page's filters, for the export link. */
  exportQuery: string;
  highValue: number;
}) {
  const router = useRouter();
  const [openId, setOpenId] = useState<string | null>(null);
  const [all, setAll] = useState(false);
  const shown = all ? items : items.slice(0, 25);
  const canEdit = (i: QueueItem) => canEditAll || (canEditOwn && i.assigneeId === userId);

  async function remark(i: QueueItem) {
    const body = await promptDialog({ title: "Add a remark", message: i.title, multiline: true, placeholder: "What happened, what it is waiting on…", confirmLabel: "Add remark" });
    if (!body) return;
    if (await addRemark(i.id, body)) {
      notify.success("Remark added.");
      router.refresh();
    }
  }

  return (
    <section className="card-surface p-5 sm:p-6" aria-label="Today's processing queue">
      <div className="mb-3 flex flex-wrap items-start justify-between gap-3 border-b border-border/60 pb-3">
        <h2 className="section-title min-w-0">Today&apos;s processing queue</h2>
        <div className="flex items-center gap-2">
          <DownloadButton url={`/api/ops/export?kind=pending&${exportQuery}`} filename="operations-pending.csv"
            className={buttonClass("secondary", "sm")} ariaLabel="Export the pending queue as CSV">
            <Download className="size-3.5" aria-hidden /> Export
          </DownloadButton>
          <Link href="/dashboard/tasks" className="text-xs font-medium text-primary hover:underline">All tasks ↗</Link>
        </div>
      </div>

      {items.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border px-4 py-6 text-center text-xs text-muted-foreground">
          A clear queue. New operations requests appear here the moment they are raised.
        </p>
      ) : (
        <>
          {/* Phones: one card per request, actions on the card. */}
          <ul className="space-y-2 md:hidden">
            {shown.map((i) => (
              <li key={i.id} className={cn("rounded-lg border p-3", i.level >= 2 ? "border-destructive/40" : "border-border")}>
                <button type="button" onClick={() => setOpenId(i.id)} className="block w-full text-left">
                  <div className="flex items-start justify-between gap-2">
                    <span className="text-xs font-semibold text-foreground">{i.title}</span>
                    {LEVEL[i.level] && <Badge raw tone={LEVEL[i.level]!.tone}>{LEVEL[i.level]!.label}</Badge>}
                  </div>
                  <div className="mt-0.5 text-2xs text-muted-foreground">
                    {i.kindLabel}{i.client ? ` · ${i.client}` : ""}{i.amount != null ? ` · ${formatMoney(i.amount)}` : ""}
                  </div>
                  <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-2xs">
                    <Badge raw tone={STATUS_TONE[i.status] ?? "neutral"}>{i.statusLabel}</Badge>
                    <Badge raw tone={SLA_TONE[i.slaState] ?? "neutral"}>{SLA_LABEL[i.slaState] ?? i.slaState}</Badge>
                    <span className="text-muted-foreground">{i.assignee ?? "Not assigned"} · {i.ageDays}d</span>
                  </div>
                </button>
                {canEdit(i) && (
                  <div className="mt-2 flex items-center justify-end gap-1">
                    <button type="button" onClick={() => remark(i)} aria-label={`Add a remark — ${i.title}`} title="Add remark"
                            className="inline-grid size-7 place-items-center rounded text-muted-foreground hover:bg-secondary hover:text-foreground">
                      <MessageSquarePlus className="size-3.5" />
                    </button>
                    <CompleteTaskButton taskId={i.id} title={i.title} />
                  </div>
                )}
              </li>
            ))}
          </ul>

          {/* The main queue gets a taller scroll box than the app's 30rem default. */}
          <div className="table-scroll hidden md:block" style={{ "--table-scroll-h": "48rem" } as React.CSSProperties}>
            <table className="w-full">
              <thead>
                <tr>
                  <th scope="col">Request</th>
                  <th scope="col">Client · RM · branch</th>
                  <th scope="col" className="text-right">Amount</th>
                  <th scope="col">Assigned · with</th>
                  <th scope="col">Status · due</th>
                  <th scope="col" className="relative text-right"><span className="sr-only">Actions</span></th>
                </tr>
              </thead>
              <tbody>
                {shown.map((i) => (
                  <tr key={i.id} className={cn(i.level >= 2 && "bg-destructive/5")}>
                    <td className="py-2.5">
                      <div className="w-60 whitespace-normal">
                        <button type="button" onClick={() => setOpenId(i.id)} className="block w-full text-left text-xs font-medium text-foreground hover:text-primary hover:underline">
                          {i.title}
                        </button>
                        <div className="text-2xs text-muted-foreground">
                          {i.kindLabel}{i.mode ? ` · ${i.mode}` : ""} · received {fmtIstShort(i.receivedAt)}
                        </div>
                        <div className="truncate text-2xs italic text-muted-foreground" title={i.remark ?? undefined}>{i.remark ?? "No remark yet"}</div>
                      </div>
                    </td>
                    <td className="py-2.5">
                      <div className="w-48 whitespace-normal">
                        {i.investorId ? (
                          <Link href={`/dashboard/investors/${i.investorId}`} className="text-xs font-medium hover:text-primary hover:underline">{i.client}</Link>
                        ) : <span className="text-xs text-muted-foreground">{i.client ?? "No client linked"}</span>}
                        <div className="text-2xs text-muted-foreground">{[i.rm ?? "No RM", i.branch ?? "No branch"].join(" · ")}</div>
                      </div>
                    </td>
                    <td className="whitespace-nowrap py-2.5 text-right text-xs tabular-nums">
                      {i.amount != null
                        ? <span className={cn(i.amount >= highValue && "font-semibold")}>{formatMoney(i.amount)}</span>
                        : <span className="text-muted-foreground" title="No value recorded on this request">—</span>}
                    </td>
                    <td className="py-2.5 text-xs">
                      <div className="w-36 whitespace-normal">
                        {i.assignee ?? <span className="text-warning-foreground">Not assigned</span>}
                        {i.pendingLabel && <div className="text-2xs text-muted-foreground">{i.pendingLabel}</div>}
                      </div>
                    </td>
                    <td className="py-2.5">
                      <div className="flex flex-wrap items-center gap-1">
                        <Badge raw tone={STATUS_TONE[i.status] ?? "neutral"}>{i.statusLabel}</Badge>
                        {i.slaState !== "none" && <Badge raw tone={SLA_TONE[i.slaState] ?? "neutral"}>{SLA_LABEL[i.slaState]}</Badge>}
                        {LEVEL[i.level] && <span title={i.levelWhy}><Badge raw tone={LEVEL[i.level]!.tone}>{LEVEL[i.level]!.label}</Badge></span>}
                      </div>
                      <div className="mt-1 w-52 whitespace-normal text-2xs text-muted-foreground">
                        {i.slaDue ? <>due <span className="tabular-nums text-foreground">{fmtIstShort(i.slaDue)}</span></> : "No SLA set"}
                        {" · "}{i.ageDays === 0 ? "today" : `${i.ageDays} d old`}{" · "}
                        <span className={cn(i.priority === "urgent" ? "font-semibold text-destructive" : i.priority === "high" ? "text-warning-foreground" : "")}>
                          {i.priorityLabel}
                        </span>
                      </div>
                    </td>
                    <td className="py-2.5">
                      <span className="flex items-center justify-end gap-0.5">
                        {/* The title opens the drawer; an icon is kept only for read-only viewers. */}
                        {!canEdit(i) && (
                          <button type="button" onClick={() => setOpenId(i.id)} aria-label={`Open ${i.title}`} title="Open details"
                                  className="inline-grid size-7 place-items-center rounded text-muted-foreground hover:bg-secondary hover:text-foreground">
                            <PanelRightOpen className="size-3.5" />
                          </button>
                        )}
                        {canEdit(i) && (
                          <>
                            <button type="button" onClick={() => remark(i)} aria-label={`Add a remark — ${i.title}`} title="Add remark"
                                    className="inline-grid size-7 place-items-center rounded text-muted-foreground hover:bg-secondary hover:text-foreground">
                              <MessageSquarePlus className="size-3.5" />
                            </button>
                            <CompleteTaskButton taskId={i.id} title={i.title} />
                          </>
                        )}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {(items.length > 25 || total > items.length) && (
            <div className="mt-3 flex flex-wrap items-center justify-center gap-3 text-xs">
              {items.length > 25 && (
                <button type="button" onClick={() => setAll((v) => !v)} className="font-medium text-primary hover:underline">
                  {all ? "Show the first 25" : `Show all ${items.length}`}
                </button>
              )}
              {total > items.length && <span className="text-muted-foreground">{total - items.length} more — narrow the filters or export.</span>}
            </div>
          )}
        </>
      )}
      <OpsDrawer
        id={openId}
        onClose={() => setOpenId(null)}
        canEditAll={canEditAll}
        canEditOwn={canEditOwn}
        userId={userId}
        team={team}
      />
    </section>
  );
}
