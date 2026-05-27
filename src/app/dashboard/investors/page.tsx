import Link from "next/link";
import { Plus, Upload } from "lucide-react";
import { desc, ilike, or, sql, eq, and, inArray } from "drizzle-orm";
import { withTenant } from "@/db/client";
import { investors } from "@/db/schema";
import { requireSession } from "@/lib/auth/session";
import { formatINR } from "@/lib/utils";
import { RecomputeTiersButton } from "@/components/investors/RecomputeTiersButton";
import { RowActions } from "@/components/common/RowActions";
import { FilterBar } from "@/components/common/FilterBar";
import { CustomViews } from "@/components/common/CustomViews";
import { HelpHint } from "@/components/help/HelpHint";
import { EmptyState } from "@/components/common/EmptyState";
import { Users } from "lucide-react";

const segmentColors: Record<string, string> = {
  HNI: "bg-violet-50 text-violet-700",
  Affluent: "bg-emerald-50 text-emerald-700",
  Retail: "bg-blue-50 text-blue-700",
  NRI: "bg-pink-50 text-pink-700",
  Corporate: "bg-amber-50 text-amber-700",
};

const tierColors: Record<string, string> = {
  A: "bg-violet-100 text-violet-700",
  B: "bg-emerald-100 text-emerald-700",
  C: "bg-blue-100 text-blue-700",
};

export const dynamic = "force-dynamic";

export default async function InvestorsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const session = await requireSession();
  const sp = await searchParams;
  const q = (sp.q ?? "").trim();
  const segment = (sp.segment ?? "").split(",").filter(Boolean);
  const tier = (sp.tier ?? "").split(",").filter(Boolean);
  const status = (sp.status ?? "").split(",").filter(Boolean);
  const kyc = (sp.kyc ?? "").split(",").filter(Boolean);

  const { rows, total } = await withTenant(session.tenantId, async (tx) => {
    const conditions: any[] = [];
    if (q) {
      conditions.push(
        or(
          ilike(investors.name, `%${q}%`),
          ilike(investors.pan, `%${q.toUpperCase()}%`),
          ilike(investors.phone ?? sql`''`, `%${q}%`)
        )!
      );
    }
    if (segment.length) conditions.push(inArray(investors.segmentTag, segment as any));
    if (tier.length) conditions.push(inArray(investors.serviceTier, tier as any));
    if (status.length) conditions.push(inArray(investors.status, status as any));
    if (kyc.length) conditions.push(inArray(investors.kycStatus, kyc as any));
    const where = conditions.length ? and(...conditions) : undefined;

    const r = await tx
      .select()
      .from(investors)
      .where(where as any)
      .orderBy(desc(investors.aum))
      .limit(50);

    const c = await tx
      .select({ c: sql<number>`count(*)::int` })
      .from(investors)
      .where(where as any);

    return { rows: r, total: Number(c[0]?.c ?? 0) };
  }, { userId: session.userId, branchId: session.branchId, roles: session.roles });

  return (
    <div className="space-y-6 max-w-7xl">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Investors</h1>
          <p className="text-muted-foreground text-sm">
            {total === 0 ? "No investors yet." : `${total} investors in your firm.`}
          </p>
        </div>
        <div className="flex gap-2">
          <RecomputeTiersButton />
          <Link
            href="/dashboard/investors/import"
            className="rounded-md border px-3 py-1.5 text-sm flex items-center gap-1.5"
          >
            <Upload className="size-4" /> Import Excel
          </Link>
          <Link
            href="/dashboard/investors/new"
            className="rounded-md bg-primary text-primary-foreground px-3 py-1.5 text-sm font-medium flex items-center gap-1.5"
          >
            <Plus className="size-4" /> Add investor
          </Link>
        </div>
      </div>

      <FilterBar
        totalCount={total}
        filters={[
          { type: "search", key: "q", placeholder: "Search by name, PAN, phone…" },
          {
            type: "multi",
            key: "segment",
            label: "Segment",
            options: [
              { value: "HNI", label: "HNI" },
              { value: "Affluent", label: "Affluent" },
              { value: "Retail", label: "Retail" },
              { value: "NRI", label: "NRI" },
              { value: "Corporate", label: "Corporate" },
            ],
          },
          {
            type: "multi",
            key: "tier",
            label: "Service tier",
            options: [
              { value: "A", label: "A — Quarterly" },
              { value: "B", label: "B — Half-yearly" },
              { value: "C", label: "C — Annual" },
            ],
          },
          {
            type: "multi",
            key: "kyc",
            label: "KYC",
            options: [
              { value: "verified", label: "Verified" },
              { value: "pending", label: "Pending" },
              { value: "expired", label: "Expired" },
              { value: "rejected", label: "Rejected" },
            ],
          },
          {
            type: "multi",
            key: "status",
            label: "Status",
            options: [
              { value: "active", label: "Active" },
              { value: "dormant", label: "Dormant" },
              { value: "inactive", label: "Inactive" },
              { value: "deceased", label: "Deceased" },
              { value: "closed", label: "Closed" },
            ],
          },
        ]}
        rightSlot={
          <CustomViews
            viewsKey="views:investors"
            presets={[
              { id: "hni", name: "HNI clients", params: "segment=HNI" },
              { id: "kyc-pending", name: "KYC pending", params: "kyc=pending,expired" },
              { id: "tier-a", name: "Tier A (quarterly)", params: "tier=A" },
            ]}
          />
        }
      />

      <div className="card-surface overflow-hidden">
        {rows.length === 0 ? (
          // Brand-new tenant with zero investors AND no active filter → big friendly EmptyState.
          // Otherwise just a short "no matches" line so the filter UI stays in context.
          total === 0 && !q && !segment.length && !tier.length && !status.length && !kyc.length ? (
            <div className="p-6">
              <EmptyState
                icon={Users}
                title="No clients yet — let's add the first one"
                description="A client is anyone whose money you manage. Add them one at a time, or save hours by importing your existing book from Excel."
                tip="Already have a list in Excel? Use Import — the wizard maps columns automatically and warns you about KYC gaps."
                primary={{ href: "/dashboard/investors/new", label: "+ Add first client" }}
                secondary={{ href: "/dashboard/investors/import", label: "Import from Excel" }}
                learnMoreAnchor="kyc"
              />
            </div>
          ) : (
            <div className="p-12 text-center text-sm text-muted-foreground">
              No investors match these filters.{" "}
              <Link href="/dashboard/investors/new" className="text-brand-cyan-deep hover:underline">
                Add one manually
              </Link>
              .
            </div>
          )
        ) : (
          <table className="w-full text-sm">
            <thead className="text-xs text-muted-foreground border-b">
              <tr>
                <th className="text-left px-4 py-2 font-medium">Name</th>
                <th className="text-left py-2 font-medium">
                  <span className="inline-flex items-center">PAN<HelpHint term="PAN" /></span>
                </th>
                <th className="text-left py-2 font-medium">Tier</th>
                <th className="text-left py-2 font-medium">Segment</th>
                <th className="text-right py-2 font-medium">
                  <span className="inline-flex items-center">AUM<HelpHint term="AUM" /></span>
                </th>
                <th className="text-right py-2 font-medium">
                  <span className="inline-flex items-center">SIP<HelpHint term="SIP" /></span>
                </th>
                <th className="text-left py-2 font-medium pl-4">
                  <span className="inline-flex items-center">KYC<HelpHint term="KYC" /></span>
                </th>
                <th className="text-left py-2 font-medium">Status</th>
                <th className="px-4 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((i) => (
                <tr key={i.id} className="border-b last:border-0 hover:bg-accent/40">
                  <td className="px-4 py-3 font-medium">
                    <Link href={`/dashboard/investors/${i.id}`} className="hover:underline">
                      {i.name}
                    </Link>
                  </td>
                  <td className="py-3 text-xs font-mono text-muted-foreground">{i.pan}</td>
                  <td className="py-3">
                    {i.serviceTier ? (
                      <span
                        className={`text-xs font-bold px-2 py-0.5 rounded-full ${tierColors[i.serviceTier] ?? ""}`}
                        title={i.serviceTier === "A" ? "Quarterly review" : i.serviceTier === "B" ? "Half-yearly review" : "Annual review"}
                      >
                        {i.serviceTier}
                      </span>
                    ) : (
                      <span className="text-xs text-muted-foreground">—</span>
                    )}
                  </td>
                  <td className="py-3">
                    {i.segmentTag && (
                      <span className={`text-xs px-2 py-0.5 rounded-full ${segmentColors[i.segmentTag] ?? ""}`}>
                        {i.segmentTag}
                      </span>
                    )}
                  </td>
                  <td className="py-3 text-right tabular-nums">{formatINR(Number(i.aum ?? 0))}</td>
                  <td className="py-3 text-right tabular-nums text-muted-foreground">
                    {Number(i.activeSipAmount ?? 0) > 0 ? `${formatINR(Number(i.activeSipAmount))}/mo` : "—"}
                  </td>
                  <td className="py-3 pl-4">
                    <span
                      className={`text-xs px-2 py-0.5 rounded-full ${
                        i.kycStatus === "verified"
                          ? "bg-emerald-50 text-emerald-700"
                          : i.kycStatus === "expired"
                          ? "bg-rose-50 text-rose-700"
                          : "bg-amber-50 text-amber-700"
                      }`}
                    >
                      {i.kycStatus}
                    </span>
                  </td>
                  <td className="py-3 text-xs">{i.status}</td>
                  <td className="px-4 py-3 text-right">
                    <RowActions
                      editHref={`/dashboard/investors/${i.id}`}
                      deleteUrl={`/api/investors/${i.id}`}
                      itemLabel="investor"
                      itemName={i.name}
                      verb="Mark exited"
                    />
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
