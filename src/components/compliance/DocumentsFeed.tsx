"use client";

/**
 * The Documents vault list: client folders, a page at a time, each opening onto its own paged list
 * of documents. Search and category live in the URL (`q`, `category`, `page`), so the server
 * answers over EVERY document the viewer may see (lib/compliance/vault-folders.ts).
 */

import { useCallback, useEffect, useRef, useState, useTransition, type ReactNode } from "react";
import { notify } from "@/components/ui/Toast";
import { usePathname, useRouter } from "next/navigation";
import {
  FolderArchive,
  AlertTriangle,
  Download,
  DownloadCloud,
  Trash2,
  Loader2,
  Search,
  Filter,
  Building2,
  ChevronRight,
  Eye,
  ExternalLink,
  ChevronLeft,
  FileText,
  RefreshCw,
} from "lucide-react";
import { formatDate, formatRelative } from "@/lib/utils";
import { DocumentViewerModal, type ViewerDoc } from "@/components/documents/DocumentViewerModal";
import { Avatar } from "@/components/ui/Avatar";
import { SelectField } from "@/components/ui/SelectField";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { DownloadButton } from "@/components/common/SecureLinkButtons";
import { Pager } from "@/components/common/Pager";
import { DOCS_PER_PAGE, ZIP_MAX_DOCS, type VaultDoc, type VaultFolder } from "@/lib/compliance/vault-view";

const CATEGORY_COLORS: Record<string, string> = {
  arn: "bg-purple-50 text-purple-700 border-purple-200",
  euin: "bg-purple-50 text-purple-700 border-purple-200",
  nism: "bg-purple-50 text-purple-700 border-purple-200",
  kyd: "bg-indigo-50 text-indigo-700 border-indigo-200",
  amc_empanelment: "bg-blue-50 text-blue-700 border-blue-200",
  ddq: "bg-emerald-50 text-emerald-700 border-emerald-200",
  sop: "bg-amber-50 text-amber-700 border-amber-200",
  marketing_approval: "bg-pink-50 text-pink-700 border-pink-200",
  complaint: "bg-rose-50 text-rose-700 border-rose-200",
  audit_report: "bg-brand-cyan-light/50 text-brand-cyan-deep border-brand-cyan/30",
  ria_compliance: "bg-teal-50 text-teal-700 border-teal-200",
  other: "bg-secondary text-foreground border-border",
};

export function DocumentsFeed({
  folders,
  totalFolders,
  page,
  pageSize,
  q,
  category,
  stats,
}: {
  folders: VaultFolder[];
  totalFolders: number;
  page: number;
  pageSize: number;
  q: string;
  category: string;
  stats: { total: number; expiringSoon: number; expired: number };
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [filtering, startFiltering] = useTransition();
  const [searchQuery, setSearchQuery] = useState(q);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [deletingGroup, setDeletingGroup] = useState<string | null>(null);
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [viewer, setViewer] = useState<ViewerDoc | null>(null);
  const [replacingId, setReplacingId] = useState<string | null>(null);
  /** Bumped after a delete or replace, so open folders read their documents again. */
  const [version, setVersion] = useState(0);
  const replaceRef = useRef<HTMLInputElement>(null);
  const replaceDocRef = useRef<VaultDoc | null>(null);
  const [pendingDelete, setPendingDelete] = useState<
    { kind: "single"; id: string; name: string } | { kind: "group"; group: VaultFolder } | null
  >(null);
  const filtered = !!(q || category);

  // A new search or category starts from the first page of folders.
  const apply = useCallback(
    (nextQ: string, nextCategory: string) => {
      const p = new URLSearchParams();
      if (nextQ) p.set("q", nextQ);
      if (nextCategory) p.set("category", nextCategory);
      const qs = p.toString();
      startFiltering(() => router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false }));
    },
    [pathname, router],
  );

  // Search as they type (after a pause). `sent` tells our own navigation from Back / Forward,
  // so a result arriving mid-typing never overwrites what is in the box.
  const sent = useRef(q);
  useEffect(() => {
    if (q !== sent.current) {
      sent.current = q;
      setSearchQuery(q);
    }
  }, [q]);
  useEffect(() => {
    const next = searchQuery.trim().slice(0, 100);
    if (next === sent.current) return;
    const timer = setTimeout(() => {
      sent.current = next;
      apply(next, category);
    }, 350);
    return () => clearTimeout(timer);
  }, [searchQuery, category, apply]);

  const changed = () => {
    setVersion((v) => v + 1);
    router.refresh();
  };

  function startReplace(doc: VaultDoc) {
    replaceDocRef.current = doc;
    replaceRef.current?.click();
  }

  async function onReplaceFile(file: File | null) {
    const doc = replaceDocRef.current;
    if (!file || !doc) return;
    setReplacingId(doc.id);
    try {
      // 1. Upload the new file, 2. supersede the old row with it.
      const fd = new FormData();
      fd.append("file", file);
      fd.append("kind", "compliance");
      fd.append("docType", doc.category || "compliance");
      const up = await fetch("/api/compliance/upload", { method: "POST", body: fd }).then((r) => r.json()).catch(() => ({}));
      if (!up?.key) {
        notify.error(up?.error ?? "Upload failed");
        return;
      }
      const res = await fetch(`/api/compliance/documents/${doc.id}/supersede`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: file.name, storageKey: up.key, mimeType: up.contentType ?? file.type, sizeBytes: up.sizeBytes ?? file.size }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) {
        notify.error(j.error ?? "Replace failed");
        return;
      }
      changed();
    } finally {
      setReplacingId(null);
      replaceDocRef.current = null;
      if (replaceRef.current) replaceRef.current.value = "";
    }
  }

  async function handleDelete(id: string) {
    setDeletingId(id);
    try {
      const res = await fetch(`/api/compliance/documents?id=${encodeURIComponent(id)}`, { method: "DELETE" });
      if (res.ok) {
        changed();
      } else {
        notify.error("Failed to delete document.");
      }
    } catch (err) {
      console.error(err);
      notify.error("Error deleting document.");
    } finally {
      setDeletingId(null);
    }
  }

  function downloadAll(g: VaultFolder) {
    // One ZIP holds the newest ZIP_MAX_DOCS (the route's own limit).
    if (g.ids.length > ZIP_MAX_DOCS) notify.warning(`The ZIP holds the newest ${ZIP_MAX_DOCS} of ${g.ids.length} documents.`);
    const ids = g.ids.slice(0, ZIP_MAX_DOCS).join(",");
    const a = document.createElement("a");
    a.href = `/api/compliance/documents/download-all?ids=${encodeURIComponent(ids)}`;
    document.body.appendChild(a);
    a.click();
    a.remove();
  }

  async function deleteAll(g: VaultFolder) {
    setDeletingGroup(g.key);
    try {
      let ok = 0;
      // A few at a time: a folder can hold hundreds.
      for (let i = 0; i < g.ids.length; i += 8) {
        const results = await Promise.allSettled(
          g.ids.slice(i, i + 8).map((id) => fetch(`/api/compliance/documents?id=${encodeURIComponent(id)}`, { method: "DELETE" }))
        );
        ok += results.filter((r) => r.status === "fulfilled" && r.value.ok).length;
      }
      changed();
      if (ok < g.ids.length) notify.warning(`Deleted ${ok} of ${g.ids.length}. Some could not be removed.`);
    } catch (err) {
      console.error(err);
      notify.error("Error deleting documents.");
    } finally {
      setDeletingGroup(null);
    }
  }

  const renderDoc = (d: VaultDoc) => {
    const exp = d.expiresOn ? new Date(d.expiresOn) : null;
    const expired = exp && exp.getTime() < Date.now();
    const expiringSoon = exp && !expired && exp.getTime() - Date.now() < 30 * 24 * 60 * 60 * 1000;
    return (
      <div key={d.id} className="flex items-center gap-3 px-3 sm:px-4 py-2.5 hover:bg-accent/30">
        <FileText className="size-4 text-muted-foreground shrink-0" />
        <div className="flex-1 min-w-0">
          <div className="text-sm font-medium truncate">{d.name}</div>
          <div className="flex items-center gap-2 mt-0.5">
            <span className={`text-2xs font-bold border px-1.5 py-0.5 rounded-full ${CATEGORY_COLORS[d.category] ?? CATEGORY_COLORS.other}`}>
              {d.category === "kyd" ? "KYC" : d.category.toUpperCase().replace(/_/g, " ")}
            </span>
            {exp && (
              <span className={`text-2xs inline-flex items-center gap-0.5 ${expired ? "text-rose-600 font-semibold" : expiringSoon ? "text-amber-600 font-semibold" : "text-muted-foreground"}`}>
                {(expired || expiringSoon) && <AlertTriangle className="size-3" />}
                {expired ? "Expired " : "Expires "}{formatDate(exp)}
              </span>
            )}
            <span className="text-2xs text-muted-foreground">Uploaded {formatRelative(d.createdAt)}</span>
          </div>
        </div>
        <div className="flex items-center gap-1.5 print:hidden">
          {deletingId === d.id && <Loader2 className="size-4 animate-spin text-muted-foreground" />}
          <button
            type="button"
            onClick={() =>
              setViewer({
                name: d.name,
                mimeType: d.mimeType,
                src: `/api/compliance/documents/download?id=${encodeURIComponent(d.id)}&inline=1`,
                downloadHref: `/api/compliance/documents/download?id=${encodeURIComponent(d.id)}`,
              })
            }
            title="View"
            className="size-8 rounded-lg hover:bg-secondary/40 border border-border/40 grid place-items-center text-muted-foreground hover:text-brand-cyan transition-colors"
          >
            <Eye className="size-4" />
          </button>
          <DownloadButton
            url={`/api/compliance/documents/download?id=${encodeURIComponent(d.id)}`}
            title="Download"
            className="size-8 rounded-lg hover:bg-secondary/40 border border-border/40 grid place-items-center text-muted-foreground hover:text-brand-cyan transition-colors"
          >
            <Download className="size-4" />
          </DownloadButton>
          <button
            type="button"
            onClick={() => startReplace(d)}
            disabled={replacingId === d.id}
            title="Replace with a newer version"
            className="size-8 rounded-lg hover:bg-secondary/40 border border-border/40 grid place-items-center text-muted-foreground hover:text-brand-cyan transition-colors disabled:opacity-50"
          >
            {replacingId === d.id ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
          </button>
          <button
            type="button"
            onClick={() => setPendingDelete({ kind: "single", id: d.id, name: d.name })}
            disabled={deletingId != null}
            title="Delete"
            className="size-8 rounded-lg hover:bg-rose-50 border border-border/40 grid place-items-center text-muted-foreground hover:text-rose-600 hover:border-rose-200 transition-colors disabled:opacity-50"
          >
            <Trash2 className="size-4" />
          </button>
        </div>
      </div>
    );
  };

  return (
    <div className="space-y-6">
      {/* Hidden input for the per-row "Replace" action */}
      <input ref={replaceRef} type="file" className="hidden" onChange={(e) => onReplaceFile(e.target.files?.[0] ?? null)} accept=".pdf,.jpg,.jpeg,.png,.webp,.doc,.docx,.xls,.xlsx,.csv" />

      {/* Stats cards */}
      <div className="grid grid-cols-3 gap-4">
        <div className="border rounded-lg p-4 bg-card">
          <div className="text-xs text-muted-foreground">Total documents</div>
          <div className="text-2xl font-bold mt-1">{stats.total.toLocaleString("en-IN")}</div>
        </div>
        <div className="border rounded-lg p-4 bg-card">
          <div className="text-xs text-muted-foreground">Expiring (30d)</div>
          <div className={`text-2xl font-bold mt-1 ${stats.expiringSoon > 0 ? "text-amber-600" : "text-foreground"}`}>{stats.expiringSoon}</div>
        </div>
        <div className="border rounded-lg p-4 bg-card">
          <div className="text-xs text-muted-foreground">Expired</div>
          <div className={`text-2xl font-bold mt-1 ${stats.expired > 0 ? "text-rose-600" : "text-foreground"}`}>{stats.expired}</div>
        </div>
      </div>

      {/* Filter toolbar */}
      <div className="flex items-center justify-between gap-4 flex-wrap bg-secondary/10 p-3 rounded-lg border border-border/40 print:hidden">
        <div className="flex-1 min-w-[240px] relative">
          {filtering ? (
            <Loader2 className="absolute left-3 top-2.5 size-4 animate-spin text-muted-foreground" />
          ) : (
            <Search className="absolute left-3 top-2.5 size-4 text-muted-foreground" />
          )}
          <input
            type="text"
            placeholder="Search by document name, description or client…"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full bg-background border rounded-md pl-9 pr-4 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-brand-cyan"
          />
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground font-medium">
            <Filter className="size-3.5" /> Category:
          </div>
          <SelectField
            value={category || "all"}
            onChange={(e) => {
              const next = searchQuery.trim().slice(0, 100);
              sent.current = next;
              apply(next, e.target.value === "all" ? "" : e.target.value);
            }}
            className="text-xs font-semibold min-w-[160px]"
          >
            <option value="all">All Categories</option>
            <option value="arn">ARN</option>
            <option value="euin">EUIN</option>
            <option value="nism">NISM Certificate</option>
            <option value="kyd">KYC Document</option>
            <option value="amc_empanelment">AMC Empanelment</option>
            <option value="ddq">DDQ Document</option>
            <option value="sop">SOP</option>
            <option value="marketing_approval">Marketing Approval</option>
            <option value="complaint">Complaint Document</option>
            <option value="audit_report">Audit Report</option>
            <option value="ria_compliance">RIA Compliance</option>
            <option value="other">Other</option>
          </SelectField>
        </div>
      </div>

      {/* Client-grouped accordion */}
      {folders.length === 0 ? (
        <div className="border rounded-lg bg-card p-12 text-center text-sm text-muted-foreground">
          <FolderArchive className="size-8 mx-auto text-muted-foreground/50" />
          <div className="mt-2">{filtered ? "No client folder or document matches." : "No documents found."}</div>
        </div>
      ) : (
        <div className={`space-y-3 ${filtering ? "opacity-60" : ""}`}>
          {folders.map((g) => {
            // A search that leaves only a few folders opens them.
            const isOpen = open[g.key] ?? (filtered && totalFolders <= 3);
            const isFirm = g.clientId === null;
            return (
              <div key={g.key} className="border rounded-lg bg-card overflow-hidden">
                {/* Header row */}
                <div className="flex items-center gap-3 px-3 sm:px-4 py-3">
                  <button
                    type="button"
                    onClick={() => setOpen((o) => ({ ...o, [g.key]: !isOpen }))}
                    className="flex items-center gap-3 flex-1 min-w-0 text-left"
                    aria-expanded={isOpen}
                  >
                    <ChevronRight className={`size-4 text-muted-foreground shrink-0 transition-transform duration-300 ${isOpen ? "rotate-90" : ""}`} />
                    {isFirm ? (
                      <div className="size-9 rounded-lg grid place-items-center shrink-0 bg-secondary">
                        <Building2 className="size-4 text-muted-foreground" />
                      </div>
                    ) : (
                      <Avatar src={g.clientAvatar} name={g.clientName} size={36} />
                    )}
                    <div className="min-w-0">
                      <div className="font-semibold text-sm truncate">{g.clientName}</div>
                      <div className="text-xs text-muted-foreground truncate">
                        {isFirm ? "Firm-level & unassigned documents" : [g.clientEmail, g.clientPhone].filter(Boolean).join(" · ") || "Client"}
                      </div>
                    </div>
                  </button>

                  {/* Counts + alerts */}
                  <div className="hidden sm:flex items-center gap-2 text-xs">
                    <span className="text-muted-foreground">{g.count} doc{g.count !== 1 ? "s" : ""}</span>
                    {g.expired > 0 && (
                      <span className="inline-flex items-center gap-1 text-rose-600 font-semibold"><AlertTriangle className="size-3" />{g.expired}</span>
                    )}
                    {g.expiring > 0 && (
                      <span className="inline-flex items-center gap-1 text-amber-600 font-semibold"><AlertTriangle className="size-3" />{g.expiring}</span>
                    )}
                  </div>

                  {/* Bulk actions */}
                  <div className="flex items-center gap-1.5 print:hidden">
                    <button
                      type="button"
                      onClick={() => downloadAll(g)}
                      title="Download all as ZIP"
                      className="size-8 rounded-lg hover:bg-secondary/40 border border-border/40 grid place-items-center text-muted-foreground hover:text-brand-cyan transition-colors"
                    >
                      <DownloadCloud className="size-4" />
                    </button>
                    <button
                      type="button"
                      onClick={() => setPendingDelete({ kind: "group", group: g })}
                      disabled={deletingGroup === g.key}
                      title={filtered ? "Delete the matching documents in this folder" : "Delete all documents in this folder"}
                      className="size-8 rounded-lg hover:bg-rose-50 border border-border/40 grid place-items-center text-muted-foreground hover:text-rose-600 hover:border-rose-200 transition-colors disabled:opacity-50"
                    >
                      {deletingGroup === g.key ? <Loader2 className="size-4 animate-spin" /> : <Trash2 className="size-4" />}
                    </button>
                    {!isFirm && g.clientId && (
                      <a
                        href={`/dashboard/investors/${g.clientId}#documents`}
                        target="_blank"
                        rel="noopener noreferrer"
                        title="Open this client's Documents & attachments"
                        className="size-8 rounded-lg hover:bg-secondary/40 border border-border/40 grid place-items-center text-muted-foreground hover:text-brand-cyan transition-colors"
                      >
                        <ExternalLink className="size-4" />
                      </a>
                    )}
                  </div>
                </div>

                {/* Expandable body — smooth height via grid-rows */}
                <div className={`grid transition-all duration-300 ease-in-out ${isOpen ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0"}`}>
                  <div className="overflow-hidden">
                    {isOpen && (
                      <FolderDocs
                        key={`${g.key}|${q}|${category}`}
                        folder={g.key}
                        q={q}
                        category={category}
                        stamp={`${version}:${g.count}:${g.ids[0] ?? ""}`}
                        renderDoc={renderDoc}
                      />
                    )}
                  </div>
                </div>
              </div>
            );
          })}
          <div className="print:hidden">
            <Pager page={page} totalPages={Math.ceil(totalFolders / pageSize)} total={totalFolders} pageSize={pageSize} />
          </div>
        </div>
      )}

      <DocumentViewerModal doc={viewer} onClose={() => setViewer(null)} />

      <ConfirmDialog
        open={!!pendingDelete}
        title={pendingDelete?.kind === "group" ? "Delete all documents?" : "Delete document?"}
        message={
          pendingDelete?.kind === "group"
            ? `Permanently delete ${filtered ? "the" : "all"} ${pendingDelete.group.count} document(s)${filtered ? " matching your search" : ""} for "${pendingDelete.group.clientName}"? This can't be undone.`
            : pendingDelete?.kind === "single"
              ? `Permanently delete "${pendingDelete.name}" from storage and the database? This can't be undone.`
              : ""
        }
        confirmLabel="Delete"
        tone="danger"
        onConfirm={() => {
          if (!pendingDelete) return;
          if (pendingDelete.kind === "group") deleteAll(pendingDelete.group);
          else handleDelete(pendingDelete.id);
          setPendingDelete(null);
        }}
        onCancel={() => setPendingDelete(null)}
      />
    </div>
  );
}

/** One open folder's documents, read a page at a time. */
function FolderDocs({
  folder,
  q,
  category,
  stamp,
  renderDoc,
}: {
  folder: string;
  q: string;
  category: string;
  /** Changes when the folder's documents do, so the page is read again. */
  stamp: string;
  renderDoc: (d: VaultDoc) => ReactNode;
}) {
  const [page, setPage] = useState(1);
  const [data, setData] = useState<{ docs: VaultDoc[]; total: number; page: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const ctl = new AbortController();
    const p = new URLSearchParams({ folder, page: String(page) });
    if (q) p.set("q", q);
    if (category) p.set("category", category);
    setLoading(true);
    setError(null);
    (async () => {
      try {
        const res = await fetch(`/api/compliance/documents/folder?${p}`, { cache: "no-store", signal: ctl.signal });
        const j = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(j.error ?? `Couldn't load the documents (${res.status})`);
        setData(j);
        // The last document of the last page went: the server answers with the page before it.
        if (j.page !== page) setPage(j.page);
        setLoading(false);
      } catch (e) {
        if (ctl.signal.aborted) return;
        setError(e instanceof Error ? e.message : "Network error");
        setLoading(false);
      }
    })();
    return () => ctl.abort();
  }, [folder, q, category, page, stamp, attempt]);

  const pages = data ? Math.max(1, Math.ceil(data.total / DOCS_PER_PAGE)) : 1;

  return (
    <div className="border-t">
      {error ? (
        <div className="px-4 py-3 text-sm text-destructive">
          {error}{" "}
          <button type="button" onClick={() => setAttempt((a) => a + 1)} className="font-medium underline">Try again</button>
        </div>
      ) : !data ? (
        <div className="flex items-center gap-2 px-4 py-3 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" /> Loading documents…
        </div>
      ) : (
        <>
          <div className={`divide-y divide-border/60 ${loading ? "opacity-60" : ""}`}>{data.docs.map(renderDoc)}</div>
          {pages > 1 && (
            <div className="flex items-center justify-between gap-3 border-t px-4 py-2 text-xs print:hidden">
              <span className="text-muted-foreground">
                Documents {(data.page - 1) * DOCS_PER_PAGE + 1}–{Math.min(data.total, data.page * DOCS_PER_PAGE)} of {data.total.toLocaleString("en-IN")}
              </span>
              <div className="flex items-center gap-1">
                <button type="button" onClick={() => setPage(data.page - 1)} disabled={loading || data.page <= 1} className="inline-flex items-center gap-1 rounded-md border px-2 py-1 hover:bg-accent disabled:cursor-not-allowed disabled:opacity-40">
                  <ChevronLeft className="size-3.5" /> Prev
                </button>
                <span className="px-1 tabular-nums text-muted-foreground">Page {data.page} of {pages}</span>
                <button type="button" onClick={() => setPage(data.page + 1)} disabled={loading || data.page >= pages} className="inline-flex items-center gap-1 rounded-md border px-2 py-1 hover:bg-accent disabled:cursor-not-allowed disabled:opacity-40">
                  Next <ChevronRight className="size-3.5" />
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
