"use client";

/**
 * §49 — a client's insurance relationship, from any client name on the command
 * centre. One drawer is mounted on the page; `ClientLink` opens it with an
 * event, so server-rendered tables need no client wrapper of their own.
 * Everything is read through /api/insurance/command-centre/clients/:id, which
 * applies the dashboard's scope.
 */

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { ExternalLink, Loader2, X } from "lucide-react";
import type { ClientInsurance } from "@/lib/dashboard/insurance/detail";
import { CLAIM_STATUS_LABEL } from "@/lib/insurance/book";
import { Badge } from "@/components/ui/Badge";
import { formatDate, formatMoney } from "@/lib/format";

const OPEN_EVENT = "ins:open-client";

export function ClientLink({ id, name, className }: { id: string; name: string; className?: string }) {
  return (
    <button
      type="button"
      onClick={() => window.dispatchEvent(new CustomEvent(OPEN_EVENT, { detail: id }))}
      className={className ?? "text-left text-xs font-medium text-foreground hover:text-primary hover:underline"}
    >
      {name}
    </button>
  );
}

export function InsClientDrawer({ canSeeClient360 }: { canSeeClient360: boolean }) {
  const [id, setId] = useState<string | null>(null);
  const [data, setData] = useState<ClientInsurance | null>(null);
  const [error, setError] = useState<string | null>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const onOpen = (e: Event) => setId(String((e as CustomEvent).detail));
    window.addEventListener(OPEN_EVENT, onOpen);
    return () => window.removeEventListener(OPEN_EVENT, onOpen);
  }, []);

  useEffect(() => {
    if (!id) return;
    let live = true;
    setData(null);
    setError(null);
    fetch(`/api/insurance/command-centre/clients/${id}`)
      .then(async (r) => {
        const j = await r.json().catch(() => null);
        if (!live) return;
        if (!r.ok) setError(j?.error ?? "Could not load this client.");
        else setData(j as ClientInsurance);
      })
      .catch(() => live && setError("Could not load this client."));
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setId(null);
    window.addEventListener("keydown", onKey);
    closeRef.current?.focus();
    return () => {
      live = false;
      window.removeEventListener("keydown", onKey);
    };
  }, [id]);

  if (!id) return null;
  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-foreground/20" onClick={() => setId(null)}>
      <aside
        role="dialog"
        aria-modal="true"
        aria-label="Client insurance relationship"
        className="h-full w-full max-w-xl overflow-y-auto bg-card shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sticky top-0 z-10 flex items-start justify-between gap-3 border-b border-border bg-card px-5 py-4">
          <div className="min-w-0">
            <div className="text-2xs font-semibold text-muted-foreground">Insurance relationship</div>
            <h2 className="truncate text-base font-semibold text-foreground">{data?.name ?? (error ? "Client" : "Loading…")}</h2>
            {data && (
              <div className="mt-0.5 text-2xs text-muted-foreground">
                {[data.type, data.category ? `Category ${data.category}` : "No category", data.mf ? "MF client" : "No MF relationship", data.rm ?? "No RM", data.branch ?? "No branch"].join(" · ")}
              </div>
            )}
          </div>
          <button ref={closeRef} type="button" onClick={() => setId(null)} aria-label="Close" className="btn-icon shrink-0">
            <X className="size-4" />
          </button>
        </div>

        <div className="space-y-5 px-5 py-4">
          {!data && !error && <p className="flex items-center gap-2 text-xs text-muted-foreground"><Loader2 className="size-3.5 animate-spin" /> Loading…</p>}
          {error && <p className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive">{error}</p>}
          {data && (
            <>
              <div className="flex flex-wrap items-center gap-2 text-xs">
                <span className="font-semibold tabular-nums">{formatMoney(data.inForcePremium)}</span>
                <span className="text-muted-foreground">annual premium in force</span>
                {(data.phone || data.email) && <span className="text-muted-foreground">· {[data.phone, data.email].filter(Boolean).join(" · ")}</span>}
                {canSeeClient360 && (
                  <Link href={`/dashboard/investors/${data.investorId}`} className="ml-auto inline-flex items-center gap-1 font-medium text-primary hover:underline">
                    Client 360 <ExternalLink className="size-3" aria-hidden />
                  </Link>
                )}
              </div>

              {data.partial && (
                <p className="rounded-lg border border-border bg-secondary/50 px-3 py-2 text-2xs text-muted-foreground">
                  Another RM&apos;s client. Only the policies you sold or own, and your own work on this client, are shown.
                </p>
              )}

              <Block title="Policies" empty="No policy on record.">
                {data.policies.map((p) => (
                  <li key={p.id} className="flex items-start justify-between gap-3 py-2">
                    <div className="min-w-0">
                      <Link href={`/dashboard/insurance/${p.id}`} className="text-xs font-medium hover:text-primary hover:underline">{p.plan || p.group}</Link>
                      <div className="text-2xs text-muted-foreground">
                        {[p.group, p.line, p.insurer ?? "Insurer not recorded", p.policyNumber ?? "No policy number"].join(" · ")}
                      </div>
                      <div className="text-2xs text-muted-foreground">
                        {p.bookedOn ? `Started ${formatDate(p.bookedOn)}` : "Start date not recorded"}
                        {p.inForce && p.frequency !== "single" ? ` · Renewal ${p.due ? formatDate(p.due) : "date not recorded"}` : ""}
                        {` · ${p.documents} document${p.documents === 1 ? "" : "s"}`}
                      </div>
                    </div>
                    <div className="shrink-0 text-right">
                      <div className="text-xs font-semibold tabular-nums">{formatMoney(p.premium)}</div>
                      <Badge raw tone={p.inForce ? "info" : p.status === "lapsed" || p.status === "cancelled" || p.status === "surrendered" ? "danger" : "neutral"}>{p.statusLabel}</Badge>
                    </div>
                  </li>
                ))}
              </Block>

              <Block title="Claims" empty="No claim on record.">
                {data.claims.map((c) => (
                  <li key={c.id} className="flex items-start justify-between gap-3 py-2">
                    <div className="min-w-0 text-xs">
                      <Link href={`/dashboard/insurance-claims/${c.id}`} className="font-medium hover:text-primary hover:underline">{c.insurer ?? "Claim"}</Link>
                      <div className="text-2xs text-muted-foreground">{c.intimated ? `Intimated ${formatDate(c.intimated)}` : "Intimation date not recorded"}</div>
                    </div>
                    <div className="shrink-0 text-right text-xs tabular-nums">
                      {formatMoney(c.claimed)}
                      {c.settled > 0 && <div className="text-2xs text-success">settled {formatMoney(c.settled)}</div>}
                      <Badge raw tone={c.open ? "warning" : c.status === "rejected" ? "danger" : "success"}>{CLAIM_STATUS_LABEL[c.status] ?? c.status}</Badge>
                    </div>
                  </li>
                ))}
              </Block>

              <Block title="Insurance proposals" empty="No insurance proposal on record.">
                {data.proposals.map((p) => (
                  <li key={p.id} className="flex items-center justify-between gap-3 py-2 text-xs">
                    <Link href={`/dashboard/proposals/${p.id}`} className="font-medium hover:text-primary hover:underline">{p.number}</Link>
                    <span className="tabular-nums text-muted-foreground">{p.amount != null ? formatMoney(p.amount) : "—"} · {p.status}</span>
                  </li>
                ))}
              </Block>

              <Block title="Meetings" empty="No meeting on record.">
                {data.meetings.map((m) => (
                  <li key={m.id} className="flex items-center justify-between gap-3 py-2 text-xs">
                    <Link href={`/dashboard/review-meetings/${m.id}`} className="min-w-0 truncate font-medium hover:text-primary hover:underline">{m.subject ?? m.category}</Link>
                    <span className="shrink-0 text-muted-foreground">{formatDate(m.when)} · {m.status}</span>
                  </li>
                ))}
              </Block>

              <Block title="Open tasks" empty="No open task.">
                {data.tasks.map((t) => (
                  <li key={t.id} className="flex items-center justify-between gap-3 py-2 text-xs">
                    <Link href={`/dashboard/tasks?task=${t.id}`} className="min-w-0 truncate font-medium hover:text-primary hover:underline">{t.title}</Link>
                    <span className="shrink-0 text-muted-foreground">{t.due ? formatDate(t.due) : "No due date"}</span>
                  </li>
                ))}
              </Block>

              <Block title="Open service requests" empty="No open service request.">
                {data.queries.map((q) => (
                  <li key={q.id} className="flex items-center justify-between gap-3 py-2 text-xs">
                    <Link href={`/dashboard/service-requests/${q.id}`} className="font-medium hover:text-primary hover:underline">{q.ticket ?? "Service request"}</Link>
                    <span className="text-muted-foreground">{q.type.replace(/_/g, " ")} · {q.status.replace(/_/g, " ")}</span>
                  </li>
                ))}
              </Block>
            </>
          )}
        </div>
      </aside>
    </div>
  );
}

function Block({ title, empty, children }: { title: string; empty: string; children: React.ReactNode[] }) {
  return (
    <section>
      <h3 className="mb-1 text-2xs font-semibold text-muted-foreground">{title}</h3>
      {children.length === 0 ? <p className="text-xs text-muted-foreground">{empty}</p> : <ul className="divide-y divide-border/60">{children}</ul>}
    </section>
  );
}
