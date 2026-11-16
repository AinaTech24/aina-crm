import { PageHeaderCard } from "@/components/layout/PageHeaderCard";
import { ExportButton } from "@/components/export/ExportButton";
import Link from "next/link";
import { redirect } from "next/navigation";
import { desc, eq, sql } from "drizzle-orm";
import { Repeat, ArrowDownToLine, TrendingUp, AlertCircle, FileUp } from "lucide-react";
import { withTenant } from "@/db/client";
import { transactions, investors, users } from "@/db/schema";
import { requireSession } from "@/lib/auth/session";
import { can } from "@/lib/auth/rbac";
import { dataWallApplies, hasCustomPermissions } from "@/lib/investors/access";
import { visibleClientSql } from "@/lib/transactions/client-scope";
import { formatINR, formatDate } from "@/lib/utils";
import { CompactFilterBar } from "@/components/common/CompactFilterBar";
import { CustomViews } from "@/components/common/CustomViews";
import { ColumnManager } from "@/components/common/ColumnManager";
import { buildTransactionConditions, transactionClientCondition, transactionFiltersNeedInvestors } from "@/lib/transactions/list-filters";
import { EmptyState, InlineEmpty } from "@/components/common/EmptyState";
import { EmailRecordButton } from "@/components/comms/EmailRecordButton";
import { loadTenantLicense } from "@/lib/auth/license";
import { isFieldAllowed } from "@/lib/auth/field-gate";
import { readColumnPrefs } from "@/lib/list-columns/server";
import { EXTRA_PREFIX, orderKeys } from "@/lib/list-columns/prefs";
import { allowedTransactionExtraKeys, loadTransactionExtra, transactionExtraOptions } from "@/lib/list-columns/transaction-fields";
import { Fragment, type ReactNode } from "react";


const TRANSACTIONS_COLUMNS = [
  { key: "date", label: "Date", required: true },
  { key: "investor", label: "Investor", required: true },
  { key: "folio", label: "Folio" },
  { key: "scheme", label: "AMC / Scheme" },
  { key: "category", label: "Category", defaultHidden: true },
  { key: "type", label: "Type" },
  { key: "amount", label: "Amount" },
  { key: "units", label: "Units", defaultHidden: true },
  { key: "nav", label: "NAV", defaultHidden: true },
  { key: "status", label: "Status" },
  { key: "source", label: "Source", defaultHidden: true },
  { key: "rm", label: "RM" },
  { key: "remarks", label: "Remarks", defaultHidden: true },
];

/** Spec § Module 9 — visual chip palette */
const TYPE_TONE: Record<string, string> = {
  purchase: "bg-emerald-50 text-emerald-700",
  lumpsum: "bg-emerald-50 text-emerald-700",
  redemption: "bg-rose-50 text-rose-700",
  switch: "bg-purple-50 text-purple-700",
  sip: "bg-blue-50 text-blue-700",
  sip_stop: "bg-brand-cyan-light/50 text-brand-cyan-deep",
  sip_pause: "bg-amber-50 text-amber-700",
  stp: "bg-cyan-50 text-cyan-700",
  swp: "bg-teal-50 text-teal-700",
  dividend_payout: "bg-teal-50 text-teal-700",
  dividend_reinvest: "bg-cyan-50 text-cyan-700",
};

const TYPE_LABEL: Record<string, string> = {
  purchase: "Purchase",
  lumpsum: "Purchase",
  redemption: "Redemption",
  switch: "Switch",
  sip: "SIP",
  sip_stop: "SIP Stop",
  sip_pause: "SIP Pause",
  stp: "STP",
  swp: "SWP",
  dividend_payout: "Div Payout",
  dividend_reinvest: "Div Reinvest",
};

const STATUS_TONE: Record<string, string> = {
  processed: "bg-emerald-50 text-emerald-700",
  successful: "bg-emerald-50 text-emerald-700",
  pending: "bg-amber-50 text-amber-700",
  submitted: "bg-blue-50 text-blue-700",
  rejected: "bg-rose-50 text-rose-700",
  failed: "bg-rose-50 text-rose-700",
  cancelled: "bg-secondary text-foreground",
};

const STATUS_LABEL: Record<string, string> = {
  pending: "Pending",
  processed: "Processed",
  successful: "Processed",
  submitted: "Pending",
  rejected: "Rejected",
  failed: "Rejected",
  cancelled: "Cancelled",
};

const SOURCE_LABEL: Record<string, string> = {
  manual: "Manual",
  cams: "CAMS",
  kfintech: "KFintech",
  nse: "NSE",
  bse: "BSE",
  mfu: "MFU",
  other: "Other",
  import: "Import",
};

export const dynamic = "force-dynamic";

export default async function TransactionsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const session = await requireSession();
  // Transactions are client holdings — the same gate as the SIP book, for a
  // user whose permissions the owner customised (everyone else keeps the page
  // they had). A page never throws a 403.
  if (hasCustomPermissions(session) && !can(session.roles, "transactions.view", session.permissions)) redirect("/dashboard");
  const license = await loadTenantLicense(session.tenantId, session.roles);
  const colPrefs = await readColumnPrefs("transactions");
  // Fields this person may add as columns (More fields in the column menu).
  const extraOptions = transactionExtraOptions((f) => isFieldAllowed(license, "investor", f));
  const extraAllowed = allowedTransactionExtraKeys(extraOptions);
  const extraKeys = colPrefs.extra.filter((k) => extraAllowed.has(k));
  const sp = await searchParams;
  const q = (sp.q ?? "").trim();
  const dateFrom = sp.date_from ?? "";
  const dateTo = sp.date_to ?? "";
  const cursor = sp.cursor;

  // The Net business card and the money chart link here with the period
  // (date_from / date_to, order_date inclusive), status=processed, amc and the
  // client filters; transactionClientCondition applies those and the
  // live-client rule the figures are summed over, for this page and the export.
  // Shared filter conditions (search / type / status / date / RM / AMC / source)
  // — identical to the KPI cards and the Excel export, so all three agree —
  // plus the tenant (explicit: a superuser connection bypasses RLS) and the
  // client filters above.
  const baseConds = [
    eq(transactions.tenantId, session.tenantId),
    ...buildTransactionConditions(sp),
    transactionClientCondition(sp, session.tenantId),
  ];
  const needsInvestors = transactionFiltersNeedInvestors(sp);
  const conds = [...baseConds];

  if (cursor) {
    const [cursorOrderDate, cursorCreatedMs, cursorId] = cursor.split(":");
    if (cursorCreatedMs && cursorId) {
      conds.push(
        sql`(COALESCE(${transactions.orderDate}, '1970-01-01'::date), ${transactions.createdAt}, ${transactions.id}) < (${cursorOrderDate === "null" ? "1970-01-01" : cursorOrderDate}::date, ${new Date(Number(cursorCreatedMs)).toISOString()}::timestamp, ${cursorId}::uuid)`
      );
    }
  }

  const data = await withTenant(session.tenantId, async (tx) => {
    // Viewer scope under the data wall: only transactions of clients this
    // viewer may see (the investors table is always joined —
    // transactionFiltersNeedInvestors). Without it, every transaction, as before.
    const scope = (await dataWallApplies(tx, session)) ? await visibleClientSql(tx, session, "investors") : sql`TRUE`;
    baseConds.push(scope);
    conds.push(scope);
    // KPI cards reflect the CURRENT filter selection (period-aware) — picking a
    // date range / type / RM updates the headline totals too, and each card
    // links into the rows behind it.
    const statWhere = baseConds.length ? (sql.join(baseConds, sql` AND `) as any) : undefined;
    const statSelect = {
      inflowCount: sql<number>`COUNT(*) FILTER (WHERE ${transactions.direction}='inflow' AND ${transactions.status} IN ('successful','processed'))::int`,
      inflowAmt: sql<number>`COALESCE(SUM(CASE WHEN ${transactions.direction}='inflow' AND ${transactions.status} IN ('successful','processed') THEN ${transactions.amount}::numeric ELSE 0 END),0)`,
      outflowAmt: sql<number>`COALESCE(SUM(CASE WHEN ${transactions.direction}='outflow' AND ${transactions.status} IN ('successful','processed') THEN ${transactions.amount}::numeric ELSE 0 END),0)`,
      rejectedCount: sql<number>`COUNT(*) FILTER (WHERE ${transactions.status} IN ('rejected','failed'))::int`,
      total: sql<number>`COUNT(*)::int`,
    };
    // Join investors ONLY when a filter actually references it (search or RM).
    // These aggregates read nothing from the client table, so on an unfiltered
    // load the join was joining every transaction row to compute five numbers
    // that ignore it — which is what pushed this page past the 30s statement
    // timeout, and drained the pool, once one firm reached half a million rows.
    const statRows = needsInvestors
      ? await tx
          .select(statSelect)
          .from(transactions)
          .leftJoin(investors, eq(investors.id, transactions.investorId))
          .where(statWhere)
      : await tx.select(statSelect).from(transactions).where(statWhere);
    const s = statRows[0] as any;

    const baseQ = tx
      .select({ tx: transactions, investorName: investors.name, rmName: users.name })
      .from(transactions)
      .leftJoin(investors, eq(investors.id, transactions.investorId))
      .leftJoin(users, eq(users.id, transactions.executedByUserId));
    const rows = conds.length
      ? await baseQ
        .where(sql.join(conds, sql` AND `) as any)
        .orderBy(desc(transactions.orderDate), desc(transactions.createdAt), desc(transactions.id))
        .limit(51)
      : await baseQ
        .orderBy(desc(transactions.orderDate), desc(transactions.createdAt), desc(transactions.id))
        .limit(51);

    const hasMore = rows.length > 50;
    const displayRows = hasMore ? rows.slice(0, 50) : rows;
    const lastRow = displayRows[displayRows.length - 1];
    const nextCursor = lastRow
      ? `${lastRow.tx.orderDate ?? "null"}:${lastRow.tx.createdAt.getTime()}:${lastRow.tx.id}`
      : "";

    // RM roster + AMC list for the filter dropdowns.
    const rmRows = await tx.execute(
      sql`SELECT id, name FROM users WHERE tenant_id = ${session.tenantId}::uuid AND status='active' ORDER BY name ASC`
    );
    const amcRows = await tx.execute(
      sql`SELECT amc_name, count(*) AS c FROM transactions WHERE tenant_id = ${session.tenantId}::uuid AND amc_name IS NOT NULL AND amc_name <> '' GROUP BY amc_name ORDER BY c DESC LIMIT 60`
    );

    // Added fields: only for the rows on this page, in the same transaction.
    const extraValues = await loadTransactionExtra(tx, displayRows.map((r) => r.tx.id), extraKeys, extraAllowed);

    return {
      extraValues,
      inflowCount: Number(s.inflowCount),
      inflowAmt: Number(s.inflowAmt),
      outflowAmt: Number(s.outflowAmt),
      rejectedCount: Number(s.rejectedCount),
      total: Number(s.total),
      displayRows,
      hasMore,
      nextCursor,
      rms: rmRows.rows as any[],
      amcs: amcRows.rows as any[],
    };
  });

  const netFlow = data.inflowAmt - data.outflowAmt;
  const pageAmt = data.displayRows.reduce((n, r) => n + (r.tx.amount != null ? Number(r.tx.amount) : 0), 0);

  // Preserve the active filters when building card / export links.
  const filterEntries = Object.entries(sp).filter(
    ([k, v]) => typeof v === "string" && v && k !== "cursor"
  ) as [string, string][];
  const carry = (extra: Record<string, string>) => {
    const p = new URLSearchParams(filterEntries);
    for (const [k, v] of Object.entries(extra)) p.set(k, v);
    return `/dashboard/transactions?${p.toString()}`;
  };
  const periodLabel = dateFrom || dateTo ? `${dateFrom || "start"} → ${dateTo || "today"}` : "all dates";

  const rmOptions = (data.rms ?? []).map((r: any) => ({ value: String(r.id), label: r.name ?? "—" }));
  const amcOptions = (data.amcs ?? []).map((r: any) => ({ value: String(r.amc_name), label: String(r.amc_name) }));
  const sourceOptions = [
    { value: "cams", label: "CAMS" },
    { value: "kfintech", label: "KFintech" },
    { value: "manual", label: "Manual" },
    { value: "import", label: "Import" },
    { value: "nse", label: "NSE" },
    { value: "bse", label: "BSE" },
    { value: "mfu", label: "MFU" },
    { value: "other", label: "Other" },
  ];

  // "No transactions yet" only when the book really is empty — not when the
  // filters (or a page past the end) match nothing.
  const filtering =
    ["q", "date_from", "date_to", "amc", "source", "txtype", "status", "rm", "branch", "segment", "category", "fam", "tag", "src"].some((k) => (sp[k] ?? "").trim() !== "") ||
    Boolean(sp.cursor);
  const bookEmpty = data.displayRows.length === 0 && !filtering;

  // ── Columns, in the order this person chose ─────────────────────────────
  // The built-in columns, then the fields they added (`x:<field>`); their saved
  // sequence decides and the date stays first. The server reads their cookie, so
  // nothing reshuffles after paint.
  const order = orderKeys(
    [...TRANSACTIONS_COLUMNS.map((c) => c.key), ...extraKeys.map((k) => EXTRA_PREFIX + k)],
    colPrefs.order,
    ["date"],
  );
  const lastKey = order[order.length - 1];
  const amountAt = order.indexOf("amount");
  const extraLabel = (k: string) => extraOptions.find((o) => `x:${o.key}` === k)?.label ?? k.slice(2);
  // The first column carries the left gutter, the last the right one.
  const gut = (k: string) => (k === order[0] ? "px-4" : k === lastKey ? "pr-4" : "");

  const headFor = (k: string): ReactNode => {
    const left = `text-left py-2 font-medium ${gut(k)}`;
    const right = `text-right py-2 font-medium ${gut(k)}`;
    switch (k) {
      case "date": return <th data-col="date" className={left}>Date</th>;
      case "investor": return <th data-col="investor" className={left}>Investor</th>;
      case "folio": return <th data-col="folio" className={left}>Folio</th>;
      case "scheme": return <th data-col="scheme" className={left}>AMC / Scheme</th>;
      case "category": return <th data-col="category" className={left}>Category</th>;
      case "type": return <th data-col="type" className={left}>Type</th>;
      case "amount": return <th data-col="amount" className={right}>Amount</th>;
      case "units": return <th data-col="units" className={right}>Units</th>;
      case "nav": return <th data-col="nav" className={right}>NAV</th>;
      case "status": return <th data-col="status" className={left}>Status</th>;
      case "source": return <th data-col="source" className={left}>Source</th>;
      case "rm": return <th data-col="rm" className={left}>RM</th>;
      case "remarks": return <th data-col="remarks" className={left}>Remarks</th>;
      default:
        return k.startsWith(EXTRA_PREFIX) ? (
          <th data-col={k} className={`${left} whitespace-nowrap`}>{extraLabel(k)}</th>
        ) : null;
    }
  };

  const cellFor = (
    k: string,
    t: (typeof data.displayRows)[number]["tx"],
    investorName: string | null,
    rmName: string | null,
    extra: Record<string, string> | undefined,
  ): ReactNode => {
    const g = gut(k);
    switch (k) {
      case "date":
        return (
          <td data-col="date" className={`${g} py-3 text-xs text-muted-foreground tabular-nums whitespace-nowrap`}>
            {t.orderDate ? formatDate(t.orderDate) : "—"}
          </td>
        );
      case "investor":
        return (
          <td data-col="investor" className={`${g} py-3 whitespace-nowrap`}>
            {investorName ? (
              <Link href={`/dashboard/investors/${t.investorId}`} className="hover:underline">
                {investorName}
              </Link>
            ) : (
              "—"
            )}
          </td>
        );
      case "folio":
        return (
          <td data-col="folio" className={`${g} py-3 text-xs font-mono text-muted-foreground whitespace-nowrap`}>
            {t.folioNumber ?? "—"}
          </td>
        );
      case "scheme":
        return (
          <td data-col="scheme" className={`${g} py-3 max-w-[220px]`}>
            <div className="text-sm truncate">{t.schemeName ?? t.schemeCode ?? "—"}</div>
            <div className="text-xs text-muted-foreground truncate">{t.amcName ?? t.amcCode ?? "—"}</div>
          </td>
        );
      case "category":
        return (
          <td data-col="category" className={`${g} py-3 text-xs text-muted-foreground capitalize`}>
            {t.schemeCategory ?? "—"}
          </td>
        );
      case "type":
        return (
          <td data-col="type" className={`${g} py-3`}>
            <div className="flex items-center gap-1.5">
              <span className={`chip ${TYPE_TONE[t.type] ?? ""} font-medium`}>{TYPE_LABEL[t.type] ?? t.type}</span>
              {(t.type === "switch" || t.type === "stp" || t.type === "swp") && (t.status === "processed" || t.status === "successful") && t.investorId && (
                <EmailRecordButton
                  investorId={t.investorId}
                  kind="transaction"
                  recordId={t.id}
                  clientName={investorName}
                  summary={`${TYPE_LABEL[t.type] ?? t.type} · ${t.schemeName ?? "scheme"}${t.amount ? ` · ${formatINR(Number(t.amount))}` : ""}`}
                />
              )}
            </div>
          </td>
        );
      case "amount":
        return (
          <td data-col="amount" className={`${g} py-3 text-right tabular-nums`}>
            {t.amount != null ? formatINR(Number(t.amount)) : "—"}
          </td>
        );
      case "units":
        return (
          <td data-col="units" className={`${g} py-3 text-right tabular-nums text-muted-foreground`}>
            {t.units ? Number(t.units).toFixed(2) : "—"}
          </td>
        );
      case "nav":
        return (
          <td data-col="nav" className={`${g} py-3 text-right tabular-nums text-muted-foreground`}>
            {t.nav ? Number(t.nav).toFixed(4) : "—"}
          </td>
        );
      case "status":
        return (
          <td data-col="status" className={`${g} py-3`}>
            <span className={`chip ${STATUS_TONE[t.status] ?? ""}`}>{STATUS_LABEL[t.status] ?? t.status}</span>
          </td>
        );
      case "source":
        return (
          <td data-col="source" className={`${g} py-3 text-xs text-muted-foreground`}>
            {SOURCE_LABEL[t.sourceFeed ?? ""] ?? t.sourceFeed ?? "—"}
          </td>
        );
      case "rm":
        return (
          <td data-col="rm" className={`${g} py-3 text-xs`}>
            {rmName ?? "—"}
          </td>
        );
      case "remarks":
        return (
          <td data-col="remarks" className={`${g} py-3 text-xs text-muted-foreground max-w-[180px] truncate`}>
            {t.remarks ?? t.reasonDescription ?? "—"}
          </td>
        );
      default: {
        if (!k.startsWith(EXTRA_PREFIX)) return null;
        const v = extra?.[k.slice(EXTRA_PREFIX.length)];
        return (
          <td data-col={k} className={`${g} py-3 text-xs whitespace-nowrap ${v ? "" : "text-muted-foreground"}`}>
            {v ?? "—"}
          </td>
        );
      }
    }
  };

  return (
    <div className="space-y-6 max-w-7xl">
      <PageHeaderCard title={<><Repeat className="size-6 text-muted-foreground" /> MF Transactions</>} actions={<><div className="flex items-center gap-2">
          <ExportButton module="transactions" />
          <Link href="/dashboard/transactions/import" className="btn-secondary">
            <FileUp className="size-4" /> Import
          </Link>
        </div></>} />

      <CompactFilterBar
        totalCount={data.total}
        filters={[
          { type: "search", key: "q", placeholder: "Search scheme, client, or folio…" },
          {
            type: "multi",
            key: "txtype",
            label: "Type",
            options: [
              { value: "lumpsum", label: "Purchase (Lumpsum)" },
              { value: "sip", label: "SIP" },
              { value: "redemption", label: "Redemption" },
              { value: "switch", label: "Switch" },
              { value: "sip_pause", label: "SIP Pause" },
              { value: "sip_stop", label: "SIP Stop" },
              { value: "stp", label: "STP" },
              { value: "swp", label: "SWP" },
              { value: "dividend", label: "Dividend" },
            ],
          },
          {
            type: "multi",
            key: "status",
            label: "Status",
            options: [
              { value: "processed", label: "Processed" },
              { value: "pending", label: "Pending" },
              { value: "rejected", label: "Rejected" },
              { value: "cancelled", label: "Cancelled" },
            ],
          },
          { type: "date_range", key: "date", label: "Order date" },
          ...(rmOptions.length ? [{ type: "multi" as const, key: "rm", label: "RM", options: rmOptions }] : []),
          ...(amcOptions.length ? [{ type: "multi" as const, key: "amc", label: "AMC", options: amcOptions }] : []),
          { type: "multi" as const, key: "source", label: "Source", options: sourceOptions },
        ]}
        rightSlot={
          <div className="flex items-center gap-2">
            <ColumnManager moduleKey="transactions" columns={TRANSACTIONS_COLUMNS} extraFields={extraOptions} prefs={colPrefs} pinFirst={["date"]} />
            <CustomViews
              viewsKey="views:transactions"
              presets={[
                { id: "sip", name: "SIPs only", params: "txtype=sip" },
                { id: "rejected-30d", name: "Rejected (30 d)", params: "status=rejected" },
                { id: "purchases-mtd", name: "Purchases", params: "txtype=sip,lumpsum&status=successful,processed" },
                { id: "redemptions", name: "Redemptions", params: "txtype=redemption" },
              ]}
            />
          </div>
        }
      />

      {bookEmpty ? (
        <EmptyState
          icon={Repeat}
          title="No transactions yet"
          description="Upload a CAMS/KFintech file to bring them in."
          primary={{ href: "/dashboard/rta-imports", label: "Go to RTA File Imports" }}
          secondary={{ href: "/dashboard/transactions/import", label: "Import from Excel" }}
        />
      ) : (
      <div className="card-surface">
        {data.displayRows.length === 0 ? (
          <InlineEmpty message="No transactions match these filters." action={{ href: "/dashboard/transactions", label: "Clear filters" }} />
        ) : (
          <>
            <div className="table-scroll">
              <table className="w-full text-sm" data-table="transactions">
                <thead className="text-xs text-muted-foreground border-b sticky top-0 z-10 bg-card">
                  <tr>
                    {order.map((k) => (
                      <Fragment key={k}>{headFor(k)}</Fragment>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {data.displayRows.map(({ tx: t, investorName, rmName }) => (
                    <tr key={t.id} className="border-b last:border-0 hover:bg-secondary/40">
                      {order.map((k) => (
                        <Fragment key={k}>{cellFor(k, t, investorName, rmName, data.extraValues[t.id])}</Fragment>
                      ))}
                    </tr>
                  ))}
                </tbody>
                <tfoot className="border-t bg-secondary/30 text-xs font-medium sticky bottom-0">
                  <tr>
                    <td data-col="date" className="px-4 py-2 text-muted-foreground" colSpan={Math.max(1, amountAt)}>
                      {data.displayRows.length} on this page{data.total > data.displayRows.length ? ` of ${data.total} matching` : ""}
                    </td>
                    <td data-col="amount" className="py-2 text-right tabular-nums">{formatINR(pageAmt)}</td>
                    {order.length - amountAt - 1 > 0 && <td colSpan={order.length - amountAt - 1} />}
                  </tr>
                </tfoot>
              </table>
            </div>
            {data.hasMore && (
              <div className="p-4 border-t flex justify-end">
                <Link
                  href={{
                    pathname: "/dashboard/transactions",
                    query: {
                      ...Object.fromEntries(filterEntries),
                      cursor: data.nextCursor,
                    },
                  }}
                  className="rounded-md border bg-background px-3 py-1.5 text-xs font-medium hover:bg-accent hover:text-accent-foreground"
                >
                  Next Page →
                </Link>
              </div>
            )}
          </>
        )}
      </div>
      )}
    </div>
  );
}

function Stat({
  label,
  value,
  sub,
  tone,
  icon: Icon,
  href,
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: "rose" | "amber" | "emerald" | "muted";
  icon?: any;
  href?: string;
}) {
  const color =
    tone === "rose"
      ? "text-rose-600"
      : tone === "amber"
        ? "text-amber-600"
        : tone === "emerald"
          ? "text-emerald-600"
          : "text-foreground";
  const inner = (
    <>
      <div className="flex items-center justify-between">
        <span className="text-xs text-muted-foreground">{label}</span>
        {Icon && <Icon className="size-3.5 text-muted-foreground" />}
      </div>
      <div className={`text-2xl font-bold mt-1 tabular-nums ${color}`}>{value}</div>
      {sub && <div className="text-xs text-muted-foreground mt-1">{sub}</div>}
    </>
  );
  if (href) {
    return (
      <Link href={href} className="card-surface p-4 block transition-colors hover:bg-secondary/40 hover:border-brand-cyan/40">
        {inner}
      </Link>
    );
  }
  return <div className="card-surface p-4">{inner}</div>;
}
