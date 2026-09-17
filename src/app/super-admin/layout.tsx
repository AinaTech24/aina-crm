import { redirect } from "next/navigation";
import { requireSession } from "@/lib/auth/session";
import { AdminShell } from "@/components/super-admin/AdminShell";
import { ToastProvider } from "@/components/ui/Toast";
import { ConfirmProvider } from "@/components/ui/ConfirmProvider";

export const dynamic = "force-dynamic";

export default async function SuperAdminLayout({ children }: { children: React.ReactNode }) {
  const session = await requireSession();
  if (!session.isPlatformAdmin) {
    redirect("/dashboard");
  }

  return (
    <ToastProvider>
    <ConfirmProvider>
      <AdminShell name={session.name} email={session.email}>
        {children}
      </AdminShell>
    </ConfirmProvider>
    </ToastProvider>
  );
}
