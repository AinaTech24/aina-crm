"use client";

/**
 * InvestorDocumentsSection — Documents & attachments for one client. Self-
 * fetching island used on the investor-360 page. Lists files linked to this
 * investor in `compliance_documents` (RM-uploaded here + auto-ingested uploads
 * from the public required-documents form), with upload / download / delete.
 */

import { useEffect, useRef, useState } from "react";
import { FileText, Upload, Download, Trash2, Loader2, FolderOpen, UserCheck } from "lucide-react";
import { useToast } from "@/components/ui/Toast";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";

type Doc = {
  id: string;
  name: string;
  category: string;
  description: string | null;
  mimeType: string | null;
  sizeBytes: string | null;
  tags: string[];
  clientUploaded: boolean;
  createdAt: string;
};

function fmtSize(b?: string | null): string {
  const n = Number(b);
  if (!Number.isFinite(n) || n <= 0) return "";
  if (n >= 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  if (n >= 1024) return `${Math.round(n / 1024)} KB`;
  return `${n} B`;
}
function fmtDate(s?: string): string {
  if (!s) return "";
  const d = new Date(s);
  return isNaN(d.getTime()) ? "" : d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}

export function InvestorDocumentsSection({ investorId, investorName }: { investorId: string; investorName?: string }) {
  const toast = useToast();
  const [docs, setDocs] = useState<Doc[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  async function load() {
    try {
      const res = await fetch(`/api/investors/${investorId}/documents`);
      const j = await res.json().catch(() => ({}));
      if (res.ok) setDocs(Array.isArray(j.documents) ? j.documents : []);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [investorId]);

  async function onFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    setUploading(true);
    let ok = 0;
    try {
      for (const file of Array.from(files)) {
        if (file.size > 15 * 1024 * 1024) {
          toast.error(`${file.name} is over 15 MB`, "Too large");
          continue;
        }
        const ct = file.type || "application/octet-stream";
        // 1. presigned PUT
        const up = await fetch("/api/compliance/upload-url", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ filename: file.name, contentType: ct, kind: "kyc" }),
        }).then((r) => r.json()).catch(() => ({}));
        if (!up?.url || !up?.key) {
          toast.error(up?.error ?? "Could not start upload", "Upload failed");
          continue;
        }
        // 2. PUT the file
        const put = await fetch(up.url, { method: "PUT", body: file, headers: { "content-type": ct } });
        if (!put.ok) {
          toast.error(`Could not upload ${file.name}`, "Upload failed");
          continue;
        }
        // 3. register against this client
        const reg = await fetch(`/api/investors/${investorId}/documents`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ name: file.name, storageKey: up.key, mimeType: ct, sizeBytes: file.size, category: "kyd" }),
        });
        if (reg.ok) ok += 1;
        else {
          const j = await reg.json().catch(() => ({}));
          toast.error(j.error ?? `Could not save ${file.name}`, "Upload failed");
        }
      }
      if (ok > 0) {
        toast.success(`${ok} document${ok === 1 ? "" : "s"} uploaded`);
        load();
      }
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  async function download(d: Doc) {
    setBusyId(d.id);
    try {
      const res = await fetch(`/api/investors/${investorId}/documents/download?docId=${d.id}`);
      const j = await res.json().catch(() => ({}));
      if (res.ok && j.url) window.open(j.url, "_blank", "noopener,noreferrer");
      else toast.error(j.error ?? "Could not open document", "Download failed");
    } finally {
      setBusyId(null);
    }
  }

  async function doDelete(docId: string) {
    setBusyId(docId);
    try {
      const res = await fetch(`/api/investors/${investorId}/documents?docId=${docId}`, { method: "DELETE" });
      const j = await res.json().catch(() => ({}));
      if (res.ok) {
        toast.success("Document removed");
        setDocs((ds) => ds.filter((x) => x.id !== docId));
      } else {
        toast.error(j.error ?? "Could not delete", "Delete failed");
      }
    } finally {
      setBusyId(null);
      setConfirmId(null);
    }
  }

  const clientDocs = docs.filter((d) => d.clientUploaded);
  const teamDocs = docs.filter((d) => !d.clientUploaded);

  return (
    <div className="card-surface p-5">
      <div className="flex items-center justify-between flex-wrap gap-3 mb-4">
        <h3 className="font-semibold flex items-center gap-2">
          <FolderOpen className="size-4 text-brand-cyan" /> Documents &amp; attachments
          {docs.length > 0 && <span className="chip text-[10px] bg-secondary">{docs.length}</span>}
        </h3>
        <div>
          <input
            ref={fileRef}
            type="file"
            multiple
            className="hidden"
            onChange={(e) => onFiles(e.target.files)}
            accept=".pdf,.jpg,.jpeg,.png,.webp,.doc,.docx,.xls,.xlsx,.csv"
          />
          <button
            type="button"
            disabled={uploading}
            onClick={() => fileRef.current?.click()}
            className="btn-primary text-sm inline-flex items-center gap-1.5 disabled:opacity-50"
          >
            {uploading ? <Loader2 className="size-4 animate-spin" /> : <Upload className="size-4" />}
            Upload
          </button>
        </div>
      </div>

      {loading ? (
        <div className="py-10 text-center text-sm text-muted-foreground flex items-center justify-center gap-2">
          <Loader2 className="size-4 animate-spin" /> Loading documents…
        </div>
      ) : docs.length === 0 ? (
        <div className="py-10 text-center text-sm text-muted-foreground">
          <FileText className="size-8 mx-auto text-muted-foreground/40" />
          <div className="mt-2">No documents yet.</div>
          <p className="mt-1 text-xs max-w-sm mx-auto">
            Upload KYC / agreement files here. Documents {investorName ?? "the client"} submits via the
            required-documents link appear here automatically.
          </p>
        </div>
      ) : (
        <div className="space-y-5">
          {clientDocs.length > 0 && (
            <DocGroup
              title="Client-uploaded (required documents)"
              icon={UserCheck}
              docs={clientDocs}
              busyId={busyId}
              onDownload={download}
              onDelete={(id) => setConfirmId(id)}
            />
          )}
          <DocGroup
            title={clientDocs.length > 0 ? "Added by your team" : "All documents"}
            icon={FileText}
            docs={teamDocs}
            emptyHint={teamDocs.length === 0 ? "Nothing added by the team yet." : undefined}
            busyId={busyId}
            onDownload={download}
            onDelete={(id) => setConfirmId(id)}
          />
        </div>
      )}

      <ConfirmDialog
        open={!!confirmId}
        title="Delete document?"
        message="This permanently removes the file from this client's record."
        confirmLabel="Delete"
        tone="danger"
        busy={busyId === confirmId}
        onConfirm={() => confirmId && doDelete(confirmId)}
        onCancel={() => setConfirmId(null)}
      />
    </div>
  );
}

function DocGroup({
  title,
  icon: Icon,
  docs,
  emptyHint,
  busyId,
  onDownload,
  onDelete,
}: {
  title: string;
  icon: any;
  docs: Doc[];
  emptyHint?: string;
  busyId: string | null;
  onDownload: (d: Doc) => void;
  onDelete: (id: string) => void;
}) {
  return (
    <div>
      <div className="text-xs font-semibold text-muted-foreground flex items-center gap-1.5 mb-2">
        <Icon className="size-3.5" /> {title}
      </div>
      {emptyHint ? (
        <div className="text-xs text-muted-foreground/70 px-1 py-2">{emptyHint}</div>
      ) : (
        <ul className="divide-y divide-border rounded-lg border border-border overflow-hidden">
          {docs.map((d) => (
            <li key={d.id} className="flex items-center gap-3 px-3 py-2.5 hover:bg-brand-cyan-light/20 transition-colors">
              <FileText className="size-4 text-muted-foreground shrink-0" />
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium truncate">{d.name}</div>
                <div className="text-[11px] text-muted-foreground flex items-center gap-2 flex-wrap">
                  <span className="capitalize">{d.category.replace(/_/g, " ")}</span>
                  {fmtSize(d.sizeBytes) && <span>· {fmtSize(d.sizeBytes)}</span>}
                  {fmtDate(d.createdAt) && <span>· {fmtDate(d.createdAt)}</span>}
                  {d.clientUploaded && <span className="chip text-[9px] bg-emerald-50 text-emerald-700">client</span>}
                </div>
              </div>
              <button
                type="button"
                onClick={() => onDownload(d)}
                disabled={busyId === d.id}
                className="size-8 grid place-items-center rounded-md text-muted-foreground hover:bg-secondary hover:text-foreground transition-colors disabled:opacity-50"
                title="Download"
              >
                {busyId === d.id ? <Loader2 className="size-4 animate-spin" /> : <Download className="size-4" />}
              </button>
              <button
                type="button"
                onClick={() => onDelete(d.id)}
                disabled={busyId === d.id}
                className="size-8 grid place-items-center rounded-md text-muted-foreground hover:bg-rose-50 hover:text-rose-600 transition-colors disabled:opacity-50"
                title="Delete"
              >
                <Trash2 className="size-4" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
