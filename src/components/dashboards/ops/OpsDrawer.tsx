"use client";

/**
 * §43 Transaction detail drawer — one request with everything needed to act
 * on it, without leaving the dashboard: the request, its SLA and ageing, who
 * holds it and what it waits on, its remarks history, attachments, the client
 * context (§44 — no portfolio, masked PAN) and, for the roles that hold the
 * audit log, who changed what and when (§49).
 *
 * Actions (assign, change status, request information, remark, complete) go
 * through the existing task API, which re-checks permission on every call.
 */

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { CheckCircle2, ExternalLink, Loader2, MessageSquarePlus, Send, X } from "lucide-react";
import type { OpsItemDetail } from "@/lib/dashboard/ops/detail";
import { fmtIstDateTime, SLA_LABEL, SLA_TONE, STATUS_TONE } from "@/lib/dashboard/ops/fmt";
import { Badge } from "@/components/ui/Badge";
import { Select } from "@/components/ui/Select";
import { promptDialog } from "@/components/ui/ConfirmProvider";
import { notify } from "@/components/ui/Toast";
import { buttonClass } from "@/components/ui/button-class";
import { formatDate, formatMoney } from "@/lib/format";

async function patchTask(id: string, body: Record<string, unknown>): Promise<boolean> {
  const res = await fetch(`/api/tasks/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const j = await res.json().catch(() => null);
    notify.error(j?.error ?? "The change was not saved.");
    return false;
  }
  return true;
}
async function comment(id: string, body: string): Promise<boolean> {
  const res = await fetch(`/api/tasks/${id}/comments`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ body }),
  });
  if (!res.ok) {
    const j = await res.json().catch(() => null);
    notify.error(j?.error ?? "The remark was not saved.");
    return false;
  }
  return true;
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-5 gap-2 py-1.5">
      <dt className="col-span-2 text-2xs text-muted-foreground">{label}</dt>
      <dd className="col-span-3 text-xs text-foreground">{children}</dd>
    </div>
  );
}

export function OpsDrawer({
  id, onClose, canEditAll, canEditOwn, userId, team,
}: {
  id: string | null;
  onClose: () => void;
  canEditAll: boolean;
  canEditOwn: boolean;
  userId: string;
  team: Array<{ value: string; label: string }>;
}) {
  const router = useRouter();
  const [item, setItem] = useState<OpsItemDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  const closeRef = useRef<HTMLButtonElement>(null);

  const load = useCallback(async (taskId: string) => {
    setError(null);
    const res = await fetch(`/api/ops/items/${taskId}`, { cache: "no-store" });
    const j = await res.json().catch(() => null);
    if (!res.ok) { setError(j?.error ?? "Could not load this request."); setItem(null); return; }
    setItem(j.item as OpsItemDetail);
  }, []);

  useEffect(() => {
    setItem(null);
    setNote("");
    if (id) {
      load(id);
      closeRef.current?.focus();
    }
  }, [id, load]);

  useEffect(() => {
    if (!id) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [id, onClose]);

  if (!id) return null;
  // The task API is the gate; this only avoids offering an action it would refuse.
  const editable = !!item && (canEditAll || (canEditOwn && item.assigneeId === userId));
  const open = item != null && item.status !== "completed" && item.status !== "cancelled";

  async function act(fn: () => Promise<boolean>, done: string) {
    if (!id) return;
    setBusy(true);
    try {
      if (await fn()) {
        notify.success(done);
        await load(id);
        router.refresh();
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex justify-end" role="dialog" aria-modal="true" aria-label="Request details">
      <button type="button" className="absolute inset-0 bg-foreground/20" aria-label="Close details" onClick={onClose} />
      <div className="relative flex h-full w-full max-w-xl flex-col overflow-y-auto bg-background shadow-2xl">
        <div className="sticky top-0 z-10 flex items-start justify-between gap-3 border-b border-border bg-background px-5 py-4">
          <div className="min-w-0">
            <p className="text-xs font-medium text-muted-foreground">{item?.kindLabel ?? "Request"}</p>
            <h2 className="mt-0.5 text-base font-semibold text-foreground">{item?.title ?? "Loading…"}</h2>
          </div>
          <button ref={closeRef} type="button" onClick={onClose} aria-label="Close"
                  className="inline-grid size-8 shrink-0 place-items-center rounded-md text-muted-foreground hover:bg-secondary hover:text-foreground">
            <X className="size-4" />
          </button>
        </div>

        {error && <p className="m-5 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive">{error}</p>}
        {!item && !error && (
          <div className="flex items-center gap-2 p-5 text-xs text-muted-foreground"><Loader2 className="size-4 animate-spin" /> Loading the request…</div>
        )}

        {item && (
          <div className="space-y-5 p-5">
            <div className="rounded-lg border border-primary/20 bg-primary/5 px-3 py-2 text-xs">
              <span className="font-semibold text-foreground">Next: </span>{item.nextAction}
            </div>

            <dl className="divide-y divide-border/60">
              <Row label="Status"><Badge raw tone={STATUS_TONE[item.status] ?? "neutral"}>{item.statusLabel}</Badge></Row>
              <Row label="Pending with">{item.pendingWith ?? "—"}</Row>
              <Row label="Assigned to">{item.assignee ?? <span className="text-warning-foreground">Not assigned</span>}</Row>
              <Row label="Amount">{item.amount != null ? formatMoney(item.amount) : <span className="text-muted-foreground">Not recorded on the request</span>}</Row>
              {item.product && <Row label="Product">{item.product}</Row>}
              <Row label="Mode">{item.mode ?? <span className="text-muted-foreground">Not recorded</span>}</Row>
              <Row label="Received">{fmtIstDateTime(item.receivedAt)}{item.createdBy ? ` · by ${item.createdBy}` : ""}</Row>
              <Row label="SLA due">
                {item.slaDue ? <>{fmtIstDateTime(item.slaDue)} <Badge raw tone={SLA_TONE[item.slaState] ?? "neutral"}>{SLA_LABEL[item.slaState]}</Badge></> : "No SLA set"}
              </Row>
              <Row label="Ageing">{item.ageDays === 0 ? "Received today" : `${item.ageDays} day${item.ageDays === 1 ? "" : "s"}`}</Row>
              <Row label="Priority">{item.priorityLabel}</Row>
              <Row label="Last updated">{fmtIstDateTime(item.lastUpdated)}{item.lastUpdatedBy ? ` · ${item.lastUpdatedBy}` : ""}</Row>
              {item.completedAt && <Row label="Completed">{fmtIstDateTime(item.completedAt)}</Row>}
              {item.approvalNote && <Row label="Returned for correction">{item.approvalNote}</Row>}
            </dl>

            {editable && open && (
              <div className="space-y-3 rounded-lg border border-border p-3">
                <h3 className="text-xs font-semibold text-foreground">Actions</h3>
                <div className="flex flex-wrap items-center gap-2">
                  <Select
                    size="sm"
                    value=""
                    onChange={(v) => v && act(() => patchTask(item.id, { assigneeId: v }), "Assigned.")}
                    className="w-52"
                    ariaLabel="Assign to"
                    searchable={team.length > 8}
                    options={[{ value: "", label: "Assign to…" }, ...team]}
                  />
                  {(["open", "in_progress", "blocked"] as const).map((s) => (
                    <button key={s} type="button" disabled={busy || item.status === s}
                      onClick={() => act(() => patchTask(item.id, { status: s }), "Status updated.")}
                      className={buttonClass(item.status === s ? "primary" : "secondary", "sm")}>
                      {s === "open" ? "Not started" : s === "in_progress" ? "In process" : "Blocked"}
                    </button>
                  ))}
                </div>
                <div className="flex flex-wrap gap-2">
                  <button type="button" disabled={busy} className={buttonClass("secondary", "sm")}
                    onClick={async () => {
                      const what = await promptDialog({
                        title: "Request information",
                        message: "What is needed, and from whom? It is recorded as a remark and the request is marked Blocked.",
                        multiline: true, confirmLabel: "Record request",
                      });
                      if (!what) return;
                      await act(async () => (await comment(item.id, `Information requested: ${what}`)) && patchTask(item.id, { status: "blocked" }), "Information request recorded.");
                    }}>
                    <Send className="size-3.5" aria-hidden /> Request information
                  </button>
                  <button type="button" disabled={busy} className={buttonClass("primary", "sm")}
                    onClick={() => act(() => patchTask(item.id, { status: "completed" }), "Marked completed.")}>
                    <CheckCircle2 className="size-3.5" aria-hidden /> Mark completed
                  </button>
                </div>
                <div className="flex items-start gap-2">
                  <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} maxLength={5000}
                    placeholder="Add a remark — what happened, what it waits on…" aria-label="Remark"
                    className="input-base min-h-16 flex-1 text-xs" />
                  <button type="button" disabled={busy || !note.trim()} className={buttonClass("secondary", "sm")}
                    onClick={() => act(async () => { const ok = await comment(item.id, note.trim()); if (ok) setNote(""); return ok; }, "Remark added.")}>
                    <MessageSquarePlus className="size-3.5" aria-hidden /> Add
                  </button>
                </div>
              </div>
            )}

            {item.client && (
              <section>
                <h3 className="mb-1.5 text-xs font-semibold text-foreground">Client</h3>
                <div className="rounded-lg border border-border p-3">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <div className="text-sm font-medium text-foreground">{item.client.name ?? "—"}</div>
                      <div className="text-2xs text-muted-foreground">
                        RM {item.client.rm ?? "not mapped"} · {item.client.branch ?? "no branch"}
                        {item.client.panMasked ? ` · PAN ${item.client.panMasked}` : ""}
                      </div>
                      {(item.client.phone || item.client.email) && (
                        <div className="text-2xs text-muted-foreground">{[item.client.phone, item.client.email].filter(Boolean).join(" · ")}</div>
                      )}
                    </div>
                    {item.client.id && (
                      <Link href={`/dashboard/investors/${item.client.id}`} className="inline-flex items-center gap-1 text-2xs font-medium text-primary hover:underline">
                        Client 360 <ExternalLink className="size-3" aria-hidden />
                      </Link>
                    )}
                  </div>
                  <div className="mt-2 text-2xs text-muted-foreground">
                    {item.client.openTasks} open task{item.client.openTasks === 1 ? "" : "s"} · {item.client.openQueries} open service request{item.client.openQueries === 1 ? "" : "s"}
                  </div>
                  {item.client.transactions.length > 0 && (
                    <ul className="mt-2 divide-y divide-border/60 text-2xs">
                      {item.client.transactions.map((t, k) => (
                        <li key={k} className="flex items-center justify-between gap-2 py-1">
                          <span className="min-w-0 truncate">{formatDate(t.date)} · {t.type}{t.scheme ? ` · ${t.scheme}` : ""}</span>
                          <span className="shrink-0 tabular-nums">{t.amount != null ? formatMoney(t.amount) : "—"} · {t.status}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </section>
            )}

            <section>
              <h3 className="mb-1.5 text-xs font-semibold text-foreground">Documents</h3>
              {item.documents.length === 0
                ? <p className="text-xs text-muted-foreground">No document attached to this request.</p>
                : <ul className="space-y-1 text-xs">{item.documents.map((d, k) => <li key={k}>{d.name} <span className="text-2xs text-muted-foreground">· {fmtIstDateTime(d.at)}</span></li>)}</ul>}
            </section>

            <section>
              <h3 className="mb-1.5 text-xs font-semibold text-foreground">Remarks history</h3>
              {item.remarks && <p className="mb-2 rounded-md bg-secondary/60 px-2.5 py-1.5 text-xs">{item.remarks}</p>}
              {item.comments.length === 0
                ? <p className="text-xs text-muted-foreground">No remark recorded yet.</p>
                : (
                  <ol className="space-y-2">
                    {item.comments.map((c, k) => (
                      <li key={k} className="text-xs">
                        <div className="text-2xs text-muted-foreground">{fmtIstDateTime(c.at)} · {c.by ?? "Someone"}</div>
                        <div className="whitespace-pre-wrap text-foreground">{c.body}</div>
                      </li>
                    ))}
                  </ol>
                )}
            </section>

            <section>
              <h3 className="mb-1.5 text-xs font-semibold text-foreground">Audit trail</h3>
              {item.audit == null
                ? <p className="text-xs text-muted-foreground">Status-change history is visible to the owner and compliance.</p>
                : item.audit.length === 0
                  ? <p className="text-xs text-muted-foreground">No audited change on this request.</p>
                  : (
                    <ol className="space-y-1.5 text-xs">
                      {item.audit.map((a, k) => (
                        <li key={k}>
                          <span className="text-2xs text-muted-foreground">{fmtIstDateTime(a.at)} · {a.by ?? "System"} · </span>
                          {a.action}{a.detail ? ` — ${a.detail}` : ""}
                        </li>
                      ))}
                    </ol>
                  )}
            </section>

            <Link href={`/dashboard/tasks?task=${item.id}`} className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline">
              Open the full task <ExternalLink className="size-3" aria-hidden />
            </Link>
          </div>
        )}
      </div>
    </div>
  );
}
