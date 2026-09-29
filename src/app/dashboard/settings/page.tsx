import { PageHeaderCard } from "@/components/layout/PageHeaderCard";
import { SettingsDirectory } from "@/components/settings/SettingsDirectory";

export const dynamic = "force-dynamic";

/** The sections, their order and the search live in SettingsDirectory. */
export default function SettingsPage() {
  return (
    <div className="space-y-6 max-w-5xl">
      <PageHeaderCard title={<>Settings</>} subtitle={<>Configure your firm's workspace.</>} />
      <SettingsDirectory />
    </div>
  );
}
