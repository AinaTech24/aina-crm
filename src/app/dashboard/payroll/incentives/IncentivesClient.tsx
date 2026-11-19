"use client";

/**
 * Sales incentives: the plans (measure from the CRM, slabs, cap, who), then
 * "Work out" a period, then approve each statement — approved ones are paid
 * by the next pay run. The plan form previews the slabs on sample figures.
 */

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { Field } from "@/components/ui/Field";
import { DataTable } from "@/components/ui/DataTable";
import { confirmDialog, promptDialog } from "@/components/ui/ConfirmProvider";
import { notify } from "@/components/ui/Toast";
import { INCENTIVE_STATUS } from "@/lib/payroll/labels";
import { MEASURES, MEASURE_KEYS, PlanSchema, workIncentive, type IncentiveSlab, type MeasureKey } from "@/lib/payroll/incentive-rules";
import { errText, inr, monthText, monthsFrom, send } from "@/components/payroll/send";

export type PlanRow = {
  id: string;
  name: string;
  measure: MeasureKey;
  periodKind: "month" | "quarter";
  slabOn: "achievement" | "value";
  payout: "percent" | "fixed" | "per_unit";
  slabs: IncentiveSlab[];
  cap: number | null;
  roles: string[];
  userIds: string[];
  active: boolean;
};

export type StatementRow = {
  id: string;
  name: string;
  self: boolean;
  plan: string;
  measure: MeasureKey;
  periodStart: string;
  periodEnd: string;
  value: number | null;
  target: number | null;
  pct: number | null;
  amount: number;
  summary: string;
  note: string | null;
  status: string;
  inRun: string | null;
};

const ROLES = [
  { key: "rm", label: "Relationship Managers" },
  { key: "branch_head", label: "Branch Heads" },
  { key: "insurance_team", label: "Insurance team" },
  { key: "team_member", label: "Team members" },
];

const PAYOUT_LABEL = { percent: "% of the figure", fixed: "Fixed sum", per_unit: "₹ per client" } as const;

const fig = (m: MeasureKey, v: number | null) => (v == null ? "—" : MEASURES[m].unit === "money" ? inr(v) : String(Math.round(v)));
const periodText = (s: string, e: string) => (s.slice(0, 7) === e.slice(0, 7) ? monthText(s) : `${monthText(s).split(" ")[0]} – ${monthText(e)}`);

type Draft = Omit<PlanRow, "id" | "cap"> & { id?: string; cap: string };

const blank: Draft = { name: "", measure: "net_business", periodKind: "quarter", slabOn: "achievement", payout: "percent", slabs: [{ from: 80, rate: 0.5 }, { from: 100, rate: 1 }], cap: "", roles: ["rm"], userIds: [], active: true };

function PlanForm({ initial, staff, onDone, onCancel }: { initial: Draft; staff: Array<{ id: string; name: string }>; onDone: () => void; onCancel: () => void }) {
  const [v, setV] = useState<Draft>(initial);
  const [busy, setBusy] = useState(false);
  const m = MEASURES[v.measure];
  const body = { ...v, cap: v.cap ? Number(v.cap.replace(/[^\d.]/g, "")) : null };
  const check = PlanSchema.safeParse(body);
  const sample = useMemo(() => {
    const target = m.unit === "money" ? 1000000 : 10;
    const shape = { measure: v.measure, slabOn: v.slabOn, payout: v.payout, slabs: v.slabs, cap: body.cap ?? null };
    return [0.9, 1.1, 1.5].map((f) => ({ f, w: workIncentive(shape, Math.round(target * f), v.slabOn === "achievement" ? target : null) }));
  }, [v, m.unit, body.cap]);

  async function save() {
    setBusy(true);
    try {
      const { id, ...rest } = body;
      if (id) await send(`/api/payroll/incentives/plans/${id}`, "PUT", rest);
      else await send("/api/payroll/incentives/plans", "POST", rest);
      notify.success("Plan saved. Work out a period to see each person's incentive.");
      onDone();
    } catch (e) {
      notify.error(errText(e));
    } finally {
      setBusy(false);
    }
  }
  const slabUnit = v.slabOn === "achievement" ? "% of target" : m.unit === "money" ? "₹" : "clients";
  const rateUnit = v.payout === "percent" ? "%" : "₹";
  return (
    <Card>
      <CardHeader title={v.id ? `Edit ${initial.name}` : "New incentive plan"} />
      <CardBody>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Field label="Name">{(id) => <input id={id} className="input-base w-full" placeholder="e.g. RM quarterly net sales" value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} />}</Field>
        <Field label="Paid on" hint={v.measure.includes("business") || v.measure === "net_sip" ? "What the registrar processed — booked business pays once processed." : undefined}>
          {(id, d) => (
            <select id={id} aria-describedby={d} className="input-base w-full" value={v.measure}
              onChange={(e) => {
                const measure = e.target.value as MeasureKey;
                const count = MEASURES[measure].unit === "count";
                setV({ ...v, measure, slabOn: MEASURES[measure].target ? v.slabOn : "value", payout: count ? (v.payout === "percent" ? "per_unit" : v.payout) : v.payout === "per_unit" ? "percent" : v.payout });
              }}>
              {MEASURE_KEYS.map((k) => <option key={k} value={k}>{MEASURES[k].label}</option>)}
            </select>
          )}
        </Field>
        <Field label="Every">
          {(id) => (
            <select id={id} className="input-base w-full" value={v.periodKind} onChange={(e) => setV({ ...v, periodKind: e.target.value as Draft["periodKind"] })}>
              <option value="quarter">Quarter</option>
              <option value="month">Month</option>
            </select>
          )}
        </Field>
        <Field label="Slabs on" hint={v.slabOn === "achievement" ? "Targets are each person's KRA targets (Settings → Targets)." : undefined}>
          {(id, d) => (
            <select id={id} aria-describedby={d} className="input-base w-full" value={v.slabOn} onChange={(e) => setV({ ...v, slabOn: e.target.value as Draft["slabOn"] })}>
              {m.target && <option value="achievement">Achievement of target</option>}
              <option value="value">The figure itself</option>
            </select>
          )}
        </Field>
        <Field label="Pays">
          {(id) => (
            <select id={id} className="input-base w-full" value={v.payout} onChange={(e) => setV({ ...v, payout: e.target.value as Draft["payout"] })}>
              {m.unit === "money" && <option value="percent">{PAYOUT_LABEL.percent}</option>}
              {m.unit === "count" && <option value="per_unit">{PAYOUT_LABEL.per_unit}</option>}
              <option value="fixed">{PAYOUT_LABEL.fixed}</option>
            </select>
          )}
        </Field>
        <Field label="Cap per period (₹)" optional>{(id) => <input id={id} className="input-base w-full" inputMode="numeric" value={v.cap} onChange={(e) => setV({ ...v, cap: e.target.value })} />}</Field>
      </div>

      <div className="mt-4 space-y-2">
        <div className="text-sm font-medium">Slabs — the highest one reached pays</div>
        {v.slabs.map((s, i) => (
          <div key={i} className="flex flex-wrap items-center gap-2 text-sm">
            <span>From</span>
            <input aria-label={`Slab ${i + 1} from`} className="input-base w-28" inputMode="decimal" value={s.from} onChange={(e) => { const slabs = [...v.slabs]; slabs[i] = { ...s, from: Number(e.target.value) || 0 }; setV({ ...v, slabs }); }} />
            <span className="text-muted-foreground">{slabUnit}, pay</span>
            <input aria-label={`Slab ${i + 1} rate`} className="input-base w-28" inputMode="decimal" value={s.rate} onChange={(e) => { const slabs = [...v.slabs]; slabs[i] = { ...s, rate: Number(e.target.value) || 0 }; setV({ ...v, slabs }); }} />
            <span className="text-muted-foreground">{rateUnit}</span>
            {v.slabs.length > 1 && <button type="button" className="btn-icon" aria-label={`Remove slab ${i + 1}`} onClick={() => setV({ ...v, slabs: v.slabs.filter((_, k) => k !== i) })}><Trash2 className="size-4" /></button>}
          </div>
        ))}
        {v.slabs.length < 10 && <Button size="sm" variant="ghost" onClick={() => setV({ ...v, slabs: [...v.slabs, { from: (v.slabs[v.slabs.length - 1]?.from ?? 0) + 20, rate: 0 }] })}><Plus className="size-4" /> Add slab</Button>}
      </div>

      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <fieldset>
          <legend className="text-sm font-medium mb-1">For roles</legend>
          <div className="flex flex-wrap gap-3 text-sm">
            {ROLES.map((r) => (
              <label key={r.key} className="flex items-center gap-1.5">
                <input type="checkbox" checked={v.roles.includes(r.key)} onChange={(e) => setV({ ...v, roles: e.target.checked ? [...v.roles, r.key] : v.roles.filter((x) => x !== r.key) })} />
                {r.label}
              </label>
            ))}
          </div>
        </fieldset>
        <Field label="And these people" optional>
          {(id) => (
            <select id={id} multiple className="input-base w-full h-24" value={v.userIds} onChange={(e) => setV({ ...v, userIds: Array.from(e.target.selectedOptions).map((o) => o.value) })}>
              {staff.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          )}
        </Field>
      </div>

      <div className="mt-4 rounded-lg bg-secondary/60 p-3 text-sm space-y-1">
        <div className="font-medium">How it pays{v.slabOn === "achievement" ? ` against a target of ${fig(v.measure, m.unit === "money" ? 1000000 : 10)}` : ""}</div>
        {sample.map(({ f, w }) => (
          <div key={f} className="flex flex-wrap gap-2">
            <span className="text-muted-foreground w-36">{v.slabOn === "achievement" ? `${Math.round(f * 100)}% achieved` : fig(v.measure, Math.round((m.unit === "money" ? 1000000 : 10) * f))}</span>
            <span className="font-semibold tabular-nums">{inr(w.amount)}</span>
            {w.capped && <span className="text-muted-foreground">(capped)</span>}
          </div>
        ))}
      </div>

      {!check.success && <p className="mt-3 text-sm text-destructive">{check.error.issues[0]?.message}</p>}
      <div className="mt-4 flex justify-end gap-2">
        <Button variant="ghost" onClick={onCancel}>Cancel</Button>
        <Button variant="primary" disabled={busy || !check.success} onClick={save}>{busy ? "Saving…" : "Save plan"}</Button>
      </div>
      </CardBody>
    </Card>
  );
}

function WorkOut({ plans, onDone }: { plans: PlanRow[]; onDone: () => void }) {
  const active = plans.filter((p) => p.active);
  const months = monthsFrom(-6, 7).reverse();
  const [planId, setPlanId] = useState(active[0]?.id ?? "");
  const [month, setMonth] = useState(months[1] ?? months[0]);
  const [busy, setBusy] = useState(false);
  if (!active.length) return null;
  async function run() {
    setBusy(true);
    try {
      const r = await send<{ written: number; kept: number }>("/api/payroll/incentives/calculate", "POST", { planId, month });
      notify.success(`${r.written} statement${r.written === 1 ? "" : "s"} worked out${r.kept ? `; ${r.kept} already approved left as they were` : ""}.`);
      onDone();
    } catch (e) {
      notify.error(errText(e));
    } finally {
      setBusy(false);
    }
  }
  const plan = active.find((p) => p.id === planId);
  return (
    <div className="flex flex-wrap items-end gap-2 rounded-xl border border-border bg-card p-4">
      <Field label="Plan">{(id) => <select id={id} className="input-base" value={planId} onChange={(e) => setPlanId(e.target.value)}>{active.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select>}</Field>
      <Field label={plan?.periodKind === "month" ? "Month" : "Quarter containing"}>
        {(id) => <select id={id} className="input-base" value={month} onChange={(e) => setMonth(e.target.value)}>{months.map((m) => <option key={m} value={m}>{monthText(m)}</option>)}</select>}
      </Field>
      <Button variant="primary" disabled={busy || !planId} onClick={run}>{busy ? "Working…" : "Work out incentives"}</Button>
    </div>
  );
}

export function IncentivesClient({ plans, statements, staff, canManage }: { plans: PlanRow[]; statements: StatementRow[]; staff: Array<{ id: string; name: string }>; canManage: boolean }) {
  const router = useRouter();
  const [editing, setEditing] = useState<Draft | null>(null);
  const refresh = () => router.refresh();

  async function decide(s: StatementRow, action: "approve" | "reject" | "reopen") {
    let note: string | undefined;
    if (action === "reject") {
      const why = await promptDialog({ title: `Reject ${s.name}'s incentive?`, label: "Reason", confirmLabel: "Reject" });
      if (!why || why.trim().length < 3) return;
      note = why.trim();
    }
    try {
      await send(`/api/payroll/incentives/statements/${s.id}`, "PATCH", { action, note });
      notify.success(action === "approve" ? "Approved — the next pay run pays it." : action === "reject" ? "Rejected." : "Back to waiting for approval.");
      refresh();
    } catch (e) {
      notify.error(errText(e));
    }
  }

  return (
    <div className="space-y-5">
      {editing ? (
        <PlanForm initial={editing} staff={staff} onCancel={() => setEditing(null)} onDone={() => { setEditing(null); refresh(); }} />
      ) : (
        <>
          {canManage && <Button variant="secondary" onClick={() => setEditing(blank)}><Plus className="size-4" /> New plan</Button>}
          <DataTable
            rows={plans}
            rowKey={(p) => p.id}
            empty="No incentive plans. A plan pays on CRM figures — net business, SIPs, insurance or new clients — never typed numbers."
            columns={[
              { key: "name", header: "Plan", cell: (p) => <div><div className="font-medium">{p.name}</div><div className="text-2xs text-muted-foreground">{MEASURES[p.measure].label} · every {p.periodKind}</div></div> },
              {
                key: "slabs",
                header: "Slabs",
                cell: (p) => p.slabs.map((s) => `${p.slabOn === "achievement" ? `${s.from}%` : fig(p.measure, s.from)} → ${p.payout === "percent" ? `${s.rate}%` : inr(s.rate)}`).join(" · ") + (p.cap ? ` · cap ${inr(p.cap)}` : ""),
                hideOnMobile: true,
              },
              { key: "who", header: "For", cell: (p) => [...p.roles.map((r) => ROLES.find((x) => x.key === r)?.label ?? r), p.userIds.length ? `${p.userIds.length} named` : null].filter(Boolean).join(", "), hideOnMobile: true },
              { key: "on", header: "Status", cell: (p) => <Badge tone={p.active ? "success" : "neutral"}>{p.active ? "On" : "Off"}</Badge> },
              {
                key: "act",
                header: "",
                cell: (p) =>
                  canManage ? (
                    <span className="flex justify-end gap-1">
                      <Button size="sm" variant="ghost" onClick={() => setEditing({ ...p, cap: p.cap ? String(p.cap) : "" })}>Edit</Button>
                      {p.active && (
                        <Button size="sm" variant="ghost" onClick={async () => {
                          if (!(await confirmDialog({ title: `Switch off ${p.name}?`, message: "Statements already worked out stay; no new ones are made.", confirmLabel: "Switch off" }))) return;
                          try { await send(`/api/payroll/incentives/plans/${p.id}`, "DELETE"); notify.success("Switched off."); refresh(); } catch (e) { notify.error(errText(e)); }
                        }}>Switch off</Button>
                      )}
                    </span>
                  ) : null,
              },
            ]}
          />
        </>
      )}

      {canManage && !editing && <WorkOut plans={plans} onDone={refresh} />}

      <section className="space-y-2">
        <h2 className="text-sm font-semibold">Statements</h2>
        <DataTable
          rows={statements}
          rowKey={(s) => s.id}
          empty="Nothing worked out yet."
          columns={[
            { key: "who", header: "Team member", cell: (s) => <div><div className="font-medium">{s.name}</div><div className="text-2xs text-muted-foreground">{s.plan} · {periodText(s.periodStart, s.periodEnd)}</div></div> },
            { key: "fig", header: "Figure", cell: (s) => fig(s.measure, s.value), align: "right", hideOnMobile: true },
            { key: "target", header: "Target", cell: (s) => (s.target == null ? "—" : fig(s.measure, s.target)), align: "right", hideOnMobile: true, hideWhenEmpty: true },
            { key: "pct", header: "Achieved", cell: (s) => (s.pct == null ? "—" : `${s.pct}%`), align: "right", hideOnMobile: true, hideWhenEmpty: true },
            { key: "amount", header: "Incentive", cell: (s) => <span className="font-semibold" title={s.summary}>{inr(s.amount)}</span>, align: "right" },
            {
              key: "status",
              header: "Status",
              cell: (s) => (
                <div className="min-w-56 max-w-md whitespace-normal">
                  {s.status === "calculated" && s.amount <= 0 ? (
                    <Badge tone="neutral">Nothing to pay</Badge>
                  ) : (
                    <Badge tone={INCENTIVE_STATUS[s.status]?.tone ?? "neutral"}>{INCENTIVE_STATUS[s.status]?.label ?? s.status}</Badge>
                  )}
                  {s.inRun && <div className="text-2xs text-muted-foreground mt-0.5">In {monthText(s.inRun)} payroll</div>}
                  <div className="text-2xs text-muted-foreground mt-0.5">{s.note ? `Note: ${s.note}` : s.summary}</div>
                </div>
              ),
            },
            {
              key: "act",
              header: "",
              cell: (s) =>
                canManage && !s.self && !s.inRun && s.status !== "paid" ? (
                  <span className="flex justify-end gap-1">
                    {s.status === "calculated" && s.amount > 0 && <Button size="sm" variant="secondary" onClick={() => decide(s, "approve")}>Approve</Button>}
                    {(s.status === "calculated" || s.status === "approved") && <Button size="sm" variant="ghost" onClick={() => decide(s, "reject")}>Reject</Button>}
                    {s.status === "approved" && <Button size="sm" variant="ghost" onClick={() => decide(s, "reopen")}>Reopen</Button>}
                  </span>
                ) : null,
            },
          ]}
        />
      </section>
    </div>
  );
}
