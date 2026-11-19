"use client";

import { PageHeaderCard } from "@/components/layout/PageHeaderCard";
import { Suspense, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { ChevronLeft, BarChart3, Loader2, Save, Table2, Grid3x3, Rows3, Plus, X, ArrowUp, ArrowDown } from "lucide-react";
import { CATALOGS, type FieldDef } from "@/lib/filter/catalog";
import { FilterBuilder } from "@/components/filter/FilterBuilder";
import { SelectField } from "@/components/ui/SelectField";
import { TeamMultiSelect } from "@/components/common/TeamMultiSelect";
import { DATE_GRAINS, DATE_GRAIN_LABEL, splitGroupKey } from "@/lib/reports/grouping";
import { MAX_BUCKETS, MAX_CATEGORY_COLUMNS, type CategoryColumn } from "@/lib/reports/categories";

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
type Agg = { fn: "count" | "sum" | "avg" | "min" | "max"; field: string };
type ReportType = "detailed" | "summary" | "matrix";
type Option = { key: string; label: string; type?: string };

const emptyGroup = (): Group => ({ type: "group", op: "AND", children: [] });
const NUMERIC_TYPES = new Set(["number", "integer", "currency"]);
const isDateType = (t?: string) => t === "date" || t === "datetime";
const AGG_OPTS: [Agg["fn"], string][] = [
  ["count", "Count of records"],
  ["sum", "Sum"],
  ["avg", "Average"],
  ["min", "Minimum"],
  ["max", "Maximum"],
];
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

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
  const [form, setForm] = useState({ name: "", description: "", subject: "investor", reportType: "detailed" as ReportType, sharedScope: "private", chartType: "none", folder: "" });
  const [ast, setAst] = useState<Group>(emptyGroup());
  const [columns, setColumns] = useState<string[]>([]);
  const [sort, setSort] = useState<{ field: string; dir: "asc" | "desc" } | null>(null);
  const [matrix, setMatrix] = useState<{ groupBy: string; pivot: string; aggregate: Agg["fn"]; measure: string; rowSort: "key" | "total" }>({ groupBy: "", pivot: "", aggregate: "count", measure: "", rowSort: "key" });
  const [summary, setSummary] = useState<{ groupBy: string[]; columns: string[]; aggregates: Agg[]; showDetailRows: boolean; groupSort: "key" | "count" | "value" }>({ groupBy: [""], columns: [], aggregates: [{ fn: "count", field: "" }], showDetailRows: true, groupSort: "key" });
  const [categories, setCategories] = useState<CategoryColumn[]>([]);
  const [chartOptions, setChartOptions] = useState({ target: "", limit: "" });
  const [schedule, setSchedule] = useState({ enabled: false, freq: "weekly", hour: 9, day: 1, month: 4, emails: "", userIds: [] as string[], attach: true });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  // Meetings as a module: only for a firm with the Zoho import flag (We Care).
  const [meetingsOn, setMeetingsOn] = useState(false);
  useEffect(() => {
    fetch("/api/imports/zoho/contacts").then((r) => r.json()).then((j) => setMeetingsOn(!!j?.enabled)).catch(() => {});
  }, []);

  const cat = CATALOGS[form.subject] ?? CATALOGS.investor;
  const numericFields = useMemo(() => cat.fields.filter((f) => NUMERIC_TYPES.has(f.type)), [cat]);
  // What can be a column or a group: the subject's fields, then this report's category columns.
  const columnOptions: Option[] = useMemo(
    () => [...cat.fields.map((f) => ({ key: f.key, label: f.label, type: f.type })), ...categories.map((c) => ({ key: `cat:${c.id}`, label: `${c.label} (category)`, type: "string" }))],
    [cat, categories],
  );

  // Default config when subject changes (and nothing chosen yet).
  useEffect(() => {
    if (!editId) {
      setColumns(cat.fields.slice(0, 5).map((f) => f.key));
      setMatrix((m) => ({ ...m, groupBy: cat.fields[0]?.key ?? "", pivot: "", measure: "" }));
      setSummary({ groupBy: [cat.fields[0]?.key ?? ""], columns: cat.fields.slice(0, 4).map((f) => f.key), aggregates: [{ fn: "count", field: "" }], showDetailRows: true, groupSort: "key" });
      setSort(null);
      setAst(emptyGroup());
      setCategories([]);
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
      setForm({ name: d.name ?? "", description: d.description ?? "", subject: d.subject, reportType: d.reportType, sharedScope: d.sharedScope ?? "private", chartType: d.chartType ?? "none", folder: d.folder ?? "" });
      setAst(d.ast ?? emptyGroup());
      setColumns(d.columns ?? []);
      setSort(d.sort ?? null);
      setCategories(d.categories ?? []);
      setChartOptions({ target: d.chartOptions?.target != null ? String(d.chartOptions.target) : "", limit: d.chartOptions?.limit != null ? String(d.chartOptions.limit) : "" });
      if (d.matrix) setMatrix({ groupBy: d.matrix.groupBy ?? "", pivot: d.matrix.pivot ?? "", aggregate: d.matrix.aggregate ?? "count", measure: d.matrix.measure ?? "", rowSort: d.matrix.rowSort ?? "key" });
      if (d.summary)
        setSummary({
          groupBy: d.summary.groupBy?.length ? d.summary.groupBy : [""],
          columns: d.summary.columns ?? [],
          aggregates: d.summary.aggregates?.length ? d.summary.aggregates.map((a: any) => ({ fn: a.fn, field: a.field ?? "" })) : [{ fn: "count", field: "" }],
          showDetailRows: d.summary.showDetailRows ?? true,
          groupSort: d.summary.groupSort ?? "key",
        });
      if (d.schedule)
        setSchedule({
          enabled: !!d.schedule.enabled,
          freq: d.schedule.freq ?? "weekly",
          hour: d.schedule.hour ?? 9,
          day: d.schedule.day ?? 1,
          month: d.schedule.month ?? 4,
          emails: (d.schedule.emails ?? []).join(", "),
          userIds: d.schedule.userIds ?? [],
          attach: d.schedule.attach ?? false,
        });
    })();
  }, [editId]);

  async function save() {
    setErr(null);
    if (!form.name.trim()) return setErr("Give your report a name.");
    if (form.reportType === "detailed" && columns.length === 0) return setErr("Pick at least one column.");
    if (form.reportType === "matrix" && !matrix.groupBy) return setErr("Pick a 'group by' field.");
    if (form.reportType === "matrix" && matrix.aggregate !== "count" && !matrix.measure) return setErr("Pick a field to aggregate.");
    if (form.reportType === "summary") {
      const gb = summary.groupBy.filter(Boolean);
      if (gb.length === 0) return setErr("Pick at least one 'group by' field.");
      if (summary.aggregates.some((a) => a.fn !== "count" && !a.field)) return setErr("Each non-count summary needs a field.");
    }
    const emailList = schedule.emails.split(",").map((s) => s.trim()).filter(Boolean);
    const target = chartOptions.target.trim() === "" ? null : Number(chartOptions.target);
    const limit = chartOptions.limit.trim() === "" ? null : Math.trunc(Number(chartOptions.limit));
    if (target != null && !Number.isFinite(target)) return setErr("The chart target must be a number.");
    if (limit != null && !(limit >= 1 && limit <= 100)) return setErr("Show between 1 and 100 groups on the chart.");
    const charted = form.reportType !== "detailed" && form.chartType !== "none";

    setBusy(true);
    try {
      const payload: any = {
        name: form.name,
        description: form.description || undefined,
        subject: form.subject,
        reportType: form.reportType,
        sharedScope: form.sharedScope,
        folder: form.folder.trim() || null,
        chartType: form.reportType === "detailed" ? "none" : form.chartType,
        chartOptions: charted && (target != null || limit != null) ? { target, limit } : null,
        categories: categories.length ? categories : null,
        ast,
        columns: form.reportType === "detailed" ? columns : undefined,
        sort: form.reportType === "detailed" ? sort : undefined,
        matrix:
          form.reportType === "matrix"
            ? { groupBy: matrix.groupBy, pivot: matrix.pivot || undefined, aggregate: matrix.aggregate, measure: matrix.aggregate !== "count" ? matrix.measure : undefined, rowSort: matrix.rowSort }
            : undefined,
        summary:
          form.reportType === "summary"
            ? {
                groupBy: summary.groupBy.filter(Boolean),
                columns: summary.columns,
                aggregates: summary.aggregates.map((a) => ({ fn: a.fn, field: a.fn === "count" ? undefined : a.field })),
                showDetailRows: summary.showDetailRows,
                groupSort: summary.groupSort,
              }
            : undefined,
        schedule:
          schedule.enabled && (emailList.length || schedule.userIds.length)
            ? {
                freq: schedule.freq,
                hour: Number(schedule.hour),
                day: schedule.freq === "daily" ? undefined : Number(schedule.day),
                month: schedule.freq === "yearly" ? Number(schedule.month) : undefined,
                emails: emailList,
                userIds: schedule.userIds,
                attach: schedule.attach,
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

  const LAYOUTS: [ReportType, string, React.ReactNode][] = [
    ["detailed", "Detailed", <Table2 key="d" className="size-3.5" />],
    ["summary", "Summary", <Rows3 key="s" className="size-3.5" />],
    ["matrix", "Matrix", <Grid3x3 key="m" className="size-3.5" />],
  ];

  const chartFields = (
    <>
      <Field label="Chart">
        <SelectField value={form.chartType} onChange={(e) => setForm({ ...form, chartType: e.target.value })} className="w-full">
          <option value="none">No chart</option>
          <option value="bar">Bar chart</option>
          <option value="line">Line chart</option>
          <option value="area">Area chart</option>
          <option value="pie">Pie chart</option>
          <option value="donut">Donut chart</option>
        </SelectField>
      </Field>
      {form.chartType !== "none" && (
        <>
          {form.chartType !== "pie" && form.chartType !== "donut" && (
            <Field label="Target line (optional)">
              <input type="number" value={chartOptions.target} onChange={(e) => setChartOptions({ ...chartOptions, target: e.target.value })} placeholder="e.g. 5000000" className="input-base" />
            </Field>
          )}
          <Field label="Show the largest groups only (optional)">
            <input type="number" min={1} max={100} value={chartOptions.limit} onChange={(e) => setChartOptions({ ...chartOptions, limit: e.target.value })} placeholder="e.g. 10" className="input-base" />
          </Field>
        </>
      )}
    </>
  );

  return (
    <div className="space-y-4 max-w-4xl">
      <Link href="/dashboard/reports/custom" className="text-sm text-muted-foreground hover:text-foreground flex items-center gap-1">
        <ChevronLeft className="size-4" /> Back to custom reports
      </Link>

      <PageHeaderCard title={<><BarChart3 className="size-6 text-muted-foreground" /> {editId ? "Edit report" : "New report"}</>} />

      {/* 1. Details */}
      <Section title="1. Report details">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Field label="Name *"><input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. HNI clients with no review in 90 days" className="input-base" /></Field>
          <Field label="Module">
            <SelectField value={form.subject} onChange={(e) => setForm({ ...form, subject: e.target.value })} className="w-full">
              {[...SUBJECTS, ...(meetingsOn || form.subject === "review_meeting" || form.subject === "business_line" ? ([["review_meeting", "Meetings"], ["business_line", "Business Entries (scheme lines)"]] as [string, string][]) : [])].map(([k, l]) => <option key={k} value={k}>{l}</option>)}
            </SelectField>
          </Field>
        </div>
        <Field label="Description"><input value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="Optional — what this report shows" className="input-base" /></Field>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <Field label="Layout">
            <div className="inline-flex rounded-lg border border-border bg-card p-0.5 w-full">
              {LAYOUTS.map(([t, lbl, icon]) => (
                <button key={t} type="button" onClick={() => setForm({ ...form, reportType: t })} className={`flex-1 inline-flex items-center justify-center gap-1.5 px-2 py-1.5 rounded-md text-sm font-medium transition-colors ${form.reportType === t ? "bg-brand-navy text-white" : "text-muted-foreground hover:text-foreground"}`}>
                  {icon} {lbl}
                </button>
              ))}
            </div>
          </Field>
          <Field label="Folder">
            <input value={form.folder} onChange={(e) => setForm({ ...form, folder: e.target.value })} placeholder="e.g. Sales, Compliance" className="input-base" list="report-folders" />
          </Field>
          <Field label="Sharing">
            <SelectField value={form.sharedScope} onChange={(e) => setForm({ ...form, sharedScope: e.target.value })} className="w-full">
              <option value="private">Private — only me</option>
              <option value="team">Team — my branch</option>
              <option value="tenant">Everyone in the firm</option>
            </SelectField>
          </Field>
        </div>
      </Section>

      {/* 2. Filter */}
      <Section title="2. Filter rows">
        <FilterBuilder subject={form.subject} value={ast} onChange={setAst} />
      </Section>

      {/* Category columns */}
      <Section title="Category columns (optional)">
        <CategoryEditor fields={cat.fields} value={categories} onChange={setCategories} />
      </Section>

      {/* 3. Layout config */}
      {form.reportType === "detailed" && (
        <Section title="3. Columns & sort">
          <ColumnEditor fields={columnOptions} selected={columns} onChange={setColumns} />
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field label="Sort by">
              <SelectField value={sort?.field ?? ""} onChange={(e) => setSort(e.target.value ? { field: e.target.value, dir: sort?.dir ?? "desc" } : null)} className="w-full">
                <option value="">— none —</option>
                {cat.fields.map((f) => <option key={f.key} value={f.key}>{f.label}</option>)}
              </SelectField>
            </Field>
            {sort && (
              <Field label="Direction">
                <SelectField value={sort.dir} onChange={(e) => setSort({ ...sort, dir: e.target.value as "asc" | "desc" })} className="w-full">
                  <option value="desc">High → Low / Newest</option>
                  <option value="asc">Low → High / Oldest</option>
                </SelectField>
              </Field>
            )}
          </div>
        </Section>
      )}

      {form.reportType === "summary" && (
        <Section title="3. Grouping & totals">
          <div>
            <div className="text-xs font-medium mb-1.5">Group rows by (up to 3 levels)</div>
            <div className="space-y-2">
              {[0, 1, 2].map((i) => (
                <GroupPicker
                  key={i}
                  options={columnOptions}
                  value={summary.groupBy[i] ?? ""}
                  noneLabel={i === 0 ? "— pick a field —" : "— none —"}
                  onChange={(v) => {
                    const gb = [...summary.groupBy];
                    gb[i] = v;
                    setSummary({ ...summary, groupBy: gb.filter((x, idx) => x || idx === 0).slice(0, 3) });
                  }}
                />
              ))}
            </div>
          </div>
          <div>
            <div className="text-xs font-medium mb-1.5">Summarise (aggregate columns)</div>
            <div className="space-y-2">
              {summary.aggregates.map((a, i) => (
                <div key={i} className="flex items-center gap-2">
                  <SelectField
                    value={a.fn}
                    onChange={(e) => {
                      const next = [...summary.aggregates];
                      next[i] = { ...a, fn: e.target.value as Agg["fn"] };
                      setSummary({ ...summary, aggregates: next });
                    }}
                    className="max-w-[180px]"
                  >
                    {AGG_OPTS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                  </SelectField>
                  {a.fn !== "count" && (
                    <SelectField
                      value={a.field}
                      onChange={(e) => {
                        const next = [...summary.aggregates];
                        next[i] = { ...a, field: e.target.value };
                        setSummary({ ...summary, aggregates: next });
                      }}
                      className="flex-1"
                    >
                      <option value="">— pick a number field —</option>
                      {numericFields.map((f) => <option key={f.key} value={f.key}>{f.label}</option>)}
                    </SelectField>
                  )}
                  <button type="button" onClick={() => setSummary({ ...summary, aggregates: summary.aggregates.filter((_, idx) => idx !== i) })} className="btn-icon hover:text-destructive" aria-label="Remove">
                    <X className="size-4" />
                  </button>
                </div>
              ))}
              <button type="button" onClick={() => setSummary({ ...summary, aggregates: [...summary.aggregates, { fn: "sum", field: "" }] })} className="text-xs text-brand-cyan-deep hover:underline inline-flex items-center gap-1">
                <Plus className="size-3.5" /> Add summary column
              </button>
            </div>
            <p className="text-2xs text-muted-foreground mt-1">A record count is always shown per group. Sub-totals + grand total are computed automatically.</p>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field label="Order groups by">
              <SelectField value={summary.groupSort} onChange={(e) => setSummary({ ...summary, groupSort: e.target.value as "key" | "count" | "value" })} className="w-full">
                <option value="key">Group name (A–Z, dates in order)</option>
                <option value="count">Most records first</option>
                <option value="value">Largest first summary column first</option>
              </SelectField>
            </Field>
            {chartFields}
          </div>
          <label className="flex items-center gap-2 text-sm cursor-pointer">
            <input type="checkbox" checked={summary.showDetailRows} onChange={(e) => setSummary({ ...summary, showDetailRows: e.target.checked })} />
            Show detail rows under each group
          </label>
          {summary.showDetailRows && (
            <div className="pt-1">
              <div className="text-xs font-medium mb-1.5">Detail-row columns</div>
              <ColumnEditor fields={columnOptions} selected={summary.columns} onChange={(c) => setSummary({ ...summary, columns: c })} />
            </div>
          )}
        </Section>
      )}

      {form.reportType === "matrix" && (
        <Section title="3. Matrix layout">
          <div className="space-y-2">
            <div className="text-xs font-medium">Group rows by *</div>
            <GroupPicker options={columnOptions} value={matrix.groupBy} onChange={(v) => setMatrix({ ...matrix, groupBy: v })} />
            <div className="text-xs font-medium pt-1">Pivot columns by (optional)</div>
            <GroupPicker options={columnOptions} value={matrix.pivot} noneLabel="— single column —" onChange={(v) => setMatrix({ ...matrix, pivot: v })} />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field label="Aggregate">
              <SelectField value={matrix.aggregate} onChange={(e) => setMatrix({ ...matrix, aggregate: e.target.value as Agg["fn"] })} className="w-full">
                {AGG_OPTS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </SelectField>
            </Field>
            {matrix.aggregate !== "count" && (
              <Field label="On field *">
                <SelectField value={matrix.measure} onChange={(e) => setMatrix({ ...matrix, measure: e.target.value })} className="w-full">
                  <option value="">— pick a number field —</option>
                  {numericFields.map((f) => <option key={f.key} value={f.key}>{f.label}</option>)}
                </SelectField>
              </Field>
            )}
            <Field label="Order rows by">
              <SelectField value={matrix.rowSort} onChange={(e) => setMatrix({ ...matrix, rowSort: e.target.value as "key" | "total" })} className="w-full">
                <option value="key">Row name (A–Z, dates in order)</option>
                <option value="total">Largest total first</option>
              </SelectField>
            </Field>
            {chartFields}
          </div>
          <p className="text-2xs text-muted-foreground">
            Example: group by RM, pivot by Onboarded on (by month), count → each RM&apos;s new clients month by month.
          </p>
        </Section>
      )}

      <Section title="4. Email schedule (optional)">
        <label className="flex items-center gap-2 text-sm cursor-pointer">
          <input type="checkbox" checked={schedule.enabled} onChange={(e) => setSchedule({ ...schedule, enabled: e.target.checked })} />
          Email this report automatically
        </label>
        {schedule.enabled && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field label="Frequency">
              <SelectField value={schedule.freq} onChange={(e) => setSchedule({ ...schedule, freq: e.target.value })} className="w-full">
                <option value="daily">Every day</option>
                <option value="weekly">Every week</option>
                <option value="monthly">Every month</option>
                <option value="yearly">Every year</option>
              </SelectField>
            </Field>
            {schedule.freq === "weekly" && (
              <Field label="Day of week">
                <SelectField value={String(schedule.day)} onChange={(e) => setSchedule({ ...schedule, day: Number(e.target.value) })} className="w-full">
                  {["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"].map((d, i) => <option key={i} value={i}>{d}</option>)}
                </SelectField>
              </Field>
            )}
            {schedule.freq === "yearly" && (
              <Field label="Month">
                <SelectField value={String(schedule.month)} onChange={(e) => setSchedule({ ...schedule, month: Number(e.target.value) })} className="w-full">
                  {MONTHS.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
                </SelectField>
              </Field>
            )}
            {(schedule.freq === "monthly" || schedule.freq === "yearly") && (
              <Field label="Day of month (1–28)">
                <input type="number" min={1} max={28} value={schedule.day} onChange={(e) => setSchedule({ ...schedule, day: Number(e.target.value) })} className="input-base" />
              </Field>
            )}
            <Field label="Time (India)">
              <SelectField value={String(schedule.hour)} onChange={(e) => setSchedule({ ...schedule, hour: Number(e.target.value) })} className="w-full">
                {Array.from({ length: 24 }, (_, h) => (
                  <option key={h} value={h}>{`${String(h).padStart(2, "0")}:00`}</option>
                ))}
              </SelectField>
            </Field>
            <div className="sm:col-span-2 space-y-1">
              <div className="text-xs font-medium">Team members</div>
              <TeamMultiSelect value={schedule.userIds} onChange={(ids) => setSchedule({ ...schedule, userIds: ids })} max={50} placeholder="+ Add a team member" />
            </div>
            <div className="sm:col-span-2">
              <Field label="Other recipients — comma-separated emails">
                <input value={schedule.emails} onChange={(e) => setSchedule({ ...schedule, emails: e.target.value })} placeholder="ca@example.com" className="input-base" />
              </Field>
            </div>
            <label className="flex items-center gap-2 text-sm cursor-pointer sm:col-span-2">
              <input type="checkbox" checked={schedule.attach} onChange={(e) => setSchedule({ ...schedule, attach: e.target.checked })} />
              Attach the full report as an Excel file
            </label>
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

/**
 * A group-by / pivot field. A DATE field is grouped by a period — month by
 * default — instead of one row per day ("onboarded_at@month").
 */
function GroupPicker({ options, value, onChange, noneLabel }: { options: Option[]; value: string; onChange: (v: string) => void; noneLabel?: string }) {
  const { field, grain } = splitGroupKey(value);
  const opt = options.find((o) => o.key === field);
  const dated = isDateType(opt?.type);
  return (
    <div className="flex flex-wrap items-center gap-2">
      <SelectField
        value={field}
        onChange={(e) => {
          const next = options.find((o) => o.key === e.target.value);
          onChange(next && isDateType(next.type) ? `${next.key}@month` : e.target.value);
        }}
        className="flex-1 min-w-48"
      >
        {noneLabel !== undefined && <option value="">{noneLabel}</option>}
        {options.map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}
      </SelectField>
      {dated && (
        <SelectField value={grain ?? ""} onChange={(e) => onChange(e.target.value ? `${field}@${e.target.value}` : field)} className="min-w-44" aria-label="Group dates by">
          {DATE_GRAINS.map((g) => <option key={g} value={g}>By {DATE_GRAIN_LABEL[g].toLowerCase()}</option>)}
          <option value="">Exact date</option>
        </SelectField>
      )}
    </div>
  );
}

/**
 * Category columns: a number cut into bands, or values gathered into groups —
 * then usable as a column, a group or a pivot ("cat:<id>").
 */
function CategoryEditor({ fields, value, onChange }: { fields: FieldDef[]; value: CategoryColumn[]; onChange: (v: CategoryColumn[]) => void }) {
  const numeric = fields.filter((f) => NUMERIC_TYPES.has(f.type));
  const valued = fields.filter((f) => f.type === "string" || f.type === "enum");
  const set = (i: number, c: CategoryColumn) => onChange(value.map((x, j) => (j === i ? c : x)));
  const nextId = () => {
    for (let n = 1; n < 99; n++) if (!value.some((c) => c.id === `c${n}`)) return `c${n}`;
    return "c99";
  };
  return (
    <div className="space-y-3">
      {value.length === 0 && <p className="text-xs text-muted-foreground">Group a number into bands (AUM: up to ₹10 L · ₹10 L–1 Cr · above ₹1 Cr) or values into named groups (cities into regions).</p>}
      {value.map((c, i) => (
        <div key={c.id} className="rounded-lg border border-border p-3 space-y-2">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            <Field label="Column name">
              <input value={c.label} onChange={(e) => set(i, { ...c, label: e.target.value })} placeholder="e.g. AUM band" className="input-base" />
            </Field>
            <Field label="Kind">
              <SelectField
                value={c.kind}
                onChange={(e) => {
                  const kind = e.target.value as CategoryColumn["kind"];
                  const src = (kind === "number" ? numeric : valued)[0]?.key ?? "";
                  set(i, { ...c, kind, source: src, bands: kind === "number" ? [{ label: "", min: null, max: null }] : undefined, groups: kind === "values" ? [{ label: "", values: [] }] : undefined });
                }}
                className="w-full"
              >
                <option value="number">Number bands</option>
                <option value="values">Value groups</option>
              </SelectField>
            </Field>
            <Field label="From field">
              <SelectField value={c.source} onChange={(e) => set(i, { ...c, source: e.target.value })} className="w-full">
                {(c.kind === "number" ? numeric : valued).map((f) => <option key={f.key} value={f.key}>{f.label}</option>)}
              </SelectField>
            </Field>
          </div>
          {c.kind === "number"
            ? (c.bands ?? []).map((b, bi) => (
                <div key={bi} className="flex flex-wrap items-center gap-2">
                  <input value={b.label} onChange={(e) => set(i, { ...c, bands: c.bands!.map((x, j) => (j === bi ? { ...x, label: e.target.value } : x)) })} placeholder="Band name" aria-label="Band name" className="input-base flex-1 min-w-32" />
                  <input type="number" value={b.min ?? ""} onChange={(e) => set(i, { ...c, bands: c.bands!.map((x, j) => (j === bi ? { ...x, min: e.target.value === "" ? null : Number(e.target.value) } : x)) })} placeholder="From (blank = any)" aria-label="From" className="input-base w-40" />
                  <input type="number" value={b.max ?? ""} onChange={(e) => set(i, { ...c, bands: c.bands!.map((x, j) => (j === bi ? { ...x, max: e.target.value === "" ? null : Number(e.target.value) } : x)) })} placeholder="Below (blank = any)" aria-label="Below" className="input-base w-40" />
                  <button type="button" onClick={() => set(i, { ...c, bands: c.bands!.filter((_, j) => j !== bi) })} className="btn-icon hover:text-destructive" aria-label="Remove band"><X className="size-4" /></button>
                </div>
              ))
            : (c.groups ?? []).map((g, gi) => (
                <div key={gi} className="flex flex-wrap items-center gap-2">
                  <input value={g.label} onChange={(e) => set(i, { ...c, groups: c.groups!.map((x, j) => (j === gi ? { ...x, label: e.target.value } : x)) })} placeholder="Group name" aria-label="Group name" className="input-base w-48" />
                  <input
                    value={g.values.join(", ")}
                    onChange={(e) => set(i, { ...c, groups: c.groups!.map((x, j) => (j === gi ? { ...x, values: e.target.value.split(",").map((s) => s.trim()).filter(Boolean) } : x)) })}
                    placeholder="Values, comma separated (e.g. Mumbai, Pune)"
                    aria-label="Values"
                    className="input-base flex-1 min-w-48"
                  />
                  <button type="button" onClick={() => set(i, { ...c, groups: c.groups!.filter((_, j) => j !== gi) })} className="btn-icon hover:text-destructive" aria-label="Remove group"><X className="size-4" /></button>
                </div>
              ))}
          <div className="flex flex-wrap items-center gap-3">
            {((c.kind === "number" ? c.bands?.length : c.groups?.length) ?? 0) < MAX_BUCKETS && (
              <button
                type="button"
                onClick={() => set(i, c.kind === "number" ? { ...c, bands: [...(c.bands ?? []), { label: "", min: null, max: null }] } : { ...c, groups: [...(c.groups ?? []), { label: "", values: [] }] })}
                className="text-xs text-brand-cyan-deep hover:underline inline-flex items-center gap-1"
              >
                <Plus className="size-3.5" /> {c.kind === "number" ? "Add band" : "Add group"}
              </button>
            )}
            <input value={c.other ?? ""} onChange={(e) => set(i, { ...c, other: e.target.value })} placeholder="Anything else reads as: Other" aria-label="Name for values in no band" className="input-base w-56" />
            <button type="button" onClick={() => onChange(value.filter((_, j) => j !== i))} className="ml-auto text-xs text-destructive hover:underline">
              Remove category column
            </button>
          </div>
        </div>
      ))}
      {value.length < MAX_CATEGORY_COLUMNS && numeric.length + valued.length > 0 && (
        <button
          type="button"
          onClick={() =>
            onChange([
              ...value,
              numeric.length
                ? { id: nextId(), label: "", source: numeric[0].key, kind: "number", bands: [{ label: "", min: null, max: null }] }
                : { id: nextId(), label: "", source: valued[0].key, kind: "values", groups: [{ label: "", values: [] }] },
            ])
          }
          className="text-xs text-brand-cyan-deep hover:underline inline-flex items-center gap-1 font-medium"
        >
          <Plus className="size-3.5" /> Add category column
        </button>
      )}
    </div>
  );
}

/**
 * Ordered column picker: an available-fields palette (searchable) on the left,
 * and the chosen columns as an ordered, reorderable list on the right. Matches
 * Zoho's "modify columns" (add / remove / reorder).
 */
function ColumnEditor({ fields, selected, onChange }: { fields: { key: string; label: string }[]; selected: string[]; onChange: (next: string[]) => void }) {
  const [q, setQ] = useState("");
  const labelOf = (k: string) => fields.find((f) => f.key === k)?.label ?? k;
  const available = fields.filter((f) => !selected.includes(f.key) && f.label.toLowerCase().includes(q.toLowerCase()));
  const move = (i: number, dir: -1 | 1) => {
    const j = i + dir;
    if (j < 0 || j >= selected.length) return;
    const next = [...selected];
    [next[i], next[j]] = [next[j], next[i]];
    onChange(next);
  };
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
      <div>
        <div className="relative mb-1.5">
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search fields…" aria-label="Search fields" className="input-base text-xs py-1.5" />
        </div>
        <div className="rounded-lg border border-border max-h-56 overflow-y-auto divide-y">
          {available.length === 0 ? (
            <div className="p-3 text-xs text-muted-foreground text-center">No more fields.</div>
          ) : (
            available.map((f) => (
              <button key={f.key} type="button" onClick={() => onChange([...selected, f.key])} className="w-full text-left px-3 py-1.5 text-xs hover:bg-secondary/50 flex items-center justify-between">
                {f.label} <Plus className="size-3 text-muted-foreground" />
              </button>
            ))
          )}
        </div>
      </div>
      <div>
        <div className="text-xs font-medium mb-1.5 text-muted-foreground">{selected.length} selected — drag order with arrows</div>
        <div className="rounded-lg border border-border max-h-[15.5rem] overflow-y-auto divide-y">
          {selected.length === 0 ? (
            <div className="p-3 text-xs text-muted-foreground text-center">Pick fields from the left.</div>
          ) : (
            selected.map((k, i) => (
              <div key={k} className="px-2 py-1.5 text-xs flex items-center gap-1.5">
                <span className="flex-1 truncate">{labelOf(k)}</span>
                <button type="button" onClick={() => move(i, -1)} disabled={i === 0} className="btn-icon disabled:opacity-30" aria-label="Up"><ArrowUp className="size-3" /></button>
                <button type="button" onClick={() => move(i, 1)} disabled={i === selected.length - 1} className="btn-icon disabled:opacity-30" aria-label="Down"><ArrowDown className="size-3" /></button>
                <button type="button" onClick={() => onChange(selected.filter((x) => x !== k))} className="btn-icon hover:text-destructive" aria-label="Remove"><X className="size-3" /></button>
              </div>
            ))
          )}
        </div>
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
