import Link from "next/link";
import { ArrowRight } from "lucide-react";
import {
  familyHealth,
  familyMissingChecklist,
  type FamilyForHealth,
  type MemberForHealth,
} from "@/lib/families/health";
import { Badge, type BadgeTone } from "@/components/ui/Badge";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { InfoTip } from "@/components/dashboards/my/Shared";

/**
 * Family health — the family page's ONE list of what is missing.
 *
 * The page used to say the same thing four times: four status tiles (head,
 * RM, review, nominee), a "succession readiness" card, the health card's
 * "why this score", and its checklist. This card keeps the score, the three
 * coverage figures and one checklist; each row links to where it is fixed.
 *
 * Severity budget: red only for a gap with consequences (no nominee, KYC,
 * no head); everything else is neutral. A family with nothing missing says
 * so in one line, without painting it green.
 */
const BAND: Record<string, { label: string; tone: BadgeTone }> = {
  green: { label: "Healthy", tone: "success" },
  amber: { label: "Watch", tone: "warning" },
  red: { label: "At risk", tone: "danger" },
};

export function FamilyHealthCard({
  family,
  members,
  familyId,
}: {
  family: FamilyForHealth;
  members: MemberForHealth[];
  familyId: string;
}) {
  const health = familyHealth(family, members);
  const checklist = familyMissingChecklist(familyId, family, members);
  const band = BAND[health.band] ?? BAND.amber;
  const shown = checklist.slice(0, 10);

  return (
    <Card>
      <CardHeader
        title={
          <span className="inline-flex items-center gap-1">
            Family health
            <InfoTip>
              Starts at 100 and loses points for each gap across the family&apos;s live members: no head of family, no
              RM, review overdue, nominee / KYC / risk-profile gaps, a single member, no next-generation investor.
              {health.factors.length > 0 && (
                <>
                  {" "}This family: {health.factors.map((f) => `${f.label} (−${f.deduction})`).join(", ")}.
                </>
              )}
            </InfoTip>
          </span>
        }
        action={
          health.activeMemberCount > 0 ? (
            <span className="inline-flex items-center gap-2">
              <span className="text-lg font-semibold tabular-nums">{health.score}</span>
              <Badge raw tone={band.tone}>{band.label}</Badge>
            </span>
          ) : null
        }
      />
      <CardBody>
        {health.activeMemberCount === 0 ? (
          <p className="text-sm text-muted-foreground">Add a member to see the family&apos;s health.</p>
        ) : (
          <div className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-3">
              <Coverage label="Nominee recorded" pct={health.coverage.nomineePct} />
              <Coverage label="KYC verified" pct={health.coverage.kycPct} />
              <Coverage label="Risk profile done" pct={health.coverage.riskProfilePct} />
            </div>

            {checklist.length === 0 ? (
              <p className="text-sm text-muted-foreground">Nothing missing — every check passes.</p>
            ) : (
              <div>
                <div className="mb-2 text-xs font-medium text-muted-foreground">
                  To fix · {checklist.length}
                </div>
                <ul className="divide-y rounded-lg border">
                  {shown.map((c) => (
                    <li key={c.key} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
                      <span className="flex min-w-0 items-center gap-2">
                        <span
                          aria-hidden
                          className={`size-1.5 shrink-0 rounded-full ${c.severity === "high" ? "bg-destructive" : "bg-muted-foreground/40"}`}
                        />
                        <span className="truncate">{c.label}</span>
                      </span>
                      {c.action && (
                        <Link
                          href={c.action.href}
                          className="inline-flex shrink-0 items-center gap-0.5 text-xs font-medium text-primary hover:underline"
                        >
                          {c.action.label}
                          <ArrowRight className="size-3" />
                        </Link>
                      )}
                    </li>
                  ))}
                </ul>
                {checklist.length > shown.length && (
                  <p className="mt-1.5 text-xs text-muted-foreground">
                    {checklist.length - shown.length} more — see each member&apos;s page.
                  </p>
                )}
              </div>
            )}
          </div>
        )}
      </CardBody>
    </Card>
  );
}

function Coverage({ label, pct: raw }: { label: string; pct: number }) {
  const pct = Math.round(raw);
  return (
    <div>
      <div className="flex items-baseline justify-between text-xs">
        <span className="text-muted-foreground">{label}</span>
        <span className="font-semibold tabular-nums">{pct}%</span>
      </div>
      <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-muted">
        <div
          className={`h-full rounded-full ${pct >= 100 ? "bg-primary" : "bg-muted-foreground/50"}`}
          style={{ width: `${Math.max(0, Math.min(100, pct))}%` }}
        />
      </div>
    </div>
  );
}
