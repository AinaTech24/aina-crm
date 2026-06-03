"use client";

import { useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import { 
  FolderArchive, 
  AlertTriangle, 
  Download, 
  Trash2, 
  Loader2, 
  Search, 
  Filter 
} from "lucide-react";
import { formatDate, formatRelative } from "@/lib/utils";

type DocRow = {
  id: string;
  name: string;
  category: string;
  description: string | null;
  storageKey: string;
  mimeType: string | null;
  sizeBytes: string | null;
  issuedOn: string | Date | null;
  expiresOn: string | Date | null;
  createdAt: string | Date | null;
};

const CATEGORY_COLORS: Record<string, string> = {
  arn: "bg-purple-50 text-purple-700 border-purple-200 dark:bg-purple-950/20 dark:text-purple-400 dark:border-purple-900/50",
  euin: "bg-purple-50 text-purple-700 border-purple-200 dark:bg-purple-950/20 dark:text-purple-400 dark:border-purple-900/50",
  nism: "bg-purple-50 text-purple-700 border-purple-200 dark:bg-purple-950/20 dark:text-purple-400 dark:border-purple-900/50",
  kyd: "bg-indigo-50 text-indigo-700 border-indigo-200 dark:bg-indigo-950/20 dark:text-indigo-400 dark:border-indigo-900/50",
  amc_empanelment: "bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-950/20 dark:text-blue-400 dark:border-blue-900/50",
  ddq: "bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/20 dark:text-emerald-400 dark:border-emerald-900/50",
  sop: "bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/20 dark:text-amber-400 dark:border-amber-900/50",
  marketing_approval: "bg-pink-50 text-pink-700 border-pink-200 dark:bg-pink-950/20 dark:text-pink-400 dark:border-pink-900/50",
  complaint: "bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-950/20 dark:text-rose-400 dark:border-rose-900/50",
  audit_report: "bg-orange-50 text-orange-700 border-orange-200 dark:bg-orange-950/20 dark:text-orange-400 dark:border-orange-900/50",
  ria_compliance: "bg-teal-50 text-teal-700 border-teal-200 dark:bg-teal-950/20 dark:text-teal-400 dark:border-teal-900/50",
  other: "bg-gray-50 text-gray-700 border-gray-200 dark:bg-slate-900 dark:text-slate-400 dark:border-slate-800",
};

export function DocumentsFeed({
  initialRows,
  stats,
}: {
  initialRows: DocRow[];
  stats: { total: number; expiringSoon: number; expired: number };
}) {
  const router = useRouter();
  const [rows, setRows] = useState<DocRow[]>(initialRows);
  const [searchQuery, setSearchQuery] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [deletingId, setDeletingId] = useState<string | null>(null);

  async function handleDelete(id: string) {
    if (!confirm("Are you sure you want to permanently delete this document from S3 and your database?")) return;
    setDeletingId(id);
    try {
      const res = await fetch(`/api/compliance/documents?id=${encodeURIComponent(id)}`, {
        method: "DELETE",
      });
      if (res.ok) {
        setRows((prev) => prev.filter((r) => r.id !== id));
        router.refresh();
      } else {
        alert("Failed to delete document.");
      }
    } catch (err) {
      console.error(err);
      alert("Error deleting document.");
    } finally {
      setDeletingId(null);
    }
  }

  const filteredRows = useMemo(() => {
    return rows.filter((r) => {
      const nameMatch = r.name.toLowerCase().includes(searchQuery.toLowerCase());
      const descMatch = r.description ? r.description.toLowerCase().includes(searchQuery.toLowerCase()) : false;
      const categoryMatch = categoryFilter === "all" || r.category === categoryFilter;
      return (nameMatch || descMatch) && categoryMatch;
    });
  }, [rows, searchQuery, categoryFilter]);

  return (
    <div className="space-y-6">
      {/* Stats cards */}
      <div className="grid grid-cols-3 gap-4">
        <div className="border rounded-lg p-4 bg-card">
          <div className="text-xs text-muted-foreground">Total documents</div>
          <div className="text-2xl font-bold mt-1">{rows.length}</div>
        </div>
        <div className="border rounded-lg p-4 bg-card">
          <div className="text-xs text-muted-foreground">Expiring (30d)</div>
          <div className={`text-2xl font-bold mt-1 ${stats.expiringSoon > 0 ? "text-amber-600" : "text-foreground"}`}>
            {stats.expiringSoon}
          </div>
        </div>
        <div className="border rounded-lg p-4 bg-card">
          <div className="text-xs text-muted-foreground">Expired</div>
          <div className={`text-2xl font-bold mt-1 ${stats.expired > 0 ? "text-rose-600 font-bold" : "text-foreground"}`}>
            {stats.expired}
          </div>
        </div>
      </div>

      {/* Filter Toolbar */}
      <div className="flex items-center justify-between gap-4 flex-wrap bg-secondary/10 p-3 rounded-lg border border-border/40 print:hidden">
        <div className="flex-1 min-w-[240px] relative">
          <Search className="absolute left-3 top-2.5 size-4 text-muted-foreground" />
          <input
            type="text"
            placeholder="Search documents by name or description..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full bg-background border rounded-md pl-9 pr-4 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-brand-cyan"
          />
        </div>

        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground font-medium">
            <Filter className="size-3.5" /> Category:
          </div>

          <select
            value={categoryFilter}
            onChange={(e) => setCategoryFilter(e.target.value)}
            className="bg-background border rounded-md px-2.5 py-1.5 text-xs font-semibold focus:outline-none"
          >
            <option value="all">All Categories</option>
            <option value="arn">ARN</option>
            <option value="euin">EUIN</option>
            <option value="nism">NISM Certificate</option>
            <option value="kyd">KYD Document</option>
            <option value="amc_empanelment">AMC Empanelment</option>
            <option value="ddq">DDQ Document</option>
            <option value="sop">SOP</option>
            <option value="marketing_approval">Marketing Approval</option>
            <option value="complaint">Complaint Document</option>
            <option value="audit_report">Audit Report</option>
            <option value="ria_compliance">RIA Compliance</option>
            <option value="other">Other</option>
          </select>
        </div>
      </div>

      {/* Table view */}
      <div className="border rounded-lg bg-card">
        {filteredRows.length === 0 ? (
          <div className="p-12 text-center text-sm text-muted-foreground">
            <FolderArchive className="size-8 mx-auto text-muted-foreground/50" />
            <div className="mt-2">No documents found.</div>
            <p className="mt-2 text-xs max-w-md mx-auto">
              Upload compliance files such as NISM certificates, registrations, and empanelments to manage them here.
            </p>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="text-xs text-muted-foreground border-b bg-secondary/20">
              <tr>
                <th className="text-left px-4 py-3 font-medium">Name</th>
                <th className="text-left py-3 font-medium">Category</th>
                <th className="text-left py-3 font-medium">Issued</th>
                <th className="text-left py-3 font-medium">Expires</th>
                <th className="text-left py-3 font-medium">Uploaded</th>
                <th className="text-right pr-4 py-3 font-medium print:hidden">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredRows.map((d) => {
                const exp = d.expiresOn ? new Date(d.expiresOn) : null;
                const expired = exp && exp.getTime() < Date.now();
                const expiringSoon = exp && !expired && exp.getTime() - Date.now() < 30 * 24 * 60 * 60 * 1000;
                return (
                  <tr key={d.id} className="border-b last:border-0 hover:bg-accent/40 align-middle">
                    <td className="px-4 py-3.5">
                      <div className="font-semibold text-sm">{d.name}</div>
                      {d.description && <div className="text-xs text-muted-foreground line-clamp-1 mt-0.5">{d.description}</div>}
                    </td>
                    <td className="py-3.5">
                      <span className={`text-[10px] font-bold border px-2 py-0.5 rounded-full ${CATEGORY_COLORS[d.category] ?? CATEGORY_COLORS.other}`}>
                        {d.category.toUpperCase().replace("_", " ")}
                      </span>
                    </td>
                    <td className="py-3.5 text-xs text-muted-foreground">{d.issuedOn ? formatDate(d.issuedOn) : "—"}</td>
                    <td className="py-3.5 text-xs">
                      {exp ? (
                        <span className={expired ? "text-rose-600 font-semibold inline-flex items-center gap-1" : expiringSoon ? "text-amber-600 font-semibold inline-flex items-center gap-1" : ""}>
                          {(expired || expiringSoon) && <AlertTriangle className="size-3.5" />}
                          {formatDate(exp)}
                        </span>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className="py-3.5 text-xs text-muted-foreground">{formatRelative(d.createdAt)}</td>
                    <td className="py-3.5 pr-4 text-right print:hidden">
                      <div className="inline-flex items-center gap-2">
                        {deletingId === d.id && <Loader2 className="size-4 animate-spin text-muted-foreground" />}
                        
                        <a
                          href={`/api/compliance/documents/download?id=${encodeURIComponent(d.id)}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="size-8 rounded-lg hover:bg-secondary/40 border border-border/40 grid place-items-center text-muted-foreground hover:text-brand-cyan transition-colors"
                          title="Download document from S3"
                        >
                          <Download className="size-4" />
                        </a>

                        <button
                          onClick={() => handleDelete(d.id)}
                          disabled={deletingId != null}
                          className="size-8 rounded-lg hover:bg-rose-50 border border-border/40 grid place-items-center text-muted-foreground hover:text-rose-600 hover:border-rose-200 transition-colors disabled:opacity-50"
                          title="Permanently delete document"
                        >
                          <Trash2 className="size-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
