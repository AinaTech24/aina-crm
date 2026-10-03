import { PageHeaderCard } from "@/components/layout/PageHeaderCard";
import { InsuranceClaimsBoard } from "@/components/reports/InsuranceClaimsBoard";

export const dynamic = "force-dynamic";

export default function InsuranceClaimsPage() {
  return (
    <div className="space-y-5 max-w-3xl">
      <PageHeaderCard title={<>Insurance Claims — Summary</>} />

      <InsuranceClaimsBoard />
    </div>
  );
}
