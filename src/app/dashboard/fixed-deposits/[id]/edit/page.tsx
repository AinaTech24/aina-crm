/** Edit an FD — the same form as Add, locked to its client. */

import { notFound } from "next/navigation";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { loadViewableInvestor } from "@/lib/investors/access";
import { PageHeaderCard } from "@/components/layout/PageHeaderCard";
import { FdForm } from "@/components/fixed-deposits/FdForm";
import { emptyFd } from "@/lib/fixed-deposits/form";
import { listFdStaff, loadViewableFd, requireEditFds } from "@/lib/fixed-deposits/service";

export const dynamic = "force-dynamic";

const s = (v: unknown) => (v == null ? "" : String(v));
const amt = (v: unknown) => (v == null ? "" : String(Number(v)));

export default async function EditFixedDepositPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await requireSession();
  requireEditFds(session);
  const data = await withTenant(session.tenantId, async (tx) => {
    const fd = await loadViewableFd(tx, session, id);
    if (!fd) return null;
    const client = await loadViewableInvestor(tx, session, fd.investorId);
    return { fd, client, staff: await listFdStaff(tx, session.tenantId) };
  }, { userId: session.userId, branchId: session.branchId ?? undefined, roles: session.roles });
  if (!data) notFound();
  const { fd } = data;

  const initial = emptyFd({
    id: fd.id,
    investorId: fd.investorId,
    investorName: data.client?.name ?? "",
    rmId: s(fd.rmId),
    issuer: fd.issuer,
    issuerType: fd.issuerType,
    schemeName: s(fd.schemeName),
    fdNumber: s(fd.fdNumber),
    depositDate: String(fd.depositDate),
    maturityDate: String(fd.maturityDate),
    principal: amt(fd.principal),
    interestRate: amt(fd.interestRate),
    payout: fd.payout,
    compounding: fd.compounding,
    maturityAmount: fd.maturityAmountEntered ? amt(fd.maturityAmount) : "",
    holding: fd.holding,
    jointHolders: s(fd.jointHolders),
    nomineeName: s(fd.nomineeName),
    seniorCitizen: fd.seniorCitizen,
    taxForm: fd.taxForm,
    autoRenew: fd.autoRenew,
    status: fd.status,
    commissionRate: amt(fd.commissionRate),
    commissionAmount: amt(fd.commissionAmount),
    remarks: s(fd.remarks),
  });

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <PageHeaderCard
        title="Edit FD"
        subtitle={`${fd.issuer} — ${data.client?.name ?? "client"}`}
        breadcrumb={[{ label: "Fixed Deposits", href: "/dashboard/fixed-deposits" }, { label: fd.issuer, href: `/dashboard/fixed-deposits/${fd.id}` }, { label: "Edit" }]}
      />
      <FdForm initial={initial} staff={data.staff} lockClient cancelHref={`/dashboard/fixed-deposits/${fd.id}`} />
    </div>
  );
}
