/**
 * Merge Clients — the audit half of de-duplication.
 *
 * The suggestion side already exists at /dashboard/duplicates (PAN / phone /
 * email / name grouping, plus "mark as different" via ignored_duplicates). What
 * was missing is what happened AFTER: nothing listed completed merges, and
 * nothing separated the ones a person decided from the ones the system did
 * unattended during an RTA import. The second set is the one worth reviewing —
 * nobody looked at it when it happened.
 *
 * Three views, one query each:
 *   All merged      every merge, newest first
 *   By system       PAN-dedup during import — the unreviewed set
 *   Manual          a human chose these
 */

import Link from "next/link";
import { GitMerge, Search, ShieldCheck, Sparkles, Users } from "lucide-react";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { can } from "@/lib/auth/rbac";
import { loadMergeCounts, loadMergedClients, type MergeSource } from "@/lib/investors/merged";

export const dynamic = "force-dynamic";

const inr = (n: number) =>
  n >= 1e7 ? `₹${(n / 1e7).toFixed(2)} Cr` : n >= 1e5 ? `₹${(n / 1e5).toFixed(2)} L` : `₹${Math.round(n).toLocaleString("en-IN")}`;

const fmtDate = (v: string | null) => {
  if (!v) return "—";
  const d = new Date(v);
  return isNaN(d.getTime()) ? "—" : d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
};

const TABS: Array<{ key: MergeSource | "all"; label: string; icon: React.ElementType }> = [
  { key: "all", label: "All merged clients", icon: GitMerge },
  { key: "system", label: "Merged by system", icon: Sparkles },
  { key: "manual", label: "Merged manually", icon: ShieldCheck },
];

export default async function MergeClientsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const session = await requireSession();
  const sp = await searchParams;
  const tab = (["all", "system", "manual"].includes(sp.tab ?? "") ? sp.tab : "all") as MergeSource | "all";
  const q = (sp.q ?? "").trim();
  const canMerge = can(session.roles, "dashboard.view.owner", session.permissions);

  const { rows, counts } = await withTenant(
    session.tenantId,
    async (tx) => ({
      rows: await loadMergedClients(tx, { source: tab, q }),
      counts: await loadMergeCounts(tx),
    }),
    { userId: session.userId, branchId: session.branchId, roles: session.roles }
  );

  const countFor = (k: MergeSource | "all") => (k === "all" ? counts.all : k === "manual" ? counts.manual : counts.system);

  return (
    <div className="space-y-5 max-w-6xl">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <GitMerge className="size-6 text-brand-cyan" /> Merge Clients
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Every merge on record, and who made it. Merging is irreversible today — this is the trail.
          </p>
        </div>
        <Link href="/dashboard/duplicates" className="btn-secondary text-xs inline-flex items-center gap-1.5">
          <Users className="size-3.5" /> Duplicate suggestions
        </Link>
      </div>

      {/* Tabs + search. Both live in the URL so a filtered view is shareable and
          survives a refresh — the same reason the dashboard range chips do. */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="inline-flex rounded-lg border border-border bg-secondary/40 p-0.5 gap-0.5 text-xs">
          {TABS.map((t) => (
            <Link
              key={t.key}
              href={`/dashboard/merge-clients?tab=${t.key}${q ? `&q=${encodeURIComponent(q)}` : ""}`}
              className={`px-3 py-1.5 rounded-md font-medium inline-flex items-center gap-1.5 transition ${
                t.key === tab ? "bg-card shadow-sm" : "text-muted-foreground hover:bg-secondary"
              }`}
            >
              <t.icon className="size-3.5" /> {t.label}
              <span className="text-muted-foreground">({countFor(t.key)})</span>
            </Link>
          ))}
        </div>

        <form className="relative" action="/dashboard/merge-clients">
          <input type="hidden" name="tab" value={tab} />
          <Search className="size-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input
            name="q"
            defaultValue={q}
            placeholder="Name, PAN, email, mobile…"
            className="input-base h-8 text-xs pl-8 w-64"
          />
        </form>
      </div>

      {counts.system > 0 && tab !== "manual" && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-800">
          <strong>{counts.system}</strong> client{counts.system === 1 ? " was" : "s were"} merged automatically during an
          import — deduplicated on PAN with nobody reviewing the pair. Worth spot-checking that each really is the same
          person.
        </div>
      )}

      <div className="rounded-xl border border-border bg-card overflow-hidden">
        {rows.length === 0 ? (
          <div className="p-12 text-center text-sm text-muted-foreground">
            <GitMerge className="size-8 mx-auto text-muted-foreground/40" />
            <div className="mt-2 font-medium">
              {q ? "No merges match that search." : "No clients have been merged yet."}
            </div>
            <p className="mt-1 text-xs">
              Duplicates are suggested on{" "}
              <Link href="/dashboard/duplicates" className="text-brand-cyan hover:underline">
                the duplicates page
              </Link>
              .
            </p>
          </div>
        ) : (
          <div className="table-scroll">
            <table className="w-full text-sm">
              <thead className="text-xs text-muted-foreground border-b bg-secondary/30">
                <tr>
                  <th className="text-left py-2.5 px-4 font-medium">Merged record</th>
                  <th className="text-left py-2.5 px-4 font-medium">Kept as</th>
                  <th className="text-left py-2.5 px-4 font-medium">Why</th>
                  <th className="text-left py-2.5 px-4 font-medium">By</th>
                  <th className="text-right py-2.5 px-4 font-medium">Survivor AUM</th>
                  <th className="text-right py-2.5 px-4 font-medium">When</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.loserId} className="border-b last:border-0 hover:bg-secondary/30">
                    <td className="py-2.5 px-4">
                      <div className="font-medium">{r.loserName}</div>
                      <div className="text-[11px] text-muted-foreground tabular-nums">
                        {[r.loserPan, r.loserPhone, r.loserEmail].filter(Boolean).join(" · ") || "no identifiers"}
                      </div>
                    </td>
                    <td className="py-2.5 px-4">
                      <Link href={`/dashboard/investors/${r.survivorId}`} className="font-medium hover:underline">
                        {r.survivorName}
                      </Link>
                      {r.survivorPan && <div className="text-[11px] text-muted-foreground tabular-nums">{r.survivorPan}</div>}
                    </td>
                    <td className="py-2.5 px-4">
                      <span
                        className={`chip text-[10px] ${
                          r.source === "manual" ? "bg-cyan-50 text-cyan-700" : "bg-amber-50 text-amber-700"
                        }`}
                      >
                        {r.source === "manual" ? "Manual" : "System"}
                      </span>
                      {r.reason && <span className="ml-2 text-[11px] text-muted-foreground">{r.reason}</span>}
                    </td>
                    <td className="py-2.5 px-4 text-xs text-muted-foreground">{r.mergedByName ?? "—"}</td>
                    <td className="py-2.5 px-4 text-right tabular-nums">{inr(r.survivorAum)}</td>
                    <td className="py-2.5 px-4 text-right text-xs text-muted-foreground whitespace-nowrap">
                      {fmtDate(r.mergedAt)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {!canMerge && (
        <p className="text-xs text-muted-foreground">
          Merging is restricted to owners and branch heads — this view is read-only for your role.
        </p>
      )}
    </div>
  );
}
