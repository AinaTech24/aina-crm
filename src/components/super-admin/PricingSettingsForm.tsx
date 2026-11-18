"use client";

/**
 * Aina Admin → Pricing & billing. Edits every number the AUM price is made of
 * (lib/billing/aum-pricing.ts); the defaults are the owner's decision of
 * 2026-11-18. Shown in rupees and percent, saved in paise and basis points.
 * The server validates the whole set and recomputes every price from it.
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { Field } from "@/components/ui/Field";
import { FormActions } from "@/components/ui/FormActions";
import { confirmDialog } from "@/components/ui/ConfirmProvider";
import { notify } from "@/components/ui/Toast";
import type { PricingSettings } from "@/lib/billing/aum-pricing";
import { quoteAll, inr, lateProRataCharge, monthlyBasePaise, resolvePricingSettings } from "@/lib/billing/aum-pricing";

type TierRow = { key: string; label: string; upTo: string; monthly: string };

const toRupees = (p: number) => String(p / 100);
const toPct = (bp: number) => String(bp / 100);

export function PricingSettingsForm({ settings, overridden }: { settings: PricingSettings; overridden: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [tiers, setTiers] = useState<TierRow[]>(
    settings.tiers.map((t) => ({ key: t.key, label: t.label, upTo: t.upToCrore == null ? "" : String(t.upToCrore), monthly: toRupees(t.monthlyPaise) }))
  );
  const [f, setF] = useState({
    perUserYearly: toRupees(settings.perUserYearlyPaise),
    minUsers: String(settings.minUsers),
    maxUsers: String(settings.maxUsers),
    halfDisc: toPct(settings.cycles.half_yearly.discountBp),
    yearDisc: toPct(settings.cycles.yearly.discountBp),
    gst: toPct(settings.gstBp),
    graceDays: String(settings.graceDays),
    dayBasis: String(settings.proRataDayBasis),
    reviewDays: String(settings.renewalReviewDays),
    sac: settings.sacCode,
    packageKey: settings.packageKey ?? "",
    onlineSignup: settings.onlineSignup,
  });
  const set = (k: keyof typeof f, v: string | boolean) => setF((s) => ({ ...s, [k]: v }));

  const paise = (s: string) => Math.round(Number(s) * 100);
  const bp = (s: string) => Math.round(Number(s) * 100);

  function build() {
    return {
      tiers: tiers.map((t, i) => ({
        key: t.key.trim() || `tier_${i + 1}`,
        label: t.label.trim() || `Tier ${i + 1}`,
        upToCrore: i === tiers.length - 1 ? null : Number(t.upTo),
        monthlyPaise: paise(t.monthly),
      })),
      perUserYearlyPaise: paise(f.perUserYearly),
      minUsers: Number(f.minUsers),
      maxUsers: Number(f.maxUsers),
      cycles: {
        monthly: { months: 1 as const, discountBp: 0 },
        half_yearly: { months: 6 as const, discountBp: bp(f.halfDisc) },
        yearly: { months: 12 as const, discountBp: bp(f.yearDisc) },
      },
      gstBp: bp(f.gst),
      graceDays: Number(f.graceDays),
      proRataDayBasis: Number(f.dayBasis),
      renewalReviewDays: Number(f.reviewDays),
      sacCode: f.sac.trim(),
      packageKey: f.packageKey.trim() || null,
      onlineSignup: f.onlineSignup,
    };
  }

  // Live preview of the owner's worked example with the numbers as typed.
  const preview = (() => {
    const s = resolvePricingSettings(build());
    try {
      return { quotes: quoteAll({ aumCrore: 300, users: 5 }, s), late: lateProRataCharge(monthlyBasePaise(300, 5, s), s) };
    } catch {
      return null;
    }
  })();

  async function save() {
    setBusy(true);
    try {
      const r = await fetch("/api/super-admin/pricing", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ override: build() }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error ?? "Save failed");
      notify.success("Pricing saved — new quotes use it within 30 seconds.");
      router.refresh();
    } catch (e) {
      notify.error(e instanceof Error ? e.message : "Save failed");
    } finally {
      setBusy(false);
    }
  }

  async function reset() {
    const ok = await confirmDialog({
      title: "Go back to the default prices?",
      message: "Every number on this page returns to the owner's defaults. Quotes already given keep their prices.",
      confirmLabel: "Use defaults",
    });
    if (!ok) return;
    setBusy(true);
    try {
      const r = await fetch("/api/super-admin/pricing", { method: "DELETE" });
      if (!r.ok) throw new Error("Reset failed");
      notify.success("Defaults restored.");
      window.location.reload();
    } catch (e) {
      notify.error(e instanceof Error ? e.message : "Reset failed");
    } finally {
      setBusy(false);
    }
  }

  const num = (k: keyof typeof f, label: string, hint?: string) => (
    <Field label={label} hint={hint}>
      {(id, d) => (
        <input id={id} aria-describedby={d} inputMode="decimal" className="input-base" value={String(f[k])} onChange={(e) => set(k, e.target.value)} />
      )}
    </Field>
  );

  return (
    <div className="space-y-5">
      <Card>
        <CardHeader title="Monthly maintenance by AUM" subtitle="Tiers by the firm's AUM in ₹ crore. The last tier has no upper limit." />
        <CardBody className="space-y-3">
          {tiers.map((t, i) => {
            const last = i === tiers.length - 1;
            return (
              <div key={i} className="grid grid-cols-2 sm:grid-cols-4 gap-3 items-end">
                <Field label="Label">
                  {(id) => <input id={id} className="input-base" value={t.label} onChange={(e) => setTiers((a) => a.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))} />}
                </Field>
                <Field label="Key" hint="Stable id">
                  {(id, d) => <input id={id} aria-describedby={d} className="input-base" value={t.key} onChange={(e) => setTiers((a) => a.map((x, j) => (j === i ? { ...x, key: e.target.value } : x)))} />}
                </Field>
                <Field label="Up to (₹ Cr)" hint={last ? "No upper limit" : "Inclusive"}>
                  {(id, d) => (
                    <input id={id} aria-describedby={d} inputMode="decimal" className="input-base" disabled={last} value={last ? "" : t.upTo} onChange={(e) => setTiers((a) => a.map((x, j) => (j === i ? { ...x, upTo: e.target.value } : x)))} />
                  )}
                </Field>
                <div className="flex items-end gap-2">
                  <Field label="₹ / month" className="flex-1">
                    {(id) => <input id={id} inputMode="decimal" className="input-base" value={t.monthly} onChange={(e) => setTiers((a) => a.map((x, j) => (j === i ? { ...x, monthly: e.target.value } : x)))} />}
                  </Field>
                  {tiers.length > 1 && (
                    <Button variant="ghost" size="icon" aria-label={`Remove ${t.label}`} onClick={() => setTiers((a) => a.filter((_, j) => j !== i))}>
                      <Trash2 className="size-4" />
                    </Button>
                  )}
                </div>
              </div>
            );
          })}
          <Button
            variant="ghost"
            size="sm"
            icon={<Plus className="size-4" />}
            onClick={() => setTiers((a) => [...a.slice(0, -1), { key: "", label: "", upTo: "", monthly: "" }, ...a.slice(-1)])}
          >
            Add a tier
          </Button>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Users, cycles and tax" />
        <CardBody className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          {num("perUserYearly", "₹ per user per year", "Charged monthly as ÷ 12")}
          {num("minUsers", "Minimum users")}
          {num("maxUsers", "Maximum users online", "Above this, firms talk to us")}
          {num("halfDisc", "Half-yearly discount %", "Off the whole 6-month bill")}
          {num("yearDisc", "Yearly discount %", "Off the whole 12-month bill")}
          {num("gst", "GST %", "On the discounted amount")}
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Renewals and invoices" />
        <CardBody className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          {num("graceDays", "Grace days after a missed renewal", "Full access throughout")}
          {num("dayBasis", "Day basis for the late charge", "Monthly base ÷ this × grace days")}
          {num("reviewDays", "Re-price days before renewal", "From the AUM in the CRM")}
          <Field label="SAC on invoices" hint="Confirm with your CA">
            {(id, d) => <input id={id} aria-describedby={d} className="input-base" value={f.sac} onChange={(e) => set("sac", e.target.value)} />}
          </Field>
          <Field label="Package for online firms" hint="packages.key — blank = starter">
            {(id, d) => <input id={id} aria-describedby={d} className="input-base" value={f.packageKey} onChange={(e) => set("packageKey", e.target.value)} />}
          </Field>
          <Field label="Online purchase">
            {(id) => (
              <label htmlFor={id} className="flex items-center gap-2 text-sm pt-2">
                <input id={id} type="checkbox" checked={f.onlineSignup} onChange={(e) => set("onlineSignup", e.target.checked)} />
                Firms may create their account from /pricing
              </label>
            )}
          </Field>
        </CardBody>
      </Card>

      {preview && (
        <Card>
          <CardHeader title="Preview — 300 Cr, 5 users" subtitle="With the numbers above, before you save." />
          <CardBody className="grid grid-cols-1 sm:grid-cols-4 gap-3 text-sm">
            {preview.quotes.map((q) => (
              <div key={q.cycle} className="rounded-lg bg-secondary/70 p-3">
                <div className="text-muted-foreground">{q.cycle.replace("_", "-")}</div>
                <div className="font-semibold tabular-nums">{inr(q.totalPaise)}</div>
                <div className="text-xs text-muted-foreground">{inr(q.taxablePaise)} + GST {inr(q.gstPaise)}</div>
              </div>
            ))}
            <div className="rounded-lg bg-secondary/70 p-3">
              <div className="text-muted-foreground">Late charge</div>
              <div className="font-semibold tabular-nums">{inr(preview.late.totalPaise)}</div>
              <div className="text-xs text-muted-foreground">{inr(preview.late.taxablePaise)} + GST {inr(preview.late.gstPaise)}</div>
            </div>
          </CardBody>
        </Card>
      )}

      <FormActions status={overridden ? "Custom prices in force" : "Using the default prices"}>
        {overridden && (
          <Button variant="ghost" onClick={reset} disabled={busy}>
            Use defaults
          </Button>
        )}
        <Button variant="primary" onClick={save} loading={busy}>
          Save pricing
        </Button>
      </FormActions>
    </div>
  );
}
