"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ChevronLeft, Upload, Loader2 } from "lucide-react";
import { SelectField } from "@/components/ui/SelectField";
import { DateField } from "@/components/ui/DateField";
import { InvestorLookup } from "@/components/common/InvestorLookup";

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
  const [client, setClient] = useState<{ id: string; name: string } | null>(null);
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
      // 1. Upload the file THROUGH our server to S3 (server→S3, so no bucket
      //    CORS and no presigned signed-header replay to get wrong). Returns the
      //    storage key we then register below.
      const fd = new FormData();
      fd.append("file", file);
      fd.append("kind", "compliance");
      const upRes = await fetch("/api/compliance/upload", { method: "POST", body: fd });
      const upJson = await upRes.json().catch(() => ({}));
      if (!upRes.ok || !upJson.key) {
        setErr(upJson.error ?? `Upload failed (HTTP ${upRes.status})`);
        return;
      }

      // 2. Register in compliance_documents
      const regRes = await fetch("/api/compliance/documents", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: form.name || file.name,
          category: form.category,
          description: form.description,
          storageKey: upJson.key,
          mimeType: upJson.contentType ?? file.type,
          sizeBytes: upJson.sizeBytes ?? file.size,
          expiresOn: form.expiresOn || undefined,
          relatedEntityType: client ? "investor" : undefined,
          relatedEntityId: client?.id,
        }),
      });
      const regJson = await regRes.json().catch(() => ({}));
      if (!regRes.ok) {
        setErr(regJson.error ?? "Register failed");
        return;
      }
      router.push("/dashboard/documents");
      router.refresh();
    } catch (e: any) {
      // Without this catch, a network/upload error left the spinner stopping
      // with no message — the user saw nothing.
      setErr(e?.message ? `Upload error: ${e.message}` : "Upload failed unexpectedly");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4 max-w-4xl">
      <Link href="/dashboard/documents" className="text-sm text-muted-foreground hover:underline flex items-center gap-1">
        <ChevronLeft className="size-4" /> Back to documents
      </Link>
      <h1 className="text-2xl font-bold tracking-tight">Upload document</h1>
      <p className="text-sm text-muted-foreground">
        Files are stored encrypted in S3 (ap-south-1, DPDP-compliant).
      </p>

      <form onSubmit={submit} className="border rounded-lg bg-card p-5 space-y-4">
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

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          <label className="block">
            <div className="text-xs font-medium mb-1">Document name</div>
            <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder={file?.name ?? ""} className="w-full border rounded-md px-3 py-2 text-sm bg-background" />
          </label>
          <label className="block">
            <div className="text-xs font-medium mb-1">Category</div>
            <SelectField value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} className="w-full">
              {CATEGORIES.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
            </SelectField>
          </label>
          <label className="block">
            <div className="text-xs font-medium mb-1">Expires on</div>
            <DateField value={form.expiresOn} onChange={(e) => setForm({ ...form, expiresOn: e.target.value })} className="w-full" />
          </label>
          <label className="block sm:col-span-2">
            <div className="text-xs font-medium mb-1">Link to a client <span className="text-muted-foreground font-normal">(optional — for KYC / client documents)</span></div>
            <InvestorLookup
              value={client?.id}
              displayName={client?.name}
              onSelect={(id, name) => setClient({ id, name })}
              onClear={() => setClient(null)}
              placeholder="Search client by name, PAN, or mobile…"
            />
            <div className="text-[11px] text-muted-foreground mt-1">Tag the client this document belongs to, so you can see it in the vault.</div>
          </label>
          <label className="block sm:col-span-2 lg:col-span-1">
            <div className="text-xs font-medium mb-1">Notes</div>
            <textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} rows={2} className="w-full border rounded-md px-3 py-2 text-sm bg-background" />
          </label>
        </div>
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
