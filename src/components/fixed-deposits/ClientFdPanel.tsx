"use client";

/** "Fixed deposits" on the client page — the client's FDs and an Add FD button pre-filled with the client. */

import Link from "next/link";
import { useEffect, useState } from "react";
import { Landmark, Plus } from "lucide-react";
import { buttonClass } from "@/components/ui/button-class";
import { formatMoney } from "@/lib/format";
import type { FdRow, FdTotals } from "@/lib/fixed-deposits/service";
import { FdTable } from "./FdTable";

export function ClientFdPanel({ investorId, canEdit }: { investorId: string; canEdit: boolean }) {
  const [data, setData] = useState<{ rows: FdRow[]; totals: FdTotals } | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let live = true;
    fetch(`/api/fixed-deposits?investorId=${investorId}&status=all`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((j) => live && setData(j))
      .catch(() => live && setFailed(true));
    return () => { live = false; };
  }, [investorId]);

  const add = `/dashboard/fixed-deposits/new?investorId=${investorId}`;
  const t = data?.totals;

  return (
    <section id="fixed_deposits" className="card-surface scroll-mt-24 p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="section-title flex items-center gap-2"><Landmark className="size-4 text-muted-foreground" aria-hidden /> Fixed deposits</h2>
          <p className="section-subtitle mt-0.5">
            {t && t.liveCount > 0
              ? `${t.liveCount} live · ${formatMoney(t.livePrincipal)} deposited · ${formatMoney(t.liveMaturity)} at maturity`
              : "FDs placed through you. Each one reminds the RM 15 days before it matures."}
          </p>
        </div>
        {canEdit && (
          <Link href={add} className={buttonClass("secondary", "sm")}><Plus className="size-4" aria-hidden /> Add FD</Link>
        )}
      </div>
      <div className="mt-4">
        {failed ? (
          <p className="dash-empty">Could not load fixed deposits.</p>
        ) : !data ? (
          <div className="h-16 animate-pulse rounded-lg bg-secondary/60" aria-label="Loading" />
        ) : (
          <FdTable rows={data.rows} showClient={false} empty={<p className="dash-empty">No fixed deposits recorded for this client.</p>} />
        )}
      </div>
    </section>
  );
}
