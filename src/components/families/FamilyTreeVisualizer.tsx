import Link from "next/link";
import { formatINR } from "@/lib/utils";
import { Avatar } from "@/components/ui/Avatar";
import { Badge } from "@/components/ui/Badge";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { isHeadRole, roleLabel } from "@/lib/families/roles";
import { hasNominee } from "@/lib/families/health";

type Member = {
  id: string;
  name: string;
  avatarUrl?: string | null;
  familyRole: string | null;
  aum: string | number | null;
  activeSipAmount: string | number | null;
  kycStatus: string | null;
  nomineeName: string | null;
  nominees?: unknown;
  ckycExpiryAt: string | Date | null;
  isMinor?: boolean | null;
  status?: string | null;
};

/**
 * Family wealth map — the household by generation: parents / HUF above, the
 * head and spouse in the middle, children below. Each card shows the member's
 * AUM and SIP and only the gaps that matter (KYC, nominee).
 *
 * The head of family is always in the middle row, whatever relationship is
 * stored for them (the old map put a head whose role read "father" among the
 * ancestors). Labels come from lib/families/roles; the nominee check reads
 * the nominees list too, the same rule as the health card.
 */
const ANCESTOR = new Set(["father", "mother", "huf_karta", "huf"]);
const DEPENDENT = new Set(["son", "daughter", "huf_coparcener", "sibling", "minor"]);

export function FamilyTreeVisualizer({ members, primaryInvestorId }: { members: Member[]; primaryInvestorId: string | null }) {
  if (!members || members.length === 0) return null;

  const ancestors: Member[] = [];
  const core: Member[] = [];
  const dependents: Member[] = [];
  for (const m of members) {
    const role = (m.familyRole ?? "").toLowerCase();
    if (m.id === primaryInvestorId || isHeadRole(role)) core.push(m);
    else if (ANCESTOR.has(role)) ancestors.push(m);
    else if (DEPENDENT.has(role) || m.isMinor) dependents.push(m);
    else core.push(m);
  }
  core.sort((a, b) => (a.id === primaryInvestorId ? -1 : b.id === primaryInvestorId ? 1 : 0));

  const tier = (list: Member[]) => (
    <div className="flex flex-wrap items-stretch justify-center gap-4">
      {list.map((m) => (
        <MemberNode key={m.id} member={m} isHead={m.id === primaryInvestorId} />
      ))}
    </div>
  );
  const link = <div aria-hidden className="mx-auto my-2 h-5 w-px bg-border" />;

  return (
    <Card>
      <CardHeader title="Family wealth map" subtitle="The household by generation, with each member's book." />
      <CardBody>
        {ancestors.length > 0 && (
          <>
            {tier(ancestors)}
            {link}
          </>
        )}
        {core.length > 0 && tier(core)}
        {dependents.length > 0 && (
          <>
            {link}
            {tier(dependents)}
          </>
        )}
      </CardBody>
    </Card>
  );
}

function MemberNode({ member, isHead }: { member: Member; isHead: boolean }) {
  const aum = Number(member.aum ?? 0);
  const sip = Number(member.activeSipAmount ?? 0);
  const closed = member.status === "closed" || member.status === "exited";
  const kycGap =
    member.kycStatus !== "verified" ||
    (member.ckycExpiryAt != null && new Date(member.ckycExpiryAt).getTime() <= Date.now() + 30 * 86_400_000);
  const nomineeGap = !hasNominee(member as any);

  return (
    <div className={`w-56 rounded-xl border bg-card p-3.5 ${isHead ? "border-primary/50" : "border-border"} ${closed ? "opacity-60" : ""}`}>
      <div className="flex items-start gap-2.5">
        <Avatar src={member.avatarUrl ? `/api/investors/${member.id}/avatar` : null} name={member.name} size={32} className="shrink-0" />
        <div className="min-w-0 flex-1">
          <Link href={`/dashboard/investors/${member.id}`} className="block truncate text-sm font-semibold hover:underline">
            {member.name}
          </Link>
          <div className="mt-0.5 text-xs text-muted-foreground">
            {isHead ? "Head of family" : member.familyRole ? roleLabel(member.familyRole) : "Relationship not set"}
          </div>
        </div>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-1 border-t pt-2.5 text-xs">
        <div>
          <div className="text-muted-foreground">AUM</div>
          <div className="font-semibold tabular-nums">{formatINR(aum)}</div>
        </div>
        <div>
          <div className="text-muted-foreground">SIP / month</div>
          <div className="font-semibold tabular-nums">{sip > 0 ? formatINR(sip) : "—"}</div>
        </div>
      </div>

      {(closed || kycGap || nomineeGap) && (
        <div className="mt-2.5 flex flex-wrap gap-1 border-t pt-2">
          {closed ? (
            <Badge raw>{member.status === "exited" ? "Exited" : "Closed"}</Badge>
          ) : (
            <>
              {kycGap && <Badge raw tone="danger">KYC gap</Badge>}
              {nomineeGap && <Badge raw tone="danger">No nominee</Badge>}
            </>
          )}
        </div>
      )}
    </div>
  );
}
