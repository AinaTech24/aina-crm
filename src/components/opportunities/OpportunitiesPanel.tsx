"use client";

/**
 * Opportunities on the client page — the products an EXISTING client wants
 * next, each with its own journey (lib/opportunities/journey.ts).
 *
 * One card per open opportunity: the stage rail (done, done automatically,
 * skipped because it was already on file, current, to come), what the next
 * step needs, and the actions — move on, record a needs analysis, mark lost.
 * Closed ones fold into one line each underneath.
 *
 * `?opportunity=new&product=…` on the page URL opens the "New opportunity"
 * dialog pre-filled — the new-lead form and the Cross-sell card link here.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  AlertTriangle, Check, CheckCircle2, ChevronDown, ChevronRight, Circle, CircleDashed, Loader2, Plus, RefreshCw,
  Sparkles, Target, XCircle,
} from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { Field } from "@/components/ui/Field";
import { SelectField } from "@/components/ui/SelectField";
import { DateField } from "@/components/ui/DateField";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/Dialog";
import { notify } from "@/components/ui/Toast";
import { formatDate, formatMoney } from "@/lib/format";
import { OPPORTUNITY_PRODUCTS, productPipeline } from "@/lib/opportunities/products";
import type { OpportunityView, Prerequisite } from "@/lib/opportunities/journey";
import { cn } from "@/lib/utils";

type Staff = { id: string; name: string; insurance: boolean };

const PIPELINE_LABEL = { mf: "Mutual fund", insurance: "Insurance", general: "Other product" } as const;
const SOURCE_LABEL: Record<string, string> = {
  manual: "Added by hand", cross_sell: "From the Cross-sell card", lead_match: "From a new enquiry",
  review: "From a review meeting", automation: "From an automation",
};
const LOST_REASONS = [
  "Not interested now", "Chose another distributor", "Budget / cash flow", "Already covered elsewhere",
  "Not eligible (medical / underwriting)", "Other",
];

export function OpportunitiesPanel({ investorId, investorName }: { investorId: string; investorName: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [items, setItems] = useState<OpportunityView[] | null>(null);
  const [staff, setStaff] = useState<Staff[]>([]);
  const [canWork, setCanWork] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState<{ product: string } | null>(null);
  const [showClosed, setShowClosed] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/investors/${investorId}/opportunities`, { cache: "no-store" });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j.error ?? "Could not load opportunities");
      setItems(j.items ?? []);
      setStaff(j.staff ?? []);
      setCanWork(!!j.canWork);
      setError(null);
      return (j.items ?? []) as OpportunityView[];
    } catch (e: any) {
      setError(e?.message ?? "Could not load opportunities");
      setItems([]);
      return [];
    }
  }, [investorId]);

  // Load, then let any journey whose current step is already done catch up
  // (a proposal sent or KYC verified since the page was last open).
  useEffect(() => {
    let alive = true;
    (async () => {
      const list = await load();
      const stale = list.filter((o) => o.status === "open" && o.canSync);
      if (!alive || !stale.length) return;
      await Promise.all(stale.map((o) => fetch(`/api/opportunities/${o.id}/sync`, { method: "POST" }).catch(() => null)));
      if (alive) await load();
    })();
    return () => { alive = false; };
  }, [load]);

  // Deep link: ?opportunity=new&product=health_insurance
  useEffect(() => {
    if (params.get("opportunity") === "new") {
      const p = params.get("product");
      setCreating({ product: p && OPPORTUNITY_PRODUCTS.some((x) => x.key === p) ? p : "" });
      const q = new URLSearchParams(params.toString());
      q.delete("opportunity");
      q.delete("product");
      router.replace(`${pathname}${q.toString() ? `?${q}` : ""}`, { scroll: false });
    }
  }, [params, pathname, router]);

  const open = (items ?? []).filter((o) => o.status === "open");
  const closed = (items ?? []).filter((o) => o.status !== "open");
  const openProducts = new Set(open.map((o) => o.product));

  function replace(view: OpportunityView | undefined) {
    if (!view) return;
    setItems((cur) => (cur ?? []).map((o) => (o.id === view.id ? view : o)));
    router.refresh();
  }

  return (
    <section className="card-surface p-5 sm:p-6" aria-label="Opportunities" id="opportunities">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3 border-b border-border/60 pb-3">
        <div className="min-w-0">
          <h2 className="section-title flex items-center gap-2">
            <Target className="size-4 shrink-0 text-muted-foreground" aria-hidden /> Opportunities
          </h2>
          <p className="section-subtitle mt-0.5">
            Products {investorName.split(" ")[0]} wants next. Steps already on file are skipped.
          </p>
        </div>
        {canWork && (
          <Button size="sm" icon={<Plus className="size-4" />} onClick={() => setCreating({ product: "" })}>
            New opportunity
          </Button>
        )}
      </div>

      {items == null ? (
        <div className="flex items-center gap-2 py-4 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin" /> Loading…</div>
      ) : error ? (
        <p className="text-sm text-destructive">{error}</p>
      ) : open.length === 0 ? (
        <p className="rounded-lg bg-secondary/50 px-4 py-5 text-center text-sm text-muted-foreground">
          No open opportunity. {canWork ? "When the client asks about another product, start one here." : ""}
        </p>
      ) : (
        <div className="space-y-4">
          {open.map((o) => (
            <OpportunityCard key={o.id} o={o} canWork={canWork} staff={staff} onChange={replace} onReload={load} />
          ))}
        </div>
      )}

      {closed.length > 0 && (
        <div className="mt-4 border-t border-border/60 pt-3">
          <button type="button" onClick={() => setShowClosed((v) => !v)}
            className="inline-flex min-h-6 items-center gap-1 rounded text-xs font-medium text-muted-foreground hover:text-foreground">
            {showClosed ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}
            Closed ({closed.length})
          </button>
          {showClosed && (
            <ul className="mt-2 divide-y divide-border/60">
              {closed.map((o) => (
                <li key={o.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2 text-sm">
                  {o.status === "won"
                    ? <Badge tone="success" raw>Won</Badge>
                    : <Badge tone="neutral" raw>Lost</Badge>}
                  <span className="font-medium">{o.productLabel}</span>
                  {o.expectedValue != null && <span className="tabular-nums text-muted-foreground">{formatMoney(o.expectedValue)}</span>}
                  <span className="text-xs text-muted-foreground">
                    {o.closedAt ? formatDate(o.closedAt) : ""}
                    {o.status === "lost" && o.lostReason ? ` · ${o.lostReason}` : ""}
                    {o.status === "lost" && o.revisitOn ? ` · revisit ${formatDate(o.revisitOn)}` : ""}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {creating && (
        <NewOpportunityDialog
          investorId={investorId}
          investorName={investorName}
          initialProduct={creating.product}
          openProducts={openProducts}
          staff={staff}
          onClose={() => setCreating(null)}
          onCreated={async () => { setCreating(null); await load(); router.refresh(); }}
        />
      )}
    </section>
  );
}

/* ─────────────────────────────── one opportunity ─────────────────────────────── */

function OpportunityCard({ o, canWork, staff, onChange, onReload }: {
  o: OpportunityView; canWork: boolean; staff: Staff[];
  onChange: (v: OpportunityView | undefined) => void; onReload: () => Promise<unknown>;
}) {
  const [busy, setBusy] = useState<"advance" | "sync" | null>(null);
  const [blocked, setBlocked] = useState<Prerequisite[] | null>(null);
  const [losing, setLosing] = useState(false);
  const [needsOpen, setNeedsOpen] = useState(false);

  const gate = blocked ?? o.gate;
  const gateOpen = gate.some((p) => !p.satisfied);
  const daysIn = Math.max(0, Math.floor((Date.now() - new Date(o.current.enteredAt).getTime()) / 864e5));
  const needsAnalysisDue = o.pipeline === "insurance" && (o.current.key === "suitability" || o.next?.key === "proposal")
    && !(o.needsAnalysis && (o.needsAnalysis.coverNeeded != null || o.needsAnalysis.annualIncome != null));

  async function advance() {
    setBusy("advance");
    setBlocked(null);
    try {
      const res = await fetch(`/api/opportunities/${o.id}/advance`, {
        method: "POST", headers: { "content-type": "application/json" }, body: "{}",
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (j.blocked) setBlocked(j.blocked);
        notify.error(j.error ?? "Could not move it on");
        if (j.opportunity) onChange(j.opportunity);
        return;
      }
      if (j.skipped?.length) notify.success(`Moved on — ${j.skipped.length} step${j.skipped.length === 1 ? "" : "s"} already on file`);
      else notify.success(j.stage === "won" ? "Marked won" : "Moved on");
      onChange(j.opportunity);
    } finally {
      setBusy(null);
    }
  }

  async function sync() {
    setBusy("sync");
    try {
      const res = await fetch(`/api/opportunities/${o.id}/sync`, { method: "POST" });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) return notify.error(j.error ?? "Could not check");
      if (!j.skipped?.length) notify.info?.("Nothing new on file yet");
      onChange(j.opportunity);
    } finally {
      setBusy(null);
    }
  }

  const coOwnerName = o.coOwnerName ?? (o.coOwnerId ? staff.find((s) => s.id === o.coOwnerId)?.name : null);

  return (
    <article className={cn("rounded-xl border p-4", o.current.delayed ? "border-warning/50 bg-warning/5" : "border-border/70 bg-secondary/30")}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-base font-semibold text-foreground">{o.productLabel}</h3>
            <Badge tone="neutral" raw>{PIPELINE_LABEL[o.pipeline]}</Badge>
            {o.expectedValue != null && (
              <span className="text-sm font-semibold tabular-nums">
                {formatMoney(o.expectedValue)}{o.investmentMode === "sip" ? <span className="font-normal text-muted-foreground"> /mo SIP</span> : o.investmentMode === "lumpsum" ? <span className="font-normal text-muted-foreground"> lumpsum</span> : null}
              </span>
            )}
          </div>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {o.ownerName ? `Owner ${o.ownerName}` : "No owner"}
            {coOwnerName ? ` · with ${coOwnerName}` : ""} · opened {formatDate(o.createdAt)} · {SOURCE_LABEL[o.source] ?? o.source}
          </p>
        </div>
        <div className="text-right text-xs">
          <div className="font-medium text-foreground">{o.current.name}</div>
          <div className={cn("text-muted-foreground", o.current.delayed && "font-medium text-warning-foreground")}>
            {daysIn === 0 ? "since today" : `${daysIn} day${daysIn === 1 ? "" : "s"} in this step`}
            {o.current.delayed && o.current.slaDays != null ? ` · past its ${o.current.slaDays}-day target` : ""}
          </div>
        </div>
      </div>

      <StageRail stages={o.stages} />

      {o.notes && <p className="mt-3 text-xs text-muted-foreground">{o.notes}</p>}

      {gate.length > 0 && o.next && (
        <div className={cn("mt-3 rounded-lg px-3 py-2.5", gateOpen ? "bg-warning/10" : "bg-success/10")}>
          <div className="mb-1 text-xs font-semibold text-foreground">
            {gateOpen ? `Before "${o.next.name}"` : `Ready for "${o.next.name}"`}
          </div>
          <ul className="space-y-1">
            {gate.map((p) => (
              <li key={p.label} className="flex items-start gap-2 text-xs">
                {p.satisfied
                  ? <CheckCircle2 className="mt-0.5 size-3.5 shrink-0 text-success" aria-hidden />
                  : <XCircle className="mt-0.5 size-3.5 shrink-0 text-warning-foreground" aria-hidden />}
                <span className="min-w-0">
                  <span className={p.satisfied ? "text-muted-foreground" : "font-medium text-foreground"}>{p.label}</span>
                  {!p.satisfied && p.hint && <span className="text-muted-foreground"> — {p.hint}</span>}
                  {!p.satisfied && p.cta && (
                    <Link href={p.cta.href} className="ml-1.5 font-medium text-primary hover:underline">{p.cta.label}</Link>
                  )}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {canWork && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {o.next && (
            <Button variant="primary" size="sm" loading={busy === "advance"} disabled={gateOpen || busy != null}
              icon={o.next.key === "won" ? <Sparkles className="size-4" /> : <ChevronRight className="size-4" />}
              onClick={advance}>
              {o.next.key === "won" ? "Mark won" : `Move to: ${o.next.name}`}
            </Button>
          )}
          {o.pipeline === "insurance" && (needsAnalysisDue || o.needsAnalysis) && (
            <Button size="sm" onClick={() => setNeedsOpen(true)}>
              {o.needsAnalysis ? "Edit needs analysis" : "Record needs analysis"}
            </Button>
          )}
          {(o.current.key === "proposal" || o.next?.key === "proposal") && o.pipeline !== "general" && (
            <Link href={`/dashboard/proposals/new?investorId=${o.investorId}&opportunityId=${o.id}`} className="inline-flex min-h-8 items-center rounded-md px-2 text-sm font-medium text-primary hover:bg-accent">
              Create proposal
            </Link>
          )}
          {o.canSync && (
            <Button variant="ghost" size="sm" loading={busy === "sync"} icon={<RefreshCw className="size-3.5" />} onClick={sync}>
              Check again
            </Button>
          )}
          <Button variant="ghost" size="sm" className="ml-auto text-muted-foreground" onClick={() => setLosing(true)}>
            Mark lost
          </Button>
        </div>
      )}

      {losing && <LostDialog o={o} onClose={() => setLosing(false)} onDone={(v) => { setLosing(false); onChange(v); void onReload(); }} />}
      {needsOpen && <NeedsAnalysisDialog o={o} onClose={() => setNeedsOpen(false)} onDone={(v) => { setNeedsOpen(false); onChange(v); }} />}
    </article>
  );
}

/* ─────────────────────────────── stage rail ─────────────────────────────── */

function StageRail({ stages }: { stages: OpportunityView["stages"] }) {
  return (
    <ol className="mt-3 flex flex-wrap items-center gap-x-1 gap-y-2" aria-label="Journey">
      {stages.map((s, i) => {
        const icon =
          s.status === "done" ? <Check className="size-3" />
          : s.status === "auto" ? <Check className="size-3" />
          : s.status === "skipped" ? <CircleDashed className="size-3" />
          : s.status === "current" ? <Circle className="size-2.5 fill-current" />
          : <Circle className="size-2.5" />;
        return (
          <li key={s.key} className="flex items-center gap-1" title={s.note ?? undefined}>
            <span className={cn(
              "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs",
              s.status === "done" && "bg-success/10 text-success-foreground",
              s.status === "auto" && "bg-success/10 text-success-foreground",
              s.status === "skipped" && "bg-secondary text-muted-foreground line-through decoration-muted-foreground/40",
              s.status === "current" && "bg-primary/10 font-semibold text-primary ring-1 ring-primary/30",
              s.status === "upcoming" && "text-muted-foreground",
            )}>
              {icon}
              {s.name}
              {s.status === "auto" && <span className="text-2xs opacity-70">auto</span>}
            </span>
            {i < stages.length - 1 && <ChevronRight className="size-3 text-muted-foreground/40" aria-hidden />}
          </li>
        );
      })}
    </ol>
  );
}

/* ─────────────────────────────── dialogs ─────────────────────────────── */

function NewOpportunityDialog({ investorId, investorName, initialProduct, openProducts, staff, onClose, onCreated }: {
  investorId: string; investorName: string; initialProduct: string; openProducts: Set<string>; staff: Staff[];
  onClose: () => void; onCreated: () => void;
}) {
  const [product, setProduct] = useState(initialProduct);
  const [value, setValue] = useState("");
  const [mode, setMode] = useState<"" | "sip" | "lumpsum">("");
  const [coOwnerId, setCoOwnerId] = useState("");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const pipeline = product ? productPipeline(product) : null;
  const insuranceTeam = useMemo(() => staff.filter((s) => s.insurance), [staff]);

  async function save() {
    if (!product) return setErr("Pick a product.");
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch(`/api/investors/${investorId}/opportunities`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          product,
          expectedValue: value ? Number(value.replace(/[^0-9.]/g, "")) : null,
          investmentMode: pipeline === "mf" && mode ? mode : null,
          coOwnerId: coOwnerId || null,
          notes: notes.trim() || null,
          source: initialProduct ? "cross_sell" : "manual",
        }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) return setErr(j.error ?? "Could not start it");
      notify.success(j.created ? "Opportunity started — a follow-up task is on the owner's list" : "Already open — showing that one");
      onCreated();
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>New opportunity for {investorName}</DialogTitle>
          <DialogDescription>An existing client wants another product. Steps already on file (KYC, UCC, mandate) will be skipped.</DialogDescription>
        </DialogHeader>
        <div className="mt-4 space-y-3">
          <Field label="Product" required>
            {(id, d) => (
            <SelectField id={id} aria-describedby={d} value={product} onChange={(e) => setProduct(e.target.value)} className="w-full">
              <option value="">Select a product…</option>
              {OPPORTUNITY_PRODUCTS.map((p) => (
                <option key={p.key} value={p.key} disabled={openProducts.has(p.key)}>
                  {p.label}{openProducts.has(p.key) ? " — already open" : ""}
                </option>
              ))}
            </SelectField>
            )}
          </Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label={pipeline === "mf" && mode === "sip" ? "SIP amount a month (₹)" : pipeline === "insurance" ? "Expected premium (₹)" : "Expected amount (₹)"} optional>
              {(id, d) => (
              <input id={id} aria-describedby={d} className="input-base" inputMode="decimal" value={value} onChange={(e) => setValue(e.target.value)} placeholder="e.g. 25000" />
              )}
            </Field>
            {pipeline === "mf" && (
              <Field label="How" optional hint="A SIP needs an active mandate; a lumpsum does not.">
                {(id, d) => (
                <SelectField id={id} aria-describedby={d} value={mode} onChange={(e) => setMode(e.target.value as any)} className="w-full">
                  <option value="">Not decided</option>
                  <option value="sip">SIP</option>
                  <option value="lumpsum">Lumpsum</option>
                </SelectField>
                )}
              </Field>
            )}
            {pipeline === "insurance" && insuranceTeam.length > 0 && (
              <Field label="Insurance team member" optional hint="Works it with the client's RM.">
                {(id, d) => (
                <SelectField id={id} aria-describedby={d} value={coOwnerId} onChange={(e) => setCoOwnerId(e.target.value)} className="w-full">
                  <option value="">None</option>
                  {insuranceTeam.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                </SelectField>
                )}
              </Field>
            )}
          </div>
          <Field label="What did the client say?" optional>
            {(id, d) => (
            <textarea id={id} aria-describedby={d} className="input-base" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)}
              placeholder="e.g. wants a family floater before the baby arrives" />
            )}
          </Field>
          {err && <p className="flex items-center gap-1.5 text-sm text-destructive"><AlertTriangle className="size-4" /> {err}</p>}
        </div>
        <DialogFooter>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={busy} onClick={save}>Start opportunity</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function LostDialog({ o, onClose, onDone }: { o: OpportunityView; onClose: () => void; onDone: (v: OpportunityView) => void }) {
  const [reason, setReason] = useState(LOST_REASONS[0]);
  const [detail, setDetail] = useState("");
  const [revisitOn, setRevisitOn] = useState("");
  const [busy, setBusy] = useState(false);
  async function save() {
    setBusy(true);
    try {
      const lostReason = reason === "Other" ? detail.trim() || "Other" : detail.trim() ? `${reason} — ${detail.trim()}` : reason;
      const res = await fetch(`/api/opportunities/${o.id}/advance`, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ to: "lost", lostReason, revisitOn: revisitOn || null }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) return notify.error(j.error ?? "Could not close it");
      notify.success(revisitOn ? "Closed — a revisit task is on the calendar" : "Closed as lost");
      onDone(j.opportunity);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Close {o.productLabel} as lost</DialogTitle>
          <DialogDescription>The reason feeds the cross-sell report. A revisit date puts a follow-up task on the owner's list.</DialogDescription>
        </DialogHeader>
        <div className="mt-4 space-y-3">
          <Field label="Why" required>
            {(id, d) => (
            <SelectField id={id} aria-describedby={d} value={reason} onChange={(e) => setReason(e.target.value)} className="w-full">
              {LOST_REASONS.map((r) => <option key={r} value={r}>{r}</option>)}
            </SelectField>
            )}
          </Field>
          <Field label="Detail" optional>
            {(id, d) => (
            <input id={id} aria-describedby={d} className="input-base" value={detail} onChange={(e) => setDetail(e.target.value)} />
            )}
          </Field>
          <Field label="Revisit on" optional>
            {(id, d) => (
            <DateField id={id} aria-describedby={d} value={revisitOn} onChange={(e) => setRevisitOn(e.target.value)} min={new Date().toISOString().slice(0, 10)} />
            )}
          </Field>
        </div>
        <DialogFooter>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="danger" loading={busy} onClick={save}>Close as lost</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function NeedsAnalysisDialog({ o, onClose, onDone }: { o: OpportunityView; onClose: () => void; onDone: (v: OpportunityView) => void }) {
  const n = o.needsAnalysis ?? {};
  const [f, setF] = useState({
    annualIncome: n.annualIncome?.toString() ?? "",
    dependants: n.dependants?.toString() ?? "",
    existingCover: n.existingCover?.toString() ?? "",
    coverNeeded: n.coverNeeded?.toString() ?? "",
    liabilities: n.liabilities?.toString() ?? "",
    notes: n.notes ?? "",
  });
  const [busy, setBusy] = useState(false);
  const num = (v: string) => (v.trim() ? Number(v.replace(/[^0-9.]/g, "")) : null);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setF((x) => ({ ...x, [k]: e.target.value }));

  async function save() {
    if (!f.annualIncome.trim() && !f.coverNeeded.trim()) return notify.error("Record at least the income or the cover needed.");
    setBusy(true);
    try {
      const res = await fetch(`/api/opportunities/${o.id}`, {
        method: "PATCH", headers: { "content-type": "application/json" },
        body: JSON.stringify({ needsAnalysis: {
          annualIncome: num(f.annualIncome), dependants: num(f.dependants), existingCover: num(f.existingCover),
          coverNeeded: num(f.coverNeeded), liabilities: num(f.liabilities), notes: f.notes.trim() || null,
        } }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) return notify.error(j.error ?? "Could not save");
      notify.success("Needs analysis saved");
      onDone(j.opportunity);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Needs analysis — {o.productLabel}</DialogTitle>
          <DialogDescription>Recorded before a quote is shared. It is what makes the recommendation defensible.</DialogDescription>
        </DialogHeader>
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <Field label="Annual income (₹)">{(id, d) => <input id={id} aria-describedby={d} className="input-base" inputMode="decimal" value={f.annualIncome} onChange={set("annualIncome")} />}</Field>
          <Field label="Dependants" optional>{(id, d) => <input id={id} aria-describedby={d} className="input-base" inputMode="numeric" value={f.dependants} onChange={set("dependants")} />}</Field>
          <Field label="Existing cover (₹)" optional>{(id, d) => <input id={id} aria-describedby={d} className="input-base" inputMode="decimal" value={f.existingCover} onChange={set("existingCover")} />}</Field>
          <Field label="Cover needed (₹)">{(id, d) => <input id={id} aria-describedby={d} className="input-base" inputMode="decimal" value={f.coverNeeded} onChange={set("coverNeeded")} />}</Field>
          <Field label="Loans / liabilities (₹)" optional>{(id, d) => <input id={id} aria-describedby={d} className="input-base" inputMode="decimal" value={f.liabilities} onChange={set("liabilities")} />}</Field>
          <Field label="Notes" optional className="sm:col-span-2">{(id, d) => <textarea id={id} aria-describedby={d} className="input-base" rows={2} value={f.notes} onChange={set("notes")} />}</Field>
        </div>
        <DialogFooter>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={busy} onClick={save}>Save</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
