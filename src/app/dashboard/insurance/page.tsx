import { PageHeaderCard } from "@/components/layout/PageHeaderCard";
import Link from "next/link";
import { sql } from "drizzle-orm";
import {
  Plus,
  Shield,
  Heart,
  Car,
  Plane,
  Home,
  Activity,
  AlertTriangle,
  IndianRupee,
  FileUp,
  CalendarClock,
} from "lucide-react";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { require as requireCap } from "@/lib/auth/rbac";
import { formatDate, formatINR } from "@/lib/utils";
import { RowActions } from "@/components/common/RowActions";
import { CompactFilterBar } from "@/components/common/CompactFilterBar";
import { CustomViews } from "@/components/common/CustomViews";
import { Avatar } from "@/components/ui/Avatar";
import { Pager } from "@/components/common/Pager";
import { StatusChips, type StatusChip as FilterChip } from "@/components/common/StatusChips";
import { StatusChip, type Tone } from "@/components/common/StatusChip";
import { ModuleTabs, INSURANCE_TABS } from "@/components/common/ModuleTabs";
import { dateRangeCond, dateRangeFilter } from "@/lib/filters/date-range";
import {
  branchSql, bookedOnSql, inList, natureSql, ownerSql, POLICY_TYPE_LABEL, PRODUCT_GROUPS, STATUS_IN_FORCE, typesOfGroups, typesOfLine,
  STATUS_ISSUED_EXCLUDED, type Line,
} from "@/lib/insurance/book";
import { seesWholeInsuranceBook } from "@/lib/dashboard/insurance/access";
import { uuidList } from "@/lib/metrics";

// The policy form's labels, commercial lines included (lib/insurance/book.ts).
const TYPE_LABEL: Record<string, string> = POLICY_TYPE_LABEL;
const ISO = /^\d{4}-\d{2}-\d{2}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ISSUED_STATUSES = ["active", "lapsed", "matured", "surrendered", "claim_filed", "claim_settled"];
const GAP_LABEL: Record<string, string> = {
  cat: "client category missing", due: "renewal date missing", type: "policy type not recognised", insurer: "insurer missing",
  premium: "premium missing", number: "policy number missing", owner: "owner missing", branch: "branch missing", contact: "client contact missing",
};

/** "renewal due 1 Oct 2026 – 7 Oct 2026", "… on or before 28 Sept 2026", "… from 1 Oct 2026". */
function dateSpan(what: string, from: string | null, to: string | null): string | null {
  if (from && to) return from === to ? `${what} ${formatDate(from)}` : `${what} ${formatDate(from)} – ${formatDate(to)}`;
  if (to) return `${what} on or before ${formatDate(to)}`;
  if (from) return `${what} from ${formatDate(from)}`;
  return null;
}

const TYPE_ICON: Record<string, any> = {
  term: Shield,
  ulip: Activity,
  endowment: Activity,
  money_back: Activity,
  health: Heart,
  critical_illness: Heart,
  personal_accident: Heart,
  motor: Car,
  travel: Plane,
  home: Home,
  life_other: Shield,
  general_other: Shield,
};

const STATUS_TONE: Record<string, Tone> = {
  proposed: "info",
  in_underwriting: "warning",
  active: "success",
  lapsed: "danger",
  matured: "neutral",
  surrendered: "neutral",
  cancelled: "neutral",
  claim_filed: "warning",
  claim_settled: "info",
};

export const dynamic = "force-dynamic";

export default async function InsurancePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const session = await requireSession();
  // Policies carry nominee PII, client PAN, premium + commission — require the
  // view capability (the page had NO gate) and scope non-managers to their own
  // book (a client they manage OR a policy they sold).
  requireCap(session.roles, "insurance.view", session.permissions);
  // The insurance register's "manager" — plus insurance.view.all, the Insurance
  // Head's grant, so the command centre's drill-downs open onto the same rows.
  const seesAll = seesWholeInsuranceBook(session);
  const sp = await searchParams;
  const q = (sp.q ?? "").trim();
  const typeFilter = (sp.type ?? "").split(",").filter(Boolean);
  // "issued" is the command centre's set: not proposed / in underwriting / cancelled.
  const statusFilter = [...new Set((sp.status ?? "").split(",").filter(Boolean).flatMap((v) => (v === "issued" ? ISSUED_STATUSES : [v])))];
  // Drill-down params from the Insurance Business Command Centre — the same
  // definitions (lib/insurance/book.ts), so the rows are the tile's rows.
  const cc = {
    line: (sp.line === "personal" || sp.line === "commercial" ? sp.line : null) as Line | null,
    groups: (sp.grp ?? "").split(",").filter((g) => PRODUCT_GROUPS.some((x) => x.key === g)),
    nature: sp.nature === "new" || sp.nature === "renewal" ? sp.nature : null,
    // branch / owner — one id or several, comma-separated: the system
    // dashboard's links send its whole RM / branch filter (lib/metrics
    // policyWhere reads a list).
    branch: (sp.branch ?? "").split(",").filter((v) => UUID.test(v)),
    owner: (sp.owner ?? "").split(",").filter((v) => UUID.test(v)),
    insurer: (sp.insurer ?? "").trim().slice(0, 120) || null,
    cats: (sp.cat ?? "").split(",").filter((c) => ["A", "B", "C", "D", "none"].includes(c)),
    mf: sp.mf === "yes" || sp.mf === "no" ? sp.mf : null,
    bookedFrom: ISO.test(sp.booked_from ?? "") ? sp.booked_from! : null,
    bookedTo: ISO.test(sp.booked_to ?? "") ? sp.booked_to! : null,
    dueFrom: ISO.test(sp.due_from ?? "") ? sp.due_from! : null,
    dueTo: ISO.test(sp.due_to ?? "") ? sp.due_to! : null,
    gap: sp.gap && GAP_LABEL[sp.gap] ? sp.gap : null,
  };
  const ccActive = !!(cc.line || cc.groups.length || cc.nature || cc.branch.length || cc.owner.length || cc.insurer || cc.cats.length || cc.mf
    || cc.bookedFrom || cc.bookedTo || cc.dueFrom || cc.dueTo || cc.gap);
  const freqFilter = (sp.frequency ?? "").split(",").filter(Boolean);
  const dueSoonOnly = sp.due === "1";
  const PAGE_SIZE = 50;
  const page = Math.max(1, parseInt(sp.page ?? "1", 10) || 1);

  const data = await withTenant(session.tenantId, async (tx) => {
    // The firm's own policies (explicit tenant: a superuser connection bypasses
    // RLS), never one of a client in the Trash — lib/metrics policyWhere, so
    // the register holds the policies every dashboard count is taken over.
    const filters: any[] = [sql`p.tenant_id = ${session.tenantId}::uuid`, sql`(i.id IS NULL OR i.deleted_at IS NULL)`];
    // Owner slice for non-managers. The joined queries (rows/count) reference
    // the investor alias `i`; the bare aggregates (stats/statusCounts) use a
    // sub-select on investor_id.
    if (!seesAll) filters.push(sql`(p.sold_by_user_id = ${session.userId}::uuid OR i.rm_id = ${session.userId}::uuid)`);
    // The same book for the headline stats and the status chips, so "All" is
    // the unfiltered list's row count.
    const bareScope = sql` WHERE tenant_id = ${session.tenantId}::uuid
        AND investor_id NOT IN (SELECT id FROM investors WHERE tenant_id = ${session.tenantId}::uuid AND deleted_at IS NOT NULL)${
          seesAll
            ? sql``
            : sql` AND (sold_by_user_id = ${session.userId}::uuid OR investor_id IN (SELECT id FROM investors WHERE rm_id = ${session.userId}::uuid))`
        }`;
    if (q) {
      filters.push(
        sql`(p.policy_number ILIKE ${`%${q}%`} OR p.plan_name ILIKE ${`%${q}%`} OR p.insurer ILIKE ${`%${q}%`} OR i.name ILIKE ${`%${q}%`}
             OR p.details->>'vehicleRegNo' ILIKE ${`%${q}%`})`
      );
    }
    if (typeFilter.length) {
      filters.push(
        sql`p.policy_type IN (${sql.join(typeFilter.map((v) => sql`${v}`), sql`, `)})`
      );
    }
    if (statusFilter.length) {
      filters.push(
        sql`p.status IN (${sql.join(statusFilter.map((v) => sql`${v}`), sql`, `)})`
      );
    }
    if (freqFilter.length) {
      filters.push(
        sql`p.premium_frequency IN (${sql.join(freqFilter.map((v) => sql`${v}`), sql`, `)})`
      );
    }
    if (dueSoonOnly) {
      filters.push(
        sql`(p.status = 'active' AND p.next_premium_due_date IS NOT NULL AND p.next_premium_due_date <= current_date + interval '30 days' AND p.next_premium_due_date >= current_date)`
      );
    }
    const dr = dateRangeCond(sp, "created", "p.created_at");
    if (dr) filters.push(dr);
    if (ccActive) {
      filters.push(sql`i.deleted_at IS NULL`);
      if (cc.line) filters.push(sql`p.policy_type IN (${inList(typesOfLine(cc.line))})`);
      if (cc.groups.length) filters.push(sql`p.policy_type IN (${inList(typesOfGroups(cc.groups))})`);
      if (cc.nature) filters.push(sql`${natureSql("p")} = ${cc.nature}`);
      // branch = the client's branch, else the one the policy was keyed in;
      // owner = the business owner (the seller when they sell, else the
      // client's RM) — lib/insurance/book.ts, as the dashboards attribute them.
      if (cc.branch.length) filters.push(sql`${branchSql("p", "i")} IN (${uuidList(cc.branch)})`);
      if (cc.owner.length) filters.push(sql`${ownerSql("p", "i", "su")} IN (${uuidList(cc.owner)})`);
      if (cc.insurer) filters.push(sql`lower(btrim(p.insurer)) = ${cc.insurer.toLowerCase()}`);
      if (cc.cats.length) {
        const letters = cc.cats.filter((c) => c !== "none");
        filters.push(sql`(${letters.length ? sql`upper(btrim(COALESCE(i.client_category, ''))) IN (${inList(letters)})` : sql`FALSE`}
                         ${cc.cats.includes("none") ? sql`OR COALESCE(btrim(i.client_category), '') = ''` : sql``})`);
      }
      if (cc.mf === "yes") filters.push(sql`COALESCE(i.aum, 0)::numeric > 0`);
      if (cc.mf === "no") filters.push(sql`COALESCE(i.aum, 0)::numeric = 0`);
      if (cc.bookedFrom) filters.push(sql`${bookedOnSql("p")} >= ${cc.bookedFrom}::date`);
      if (cc.bookedTo) filters.push(sql`${bookedOnSql("p")} <= ${cc.bookedTo}::date`);
      // Booked means issued: the Premium booked card counts only policies not
      // proposed, in underwriting or cancelled (lib/metrics/insurance.ts).
      if (cc.bookedFrom || cc.bookedTo) filters.push(sql`p.status NOT IN (${inList(STATUS_ISSUED_EXCLUDED)})`);
      // Renewals due are in-force policies (lib/metrics getRenewalsDue) unless
      // the link names its statuses, as the Insurance dashboard's do.
      if ((cc.dueFrom || cc.dueTo) && !statusFilter.length) filters.push(sql`p.status IN (${inList(STATUS_IN_FORCE)})`);
      if (cc.dueFrom || cc.dueTo) filters.push(sql`p.premium_frequency <> 'single' AND p.next_premium_due_date IS NOT NULL`);
      if (cc.dueFrom) filters.push(sql`p.next_premium_due_date >= ${cc.dueFrom}::date`);
      if (cc.dueTo) filters.push(sql`p.next_premium_due_date <= ${cc.dueTo}::date`);
      const inForce = sql`p.status IN (${inList(STATUS_IN_FORCE)})`;
      const known = PRODUCT_GROUPS.flatMap((g) => [...g.types]);
      switch (cc.gap) {
        case "cat": filters.push(sql`COALESCE(btrim(i.client_category), '') = ''`); break;
        case "due": filters.push(sql`${inForce} AND p.premium_frequency <> 'single' AND p.next_premium_due_date IS NULL`); break;
        case "type": filters.push(sql`(p.policy_type IS NULL OR p.policy_type NOT IN (${inList(known)}))`); break;
        case "insurer": filters.push(sql`NULLIF(btrim(p.insurer), '') IS NULL`); break;
        case "premium": filters.push(sql`(p.annual_premium IS NULL OR p.annual_premium = 0)`); break;
        case "number": filters.push(sql`${inForce} AND NULLIF(btrim(p.policy_number), '') IS NULL`); break;
        case "owner": filters.push(sql`${ownerSql("p", "i", "su")} IS NULL`); break;
        case "branch": filters.push(sql`${branchSql("p", "i")} IS NULL`); break;
        case "contact": filters.push(sql`NULLIF(btrim(COALESCE(i.phone, '')), '') IS NULL AND NULLIF(btrim(COALESCE(i.email, '')), '') IS NULL`); break;
      }
    }
    const whereSql = filters.length ? sql` WHERE ${sql.join(filters, sql` AND `)}` : sql``;

    const rows = await tx.execute(sql`
      SELECT p.id, p.policy_number, p.insurer, p.plan_name, p.policy_type,
             p.sum_assured::numeric AS sum_assured,
             p.annual_premium::numeric AS annual_premium,
             p.premium_frequency, p.policy_term_years,
             p.policy_start_date, p.maturity_date,
             p.next_premium_due_date, p.status,
             p.nominee_name, p.nominee_relation,
             p.lives_covered,
             i.name AS investor_name, i.pan AS investor_pan,
             i.id AS investor_id, i.avatar_url AS investor_avatar_url,
             p.created_at
      FROM insurance_policies p
      LEFT JOIN investors i ON i.id = p.investor_id
      LEFT JOIN users su ON su.id = p.sold_by_user_id
      ${whereSql}
      ORDER BY p.created_at DESC
      LIMIT ${PAGE_SIZE} OFFSET ${(page - 1) * PAGE_SIZE}
    `);
    // True count of the filtered set (drives the pager + accurate header count).
    const filtered = await tx.execute(sql`
      SELECT COUNT(*)::int AS c
      FROM insurance_policies p
      LEFT JOIN investors i ON i.id = p.investor_id
      LEFT JOIN users su ON su.id = p.sold_by_user_id
      ${whereSql}
    `);
    const stats = await tx.execute(sql`
      SELECT
        COUNT(*) FILTER (WHERE status = 'active')::int AS active_count,
        COALESCE(
          SUM(sum_assured::numeric) FILTER (WHERE status = 'active'), 0
        )::numeric AS total_sum_assured,
        COALESCE(
          SUM(annual_premium::numeric) FILTER (WHERE status = 'active'), 0
        )::numeric AS annual_premium_book,
        COUNT(*) FILTER (
          WHERE status = 'active'
            AND next_premium_due_date IS NOT NULL
            AND next_premium_due_date <= current_date + interval '30 days'
            AND next_premium_due_date >= current_date
        )::int AS due_30d,
        COUNT(*) FILTER (WHERE status = 'lapsed')::int AS lapsed_count,
        COUNT(*) FILTER (WHERE policy_type = 'health')::int AS health_count,
        COUNT(*) FILTER (
          WHERE policy_type IN ('term', 'ulip', 'endowment', 'money_back', 'life_other')
        )::int AS life_count
      FROM insurance_policies${bareScope}
    `);
    const statusCounts = await tx.execute(sql`
      SELECT status, COUNT(*)::int AS c FROM insurance_policies${bareScope} GROUP BY status
    `);
    return {
      rows: rows.rows as any[],
      s: stats.rows[0] as any,
      filteredTotal: Number((filtered.rows[0] as any)?.c ?? 0),
      statusCounts: statusCounts.rows as Array<{ status: string; c: number }>,
    };
  });

  const countOf = (st: string) => data.statusCounts.find((r) => r.status === st)?.c ?? 0;
  const totalPolicies = data.statusCounts.reduce((a, r) => a + Number(r.c), 0);
  const STATUS_CHIP_TONE: Record<string, FilterChip["tone"]> = {
    active: "emerald", lapsed: "rose", proposed: "sky", in_underwriting: "amber",
    claim_filed: "amber", claim_settled: "sky", matured: "slate", surrendered: "slate", cancelled: "slate",
  };
  const statusChips: FilterChip[] = [
    { value: "", label: "All", count: totalPolicies, tone: "slate" },
    ...["active", "in_underwriting", "proposed", "lapsed", "claim_filed", "claim_settled", "matured", "surrendered", "cancelled"]
      .map((st) => ({ value: st, label: st.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase()), count: countOf(st), tone: STATUS_CHIP_TONE[st] }))
      .filter((c) => c.count > 0 || c.value === "active"),
  ];

  return (
    <div className="space-y-6 max-w-7xl">
      <PageHeaderCard title={<><Shield className="size-6 text-muted-foreground" /> Insurance</>} actions={<><div className="flex items-center gap-2">
          <Link href="/dashboard/insurance/import" className="btn-secondary"><FileUp className="size-4" /> Import</Link>
          <Link href="/dashboard/insurance/new" className="btn-primary">
            <Plus className="size-4" /> New policy
          </Link>
        </div></>} />

      <ModuleTabs tabs={INSURANCE_TABS} />

      {ccActive && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-primary/30 bg-accent px-3 py-2 text-xs text-foreground">
          <span className="font-medium">From the Insurance dashboard:</span>
          <span className="text-muted-foreground">
            {[
              cc.line && (cc.line === "personal" ? "Personal Lines" : "Commercial Lines"),
              cc.groups.length && `product ${cc.groups.join(", ")}`,
              cc.nature && (cc.nature === "new" ? "new business" : "renewal business"),
              cc.branch.length && (cc.branch.length === 1 ? "one branch" : `${cc.branch.length} branches`),
              cc.owner.length && (cc.owner.length === 1 ? "one RM / owner" : `${cc.owner.length} RMs / owners`),
              cc.insurer && `insurer “${cc.insurer}”`,
              cc.cats.length && `category ${cc.cats.join(", ")}`,
              cc.mf && (cc.mf === "yes" ? "MF clients" : "insurance-only clients"),
              dateSpan("booked", cc.bookedFrom, cc.bookedTo),
              dateSpan("renewal due", cc.dueFrom, cc.dueTo),
              cc.gap && GAP_LABEL[cc.gap],
            ].filter(Boolean).join(" · ")}
          </span>
          <Link href="/dashboard/insurance" className="ml-auto font-medium text-primary hover:underline">Clear</Link>
        </div>
      )}

      <StatusChips basePath="/dashboard/insurance" paramKey="status" current={sp.status ?? ""} params={sp} chips={statusChips} />

      <CompactFilterBar
        totalCount={data.filteredTotal}
        filters={[
          { type: "search", key: "q", placeholder: "Search by policy no, plan, insurer, client…" },
          dateRangeFilter("created", "Added"),
          {
            type: "multi",
            key: "type",
            label: "Policy type",
            options: Object.entries(POLICY_TYPE_LABEL).map(([value, label]) => ({ value, label })),
          },
          {
            type: "multi",
            key: "status",
            label: "Status",
            options: [
              { value: "proposed", label: "Proposed" },
              { value: "in_underwriting", label: "In underwriting" },
              { value: "active", label: "Active" },
              { value: "lapsed", label: "Lapsed" },
              { value: "matured", label: "Matured" },
              { value: "surrendered", label: "Surrendered" },
              { value: "cancelled", label: "Cancelled" },
              { value: "claim_filed", label: "Claim filed" },
              { value: "claim_settled", label: "Claim settled" },
            ],
          },
          {
            type: "multi",
            key: "frequency",
            label: "Frequency",
            options: [
              { value: "annual", label: "Annual" },
              { value: "semi_annual", label: "Semi-annual" },
              { value: "quarterly", label: "Quarterly" },
              { value: "monthly", label: "Monthly" },
              { value: "single", label: "Single-pay" },
            ],
          },
        ]}
        rightSlot={
          <CustomViews
            viewsKey="views:insurance"
            presets={[
              { id: "active", name: "Active policies", params: "status=active" },
              { id: "due-soon", name: "Premium due (30d)", params: "due=1" },
              { id: "lapsed", name: "Lapsed", params: "status=lapsed" },
              { id: "life", name: "Life policies", params: "type=term,ulip,endowment,money_back" },
              { id: "health", name: "Health policies", params: "type=health,critical_illness,personal_accident" },
            ]}
          />
        }
      />

      <div className="card-surface">
        {data.rows.length === 0 ? (
          <div className="p-12 text-center text-sm text-muted-foreground">
            <Shield className="size-8 mx-auto text-muted-foreground/50" />
            <div className="mt-2 font-medium">No policies in the register yet.</div>
            <p className="mt-2 text-xs max-w-md mx-auto">
              Click <strong>New policy</strong> to record a Term / ULIP / Health / Motor policy that
              the client already owns. The register tracks sum assured, premium dates, and nominee
              details.
            </p>
          </div>
        ) : (
          <div className="table-scroll">
            <table className="w-full text-sm">
              <thead className="text-xs text-muted-foreground border-b">
                <tr>
                  <th className="text-left px-4 py-2 font-medium">Plan / Insurer</th>
                  <th className="text-left py-2 font-medium">Type</th>
                  <th className="text-left py-2 font-medium">Client</th>
                  <th className="text-right py-2 font-medium">Sum assured</th>
                  <th className="text-right py-2 font-medium">Premium</th>
                  <th className="text-left py-2 font-medium">Frequency</th>
                  <th className="text-left py-2 font-medium">Started</th>
                  <th className="text-left py-2 font-medium">Maturity</th>
                  <th className="text-left py-2 font-medium">Next due</th>
                  <th className="text-left py-2 font-medium">Nominee</th>
                  <th className="text-left py-2 font-medium">Status</th>
                  <th className="px-4 py-2"></th>
                </tr>
              </thead>
              <tbody>
                {data.rows.map((p) => {
                  const Icon = TYPE_ICON[p.policy_type] ?? Shield;
                  const dueSoon =
                    p.status === "active" &&
                    p.next_premium_due_date &&
                    new Date(p.next_premium_due_date).getTime() <
                    Date.now() + 30 * 24 * 60 * 60 * 1000;
                  return (
                    <tr
                      key={p.id}
                      className={`border-b last:border-0 hover:bg-secondary/40 ${dueSoon ? "bg-amber-50/30" : ""
                        }`}
                    >
                      <td className="px-4 py-3">
                        <Link
                          href={`/dashboard/insurance/${p.id}`}
                          className="font-medium hover:underline"
                        >
                          {p.plan_name}
                        </Link>
                        <div className="text-2xs text-muted-foreground">
                          {p.insurer}
                          {p.policy_number && (
                            <>
                              {" "}
                              · <span className="font-mono">{p.policy_number}</span>
                            </>
                          )}
                        </div>
                      </td>
                      <td className="py-3">
                        <div className="flex items-center gap-1.5 text-xs">
                          <Icon className="size-3.5 text-muted-foreground" />
                          <span>{TYPE_LABEL[p.policy_type] ?? p.policy_type}</span>
                        </div>
                        {p.lives_covered > 1 && (
                          <div className="text-2xs text-muted-foreground">
                            {p.lives_covered} lives
                          </div>
                        )}
                      </td>
                      <td className="py-3 text-xs whitespace-nowrap">
                        <div className="flex items-center gap-2">
                          <Avatar src={p.investor_avatar_url ? `/api/investors/${p.investor_id}/avatar` : null} name={p.investor_name} size={26} />
                          <div>
                            <div className="font-medium">{p.investor_name}</div>
                            <div className="text-2xs text-muted-foreground font-mono">
                              {p.investor_pan}
                            </div>
                          </div>
                        </div>
                      </td>
                      <td className="py-3 text-right tabular-nums">
                        {p.sum_assured ? formatINR(Number(p.sum_assured)) : "—"}
                      </td>
                      <td className="py-3 text-right tabular-nums">
                        {p.annual_premium ? formatINR(Number(p.annual_premium)) : "—"}
                      </td>
                      <td className="py-3 text-xs capitalize">
                        {String(p.premium_frequency).replace(/_/g, " ")}
                      </td>
                      <td className="py-3 text-xs text-muted-foreground tabular-nums whitespace-nowrap">
                        {p.policy_start_date ? formatDate(p.policy_start_date) : "—"}
                      </td>
                      <td className="py-3 text-xs text-muted-foreground tabular-nums whitespace-nowrap">
                        {p.maturity_date ? formatDate(p.maturity_date) : "—"}
                      </td>
                      <td className="py-3 text-xs whitespace-nowrap">
                        {p.next_premium_due_date ? (
                          <span
                            className={
                              dueSoon ? "text-amber-700 font-semibold" : "text-muted-foreground"
                            }
                          >
                            {formatDate(p.next_premium_due_date)}
                          </span>
                        ) : (
                          "—"
                        )}
                      </td>
                      <td className="py-3 text-xs whitespace-nowrap">
                        {p.nominee_name ? (
                          <div>
                            <div>{p.nominee_name}</div>
                            <div className="text-2xs text-muted-foreground capitalize">
                              {p.nominee_relation ?? "—"}
                            </div>
                          </div>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </td>
                      <td className="py-3">
                        <StatusChip tone={STATUS_TONE[p.status] ?? "neutral"} className="capitalize">
                          {p.status.replace(/_/g, " ")}
                        </StatusChip>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <RowActions
                          editHref={`/dashboard/insurance/new?edit=${p.id}`}
                          deleteUrl={`/api/insurance/${p.id}`}
                          itemLabel="policy"
                          itemName={p.plan_name}
                          verb="Cancel"
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <div className="px-4 pb-3">
              <Pager
                page={page}
                totalPages={Math.ceil(data.filteredTotal / PAGE_SIZE)}
                total={data.filteredTotal}
                pageSize={PAGE_SIZE}
              />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function Stat({
  label,
  value,
  accent,
  icon: Icon,
}: {
  label: string;
  value: string;
  accent?: "rose" | "amber" | "emerald" | "muted" | "cyan";
  icon?: any;
}) {
  const color =
    accent === "rose"
      ? "text-rose-600"
      : accent === "amber"
        ? "text-amber-600"
        : accent === "emerald"
          ? "text-emerald-600"
          : "text-foreground";
  const bg: Record<string, string> = {
    cyan: "bg-brand-cyan-light text-brand-cyan-deep",
    emerald: "bg-emerald-50 text-emerald-600",
    amber: "bg-amber-50 text-amber-600",
    rose: "bg-rose-50 text-rose-600",
    muted: "bg-secondary text-foreground",
  };
  return (
    <div className="kpi-card">
      <div className="flex items-center justify-between">
        <span className="text-2xs uppercase tracking-wider font-semibold text-muted-foreground">
          {label}
        </span>
        {Icon && (
          <div className={`size-7 rounded-lg grid place-items-center ${bg[accent ?? "muted"]}`}>
            <Icon className="size-3.5" />
          </div>
        )}
      </div>
      <div className={`text-2xl font-bold mt-2 tabular-nums tracking-tight ${color}`}>{value}</div>
    </div>
  );
}
