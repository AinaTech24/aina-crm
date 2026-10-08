/**
 * /dashboard/rta-imports/held — what the validate-first import refused to
 * post (Phase 3F), one row per registrar transaction, with the reason and,
 * for an ownership hold, the client decision. Nothing here is guessed or
 * posted on its own; a re-import after fixing the cause posts what is now
 * verifiable, and the posting ledger keeps it to once.
 */
import Link from "next/link";
import { ShieldAlert } from "lucide-react";
import { PageHeaderCard } from "@/components/layout/PageHeaderCard";
import { withTenant } from "@/db/client";
import { requirePageSession } from "@/lib/auth/session";
import { can } from "@/lib/auth/rbac";
import { ImportAccessDenied } from "@/components/rta/ImportAccessDenied";
import { rtaImportDenial } from "@/lib/rta/import-access";
import { loadHeldTransactions, HELD_OUTCOMES, type HeldOutcome } from "@/lib/rta/posting/held";
import { postingGateEnv } from "@/lib/rta/posting/gate";
import { HeldTransactionsTable } from "@/components/rta/HeldTransactionsTable";

export const dynamic = "force-dynamic";

const LABEL: Record<HeldOutcome, string> = {
  quarantined: "Held for review", unsupported: "Not supported", correction_held: "Corrections", held_dependent: "Waiting on its folio", blocked: "Blocked",
};

export default async function HeldTransactionsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const session = await requirePageSession();
  const sp = await searchParams;
  const outcome = (HELD_OUTCOMES as readonly string[]).includes(sp.status ?? "") ? (sp.status as HeldOutcome) : undefined;
  const result = await withTenant(session.tenantId, async (tx) => {
    const denial = await rtaImportDenial(tx, session);
    if (denial) return { denial, data: null };
    return { denial: null, data: await loadHeldTransactions(tx, session.tenantId, { outcome }) };
  }, { userId: session.userId, branchId: session.branchId, roles: session.roles });
  if (result.denial || !result.data) return <ImportAccessDenied message={result.denial?.message ?? ""} />;
  const { rows, counts, total } = result.data;
  const gate = postingGateEnv();
  const mayResolve = can(session.roles, "transactions.execute", session.permissions);
  const canResolve = gate.allowed && mayResolve;
  const disabledReason = !gate.allowed ? "Posting is switched off in this environment" : !mayResolve ? "Needs permission to execute transactions" : null;

  return (
    <div className="space-y-6 max-w-7xl">
      <PageHeaderCard
        breadcrumb={[{ label: "RTA File Imports", href: "/dashboard/rta-imports" }, { label: "Held transactions" }]}
        title={<><ShieldAlert className="size-6 text-muted-foreground" /> Held transactions</>}
      />
      <p className="text-sm text-muted-foreground">
        Registrar transactions the import validated but did not post: an owner it could not prove, a figure that does not reconcile,
        a code it does not know, or a correction. They stay here until the cause is settled — never counted as business meanwhile.
        A transaction held for its scheme posts once its registrar code is linked under{" "}
        <Link href="/dashboard/rta-imports/schemes" className="underline">Scheme codes</Link>.
      </p>
      <nav className="dash-seg" aria-label="Filter by status">
        <Link href="/dashboard/rta-imports/held" aria-current={!outcome ? "page" : undefined}>All <span className="tabular-nums">{total}</span></Link>
        {HELD_OUTCOMES.filter((o) => counts[o] > 0).map((o) => (
          <Link key={o} href={`/dashboard/rta-imports/held?status=${o}`} aria-current={outcome === o ? "page" : undefined}>
            {LABEL[o]} <span className="tabular-nums">{counts[o]}</span>
          </Link>
        ))}
      </nav>
      <div className="card-surface">
        <HeldTransactionsTable rows={rows} canResolve={canResolve} resolveDisabledReason={disabledReason} />
      </div>
    </div>
  );
}
