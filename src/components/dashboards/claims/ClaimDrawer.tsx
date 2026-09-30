"use client";

/**
 * §55–58 — one claim, without leaving the dashboard: what it is, where it is,
 * with whom, since when, what is missing and what happens next; the lifecycle
 * with exact times; the communication log; Policy 360 and Client 360; the
 * audit trail. And the four things the claims team does to a claim:
 * change its status, give it an owner, schedule its next action, record a
 * settlement — each through the claim's own API and its own permissions
 * (insurance.write; task rules for follow-ups).
 *
 * Read through /api/claims-control/:id, which applies the dashboard's scope.
 */

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { CheckCircle2, Circle, CircleDashed, ExternalLink, Loader2, Minus, X } from "lucide-react";
import type { ClaimDetail } from "@/lib/dashboard/claims/detail";
import { CLAIM_STATUS_LABEL, PENDING_WITH, claimModeLabel, claimTypeLabel } from "@/lib/insurance/claims-book";
import { GROUP_LABEL, policyTypeLabel } from "@/lib/insurance/book";
import { Button } from "@/components/ui/Button";
import { Field } from "@/components/ui/Field";
import { Select } from "@/components/ui/Select";
import { DateField } from "@/components/ui/DateField";
import { useToast } from "@/components/ui/Toast";
import { formatMoney } from "@/lib/format";
import { cn } from "@/lib/utils";
import { CLAIM_OPEN_EVENT, openClaim, type ClaimAction } from "./ClaimLink";
import { dayOf, LevelBadge, StatusBadge, timeOf } from "./parts";

type Opt = { value: string; label: string };
const STATUS_OPTS: Opt[] = Object.entries(CLAIM_STATUS_LABEL).filter(([k]) => k !== "empty").map(([value, label]) => ({ value, label }));

export function ClaimDrawer({ can, staff, me, highValue }: {
  can: { write: boolean; task: boolean; taskAll: boolean; client360: boolean };
  staff: Opt[];
  me: string;
  highValue: number;
}) {
  const router = useRouter();
  const toast = useToast();
  const [req, setReq] = useState<{ id: string; action?: ClaimAction } | null>(null);
  const [data, setData] = useState<ClaimDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<ClaimAction | null>(null);
  const [busy, setBusy] = useState(false);
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const onOpen = (e: Event) => {
      const d = (e as CustomEvent).detail as { id: string; action?: ClaimAction };
      setReq({ id: d.id, action: d.action });
      setTab(d.action ?? null);
    };
    window.addEventListener(CLAIM_OPEN_EVENT, onOpen);
    return () => window.removeEventListener(CLAIM_OPEN_EVENT, onOpen);
  }, []);

  const load = useCallback((id: string) => {
    setError(null);
    return fetch(`/api/claims-control/${id}?hv=${highValue}`)
      .then(async (r) => {
        const j = await r.json().catch(() => null);
        if (!r.ok) setError(j?.error ?? "Could not load this claim.");
        else setData(j as ClaimDetail);
      })
      .catch(() => setError("Could not load this claim."));
  }, [highValue]);

  useEffect(() => {
    if (!req) return;
    setData(null);
    load(req.id);
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setReq(null);
    window.addEventListener("keydown", onKey);
    closeRef.current?.focus();
    return () => window.removeEventListener("keydown", onKey);
  }, [req, load]);

  async function send(url: string, method: "PATCH" | "POST", body: unknown, ok: string) {
    setBusy(true);
    try {
      const r = await fetch(url, { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error ?? "The change was not saved.");
      toast.success(ok);
      setTab(null);
      if (req) await load(req.id);
      router.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "The change was not saved.", "Not saved");
    } finally {
      setBusy(false);
    }
  }

  if (!req) return null;
  const c = data?.claim;
  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-foreground/20" onClick={() => setReq(null)}>
      <aside role="dialog" aria-modal="true" aria-label="Claim" className="h-full w-full max-w-2xl overflow-y-auto bg-card shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="sticky top-0 z-10 flex items-start justify-between gap-3 border-b border-border bg-card px-5 py-4">
          <div className="min-w-0">
            <div className="text-2xs font-semibold text-muted-foreground">Insurance claim</div>
            <h2 className="truncate text-base font-semibold text-foreground">{c?.client ?? (error ? "Claim" : "Loading…")}</h2>
            {c && (
              <div className="mt-1 flex flex-wrap items-center gap-1.5 text-2xs text-muted-foreground">
                <StatusBadge status={c.status} />
                <LevelBadge level={c.level} />
                {c.legal && <span className="chip bg-destructive/10 text-destructive">Grievance</span>}
                {c.highValue && c.isOpen && <span className="chip bg-warning/15 text-warning-foreground">High value</span>}
                <span>{c.policyId ? GROUP_LABEL[c.group] ?? "Type not recognised" : "No policy linked"} · {claimTypeLabel(c.type)} · {claimModeLabel(c.mode)}</span>
              </div>
            )}
          </div>
          <button ref={closeRef} type="button" onClick={() => setReq(null)} aria-label="Close" className="btn-icon shrink-0"><X className="size-4" /></button>
        </div>

        <div className="space-y-5 px-5 py-4">
          {!data && !error && <p className="flex items-center gap-2 text-xs text-muted-foreground"><Loader2 className="size-3.5 animate-spin" /> Loading…</p>}
          {error && <p className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive">{error}</p>}
          {data && c && (
            <>
              {/* The seven questions every open claim must answer */}
              <dl className="grid grid-cols-2 gap-x-4 gap-y-2.5 text-xs sm:grid-cols-3">
                <Fact k="Claim amount" v={c.claimedMissing ? <Na>Not recorded</Na> : formatMoney(c.claimed)} />
                <Fact k="Approved amount" v={<Na title="The CRM has no approval step or approved amount">Not recorded</Na>} />
                <Fact k="Settled amount" v={c.settled > 0 ? formatMoney(c.settled) : <Na>Not recorded</Na>} />
                <Fact k="Pending with" v={c.isOpen ? <span title="Derived from the status — the CRM has no pending-with field">{PENDING_WITH.find((p) => p.key === c.pendingWith)?.label ?? "—"}</span> : <Na>Closed</Na>} />
                <Fact k="In this status since" v={`${timeOf(c.statusSince)} · ${c.daysInStatus} d`} />
                <Fact k="Ageing" v={c.ageDays != null ? `${c.ageDays} days open` : c.tatDays != null ? `Closed in ${c.tatDays} days` : "—"} />
                <Fact k="SLA due" v={c.isOpen ? <span className={cn(c.sla === "breached" && "text-destructive", c.sla === "approaching" && "text-warning-foreground")}>{dayOf(c.slaDue)}{c.sla === "breached" ? ` · breached ${c.breachDays} d` : ""}</span> : <Na>—</Na>} />
                <Fact k="Owner" v={data.names.owner ?? <span className="text-warning-foreground">Owner missing</span>} />
                <Fact k="Client RM" v={data.names.clientRm ?? <Na>{c.investorId ? "No RM" : "No client linked"}</Na>} />
                <Fact k="Branch" v={data.names.branch ?? <Na>No branch</Na>} />
                <Fact k="Insurer" v={c.insurer ?? <Na>Not recorded</Na>} />
                <Fact k="TPA" v={<Na title="The claim has no TPA field">Not recorded</Na>} />
                <Fact k="Policy number" v={c.policyNumber ?? <Na>Not recorded</Na>} />
                <Fact k="Claim number" v={<Na title="The claim has no claim-number field">Not recorded</Na>} />
                <Fact k="Claim date" v={c.intimationDate ? dayOf(c.intimationDate) : <Na title="No intimation date">Not recorded</Na>} />
                <Fact k="Documents" v={c.docState === "complete" ? "Checklist complete" : c.docState === "partial" ? `${c.checklist.filter((i) => i.have).length} of ${c.checklist.length} on file` : <span className="text-warning-foreground">None on file</span>} />
                <Fact k="Last update" v={`${timeOf(c.updatedAt)} · ${c.daysSinceUpdate} d`} />
                <Fact k="Last client update" v={c.daysSinceContact == null ? <span className="text-warning-foreground">None since intimation</span> : `${dayOf(c.lastContact)} · ${c.daysSinceContact} d`} />
              </dl>

              {/* §38 next action */}
              <div className={cn("rounded-lg border px-3 py-2.5 text-xs", c.isOpen && !c.nextAction ? "border-warning/40 bg-warning/10" : "border-border bg-secondary/40")}>
                <div className="font-semibold text-foreground">Next action</div>
                {c.nextAction ? (
                  <div className="mt-0.5">
                    {c.nextAction.title} · <span className={cn(c.actionState === "overdue" && "text-destructive", c.actionState === "today" && "text-warning-foreground")}>
                      {c.nextAction.due ? dayOf(c.nextAction.due) : "no date"}{c.actionState === "overdue" ? " (overdue)" : c.actionState === "today" ? " (today)" : ""}
                    </span> · with {data.names.actionWith ?? "someone not in the firm"}
                    {c.openTasks > 1 && <span className="text-muted-foreground"> · {c.openTasks - 1} more open</span>}
                  </div>
                ) : <div className="mt-0.5 text-muted-foreground">{c.isOpen ? "No follow-up scheduled — every open claim needs one." : "Closed."}</div>}
              </div>

              {/* Actions */}
              {can.write && (
                <div className="rounded-lg border border-border">
                  <div className="flex flex-wrap gap-1 border-b border-border p-1.5" role="tablist" aria-label="Claim actions">
                    {([["status", "Change status"], ["assign", "Assign owner"], ["follow-up", "Schedule follow-up"], ["settle", "Record settlement"]] as const)
                      .filter(([k]) => k !== "follow-up" || can.task)
                      .map(([k, label]) => (
                        <button key={k} type="button" role="tab" aria-selected={tab === k} onClick={() => setTab(tab === k ? null : k)}
                          className={cn("inline-flex min-h-7 items-center rounded-md px-2.5 text-xs font-medium", tab === k ? "bg-accent text-primary" : "text-muted-foreground hover:text-foreground")}>
                          {label}
                        </button>
                      ))}
                  </div>
                  {tab && (
                    <div className="p-3">
                      {tab === "status" && <StatusForm current={c.status} busy={busy} onSave={(s) => send(`/api/insurance-claims/${c.id}`, "PATCH", { claimStatus: s }, "Status updated.")} />}
                      {tab === "assign" && <AssignForm current={c.ownerId} staff={staff} busy={busy} onSave={(id) => send(`/api/insurance-claims/${c.id}`, "PATCH", { rmId: id }, "Owner updated.")} />}
                      {tab === "follow-up" && (
                        <FollowUpForm staff={can.taskAll ? staff : staff.filter((s) => s.value === me)} defaultAssignee={can.taskAll ? c.ownerId ?? me : me} busy={busy}
                          onSave={(b) => send(`/api/insurance-claims/${c.id}/follow-up`, "POST", b, "Follow-up scheduled.")} />
                      )}
                      {tab === "settle" && (
                        <SettleForm claimed={c.claimedMissing ? null : c.claimed} busy={busy}
                          onSave={(b) => send(`/api/insurance-claims/${c.id}`, "PATCH", b, "Settlement recorded.")} />
                      )}
                    </div>
                  )}
                </div>
              )}

              {/* §37 timeline */}
              <Block title="Claim timeline">
                <ol className="space-y-2">
                  {data.stages.map((s) => (
                    <li key={s.key} className="flex items-start gap-2.5 text-xs">
                      {s.state === "done" ? <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-success" aria-hidden />
                        : s.state === "current" ? <Circle className="mt-0.5 size-4 shrink-0 fill-primary/20 text-primary" aria-hidden />
                        : s.state === "none" ? <Minus className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
                        : <CircleDashed className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />}
                      <div className="min-w-0">
                        <div className="font-medium text-foreground">{s.label}{s.state === "current" ? <span className="ml-1.5 text-2xs text-primary">Current</span> : null}</div>
                        <div className="text-2xs text-muted-foreground">
                          {s.state === "none" ? "Not recorded — the CRM has no approval step" : s.at ? (s.exact ? timeOf(s.at) : `${dayOf(s.at)} (date on the claim)`) : "Not reached"}
                        </div>
                      </div>
                    </li>
                  ))}
                </ol>
              </Block>

              {/* §13 checklist */}
              <Block title="Document checklist" action={<Link href={`/dashboard/insurance-claims/${c.id}#documents`} className="text-2xs font-medium text-primary hover:underline">Add documents</Link>}>
                <ul className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
                  {c.checklist.map((i) => (
                    <li key={i.key} className="flex items-center gap-2 text-xs">
                      {i.have ? <CheckCircle2 className="size-3.5 shrink-0 text-success" aria-hidden /> : <Circle className="size-3.5 shrink-0 text-muted-foreground/60" aria-hidden />}
                      <span className={i.have ? "text-foreground" : "text-muted-foreground"}>{i.label}</span>
                    </li>
                  ))}
                </ul>
                <p className="mt-2 text-2xs text-muted-foreground">
                  The list follows the policy&apos;s product and the claim mode. A document sent to the insurer but not added to the claim shows as missing.
                </p>
              </Block>

              {/* Remarks */}
              <Block title="Remarks" action={<Link href={`/dashboard/insurance-claims/new?edit=${c.id}`} className="text-2xs font-medium text-primary hover:underline">Edit remarks</Link>}>
                {c.comments ? <p className="whitespace-pre-line text-xs leading-relaxed">{c.comments}</p> : <p className="text-xs text-warning-foreground">No remarks on this claim.</p>}
              </Block>

              {/* §36 communication log */}
              <Block title="Activity and communication">
                {data.log.length === 0 ? <p className="text-xs text-muted-foreground">Nothing recorded yet.</p> : (
                  <ul className="divide-y divide-border/60">
                    {data.log.map((e, i) => (
                      <li key={`${e.at}-${i}`} className="py-1.5 text-xs">
                        <div className="flex items-start justify-between gap-3">
                          <span className="font-medium text-foreground">{e.label}</span>
                          <span className="shrink-0 text-2xs text-muted-foreground">{timeOf(e.at)}</span>
                        </div>
                        {(e.by || e.detail) && <div className="text-2xs text-muted-foreground">{[e.by, e.detail].filter(Boolean).join(" · ")}</div>}
                      </li>
                    ))}
                  </ul>
                )}
              </Block>

              {/* §57 Policy 360 */}
              <Block title="Policy" action={data.policy ? <Link href={`/dashboard/insurance/${data.policy.id}`} className="text-2xs font-medium text-primary hover:underline">Policy 360</Link> : undefined}>
                {data.policy ? (
                  <>
                    <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-xs sm:grid-cols-3">
                      <Fact k="Policy number" v={data.policy.number ?? <Na>Not recorded</Na>} />
                      <Fact k="Insurer" v={data.policy.insurer ?? <Na>Not recorded</Na>} />
                      <Fact k="Product" v={`${data.policy.plan ?? "—"} · ${policyTypeLabel(data.policy.type)}`} />
                      <Fact k="Policy period" v={data.policy.start ? `${dayOf(data.policy.start)} – ${data.policy.end ? dayOf(data.policy.end) : "end not recorded"}` : <Na>Not recorded</Na>} />
                      <Fact k="Sum insured" v={data.policy.sumAssured != null ? formatMoney(data.policy.sumAssured) : <Na>Not recorded</Na>} />
                      <Fact k="Premium" v={data.policy.premium != null ? `${formatMoney(data.policy.premium)}${data.policy.frequency ? ` · ${data.policy.frequency}` : ""}` : <Na>Not recorded</Na>} />
                      <Fact k="Renewal date" v={data.policy.nextDue ? dayOf(data.policy.nextDue) : <Na>Not recorded</Na>} />
                    </dl>
                    <div className="mt-3 text-2xs font-semibold text-muted-foreground">Claims history on this policy</div>
                    {data.policyClaims.length === 0 ? <p className="mt-1 text-xs text-muted-foreground">No other claim on this policy.</p> : (
                      <ul className="mt-1 space-y-1">
                        {data.policyClaims.map((o) => (
                          <li key={o.id} className="flex items-center justify-between gap-3 text-xs">
                            <button type="button" onClick={() => openClaim(o.id)} className="text-left font-medium hover:text-primary hover:underline">{dayOf(o.openedOn)}</button>
                            <span className="flex items-center gap-2"><StatusBadge status={o.status} /> <span className="tabular-nums">{formatMoney(o.claimed)}</span></span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </>
                ) : <p className="text-xs text-warning-foreground">This claim is not linked to a policy in the CRM.</p>}
              </Block>

              {/* §56 Client 360 */}
              <Block title="Client" action={data.client && can.client360 ? <Link href={`/dashboard/investors/${data.client.id}`} className="inline-flex items-center gap-1 text-2xs font-medium text-primary hover:underline">Client 360 <ExternalLink className="size-3" aria-hidden /></Link> : undefined}>
                {data.client ? (
                  <>
                    <div className="text-xs text-muted-foreground">
                      {[data.client.category ? `Category ${data.client.category}` : "No category", data.client.rm ?? "No RM", data.client.branch ?? "No branch", data.client.phone, data.client.email].filter(Boolean).join(" · ")}
                    </div>
                    <div className="mt-2 flex flex-wrap items-center gap-2 text-2xs">
                      <Link href={`/dashboard/insurance?q=${encodeURIComponent(data.client.name)}`} className="rounded-md border border-border px-2 py-1 font-medium hover:bg-accent">Insurance policies</Link>
                      {can.client360 && <span className="text-muted-foreground">Portfolio, meetings, tasks, service requests and documents are on Client 360.</span>}
                    </div>
                    <div className="mt-3 text-2xs font-semibold text-muted-foreground">Other claims</div>
                    {data.otherClaims.length === 0 ? <p className="mt-1 text-xs text-muted-foreground">No other claim for this client.</p> : (
                      <ul className="mt-1 space-y-1">
                        {data.otherClaims.map((o) => (
                          <li key={o.id} className="flex items-center justify-between gap-3 text-xs">
                            <button type="button" onClick={() => openClaim(o.id)} className="text-left font-medium hover:text-primary hover:underline">{o.insurer ?? "Insurer not recorded"} · {dayOf(o.openedOn)}</button>
                            <span className="flex items-center gap-2"><StatusBadge status={o.status} /> <span className="tabular-nums">{formatMoney(o.claimed)}</span></span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </>
                ) : <p className="text-xs text-warning-foreground">No client is linked to this claim — only the proposer name “{c.proposer}”.</p>}
              </Block>

              {/* §58 audit trail */}
              <Block title="Audit trail">
                <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-xs sm:grid-cols-3">
                  <Fact k="Registered" v={data.audit.createdAt ? `${timeOf(data.audit.createdAt)}${data.audit.createdBy ? ` · ${data.audit.createdBy}` : ""}` : `${dayOf(c.createdOn)} · no audit record`} />
                  <Fact k="Last updated" v={data.audit.lastUpdatedAt ? `${timeOf(data.audit.lastUpdatedAt)}${data.audit.lastUpdatedBy ? ` · ${data.audit.lastUpdatedBy}` : ""}` : "—"} />
                  <Fact k="Closed" v={data.audit.closedAt ? `${timeOf(data.audit.closedAt)}${data.audit.closedBy ? ` · ${data.audit.closedBy}` : ""}` : c.isOpen ? <Na>Open</Na> : <Na title="Closed without a status change on record">No record</Na>} />
                </dl>
                <p className="mt-2 text-2xs text-muted-foreground">Status changes, remark edits and document updates are in the activity list above, each with who and when.</p>
              </Block>

              <div className="flex flex-wrap gap-2 border-t border-border pt-4">
                <Link href={`/dashboard/insurance-claims/${c.id}`} className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline">Open the claim page <ExternalLink className="size-3" aria-hidden /></Link>
              </div>
            </>
          )}
        </div>
      </aside>
    </div>
  );
}

function Fact({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-2xs text-muted-foreground">{k}</dt>
      <dd className="truncate font-medium text-foreground">{v}</dd>
    </div>
  );
}
const Na = ({ children, title }: { children: React.ReactNode; title?: string }) => <span className="font-normal text-muted-foreground" title={title}>{children}</span>;

function Block({ title, action, children }: { title: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section>
      <div className="mb-2 flex items-center justify-between gap-2">
        <h3 className="text-2xs font-semibold text-muted-foreground">{title}</h3>
        {action}
      </div>
      {children}
    </section>
  );
}

function StatusForm({ current, busy, onSave }: { current: string; busy: boolean; onSave: (s: string) => void }) {
  const [s, setS] = useState(current === "empty" ? "" : current);
  const settling = s === "settled_fully" || s === "settled_partially";
  return (
    <div className="flex flex-wrap items-end gap-2">
      <Field label="New status" className="w-56">
        {(id) => <Select id={id} value={s} onChange={setS} options={STATUS_OPTS} size="sm" ariaLabel="New status" />}
      </Field>
      <Button size="sm" disabled={busy || !s || s === current || settling} onClick={() => onSave(s)}>{busy ? "Saving…" : "Save status"}</Button>
      {settling && <p className="w-full text-2xs text-muted-foreground">Settling needs the amount and date — use Record settlement.</p>}
    </div>
  );
}

function AssignForm({ current, staff, busy, onSave }: { current: string | null; staff: Opt[]; busy: boolean; onSave: (id: string | null) => void }) {
  const [v, setV] = useState(current ?? "");
  return (
    <div className="flex flex-wrap items-end gap-2">
      <Field label="Claim owner" className="w-64">
        {(id) => <Select id={id} value={v} onChange={setV} options={staff} searchable size="sm" ariaLabel="Claim owner" />}
      </Field>
      <Button size="sm" disabled={busy || !v || v === current} onClick={() => onSave(v)}>{busy ? "Saving…" : "Assign"}</Button>
      <p className="w-full text-2xs text-muted-foreground">The owner is the claim&apos;s RM field — the person the CRM holds responsible for the claim.</p>
    </div>
  );
}

const tomorrow = () => {
  const d = new Date(Date.now() + 86_400_000);
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(d);
};

function FollowUpForm({ staff, defaultAssignee, busy, onSave }: {
  staff: Opt[]; defaultAssignee: string; busy: boolean;
  onSave: (b: { title?: string; dueDate: string; assigneeId: string; priority: string; note?: string }) => void;
}) {
  const [title, setTitle] = useState("");
  const [due, setDue] = useState(tomorrow());
  const [who, setWho] = useState(defaultAssignee);
  const [priority, setPriority] = useState("normal");
  return (
    <div className="grid gap-2 sm:grid-cols-2">
      <Field label="What needs doing" optional className="sm:col-span-2">
        {(id) => <input id={id} value={title} onChange={(e) => setTitle(e.target.value)} maxLength={300} className="input-base" placeholder="Chase the insurer for the survey report" />}
      </Field>
      <Field label="Due" required>
        {(id) => <DateField id={id} value={due} onChange={(e) => setDue(e.target.value)} size="sm" />}
      </Field>
      <Field label="With">
        {(id) => <Select id={id} value={who} onChange={setWho} options={staff} searchable size="sm" ariaLabel="Follow-up with" />}
      </Field>
      <Field label="Priority">
        {(id) => <Select id={id} value={priority} onChange={setPriority} size="sm" ariaLabel="Priority"
          options={[{ value: "low", label: "Low" }, { value: "normal", label: "Normal" }, { value: "high", label: "High" }, { value: "urgent", label: "Urgent" }]} />}
      </Field>
      <div className="flex items-end">
        <Button size="sm" disabled={busy || !due || !who} onClick={() => onSave({ title: title.trim() || undefined, dueDate: due, assigneeId: who, priority })}>
          {busy ? "Saving…" : "Schedule"}
        </Button>
      </div>
    </div>
  );
}

function SettleForm({ claimed, busy, onSave }: {
  claimed: number | null; busy: boolean;
  onSave: (b: { claimStatus: string; settledAmount: number; settlementDate: string }) => void;
}) {
  const [status, setStatus] = useState("settled_fully");
  const [amount, setAmount] = useState(claimed != null ? String(claimed) : "");
  const [date, setDate] = useState(new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date()));
  const n = Number(amount);
  return (
    <div className="grid gap-2 sm:grid-cols-3">
      <Field label="Outcome">
        {(id) => <Select id={id} value={status} onChange={setStatus} size="sm" ariaLabel="Outcome"
          options={[{ value: "settled_fully", label: "Settled fully" }, { value: "settled_partially", label: "Settled partially" }]} />}
      </Field>
      <Field label="Settled amount (₹)" required>
        {(id) => <input id={id} type="number" min={0} value={amount} onChange={(e) => setAmount(e.target.value)} className="input-base" />}
      </Field>
      <Field label="Settlement date" required>
        {(id) => <DateField id={id} value={date} onChange={(e) => setDate(e.target.value)} size="sm" />}
      </Field>
      <div className="sm:col-span-3">
        <Button size="sm" disabled={busy || !date || !Number.isFinite(n) || n <= 0} onClick={() => onSave({ claimStatus: status, settledAmount: n, settlementDate: date })}>
          {busy ? "Saving…" : "Record settlement"}
        </Button>
      </div>
    </div>
  );
}
