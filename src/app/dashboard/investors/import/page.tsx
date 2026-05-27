"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ChevronLeft, Upload, FileSpreadsheet, Loader2, Check, AlertCircle } from "lucide-react";

type Parsed = {
  headers: string[];
  ourFields: string[];
  suggestedMapping: Record<string, string>;
  rows: any[];
  total: number;
};

export default function ImportPage() {
  const router = useRouter();
  const [parsed, setParsed] = useState<Parsed | null>(null);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [step, setStep] = useState<"upload" | "map" | "commit" | "done">("upload");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [commitResult, setCommitResult] = useState<any>(null);

  async function onFile(file: File) {
    setBusy(true);
    setErr(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch("/api/investors/import/parse", { method: "POST", body: fd });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        setErr(j.error ?? "Parse failed");
        return;
      }
      const j: Parsed = await res.json();
      setParsed(j);
      setMapping(j.suggestedMapping);
      setStep("map");
    } finally {
      setBusy(false);
    }
  }

  async function commit() {
    if (!parsed) return;
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch("/api/investors/import/commit", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ mapping, rows: parsed.rows }),
      });
      const j = await res.json();
      if (!res.ok) {
        setErr(j.error ?? "Commit failed");
        return;
      }
      setCommitResult(j);
      setStep("done");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4 max-w-4xl">
      <Link
        href="/dashboard/investors"
        className="text-sm text-muted-foreground hover:underline flex items-center gap-1"
      >
        <ChevronLeft className="size-4" /> Back to investors
      </Link>

      <h1 className="text-2xl font-bold tracking-tight">Import investors from Excel</h1>
      <p className="text-sm text-muted-foreground">
        Upload a .xlsx or .csv file. We'll dedup by PAN against your existing investors.
      </p>

      <ol className="flex items-center gap-4 text-xs">
        <Step label="Upload file" active={step === "upload"} done={step !== "upload"} />
        <Step label="Map columns" active={step === "map"} done={step === "commit" || step === "done"} />
        <Step label="Commit" active={step === "commit"} done={step === "done"} />
      </ol>

      {step === "upload" && (
        <div className="border-2 border-dashed rounded-lg p-12 text-center">
          <FileSpreadsheet className="size-12 mx-auto text-muted-foreground" />
          <div className="mt-3 text-sm">Drop your .xlsx or .csv file here</div>
          <label className="mt-4 inline-block">
            <span className="rounded-md bg-primary text-primary-foreground px-4 py-2 text-sm font-medium cursor-pointer">
              {busy ? "Parsing…" : "Choose file"}
            </span>
            <input
              type="file"
              accept=".xlsx,.xls,.csv"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) onFile(f);
              }}
            />
          </label>
          {err && <div className="text-sm text-rose-600 mt-3">{err}</div>}
          <p className="text-xs text-muted-foreground mt-6">
            Max 5,000 rows, 10MB. Headers in row 1. Required columns: Name + PAN. Everything else is optional but
            we'll auto-detect what we recognize.
          </p>
        </div>
      )}

      {step === "map" && parsed && (
        <>
          <div className="border rounded-lg bg-card p-5">
            <div className="font-medium mb-3">Map columns</div>
            <p className="text-xs text-muted-foreground mb-3">
              {parsed.total} rows found. Map each of your columns to a field. Leave as "(skip)" to ignore.
            </p>
            <table className="w-full text-sm">
              <thead className="text-xs text-muted-foreground border-b">
                <tr>
                  <th className="text-left py-2 font-medium">Your column</th>
                  <th className="text-left py-2 font-medium">Sample</th>
                  <th className="text-left py-2 font-medium">→ Field</th>
                </tr>
              </thead>
              <tbody>
                {parsed.headers.map((h) => (
                  <tr key={h} className="border-b last:border-0">
                    <td className="py-2 font-medium">{h}</td>
                    <td className="py-2 text-xs text-muted-foreground truncate max-w-[200px]">
                      {String(parsed.rows[0]?.[h] ?? "")}
                    </td>
                    <td className="py-2">
                      <select
                        value={mapping[h] ?? ""}
                        onChange={(e) => setMapping({ ...mapping, [h]: e.target.value })}
                        className="text-sm border rounded px-2 py-1 bg-background"
                      >
                        <option value="">(skip)</option>
                        {parsed.ourFields.map((f) => (
                          <option key={f} value={f}>
                            {f}
                          </option>
                        ))}
                      </select>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {err && <div className="text-sm text-rose-600 mt-3">{err}</div>}
            <div className="flex justify-end gap-2 mt-4 pt-4 border-t">
              <button
                onClick={() => {
                  setParsed(null);
                  setStep("upload");
                }}
                className="rounded-md border px-3 py-1.5 text-sm"
              >
                Re-upload
              </button>
              <button
                onClick={commit}
                disabled={busy || !Object.values(mapping).includes("name") || !Object.values(mapping).includes("pan")}
                className="rounded-md bg-primary text-primary-foreground px-3 py-1.5 text-sm font-medium disabled:opacity-50 flex items-center gap-1.5"
              >
                {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Upload className="size-3.5" />}
                {busy ? "Importing…" : `Import ${parsed.total} rows`}
              </button>
            </div>
          </div>
        </>
      )}

      {step === "done" && commitResult && (
        <div className="border rounded-lg bg-card p-6 text-center">
          <Check className="size-12 mx-auto text-emerald-600" />
          <div className="text-lg font-semibold mt-2">Import complete</div>
          <div className="grid grid-cols-3 gap-3 mt-4 text-sm">
            <Tile label="Inserted" value={commitResult.inserted} tone="emerald" />
            <Tile label="Skipped (PAN exists)" value={commitResult.skipped} tone="muted" />
            <Tile label="Errored" value={commitResult.errored} tone={commitResult.errored ? "rose" : "muted"} />
          </div>
          {commitResult.errors?.length > 0 && (
            <details className="mt-4 text-xs text-left">
              <summary className="cursor-pointer">View first {commitResult.errors.length} errors</summary>
              <ul className="mt-2 space-y-1">
                {commitResult.errors.map((e: any, i: number) => (
                  <li key={i} className="flex items-center gap-2">
                    <AlertCircle className="size-3 text-rose-600" />
                    Row {e.rowIndex}: {e.error}
                  </li>
                ))}
              </ul>
            </details>
          )}
          <button
            onClick={() => router.push("/dashboard/investors")}
            className="mt-6 rounded-md bg-primary text-primary-foreground px-4 py-2 text-sm font-medium"
          >
            View imported investors
          </button>
        </div>
      )}
    </div>
  );
}

function Step({ label, active, done }: { label: string; active: boolean; done: boolean }) {
  return (
    <li
      className={`flex items-center gap-1.5 ${
        done ? "text-emerald-600" : active ? "text-foreground font-medium" : "text-muted-foreground"
      }`}
    >
      <span
        className={`size-5 rounded-full grid place-items-center text-[10px] ${
          done ? "bg-emerald-600 text-white" : active ? "bg-foreground text-background" : "bg-muted"
        }`}
      >
        {done ? "✓" : ""}
      </span>
      {label}
    </li>
  );
}

function Tile({ label, value, tone }: { label: string; value: number; tone: "emerald" | "rose" | "muted" }) {
  const color =
    tone === "emerald" ? "text-emerald-600" : tone === "rose" ? "text-rose-600" : "text-muted-foreground";
  return (
    <div className="border rounded-md p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={`text-2xl font-bold mt-1 ${color}`}>{value}</div>
    </div>
  );
}
