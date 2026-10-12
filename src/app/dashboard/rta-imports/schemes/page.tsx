/**
 * /dashboard/rta-imports/schemes — registrar scheme codes and the CRM Scheme
 * Master (Phase 3H). Every code a registrar file used, how it resolves to an
 * AMFI scheme (the registrar's ISIN, or a person's confirmation — never a
 * name), and how many transactions wait on it. A CAMS code needs a person:
 * CAMS reports print no ISIN.
 */
import Link from "next/link";
import { Shapes } from "lucide-react";
import { PageHeaderCard } from "@/components/layout/PageHeaderCard";
import { withTenant } from "@/db/client";
import { requirePageSession } from "@/lib/auth/session";
import { can } from "@/lib/auth/rbac";
import { ImportAccessDenied } from "@/components/rta/ImportAccessDenied";
import { rtaImportDenial } from "@/lib/rta/import-access";
import { loadSchemeCodes, type SchemeStatus } from "@/lib/rta/scheme-resolution";
import { SchemeCodesTable } from "@/components/rta/SchemeCodesTable";

export const dynamic = "force-dynamic";

const LABEL: Record<SchemeStatus, string> = {
  conflict: "Conflict", unresolved: "Needs a decision", confirmed: "Confirmed by a person", resolved_isin: "Resolved by ISIN",
};
const ORDER: SchemeStatus[] = ["conflict", "unresolved", "confirmed", "resolved_isin"];

export default async function SchemeCodesPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const session = await requirePageSession();
  const sp = await searchParams;
  const status = (ORDER as string[]).includes(sp.status ?? "") ? (sp.status as SchemeStatus) : undefined;
  const result = await withTenant(session.tenantId, async (tx) => {
    const denial = await rtaImportDenial(tx, session);
    if (denial) return { denial, data: null };
    return { denial: null, data: await loadSchemeCodes(tx, session.tenantId, { status }) };
  }, { userId: session.userId, branchId: session.branchId, roles: session.roles });
  if (result.denial || !result.data) return <ImportAccessDenied message={result.denial?.message ?? ""} />;
  const { rows, counts } = result.data;
  const total = ORDER.reduce((a, s) => a + counts[s], 0);
  const canConfirm = can(session.roles, "transactions.execute", session.permissions);

  return (
    <div className="space-y-6 max-w-7xl">
      <PageHeaderCard
        breadcrumb={[{ label: "RTA File Imports", href: "/dashboard/rta-imports" }, { label: "Scheme codes" }]}
        title={<><Shapes className="size-6 text-muted-foreground" /> Scheme codes</>}
      />
      <p className="text-sm text-muted-foreground">
        Each registrar names a scheme by its own code. A code is linked to the Scheme Master only by the registrar&apos;s ISIN or by a
        person&apos;s confirmation — never by a similar name. Transactions on a code that is not linked wait on the{" "}
        <Link href="/dashboard/rta-imports/held" className="underline">Held</Link> list and post once it is.
      </p>
      <nav className="dash-seg" aria-label="Filter by status">
        <Link href="/dashboard/rta-imports/schemes" aria-current={!status ? "page" : undefined}>All <span className="tabular-nums">{total}</span></Link>
        {ORDER.filter((s) => counts[s] > 0).map((s) => (
          <Link key={s} href={`/dashboard/rta-imports/schemes?status=${s}`} aria-current={status === s ? "page" : undefined}>
            {LABEL[s]} <span className="tabular-nums">{counts[s]}</span>
          </Link>
        ))}
      </nav>
      <div className="card-surface">
        <SchemeCodesTable rows={rows} canConfirm={canConfirm} />
      </div>
    </div>
  );
}
