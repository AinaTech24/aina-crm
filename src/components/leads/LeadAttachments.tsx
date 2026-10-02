"use client";

/**
 * Attachments on a lead: files the team uploads (or the lead sent through a
 * document link) and the lead's proposals with their PDFs, in one card.
 *
 * Files: GET/POST/DELETE /api/leads/[id]/documents — stored in the document
 * vault against the lead, and moved to the client when the lead converts.
 * Proposals are listed from the proposals module, never copied, so the PDF
 * here is always the proposal as it stands. Downloads go through
 * DownloadButton / a presigned URL — no /api/ route in an href.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Download, Eye, FileText, Loader2, Paperclip, Presentation, Trash2, Upload } from "lucide-react";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { InlineEmpty } from "@/components/common/EmptyState";
import { DownloadButton } from "@/components/common/SecureLinkButtons";
import { DocumentViewerModal, type ViewerDoc } from "@/components/documents/DocumentViewerModal";
import { buttonClass } from "@/components/ui/button-class";
import { confirmDialog } from "@/components/ui/ConfirmProvider";
import { notify } from "@/components/ui/Toast";
import { formatDate, formatMoney, humanise } from "@/lib/format";

type Doc = { id: string; name: string; mimeType: string | null; sizeBytes: string | null; clientUploaded: boolean; createdAt: string };
type Prop = { id: string; number: string; title: string; status: string; total: number | null; createdAt: string; canPdf: boolean };

const MAX_MB = 25;

function sizeText(b?: string | null) {
  const n = Number(b);
  if (!Number.isFinite(n) || n <= 0) return null;
  return n >= 1024 * 1024 ? `${(n / (1024 * 1024)).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`;
}

export function LeadAttachments({ leadId, leadName }: { leadId: string; leadName: string }) {
  const [docs, setDocs] = useState<Doc[] | null>(null);
  const [props, setProps] = useState<Prop[]>([]);
  const [failed, setFailed] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [viewer, setViewer] = useState<ViewerDoc | null>(null);
  const input = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/leads/${leadId}/documents`, { cache: "no-store" });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j.error ?? "failed");
      setDocs(Array.isArray(j.documents) ? j.documents : []);
      setProps(Array.isArray(j.proposals) ? j.proposals : []);
      setFailed(false);
    } catch {
      setFailed(true);
      setDocs([]);
    }
  }, [leadId]);

  useEffect(() => { void load(); }, [load]);

  async function upload(files: FileList | null) {
    if (!files?.length) return;
    setUploading(true);
    let ok = 0;
    try {
      for (const file of Array.from(files)) {
        if (file.size > MAX_MB * 1024 * 1024) {
          notify.error(`${file.name} is larger than ${MAX_MB} MB`, "Not uploaded");
          continue;
        }
        const fd = new FormData();
        fd.append("file", file);
        fd.append("kind", "general");
        fd.append("docType", "lead");
        fd.append("clientName", leadName);
        const up = await fetch("/api/compliance/upload", { method: "POST", body: fd }).then((r) => r.json()).catch(() => ({}));
        if (!up?.key) {
          notify.error(up?.error ?? `Couldn't upload ${file.name}`, "Not uploaded");
          continue;
        }
        const reg = await fetch(`/api/leads/${leadId}/documents`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ name: file.name, storageKey: up.key, mimeType: up.contentType ?? file.type, sizeBytes: up.sizeBytes ?? file.size }),
        });
        if (reg.ok) ok++;
        else {
          const j = await reg.json().catch(() => ({}));
          notify.error(j.error ?? `Couldn't save ${file.name}`, "Not uploaded");
        }
      }
      if (ok) {
        notify.success(`${ok} file${ok === 1 ? "" : "s"} attached`);
        await load();
      }
    } finally {
      setUploading(false);
      if (input.current) input.current.value = "";
    }
  }

  async function signedUrl(d: Doc, inline: boolean) {
    const res = await fetch(`/api/leads/${leadId}/documents/download?docId=${d.id}${inline ? "&inline=1" : ""}`);
    const j = await res.json().catch(() => ({}));
    if (!res.ok || !j.url) throw new Error(j.error ?? "Couldn't open the file");
    return String(j.url);
  }

  async function download(d: Doc) {
    setBusy(d.id);
    try { window.open(await signedUrl(d, false), "_blank", "noopener,noreferrer"); }
    catch (e: any) { notify.error(e?.message ?? "Couldn't open the file", "Download failed"); }
    finally { setBusy(null); }
  }

  async function view(d: Doc) {
    setBusy(d.id);
    try { setViewer({ name: d.name, mimeType: d.mimeType, src: await signedUrl(d, true), onDownload: () => download(d) }); }
    catch (e: any) { notify.error(e?.message ?? "Couldn't open the file", "View failed"); }
    finally { setBusy(null); }
  }

  async function remove(d: Doc) {
    if (!(await confirmDialog({ title: `Remove ${d.name}?`, message: "The file is deleted from this lead.", confirmLabel: "Remove", tone: "danger" }))) return;
    setBusy(d.id);
    try {
      const res = await fetch(`/api/leads/${leadId}/documents?docId=${d.id}`, { method: "DELETE" });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j.error ?? "Couldn't remove the file");
      setDocs((list) => (list ?? []).filter((x) => x.id !== d.id));
      notify.success("File removed");
    } catch (e: any) {
      notify.error(e?.message ?? "Couldn't remove the file", "Not removed");
    } finally {
      setBusy(null);
    }
  }

  const count = (docs?.length ?? 0) + props.length;

  return (
    <Card>
      <CardHeader
        title={`Attachments${docs && !failed ? ` (${count})` : ""}`}
        subtitle="Files for this lead, and every proposal prepared for them. Files move to the client record on conversion."
        icon={<Paperclip className="size-4" />}
        action={
          <>
            <input ref={input} type="file" multiple className="hidden" aria-label="Attach files to this lead" onChange={(e) => upload(e.target.files)} />
            <button type="button" onClick={() => input.current?.click()} disabled={uploading} className={buttonClass("secondary", "sm", "gap-1.5")}>
              {uploading ? <Loader2 className="size-3.5 animate-spin" /> : <Upload className="size-3.5" />}
              {uploading ? "Uploading…" : "Upload file"}
            </button>
          </>
        }
      />
      <CardBody className="space-y-4">
        {docs === null ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin" /> Loading attachments…</div>
        ) : failed ? (
          <p className="text-sm text-muted-foreground">Couldn&apos;t load the attachments. Refresh the page to try again.</p>
        ) : count === 0 ? (
          <InlineEmpty message={`Nothing attached yet. Upload a document (up to ${MAX_MB} MB each); proposals prepared for this lead appear here too.`} />
        ) : (
          <>
            {props.length > 0 && (
              <section className="space-y-1.5">
                <h4 className="text-xs font-semibold text-muted-foreground">Proposals</h4>
                <ul className="space-y-1.5">
                  {props.map((p) => (
                    <li key={p.id} className="flex items-center gap-3 rounded-lg border border-border px-3 py-2">
                      <Presentation className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                      <div className="min-w-0 flex-1">
                        <Link href={`/dashboard/proposals/${p.id}`} className="block truncate text-sm font-medium hover:underline">
                          {p.title || p.number}
                        </Link>
                        <div className="text-2xs text-muted-foreground">
                          {p.number} · {humanise(p.status)} · {formatDate(p.createdAt)}
                          {p.total ? ` · ${formatMoney(p.total)}` : ""}
                        </div>
                      </div>
                      {p.canPdf && (
                        <DownloadButton
                          url={`/api/proposals/${p.id}/pdf?download=1`}
                          filename={`Proposal_${p.number}.pdf`}
                          className={buttonClass("ghost", "icon")}
                          title="Download PDF"
                          ariaLabel={`Download proposal ${p.number} as PDF`}
                        >
                          <Download className="size-3.5" />
                        </DownloadButton>
                      )}
                    </li>
                  ))}
                </ul>
              </section>
            )}
            {docs.length > 0 && (
              <section className="space-y-1.5">
                {props.length > 0 && <h4 className="text-xs font-semibold text-muted-foreground">Files</h4>}
                <ul className="space-y-1.5">
                  {docs.map((d) => (
                    <li key={d.id} className="flex items-center gap-3 rounded-lg border border-border px-3 py-2">
                      <FileText className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-medium">{d.name}</div>
                        <div className="text-2xs text-muted-foreground">
                          {[formatDate(d.createdAt), sizeText(d.sizeBytes), d.clientUploaded ? "Sent by the lead" : null].filter(Boolean).join(" · ")}
                        </div>
                      </div>
                      {busy === d.id ? (
                        <Loader2 className="size-4 animate-spin text-muted-foreground" />
                      ) : (
                        <div className="flex items-center gap-0.5">
                          <button type="button" onClick={() => view(d)} className={buttonClass("ghost", "icon")} title="View" aria-label={`View ${d.name}`}>
                            <Eye className="size-3.5" />
                          </button>
                          <button type="button" onClick={() => download(d)} className={buttonClass("ghost", "icon")} title="Download" aria-label={`Download ${d.name}`}>
                            <Download className="size-3.5" />
                          </button>
                          <button type="button" onClick={() => remove(d)} className={buttonClass("ghost", "icon", "hover:text-destructive")} title="Remove" aria-label={`Remove ${d.name}`}>
                            <Trash2 className="size-3.5" />
                          </button>
                        </div>
                      )}
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </>
        )}
      </CardBody>
      <DocumentViewerModal doc={viewer} onClose={() => setViewer(null)} />
    </Card>
  );
}
