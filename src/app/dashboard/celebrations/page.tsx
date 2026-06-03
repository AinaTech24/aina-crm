import Link from "next/link";
import { sql } from "drizzle-orm";
import { Cake, Gift, PartyPopper, CalendarHeart } from "lucide-react";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { can } from "@/lib/auth/rbac";
import { ContactQuickActions } from "@/components/common/ContactQuickActions";

export const dynamic = "force-dynamic";

type Row = {
  id: string;
  name: string;
  phone: string | null;
  whatsapp_phone: string | null;
  email: string | null;
  md: string; // MM-DD
  years: number | null;
  bucket: "today" | "upcoming" | "recent";
};

function firstName(n: string) {
  return (n ?? "").trim().split(/\s+/)[0] || n;
}

export default async function CelebrationsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const session = await requireSession();
  const firmWide = can(session.roles, "dashboard.view.owner", (session as any).permissions);
  const sp = await searchParams;
  const tab = sp.tab === "anniversary" ? "anniversary" : "birthday";

  const data = await withTenant(
    session.tenantId,
    async (tx) => {
      const ownScope = firmWide ? sql`` : sql` AND i.rm_id = ${session.userId}::uuid`;
      const dateCol = tab === "anniversary" ? sql`i.onboarded_at` : sql`i.dob`;

      const rows = await tx.execute(sql`
        WITH w AS (
          SELECT to_char(current_date, 'MM-DD') AS today_md,
                 array(SELECT to_char(current_date + g, 'MM-DD') FROM generate_series(1, 7) g) AS up_md,
                 array(SELECT to_char(current_date - g, 'MM-DD') FROM generate_series(1, 7) g) AS past_md
        )
        SELECT i.id, i.name, i.phone, i.whatsapp_phone, i.email,
               to_char(${dateCol}, 'MM-DD') AS md,
               (EXTRACT(YEAR FROM current_date) - EXTRACT(YEAR FROM ${dateCol}))::int AS years,
               CASE
                 WHEN to_char(${dateCol}, 'MM-DD') = w.today_md THEN 'today'
                 WHEN to_char(${dateCol}, 'MM-DD') = ANY(w.up_md) THEN 'upcoming'
                 ELSE 'recent'
               END AS bucket
        FROM investors i, w
        WHERE i.status = 'active'
          AND ${dateCol} IS NOT NULL
          AND (
            to_char(${dateCol}, 'MM-DD') = w.today_md
            OR to_char(${dateCol}, 'MM-DD') = ANY(w.up_md)
            OR to_char(${dateCol}, 'MM-DD') = ANY(w.past_md)
          )
          ${ownScope}
        ORDER BY
          CASE
            WHEN to_char(${dateCol}, 'MM-DD') = w.today_md THEN 0
            WHEN to_char(${dateCol}, 'MM-DD') = ANY(w.up_md) THEN 1
            ELSE 2
          END,
          to_char(${dateCol}, 'MM-DD')
        LIMIT 400
      `);
      return rows.rows as Row[];
    },
    { userId: session.userId, branchId: session.branchId, roles: session.roles }
  );

  const today = data.filter((r) => r.bucket === "today");
  const upcoming = data.filter((r) => r.bucket === "upcoming");
  const recent = data.filter((r) => r.bucket === "recent");
  const isAnniv = tab === "anniversary";
  const noun = isAnniv ? "anniversary" : "birthday";

  function wish(r: Row) {
    if (isAnniv) return `Dear ${firstName(r.name)}, wishing you a very happy investment anniversary with us! Thank you for your continued trust. 🎉`;
    return `Dear ${firstName(r.name)}, wishing you a very Happy Birthday! 🎂 May the year ahead bring you health, happiness, and prosperity.`;
  }

  return (
    <div className="space-y-6 max-w-5xl">
      <div>
        <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2"><Cake className="size-6 text-brand-cyan" /> Celebrations</h1>
        <p className="text-muted-foreground text-sm">Never miss a client {noun} again. Wish them in one tap — WhatsApp, SMS, or email. {!firmWide && "Showing your book."}</p>
      </div>

      <div className="flex gap-2">
        <TabLink active={tab === "birthday"} href="/dashboard/celebrations?tab=birthday" icon={Cake} label="Birthdays" />
        <TabLink active={tab === "anniversary"} href="/dashboard/celebrations?tab=anniversary" icon={CalendarHeart} label="Client anniversaries" />
      </div>

      <Section title="Today" icon={PartyPopper} tone="emerald" rows={today} noun={noun} isAnniv={isAnniv} wish={wish} empty={`No ${noun}s today.`} highlight />
      <Section title="Next 7 days" icon={Gift} tone="amber" rows={upcoming} noun={noun} isAnniv={isAnniv} wish={wish} empty={`Nothing in the next week.`} />
      <Section title="Last 7 days (catch-up)" icon={Cake} tone="slate" rows={recent} noun={noun} isAnniv={isAnniv} wish={wish} empty={`Nothing missed recently.`} />
    </div>
  );
}

function Section({
  title, icon: Icon, tone, rows, noun, isAnniv, wish, empty, highlight,
}: {
  title: string; icon: any; tone: "emerald" | "amber" | "slate"; rows: Row[]; noun: string;
  isAnniv: boolean; wish: (r: Row) => string; empty: string; highlight?: boolean;
}) {
  const toneCls = tone === "emerald" ? "text-emerald-600" : tone === "amber" ? "text-amber-600" : "text-slate-500";
  return (
    <div className={`card-surface ${highlight && rows.length ? "ring-1 ring-emerald-200" : ""}`}>
      <div className="px-4 py-3 border-b flex items-center justify-between">
        <div className="font-semibold flex items-center gap-2"><Icon className={`size-4 ${toneCls}`} /> {title}</div>
        <span className="text-xs text-muted-foreground">{rows.length}</span>
      </div>
      {rows.length === 0 ? (
        <div className="p-6 text-center text-sm text-muted-foreground">{empty}</div>
      ) : (
        <ul className="divide-y">
          {rows.map((r) => {
            const [mm, dd] = r.md.split("-");
            const turning = r.years && r.years > 0 && r.years < 130 ? r.years : null;
            return (
              <li key={r.id} className="flex items-center gap-3 px-4 py-2.5 hover:bg-secondary/40">
                <div className="size-9 rounded-full brand-gradient text-white grid place-items-center text-xs font-bold shrink-0">
                  {r.name.split(" ").map((n) => n[0]).slice(0, 2).join("").toUpperCase()}
                </div>
                <div className="min-w-0 flex-1">
                  <Link href={`/dashboard/investors/${r.id}`} className="font-medium text-sm hover:underline truncate block">{r.name}</Link>
                  <div className="text-[11px] text-muted-foreground">
                    {dd}/{mm}
                    {turning != null ? (isAnniv ? ` · ${turning} yr${turning === 1 ? "" : "s"} with us` : ` · turning ${turning}`) : ""}
                  </div>
                </div>
                <ContactQuickActions
                  phone={r.whatsapp_phone || r.phone}
                  email={r.email}
                  message={wish(r)}
                  subject={isAnniv ? "Happy anniversary!" : "Happy Birthday!"}
                  size={16}
                />
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function TabLink({ active, href, icon: Icon, label }: { active: boolean; href: string; icon: any; label: string }) {
  return (
    <Link href={href} className={`px-3 py-1.5 rounded-md text-sm font-medium border inline-flex items-center gap-1.5 ${active ? "bg-brand-cyan text-white border-brand-cyan" : "border-border text-muted-foreground hover:bg-secondary"}`}>
      <Icon className="size-4" /> {label}
    </Link>
  );
}
