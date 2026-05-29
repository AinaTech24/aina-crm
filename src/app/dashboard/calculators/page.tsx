/**
 * MF Investment Calculators — Network FP "3.5 MF Investment Calculators"
 * parity. All 8 calculators on one page, no DB writes. RM uses these
 * during client meetings to demonstrate scenarios live.
 *
 * The 8 calculators:
 *   1. SIP Investment       — monthly → future value
 *   2. Lumpsum               — one-shot → future value
 *   3. Goal                  — target → required monthly SIP
 *   4. Inflation             — present value → inflation-adjusted future
 *   5. Cost of Delay         — invest now vs later
 *   6. Retirement Planning   — corpus required + monthly savings
 *   7. Step-up SIP           — base + annual step-up % vs flat SIP
 *   8. SWP                   — corpus depletion under monthly withdrawal
 */

import { Calculator } from "lucide-react";
import { CalculatorsApp } from "@/components/calculators/CalculatorsApp";

export const dynamic = "force-dynamic";

export default function CalculatorsPage() {
  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-semibold flex items-center gap-2">
          <Calculator className="size-6" /> MF Investment Calculators
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Live calculators for client meetings. Results are illustrative;
          all assume monthly compounding and SIPs in Begin Mode.
        </p>
      </div>
      <CalculatorsApp />
      <div className="text-[11px] text-muted-foreground border-t pt-3 print:hidden">
        <strong>Disclaimer:</strong> Past performance may or may not be
        sustained in future and is not a guarantee of any future returns.
        These calculators are for illustration only and do not represent
        actual returns. Mutual fund investments are subject to market
        risks. Read all scheme related documents carefully.
      </div>
    </div>
  );
}
