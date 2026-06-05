import Link from "next/link";
import { redirect } from "next/navigation";
import { Building2, Package, LifeBuoy, BarChart3, Settings, Users as UsersIcon, Activity, Image as ImageIcon, Bot } from "lucide-react";
import { requireSession } from "@/lib/auth/session";
import { SignOutLink } from "@/components/super-admin/SignOutLink";
import { ToastProvider } from "@/components/ui/Toast";

export const dynamic = "force-dynamic";

export default async function SuperAdminLayout({ children }: { children: React.ReactNode }) {
  const session = await requireSession();
  if (!session.isPlatformAdmin) {
    redirect("/dashboard");
  }

  return (
    <ToastProvider>
    <div className="min-h-screen flex">
      <aside className="w-60 border-r bg-slate-900 text-slate-100 flex-shrink-0 flex flex-col">
        <div className="p-4 border-b border-slate-800 flex items-center gap-2 font-semibold">
          <div className="size-7 rounded bg-amber-500 text-slate-900 grid place-items-center text-sm">A</div>
          <div>
            <div>AINA</div>
            <div className="text-[10px] text-slate-400 font-normal">Platform Admin</div>
          </div>
        </div>
        <nav className="flex-1 overflow-y-auto p-2 space-y-0.5 text-sm">
          <NavLink href="/super-admin" icon={BarChart3} label="Overview" />
          <NavLink href="/super-admin/tenants" icon={Building2} label="MFD tenants" />
          <NavLink href="/super-admin/packages" icon={Package} label="Packages" />
          <NavLink href="/super-admin/subscriptions" icon={Activity} label="Subscriptions" />
          <NavLink href="/super-admin/content-library" icon={ImageIcon} label="Content Library" />
          <NavLink href="/super-admin/support" icon={LifeBuoy} label="Support tickets" />
          <NavLink href="/super-admin/users" icon={UsersIcon} label="Platform staff" />
          <NavLink href="/super-admin/ai" icon={Bot} label="AI &amp; Models" />
          <NavLink href="/super-admin/settings" icon={Settings} label="Platform settings" />
        </nav>
        <div className="p-3 border-t border-slate-800 text-xs">
          <div className="font-medium truncate">{session.name}</div>
          <div className="text-slate-400 truncate">{session.email}</div>
        </div>
      </aside>
      <main className="flex-1 overflow-y-auto bg-background">
        <div className="border-b px-6 py-3 flex items-center justify-between sticky top-0 bg-background/95 backdrop-blur z-10">
          <div className="text-sm text-muted-foreground">AINA platform · Cross-tenant access</div>
          <SignOutLink />
        </div>
        <div className="p-6">{children}</div>
      </main>
    </div>
    </ToastProvider>
  );
}

function NavLink({ href, icon: Icon, label }: { href: string; icon: any; label: string }) {
  return (
    <Link
      href={href}
      className="flex items-center gap-2.5 rounded-md px-3 py-2 hover:bg-slate-800 transition-colors"
    >
      <Icon className="size-3.5 text-slate-400" />
      <span>{label}</span>
    </Link>
  );
}
