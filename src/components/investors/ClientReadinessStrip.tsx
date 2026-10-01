import Link from "next/link";
import type { ReactNode } from "react";
import { ShieldCheck, CheckCircle2, AlertTriangle, IdCard, ShieldAlert, Users, Landmark, type LucideIcon } from "lucide-react";
import { Card } from "@/components/ui/Card";
import { cn } from "@/lib/utils";

/**
 * ClientReadinessStrip — the one checklist of what is still missing on a
 * client: the compliance items that make them transaction-ready (KYC, risk
 * profile, nominee, bank, verified contact) and the profile fields nobody has
 * filled in yet (address, occupation, PAN–Aadhaar link…).
 *
 * The page used to carry three different completeness figures — "2/6" here,
 * "Onboarding (3/5)" on a button, "67%, 10 of 15 fields" on a card in another
 * tab — each with its own list. This is the only one now, and the button that
 * fixes the gaps (the guided setup) sits on it.
 *
 * Pure render (server component). Renders nothing once every tracked item is
 * complete and no field is missing, so established clients don't see it. A
 * tracked item passed as `null` is hidden (licence/field not visible for this
 * firm). Colour is a signal: the card itself stays neutral; a pending item is
 * amber and a missing or expired risk profile — the one SEBI blocker — red.
 */

type RiskState = "ok" | "missing" | "expired";

type Item = { key: string; label: string; ok: boolean; icon: LucideIcon; urgent?: boolean; href?: string };

export function ClientReadinessStrip({
  investorId,
  kyc,
  risk,
  nominee,
  bank,
  emailVerified,
  phoneVerified,
  missingFields = [],
  action,
  verify,
}: {
  investorId: string;
  kyc: boolean | null;
  risk: RiskState | null;
  nominee: boolean | null;
  bank: boolean | null;
  emailVerified: boolean | null;
  phoneVerified: boolean | null;
  /** Profile fields still blank beyond the checks above, as labels. */
  missingFields?: string[];
  /** The control that completes the setup (the guided onboarding). */
  action?: ReactNode;
  /** Interactive "Verify email / phone" pills; drawn in place of the static ones. */
  verify?: ReactNode;
}) {
  const items: Item[] = [];
  if (kyc !== null) items.push({ key: "kyc", label: "KYC", ok: kyc, icon: IdCard });
  if (risk !== null) {
    items.push({
      key: "risk",
      label: risk === "expired" ? "Risk profile (expired)" : "Risk profile",
      ok: risk === "ok",
      icon: ShieldAlert,
      urgent: true,
      href: `/dashboard/risk-profiles/new?investorId=${investorId}`,
    });
  }
  if (nominee !== null) items.push({ key: "nominee", label: "Nominee", ok: nominee, icon: Users, href: "#rel-nominees" });
  if (bank !== null) items.push({ key: "bank", label: "Bank account", ok: bank, icon: Landmark });

  const contact = [emailVerified, phoneVerified].filter((v): v is boolean => v !== null);
  const total = items.length + contact.length;
  const done = items.filter((i) => i.ok).length + contact.filter(Boolean).length;
  const gaps = total - done;

  // Nothing tracked and nothing missing → no strip (keeps active clients clean).
  if (gaps === 0 && missingFields.length === 0) return null;

  const riskNeedsAction = risk === "missing" || risk === "expired";

  return (
    <Card className="px-5 py-4">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-foreground">
          <ShieldCheck className="size-4 text-muted-foreground" aria-hidden />
          Client setup
        </h2>
        {total > 0 && (
          <span className="text-xs tabular-nums text-muted-foreground">
            {done} of {total} done{gaps > 0 ? ` · ${gaps} left before this client can transact` : ""}
          </span>
        )}
        <div className="ml-auto flex flex-wrap items-center gap-2">
          {riskNeedsAction && (
            <Link
              href={`/dashboard/risk-profiles/new?investorId=${investorId}`}
              className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-primary px-3 text-xs font-medium text-primary-foreground shadow-sm hover:bg-primary/90"
            >
              <ShieldCheck className="size-3.5" /> {risk === "expired" ? "Renew risk profile" : "Start risk assessment"}
            </Link>
          )}
          {action}
        </div>
      </div>

      {(items.length > 0 || verify) && (
        <ul className="mt-3 flex flex-wrap gap-1.5">
          {items.map((it) => {
            const Icon = it.ok ? CheckCircle2 : it.urgent ? AlertTriangle : it.icon;
            const cls = cn(
              "inline-flex items-center gap-1 rounded-md border px-2 py-1 text-2xs font-medium",
              it.ok
                ? "border-success/20 bg-success/5 text-success"
                : it.urgent
                  ? "border-destructive/30 bg-destructive/5 text-destructive"
                  : "border-warning/40 bg-warning/5 text-warning-foreground",
            );
            const inner = (
              <>
                <Icon className="size-3" aria-hidden />
                {it.label}
                {!it.ok && <span className="opacity-70">· pending</span>}
              </>
            );
            return (
              <li key={it.key}>
                {!it.ok && it.href ? (
                  it.href.startsWith("#") ? (
                    <a href={it.href} className={cn(cls, "hover:bg-secondary")}>{inner}</a>
                  ) : (
                    <Link href={it.href} className={cn(cls, "hover:bg-secondary")}>{inner}</Link>
                  )
                ) : (
                  <span className={cls}>{inner}</span>
                )}
              </li>
            );
          })}
          {verify && <li className="contents">{verify}</li>}
        </ul>
      )}

      {missingFields.length > 0 && (
        <p className="mt-3 text-xs text-muted-foreground">
          <span className="font-medium text-foreground">Profile details still missing:</span> {missingFields.join(", ")}.{" "}
          <a href="#rel-master" className="font-medium text-primary hover:underline">Add them</a>
        </p>
      )}
    </Card>
  );
}
