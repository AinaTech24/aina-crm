import { requireSession } from "@/lib/auth/session";
import { requirePlatform } from "@/lib/auth/rbac";
import { LandingPackageForm } from "@/components/super-admin/LandingPackageForm";

export const dynamic = "force-dynamic";

export default async function NewLandingPackagePage() {
  const session = await requireSession();
  requirePlatform(session.roles, "platform.package.manage");
  return <LandingPackageForm />;
}
