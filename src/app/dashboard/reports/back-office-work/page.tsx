import { PageHeaderCard } from "@/components/layout/PageHeaderCard";
import { BackOfficeWorkBoard } from "@/components/reports/BackOfficeWorkBoard";

export const dynamic = "force-dynamic";

export default function BackOfficeWorkPage() {
  return (
    <div className="space-y-5 max-w-5xl">
      <PageHeaderCard title={<>Back-Office Work</>} subtitle={<>Rectification &amp; operations throughput by branch — Online / Offline, value and count.</>} />

      <BackOfficeWorkBoard />
    </div>
  );
}
