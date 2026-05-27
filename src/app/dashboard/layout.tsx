import Link from "next/link";
import { headers } from "next/headers";
import {
  LayoutDashboard,
  Users,
  GitBranch,
  Filter,
  FileText,
  MessageSquare,
  ListChecks,
  ShieldCheck,
  Settings,
  Sparkles,
  Send,
  LifeBuoy,
  ClipboardCheck,
  ScrollText,
  HeartHandshake,
  Target,
  TrendingUp,
  Repeat,
  XOctagon,
  Calendar,
  AlertOctagon,
  FileSignature,
  Shield,
  Megaphone,
  Image as ImageIcon,
  UserCog,
  BarChart3,
  FolderArchive,
  Lock,
  Bot,
  CreditCard,
  AlertTriangle,
  HelpCircle,
  BookOpen,
} from "lucide-react";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { tenants } from "@/db/schema";
import { requireSession } from "@/lib/auth/session";
import { primaryRoleLabel } from "@/lib/auth/rbac";
import { loadTenantLicense, isPathAllowedWhenRestricted } from "@/lib/auth/license";
import { GlobalSearch } from "@/components/layout/GlobalSearch";
import { NotificationBell } from "@/components/layout/NotificationBell";
import { SidebarNavLink } from "@/components/layout/SidebarNavLink";
import { QuickCreateFab } from "@/components/layout/QuickCreateFab";

export const dynamic = "force-dynamic";

type NavItem = {
  href: string;
  label: string;
  icon: any;
  /** Required role (any of). If omitted, visible to all. */
  roles?: string[];
  /** Required module key — gated by tenant package. */
  module?: string;
};

type NavSection = { title: string; items: NavItem[] };

const NAV: NavSection[] = [
  {
    title: "",
    items: [
      { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
    ],
  },
  {
    title: "CRM",
    items: [
      // Leads visible to owner, marketing, rm, branch_head
      { href: "/dashboard/leads", label: "Leads", icon: Sparkles, module: "lead_management",
        roles: ["owner", "marketing", "rm", "branch_head", "back_office", "ops", "compliance"] },
      // Investor data hidden from marketing per spec section 3
      { href: "/dashboard/investors", label: "Clients", icon: Users, module: "client_master",
        roles: ["owner", "rm", "branch_head", "back_office", "ops", "compliance"] },
      { href: "/dashboard/families", label: "Family Mapping", icon: HeartHandshake, module: "family_mapping",
        roles: ["owner", "rm", "branch_head", "back_office", "ops", "compliance"] },
      { href: "/dashboard/onboarding", label: "Client Onboarding", icon: ClipboardCheck, module: "onboarding",
        roles: ["owner", "back_office", "ops", "compliance"] },
      { href: "/dashboard/risk-profiles", label: "Risk Profile", icon: ShieldCheck, module: "risk_profile",
        roles: ["owner", "compliance", "back_office", "ops", "rm"] },
      { href: "/dashboard/goals", label: "Goal Planning", icon: Target, module: "goal_planning",
        roles: ["owner", "rm", "branch_head", "back_office", "ops"] },
      { href: "/dashboard/proposals", label: "Proposals", icon: FileSignature, module: "proposals",
        roles: ["owner", "rm", "branch_head", "back_office", "ops", "compliance"] },
      { href: "/dashboard/insurance", label: "Insurance Policies", icon: Shield, module: "insurance",
        roles: ["owner", "rm", "branch_head", "back_office", "ops", "compliance"] },
    ],
  },
  {
    title: "Operations",
    items: [
      // Transactions hidden from marketing
      { href: "/dashboard/transactions", label: "MF Transactions", icon: Repeat, module: "transactions",
        roles: ["owner", "back_office", "ops", "rm", "branch_head", "compliance"] },
      { href: "/dashboard/sips", label: "SIP Tracker", icon: TrendingUp, module: "sip_tracker",
        roles: ["owner", "back_office", "ops", "rm", "branch_head", "compliance"] },
      { href: "/dashboard/sip-rejections", label: "SIP Rejections", icon: XOctagon, module: "sip_rejection",
        roles: ["owner", "back_office", "ops", "rm", "branch_head"] },
      { href: "/dashboard/review-meetings", label: "Meetings", icon: Calendar, module: "review_meetings",
        roles: ["owner", "rm", "branch_head", "back_office", "ops"] },
      { href: "/dashboard/service-requests", label: "Service Requests", icon: LifeBuoy, module: "service_requests",
        roles: ["owner", "back_office", "ops", "rm", "branch_head", "compliance"] },
      { href: "/dashboard/complaints", label: "Complaints", icon: AlertOctagon, module: "complaints",
        roles: ["owner", "compliance", "back_office", "ops"] },
    ],
  },
  {
    title: "Automation",
    items: [
      { href: "/dashboard/workflows/rules", label: "Workflow Rules", icon: GitBranch, module: "automation_workflows" },
      { href: "/dashboard/workflows", label: "Workflows (advanced)", icon: GitBranch, module: "automation_workflows" },
      { href: "/dashboard/segments", label: "Segments & Filters", icon: Filter, module: "automation_workflows" },
      { href: "/dashboard/templates", label: "Templates", icon: FileText, module: "broadcasts" },
      { href: "/dashboard/campaigns", label: "Marketing Campaigns", icon: Megaphone, module: "marketing_campaigns", roles: ["owner", "marketing"] },
      { href: "/dashboard/content-calendar", label: "Social Media Calendar", icon: ImageIcon, module: "content_calendar", roles: ["owner", "marketing"] },
      { href: "/dashboard/aina-library", label: "AINA Content Library", icon: ImageIcon, roles: ["owner", "marketing", "rm", "branch_head", "back_office", "ops"] },
      { href: "/dashboard/communications", label: "Communications", icon: MessageSquare, module: "broadcasts" },
    ],
  },
  {
    title: "Compliance & Team",
    items: [
      { href: "/dashboard/compliance", label: "DDQ Readiness", icon: ShieldCheck, module: "ddq", roles: ["owner", "compliance"] },
      { href: "/dashboard/documents", label: "Documents", icon: FolderArchive, module: "documents" },
      { href: "/dashboard/sops", label: "SOP Library", icon: ScrollText, roles: ["owner", "compliance"] },
      { href: "/dashboard/tasks", label: "Tasks", icon: ListChecks, module: "tasks" },
      { href: "/dashboard/calendar", label: "Calendar", icon: Calendar },
      { href: "/dashboard/employees", label: "Employees", icon: UserCog, module: "employees", roles: ["owner", "branch_head"] },
      { href: "/dashboard/cybersecurity", label: "Cybersecurity", icon: Lock, module: "cybersecurity", roles: ["owner", "compliance"] },
    ],
  },
  {
    title: "Insights",
    items: [
      { href: "/dashboard/reports", label: "Reports & MIS", icon: BarChart3, module: "reports", roles: ["owner", "branch_head", "compliance"] },
      { href: "/dashboard/commission-reconciliation", label: "Commission Reconciliation", icon: CreditCard, module: "reports", roles: ["owner", "compliance", "back_office"] },
      { href: "/dashboard/ai-assistant", label: "AI Assistant", icon: Bot, module: "ai_assistant" },
      { href: "/dashboard/audit-log", label: "Audit Log", icon: ClipboardCheck, module: "audit_log", roles: ["owner", "compliance"] },
    ],
  },
  {
    title: "Admin",
    items: [
      { href: "/dashboard/billing", label: "Billing", icon: CreditCard, roles: ["owner"] },
      { href: "/dashboard/settings", label: "Settings", icon: Settings, roles: ["owner"] },
    ],
  },
  {
    title: "Help",
    items: [
      { href: "/dashboard/help", label: "Help & glossary", icon: BookOpen },
    ],
  },
];

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const session = await requireSession();
  const license = await loadTenantLicense(session.tenantId, session.roles);
  const enabledSet = new Set(license.enabledModules);
  // If no modules are configured (e.g. demo / dev), allow everything
  const noGating = enabledSet.size === 0;

  // Read the current path from the middleware-set header so we can carve out
  // billing + support pages while the rest of the dashboard is restricted.
  const reqHeaders = await headers();
  const pathname = reqHeaders.get("x-pathname") ?? "";
  const pathAllowed = isPathAllowedWhenRestricted(pathname);

  const tenantRow = await db.select().from(tenants).where(eq(tenants.id, session.tenantId)).limit(1);
  const tenant = tenantRow[0];

  const visible = NAV.map((section) => ({
    ...section,
    items: section.items.filter((i) => {
      if (i.roles && !session.roles.some((r) => i.roles!.includes(r) || r === "owner")) return false;
      if (i.module && !noGating && !enabledSet.has(i.module)) return false;
      return true;
    }),
  })).filter((s) => s.items.length > 0);

  const roleLabel = primaryRoleLabel(session.roles);

  const initials = session.name
    .split(" ")
    .map((n) => n[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();

  return (
    <div className="min-h-screen flex bg-background print:block print:min-h-0">
      {/* ────────────────────────── Sidebar ────────────────────────── */}
      <aside className="w-64 flex-shrink-0 flex flex-col bg-card border-r border-border/70 shadow-sm print:hidden">
        {/* Brand header — gradient mesh + logo */}
        <div className="relative overflow-hidden">
          <div className="absolute inset-0 brand-mesh opacity-95" />
          <div className="relative px-5 py-5 flex items-center gap-3">
            {tenant?.logoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={tenant.logoUrl}
                alt="logo"
                className="size-10 rounded-xl shadow-lg ring-2 ring-white/20"
              />
            ) : (
              <div
                className="size-10 rounded-xl bg-white/95 text-brand-navy grid place-items-center text-lg font-extrabold shadow-lg ring-2 ring-white/20"
                style={tenant?.primaryColor ? { color: tenant.primaryColor } : {}}
              >
                {(tenant?.displayName ?? "M").charAt(0).toUpperCase()}
              </div>
            )}
            <div className="min-w-0 text-white">
              <div className="font-semibold tracking-tight truncate text-sm">
                {tenant?.displayName ?? "MFD Growth OS"}
              </div>
              <div className="text-[11px] text-white/70 truncate font-mono">
                {tenant?.arn ?? "—"}
              </div>
            </div>
          </div>
        </div>

        {/* Nav — grouped sections with active-state highlighting */}
        <nav className="flex-1 overflow-y-auto px-3 py-4 space-y-5 scrollbar-thin">
          {visible.map((section, i) => (
            <div key={i}>
              {section.title && (
                <div className="px-2 mb-2 text-[10px] font-bold uppercase tracking-[0.1em] text-muted-foreground/70">
                  {section.title}
                </div>
              )}
              <div className="space-y-0.5">
                {section.items.map((item) => {
                  const Icon = item.icon;
                  return (
                    <SidebarNavLink
                      key={item.href}
                      href={item.href}
                      label={item.label}
                      iconElement={<Icon className="nav-link-icon" />}
                    />
                  );
                })}
              </div>
            </div>
          ))}
        </nav>

        {/* User card at bottom */}
        <div className="p-3 border-t border-border/70 bg-secondary/30">
          <div className="rounded-xl bg-card border border-border/60 p-3 flex items-center gap-3 shadow-sm">
            <div className="size-10 rounded-full brand-gradient text-white grid place-items-center text-xs font-bold flex-shrink-0 shadow-md ring-2 ring-white">
              {initials}
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-xs font-semibold truncate">{session.name}</div>
              <div className="text-[11px] text-muted-foreground truncate">{roleLabel}</div>
            </div>
          </div>
          {license.packageKey && (
            <div className="mt-2.5 flex items-center gap-1.5 px-1">
              <span className="chip bg-brand-navy-light text-brand-navy text-[10px] uppercase tracking-wide">
                {license.packageKey}
              </span>
              <span
                className={`chip text-[10px] chip-dot ${
                  license.status === "active"
                    ? "bg-emerald-50 text-emerald-700"
                    : license.status === "trial"
                    ? "bg-brand-cyan-light text-brand-cyan-deep"
                    : "bg-rose-50 text-rose-700"
                }`}
              >
                {license.status}
              </span>
            </div>
          )}
        </div>
      </aside>

      {/* ────────────────────────── Main ────────────────────────── */}
      <main className="flex-1 overflow-y-auto print:overflow-visible">
        {/* Topbar — glass, sticky; hidden when printing */}
        <div className="sticky top-0 z-20 border-b border-border/60 bg-background/80 backdrop-blur-xl backdrop-saturate-150 px-6 py-3 flex items-center justify-between gap-4 print:hidden">
          <div className="flex items-center gap-3 min-w-0">
            <div className="hidden md:flex flex-col">
              <span className="text-[11px] font-semibold text-foreground truncate max-w-[16rem]">
                {tenant?.legalName ?? "Acme Wealth"}
              </span>
              <span className="text-[10px] text-muted-foreground font-mono">
                {tenant?.arn ?? "—"}
              </span>
            </div>
            <span className="hidden md:block h-6 w-px bg-border" />
          </div>
          <GlobalSearch />
          <div className="flex items-center gap-3 text-sm">
            {license.status === "trial" && license.trialEndsAt && (
              <span className="chip bg-brand-cyan-light text-brand-cyan-deep font-semibold chip-dot">
                Trial ends{" "}
                {license.trialEndsAt.toLocaleDateString("en-IN", {
                  day: "numeric",
                  month: "short",
                })}
              </span>
            )}
            <Link
              href="/dashboard/help"
              className="size-9 rounded-full bg-secondary/70 hover:bg-secondary text-muted-foreground hover:text-foreground grid place-items-center transition-colors"
              aria-label="Help and glossary"
              title="Help & glossary — explanations for ARN, KYC, NAV and more"
            >
              <HelpCircle className="size-4" />
            </Link>
            <NotificationBell />
            <div className="size-9 rounded-full brand-gradient text-white grid place-items-center text-xs font-bold shadow-md ring-2 ring-white">
              {initials}
            </div>
          </div>
        </div>
        <div className="p-6 animate-fade-in print:p-0 print:animate-none">
          {license.isRestricted && !pathAllowed ? (
            <RestrictedNotice license={license} />
          ) : (
            <>
              {license.isRestricted && pathAllowed && <RestrictedBanner license={license} />}
              {children}
            </>
          )}
        </div>
      </main>
      {/* Floating quick-create button — bottom-right. Lets users add a lead,
          client, task, meeting, proposal or service request from anywhere
          without hunting through the sidebar. */}
      {!license.isRestricted && <QuickCreateFab />}
    </div>
  );
}

function RestrictedBanner({ license }: { license: any }) {
  return (
    <div className="mb-6 rounded-xl border border-amber-200 bg-gradient-to-r from-amber-50 to-amber-50/60 p-3.5 flex items-center gap-3 text-sm shadow-sm">
      <div className="size-9 rounded-lg bg-amber-100 grid place-items-center flex-shrink-0">
        <AlertTriangle className="size-4 text-amber-700" />
      </div>
      <div className="flex-1">
        <span className="font-semibold text-amber-900">
          Your license is {license.status}.
        </span>{" "}
        <span className="text-amber-800/80">
          You can still access billing and support to renew. Other modules are paused.
        </span>
      </div>
      <Link href="/dashboard/billing" className="btn-accent text-xs whitespace-nowrap">
        Renew now
      </Link>
    </div>
  );
}

function RestrictedNotice({ license }: { license: any }) {
  return (
    <div className="max-w-2xl mx-auto mt-12 card-elevated p-10 text-center brand-soft">
      <div className="size-16 mx-auto rounded-2xl bg-amber-100 grid place-items-center shadow-md">
        <AlertTriangle className="size-8 text-amber-600" />
      </div>
      <h1 className="text-2xl font-bold mt-5 tracking-tight">
        Your license is {license.status}
      </h1>
      <p className="text-muted-foreground mt-2 max-w-md mx-auto">
        {license.reason ?? "Your subscription needs attention before you can continue using the app."}
      </p>
      <div className="mt-6 space-y-2 text-sm text-left bg-secondary/60 rounded-xl p-4 border border-border/60">
        <Row label="Package" value={license.packageKey ?? "—"} />
        <Row label="Status" value={license.status} />
        <Row label="License end" value={license.licenseEndAt?.toLocaleDateString("en-IN") ?? "—"} />
      </div>
      <div className="mt-6 flex gap-2 justify-center">
        <Link href="/dashboard/billing" className="btn-primary">
          Renew subscription
        </Link>
        <Link href="/dashboard/support" className="btn-secondary">
          Contact support
        </Link>
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium">{value}</span>
    </div>
  );
}
