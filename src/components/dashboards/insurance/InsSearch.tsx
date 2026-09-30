"use client";

/**
 * §51 — one search box for the insurance book. The CRM searches each list on
 * its own fields, so the box routes to the list that holds the field: a
 * client's name, mobile or PAN to Clients; a policy number, insurer, plan or
 * vehicle number to Policies; a claim to Claims; a proposal number to
 * Proposals.
 */

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Search } from "lucide-react";
import { buttonClass } from "@/components/ui/button-class";

const TARGETS = [
  { key: "policies", label: "Policies", hint: "Policy number, insurer, plan, vehicle number", href: "/dashboard/insurance" },
  { key: "clients", label: "Clients", hint: "Client or company name, mobile, PAN", href: "/dashboard/investors" },
  { key: "claims", label: "Claims", hint: "Claimant, policy number, insurer", href: "/dashboard/insurance-claims" },
  { key: "proposals", label: "Proposals", hint: "Proposal number, title, client", href: "/dashboard/proposals" },
] as const;

export function InsSearch() {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [target, setTarget] = useState<(typeof TARGETS)[number]["key"]>("policies");
  const t = TARGETS.find((x) => x.key === target)!;
  return (
    <form
      role="search"
      className="flex flex-wrap items-center gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        const s = q.trim();
        router.push(s ? `${t.href}?q=${encodeURIComponent(s)}` : t.href);
      }}
    >
      <label className="sr-only" htmlFor="ins-search-in">Search in</label>
      <select id="ins-search-in" value={target} onChange={(e) => setTarget(e.target.value as typeof target)}
        className="input-base h-9 w-32 text-xs">
        {TARGETS.map((x) => <option key={x.key} value={x.key}>{x.label}</option>)}
      </select>
      <div className="relative min-w-0 flex-1">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden />
        <label className="sr-only" htmlFor="ins-search-q">Search</label>
        <input id="ins-search-q" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t.hint}
          className="input-base h-9 w-full pl-8 text-xs" />
      </div>
      <button type="submit" className={buttonClass("secondary", "sm")}>Search</button>
    </form>
  );
}
