import { PageHeaderCard } from "@/components/layout/PageHeaderCard";
import { SipRejectionBoard } from "@/components/reports/SipRejectionBoard";

export const dynamic = "force-dynamic";

export default function SipRejectionPage() {
  return (
    <div className="space-y-5 max-w-5xl">
      <PageHeaderCard title={<>SIP Rejection, Pending &amp; Repurchase</>} subtitle={<>Per branch, by RM (grouped into desks): SIP rejections &amp; pending, plus additional-purchase repurchase.</>} />

      <SipRejectionBoard />
    </div>
  );
}
