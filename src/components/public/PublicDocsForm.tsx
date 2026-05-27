"use client";

import { useState } from "react";
import { CheckCircle2, FileText, Loader2, Upload, X } from "lucide-react";

type RequiredDoc = { key: string; label: string; required?: boolean };

export function PublicDocsForm({
  tokenId,
  recipientName,
  requiredDocs,
}: {
  tokenId: string;
  recipientName: string;
  requiredDocs: RequiredDoc[];
}) {
  const [files, setFiles] = useState<Record<string, File | null>>({});
  const [extraNotes, setExtraNotes] = useState("");
  const [signature, setSignature] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  function setFile(key: string, file: File | null) {
    setFiles((p) => ({ ...p, [key]: file }));
  }

  function canSubmit() {
    if (!signature.trim()) return false;
    return requiredDocs.every((d) => !d.required || !!files[d.key]);
  }

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const fd = new FormData();
      fd.append("tokenId", tokenId);
      fd.append("signatureName", signature.trim());
      fd.append("extraNotes", extraNotes);
      for (const d of requiredDocs) {
        const f = files[d.key];
        if (f) {
          fd.append(`file_${d.key}`, f);
          fd.append(`label_${d.key}`, d.label);
        }
      }
      const r = await fetch("/api/public/docs/submit", { method: "POST", body: fd });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(data?.error ?? `HTTP ${r.status}`);
      setDone(true);
    } catch (e: any) {
      setError(e?.message ?? "Submission failed");
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <div className="bg-white rounded-xl shadow p-8 text-center">
        <CheckCircle2 className="size-12 text-emerald-500 mx-auto" />
        <h2 className="text-xl font-bold mt-3">Documents received!</h2>
        <p className="text-sm text-muted-foreground mt-2">
          Thank you{recipientName ? `, ${recipientName.split(" ")[0]}` : ""}. Our back-office team will start your
          KYC and account-opening process shortly. You'll receive your portal login details via email once we're done.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="bg-white rounded-xl shadow p-6">
        <h1 className="text-xl font-bold">Upload your documents</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Hi{recipientName ? ` ${recipientName}` : ""} — please upload each of the following documents to start
          your account-opening. Files: PDF, JPG, PNG up to 10 MB each.
        </p>
      </div>

      <div className="bg-white rounded-xl shadow p-6 space-y-3">
        {requiredDocs.map((d) => (
          <DocRow key={d.key} doc={d} value={files[d.key] ?? null} onChange={(f) => setFile(d.key, f)} />
        ))}

        <label className="block">
          <div className="text-xs font-semibold mb-1 mt-2">Any other documents / notes (optional)</div>
          <textarea
            value={extraNotes}
            onChange={(e) => setExtraNotes(e.target.value)}
            rows={2}
            placeholder="Anything else you'd like to share with the back-office team"
            className="w-full border rounded-lg px-3 py-2 text-sm"
          />
        </label>

        <label className="block">
          <div className="text-xs font-semibold mb-1">Signature (type your full name)</div>
          <input
            value={signature}
            onChange={(e) => setSignature(e.target.value)}
            placeholder="e.g. Rajesh Sharma"
            className="w-full border rounded-lg px-3 py-2 text-sm"
          />
          <div className="text-[10px] text-muted-foreground mt-1">
            By signing, you confirm that the documents you've uploaded are genuine and belong to you. They will be
            used solely for the purpose of opening your mutual fund investment account.
          </div>
        </label>

        {error && <div className="text-xs text-rose-700 bg-rose-50 rounded-md p-2">{error}</div>}

        <button
          onClick={submit}
          disabled={busy || !canSubmit()}
          className="w-full rounded-md bg-brand-cyan text-white px-4 py-2.5 text-sm font-semibold flex items-center justify-center gap-2 disabled:opacity-50 mt-2"
        >
          {busy ? <Loader2 className="size-4 animate-spin" /> : <CheckCircle2 className="size-4" />}
          {busy ? "Uploading…" : "Submit documents"}
        </button>
      </div>
    </div>
  );
}

function DocRow({ doc, value, onChange }: { doc: RequiredDoc; value: File | null; onChange: (f: File | null) => void }) {
  return (
    <div className="border rounded-lg p-3 flex items-center gap-3">
      <FileText className="size-5 text-brand-cyan" />
      <div className="flex-1 min-w-0">
        <div className="font-medium text-sm">
          {doc.label}
          {doc.required && <span className="text-rose-600 ml-1">*</span>}
        </div>
        {value && <div className="text-[11px] text-muted-foreground truncate">{value.name} · {(value.size / 1024).toFixed(0)} KB</div>}
      </div>
      {value ? (
        <button onClick={() => onChange(null)} className="text-rose-600 hover:bg-rose-50 rounded p-1">
          <X className="size-4" />
        </button>
      ) : (
        <label className="cursor-pointer text-xs rounded-md border px-3 py-1.5 hover:bg-secondary inline-flex items-center gap-1">
          <Upload className="size-3.5" /> Upload
          <input
            type="file"
            accept="application/pdf,image/png,image/jpeg"
            onChange={(e) => onChange(e.target.files?.[0] ?? null)}
            className="hidden"
          />
        </label>
      )}
    </div>
  );
}
