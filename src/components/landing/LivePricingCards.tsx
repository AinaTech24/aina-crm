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
import { DEMO_URL } from "@/lib/landing/links";

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
    <div className="mt-14 grid sm:grid-cols-2 lg:grid-cols-3 gap-5 items-stretch max-w-6xl mx-auto">
      {plans.map((p) => {
        const custom = p.isCustom;
        // Self-serve sign-up is closed: a card still pointing at /signup (the
        // fallback plans, or an admin-saved card) asks for a demo instead.
        const toSignup = !p.ctaHref || p.ctaHref.startsWith("/signup");
        const cta = toSignup
          ? { href: DEMO_URL, label: /trial|sign ?up/i.test(p.ctaLabel) || !p.ctaLabel ? "Book a demo" : p.ctaLabel }
          : { href: p.ctaHref, label: p.ctaLabel };
        const dark = p.featured;
        const external = /^https?:/.test(cta.href);
        const btn = `mt-8 w-full inline-flex items-center justify-center gap-2 rounded-full py-3 text-sm font-bold transition ${
          dark ? "bg-site-crimson text-white hover:bg-site-crimson-deep" : "bg-site-ink text-white hover:bg-site-ink-2"
        }`;
        return (
          <div
            key={p.name}
            className={`relative flex flex-col rounded-3xl p-6 sm:p-8 ${
              dark ? "bg-site-ink text-white shadow-2xl lg:-my-3" : "bg-site-paper text-site-text ring-1 ring-site-sand"
            }`}
          >
            {(p.featured || custom || p.discountBadge) && (
              <div className="absolute -top-3 left-6 flex gap-2">
                {(p.featured || custom) && (
                  <span className={`rounded-full px-3 py-1 text-2xs font-bold uppercase tracking-widest ${p.featured ? "bg-site-crimson text-white" : "bg-site-ink text-white"}`}>
                    {p.badgeLabel || (p.featured ? "Most popular" : "Enterprise")}
                  </span>
                )}
                {p.discountBadge && (
                  <span className="rounded-full bg-site-mint px-2.5 py-1 text-2xs font-bold uppercase tracking-wide text-white">{p.discountBadge}</span>
                )}
              </div>
            )}
            <h3 className="font-brand text-2xl">{p.name}</h3>
            {/* Two lines at most; the full tagline is the hover title. */}
            {p.tagline && (
              <p className={`mt-2 text-sm leading-relaxed line-clamp-2 ${dark ? "text-white/65" : "text-site-muted"}`} title={p.tagline}>{p.tagline}</p>
            )}

            <div className={`mt-5 pt-5 border-t ${dark ? "border-white/10" : "border-site-sand"}`}>
              <div className="flex items-baseline gap-1.5">
                <span className="text-4xl font-extrabold tracking-tight tabular-nums">{custom ? p.priceLabel || "Let's talk" : p.priceLabel}</span>
                {p.unitLabel && <span className={`text-sm font-semibold ${dark ? "text-white/60" : "text-site-muted"}`}>{p.unitLabel}</span>}
              </div>
              {custom ? (
                <p className={`mt-2 text-sm ${dark ? "text-white/65" : "text-site-muted"}`}>
                  Custom-quoted for your firm — <span className="font-bold">self-hosted</span> on your own server.
                </p>
              ) : (
                <>
                  {p.setupLabel && (
                    <p className={`mt-2 text-sm ${dark ? "text-white/65" : "text-site-muted"}`}>
                      +{" "}
                      {p.setupOriginalLabel && <span className="line-through opacity-60 mr-1">{p.setupOriginalLabel}</span>}
                      <span className="font-bold">{p.setupLabel}</span> one-time setup (per firm)
                    </p>
                  )}
                  {p.seatsLabel && (
                    <span className={`mt-2 inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-2xs font-semibold tabular-nums ${dark ? "bg-white/10 text-white/70" : "bg-site-cream text-site-muted"}`}>
                      <Users2 className="size-3" /> {p.seatsLabel}
                    </span>
                  )}
                </>
              )}
            </div>

            {p.inheritsLabel && <p className="mt-6 text-sm font-bold">{p.inheritsLabel}</p>}
            <FeatureList features={p.features} dark={dark} />

            {custom || cta.href.startsWith("tel:") || external ? (
              <a href={cta.href} {...(external ? { target: "_blank", rel: "noopener noreferrer" } : {})} className={btn}>
                {cta.href.startsWith("tel:") && <Phone className="size-4" />} {cta.label}
              </a>
            ) : (
              <Link href={cta.href} className={btn}>
                {cta.label}
              </Link>
            )}
          </div>
        );
      })}
    </div>
  );
}

/** The plan's first few features; the rest open on request, so a long plan
 *  does not turn its card into a wall of text. */
const SHOWN = 6;

function FeatureList({ features, dark }: { features: string[]; dark?: boolean }) {
  const [all, setAll] = useState(false);
  const shown = all ? features : features.slice(0, SHOWN);
  const hidden = features.length - SHOWN;
  return (
    <div className="mt-5 flex-grow">
      <ul className="flex flex-col gap-2.5">
        {shown.map((f) => (
          <li key={f} className={`flex items-start gap-2.5 text-sm ${dark ? "text-white/80" : "text-site-text/80"}`}>
            <Check className={`size-4 mt-0.5 shrink-0 ${dark ? "text-site-mint-soft" : "text-site-mint"}`} />
            <span>{f}</span>
          </li>
        ))}
      </ul>
      {hidden > 0 && (
        <button
          type="button"
          onClick={() => setAll((v) => !v)}
          aria-expanded={all}
          className={`mt-3 min-h-6 text-sm font-semibold hover:underline ${dark ? "text-site-rose" : "text-site-crimson"}`}
        >
          {all ? "Show less" : `+ ${hidden} more`}
        </button>
      )}
    </div>
  );
}
