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
  CalendarOff,
  CalendarCheck,
  BarChart3,
  FolderArchive,
  Scale,
  Lock,
  Bot,
  CreditCard,
  AlertTriangle,
  HelpCircle,
  BookOpen,
  Briefcase,
  Boxes,
  Cake,
  PhoneCall,
  Copy,
  PieChart,
  Radio,
  Columns3,
  Calculator,
  Wallet,
  Server,
  Inbox,
  Activity,
  Users2,
} from "lucide-react";
import { eq } from "drizzle-orm";
import { withTenant } from "@/db/client";
import { tenants, users } from "@/db/schema";
import { requireSession } from "@/lib/auth/session";
import { primaryRoleLabel } from "@/lib/auth/rbac";
import { loadTenantLicense, isPathAllowedWhenRestricted } from "@/lib/auth/license";
import { tenantAccessibleNavKeys, isGatableNav, gatedNavKeyForPath } from "@/config/nav-access";
import { pickLogo } from "@/lib/branding/logo";
import type { Metadata } from "next";
import { GlobalSearch } from "@/components/layout/GlobalSearch";
import { NotificationBell } from "@/components/layout/NotificationBell";
import { BirthdayBell } from "@/components/layout/BirthdayBell";
import { SidebarNavLink } from "@/components/layout/SidebarNavLink";
import { QuickCreateFab } from "@/components/layout/QuickCreateFab";
import { MobileNav } from "@/components/layout/MobileNav";
import { ProfileMenu } from "@/components/layout/ProfileMenu";
import { ToastProvider } from "@/components/ui/Toast";
import { buildTenantThemeCss } from "@/lib/branding/theme";

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
      { href: "/dashboard/command-center", label: "Command Center", icon: Inbox,
        roles: ["owner", "rm", "branch_head", "back_office", "ops", "compliance"] },
      { href: "/dashboard/next-best-action", label: "Next Best Action", icon: Sparkles,
        roles: ["owner", "rm", "branch_head", "back_office", "ops"] },
      { href: "/dashboard/signals", label: "Sales Signals", icon: Radio,
        roles: ["owner", "rm", "branch_head", "back_office", "ops"] },
      { href: "/dashboard/tasks", label: "Tasks", icon: ListChecks, module: "tasks" },
      { href: "/dashboard/review-meetings", label: "Meetings", icon: Calendar, module: "review_meetings",
        roles: ["owner", "rm", "branch_head", "back_office", "ops"] },
      { href: "/dashboard/calendar", label: "Calendar", icon: Calendar },
      { href: "/dashboard/attendance", label: "Attendance", icon: CalendarCheck },
      { href: "/dashboard/team", label: "Team Dashboard", icon: Users2,
        roles: ["owner", "branch_head"] },
    ],
  },
  {
    title: "CRM",
    items: [
      // Leads visible to owner, marketing, rm, branch_head
      { href: "/dashboard/pipeline-board", label: "Pipeline Board", icon: Columns3, module: "lead_management",
        roles: ["owner", "rm", "branch_head", "back_office", "ops"] },
      { href: "/dashboard/leads", label: "Leads", icon: Sparkles, module: "lead_management",
        roles: ["owner", "marketing", "rm", "branch_head", "back_office", "ops", "compliance"] },
      // Investor data hidden from marketing per spec section 3
      { href: "/dashboard/investors", label: "Clients", icon: Users, module: "client_master",
        roles: ["owner", "rm", "branch_head", "back_office", "ops", "compliance"] },
      { href: "/dashboard/families", label: "Family Mapping", icon: HeartHandshake, module: "family_mapping",
        roles: ["owner", "rm", "branch_head", "back_office", "ops", "compliance"] },
      // Client Onboarding module retired — its 11-stage pipeline is now
      // covered by the unified 30-stage blueprint engine that owns both
      // Leads (1-10) and Clients (11-30). Page redirects to /dashboard/leads.
      { href: "/dashboard/risk-profiles", label: "Risk Profile", icon: ShieldCheck, module: "risk_profile",
        roles: ["owner", "compliance", "back_office", "ops", "rm"] },
      { href: "/dashboard/calculators", label: "Calculators", icon: Calculator },
      { href: "/dashboard/goals", label: "Goal Planning", icon: Target, module: "goal_planning",
        roles: ["owner", "rm", "branch_head", "back_office", "ops"] },
      { href: "/dashboard/proposals", label: "Proposals", icon: FileSignature, module: "proposals",
        roles: ["owner", "rm", "branch_head", "back_office", "ops", "compliance"] },
      { href: "/dashboard/financial-plans", label: "Financial Plans", icon: ScrollText, module: "goal_planning",
        roles: ["owner", "rm", "branch_head", "back_office", "ops", "compliance"] },
      { href: "/dashboard/insurance", label: "Insurance Policies", icon: Shield, module: "insurance",
        roles: ["owner", "rm", "branch_head", "back_office", "ops", "compliance"] },
      { href: "/dashboard/insurance-claims", label: "Insurance Claims", icon: FileText, module: "insurance",
        roles: ["owner", "rm", "branch_head", "back_office", "ops", "compliance"] },
      { href: "/dashboard/insurance/renewals", label: "Insurance Renewals", icon: CalendarCheck, module: "insurance",
        roles: ["owner", "rm", "branch_head", "back_office", "ops"] },
      { href: "/dashboard/insurance/protection-gap", label: "Protection-Gap Radar", icon: Shield, module: "insurance",
        roles: ["owner", "rm", "branch_head", "back_office", "ops"] },
      { href: "/dashboard/insurance/commission", label: "Insurance Commission", icon: CreditCard, module: "insurance",
        roles: ["owner", "branch_head", "back_office"] },
      { href: "/dashboard/celebrations", label: "Celebrations", icon: Cake,
        roles: ["owner", "rm", "branch_head", "back_office", "ops"] },

    ],
  },
  {
    title: "Operations",
    items: [
      // Transactions hidden from marketing
      { href: "/dashboard/transactions", label: "MF Transactions", icon: Repeat, module: "transactions",
        roles: ["owner", "back_office", "ops", "rm", "branch_head", "compliance"] },
      { href: "/dashboard/mf-schemes", label: "MF Scheme Catalog", icon: BookOpen },
      { href: "/dashboard/business-entries", label: "Business Entries", icon: Briefcase,
        roles: ["owner", "branch_head", "rm", "back_office", "ops"] },
      { href: "/dashboard/rta-imports", label: "RTA File Imports", icon: FolderArchive, module: "transactions",
        roles: ["owner", "back_office", "ops", "compliance"] },
      { href: "/dashboard/reconciliation", label: "Reconciliation", icon: Scale, module: "transactions",
        roles: ["owner", "back_office", "ops", "compliance"] },
      { href: "/dashboard/sips", label: "SIP Tracker", icon: TrendingUp, module: "sip_tracker",
        roles: ["owner", "back_office", "ops", "rm", "branch_head", "compliance"] },
      { href: "/dashboard/sip-rejections", label: "SIP Rejections", icon: XOctagon, module: "sip_rejection",
        roles: ["owner", "back_office", "ops", "rm", "branch_head"] },
      { href: "/dashboard/sips/at-risk", label: "SIP At-Risk", icon: AlertTriangle, module: "sip_tracker",
        roles: ["owner", "back_office", "ops", "rm", "branch_head"] },
      { href: "/dashboard/activities", label: "Activity Log", icon: PhoneCall,
        roles: ["owner", "rm", "branch_head", "back_office", "ops", "compliance"] },
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
      { href: "/dashboard/sales-ops", label: "Sales-Ops Rules", icon: GitBranch, roles: ["owner", "branch_head", "compliance"] },
      { href: "/dashboard/workflows", label: "Workflows (advanced)", icon: GitBranch, module: "automation_workflows" },
      { href: "/dashboard/workflows/runs", label: "Automation Monitor", icon: Activity, module: "automation_workflows",
        roles: ["owner", "compliance", "back_office", "ops"] },
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
      { href: "/dashboard/compliance/command-center", label: "Compliance Center", icon: ShieldCheck, roles: ["owner", "compliance", "branch_head"] },
      { href: "/dashboard/compliance", label: "DDQ Readiness", icon: ShieldCheck, module: "ddq", roles: ["owner", "compliance"] },
      { href: "/dashboard/compliance/amfi-circulars", label: "Circular Digest", icon: ScrollText, roles: ["owner", "compliance", "back_office", "ops", "rm", "branch_head"] },
      { href: "/dashboard/reports/nomination-tracker", label: "Nomination Tracker", icon: ShieldCheck, roles: ["owner", "compliance", "branch_head", "back_office"] },
      { href: "/dashboard/documents", label: "Documents", icon: FolderArchive, module: "documents" },
      { href: "/dashboard/sops", label: "SOP Library", icon: ScrollText, roles: ["owner", "compliance"] },
      { href: "/dashboard/announcements", label: "Announcements", icon: Megaphone },
      { href: "/dashboard/duplicates", label: "Find Duplicates", icon: Copy, roles: ["owner", "branch_head"] },
      { href: "/dashboard/employees", label: "Employees", icon: UserCog, module: "employees", roles: ["owner", "branch_head"] },
      { href: "/dashboard/leave-applications", label: "Leave Applications", icon: CalendarOff },
      { href: "/dashboard/sub-distributors", label: "Sub-Distributors", icon: HeartHandshake, roles: ["owner", "compliance"] },
      { href: "/dashboard/legal-registrations", label: "Legal Registrations", icon: ScrollText, roles: ["owner", "compliance"] },
      { href: "/dashboard/amc-empanelments", label: "AMC Empanelments", icon: Briefcase, roles: ["owner", "compliance", "back_office"] },
      { href: "/dashboard/schemes", label: "Scheme Master", icon: Boxes, roles: ["owner", "compliance", "back_office", "branch_head", "rm"] },
      { href: "/dashboard/product-offerings", label: "Products & Services", icon: Megaphone, roles: ["owner", "compliance"] },
      { href: "/dashboard/cybersecurity", label: "Cybersecurity", icon: Lock, module: "cybersecurity", roles: ["owner", "compliance"] },
    ],
  },
  // NB: Billing / Firm Profile / Settings and the Help link intentionally do
  // NOT appear in the sidebar — Billing + Settings + Firm profile live in the
  // profile dropdown; the help shortcut is the "?" icon in the top bar.
  {
    title: "Insights",
    items: [
      { href: "/dashboard/reports", label: "Reports & MIS", icon: BarChart3, module: "reports", roles: ["owner", "branch_head", "compliance"] },
      { href: "/dashboard/reports/trail-forecast", label: "Trail Forecast", icon: TrendingUp, roles: ["owner", "branch_head", "compliance"] },
      { href: "/dashboard/portfolio-intelligence", label: "Portfolio Intelligence", icon: PieChart, roles: ["owner", "branch_head", "compliance", "rm", "back_office", "ops"] },
      { href: "/dashboard/reports/churn-risk", label: "Churn-risk Radar", icon: AlertTriangle, roles: ["owner", "branch_head", "compliance", "rm", "back_office", "ops"] },
      { href: "/dashboard/reports/tax-harvesting", label: "Tax-Harvesting", icon: TrendingUp, roles: ["owner", "branch_head", "compliance", "rm", "back_office", "ops"] },
      { href: "/dashboard/reports/cross-sell", label: "Cross-sell Radar", icon: TrendingUp, roles: ["owner", "branch_head", "compliance", "rm", "back_office", "ops"] },
      { href: "/dashboard/commission-reconciliation", label: "Commission Reconciliation", icon: CreditCard, module: "reports", roles: ["owner", "compliance", "back_office"] },
      { href: "/dashboard/finances", label: "Practice Finances", icon: Wallet, module: "reports", roles: ["owner", "compliance", "back_office"] },
      { href: "/dashboard/ai-assistant", label: "AI Assistant", icon: Bot, module: "ai_assistant" },
      { href: "/dashboard/audit-log", label: "Audit Log", icon: ClipboardCheck, module: "audit_log", roles: ["owner", "compliance"] },
    ],
  },
];

function NavBlockedNotice() {
  return (
    <div className="max-w-lg mx-auto mt-12 card-elevated p-10 text-center">
      <div className="size-16 mx-auto rounded-2xl bg-amber-100 grid place-items-center shadow-md">
        <Lock className="size-8 text-amber-600" />
      </div>
      <h1 className="text-2xl font-bold mt-5 tracking-tight">Section not available</h1>
      <p className="text-muted-foreground mt-2 text-sm leading-relaxed">
        This module isn&apos;t enabled for your account. Ask your firm owner (or AINA) to grant access.
      </p>
      <Link href="/dashboard" className="btn-primary mt-6 inline-flex">
        Back to dashboard
      </Link>
    </div>
  );
}

export async function generateMetadata(): Promise<Metadata> {
  // Per-tenant favicon + browser-tab title. Wrapped in try/catch so a metadata
  // hiccup (e.g. no session) never takes down the dashboard render.
  try {
    const session = await requireSession();
    const branding = await withTenant(session.tenantId, async (tx) => {
      const [t] = await tx
        .select({
          displayName: tenants.displayName,
          logoUrl: tenants.logoUrl,
          logoIconUrl: tenants.logoIconUrl,
          logoMarkUrl: tenants.logoMarkUrl,
          faviconUrl: tenants.faviconUrl,
        })
        .from(tenants)
        .where(eq(tenants.id, session.tenantId))
        .limit(1);
      return t;
    });
    const icon = pickLogo(branding, "favicon");
    return {
      title: branding?.displayName ? `${branding.displayName} — CRM` : undefined,
      icons: icon ? { icon } : undefined,
    };
  } catch {
    return {};
  }
}

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const session = await requireSession();
  const license = await loadTenantLicense(session.tenantId, session.roles);
  // Admin → MFD sidebar access: the exact set of nav hrefs the firm can open
  // (the platform admin's explicit grant, else the package-module default).
  const tenantAllowedSet = new Set(
    tenantAccessibleNavKeys({ allowedNav: license.allowedNav, enabledModules: license.enabledModules })
  );

  // Read the current path from the middleware-set header so we can carve out
  // billing + support pages while the rest of the dashboard is restricted.
  const reqHeaders = await headers();
  const pathname = reqHeaders.get("x-pathname") ?? "";
  const pathAllowed = isPathAllowedWhenRestricted(pathname);

  const { tenant, userModules, avatarUrl } = await withTenant(session.tenantId, async (tx) => {
    const [t] = await tx.select().from(tenants).where(eq(tenants.id, session.tenantId)).limit(1);
    // Per-user sidebar module grant (Module-19). null = inherit all tenant modules.
    const [u] = await tx
      .select({ enabledModules: users.enabledModules, avatarUrl: users.avatarUrl })
      .from(users)
      .where(eq(users.id, session.userId))
      .limit(1);
    return {
      tenant: t,
      userModules: (u?.enabledModules as string[] | null) ?? null,
      avatarUrl: (u?.avatarUrl as string | null) ?? null,
    };
  });

  // Sidebar badge uses the square icon variant, falling back to monogram → full
  // logo so a firm that only uploaded a wide logo still gets a sensible badge.
  const sidebarLogo = pickLogo(tenant, "icon");

  // MFD → team sidebar gate. Owners always see the full firm set; everyone else
  // is limited to the items the owner granted them (a subset of the firm's).
  const isOwnerUser = session.roles.includes("owner");

  // Enforce nav/module access SERVER-SIDE, not just by hiding the sidebar item:
  // if the requested page belongs to a module the firm (or this team member)
  // wasn't granted, block the render. (Audit: UI-only gating was bypassable by
  // typing the URL directly.)
  const gatedKey = gatedNavKeyForPath(pathname);
  const navBlocked =
    gatedKey !== null &&
    (!tenantAllowedSet.has(gatedKey) ||
      (!isOwnerUser && userModules !== null && !userModules.includes(gatedKey)));

  // Per-tenant white-label theme: override the brand CSS variables from the
  // firm's chosen primary/accent colours (Settings → Appearance). Empty string
  // when the tenant uses the stock AINA palette, so we inject nothing.
  const themeCss = buildTenantThemeCss(
    tenant?.primaryColor,
    (tenant as any)?.secondaryColor
  );

  const visible = NAV.map((section) => ({
    ...section,
    items: section.items.filter((i) => {
      if (i.roles && !session.roles.some((r) => i.roles!.includes(r) || r === "owner")) return false;
      if (isGatableNav(i.href)) {
        // Admin → MFD: the firm must have access to this sidebar item.
        if (!tenantAllowedSet.has(i.href)) return false;
        // MFD → team: owners see all; others limited to their granted items.
        if (!isOwnerUser && userModules && !userModules.includes(i.href)) return false;
      }
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

  // Sidebar inner content — brand header + nav + user card. Rendered in BOTH
  // the desktop aside and the mobile drawer (MobileNav), so the navigation has
  // a single source of truth and never drifts between the two.
  const sidebarInner = (
    <>
        {/* Brand header — gradient mesh + logo */}
        <div className="relative overflow-hidden border-b border-white/10">
          <div className="absolute inset-0 brand-mesh opacity-95" />
          {/* faint cyan glow accent in the corner for depth */}
          <div className="absolute -top-8 -right-8 size-24 rounded-full bg-brand-cyan/20 blur-2xl" />
          <div className="relative px-5 h-16 flex items-center gap-3">
            {tenant ? (
              <>
                {sidebarLogo ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={sidebarLogo}
                    alt="logo"
                    className="size-10 rounded-xl shadow-lg ring-2 ring-white/20 object-cover"
                  />
                ) : (
                  <div
                    className="size-10 rounded-xl bg-white/95 text-brand-navy grid place-items-center text-lg font-extrabold shadow-lg ring-2 ring-white/20"
                    style={tenant.primaryColor ? { color: tenant.primaryColor } : {}}
                  >
                    {(tenant.displayName ?? "A").charAt(0).toUpperCase()}
                  </div>
                )}
                <div className="min-w-0 text-white">
                  <div className="font-semibold tracking-tight truncate text-sm leading-tight">
                    {tenant.displayName ?? "Aina CRM"}
                  </div>
                  <div className="mt-0.5 inline-flex items-center gap-1 text-[10px] text-white/75 font-mono">
                    <span className="size-1.5 rounded-full bg-brand-cyan shadow-[0_0_6px_hsl(var(--brand-cyan))]" />
                    <span className="truncate">{tenant.arn ?? "—"}</span>
                  </div>
                </div>
              </>
            ) : (
              // No tenant context → product default: the Aina wordmark on a white card.
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src="/aina-wordmark.png"
                alt="Aina CRM"
                className="h-8 w-auto rounded-md bg-white px-2.5 py-1.5 shadow-lg ring-1 ring-white/15"
              />
            )}
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

    </>
  );

  return (
    <ToastProvider>
      {/* Per-tenant theme override — re-declares the brand CSS variables on
          :root. Rendered after globals.css in document order, so it wins. */}
      {themeCss && (
        <style id="tenant-theme" dangerouslySetInnerHTML={{ __html: themeCss }} />
      )}
    {/* h-screen + overflow-hidden on the outer wrapper means the page itself
        never scrolls — the sidebar and the main pane each get their own
        scrollbar from the `overflow-y-auto` they already declare. Print mode
        reverts to block flow so the whole document prints in one stream. */}
    <div className="h-screen flex bg-background overflow-hidden print:block print:h-auto print:overflow-visible">
      {/* ───────────── Desktop sidebar (hidden below lg — mobile uses drawer) ───────────── */}
      <aside className="hidden lg:flex w-64 flex-shrink-0 h-full flex-col bg-card border-r border-border/70 shadow-sm print:hidden">
        {sidebarInner}
      </aside>

      {/* ────────────────────────── Main ────────────────────────── */}
      {/* h-full + overflow-y-auto = independent scroll, sticky topbar stays
          pinned inside this pane (not at viewport top). */}
      <main className="flex-1 h-full overflow-y-auto print:overflow-visible print:h-auto">
        {/* Topbar — glass, sticky; hidden when printing */}
        <div className="sticky top-0 z-20 border-b border-border/60 bg-background/80 backdrop-blur-xl backdrop-saturate-150 px-6 h-16 flex items-center justify-between gap-4 print:hidden">
          <div className="flex items-center gap-3 min-w-0">
            {/* Mobile hamburger — opens the nav drawer (shares sidebarInner).
                Firm name + ARN live in the sidebar header only (no duplication). */}
            <MobileNav>{sidebarInner}</MobileNav>
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
            <BirthdayBell />
            <NotificationBell />
            <span className="h-6 w-px bg-border mx-0.5" />
            <ProfileMenu
              name={session.name}
              email={session.email}
              roleLabel={roleLabel}
              initials={initials}
              avatarUrl={avatarUrl}
              packageKey={license.packageKey}
              licenseStatus={license.status}
            />
          </div>
        </div>
        <div className="p-6 animate-fade-in print:p-0 print:animate-none">
          {license.isRestricted && !pathAllowed ? (
            <RestrictedNotice license={license} />
          ) : navBlocked ? (
            <NavBlockedNotice />
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
    </ToastProvider>
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
