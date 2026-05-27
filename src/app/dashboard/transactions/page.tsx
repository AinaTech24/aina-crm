import Link from "next/link";
import { desc, eq, inArray, sql } from "drizzle-orm";
import { Repeat, Upload, ArrowDownToLine, TrendingUp, AlertCircle } from "lucide-react";
import { withTenant } from "@/db/client";
import { transactions, investors, users } from "@/db/schema";
import { requireSession } from "@/lib/auth/session";
import { formatINR, formatDate } from "@/lib/utils";
import { FilterBar } from "@/components/common/FilterBar";
import { CustomViews } from "@/components/common/CustomViews";
import { ColumnManager } from "@/components/common/ColumnManager";

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
  sip_stop: "bg-orange-50 text-orange-700",
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
  cancelled: "bg-gray-50 text-gray-700",
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
  const sp = await searchParams;
  const q = (sp.q ?? "").trim();
  const typeFilter = (sp.txtype ?? "").split(",").filter(Boolean);
  const statusFilter = (sp.status ?? "").split(",").filter(Boolean);
  const dateFrom = sp.date_from ?? "";
  const dateTo = sp.date_to ?? "";

  const conds: any[] = [];
  if (q) {
    conds.push(
      sql`(${transactions.schemeName} ILIKE ${`%${q}%`} OR ${investors.name} ILIKE ${`%${q}%`} OR ${transactions.folioNumber} ILIKE ${`%${q}%`})`
    );
  }
  if (typeFilter.length) conds.push(inArray(transactions.type, typeFilter as any));
  if (statusFilter.length) conds.push(inArray(transactions.status, statusFilter as any));
  if (dateFrom) conds.push(sql`${transactions.orderDate} >= ${dateFrom}::date`);
  if (dateTo) conds.push(sql`${transactions.orderDate} <= ${dateTo}::date`);

  const data = await withTenant(session.tenantId, async (tx) => {
    const stats = await tx.execute(sql`
      SELECT
        COUNT(*) FILTER (WHERE direction = 'inflow'
          AND status IN ('successful','processed')
          AND order_date >= date_trunc('day', now()))::int AS today_purchase_count,
        COALESCE(SUM(CASE WHEN direction = 'inflow'
          AND status IN ('successful','processed')
          AND order_date >= date_trunc('day', now()) THEN amount::numeric ELSE 0 END), 0) AS today_purchase_amt,
        COALESCE(SUM(CASE WHEN direction = 'outflow'
          AND status IN ('successful','processed')
          AND order_date >= date_trunc('day', now()) THEN amount::numeric ELSE 0 END), 0) AS today_redemption_amt,
        COUNT(*) FILTER (WHERE status = 'rejected'
          AND created_at >= now() - interval '7 days')::int AS rejected_7d
      FROM transactions
    `);
    const s = stats.rows[0] as any;

    const baseQ = tx
      .select({ tx: transactions, investorName: investors.name, rmName: users.name })
      .from(transactions)
      .leftJoin(investors, eq(investors.id, transactions.investorId))
      .leftJoin(users, eq(users.id, transactions.executedByUserId));
    const rows = conds.length
      ? await baseQ
          .where(sql.join(conds, sql` AND `) as any)
          .orderBy(desc(transactions.orderDate), desc(transactions.createdAt))
          .limit(200)
      : await baseQ
          .orderBy(desc(transactions.orderDate), desc(transactions.createdAt))
          .limit(200);

    return {
      todayPurchaseCount: Number(s.today_purchase_count),
      todayPurchaseAmt: Number(s.today_purchase_amt),
      todayRedemptionAmt: Number(s.today_redemption_amt),
      rejected7d: Number(s.rejected_7d),
      rows,
    };
  });

  const netToday = data.todayPurchaseAmt - data.todayRedemptionAmt;

  return (
    <div className="space-y-6 max-w-7xl">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <Repeat className="size-6 text-brand-cyan" /> MF Transactions
          </h1>
          <p className="text-muted-foreground text-sm">
            Purchase · Redemption · Switch · SIP · STP · SWP feed. Reconciled daily with CAMS + KFintech.
          </p>
        </div>
        <Link href="/dashboard/transactions/import" className="btn-secondary">
          <Upload className="size-4" /> Import Excel
        </Link>
      </div>

      <div className="grid grid-cols-4 gap-3">
        <Stat
          icon={TrendingUp}
          label="Today's purchases"
          value={String(data.todayPurchaseCount)}
          sub={formatINR(data.todayPurchaseAmt)}
        />
        <Stat
          icon={ArrowDownToLine}
          label="Today's redemption"
          value={formatINR(data.todayRedemptionAmt)}
          tone={data.todayRedemptionAmt > 0 ? "rose" : "muted"}
        />
        <Stat
          icon={TrendingUp}
          label="Net today"
          value={formatINR(netToday)}
          tone={netToday >= 0 ? "emerald" : "rose"}
        />
        <Stat
          icon={AlertCircle}
          label="Rejected (7d)"
          value={String(data.rejected7d)}
          tone={data.rejected7d > 0 ? "rose" : "muted"}
        />
      </div>

      <FilterBar
        totalCount={data.rows.length}
        filters={[
          { type: "search", key: "q", placeholder: "Search scheme, client, or folio…" },
          {
            type: "multi",
            key: "txtype",
            label: "Type",
            options: [
              { value: "sip", label: "SIP" },
              { value: "lumpsum", label: "Lumpsum" },
              { value: "redemption", label: "Redemption" },
              { value: "switch", label: "Switch" },
              { value: "swp", label: "SWP" },
              { value: "stp", label: "STP" },
              { value: "dividend", label: "Dividend" },
              { value: "other", label: "Other" },
            ],
          },
          {
            type: "multi",
            key: "status",
            label: "Status",
            options: [
              { value: "successful", label: "Successful" },
              { value: "processed", label: "Processed" },
              { value: "pending", label: "Pending" },
              { value: "rejected", label: "Rejected" },
              { value: "cancelled", label: "Cancelled" },
              { value: "failed", label: "Failed" },
            ],
          },
          { type: "date_range", key: "date", label: "Order date" },
        ]}
        rightSlot={
          <div className="flex items-center gap-2">
            <ColumnManager moduleKey="transactions" columns={TRANSACTIONS_COLUMNS} />
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

      <div className="card-surface">
        {data.rows.length === 0 ? (
          <div className="p-12 text-center text-sm text-muted-foreground">
            <Repeat className="size-8 mx-auto text-muted-foreground/50" />
            <div className="mt-2 font-medium">No transactions yet.</div>
            <p className="mt-2 text-xs max-w-md mx-auto">
              Transactions flow in automatically from CAMS + KFintech feeds once configured.
              You can also import manually via Excel.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm" data-table="transactions">
              <thead className="text-xs text-muted-foreground border-b">
                <tr>
                  <th data-col="date" className="text-left px-4 py-2 font-medium">Date</th>
                  <th data-col="investor" className="text-left py-2 font-medium">Investor</th>
                  <th data-col="folio" className="text-left py-2 font-medium">Folio</th>
                  <th data-col="scheme" className="text-left py-2 font-medium">AMC / Scheme</th>
                  <th data-col="category" className="text-left py-2 font-medium">Category</th>
                  <th data-col="type" className="text-left py-2 font-medium">Type</th>
                  <th data-col="amount" className="text-right py-2 font-medium">Amount</th>
                  <th data-col="units" className="text-right py-2 font-medium">Units</th>
                  <th data-col="nav" className="text-right py-2 font-medium">NAV</th>
                  <th data-col="status" className="text-left py-2 font-medium">Status</th>
                  <th data-col="source" className="text-left py-2 font-medium">Source</th>
                  <th data-col="rm" className="text-left py-2 font-medium">RM</th>
                  <th data-col="remarks" className="text-left py-2 font-medium pr-4">Remarks</th>
                </tr>
              </thead>
              <tbody>
                {data.rows.map(({ tx: t, investorName, rmName }) => (
                  <tr key={t.id} className="border-b last:border-0 hover:bg-secondary/40">
                    <td data-col="date" className="px-4 py-3 text-xs text-muted-foreground tabular-nums whitespace-nowrap">
                      {t.orderDate ? formatDate(t.orderDate) : "—"}
                    </td>
                    <td data-col="investor" className="py-3 whitespace-nowrap">
                      {investorName ? (
                        <Link href={`/dashboard/investors/${t.investorId}`} className="hover:underline">
                          {investorName}
                        </Link>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td data-col="folio" className="py-3 text-xs font-mono text-muted-foreground whitespace-nowrap">
                      {t.folioNumber ?? "—"}
                    </td>
                    <td data-col="scheme" className="py-3 max-w-[220px]">
                      <div className="text-sm truncate">{t.schemeName ?? t.schemeCode ?? "—"}</div>
                      <div className="text-xs text-muted-foreground truncate">
                        {t.amcName ?? t.amcCode ?? "—"}
                      </div>
                    </td>
                    <td data-col="category" className="py-3 text-xs text-muted-foreground capitalize">
                      {t.schemeCategory ?? "—"}
                    </td>
                    <td data-col="type" className="py-3">
                      <span className={`chip ${TYPE_TONE[t.type] ?? ""} font-medium`}>
                        {TYPE_LABEL[t.type] ?? t.type}
                      </span>
                    </td>
                    <td data-col="amount" className="py-3 text-right tabular-nums">
                      {t.amount != null ? formatINR(Number(t.amount)) : "—"}
                    </td>
                    <td data-col="units" className="py-3 text-right tabular-nums text-muted-foreground">
                      {t.units ? Number(t.units).toFixed(2) : "—"}
                    </td>
                    <td data-col="nav" className="py-3 text-right tabular-nums text-muted-foreground">
                      {t.nav ? Number(t.nav).toFixed(4) : "—"}
                    </td>
                    <td data-col="status" className="py-3">
                      <span className={`chip ${STATUS_TONE[t.status] ?? ""}`}>
                        {STATUS_LABEL[t.status] ?? t.status}
                      </span>
                    </td>
                    <td data-col="source" className="py-3 text-xs text-muted-foreground">
                      {SOURCE_LABEL[t.sourceFeed ?? ""] ?? t.sourceFeed ?? "—"}
                    </td>
                    <td data-col="rm" className="py-3 text-xs">{rmName ?? "—"}</td>
                    <td data-col="remarks" className="py-3 pr-4 text-xs text-muted-foreground max-w-[180px] truncate">
                      {t.remarks ?? t.reasonDescription ?? "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

function Stat({
  label,
  value,
  sub,
  tone,
  icon: Icon,
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: "rose" | "amber" | "emerald" | "muted";
  icon?: any;
}) {
  const color =
    tone === "rose"
      ? "text-rose-600"
      : tone === "amber"
      ? "text-amber-600"
      : tone === "emerald"
      ? "text-emerald-600"
      : "text-foreground";
  return (
    <div className="card-surface p-4">
      <div className="flex items-center justify-between">
        <span className="text-xs text-muted-foreground">{label}</span>
        {Icon && <Icon className="size-3.5 text-muted-foreground" />}
      </div>
      <div className={`text-2xl font-bold mt-1 tabular-nums ${color}`}>{value}</div>
      {sub && <div className="text-xs text-muted-foreground mt-1">{sub}</div>}
    </div>
  );
}
