"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { BarChart3, Plus, Star, Search, Trash2, Pencil, Loader2, Table2, Grid3x3, ChevronLeft } from "lucide-react";

type Report = {
  id: string;
  name: string;
  description: string | null;
  subject: string;
  reportType: "detailed" | "matrix";
  sharedScope: string;
  starred: boolean;
  isMine: boolean;
  updatedAt: string;
};

const SUBJECT_LABEL: Record<string, string> = {
  investor: "Clients",
  lead: "Leads",
  task: "Tasks",
  user: "Users",
  transaction: "MF Transactions",
  sip: "SIPs",
  insurance: "Insurance",
  goal: "Goals",
  service_request: "Service Requests",
  claim: "Insurance Claims",
};

export default function CustomReportsPage() {
  const [reports, setReports] = useState<Report[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");

  async function load() {
    setLoading(true);
    try {
      const r = await fetch("/api/reports/saved");
      const j = await r.json();
      setReports(j.reports ?? []);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    load();
  }, []);

  async function toggleStar(id: string, starred: boolean) {
    setReports((rs) => rs.map((r) => (r.id === id ? { ...r, starred: !starred } : r)));
    await fetch(`/api/reports/saved/${id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ star: !starred }),
    });
  }
  async function del(id: string) {
    if (!confirm("Delete this report? This can't be undone.")) return;
    await fetch(`/api/reports/saved/${id}`, { method: "DELETE" });
    load();
  }

  const filtered = reports
    .filter((r) => r.name.toLowerCase().includes(q.toLowerCase()) || (r.description ?? "").toLowerCase().includes(q.toLowerCase()))
    .sort((a, b) => (b.starred ? 1 : 0) - (a.starred ? 1 : 0));

  return (
    <div className="space-y-4 max-w-5xl">
      <Link href="/dashboard/reports" className="text-sm text-muted-foreground hover:text-foreground flex items-center gap-1">
        <ChevronLeft className="size-4" /> Back to reports
      </Link>

      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="page-title">
            <BarChart3 className="size-6 text-brand-cyan" /> Custom Reports
          </h1>
          <p className="page-subtitle">Build, save and share your own reports across clients, leads and tasks.</p>
        </div>
        <Link href="/dashboard/reports/custom/new" className="btn-primary">
          <Plus className="size-4" /> New report
        </Link>
      </div>

      <div className="relative max-w-sm">
        <Search className="size-4 text-muted-foreground absolute left-3 top-1/2 -translate-y-1/2" />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search reports…"
          className="input-base pl-9"
        />
      </div>

      <div className="card-surface overflow-hidden">
        {loading ? (
          <div className="p-12 grid place-items-center text-muted-foreground">
            <Loader2 className="size-6 animate-spin" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="p-12 text-center text-sm text-muted-foreground">
            <BarChart3 className="size-8 mx-auto text-muted-foreground/40" />
            <div className="mt-2 font-medium">{reports.length === 0 ? "No custom reports yet." : "No reports match your search."}</div>
            <Link href="/dashboard/reports/custom/new" className="text-brand-cyan-deep hover:underline text-xs mt-1 inline-block">
              + Build your first report
            </Link>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="text-xs text-muted-foreground border-b">
              <tr>
                <th className="w-8 px-3 py-2"></th>
                <th className="text-left px-2 py-2 font-medium">Name</th>
                <th className="text-left py-2 font-medium">Module</th>
                <th className="text-left py-2 font-medium">Type</th>
                <th className="text-left py-2 font-medium">Sharing</th>
                <th className="text-right py-2 px-3 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => (
                <tr key={r.id} className="border-b last:border-0 hover:bg-secondary/40 transition-colors">
                  <td className="px-3 py-2.5">
                    <button onClick={() => toggleStar(r.id, r.starred)} aria-label="Star" className="text-muted-foreground hover:text-amber-500">
                      <Star className={`size-4 ${r.starred ? "fill-amber-400 text-amber-400" : ""}`} />
                    </button>
                  </td>
                  <td className="px-2 py-2.5">
                    <Link href={`/dashboard/reports/custom/${r.id}`} className="font-medium hover:underline">
                      {r.name}
                    </Link>
                    {r.description && <div className="text-xs text-muted-foreground line-clamp-1">{r.description}</div>}
                  </td>
                  <td className="py-2.5 text-xs">{SUBJECT_LABEL[r.subject] ?? r.subject}</td>
                  <td className="py-2.5">
                    <span className="chip bg-secondary/70 text-foreground/80 inline-flex items-center gap-1">
                      {r.reportType === "matrix" ? <Grid3x3 className="size-3" /> : <Table2 className="size-3" />}
                      {r.reportType === "matrix" ? "Matrix" : "Detailed"}
                    </span>
                  </td>
                  <td className="py-2.5 text-xs capitalize text-muted-foreground">{r.sharedScope}</td>
                  <td className="py-2.5 px-3 text-right whitespace-nowrap">
                    {r.isMine && (
                      <Link href={`/dashboard/reports/custom/new?edit=${r.id}`} className="btn-icon inline-grid" aria-label="Edit">
                        <Pencil className="size-3.5" />
                      </Link>
                    )}
                    {r.isMine && (
                      <button onClick={() => del(r.id)} className="btn-icon inline-grid hover:text-rose-600" aria-label="Delete">
                        <Trash2 className="size-3.5" />
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
