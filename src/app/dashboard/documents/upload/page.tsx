"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ChevronLeft, Upload, Loader2 } from "lucide-react";

const CATEGORIES = [
  { key: "arn", label: "ARN" },
  { key: "euin", label: "EUIN" },
  { key: "nism", label: "NISM Certificate" },
  { key: "kyd", label: "KYD Document" },
  { key: "amc_empanelment", label: "AMC Empanelment" },
  { key: "ddq", label: "DDQ Document" },
  { key: "sop", label: "SOP" },
  { key: "marketing_approval", label: "Marketing Approval" },
  { key: "complaint", label: "Complaint Document" },
  { key: "audit_report", label: "Audit Report" },
  { key: "ria_compliance", label: "RIA Compliance" },
  { key: "other", label: "Other" },
];

export default function UploadDocumentPage() {
  const router = useRouter();
  const [form, setForm] = useState({
    name: "",
    category: "other",
    description: "",
    expiresOn: "",
  });
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!file) {
      setErr("Choose a file first");
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      // 1. Get presigned URL
      const urlRes = await fetch("/api/compliance/upload-url", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ filename: file.name, contentType: file.type, kind: "compliance" }),
      });
      const urlJson = await urlRes.json();
      if (!urlRes.ok) {
        setErr(urlJson.error ?? "Failed to get upload URL — is S3 configured?");
        return;
      }

      // 2. Upload directly to S3
      const putRes = await fetch(urlJson.url, { method: "PUT", body: file, headers: { "content-type": file.type } });
      if (!putRes.ok) {
        setErr("S3 upload failed");
        return;
      }

      // 3. Register in compliance_documents
      const regRes = await fetch("/api/compliance/documents", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: form.name || file.name,
          category: form.category,
          description: form.description,
          storageKey: urlJson.key,
          mimeType: file.type,
          sizeBytes: file.size,
          expiresOn: form.expiresOn || undefined,
        }),
      });
      const regJson = await regRes.json();
      if (!regRes.ok) {
        setErr(regJson.error ?? "Register failed");
        return;
      }
      router.push("/dashboard/documents");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4 max-w-2xl">
      <Link href="/dashboard/documents" className="text-sm text-muted-foreground hover:underline flex items-center gap-1">
        <ChevronLeft className="size-4" /> Back to documents
      </Link>
      <h1 className="text-2xl font-bold tracking-tight">Upload document</h1>
      <p className="text-sm text-muted-foreground">
        Files are stored encrypted in S3 (ap-south-1, DPDP-compliant). Requires S3 credentials in <code className="bg-muted px-1 rounded">.env</code>.
      </p>

      <form onSubmit={submit} className="border rounded-lg bg-card p-5 space-y-3">
        <label className="block border-2 border-dashed rounded-md p-6 text-center cursor-pointer hover:bg-accent/40">
          <input
            type="file"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            className="hidden"
            required
          />
          <Upload className="size-8 mx-auto text-muted-foreground" />
          <div className="mt-2 text-sm font-medium">{file?.name ?? "Choose a file"}</div>
          <div className="text-xs text-muted-foreground mt-0.5">
            {file ? `${(file.size / 1024).toFixed(1)} KB` : "PDF, image, or document"}
          </div>
        </label>

        <label className="block">
          <div className="text-xs font-medium mb-1">Document name</div>
          <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder={file?.name ?? ""} className="w-full border rounded-md px-3 py-2 text-sm bg-background" />
        </label>
        <div className="grid grid-cols-2 gap-3">
          <label className="block">
            <div className="text-xs font-medium mb-1">Category</div>
            <select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} className="w-full border rounded-md px-3 py-2 text-sm bg-background">
              {CATEGORIES.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
            </select>
          </label>
          <label className="block">
            <div className="text-xs font-medium mb-1">Expires on</div>
            <input type="date" value={form.expiresOn} onChange={(e) => setForm({ ...form, expiresOn: e.target.value })} className="w-full border rounded-md px-3 py-2 text-sm bg-background" />
          </label>
        </div>
        <label className="block">
          <div className="text-xs font-medium mb-1">Notes</div>
          <textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} rows={3} className="w-full border rounded-md px-3 py-2 text-sm bg-background" />
        </label>
        {err && <div className="text-sm text-rose-600">{err}</div>}
        <div className="flex justify-end gap-2 pt-2 border-t">
          <Link href="/dashboard/documents" className="rounded-md border px-4 py-2 text-sm">Cancel</Link>
          <button disabled={busy || !file} className="rounded-md bg-primary text-primary-foreground px-4 py-2 text-sm font-medium disabled:opacity-50 flex items-center gap-1.5">
            {busy ? <Loader2 className="size-4 animate-spin" /> : <Upload className="size-4" />}
            {busy ? "Uploading…" : "Upload"}
          </button>
        </div>
      </form>
    </div>
  );
}
