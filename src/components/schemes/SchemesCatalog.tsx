"use client";

/**
 * Scheme Master catalog — the interactive surface that activates our (until
 * now UI-less) scheme model: browse, manually add/edit, inline shortlist
 * toggle, bulk IC shortlist, and the 11-criteria evaluation scorecard.
 *
 * Wires the existing APIs:
 *   POST  /api/schemes                      (create)
 *   PATCH /api/schemes/[id]                 (edit metadata)
 *   POST  /api/scheme-shortlist             (single toggle)
 *   PATCH /api/scheme-shortlist             (bulk)
 *   PUT   /api/schemes/[id]/evaluation      (IC scorecard)
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Star, X, Plus, Pencil, ClipboardList, Save } from "lucide-react";

const COARSE = [
  ["equity", "Equity"], ["hybrid", "Hybrid"], ["debt", "Debt"], ["liquid", "Liquid"],
  ["commodity", "Commodity"], ["international", "International"], ["other", "Other"],
] as const;
const COARSE_TONE: Record<string, string> = {
  equity: "bg-emerald-50 text-emerald-700", hybrid: "bg-blue-50 text-blue-700", debt: "bg-amber-50 text-amber-700",
  liquid: "bg-cyan-50 text-cyan-700", commodity: "bg-orange-50 text-orange-700", international: "bg-violet-50 text-violet-700", other: "bg-slate-50 text-slate-600",
};
const PLANS = ["regular", "direct"];
const OPTIONS = ["growth", "idcw_payout", "idcw_reinvest"];
const RISKS = ["very_low", "low", "moderate", "high", "very_high"];
const VERDICT_TONE: Record<string, string> = { pass: "bg-emerald-100 text-emerald-700", watch: "bg-amber-100 text-amber-700", reject: "bg-rose-100 text-rose-700" };

type Scheme = Record<string, any>;

export function SchemesCatalog({ rows, amcs, canManage }: { rows: Scheme[]; amcs: Array<{ code: string; name: string }>; canManage: boolean }) {
  const router = useRouter();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [rowBusy, setRowBusy] = useState<string | null>(null);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkCoarse, setBulkCoarse] = useState("");
  const [bulkBusy, setBulkBusy] = useState(false);
  const [edit, setEdit] = useState<{ mode: "new" | "edit"; scheme: Scheme | null } | null>(null);
  const [evalFor, setEvalFor] = useState<Scheme | null>(null);

  const allSel = rows.length > 0 && selected.size === rows.length;
  function toggle(id: string) { setSelected((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; }); }

  async function toggleShortlist(s: Scheme) {
    setRowBusy(s.id);
    try {
      const res = await fetch("/api/scheme-shortlist", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ schemeId: s.id, isShortlisted: !s.is_shortlisted, coarseCategory: s.coarse_category ?? undefined }),
      });
      if (!res.ok) { const j = await res.json().catch(() => ({})); alert(j.error ?? "Failed"); return; }
      router.refresh();
    } finally { setRowBusy(null); }
  }

  async function runBulk(isShortlisted: boolean) {
    setBulkBusy(true);
    try {
      const res = await fetch("/api/scheme-shortlist", {
        method: "PATCH", headers: { "content-type": "application/json" },
        body: JSON.stringify({ schemeIds: [...selected], isShortlisted, coarseCategory: bulkCoarse || undefined }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) { alert(j.error ?? "Bulk failed"); return; }
      setSelected(new Set()); setBulkOpen(false); router.refresh();
    } finally { setBulkBusy(false); }
  }

  return (
    <div className="space-y-3">
      {canManage && (
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div className="flex items-center gap-2">
            {selected.size > 0 ? (
              <>
                <span className="text-sm font-semibold">{selected.size} selected</span>
                <button onClick={() => setBulkOpen((o) => !o)} className="btn-ghost text-xs"><Star className="size-3.5" /> Bulk shortlist</button>
                <button onClick={() => setSelected(new Set())} className="text-xs text-muted-foreground hover:underline">Clear</button>
              </>
            ) : (
              <span className="text-xs text-muted-foreground">Select rows for a bulk IC shortlist update.</span>
            )}
          </div>
          <button onClick={() => setEdit({ mode: "new", scheme: null })} className="btn-primary text-sm"><Plus className="size-4" /> New scheme</button>
        </div>
      )}

      {bulkOpen && selected.size > 0 && (
        <div className="card-surface p-3 flex items-center gap-3 flex-wrap text-sm bg-secondary/30">
          <span className="text-xs font-semibold">Apply to {selected.size}:</span>
          <select value={bulkCoarse} onChange={(e) => setBulkCoarse(e.target.value)} className="input-base text-xs w-44">
            <option value="">— coarse category (optional) —</option>
            {COARSE.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select>
          <button onClick={() => runBulk(true)} disabled={bulkBusy} className="btn-primary text-xs inline-flex items-center gap-1">{bulkBusy && <Loader2 className="size-3 animate-spin" />} Shortlist</button>
          <button onClick={() => runBulk(false)} disabled={bulkBusy} className="btn-ghost text-xs text-rose-600">Remove from shortlist</button>
        </div>
      )}

      <div className="card-surface overflow-x-auto">
        {rows.length === 0 ? (
          <div className="p-12 text-center text-sm text-muted-foreground">No schemes match. {canManage && "Add one with “New scheme”, or they seed from the AMFI/RTA feed."}</div>
        ) : (
          <table className="w-full text-sm">
            <thead className="text-xs text-muted-foreground border-b">
              <tr>
                {canManage && <th className="px-3 py-2 w-8"><input type="checkbox" checked={allSel} onChange={() => setSelected(allSel ? new Set() : new Set(rows.map((r) => r.id)))} className="size-3.5 rounded" /></th>}
                <th className="px-2 py-2 w-8"></th>
                <th className="text-left py-2 font-medium">Scheme</th>
                <th className="text-left py-2 font-medium">AMC</th>
                <th className="text-left py-2 font-medium">Category</th>
                <th className="text-left py-2 font-medium">Plan</th>
                <th className="text-left py-2 font-medium">Risk</th>
                <th className="text-left py-2 font-medium">Verdict</th>
                <th className="text-right py-2 font-medium pr-4">Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((s) => {
                const v = s.evaluation?.verdict as string | undefined;
                return (
                  <tr key={s.id} className={`border-b last:border-0 hover:bg-secondary/40 ${selected.has(s.id) ? "bg-brand-cyan-light/30" : ""}`}>
                    {canManage && <td className="px-3 py-2.5"><input type="checkbox" checked={selected.has(s.id)} onChange={() => toggle(s.id)} className="size-3.5 rounded" /></td>}
                    <td className="px-2 py-2.5">
                      <button onClick={() => canManage && toggleShortlist(s)} disabled={!canManage || rowBusy === s.id} title={s.is_shortlisted ? "Shortlisted" : "Add to shortlist"}>
                        {rowBusy === s.id ? <Loader2 className="size-4 animate-spin" /> : <Star className={`size-4 ${s.is_shortlisted ? "fill-amber-400 text-amber-400" : "text-slate-300"}`} />}
                      </button>
                    </td>
                    <td className="py-2.5">
                      <div className="font-medium max-w-[280px] truncate">{s.scheme_name}</div>
                      <div className="text-[11px] text-muted-foreground font-mono">{s.scheme_code}{s.is_closed ? " · closed" : !s.is_active ? " · inactive" : ""}</div>
                    </td>
                    <td className="py-2.5 text-xs whitespace-nowrap">{s.amc_name ?? s.amc_code}</td>
                    <td className="py-2.5 text-xs">
                      {s.coarse_category && <span className={`chip text-[10px] ${COARSE_TONE[s.coarse_category] ?? ""}`}>{s.coarse_category}</span>}
                      <div className="text-[11px] text-muted-foreground max-w-[160px] truncate">{s.category ?? "—"}</div>
                    </td>
                    <td className="py-2.5 text-xs capitalize">{s.plan ?? "—"}</td>
                    <td className="py-2.5 text-xs capitalize">{(s.risk_category ?? "—").replace(/_/g, " ")}</td>
                    <td className="py-2.5">{v ? <span className={`chip capitalize text-[10px] ${VERDICT_TONE[v] ?? ""}`}>{v}</span> : <span className="text-xs text-muted-foreground">—</span>}</td>
                    <td className="py-2.5 pr-4 text-right whitespace-nowrap">
                      {canManage && (
                        <div className="inline-flex items-center gap-1">
                          <button onClick={() => setEvalFor(s)} className="btn-ghost text-xs inline-flex items-center gap-1"><ClipboardList className="size-3.5" /> Evaluate</button>
                          <button onClick={() => setEdit({ mode: "edit", scheme: s })} className="btn-ghost text-xs inline-flex items-center gap-1"><Pencil className="size-3.5" /> Edit</button>
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {edit && <SchemeFormDrawer mode={edit.mode} scheme={edit.scheme} amcs={amcs} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); router.refresh(); }} />}
      {evalFor && <EvaluationDrawer scheme={evalFor} onClose={() => setEvalFor(null)} onSaved={() => { setEvalFor(null); router.refresh(); }} />}
    </div>
  );
}

function SchemeFormDrawer({ mode, scheme, amcs, onClose, onSaved }: { mode: "new" | "edit"; scheme: Scheme | null; amcs: Array<{ code: string; name: string }>; onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState({
    amcCode: scheme?.amc_code ?? (amcs[0]?.code ?? ""),
    schemeCode: scheme?.scheme_code ?? "",
    schemeName: scheme?.scheme_name ?? "",
    category: scheme?.category ?? "",
    subCategory: scheme?.sub_category ?? "",
    coarseCategory: scheme?.coarse_category ?? "",
    plan: scheme?.plan ?? "",
    option: scheme?.option ?? "",
    exitLoad: scheme?.exit_load ?? "",
    riskCategory: scheme?.risk_category ?? "",
    minSip: scheme?.min_sip ?? "",
    minInvestment: scheme?.min_investment ?? "",
    isActive: scheme?.is_active ?? true,
    isClosed: scheme?.is_closed ?? false,
  });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  function set<K extends keyof typeof f>(k: K, v: (typeof f)[K]) { setF((s) => ({ ...s, [k]: v })); }

  async function save() {
    setBusy(true); setErr(null);
    try {
      const payload: any = {
        schemeName: f.schemeName, category: f.category || null, subCategory: f.subCategory || null,
        coarseCategory: f.coarseCategory || undefined, plan: f.plan || undefined, option: f.option || undefined,
        exitLoad: f.exitLoad || null, riskCategory: f.riskCategory || null, minSip: f.minSip || null,
        minInvestment: f.minInvestment || null, isActive: f.isActive, isClosed: f.isClosed,
      };
      let res;
      if (mode === "new") {
        res = await fetch("/api/schemes", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ amcCode: f.amcCode, schemeCode: f.schemeCode, ...payload, coarseCategory: f.coarseCategory || undefined }) });
      } else {
        res = await fetch(`/api/schemes/${scheme!.id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });
      }
      const j = await res.json().catch(() => ({}));
      if (!res.ok) { setErr(j.error ?? `Save failed (${res.status})`); return; }
      onSaved();
    } finally { setBusy(false); }
  }

  return (
    <Drawer title={mode === "new" ? "New scheme" : "Edit scheme"} onClose={onClose}>
      <div className="grid sm:grid-cols-2 gap-3">
        <Field label="AMC"><select value={f.amcCode} onChange={(e) => set("amcCode", e.target.value)} disabled={mode === "edit"} className="input-base">{amcs.map((a) => <option key={a.code} value={a.code}>{a.name} ({a.code})</option>)}</select></Field>
        <Field label="Scheme code"><input value={f.schemeCode} onChange={(e) => set("schemeCode", e.target.value)} disabled={mode === "edit"} placeholder="e.g. 119551" className="input-base font-mono" /></Field>
        <div className="sm:col-span-2"><Field label="Scheme name"><input value={f.schemeName} onChange={(e) => set("schemeName", e.target.value)} className="input-base" /></Field></div>
        <Field label="Coarse category"><select value={f.coarseCategory} onChange={(e) => set("coarseCategory", e.target.value)} className="input-base"><option value="">—</option>{COARSE.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></Field>
        <Field label="Category (fine)"><input value={f.category} onChange={(e) => set("category", e.target.value)} placeholder="Equity - Large Cap" className="input-base" /></Field>
        <Field label="Plan"><select value={f.plan} onChange={(e) => set("plan", e.target.value)} className="input-base"><option value="">—</option>{PLANS.map((p) => <option key={p} value={p} className="capitalize">{p}</option>)}</select></Field>
        <Field label="Option"><select value={f.option} onChange={(e) => set("option", e.target.value)} className="input-base"><option value="">—</option>{OPTIONS.map((p) => <option key={p} value={p}>{p.replace(/_/g, " ")}</option>)}</select></Field>
        <Field label="Risk"><select value={f.riskCategory} onChange={(e) => set("riskCategory", e.target.value)} className="input-base"><option value="">—</option>{RISKS.map((p) => <option key={p} value={p}>{p.replace(/_/g, " ")}</option>)}</select></Field>
        <Field label="Exit load"><input value={f.exitLoad} onChange={(e) => set("exitLoad", e.target.value)} placeholder="1% if < 1yr" className="input-base" /></Field>
        <Field label="Min SIP"><input value={f.minSip} onChange={(e) => set("minSip", e.target.value)} placeholder="500" className="input-base" /></Field>
        <Field label="Min investment"><input value={f.minInvestment} onChange={(e) => set("minInvestment", e.target.value)} placeholder="5000" className="input-base" /></Field>
        <label className="flex items-center gap-2 text-sm mt-5"><input type="checkbox" checked={f.isActive} onChange={(e) => set("isActive", e.target.checked)} className="size-4 rounded" /> Active</label>
        <label className="flex items-center gap-2 text-sm mt-5"><input type="checkbox" checked={f.isClosed} onChange={(e) => set("isClosed", e.target.checked)} className="size-4 rounded" /> Closed for purchase</label>
      </div>
      {err && <div className="text-sm text-rose-600 mt-2">{err}</div>}
      <DrawerFooter onClose={onClose} onSave={save} busy={busy} />
    </Drawer>
  );
}

function EvaluationDrawer({ scheme, onClose, onSaved }: { scheme: Scheme; onClose: () => void; onSaved: () => void }) {
  const ev = scheme.evaluation ?? {};
  const [f, setF] = useState({
    verdict: ev.verdict ?? "watch",
    schemeRiskProfile: ev.schemeRiskProfile ?? "",
    fmName: ev.fmName ?? "",
    fmExperienceYears: ev.fmExperienceYears ?? "",
    fiveYearCagrPct: ev.fiveYearCagrPct ?? "",
    consistencyPct: ev.consistencyPct ?? "",
    sharpeRatio: ev.sharpeRatio ?? "",
    stdDevPct: ev.stdDevPct ?? "",
    expenseRatioPct: ev.expenseRatioPct ?? "",
    aumCrore: ev.aumCrore ?? "",
    fundObjective: ev.fundObjective ?? "",
    portfolioCompositionNote: ev.portfolioCompositionNote ?? "",
    liquidityNote: ev.liquidityNote ?? "",
  });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  function set<K extends keyof typeof f>(k: K, v: (typeof f)[K]) { setF((s) => ({ ...s, [k]: v })); }
  const num = (v: any) => (v === "" || v == null ? undefined : Number(v));

  async function save() {
    setBusy(true); setErr(null);
    try {
      const res = await fetch(`/api/schemes/${scheme.id}/evaluation`, {
        method: "PUT", headers: { "content-type": "application/json" },
        body: JSON.stringify({
          verdict: f.verdict || undefined,
          schemeRiskProfile: f.schemeRiskProfile || undefined,
          fmName: f.fmName || undefined,
          fmExperienceYears: num(f.fmExperienceYears),
          fiveYearCagrPct: num(f.fiveYearCagrPct),
          consistencyPct: num(f.consistencyPct),
          sharpeRatio: num(f.sharpeRatio),
          stdDevPct: num(f.stdDevPct),
          expenseRatioPct: num(f.expenseRatioPct),
          aumCrore: num(f.aumCrore),
          fundObjective: f.fundObjective || undefined,
          portfolioCompositionNote: f.portfolioCompositionNote || undefined,
          liquidityNote: f.liquidityNote || undefined,
        }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) { setErr(j.error ?? `Save failed (${res.status})`); return; }
      onSaved();
    } finally { setBusy(false); }
  }

  return (
    <Drawer title={`IC evaluation — ${scheme.scheme_name}`} onClose={onClose}>
      <Field label="Verdict">
        <div className="flex gap-2">
          {["pass", "watch", "reject"].map((v) => (
            <button key={v} type="button" onClick={() => set("verdict", v)} className={`px-3 py-1.5 rounded-md text-xs font-medium capitalize border ${f.verdict === v ? (VERDICT_TONE[v] ?? "") + " border-current" : "border-border text-muted-foreground"}`}>{v}</button>
          ))}
        </div>
      </Field>
      <div className="grid grid-cols-2 gap-3 mt-3">
        <Field label="5y CAGR %"><input type="number" value={f.fiveYearCagrPct} onChange={(e) => set("fiveYearCagrPct", e.target.value)} className="input-base" /></Field>
        <Field label="Consistency %"><input type="number" value={f.consistencyPct} onChange={(e) => set("consistencyPct", e.target.value)} className="input-base" /></Field>
        <Field label="Sharpe ratio"><input type="number" step="0.01" value={f.sharpeRatio} onChange={(e) => set("sharpeRatio", e.target.value)} className="input-base" /></Field>
        <Field label="Std dev %"><input type="number" value={f.stdDevPct} onChange={(e) => set("stdDevPct", e.target.value)} className="input-base" /></Field>
        <Field label="Expense ratio %"><input type="number" step="0.01" value={f.expenseRatioPct} onChange={(e) => set("expenseRatioPct", e.target.value)} className="input-base" /></Field>
        <Field label="AUM (₹ Cr)"><input type="number" value={f.aumCrore} onChange={(e) => set("aumCrore", e.target.value)} className="input-base" /></Field>
        <Field label="Fund manager"><input value={f.fmName} onChange={(e) => set("fmName", e.target.value)} className="input-base" /></Field>
        <Field label="FM experience (yrs)"><input type="number" value={f.fmExperienceYears} onChange={(e) => set("fmExperienceYears", e.target.value)} className="input-base" /></Field>
        <Field label="Scheme risk"><select value={f.schemeRiskProfile} onChange={(e) => set("schemeRiskProfile", e.target.value)} className="input-base"><option value="">—</option>{["low", "moderate", "high", "very_high"].map((r) => <option key={r} value={r}>{r.replace(/_/g, " ")}</option>)}</select></Field>
      </div>
      <Field label="Fund objective"><textarea value={f.fundObjective} onChange={(e) => set("fundObjective", e.target.value)} rows={2} className="input-base" /></Field>
      <Field label="Portfolio composition note"><textarea value={f.portfolioCompositionNote} onChange={(e) => set("portfolioCompositionNote", e.target.value)} rows={2} className="input-base" /></Field>
      <Field label="Liquidity note"><input value={f.liquidityNote} onChange={(e) => set("liquidityNote", e.target.value)} className="input-base" /></Field>
      {err && <div className="text-sm text-rose-600 mt-2">{err}</div>}
      <DrawerFooter onClose={onClose} onSave={save} busy={busy} saveLabel="Save evaluation" />
    </Drawer>
  );
}

function Drawer({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex justify-end" onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} className="w-full max-w-lg h-full bg-card border-l border-border shadow-2xl flex flex-col">
        <div className="px-5 py-3 border-b flex items-center justify-between"><div className="font-semibold truncate">{title}</div><button onClick={onClose} className="rounded p-1 hover:bg-accent"><X className="size-4" /></button></div>
        <div className="flex-1 overflow-y-auto p-4 space-y-3">{children}</div>
      </div>
    </div>
  );
}
function DrawerFooter({ onClose, onSave, busy, saveLabel = "Save" }: { onClose: () => void; onSave: () => void; busy: boolean; saveLabel?: string }) {
  return (
    <div className="flex items-center justify-end gap-2 pt-3 border-t mt-3">
      <button onClick={onClose} className="btn-secondary text-xs">Cancel</button>
      <button onClick={onSave} disabled={busy} className="btn-primary text-xs inline-flex items-center gap-1">{busy ? <Loader2 className="size-3.5 animate-spin" /> : <Save className="size-3.5" />} {saveLabel}</button>
    </div>
  );
}
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="block"><div className="text-[11px] text-muted-foreground mb-0.5">{label}</div>{children}</label>;
}
