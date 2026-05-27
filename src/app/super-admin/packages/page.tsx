import Link from "next/link";
import { asc } from "drizzle-orm";
import { Plus, Package as PackageIcon, Check, X } from "lucide-react";
import { withPlatformAdmin } from "@/db/client";
import { packages } from "@/db/schema";
import { requireSession } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

export default async function PackagesPage() {
  const session = await requireSession();
  const rows = await withPlatformAdmin(session.userId, async (tx) => {
    return tx.select().from(packages).orderBy(asc(packages.sortOrder), asc(packages.name));
  });

  return (
    <div className="space-y-6 max-w-7xl">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Packages</h1>
          <p className="text-muted-foreground text-sm">
            Define what each tier includes. Used at tenant create time and for module gating.
          </p>
        </div>
        <Link
          href="/super-admin/packages/new"
          className="rounded-md bg-primary text-primary-foreground px-3 py-1.5 text-sm font-medium flex items-center gap-1.5"
        >
          <Plus className="size-4" /> New package
        </Link>
      </div>

      <div className="grid grid-cols-3 gap-4">
        {rows.length === 0 ? (
          <div className="col-span-3 p-12 text-center text-sm text-muted-foreground border rounded-lg bg-card">
            <PackageIcon className="size-8 mx-auto text-muted-foreground/50" />
            <div className="mt-2">No packages yet.</div>
            <Link href="/super-admin/packages/new" className="text-primary hover:underline mt-2 inline-block">
              Create the first package →
            </Link>
          </div>
        ) : (
          rows.map((p) => (
            <Link
              key={p.id}
              href={`/super-admin/packages/${p.id}`}
              className={`border rounded-lg bg-card p-5 relative block hover:border-primary/40 hover:shadow-sm transition ${
                !p.isActive ? "opacity-60" : ""
              }`}
            >
              {p.badge && (
                <div className="absolute -top-2 right-3 text-xs bg-primary text-primary-foreground px-2 py-0.5 rounded">
                  {p.badge}
                </div>
              )}
              <div className="flex items-center justify-between">
                <h3 className="font-semibold">{p.name}</h3>
                <span
                  className={`text-xs px-2 py-0.5 rounded-full ${
                    p.isActive ? "bg-emerald-50 text-emerald-700" : "bg-gray-50 text-gray-600"
                  }`}
                >
                  {p.isActive ? "active" : "disabled"}
                </span>
              </div>
              <div className="text-xs text-muted-foreground font-mono mt-0.5">{p.key}</div>
              {p.description && (
                <p className="text-sm text-muted-foreground mt-2 line-clamp-2">{p.description}</p>
              )}
              <div className="mt-3 pt-3 border-t space-y-1 text-sm">
                <Row label="Monthly" value={`₹${(p.monthlyPricePaise / 100).toLocaleString("en-IN")}`} />
                <Row label="Yearly" value={`₹${(p.yearlyPricePaise / 100).toLocaleString("en-IN")}`} />
                <Row label="Setup" value={`₹${(p.setupCostPaise / 100).toLocaleString("en-IN")}`} />
                <Row label="Max users" value={String(p.maxUsers)} />
                <Row label="Max investors" value={String(p.maxInvestors)} />
                <Row label="Storage" value={`${p.storageLimitGb} GB`} />
                <Row label="Trial" value={`${p.trialDays} days`} />
                <Row label="Modules enabled" value={`${(p.enabledModules ?? []).length} of all`} />
              </div>
              <div className="mt-3 pt-3 border-t text-xs text-primary">Edit →</div>
            </Link>
          ))
        )}
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between text-xs">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium tabular-nums">{value}</span>
    </div>
  );
}
