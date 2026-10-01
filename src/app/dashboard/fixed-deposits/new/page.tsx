/**
 * Add FD. `?investorId=` pre-fills the client (the client page's "Add FD");
 * `?renew=<fd id>` starts the renewal of that deposit — same client, issuer and
 * amount, dated from its maturity — and marks the old one renewed on save.
 */

import { notFound } from "next/navigation";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { loadViewableInvestor } from "@/lib/investors/access";
import { PageHeaderCard } from "@/components/layout/PageHeaderCard";
import { FdForm } from "@/components/fixed-deposits/FdForm";
import { emptyFd } from "@/lib/fixed-deposits/form";
import { listFdStaff, loadViewableFd, requireEditFds } from "@/lib/fixed-deposits/service";
import { maturityDateFor, tenureBetween } from "@/lib/fixed-deposits/terms";
import { formatDate } from "@/lib/format";

export const dynamic = "force-dynamic";

type SP = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

export default async function NewFixedDepositPage({ searchParams }: { searchParams: Promise<SP> }) {
  const session = await requireSession();
  requireEditFds(session);
  const sp = await searchParams;
  const investorId = one(sp.investorId);
  const renewId = one(sp.renew);

  const data = await withTenant(session.tenantId, async (tx) => {
    const staff = await listFdStaff(tx, session.tenantId);
    const renew = renewId ? await loadViewableFd(tx, session, renewId) : null;
    const clientId = renew?.investorId ?? investorId;
    const client = clientId ? await loadViewableInvestor(tx, session, clientId) : null;
    return { staff, renew, client };
  }, { userId: session.userId, branchId: session.branchId ?? undefined, roles: session.roles });

  if ((investorId || renewId) && !data.client) notFound();
  const r = data.renew;
  const start = r ? String(r.maturityDate) : undefined;
  const tenure = r ? tenureBetween(String(r.depositDate), String(r.maturityDate)) : null;

  const initial = emptyFd({
    investorId: data.client?.id ?? "",
    investorName: data.client?.name ?? "",
    ...(r ? {
      rmId: r.rmId ?? "",
      issuer: r.issuer,
      issuerType: r.issuerType,
      schemeName: r.schemeName ?? "",
      depositDate: start!,
      maturityDate: maturityDateFor(start!, tenure!.months, tenure!.days),
      principal: String(Number(r.payout === "cumulative" && r.maturityAmount ? r.maturityAmount : r.principal)),
      payout: r.payout,
      compounding: r.compounding,
      holding: r.holding,
      jointHolders: r.jointHolders ?? "",
      nomineeName: r.nomineeName ?? "",
      seniorCitizen: r.seniorCitizen,
      taxForm: r.taxForm,
      autoRenew: r.autoRenew,
      renewedFromId: r.id,
    } : {}),
  });

  const back = r ? `/dashboard/fixed-deposits/${r.id}` : data.client ? `/dashboard/investors/${data.client.id}#fixed_deposits` : "/dashboard/fixed-deposits";
  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <PageHeaderCard
        title={r ? "Renew FD" : "Add FD"}
        subtitle={r
          ? `Renewing the ${r.issuer} deposit maturing on ${formatDate(String(r.maturityDate))}. Enter the new rate; the old FD is marked renewed when you save.`
          : "Record a fixed deposit from its receipt. The RM gets a reminder 15 days before it matures."}
        breadcrumb={[{ label: "Fixed Deposits", href: "/dashboard/fixed-deposits" }, { label: r ? "Renew FD" : "Add FD" }]}
      />
      <FdForm initial={initial} staff={data.staff} lockClient={!!data.client} cancelHref={back} />
    </div>
  );
}
