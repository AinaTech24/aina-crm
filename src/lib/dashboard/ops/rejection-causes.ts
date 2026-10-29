/**
 * Why a SIP instalment bounced, grouped into the bones of a fishbone: Bank,
 * Mandate, Client, Bank details, Registrar / AMC, Payment system — from the
 * category the team set (sip_rejections.reason_category) or the registrar's
 * words (rejection_reason). Pure; the Operations Dashboard's fishbone and its
 * test use it. Words it does not recognise keep their own text under "Other";
 * a blank reason is "Reason not recorded" — a gap to fill, not a cause.
 */

export const CAUSE_GROUPS = ["Bank", "Mandate", "Client", "Bank details", "Registrar / AMC", "Payment system", "Other", "Not recorded"] as const;
export type CauseGroup = (typeof CAUSE_GROUPS)[number];

export type Cause = { group: CauseGroup; cause: string };

const RULES: Array<[RegExp, CauseGroup, string]> = [
  [/insufficient|not sufficient|low balance|balance insuff|funds? (?:not|in)suff|lack of funds/, "Bank", "Low balance"],
  [/account (?:is )?closed|a\/?c (?:is )?closed|closed account/, "Bank", "Account closed"],
  [/frozen|freeze|dormant|blocked|inoperative|kyc pending at bank/, "Bank", "Account frozen"],
  [/signature/, "Bank", "Signature mismatch"],
  [/stop(?:ped)? payment|payment stopped|stopped by (?:the )?(?:customer|investor|client)|customer (?:request|cancel)|investor request|cancel(?:led)? by (?:the )?(?:customer|investor)|opted cancellation|revoked by (?:customer|investor)/, "Client", "Stopped by client"],
  [/exceed|limit|more than (?:the )?mandate|amount (?:greater|higher)/, "Mandate", "Over the mandate limit"],
  [/mandate.*(?:expir|cancel|revok|suspend)|(?:expir|cancel|revok).*mandate|umrn.*(?:inactive|cancel)/, "Mandate", "Mandate expired / cancelled"],
  [/mandate.*(?:not|un)\s*(?:registered|found|received|available|approved)|no (?:valid )?mandate|mandate (?:pending|awaited|rejected)|umrn (?:not|invalid)/, "Mandate", "Mandate not registered"],
  [/mandate/, "Mandate", "Other mandate issue"],
  [/invalid (?:a\/?c|account)|account (?:number|no)|a\/?c no|no such account|account does not exist|ifsc|micr|name mismatch|invalid bank/, "Bank details", "Wrong bank details"],
  [/duplicate/, "Registrar / AMC", "Duplicate"],
  [/scheme|suspended for|not open for|amc|nfo/, "Registrar / AMC", "Scheme / AMC"],
  [/technical|timeout|time out|system|npci|server|network|connectivity|bank holiday|holiday|not processed|unable to process/, "Payment system", "Technical / NACH"],
  [/reversal|revers|returned|dishonou?r/, "Bank", "Debit returned"],
];

const CATEGORY: Record<string, Cause> = {
  insufficient_balance: { group: "Bank", cause: "Low balance" },
  mandate_expired: { group: "Mandate", cause: "Mandate expired / cancelled" },
  technical: { group: "Payment system", cause: "Technical / NACH" },
};

export function rejectionCause(category: string | null | undefined, reason: string | null | undefined): Cause {
  if (category && CATEGORY[category]) return CATEGORY[category];
  const text = (reason ?? "").trim();
  if (!text) return { group: "Not recorded", cause: "Reason not recorded" };
  const t = text.toLowerCase();
  for (const [re, group, cause] of RULES) if (re.test(t)) return { group, cause };
  const short = text.replace(/\s+/g, " ");
  return { group: "Other", cause: short.length > 28 ? `${short.slice(0, 27)}…` : short };
}

export type Bone = { name: CauseGroup; causes: Array<{ label: string; count: number }> };

/**
 * Counted causes → bones: groups largest first, each with its three largest
 * causes (the rest folded into "Other …"). "Not recorded" is kept apart
 * (`unrecorded`) so the fish shows causes, not the gap.
 */
export function fishboneFrom(counted: Array<{ cause: Cause; count: number }>): { bones: Bone[]; unrecorded: number } {
  const groups = new Map<CauseGroup, Map<string, number>>();
  let unrecorded = 0;
  for (const { cause, count } of counted) {
    if (cause.group === "Not recorded") { unrecorded += count; continue; }
    const m = groups.get(cause.group) ?? new Map<string, number>();
    m.set(cause.cause, (m.get(cause.cause) ?? 0) + count);
    groups.set(cause.group, m);
  }
  const bones = [...groups.entries()]
    .map(([name, m]) => {
      const list = [...m.entries()].map(([label, count]) => ({ label, count })).sort((a, b) => b.count - a.count);
      const head = list.slice(0, 3);
      const rest = list.slice(3);
      if (rest.length) {
        const n = rest.reduce((a, c) => a + c.count, 0);
        head[2] = { label: "Other", count: head[2].count + n };
      }
      return { name, causes: head, total: list.reduce((a, c) => a + c.count, 0) };
    })
    .sort((a, b) => b.total - a.total)
    .map(({ name, causes }) => ({ name, causes }));
  return { bones, unrecorded };
}
