import Link from "next/link";
import { Receipt, type LucideIcon } from "lucide-react";
import { fyLabel } from "@/lib/tax/firm-gains";

export type TaxTabKey = "realised" | "notional" | "dividend" | "fywise" | "package";

export const TAX_TABS: Array<{ key: TaxTabKey; label: string; href: string }> = [
  { key: "realised", label: "Realised Capital Gain", href: "/dashboard/reports/tax/realised-capital-gains" },
  { key: "notional", label: "Notional Capital Gain", href: "/dashboard/reports/tax/notional-capital-gains" },
  { key: "dividend", label: "Dividend / IDCW", href: "/dashboard/reports/tax/dividend-report" },
  { key: "fywise", label: "FY-wise Summary", href: "/dashboard/reports/tax/fy-wise" },
  { key: "package", label: "Tax Package", href: "/dashboard/reports/tax/tax-package" },
];

/**
 * Shared frame for the five taxation reports: one heading, a tab strip that
 * keeps the chosen FY when you switch report, FY chips, and the honesty line
 * every tax figure in the CRM carries.
 */
export function TaxReportShell({
  active,
  fy,
  fys,
  title,
  subtitle,
  right,
  children,
}: {
  active: TaxTabKey;
  fy: number;
  fys: number[];
  title: string;
  subtitle: string;
  right?: React.ReactNode;
  children: React.ReactNode;
}) {
  const current = TAX_TABS.find((t) => t.key === active)!;
  return (
    <div className="space-y-5 max-w-7xl">
      <div>
        <h1 className="page-title">
          <Receipt className="size-6 text-primary" /> Taxation reports
        </h1>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="inline-flex flex-wrap rounded-lg border border-border bg-secondary/40 p-0.5 gap-0.5 text-xs">
          {TAX_TABS.map((t) => (
            <Link
              key={t.key}
              href={`${t.href}?fy=${fy}`}
              className={`px-3 py-1.5 rounded-md font-medium transition ${t.key === active ? "bg-card shadow-sm text-foreground" : "text-muted-foreground hover:bg-secondary"}`}
            >
              {t.label}
            </Link>
          ))}
        </div>
        <div className="inline-flex items-center gap-1 text-xs">
          <span className="text-muted-foreground mr-1">Financial year</span>
          {fys.map((y) => (
            <Link
              key={y}
              href={`${current.href}?fy=${y}`}
              className={`px-2.5 py-1 rounded-md border ${y === fy ? "bg-primary text-primary-foreground border-primary" : "border-border hover:bg-secondary"}`}
            >
              {fyLabel(y).replace("FY ", "")}
            </Link>
          ))}
        </div>
      </div>

      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-lg font-semibold">{title}</h2>
          <p className="text-xs text-muted-foreground mt-0.5">{subtitle}</p>
        </div>
        {right}
      </div>

      {children}

      <p className="text-2xs text-muted-foreground">
        Indicative working from recorded transactions (FIFO lot matching, equity rules, ₹1.25 L LTCG exemption). Grandfathering
        and the exact equity / debt classification need AMC data — confirm against the RTA capital-gains statement before filing.
      </p>
    </div>
  );
}

export function Stat({ icon: Icon, label, value, tone }: { icon?: LucideIcon; label: string; value: string; tone?: "good" | "bad" | "muted" }) {
  const color = tone === "good" ? "text-emerald-700" : tone === "bad" ? "text-rose-700" : tone === "muted" ? "text-muted-foreground" : "text-foreground";
  return (
    <div className="card-surface p-4">
      <div className="text-2xs uppercase tracking-wide text-muted-foreground flex items-center gap-1.5">
        {Icon && <Icon className="size-3.5" />} {label}
      </div>
      <div className={`mt-1.5 text-xl font-semibold tabular-nums ${color}`}>{value}</div>
    </div>
  );
}

/** ₹ with sign; negatives read as losses, not as formatting accidents. */
export function signedINR(n: number, formatINR: (v: number) => string): string {
  if (!n) return "₹0";
  return (n < 0 ? "−" : "") + formatINR(Math.abs(n));
}
