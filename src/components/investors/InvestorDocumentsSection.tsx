"use client";

/**
 * InvestorDocumentsSection — Documents & attachments for one client. Self-
 * fetching island used on the investor-360 page. Lists files linked to this
 * investor in `compliance_documents` (RM-uploaded here + auto-ingested uploads
 * from the public required-documents form), with upload / download / delete.
 */

import { useEffect, useRef, useState } from "react";
import { FileText, Upload, Download, Trash2, Loader2, FolderOpen, UserCheck, Send, Link as LinkIcon, Copy, ExternalLink, CheckCircle2, Eye, Cloud, HardDrive } from "lucide-react";
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

export function InvestorDocumentsSection({ investorId, investorName, investorPhone, investorEmail }: { investorId: string; investorName?: string; investorPhone?: string | null; investorEmail?: string | null }) {
  const toast = useToast();
  const [docs, setDocs] = useState<Doc[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [storage, setStorage] = useState<{ configured: boolean; bucket: string; region: string } | null>(null);
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

  // Tell the user where uploads actually land (S3 vs local disk on the server).
  useEffect(() => {
    fetch("/api/diagnostics/storage")
      .then((r) => (r.ok ? r.json() : null))
      .then((s) => s && setStorage({ configured: !!s.configured, bucket: s.bucket, region: s.region }))
      .catch(() => {});
  }, []);

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
        // 1. Upload through our server to S3 (no bucket CORS, no presigned
        //    signed-header replay). Returns the storage key.
        const fd = new FormData();
        fd.append("file", file);
        fd.append("kind", "kyc");
        const up = await fetch("/api/compliance/upload", { method: "POST", body: fd })
          .then((r) => r.json())
          .catch(() => ({}));
        if (!up?.key) {
          toast.error(up?.error ?? "Could not upload", "Upload failed");
          continue;
        }
        // 2. register against this client
        const reg = await fetch(`/api/investors/${investorId}/documents`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ name: file.name, storageKey: up.key, mimeType: up.contentType ?? ct, sizeBytes: up.sizeBytes ?? file.size, category: "kyd" }),
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

  // View opens the file inline in a new tab (PDF/image preview) rather than
  // forcing a download.
  async function view(d: Doc) {
    setBusyId(d.id);
    try {
      const res = await fetch(`/api/investors/${investorId}/documents/download?docId=${d.id}&inline=1`);
      const j = await res.json().catch(() => ({}));
      if (res.ok && j.url) window.open(j.url, "_blank", "noopener,noreferrer");
      else toast.error(j.error ?? "Could not open document", "View failed");
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

  // ── Request documents from the client — mints a secure investor doc-collection link ──
  const [showReq, setShowReq] = useState(false);
  const [reqType, setReqType] = useState<"individual" | "huf" | "nri" | "minor" | "company" | "trust">("individual");
  const [reqBusy, setReqBusy] = useState(false);
  const [reqErr, setReqErr] = useState<string | null>(null);
  const [reqLink, setReqLink] = useState<{ url: string; expiresAt: string } | null>(null);
  const [copied, setCopied] = useState(false);

  async function requestDocs() {
    setReqBusy(true);
    setReqErr(null);
    setReqLink(null);
    try {
      const { getChecklist } = await import("@/lib/onboarding/doc-checklists");
      const requiredDocs = getChecklist(reqType);
      const r = await fetch("/api/share-tokens", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          kind: "document_collection",
          subjectType: "investor",
          subjectId: investorId,
          expiresInDays: 7,
          payload: { requiredDocs, clientType: reqType },
        }),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(data?.error ?? `HTTP ${r.status}`);
      setReqLink({ url: data.url, expiresAt: new Date(data.expiresAt).toLocaleString("en-IN") });
    } catch (e: any) {
      setReqErr(e?.message ?? "Failed to create link");
    } finally {
      setReqBusy(false);
    }
  }

  async function copyLink() {
    if (!reqLink) return;
    await navigator.clipboard.writeText(reqLink.url);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  const reqWaUrl =
    reqLink && investorPhone
      ? `https://wa.me/${investorPhone.replace(/[^\d]/g, "")}?text=${encodeURIComponent(
          `Hi ${investorName ?? "there"}, please upload your KYC documents to complete your account setup — secure, single-use link:\n\n${reqLink.url}\n\nYou'll need: PAN, Aadhar, photo, recent bank statement, cancelled cheque.`
        )}`
      : null;
  const reqMailUrl =
    reqLink && investorEmail
      ? `mailto:${investorEmail}?subject=${encodeURIComponent(
          "Documents needed for your investment account"
        )}&body=${encodeURIComponent(
          `Hi ${investorName ?? ""},\n\nTo complete your account setup, please upload the following documents using this secure link:\n\n${reqLink.url}\n\nRequired: PAN card, Aadhar card, passport-size photo, recent bank statement, cancelled cheque.\n\nThe link is single-use and expires soon.\n\nRegards`
        )}`
      : null;

  const clientDocs = docs.filter((d) => d.clientUploaded);
  const teamDocs = docs.filter((d) => !d.clientUploaded);

  return (
    <div id="documents" className="card-surface p-5 scroll-mt-24">
      <div className="flex items-center justify-between flex-wrap gap-3 mb-4">
        <h3 className="font-semibold flex items-center gap-2">
          <FolderOpen className="size-4 text-brand-cyan" /> Documents &amp; attachments
          {docs.length > 0 && <span className="chip text-[10px] bg-secondary">{docs.length}</span>}
          {storage &&
            (storage.configured ? (
              <span
                className="chip text-[9px] bg-emerald-50 text-emerald-700 inline-flex items-center gap-1"
                title={`Uploads are stored in S3 bucket "${storage.bucket}" (${storage.region})`}
              >
                <Cloud className="size-3" /> S3
              </span>
            ) : (
              <span
                className="chip text-[9px] bg-amber-50 text-amber-700 inline-flex items-center gap-1"
                title="S3 is not configured on the server — files save to local disk. Set S3 env vars + redeploy."
              >
                <HardDrive className="size-3" /> Local disk
              </span>
            ))}
        </h3>
        <div className="flex items-center gap-2">
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
            onClick={() => setShowReq((v) => !v)}
            className="btn-secondary text-sm inline-flex items-center gap-1.5"
          >
            <Send className="size-4" /> Request from client
          </button>
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

      {showReq && (
        <div className="mb-4 rounded-lg border border-brand-cyan/30 bg-brand-cyan-light/20 p-3 space-y-2">
          <div className="text-xs font-semibold uppercase tracking-wider text-brand-cyan-deep flex items-center gap-1.5">
            <LinkIcon className="size-3.5" /> Send a secure document-collection link
          </div>
          <p className="text-[11px] text-muted-foreground">
            Pick the client type — it drives which KYC documents are requested. The client uploads from
            WhatsApp / email and the files appear here automatically.
          </p>
          {!reqLink ? (
            <>
              <select
                value={reqType}
                onChange={(e) => setReqType(e.target.value as any)}
                className="input-base text-xs w-full"
              >
                <option value="individual">Individual / Resident</option>
                <option value="huf">HUF (Hindu Undivided Family)</option>
                <option value="nri">NRI (Non-Resident Indian)</option>
                <option value="minor">Minor (Below 18)</option>
                <option value="company">Company / Corporate</option>
                <option value="trust">Trust</option>
              </select>
              {reqErr && <div className="text-xs text-rose-700">{reqErr}</div>}
              <div className="flex gap-2">
                <button
                  onClick={requestDocs}
                  disabled={reqBusy}
                  className="btn-primary text-xs inline-flex items-center gap-1 disabled:opacity-50"
                >
                  {reqBusy ? <Loader2 className="size-3 animate-spin" /> : <Send className="size-3" />} Generate link
                </button>
                <button onClick={() => setShowReq(false)} className="btn-ghost text-xs">
                  Cancel
                </button>
              </div>
            </>
          ) : (
            <div className="rounded-md border border-emerald-300 bg-emerald-50/50 p-2.5 space-y-2">
              <div className="flex items-center gap-2 text-emerald-700 text-xs font-semibold">
                <CheckCircle2 className="size-4" /> Link ready · expires {reqLink.expiresAt}
              </div>
              <div className="flex gap-2">
                <input
                  readOnly
                  value={reqLink.url}
                  onClick={(e) => (e.target as HTMLInputElement).select()}
                  className="flex-1 border rounded-md px-2 py-1.5 text-xs font-mono bg-white"
                />
                <button onClick={copyLink} className="rounded-md border bg-white px-2 text-xs flex items-center gap-1 hover:bg-secondary">
                  <Copy className="size-3" /> {copied ? "Copied!" : "Copy"}
                </button>
              </div>
              <div className="flex flex-wrap gap-2 text-xs">
                {reqWaUrl && (
                  <a href={reqWaUrl} target="_blank" rel="noreferrer" className="btn-secondary text-xs">
                    Send via WhatsApp <ExternalLink className="size-3" />
                  </a>
                )}
                {reqMailUrl && (
                  <a href={reqMailUrl} className="btn-secondary text-xs">
                    Send via Email <ExternalLink className="size-3" />
                  </a>
                )}
                <a href={reqLink.url} target="_blank" rel="noreferrer" className="btn-ghost text-xs">
                  Preview <ExternalLink className="size-3" />
                </a>
                <button onClick={() => setReqLink(null)} className="btn-ghost text-xs">
                  New link
                </button>
              </div>
            </div>
          )}
        </div>
      )}

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
              onView={view}
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
            onView={view}
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
  onView,
  onDownload,
  onDelete,
}: {
  title: string;
  icon: any;
  docs: Doc[];
  emptyHint?: string;
  busyId: string | null;
  onView: (d: Doc) => void;
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
                onClick={() => onView(d)}
                disabled={busyId === d.id}
                className="size-8 grid place-items-center rounded-md text-muted-foreground hover:bg-secondary hover:text-foreground transition-colors disabled:opacity-50"
                title="View"
              >
                {busyId === d.id ? <Loader2 className="size-4 animate-spin" /> : <Eye className="size-4" />}
              </button>
              <button
                type="button"
                onClick={() => onDownload(d)}
                disabled={busyId === d.id}
                className="size-8 grid place-items-center rounded-md text-muted-foreground hover:bg-secondary hover:text-foreground transition-colors disabled:opacity-50"
                title="Download"
              >
                <Download className="size-4" />
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
