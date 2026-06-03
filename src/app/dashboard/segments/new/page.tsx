"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ChevronLeft, Plus, X, Loader2 } from "lucide-react";
import { investorCatalog, leadCatalog, taskCatalog } from "@/lib/filter/catalog";
import type { FilterAST, Group, Predicate } from "@/lib/filter/ast";
import { isFieldAllowed } from "@/lib/auth/field-gate";

type Subject = "investor" | "lead" | "task";

const CATALOGS = {
  investor: investorCatalog,
  lead: leadCatalog,
  task: taskCatalog,
} as const;

export default function NewSegmentPage() {
  const router = useRouter();
  const [name, setName] = useState("Untitled segment");
  const [description, setDescription] = useState("");
  const [kind, setKind] = useState<"dynamic" | "static">("dynamic");
  const [subject, setSubject] = useState<Subject>("investor");
  const [ast, setAst] = useState<Group>({
    type: "group",
    op: "AND",
    children: [
      { type: "predicate", field: { kind: "attr", path: "segment_tag" }, op: "eq", value: "HNI" } as Predicate,
    ],
  });
  const [preview, setPreview] = useState<{ count: number; sample: any[] } | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [previewErr, setPreviewErr] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveErr, setSaveErr] = useState<string | null>(null);
  const [license, setLicense] = useState<any>(null);

  useEffect(() => {
    fetch("/api/tenant")
      .then((res) => res.json())
      .then((data) => {
        if (data.license) {
          setLicense(data.license);
        }
      })
      .catch((err) => console.error("failed to fetch license", err));
  }, []);

  // Debounced preview
  useEffect(() => {
    const handle = setTimeout(async () => {
      setPreviewing(true);
      setPreviewErr(null);
      try {
        const res = await fetch("/api/segments/preview", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ subject, ast }),
        });
        if (!res.ok) {
          const j = await res.json().catch(() => ({}));
          setPreviewErr(j.error ?? "Preview failed");
          setPreview(null);
        } else {
          setPreview(await res.json());
        }
      } catch (err: any) {
        setPreviewErr(err.message);
      } finally {
        setPreviewing(false);
      }
    }, 500);
    return () => clearTimeout(handle);
  }, [ast, subject]);

  async function save() {
    setSaving(true);
    setSaveErr(null);
    try {
      const res = await fetch("/api/segments", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name, description, kind, subjectType: subject, ast }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        setSaveErr(j.error ?? "Save failed");
        return;
      }
      router.push("/dashboard/segments");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-4 max-w-5xl">
      <Link
        href="/dashboard/segments"
        className="text-sm text-muted-foreground hover:underline flex items-center gap-1"
      >
        <ChevronLeft className="size-4" /> Back to segments
      </Link>

      <div className="flex items-center justify-between">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="text-2xl font-bold tracking-tight bg-transparent border-none outline-none w-full"
        />
        <div className="flex gap-2 items-center">
          <div className="text-sm">
            {previewing ? (
              <span className="text-muted-foreground flex items-center gap-1.5">
                <Loader2 className="size-3.5 animate-spin" /> previewing…
              </span>
            ) : previewErr ? (
              <span className="text-rose-600">⚠ {previewErr}</span>
            ) : preview ? (
              <span className="font-semibold tabular-nums">{preview.count} match</span>
            ) : null}
          </div>
          <button
            onClick={save}
            disabled={saving || !!previewErr}
            className="rounded-md bg-primary text-primary-foreground px-3 py-1.5 text-sm font-medium disabled:opacity-50"
          >
            {saving ? "Saving…" : "Save segment"}
          </button>
        </div>
      </div>

      <textarea
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        placeholder="Description (optional)"
        rows={1}
        className="w-full border rounded-md px-3 py-2 text-sm bg-background"
      />

      <div className="grid grid-cols-3 gap-3">
        <Field label="Subject">
          <select
            value={subject}
            onChange={(e) => setSubject(e.target.value as Subject)}
            className="w-full border rounded-md px-2 py-1.5 text-sm bg-background"
          >
            <option value="investor">Investor</option>
            <option value="lead">Lead</option>
            <option value="task">Task</option>
          </select>
        </Field>
        <Field label="Kind">
          <select
            value={kind}
            onChange={(e) => setKind(e.target.value as any)}
            className="w-full border rounded-md px-2 py-1.5 text-sm bg-background"
          >
            <option value="dynamic">Dynamic (re-materializes on schedule)</option>
            <option value="static">Static (snapshot)</option>
          </select>
        </Field>
        <Field label="Refresh">
          <select
            disabled={kind === "static"}
            className="w-full border rounded-md px-2 py-1.5 text-sm bg-background disabled:opacity-50"
          >
            <option>Hourly</option>
            <option>Every 4 hours</option>
            <option>Daily</option>
            <option>Manual</option>
          </select>
        </Field>
      </div>

      <div className="border rounded-lg bg-card p-5">
        <div className="font-medium mb-3">Criteria</div>
        <GroupEditor subject={subject} group={ast} onChange={(g) => setAst(g)} license={license} />
      </div>

      {preview && preview.sample.length > 0 && (
        <div className="border rounded-lg bg-card p-5">
          <div className="font-medium mb-2">Sample (first 10)</div>
          <ul className="text-sm space-y-1">
            {preview.sample.map((row: any) => (
              <li key={row.id} className="font-mono text-xs">
                {row.name ?? row.id}
              </li>
            ))}
          </ul>
        </div>
      )}

      {saveErr && <div className="text-sm text-rose-600">{saveErr}</div>}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <div className="text-xs text-muted-foreground mb-1">{label}</div>
      {children}
    </label>
  );
}

function GroupEditor({
  subject,
  group,
  onChange,
  license,
}: {
  subject: Subject;
  group: Group;
  onChange: (g: Group) => void;
  license: any;
}) {
  return (
    <div className="border rounded-md p-3 bg-muted/30">
      <div className="flex items-center gap-2 text-xs">
        <span className="text-muted-foreground">Match</span>
        <select
          value={group.op}
          onChange={(e) => onChange({ ...group, op: e.target.value as "AND" | "OR" })}
          className="border rounded px-2 py-0.5 bg-background"
        >
          <option value="AND">all</option>
          <option value="OR">any</option>
        </select>
        <span className="text-muted-foreground">of the following</span>
      </div>

      <div className="mt-3 space-y-2">
        {group.children.map((c, i) => (
          <div key={i} className="flex items-start gap-2">
            {c.type === "predicate" ? (
              <PredicateEditor
                subject={subject}
                predicate={c}
                license={license}
                onChange={(p) => {
                  const next = [...group.children];
                  next[i] = p;
                  onChange({ ...group, children: next });
                }}
              />
            ) : (
              <div className="flex-1">
                <GroupEditor
                  subject={subject}
                  group={c}
                  license={license}
                  onChange={(g) => {
                    const next = [...group.children];
                    next[i] = g;
                    onChange({ ...group, children: next });
                  }}
                />
              </div>
            )}
            <button
              className="p-1.5 rounded hover:bg-background"
              onClick={() => {
                const next = group.children.filter((_, idx) => idx !== i);
                onChange({ ...group, children: next });
              }}
            >
              <X className="size-3.5 text-muted-foreground" />
            </button>
          </div>
        ))}
      </div>

      <div className="mt-3 flex gap-2">
        <button
          className="text-xs rounded-md border bg-background px-2 py-1 flex items-center gap-1 hover:bg-accent"
          onClick={() =>
            onChange({
              ...group,
              children: [
                ...group.children,
                { type: "predicate", field: { kind: "attr", path: "name" }, op: "contains", value: "" },
              ],
            })
          }
        >
          <Plus className="size-3" /> Add condition
        </button>
        <button
          className="text-xs rounded-md border bg-background px-2 py-1 flex items-center gap-1 hover:bg-accent"
          onClick={() =>
            onChange({
              ...group,
              children: [...group.children, { type: "group", op: "OR", children: [] } as Group],
            })
          }
        >
          <Plus className="size-3" /> Add group
        </button>
      </div>
    </div>
  );
}

function PredicateEditor({
  subject,
  predicate,
  onChange,
  license,
}: {
  subject: Subject;
  predicate: Predicate;
  onChange: (p: Predicate) => void;
  license: any;
}) {
  const catalog = CATALOGS[subject];
  const fieldKey = predicate.field.kind === "attr" ? predicate.field.path : "";
  const allowedFields = catalog.fields.filter((f) => isFieldAllowed(license, subject, f.key));
  const field = allowedFields.find((f) => f.key === fieldKey) || catalog.fields.find((f) => f.key === fieldKey);
  return (
    <div className="flex-1 flex items-center gap-2 bg-background rounded p-2 border">
      <select
        value={fieldKey}
        onChange={(e) => onChange({ ...predicate, field: { kind: "attr", path: e.target.value } })}
        className="text-sm rounded border-0 bg-transparent max-w-[160px]"
      >
        {allowedFields.map((f) => (
          <option key={f.key} value={f.key}>
            {f.label}
          </option>
        ))}
      </select>
      <select
        value={predicate.op}
        onChange={(e) => onChange({ ...predicate, op: e.target.value as any })}
        className="text-sm rounded border-0 bg-transparent"
      >
        {(field?.ops ?? ["eq"]).map((op) => (
          <option key={op} value={op}>
            {op}
          </option>
        ))}
      </select>
      {needsValue(predicate.op) && (
        <ValueInput field={field} value={predicate.value} onChange={(v) => onChange({ ...predicate, value: v })} />
      )}
    </div>
  );
}

function ValueInput({
  field,
  value,
  onChange,
}: {
  field: any;
  value: unknown;
  onChange: (v: unknown) => void;
}) {
  if (field?.type === "enum") {
    return (
      <select
        value={String(value ?? "")}
        onChange={(e) => onChange(e.target.value)}
        className="flex-1 text-sm rounded border px-2 py-1 bg-background"
      >
        {(field.enumValues ?? []).map((o: string) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
    );
  }
  if (field?.type === "date" || field?.type === "datetime") {
    return (
      <input
        type="date"
        value={String(value ?? "")}
        onChange={(e) => onChange(e.target.value)}
        className="flex-1 text-sm rounded border px-2 py-1 bg-background"
      />
    );
  }
  return (
    <input
      value={String(value ?? "")}
      onChange={(e) => onChange(e.target.value)}
      className="flex-1 text-sm rounded border px-2 py-1 bg-background"
      placeholder="value"
    />
  );
}

function needsValue(op: string): boolean {
  return ![
    "is_empty",
    "is_not_empty",
    "is_null",
    "is_not_null",
    "is_true",
    "is_false",
    "date_today",
    "date_yesterday",
    "date_tomorrow",
    "date_is_anniversary",
  ].includes(op);
}
