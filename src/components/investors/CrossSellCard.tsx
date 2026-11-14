"use client";

/**
 * Cross-sell / product-holdings matrix for the Client 360 (Sanchay
 * "Cross Selling" parity). The RM marks which products the client holds
 * (with us / elsewhere), is interested in, or doesn't hold — and the card
 * surfaces the products not held with us, each a click from an opportunity.
 *
 * The server writes this card too (an opportunity opened → Interested, won →
 * Held with us, lost → what it said before / Not held), so the card re-syncs
 * from its props whenever the page refreshes, and Save sends only the products
 * changed here (PATCH /api/investors/[id]/cross-sell) — never the whole map,
 * which used to overwrite the server's changes with the copy the page loaded.
 */

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Loader2, Save, Check, TrendingUp, Plus } from "lucide-react";
import { SelectField } from "@/components/ui/SelectField";
import {
  CROSS_SELL_PRODUCTS,
  CROSS_SELL_STATUSES,
  crossSellOpportunities,
  crossSellStatusLabel,
  crossSellStatusTone,
  type CrossSellMap,
} from "@/lib/investors/cross-sell";

export function CrossSellCard({
  investorId,
  initial,
}: {
  investorId: string;
  initial: CrossSellMap | null;
}) {
  const router = useRouter();
  const [map, setMap] = useState<CrossSellMap>(initial ?? {});
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // What the server says now — the page refreshes after an opportunity moves.
  const serverKey = JSON.stringify(initial ?? {});
  useEffect(() => {
    setMap(JSON.parse(serverKey) as CrossSellMap);
  }, [serverKey]);

  /** Only what this card changed, against what the server last said. */
  const changes = useMemo(() => {
    const base = JSON.parse(serverKey) as CrossSellMap;
    const out: Record<string, string | null> = {};
    for (const [key] of CROSS_SELL_PRODUCTS) {
      const now = map[key] || null;
      if (now !== (base[key] || null)) out[key] = now;
    }
    return out;
  }, [map, serverKey]);
  const dirty = Object.keys(changes).length > 0;

  const opps = crossSellOpportunities(map);

  function setProduct(key: string, val: string) {
    setMap((m) => ({ ...m, [key]: val }));
    setSaved(false);
  }

  async function save() {
    setBusy(true);
    setErr(null);
    try {
      if (!dirty) return;
      const res = await fetch(`/api/investors/${investorId}/cross-sell`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ changes }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        setErr(j.error ?? `Failed (${res.status})`);
        return;
      }
      setSaved(true);
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="border rounded-lg bg-card p-5">
      <div className="flex items-center justify-between mb-3">
        <h2 className="font-semibold flex items-center gap-2 text-sm">
          <TrendingUp className="size-4" /> Cross-sell / holdings
        </h2>
        {opps.length > 0 && (
          // Products the card marks not held with us — not the Opportunities
          // module's count (those are the journeys opened from it).
          <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-secondary text-muted-foreground">
            {opps.length} not held with us
          </span>
        )}
      </div>

      <div className="grid sm:grid-cols-2 gap-x-6 gap-y-2">
        {CROSS_SELL_PRODUCTS.map(([key, label]) => (
          <div key={key} className="flex items-center justify-between gap-2">
            <span className="text-sm">{label}</span>
            <SelectField
              value={map[key] ?? ""}
              onChange={(e) => setProduct(key, e.target.value)}
              className="text-xs w-40"
            >
              <option value="">Select…</option>
              {CROSS_SELL_STATUSES.map(([v, l]) => (
                <option key={v} value={v}>{l}</option>
              ))}
            </SelectField>
          </div>
        ))}
      </div>

      {opps.length > 0 && (
        <div className="mt-4 pt-3 border-t">
          <div className="text-2xs uppercase tracking-wide text-muted-foreground mb-1.5">
            Not held with us — click one to start an opportunity
          </div>
          <div className="flex flex-wrap gap-1.5">
            {opps.map((o) => (
              <Link
                key={o.key}
                href={`/dashboard/investors/${investorId}?opportunity=new&product=${o.key}#opportunities`}
                scroll={false}
                title={`Start a ${o.label} opportunity`}
                className={`chip text-xs border hover:ring-1 hover:ring-primary/30 ${crossSellStatusTone(o.status)}`}
              >
                <Plus className="size-3" aria-hidden /> {o.label} · {crossSellStatusLabel(o.status)}
              </Link>
            ))}
          </div>
        </div>
      )}

      <div className="flex items-center gap-2 justify-end mt-4 pt-3 border-t">
        {err && <span className="text-xs text-rose-600">{err}</span>}
        {saved && <span className="text-xs text-emerald-600 inline-flex items-center gap-0.5"><Check className="size-3" /> Saved</span>}
        <button onClick={save} disabled={busy || !dirty} className="btn-primary text-xs inline-flex items-center gap-1">
          {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Save className="size-3.5" />} Save holdings
        </button>
      </div>
    </div>
  );
}
