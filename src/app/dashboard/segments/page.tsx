import Link from "next/link";
import { desc } from "drizzle-orm";
import { Plus, Filter as FilterIcon, Zap } from "lucide-react";
import { withTenant } from "@/db/client";
import { segments } from "@/db/schema";
import { requireSession } from "@/lib/auth/session";
import { investorCatalog } from "@/lib/filter/catalog";
import { formatRelative } from "@/lib/utils";
import { RowActions } from "@/components/common/RowActions";

export const dynamic = "force-dynamic";

export default async function SegmentsPage() {
  const session = await requireSession();
  const rows = await withTenant(session.tenantId, async (tx) => {
    return tx.select().from(segments).orderBy(desc(segments.updatedAt));
  });

  return (
    <div className="space-y-6 max-w-7xl">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Segments & filters</h1>
          <p className="text-muted-foreground text-sm">
            Reusable audiences. The same query language powers list filters, workflow criteria, and the AI assistant.
          </p>
        </div>
        <Link
          href="/dashboard/segments/new"
          className="rounded-md bg-primary text-primary-foreground px-3 py-1.5 text-sm font-medium flex items-center gap-1.5"
        >
          <Plus className="size-4" /> New segment
        </Link>
      </div>

      <div className="grid grid-cols-3 gap-4">
        <div className="col-span-2 border rounded-lg bg-card">
          <div className="border-b px-4 py-2.5 font-medium flex items-center justify-between">
            <span>Saved segments</span>
            <span className="text-xs text-muted-foreground">{rows.length} segments</span>
          </div>
          {rows.length === 0 ? (
            <div className="p-12 text-center text-sm text-muted-foreground">
              No segments yet.{" "}
              <Link href="/dashboard/segments/new" className="text-primary hover:underline">
                Create your first
              </Link>{" "}
              to power workflows + broadcasts.
            </div>
          ) : (
            <ul className="divide-y">
              {rows.map((s) => (
                <li
                  key={s.id}
                  className="px-4 py-2.5 flex items-center justify-between hover:bg-accent/40"
                >
                  <div className="flex items-center gap-3">
                    <FilterIcon className="size-4 text-muted-foreground" />
                    <div>
                      <Link
                        href={`/dashboard/segments/${s.id}`}
                        className="font-medium text-sm hover:underline"
                      >
                        {s.name}
                      </Link>
                      <div className="text-xs text-muted-foreground">
                        {s.kind} · {s.subjectType}
                        {s.lastMaterializedAt && (
                          <> · refreshed {formatRelative(s.lastMaterializedAt)}</>
                        )}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-sm font-medium tabular-nums">{s.memberCount}</span>
                    <Link
                      href={`/dashboard/segments/${s.id}`}
                      className="text-xs text-muted-foreground hover:underline"
                    >
                      View
                    </Link>
                    <RowActions
                      editHref={`/dashboard/segments/${s.id}`}
                      deleteUrl={`/api/segments/${s.id}`}
                      itemLabel="segment"
                      itemName={s.name}
                      permanent
                    />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="border rounded-lg bg-card p-5">
          <h2 className="font-semibold flex items-center gap-2">
            <Zap className="size-4" /> Available fields
          </h2>
          <p className="text-xs text-muted-foreground mt-1">
            {investorCatalog.fields.length} queryable fields on investor.
          </p>
          <ul className="mt-3 space-y-1 text-xs max-h-96 overflow-y-auto">
            {investorCatalog.fields.map((f) => (
              <li key={f.key} className="flex items-center justify-between py-1.5 border-b last:border-0">
                <span className="font-medium">{f.label}</span>
                <span className="text-muted-foreground">{f.type}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}
