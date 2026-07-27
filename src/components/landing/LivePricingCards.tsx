"use client";

/**
 * The pricing cards, rendered live. Seeded with the server-rendered plans (so the
 * initial HTML is complete for SEO and there's no flash), then kept in sync with
 * admin edits by polling /api/landing/packages — periodically, and immediately
 * whenever the tab regains focus/visibility (the common "edit in admin → switch
 * back" flow). No manual page refresh needed.
 */

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Check, Phone, Users2 } from "lucide-react";
import type { LandingPlan } from "@/lib/landing/packages";

const POLL_MS = 20_000;

export function LivePricingCards({ initial }: { initial: LandingPlan[] }) {
  const [plans, setPlans] = useState<LandingPlan[]>(initial);
  const lastJson = useRef<string>(JSON.stringify(initial));

  useEffect(() => {
    let alive = true;

    async function refresh() {
      try {
        const res = await fetch("/api/landing/packages", { cache: "no-store" });
        if (!res.ok) return;
        const data = await res.json();
        if (!alive || !Array.isArray(data?.plans)) return;
        const next = JSON.stringify(data.plans);
        // Only re-render when something actually changed (avoids needless churn).
        if (next !== lastJson.current) {
          lastJson.current = next;
          setPlans(data.plans as LandingPlan[]);
        }
      } catch {
        /* offline / transient — keep showing what we have */
      }
    }

    const id = setInterval(refresh, POLL_MS);
    const onVisible = () => {
      if (document.visibilityState === "visible") refresh();
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", refresh);
    // Kick one refresh on mount so a page that was itself served stale updates fast.
    refresh();

    return () => {
      alive = false;
      clearInterval(id);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", refresh);
    };
  }, []);

  return (
    <div className="mt-16 grid sm:grid-cols-2 lg:grid-cols-3 gap-6 items-stretch max-w-6xl mx-auto">
      {plans.map((p) => {
        const custom = p.isCustom;
        return (
          <div
            key={p.name}
            className={`glass-card rounded-2xl p-6 sm:p-8 flex flex-col relative border ${
              p.featured
                ? "border-2 border-red-500 bg-red-500/[0.04] animate-premium-aurora"
                : custom
                  ? "border-2 border-primary/60 bg-primary/[0.03]"
                  : "border-border/60"
            }`}
          >
            {p.featured && (
              <span className="absolute -top-3.5 left-1/2 -translate-x-1/2 bg-red-600 text-white text-[10px] uppercase font-bold tracking-widest px-3 py-1 rounded-full ring-2 ring-red-300 animate-premium-badge-shine">
                {p.badgeLabel || "Most Popular"}
              </span>
            )}
            {custom && !p.featured && (
              <span className="absolute -top-3.5 left-1/2 -translate-x-1/2 bg-primary text-primary-foreground text-[10px] uppercase font-bold tracking-widest px-3 py-1 rounded-full ring-2 ring-primary/30">
                {p.badgeLabel || "Enterprise"}
              </span>
            )}
            {p.discountBadge && (
              <span className="absolute -top-3 right-3 z-10 bg-emerald-600 text-white text-[10px] uppercase font-bold tracking-wide px-2.5 py-1 rounded-full ring-2 ring-emerald-200 shadow-sm">
                {p.discountBadge}
              </span>
            )}
            <h3 className="font-extrabold text-xl text-foreground">{p.name}</h3>
            <p className="text-xs text-muted-foreground mt-2 min-h-[30px] leading-relaxed">{p.tagline}</p>

            <div className="mt-4 pt-4 border-t border-border/40">
              {custom ? (
                <>
                  <div className="flex items-baseline gap-1.5">
                    <span className="text-3xl font-extrabold text-foreground">{p.priceLabel || "Let's talk"}</span>
                    {p.unitLabel && <span className="text-sm text-muted-foreground font-semibold">{p.unitLabel}</span>}
                  </div>
                  <div className="mt-1.5 text-sm text-muted-foreground font-medium">
                    Custom-quoted for your firm — <span className="font-bold text-foreground">self-hosted</span> on your own server.
                  </div>
                  <div className="mt-2 inline-flex items-center gap-1.5 rounded-md bg-secondary/70 border border-border/50 px-2 py-1 text-[11px] font-semibold text-muted-foreground">
                    <Phone className="size-3" /> Talk to us for a tailored plan
                  </div>
                </>
              ) : (
                <>
                  <div className="flex items-baseline gap-1.5">
                    <span className="text-3xl font-extrabold text-foreground">{p.priceLabel}</span>
                    {p.unitLabel && <span className="text-sm text-muted-foreground font-semibold">{p.unitLabel}</span>}
                  </div>
                  {p.setupLabel && (
                    <div className="mt-1.5 text-sm text-muted-foreground font-medium">
                      + {p.setupOriginalLabel && (
                        <span className="line-through text-muted-foreground/60 font-semibold mr-1">{p.setupOriginalLabel}</span>
                      )}
                      <span className="font-bold text-foreground">{p.setupLabel}</span> one-time setup (per firm)
                    </div>
                  )}
                  {p.seatsLabel && (
                    <div className="mt-2 inline-flex items-center gap-1.5 rounded-md bg-secondary/70 border border-border/50 px-2 py-1 text-[11px] font-semibold text-muted-foreground tabular-nums">
                      <Users2 className="size-3" /> {p.seatsLabel}
                    </div>
                  )}
                </>
              )}
            </div>

            {p.inheritsLabel && <p className="mt-5 text-sm font-bold text-foreground">{p.inheritsLabel}</p>}
            <ul className="mt-5 flex flex-col gap-2.5 flex-grow">
              {p.features.map((f) => (
                <li key={f} className="flex items-start gap-2.5 text-xs text-muted-foreground font-medium">
                  <Check className="size-3.5 text-emerald-600 mt-0.5 shrink-0" />
                  <span>{f}</span>
                </li>
              ))}
            </ul>

            {custom || p.ctaHref.startsWith("tel:") || /^https?:/.test(p.ctaHref) ? (
              <a href={p.ctaHref} className={`mt-8 w-full ${p.featured ? "btn-primary !bg-red-600 hover:!bg-red-700" : "btn-primary"} font-bold py-3 text-center justify-center shadow-md inline-flex items-center gap-2`}>
                {p.ctaHref.startsWith("tel:") && <Phone className="size-4" />} {p.ctaLabel}
              </a>
            ) : (
              <Link href={p.ctaHref || "/signup"} className={`mt-8 w-full ${p.featured ? "btn-primary !bg-red-600 hover:!bg-red-700" : "btn-secondary"} font-bold py-3 text-center justify-center shadow-md`}>
                {p.ctaLabel}
              </Link>
            )}
          </div>
        );
      })}
    </div>
  );
}
