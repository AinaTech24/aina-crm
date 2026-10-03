import { PageHeaderCard } from "@/components/layout/PageHeaderCard";
import { SipHealthBoard } from "@/components/reports/SipHealthBoard";

export const dynamic = "force-dynamic";

export default function SipHealthPage() {
  return (
    <div className="space-y-5 max-w-3xl">
      <PageHeaderCard title={<>SIP Health &amp; Efforts</>} />

      <SipHealthBoard />
    </div>
  );
}
