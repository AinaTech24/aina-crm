/**
 * Positions — the firm organised by jobs, not by people (The E-Myth Revisited).
 * Each position has a contract, holders, the processes it owns and its SOPs.
 * Seen by the practice viewers (owner, branch head, compliance); changed by
 * whoever manages the practice.
 */

import { Briefcase } from "lucide-react";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { can } from "@/lib/auth/rbac";
import { canManagePractice, canViewPractice } from "@/lib/practice/access";
import { loadPositions, loadTeamForPositions } from "@/lib/practice/positions";
import { OWNER_POSITION_KEY } from "@/lib/metrics/owner-dependency";
import { PageHeaderCard } from "@/components/layout/PageHeaderCard";
import { PracticeNav } from "@/components/practice/PracticeNav";
import { EmptyState } from "@/components/common/EmptyState";
import { PositionsBoard } from "@/components/practice/PositionsBoard";
import { PositionSeedButton } from "@/components/practice/PositionSeedButton";

export const dynamic = "force-dynamic";

export default async function PositionsPage() {
  const session = await requireSession();

  if (!canViewPractice(session)) {
    return (
      <div className="space-y-6">
        <PageHeaderCard title="Positions" />
        <div className="card-surface p-8 text-sm text-muted-foreground">
          The firm&apos;s positions are open to the owner, branch heads and compliance.
        </div>
      </div>
    );
  }

  const canManage = canManagePractice(session) && can(session.roles, "settings.users", session.permissions);
  const { positions, team } = await withTenant(session.tenantId, async (tx) => ({
    positions: await loadPositions(tx, session.tenantId),
    team: canManage ? await loadTeamForPositions(tx, session.tenantId) : [],
  }), { userId: session.userId, branchId: session.branchId ?? undefined, roles: session.roles });

  const n = positions.length;
  const vacant = positions.filter((p) => p.holders.length === 0).length;
  const ownerFills = positions.filter((p) => p.holders.some((h) => h.roles.includes("owner"))).length;
  const ownerOnly = positions.filter((p) =>
    p.key !== OWNER_POSITION_KEY && p.holders.length > 0 && p.holders.every((h) => h.roles.includes("owner"))).length;

  return (
    <div className="space-y-6">
      <PageHeaderCard
        title="Positions"
        subtitle="Organise the firm by the jobs it needs done, each with a contract — then put people in them. A firm whose every job is the owner's cannot run without the owner."
      />
      <PracticeNav active="positions" />

      {n === 0 ? (
        <EmptyState
          icon={Briefcase}
          title="Organise the firm by positions, not people"
          description="A position is a job with a contract: what it is for, the results it answers for and what it may approve. Start from the seven positions of a typical MFD practice — Owner / Director, Branch Head, Relationship Manager, Operations, Service Desk, Compliance and Marketing — with holders suggested from each person's role. You can edit every one."
          tip="Write the positions down even if you fill most of them yourself today. Seeing which ones only you fill is the first step to handing them over."
          secondaryNode={canManage ? <PositionSeedButton /> : undefined}
        />
      ) : (
        <>
          <p className="text-sm text-muted-foreground">
            <span className="font-medium text-foreground">{n} position{n === 1 ? "" : "s"}</span>
            {" · "}
            <span className={vacant ? "font-medium text-warning-foreground" : undefined}>{vacant} without a holder</span>
            {" · "}
            the owner fills {ownerFills} of {n}
            {ownerOnly > 0 && <> ({ownerOnly} alone)</>}
          </p>
          <PositionsBoard
            positions={positions.map((p) => ({
              id: p.id, key: p.key, title: p.title, purpose: p.purpose, results: p.results, approvals: p.approvals,
              holders: p.holders, processes: p.processes, sops: p.sops,
            }))}
            team={team}
            canManage={canManage}
          />
        </>
      )}
    </div>
  );
}
