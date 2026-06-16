"use client";

/**
 * RTA file upload dialog.
 *
 * Two-step:
 *   1. Pick source (CAMS / KFintech / MFU / BSE / NSE) + kind (file type)
 *   2. Drag-drop or browse for the file → POST multipart to
 *      /api/rta-imports/upload → display per-row outcome
 *
 * The dialog is the *only* way a non-technical MFD interacts with the
 * registry feed. Layout is wizard-style with plain-English hints under
 * every field — no jargon assumed.
 */
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { X, Upload, CheckCircle2, AlertCircle, Loader2, Download } from "lucide-react";
import { RTA_FILE_TYPES, cadenceLabel, type RtaFileTypeDef } from "@/lib/rta/file-types";
import { RTA_SOURCES, type RtaSource } from "@/db/schema/rta_imports";

type Outcome = {
  importId?: string;
  status: "completed" | "partial" | "failed";
  duplicate?: boolean;
  rowsTotal?: number;
  rowsImported?: number;
  rowsSkipped?: number;
  rowsFailed?: number;
  errors?: Array<{ row: number; reason: string }>;
  error?: string;
};

const SOURCE_LABELS: Record<RtaSource, string> = {
  cams: "CAMS",
  kfintech: "KFintech",
  mfu: "MF Utility",
  bse_star_mf: "BSE Star MF",
  nse_nmf2: "NSE NMF II",
};

/** Compact pattern(s) for the dropdown <option>, e.g. " — MFSD211_… / …R9". */
function optionSuffix(def: RtaFileTypeDef): string {
  const pats = def.fileNames ? Object.values(def.fileNames) : [];
  return pats.length ? ` — ${pats.join(" / ")}` : "";
}

/** Per-registrar file-name hint for the detail box, e.g. "KFintech MFSD211_…". */
function fileNameHint(def: RtaFileTypeDef): string {
  if (def.fileNames && Object.keys(def.fileNames).length) {
    return Object.entries(def.fileNames)
      .map(([src, pat]) => `${SOURCE_LABELS[src as RtaSource]} ${pat}`)
      .join(" · ");
  }
  return def.acronyms.length ? `known as ${def.acronyms.join(", ")}` : "—";
}

export function UploadDialog({
  open,
  onClose,
  defaultKind,
}: {
  open: boolean;
  onClose: () => void;
  defaultKind?: string;
}) {
  const router = useRouter();
  const [source, setSource] = useState<RtaSource>("cams");
  const [kind, setKind] = useState<string>(defaultKind ?? "daily_transaction_feed");
  const [file, setFile] = useState<File | null>(null);
  const [password, setPassword] = useState("");
  const [uploading, setUploading] = useState(false);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open && defaultKind) setKind(defaultKind);
  }, [open, defaultKind]);

  if (!open) return null;

  const def = RTA_FILE_TYPES.find((t) => t.kind === kind);
  const availableSources: RtaSource[] = def?.sources ?? Array.from(RTA_SOURCES);

  async function handleUpload() {
    if (!file) return;
    setUploading(true);
    setOutcome(null);
    try {
      const fd = new FormData();
      fd.append("source", source);
      fd.append("kind", kind);
      fd.append("file", file);
      if (password) fd.append("password", password);
      const res = await fetch("/api/rta-imports/upload", { method: "POST", body: fd });
      const data = await res.json();
      if (!res.ok) {
        setOutcome({ status: "failed", error: data.error ?? "Upload failed" });
      } else {
        setOutcome(data);
        if (data.status === "completed" || data.status === "partial") {
          // Let the dashboard refresh on close so the new tile data shows up.
          router.refresh();
        }
      }
    } catch (e: any) {
      setOutcome({ status: "failed", error: e?.message ?? "Network error" });
    } finally {
      setUploading(false);
    }
  }

  function reset() {
    setFile(null);
    setPassword("");
    setOutcome(null);
  }

  return (
    <div
      className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4 animate-fade-in"
      onClick={onClose}
    >
      <div
        className="bg-card rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-6 py-4 border-b border-border flex items-start justify-between sticky top-0 bg-card z-10">
          <div>
            <h2 className="text-lg font-bold tracking-tight">Upload RTA file</h2>
            <p className="text-xs text-muted-foreground mt-0.5">
              Pick which registrar sent the file and what kind it is — we&apos;ll
              parse it, write the data, and tell you what landed.
            </p>
          </div>
          <button
            onClick={onClose}
            className="text-muted-foreground hover:text-foreground"
            aria-label="Close"
          >
            <X className="size-5" />
          </button>
        </div>

        {/* Body */}
        <div className="p-6 space-y-5">
          {!outcome ? (
            <>
              {/* Step 1 — file kind */}
              <div>
                <label className="block text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
                  1. Which file are you uploading?
                </label>
                <select
                  value={kind}
                  onChange={(e) => setKind(e.target.value)}
                  className="w-full border rounded-lg px-3 py-2 text-sm bg-background"
                >
                  {RTA_FILE_TYPES.map((t) => (
                    <option key={t.kind} value={t.kind}>
                      {t.label}
                      {optionSuffix(t)}
                    </option>
                  ))}
                </select>
                {def && (
                  <div className="mt-2 text-xs text-muted-foreground leading-relaxed bg-secondary/40 rounded-lg p-3 border border-border/60">
                    <div className="font-semibold text-foreground">{def.short}</div>
                    <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1">
                      <span>📅 <strong>Cadence:</strong> {cadenceLabel(def.cadence)}</span>
                      <span>📂 <strong>Populates:</strong> {def.populates.join(", ")}</span>
                      <span>📄 <strong>File name:</strong> {fileNameHint(def)}</span>
                    </div>
                  </div>
                )}
              </div>

              {/* Step 2 — source */}
              <div>
                <label className="block text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
                  2. Which registrar sent it?
                </label>
                <div className="flex flex-wrap gap-2">
                  {availableSources.map((s) => (
                    <button
                      key={s}
                      type="button"
                      onClick={() => setSource(s)}
                      className={`px-3 py-1.5 rounded-lg text-sm border transition-colors ${
                        source === s
                          ? "bg-primary text-primary-foreground border-primary"
                          : "bg-background hover:bg-secondary/70 border-border"
                      }`}
                    >
                      {SOURCE_LABELS[s]}
                    </button>
                  ))}
                </div>
              </div>

              {/* Step 3 — file */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="block text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                    3. Pick the file from your computer
                  </label>
                  {def?.sampleFiles?.[source] && (
                    <a
                      href={def.sampleFiles[source]}
                      download
                      className="text-[11px] inline-flex items-center gap-1 text-brand-cyan-deep hover:underline"
                      title="Download a synthetic sample wired to your demo investors — use it to verify the upload pipeline end-to-end."
                    >
                      <Download className="size-3" /> Download sample
                    </a>
                  )}
                </div>
                <div
                  onClick={() => inputRef.current?.click()}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={(e) => {
                    e.preventDefault();
                    if (e.dataTransfer.files[0]) setFile(e.dataTransfer.files[0]);
                  }}
                  className="border-2 border-dashed border-border rounded-xl p-8 text-center cursor-pointer hover:bg-secondary/40 transition-colors"
                >
                  <Upload className="size-8 mx-auto text-muted-foreground/70" />
                  {file ? (
                    <div className="mt-3 text-sm">
                      <div className="font-medium truncate">{file.name}</div>
                      <div className="text-xs text-muted-foreground mt-0.5">
                        {(file.size / 1024).toFixed(1)} KB · click to replace
                      </div>
                    </div>
                  ) : (
                    <>
                      <div className="mt-3 text-sm font-medium">Click to browse or drag a file here</div>
                      <div className="text-xs text-muted-foreground mt-0.5">
                        CSV, TXT, XLS, or password-protected ZIP. Max 25 MB.
                      </div>
                    </>
                  )}
                  <input
                    ref={inputRef}
                    type="file"
                    accept=".csv,.txt,.dat,.tsv,.zip,.xls,.xlsx"
                    onChange={(e) => e.target.files?.[0] && setFile(e.target.files[0])}
                    hidden
                  />
                </div>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Zip password (only if it's a password-protected .zip)"
                  autoComplete="off"
                  className="w-full border rounded-lg px-3 py-2 text-sm bg-background mt-2"
                />
              </div>

              {/* Submit */}
              <div className="pt-2 flex justify-end gap-2">
                <button onClick={onClose} className="btn-secondary text-sm">
                  Cancel
                </button>
                <button
                  onClick={handleUpload}
                  disabled={!file || uploading}
                  className="btn-primary text-sm disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {uploading ? (
                    <>
                      <Loader2 className="size-4 animate-spin" /> Parsing…
                    </>
                  ) : (
                    <>
                      <Upload className="size-4" /> Upload and parse
                    </>
                  )}
                </button>
              </div>
            </>
          ) : (
            <OutcomePanel outcome={outcome} onAnother={reset} onClose={onClose} />
          )}
        </div>
      </div>
    </div>
  );
}

function OutcomePanel({
  outcome,
  onAnother,
  onClose,
}: {
  outcome: Outcome;
  onAnother: () => void;
  onClose: () => void;
}) {
  if (outcome.duplicate) {
    return (
      <div className="text-center py-6">
        <div className="size-14 rounded-2xl bg-amber-100 grid place-items-center mx-auto">
          <AlertCircle className="size-7 text-amber-700" />
        </div>
        <h3 className="font-bold mt-4">This file is already imported</h3>
        <p className="text-sm text-muted-foreground mt-1 max-w-md mx-auto">
          We&apos;ve seen this exact file before (matching checksum) — no
          rows were re-inserted to keep your data clean.
        </p>
        <div className="mt-5 flex justify-center gap-2">
          <button onClick={onAnother} className="btn-secondary text-sm">
            Upload another
          </button>
          <button onClick={onClose} className="btn-primary text-sm">
            Done
          </button>
        </div>
      </div>
    );
  }

  if (outcome.status === "failed") {
    return (
      <div className="text-center py-6">
        <div className="size-14 rounded-2xl bg-rose-100 grid place-items-center mx-auto">
          <AlertCircle className="size-7 text-rose-700" />
        </div>
        <h3 className="font-bold mt-4">Upload failed</h3>
        <p className="text-sm text-muted-foreground mt-1 max-w-md mx-auto">
          {outcome.error ?? "We couldn't parse this file. Confirm the source + kind match the layout, then retry."}
        </p>
        <div className="mt-5 flex justify-center gap-2">
          <button onClick={onAnother} className="btn-secondary text-sm">
            Try again
          </button>
          <button onClick={onClose} className="btn-primary text-sm">
            Close
          </button>
        </div>
      </div>
    );
  }

  const total = outcome.rowsTotal ?? 0;
  const imported = outcome.rowsImported ?? 0;
  const skipped = outcome.rowsSkipped ?? 0;
  const failed = outcome.rowsFailed ?? 0;

  return (
    <div>
      <div className="text-center">
        <div className="size-14 rounded-2xl bg-emerald-100 grid place-items-center mx-auto">
          <CheckCircle2 className="size-7 text-emerald-700" />
        </div>
        <h3 className="font-bold mt-4">
          {outcome.status === "partial" ? "Imported with warnings" : "Import complete"}
        </h3>
        <p className="text-sm text-muted-foreground mt-1">
          {imported} of {total} rows were added to your records.
        </p>
      </div>

      <div className="grid grid-cols-4 gap-2 mt-5">
        <Stat label="Total" value={total} tone="muted" />
        <Stat label="Imported" value={imported} tone="emerald" />
        <Stat label="Skipped" value={skipped} tone="amber" />
        <Stat label="Failed" value={failed} tone="rose" />
      </div>

      {outcome.errors && outcome.errors.length > 0 && (
        <div className="mt-4 bg-secondary/40 rounded-lg p-3 border border-border/60">
          <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">
            First {outcome.errors.length} issues
          </div>
          <ul className="space-y-1 text-xs text-muted-foreground max-h-32 overflow-y-auto">
            {outcome.errors.map((e, i) => (
              <li key={i}>
                <span className="font-mono text-foreground">Row {e.row}:</span> {e.reason}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="mt-5 flex justify-end gap-2">
        <button onClick={onAnother} className="btn-secondary text-sm">
          Upload another
        </button>
        <button onClick={onClose} className="btn-primary text-sm">
          Done
        </button>
      </div>
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: number; tone: "emerald" | "amber" | "rose" | "muted" }) {
  const toneCls =
    tone === "emerald"
      ? "bg-emerald-50 text-emerald-700"
      : tone === "amber"
      ? "bg-amber-50 text-amber-700"
      : tone === "rose"
      ? "bg-rose-50 text-rose-700"
      : "bg-secondary text-muted-foreground";
  return (
    <div className={`rounded-lg px-3 py-2 text-center ${toneCls}`}>
      <div className="text-lg font-bold">{value}</div>
      <div className="text-[10px] uppercase tracking-wider">{label}</div>
    </div>
  );
}
