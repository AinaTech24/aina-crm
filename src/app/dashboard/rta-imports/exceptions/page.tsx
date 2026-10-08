/**
 * /dashboard/rta-imports/exceptions — the "Row exceptions" tile, broken down.
 *
 * Grouped by reason with counts (lib/rta/exceptions), over exactly the tile's
 * window: the last 30 uploads, "not ours" files left out. ?reason=<key> lists
 * that group's rows, each linked to its import.
 */
import Link from "next/link";
import { ArrowRight, ListChecks } from "lucide-react";
import { PageHeaderCard } from "@/components/layout/PageHeaderCard";
import { InlineEmpty } from "@/components/common/EmptyState";
import { withTenant } from "@/db/client";
import { requirePageSession } from "@/lib/auth/session";
import { ImportAccessDenied } from "@/components/rta/ImportAccessDenied";
import { maskImportText, rtaImportDenial } from "@/lib/rta/import-access";
import { formatRelative } from "@/lib/utils";
import { RTA_FILE_TYPE_BY_KIND } from "@/lib/rta/file-types";
import { loadRowExceptions, isExceptionReason, EXCEPTION_REASONS } from "@/lib/rta/exceptions";

export const dynamic = "force-dynamic";

const DETAIL_LIMIT = 200;

const kindLabel = (k: string) => (RTA_FILE_TYPE_BY_KIND as Record<string, { label: string } | undefined>)[k]?.label ?? k;
const pct = (n: number, of: number) => (of > 0 ? `${((n / of) * 100).toFixed(1)}%` : "—");

export default async function RtaExceptionsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const session = await requirePageSession();
  const sp = await searchParams;
  const reason = isExceptionReason(sp.reason) ? sp.reason : undefined;

  // Row exceptions are every import's row errors, firm-wide — same gate as the
  // import list and detail (lib/rta/import-access).
  const result = await withTenant(
    session.tenantId,
    async (tx) => {
      const denial = await rtaImportDenial(tx, session);
      if (denial) return { denial, data: null };
      return { denial: null, data: await loadRowExceptions(tx, { reason, detailLimit: DETAIL_LIMIT }) };
    },
    { userId: session.userId, branchId: session.branchId, roles: session.roles }
  );
  if (result.denial || !result.data) return <ImportAccessDenied message={result.denial?.message ?? ""} />;
  const data = result.data;
  const selected = reason ? EXCEPTION_REASONS.find((r) => r.key === reason) : undefined;

  return (
    <div className="space-y-6 max-w-7xl">
      <PageHeaderCard
        breadcrumb={[{ label: "RTA File Imports", href: "/dashboard/rta-imports" }, { label: "Row exceptions" }]}
        title={<><ListChecks className="size-6 text-muted-foreground" /> Row exceptions</>}
      />

      {data.exceptionRows === 0 ? (
        <div className="card-surface">
          <InlineEmpty message="No row exceptions in the last 30 uploads." action={{ href: "/dashboard/rta-imports", label: "Back to RTA File Imports" }} />
        </div>
      ) : (
        <>
          <p className="text-sm text-muted-foreground">
            <span className="font-semibold text-foreground tabular-nums">{data.exceptionRows.toLocaleString("en-IN")}</span> of{" "}
            {data.processedRows.toLocaleString("en-IN")} rows ({pct(data.exceptionRows, data.processedRows)}). Start with the largest group
            that asks for an action; re-uploading a file after fixing the cause brings its skipped rows in.
          </p>

          <div className="card-surface">
            <div className="table-scroll">
              <table className="w-full text-sm">
                <thead className="text-xs text-muted-foreground border-b">
                  <tr>
                    <th className="text-left px-4 py-2 font-medium">Reason</th>
                    <th className="text-right py-2 font-medium">Rows</th>
                    <th className="text-right py-2 font-medium">Share</th>
                    <th className="text-right py-2 font-medium">Files</th>
                    <th className="px-4 py-2" aria-label="Show rows" />
                  </tr>
                </thead>
                <tbody>
                  {data.groups.map((g) => {
                    const active = g.key === reason;
                    return (
                      <tr key={g.key} className={`border-b last:border-0 ${active ? "bg-secondary/60" : ""}`}>
                        <td className="px-4 py-3 !whitespace-normal">
                          <div className="font-medium text-foreground">{g.label}</div>
                          <div className="mt-0.5 max-w-2xl text-xs text-muted-foreground">{g.action}</div>
                          {g.example && (
                            <div className="mt-1 max-w-2xl truncate text-2xs text-muted-foreground/80" title={maskImportText(g.example)}>
                              e.g. {maskImportText(g.example)}
                            </div>
                          )}
                        </td>
                        <td className="py-3 text-right tabular-nums font-semibold text-foreground">{g.rows.toLocaleString("en-IN")}</td>
                        <td className="py-3 text-right tabular-nums text-muted-foreground">{pct(g.rows, data.exceptionRows)}</td>
                        <td className="py-3 text-right tabular-nums text-muted-foreground">{g.key === "unrecorded" ? "—" : g.files}</td>
                        <td className="px-4 py-3 text-right">
                          {g.key !== "unrecorded" && (
                            <Link
                              href={active ? "/dashboard/rta-imports/exceptions" : `/dashboard/rta-imports/exceptions?reason=${g.key}`}
                              className="inline-flex items-center gap-1 text-xs font-medium text-foreground hover:underline"
                              aria-current={active ? "true" : undefined}
                            >
                              {active ? "Hide rows" : <>Show rows <ArrowRight className="size-3.5" aria-hidden /></>}
                            </Link>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {selected && data.detail && (
            <section aria-labelledby="rta-exception-rows" className="card-surface">
              <div className="border-b border-border px-4 py-2.5">
                <h2 id="rta-exception-rows" className="font-semibold text-foreground">{selected.label}</h2>
                <p className="text-xs text-muted-foreground">
                  {data.detail.total > data.detail.rows.length
                    ? `The newest ${data.detail.rows.length.toLocaleString("en-IN")} of ${data.detail.total.toLocaleString("en-IN")} rows. Open a file for all of its rows.`
                    : `${data.detail.total.toLocaleString("en-IN")} ${data.detail.total === 1 ? "row" : "rows"}.`}
                </p>
              </div>
              <div className="table-scroll">
                <table className="w-full text-sm">
                  <thead className="text-xs text-muted-foreground border-b">
                    <tr>
                      <th className="text-left px-4 py-2 font-medium">File</th>
                      <th className="text-left py-2 font-medium">Type</th>
                      <th className="text-left py-2 font-medium">Uploaded</th>
                      <th className="text-right py-2 font-medium">Row</th>
                      <th className="text-left px-4 py-2 font-medium">Detail</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.detail.rows.map((r, i) => (
                      <tr key={`${r.importId}:${r.row}:${i}`} className="border-b last:border-0">
                        <td className="px-4 py-2.5 max-w-xs truncate">
                          <Link href={`/dashboard/rta-imports/${r.importId}`} className="hover:underline" title={r.fileName}>
                            {r.fileName}
                          </Link>
                        </td>
                        <td className="py-2.5 text-xs text-muted-foreground">
                          {kindLabel(r.kind)} · {r.source.toUpperCase()}
                        </td>
                        <td className="py-2.5 text-xs text-muted-foreground">{formatRelative(r.createdAt)}</td>
                        <td className="py-2.5 text-right text-xs tabular-nums text-muted-foreground">{r.row ?? "—"}</td>
                        <td className="px-4 py-2.5 text-xs text-foreground !whitespace-normal">{maskImportText(r.reason)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}
        </>
      )}
    </div>
  );
}
