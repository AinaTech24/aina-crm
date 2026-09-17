"use client";

/**
 * Data Gaps tile — shows up on the Owner Cockpit. Calls
 * /api/reports/data-hygiene and renders a chip per missing field with
 * a count + click-through to the filtered Clients list. Solves the
 * "PAN / mobile / email / DOB / nominee missing report" line items
 * from the MFD ops framework in one card.
 *
 * Renders nothing if there are no gaps (clean tenant = clean dashboard).
 *
 * Fetches client-side so the cockpit page render isn't blocked by an
 * 8-aggregate query against a 100K-row table. Shows a small skeleton
 * while loading; surfaces total + each gap as a chip.
 *
 * Updated: Adds a direct WhatsApp/Email dispatch option to automate reminders.
 */

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  AlertCircle,
  ChevronRight,
  ShieldAlert,
  Database,
  ArrowUpRight,
  Send,
  Check,
  Loader2,
  X
} from "lucide-react";

type Gap = {
  key: string;
  label: string;
  count: number;
  href: string;
  severity: "high" | "medium" | "low";
  /** Where the gap actually sits, so a lead can act without re-filtering. */
  branches?: Array<{ branch: string; count: number }>;
};

const SEV_RANK: Record<Gap["severity"], number> = { high: 0, medium: 1, low: 2 };
const SEV_CHIP: Record<Gap["severity"], string> = {
  high: "bg-destructive/10 text-destructive",
  medium: "bg-warning/10 text-warning-foreground",
  low: "bg-secondary text-muted-foreground",
};
const SEV_LABEL: Record<Gap["severity"], string> = {
  high: "HIGH",
  medium: "MED",
  low: "LOW",
};

export function DataGapsTile() {
  const [data, setData] = useState<{
    total: number;
    gaps: Gap[];
    completeness?: Array<{ branch: string; clients: number; pct: number }>;
  } | null>(null);
  const [err, setErr] = useState<string | null>(null);

  // Quick Action Modal states

  useEffect(() => {
    let cancelled = false;
    fetch("/api/reports/data-hygiene")
      .then(async (r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((j) => {
        if (!cancelled) setData(j);
      })
      .catch((e) => {
        if (!cancelled) setErr(e.message ?? "Failed to load");
      });
    return () => {
      cancelled = true;
    };
  }, []);



  if (err) {
    return (
      <div className="card-surface p-4 border-rose-200 bg-rose-50/40">
        <div className="text-xs text-rose-700 flex items-center gap-1.5">
          <AlertCircle className="size-3.5" /> Couldn't load data hygiene scan: {err}
        </div>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="card-surface p-4">
        <div className="text-xs text-muted-foreground animate-pulse">
          Scanning client master for missing fields…
        </div>
      </div>
    );
  }

  // Clean tenant — nothing to show.
  if (data.gaps.length === 0) {
    return (
      <div className="card-surface p-4 border-emerald-200 bg-emerald-50/30">
        <div className="flex items-center gap-2 text-sm">
          <Database className="size-4 text-emerald-700" />
          <span className="font-medium text-emerald-900">All client records are complete</span>
          <span className="text-xs text-emerald-700/80 ml-1">
            · {data.total.toLocaleString("en-IN")} clients scanned
          </span>
        </div>
      </div>
    );
  }

  const totalGaps = data.gaps.reduce((s, g) => s + g.count, 0);
  // One ranked worklist instead of two chip groups: worst first, then biggest.
  // A row with nothing missing is not work, so it is dropped.
  const ranked = [...data.gaps]
    .filter((g) => g.count > 0)
    .sort((a, b) => SEV_RANK[a.severity] - SEV_RANK[b.severity] || b.count - a.count);

  return (
    <div className="card-surface p-4 space-y-3 relative overflow-hidden">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-2">
          <div className="size-9 rounded-lg bg-amber-50 border border-amber-200 grid place-items-center flex-shrink-0">
            <ShieldAlert className="size-4 text-amber-700" />
          </div>
          <div>
            <div className="text-sm font-semibold">Action centre — data hygiene</div>
            <div className="text-2xs text-muted-foreground mt-0.5">
              {totalGaps.toLocaleString("en-IN")} fixes across {data.total.toLocaleString("en-IN")} clients —
              worst first. Fix opens the client list filtered to exactly those records.
            </div>
          </div>
        </div>
        <Link
          href="/dashboard/investors"
          className="text-2xs text-muted-foreground hover:text-foreground inline-flex items-center gap-0.5"
        >
          All clients <ArrowUpRight className="size-3" />
        </Link>
      </div>

      {ranked.length === 0 ? (
        <div className="text-sm text-success">Every client record is complete.</div>
      ) : (
        <div className="divide-y divide-border -mx-1">
          {ranked.map((g) => (
            <div key={g.key} className="flex items-center gap-3 px-1 py-2">
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium truncate">{g.label}</div>
                {g.branches && g.branches.length > 0 && (
                  <div className="text-2xs text-muted-foreground truncate">
                    {g.branches
                      .slice(0, 3)
                      .map((b) => `${b.branch} ${b.count}`)
                      .join(" · ")}
                    {g.branches.length > 3 ? ` · +${g.branches.length - 3}` : ""}
                  </div>
                )}
              </div>
              <span className="tabular-nums text-sm font-semibold shrink-0">
                {g.count.toLocaleString("en-IN")}
              </span>
              <span
                className={`chip text-2xs font-bold shrink-0 ${SEV_CHIP[g.severity]}`}
                title={
                  g.severity === "high"
                    ? "Compliance-impacting — fix these first"
                    : g.severity === "medium"
                      ? "Affects how you can reach or serve the client"
                      : "Nice to have"
                }
              >
                {SEV_LABEL[g.severity]}
              </span>
              {/* The API has always returned an href filtered to exactly these
                  records; it was only ever used to make the chip clickable.
                  As a button it is the difference between reporting a problem
                  and handing someone the fix. Secondary style on purpose —
                  red is the firm's one accent and is already spent on the
                  severity chip beside it. */}
              <Link href={g.href} className="btn-secondary !px-2.5 !py-1 !text-xs shrink-0">
                Fix <ArrowUpRight className="size-3" />
              </Link>
            </div>
          ))}
        </div>
      )}

      {/* Data completeness — one bar per branch, so "where is the book weakest"
          is answerable at a glance. Weighted across the five fields a firm is
          judged on rather than every column, and the weighting is stated so the
          number is not a black box. */}
      {data.completeness && data.completeness.length > 0 && (
        <div className="pt-3 border-t border-border space-y-2">
          <div className="text-2xs font-semibold uppercase tracking-wide text-muted-foreground">
            Data completeness
          </div>
          {data.completeness.map((c) => (
            <div key={c.branch} className="space-y-1">
              <div className="flex items-baseline justify-between gap-2 text-2xs">
                <span className="font-medium truncate">{c.branch}</span>
                <span className="text-muted-foreground tabular-nums whitespace-nowrap">
                  {c.clients.toLocaleString("en-IN")} clients · {c.pct}%
                </span>
              </div>
              <div className="h-1.5 rounded-full bg-secondary overflow-hidden">
                <div
                  className={`h-full rounded-full ${
                    c.pct >= 90 ? "bg-success" : c.pct >= 70 ? "bg-warning" : "bg-destructive"
                  }`}
                  style={{ width: `${Math.max(2, c.pct)}%` }}
                />
              </div>
            </div>
          ))}
          <p className="text-2xs text-muted-foreground">
            Weighted across KYC · nominee · risk profile · DOB · PAN.
          </p>
        </div>
      )}

      {/* Bulk Notification Confirm Modal */}
      {/* A "Send bulk reminders" modal stood here. It called nothing — a
          setTimeout, then "Reminders Queued Successfully! … have been sent to
          the outbox for N clients." No fetch, no workflow, no outbox row. A
          firm would believe it had chased 22 clients for their PAN and stop
          following up. Removed rather than left to mislead; wire it to the
          real campaign recipe before offering the button again.
          Each row's Fix link goes to those exact clients in the meantime. */}
    </div>
  );
}

