"use client";

/**
 * RTA reverse-feed importer UI.
 *
 * Upload a Kfintech/CAMS mailback file (.csv or the password-protected .zip),
 * Preview (dry-run: parse + counts, no writes), then Import (upsert investors +
 * folios). The password is sent only with the request and never stored.
 */

import { useRef, useState } from "react";
import { Upload, FileSpreadsheet, Eye, Database, Loader2, CheckCircle2, AlertTriangle, X } from "lucide-react";

type Summary = {
  dryRun: boolean;
  rta: string;
  reportType: string;
  investors: { total: number; created: number; updated: number };
  folios: { total: number; created: number; updated: number; skippedNoPan: number };
  schemes: number;
  amcs: { code: string; name: string; folios: number }[];
};
type ApiResult = {
  ok?: boolean;
  error?: string;
  source?: string;
  reportType?: string;
  totalRows?: number;
  missingPan?: number;
  summary?: Summary;
};

export function RtaImporter() {
  const [file, setFile] = useState<File | null>(null);
  const [password, setPassword] = useState("");
  const [assignToMe, setAssignToMe] = useState(false);
  const [busy, setBusy] = useState<null | "preview" | "import">(null);
  const [result, setResult] = useState<ApiResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const isZip = !!file && /\.zip$/i.test(file.name);

  async function run(dryRun: boolean) {
    if (!file) {
      setError("Choose a file first.");
      return;
    }
    if (!dryRun && !window.confirm(`Import will create/update investors and folios from "${file.name}". Continue?`)) return;
    setBusy(dryRun ? "preview" : "import");
    setError(null);
    setResult(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      if (password) fd.append("password", password);
      fd.append("dryRun", dryRun ? "1" : "0");
      fd.append("assignToMe", assignToMe ? "1" : "0");
      const res = await fetch("/api/rta/import", { method: "POST", body: fd });
      const json: ApiResult = await res.json();
      if (!res.ok || json.error) {
        setError(json.error ?? `Import failed (${res.status}).`);
      } else {
        setResult(json);
      }
    } catch (e: any) {
      setError(e?.message ?? "Upload failed.");
    } finally {
      setBusy(null);
    }
  }

  const s = result?.summary;

  return (
    <div className="space-y-5 max-w-3xl">
      {/* Upload card */}
      <div className="card-surface p-5 space-y-4">
        <div
          onClick={() => inputRef.current?.click()}
          className="flex items-center gap-3 rounded-xl border-2 border-dashed border-border hover:border-brand-cyan/50 hover:bg-brand-cyan-light/20 transition-colors px-4 py-6 cursor-pointer"
        >
          <div className="size-10 rounded-lg bg-brand-cyan-light/50 text-brand-cyan-deep grid place-items-center shrink-0">
            {file ? <FileSpreadsheet className="size-5" /> : <Upload className="size-5" />}
          </div>
          <div className="min-w-0">
            <div className="font-medium text-sm truncate">{file ? file.name : "Choose an RTA file (.csv or .zip)"}</div>
            <div className="text-xs text-muted-foreground">
              {file ? `${(file.size / 1024 / 1024).toFixed(2)} MB` : "Kfintech MFSD211 folio-master, or the password-protected zip"}
            </div>
          </div>
          {file && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                setFile(null);
                setResult(null);
                setError(null);
                if (inputRef.current) inputRef.current.value = "";
              }}
              className="ml-auto text-muted-foreground hover:text-rose-600"
              aria-label="Clear file"
            >
              <X className="size-4" />
            </button>
          )}
          <input
            ref={inputRef}
            type="file"
            accept=".csv,.zip,.txt"
            className="hidden"
            onChange={(e) => {
              setFile(e.target.files?.[0] ?? null);
              setResult(null);
              setError(null);
            }}
          />
        </div>

        {isZip && (
          <div>
            <label className="text-xs font-medium text-muted-foreground">Zip password</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Password for the RTA zip"
              className="input-base text-sm w-full mt-1"
              autoComplete="off"
            />
          </div>
        )}

        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={assignToMe}
            onChange={(e) => setAssignToMe(e.target.checked)}
            className="size-4 rounded border-border accent-brand-cyan"
          />
          Assign newly-created clients to me
        </label>

        <div className="flex items-center gap-2">
          <button
            onClick={() => run(true)}
            disabled={!file || busy !== null}
            className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-card px-3 py-2 text-sm font-medium hover:bg-secondary/60 disabled:opacity-50"
          >
            {busy === "preview" ? <Loader2 className="size-4 animate-spin" /> : <Eye className="size-4" />}
            Preview
          </button>
          <button
            onClick={() => run(false)}
            disabled={!file || busy !== null}
            className="inline-flex items-center gap-1.5 rounded-lg bg-brand-cyan text-white px-3 py-2 text-sm font-medium hover:bg-brand-cyan-deep disabled:opacity-50"
          >
            {busy === "import" ? <Loader2 className="size-4 animate-spin" /> : <Database className="size-4" />}
            Import
          </button>
          <span className="text-xs text-muted-foreground ml-1">Preview is read-only — nothing is written.</span>
        </div>
      </div>

      {error && (
        <div className="card-surface p-4 border-rose-200 bg-rose-50/50 flex items-start gap-2 text-sm text-rose-700">
          <AlertTriangle className="size-4 mt-0.5 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {s && (
        <div className="card-surface p-5 space-y-4">
          <div className="flex items-center gap-2">
            <CheckCircle2 className={`size-5 ${s.dryRun ? "text-sky-500" : "text-emerald-500"}`} />
            <h3 className="font-semibold">
              {s.dryRun ? "Preview" : "Import complete"} — {result?.source?.toUpperCase()} {s.reportType}
            </h3>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <Stat label="Investors" value={s.investors.total} sub={`${s.investors.created} new · ${s.investors.updated} updated`} />
            <Stat label="Folios" value={s.folios.total} sub={`${s.folios.created} new · ${s.folios.updated} updated`} />
            <Stat label="Schemes" value={s.schemes} sub={`${s.amcs.length} AMCs`} />
            <Stat
              label="Skipped"
              value={s.folios.skippedNoPan + (result?.missingPan ?? 0)}
              sub="rows without PAN"
              tone={s.folios.skippedNoPan ? "amber" : "muted"}
            />
          </div>

          {s.dryRun && (
            <p className="text-xs text-muted-foreground">
              Nothing was written. Click <strong>Import</strong> to apply these {s.investors.total} investors and {s.folios.total} folios.
            </p>
          )}

          <div>
            <div className="text-xs font-semibold text-muted-foreground mb-1.5">AMC breakdown</div>
            <div className="max-h-64 overflow-y-auto scrollbar-thin rounded-lg border border-border">
              <table className="w-full text-sm">
                <thead className="bg-secondary/40 text-xs text-muted-foreground sticky top-0">
                  <tr>
                    <th className="text-left font-medium px-3 py-1.5">Code</th>
                    <th className="text-left font-medium px-3 py-1.5">AMC</th>
                    <th className="text-right font-medium px-3 py-1.5">Folios</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {s.amcs.map((a) => (
                    <tr key={a.code}>
                      <td className="px-3 py-1.5 font-mono text-xs text-muted-foreground">{a.code}</td>
                      <td className="px-3 py-1.5">{a.name}</td>
                      <td className="px-3 py-1.5 text-right tabular-nums">{a.folios.toLocaleString("en-IN")}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Stat({ label, value, sub, tone }: { label: string; value: number; sub?: string; tone?: "amber" | "muted" }) {
  return (
    <div className="rounded-lg border border-border bg-card p-3">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className={`text-2xl font-bold tabular-nums ${tone === "amber" ? "text-amber-600" : ""}`}>
        {value.toLocaleString("en-IN")}
      </div>
      {sub && <div className="text-[11px] text-muted-foreground mt-0.5">{sub}</div>}
    </div>
  );
}
