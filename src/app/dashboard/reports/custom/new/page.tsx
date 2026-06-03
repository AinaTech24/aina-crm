"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { ChevronLeft, BarChart3, Loader2, Save, Table2, Grid3x3 } from "lucide-react";
import { CATALOGS } from "@/lib/filter/catalog";
import { FilterBuilder } from "@/components/filter/FilterBuilder";

const SUBJECTS: [string, string][] = [
  ["investor", "Clients"],
  ["lead", "Leads"],
  ["task", "Tasks"],
  ["user", "Users / Team"],
  ["transaction", "MF Transactions"],
  ["sip", "SIPs"],
  ["insurance", "Insurance Policies"],
  ["goal", "Goals"],
  ["service_request", "Service Requests"],
  ["claim", "Insurance Claims"],
];
type Group = { type: "group"; op: "AND" | "OR"; not?: boolean; children: any[] };
const emptyGroup = (): Group => ({ type: "group", op: "AND", children: [] });
const NUMERIC_TYPES = new Set(["number", "integer", "currency"]);

export default function NewReportPage() {
  return (
    <Suspense fallback={<div className="grid place-items-center min-h-[300px]"><Loader2 className="size-6 animate-spin text-brand-cyan" /></div>}>
      <Builder />
    </Suspense>
  );
}

function Builder() {
  const router = useRouter();
  const editId = useSearchParams().get("edit");

  const [form, setForm] = useState({ name: "", description: "", subject: "investor", reportType: "detailed" as "detailed" | "matrix", sharedScope: "private", chartType: "none" });
  const [ast, setAst] = useState<Group>(emptyGroup());
  const [columns, setColumns] = useState<string[]>([]);
  const [sort, setSort] = useState<{ field: string; dir: "asc" | "desc" } | null>(null);
  const [matrix, setMatrix] = useState<{ groupBy: string; pivot: string; aggregate: "count" | "sum"; measure: string }>({ groupBy: "", pivot: "", aggregate: "count", measure: "" });
  const [schedule, setSchedule] = useState({ enabled: false, freq: "weekly", hour: 9, day: 1, emails: "" });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const cat = CATALOGS[form.subject] ?? CATALOGS.investor;
  const numericFields = useMemo(() => cat.fields.filter((f) => NUMERIC_TYPES.has(f.type)), [cat]);

  // Default columns / groupBy when subject changes (and nothing chosen yet).
  useEffect(() => {
    if (!editId) {
      setColumns(cat.fields.slice(0, 5).map((f) => f.key));
      setMatrix((m) => ({ ...m, groupBy: cat.fields[0]?.key ?? "", pivot: "", measure: "" }));
      setSort(null);
      setAst(emptyGroup());
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.subject]);

  // Load on edit
  useEffect(() => {
    if (!editId) return;
    (async () => {
      const r = await fetch(`/api/reports/saved/${editId}`);
      if (!r.ok) return;
      const d = await r.json();
      setForm({ name: d.name ?? "", description: d.description ?? "", subject: d.subject, reportType: d.reportType, sharedScope: d.sharedScope ?? "private", chartType: d.chartType ?? "none" });
      setAst(d.ast ?? emptyGroup());
      setColumns(d.columns ?? []);
      setSort(d.sort ?? null);
      if (d.matrix) setMatrix({ groupBy: d.matrix.groupBy ?? "", pivot: d.matrix.pivot ?? "", aggregate: d.matrix.aggregate ?? "count", measure: d.matrix.measure ?? "" });
      if (d.schedule) setSchedule({ enabled: !!d.schedule.enabled, freq: d.schedule.freq ?? "weekly", hour: d.schedule.hour ?? 9, day: d.schedule.day ?? 1, emails: (d.schedule.emails ?? []).join(", ") });
    })();
  }, [editId]);

  function toggleCol(key: string) {
    setColumns((cols) => (cols.includes(key) ? cols.filter((c) => c !== key) : [...cols, key]));
  }

  async function save() {
    setErr(null);
    if (!form.name.trim()) return setErr("Give your report a name.");
    if (form.reportType === "detailed" && columns.length === 0) return setErr("Pick at least one column.");
    if (form.reportType === "matrix" && !matrix.groupBy) return setErr("Pick a 'group by' field.");
    if (form.reportType === "matrix" && matrix.aggregate === "sum" && !matrix.measure) return setErr("Pick a field to sum.");
    setBusy(true);
    try {
      const payload: any = {
        name: form.name,
        description: form.description || undefined,
        subject: form.subject,
        reportType: form.reportType,
        sharedScope: form.sharedScope,
        chartType: form.reportType === "matrix" ? form.chartType : "none",
        ast,
        columns: form.reportType === "detailed" ? columns : undefined,
        sort: form.reportType === "detailed" ? sort : undefined,
        matrix:
          form.reportType === "matrix"
            ? { groupBy: matrix.groupBy, pivot: matrix.pivot || undefined, aggregate: matrix.aggregate, measure: matrix.aggregate === "sum" ? matrix.measure : undefined }
            : undefined,
        schedule:
          schedule.enabled && schedule.emails.trim()
            ? {
                freq: schedule.freq,
                hour: Number(schedule.hour),
                day: schedule.freq === "daily" ? undefined : Number(schedule.day),
                emails: schedule.emails.split(",").map((s) => s.trim()).filter(Boolean),
                enabled: true,
              }
            : null,
      };
      const res = await fetch(editId ? `/api/reports/saved/${editId}` : "/api/reports/saved", {
        method: editId ? "PATCH" : "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      const j = await res.json();
      if (!res.ok) {
        setErr(j.error ?? "Save failed");
        return;
      }
      router.push(`/dashboard/reports/custom/${editId ?? j.id}`);
    } catch (e: any) {
      setErr(e.message ?? "Save failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4 max-w-4xl">
      <Link href="/dashboard/reports/custom" className="text-sm text-muted-foreground hover:text-foreground flex items-center gap-1">
        <ChevronLeft className="size-4" /> Back to custom reports
      </Link>
      <div>
        <h1 className="page-title">
          <BarChart3 className="size-6 text-brand-cyan" /> {editId ? "Edit report" : "New report"}
        </h1>
        <p className="page-subtitle">Choose a module, filter the rows, and pick a detailed or matrix layout.</p>
      </div>

      {/* 1. Details */}
      <Section title="1. Report details">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Name *"><input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. HNI clients with no review in 90 days" className="input-base" /></Field>
          <Field label="Module">
            <select value={form.subject} onChange={(e) => setForm({ ...form, subject: e.target.value })} className="input-base">
              {SUBJECTS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
            </select>
          </Field>
        </div>
        <Field label="Description"><input value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="Optional — what this report shows" className="input-base" /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Layout">
            <div className="inline-flex rounded-lg border border-border bg-card p-0.5 w-full">
              {(["detailed", "matrix"] as const).map((t) => (
                <button key={t} type="button" onClick={() => setForm({ ...form, reportType: t })} className={`flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${form.reportType === t ? "bg-brand-navy text-white" : "text-muted-foreground hover:text-foreground"}`}>
                  {t === "matrix" ? <Grid3x3 className="size-3.5" /> : <Table2 className="size-3.5" />} {t === "matrix" ? "Matrix" : "Detailed"}
                </button>
              ))}
            </div>
          </Field>
          <Field label="Sharing">
            <select value={form.sharedScope} onChange={(e) => setForm({ ...form, sharedScope: e.target.value })} className="input-base">
              <option value="private">Private — only me</option>
              <option value="team">Team — my branch</option>
              <option value="tenant">Everyone in the firm</option>
            </select>
          </Field>
        </div>
      </Section>

      {/* 2. Filter */}
      <Section title="2. Filter rows">
        <FilterBuilder subject={form.subject} value={ast} onChange={setAst} />
      </Section>

      {/* 3. Layout config */}
      {form.reportType === "detailed" ? (
        <Section title="3. Columns & sort">
          <div>
            <div className="text-xs font-medium mb-1.5">Columns to show</div>
            <div className="flex flex-wrap gap-1.5">
              {cat.fields.map((f) => {
                const on = columns.includes(f.key);
                return (
                  <button key={f.key} type="button" onClick={() => toggleCol(f.key)} className={`text-xs rounded-full px-2.5 py-1 border transition-colors ${on ? "bg-brand-cyan text-white border-brand-cyan" : "bg-secondary/40 text-muted-foreground border-border hover:bg-secondary"}`}>
                    {f.label}
                  </button>
                );
              })}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Sort by">
              <select value={sort?.field ?? ""} onChange={(e) => setSort(e.target.value ? { field: e.target.value, dir: sort?.dir ?? "desc" } : null)} className="input-base">
                <option value="">— none —</option>
                {cat.fields.map((f) => <option key={f.key} value={f.key}>{f.label}</option>)}
              </select>
            </Field>
            {sort && (
              <Field label="Direction">
                <select value={sort.dir} onChange={(e) => setSort({ ...sort, dir: e.target.value as "asc" | "desc" })} className="input-base">
                  <option value="desc">High → Low / Newest</option>
                  <option value="asc">Low → High / Oldest</option>
                </select>
              </Field>
            )}
          </div>
        </Section>
      ) : (
        <Section title="3. Matrix layout">
          <div className="grid grid-cols-2 gap-3">
            <Field label="Group rows by *">
              <select value={matrix.groupBy} onChange={(e) => setMatrix({ ...matrix, groupBy: e.target.value })} className="input-base">
                {cat.fields.map((f) => <option key={f.key} value={f.key}>{f.label}</option>)}
              </select>
            </Field>
            <Field label="Pivot columns by (optional)">
              <select value={matrix.pivot} onChange={(e) => setMatrix({ ...matrix, pivot: e.target.value })} className="input-base">
                <option value="">— single column —</option>
                {cat.fields.map((f) => <option key={f.key} value={f.key}>{f.label}</option>)}
              </select>
            </Field>
            <Field label="Measure">
              <select value={matrix.aggregate} onChange={(e) => setMatrix({ ...matrix, aggregate: e.target.value as "count" | "sum" })} className="input-base">
                <option value="count">Count of rows</option>
                <option value="sum">Sum of a field</option>
              </select>
            </Field>
            {matrix.aggregate === "sum" && (
              <Field label="Sum field *">
                <select value={matrix.measure} onChange={(e) => setMatrix({ ...matrix, measure: e.target.value })} className="input-base">
                  <option value="">— pick a number field —</option>
                  {numericFields.map((f) => <option key={f.key} value={f.key}>{f.label}</option>)}
                </select>
              </Field>
            )}
            <Field label="Chart">
              <select value={form.chartType} onChange={(e) => setForm({ ...form, chartType: e.target.value })} className="input-base">
                <option value="none">No chart</option>
                <option value="bar">Bar chart</option>
                <option value="pie">Pie chart</option>
                <option value="line">Line chart</option>
              </select>
            </Field>
          </div>
          <p className="text-[11px] text-muted-foreground">
            Example: group by RM, pivot by status, count → an RM × status cross-tab.
          </p>
        </Section>
      )}

      <Section title="4. Email schedule (optional)">
        <label className="flex items-center gap-2 text-sm cursor-pointer">
          <input type="checkbox" checked={schedule.enabled} onChange={(e) => setSchedule({ ...schedule, enabled: e.target.checked })} />
          Email this report automatically
        </label>
        {schedule.enabled && (
          <div className="grid grid-cols-2 gap-3">
            <Field label="Frequency">
              <select value={schedule.freq} onChange={(e) => setSchedule({ ...schedule, freq: e.target.value })} className="input-base">
                <option value="daily">Every day</option>
                <option value="weekly">Every week</option>
                <option value="monthly">Every month</option>
              </select>
            </Field>
            {schedule.freq === "weekly" && (
              <Field label="Day of week">
                <select value={schedule.day} onChange={(e) => setSchedule({ ...schedule, day: Number(e.target.value) })} className="input-base">
                  {["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"].map((d, i) => <option key={i} value={i}>{d}</option>)}
                </select>
              </Field>
            )}
            {schedule.freq === "monthly" && (
              <Field label="Day of month (1–28)">
                <input type="number" min={1} max={28} value={schedule.day} onChange={(e) => setSchedule({ ...schedule, day: Number(e.target.value) })} className="input-base" />
              </Field>
            )}
            <Field label="Hour (0–23)">
              <input type="number" min={0} max={23} value={schedule.hour} onChange={(e) => setSchedule({ ...schedule, hour: Number(e.target.value) })} className="input-base" />
            </Field>
            <div className="col-span-2">
              <Field label="Recipients — comma-separated emails">
                <input value={schedule.emails} onChange={(e) => setSchedule({ ...schedule, emails: e.target.value })} placeholder="rm@firm.com, owner@firm.com" className="input-base" />
              </Field>
            </div>
          </div>
        )}
      </Section>

      {err && <div className="rounded-lg border border-destructive/30 bg-destructive/5 text-destructive text-sm px-3 py-2">{err}</div>}

      <div className="flex justify-end gap-2 pb-8">
        <Link href="/dashboard/reports/custom" className="btn-secondary">Cancel</Link>
        <button type="button" onClick={save} disabled={busy} className="btn-primary">
          {busy ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
          {busy ? "Saving…" : editId ? "Update report" : "Save & run"}
        </button>
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="card-surface p-5 space-y-3">
      <div className="flex items-center gap-2">
        <div className="h-4 w-1 rounded-full brand-bar" />
        <h2 className="section-title">{title}</h2>
      </div>
      {children}
    </div>
  );
}
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <div className="text-xs font-medium mb-1">{label}</div>
      {children}
    </label>
  );
}
