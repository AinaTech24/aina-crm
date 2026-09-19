import { PageHeaderCard } from "@/components/layout/PageHeaderCard";
import { OtherServicesBoard } from "@/components/reports/OtherServicesBoard";

export const dynamic = "force-dynamic";

export default function OtherServicesPage() {
  return (
    <div className="space-y-5 max-w-4xl">
      <PageHeaderCard title={<>Back-Office — Other Services</>} subtitle={<>Service-request volumes by type and branch — IIN, CAN, bank/name/email/mobile change, switch, SWP,
          nominee, KYC.</>} />

      <OtherServicesBoard />
    </div>
  );
}
