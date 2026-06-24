"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Activity, Search } from "lucide-react";
import { SelectField } from "@/components/ui/SelectField";
import { formatDate, formatRelative } from "@/lib/utils";

const STATUS_COLORS: Record<string, string> = {
  trial: "bg-blue-50 text-blue-700",
  active: "bg-emerald-50 text-emerald-700",
  past_due: "bg-amber-50 text-amber-700",
  suspended: "bg-rose-50 text-rose-700",
  expired: "bg-rose-50 text-rose-700",
  cancelled: "bg-gray-50 text-gray-700",
};

export type SubscriptionRow = {
  id: string;
  tenant_id: string;
  package_key: string | null;
  status: string;
  billing_cycle: string | null;
  license_start_at: string | Date | null;
  license_end_at: string | Date | null;
  next_renewal_at: string | Date | null;
  trial_ends_at: string | Date | null;
  suspended_reason: string | null;
  legal_name: string | null;
  arn: string | null;
};

type SortKey = "name_asc" | "name_desc" | "newest" | "oldest";

const SORT_OPTIONS = [
  { value: "newest", label: "Newest first" },
  { value: "oldest", label: "Oldest first" },
  { value: "name_asc", label: "Name A–Z" },
  { value: "name_desc", label: "Name Z–A" },
];

const STATUS_OPTIONS = [
  { value: "", label: "All statuses" },
  { value: "trial", label: "Trial" },
  { value: "active", label: "Active" },
  { value: "past_due", label: "Past due" },
  { value: "suspended", label: "Suspended" },
  { value: "expired", label: "Expired" },
  { value: "cancelled", label: "Cancelled" },
];

const PACKAGE_OPTIONS = [
  { value: "", label: "All packages" },
  { value: "starter", label: "Starter" },
  { value: "growth", label: "Growth" },
  { value: "professional", label: "Professional" },
  { value: "premium", label: "Premium" },
  { value: "custom", label: "Custom" },
];

const CYCLE_OPTIONS = [
  { value: "", label: "All cycles" },
  { value: "monthly", label: "Monthly" },
  { value: "yearly", label: "Yearly" },
];

function startMs(r: SubscriptionRow): number {
  const v = r.license_start_at;
  if (!v) return 0;
  const t = new Date(v).getTime();
  return Number.isNaN(t) ? 0 : t;
}

export function SubscriptionsTable({ rows }: { rows: SubscriptionRow[] }) {
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("");
  const [pkg, setPkg] = useState("");
  const [cycle, setCycle] = useState("");
  const [sort, setSort] = useState<SortKey>("newest");

  // Preserve the server's original order (updated_at DESC) for "newest"/"oldest"
  // by capturing the incoming index — license_start_at can be null/equal.
  const indexed = useMemo(
    () => rows.map((r, i) => ({ r, i })),
    [rows]
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const out = indexed.filter(({ r }) => {
      if (status && r.status !== status) return false;
      if (pkg && (r.package_key ?? "") !== pkg) return false;
      if (cycle && (r.billing_cycle ?? "") !== cycle) return false;
      if (q) {
        const hay = `${r.legal_name ?? ""} ${r.arn ?? ""} ${r.package_key ?? ""}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });

    out.sort((a, b) => {
      switch (sort) {
        case "name_asc":
          return (a.r.legal_name ?? "").localeCompare(b.r.legal_name ?? "");
        case "name_desc":
          return (b.r.legal_name ?? "").localeCompare(a.r.legal_name ?? "");
        case "oldest": {
          const sa = startMs(a.r);
          const sb = startMs(b.r);
          if (sa !== sb) return sa - sb;
          return b.i - a.i; // fall back to original (updated_at DESC) reversed
        }
        case "newest":
        default: {
          const sa = startMs(a.r);
          const sb = startMs(b.r);
          if (sa !== sb) return sb - sa;
          return a.i - b.i; // preserve server order
        }
      }
    });

    return out.map(({ r }) => r);
  }, [indexed, query, status, pkg, cycle, sort]);

  return (
    <div className="border rounded-lg bg-card">
      <div className="border-b px-4 py-2.5 flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search MFD name, ARN, or package…"
            className="w-full text-sm border rounded-md pl-8 pr-2 py-1.5 bg-background"
          />
        </div>
        <SelectField
          value={status}
          onChange={(e) => setStatus(e.target.value)}
          options={STATUS_OPTIONS}
          size="sm"
          aria-label="Filter by status"
          className="w-40"
        />
        <SelectField
          value={pkg}
          onChange={(e) => setPkg(e.target.value)}
          options={PACKAGE_OPTIONS}
          size="sm"
          aria-label="Filter by package"
          className="w-40"
        />
        <SelectField
          value={cycle}
          onChange={(e) => setCycle(e.target.value)}
          options={CYCLE_OPTIONS}
          size="sm"
          aria-label="Filter by billing cycle"
          className="w-36"
        />
        <SelectField
          value={sort}
          onChange={(e) => setSort(e.target.value as SortKey)}
          options={SORT_OPTIONS}
          size="sm"
          aria-label="Sort"
          className="w-40"
        />
      </div>

      <div className="px-4 py-2 text-xs text-muted-foreground border-b">
        Showing {filtered.length} of {rows.length} subscription{rows.length === 1 ? "" : "s"}
      </div>

      {filtered.length === 0 ? (
        <div className="p-12 text-center text-sm text-muted-foreground">
          <Activity className="size-8 mx-auto text-muted-foreground/50" />
          <div className="mt-2">No subscriptions match the filter.</div>
        </div>
      ) : (
        <div className="table-scroll" style={{ ["--table-scroll-h" as any]: "calc(100vh - 22rem)" }}>
          <table className="w-full text-sm">
            <thead className="text-xs text-muted-foreground border-b sticky top-0 bg-card z-10">
              <tr>
              <th className="text-left px-4 py-2 font-medium">MFD</th>
              <th className="text-left py-2 font-medium">Package</th>
              <th className="text-left py-2 font-medium">Status</th>
              <th className="text-left py-2 font-medium">Cycle</th>
              <th className="text-left py-2 font-medium">Started</th>
              <th className="text-left py-2 font-medium pl-3">Renews</th>
              <th className="px-4 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((r) => (
              <tr key={r.id} className="border-b last:border-0 hover:bg-accent/40">
                <td className="px-4 py-3">
                  <Link href={`/super-admin/tenants/${r.tenant_id}`} className="font-medium hover:underline">
                    {r.legal_name}
                  </Link>
                  <div className="text-xs text-muted-foreground font-mono">{r.arn}</div>
                </td>
                <td className="py-3 text-xs uppercase text-muted-foreground">{r.package_key}</td>
                <td className="py-3">
                  <span className={`text-xs px-2 py-0.5 rounded-full ${STATUS_COLORS[r.status] ?? ""}`}>
                    {r.status}
                  </span>
                  {r.suspended_reason && (
                    <div className="text-xs text-muted-foreground mt-0.5 line-clamp-1">{r.suspended_reason}</div>
                  )}
                </td>
                <td className="py-3 text-xs">{r.billing_cycle ?? "—"}</td>
                <td className="py-3 text-xs text-muted-foreground">
                  {r.license_start_at ? formatDate(r.license_start_at) : "—"}
                </td>
                <td className="py-3 pl-3 text-xs text-muted-foreground">
                  {r.next_renewal_at
                    ? formatRelative(r.next_renewal_at)
                    : r.trial_ends_at
                    ? `trial ends ${formatRelative(r.trial_ends_at)}`
                    : "—"}
                </td>
                <td className="px-4 py-3 text-right">
                  <Link
                    href={`/super-admin/tenants/${r.tenant_id}`}
                    className="text-xs text-muted-foreground hover:underline"
                  >
                    Manage →
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
