/**
 * Bulk PROVISIONAL risk profiles from age, for one firm, from the server.
 *
 * The same thing Risk Profiles → "Bulk assign by age" does, for a run the
 * platform team makes on a firm's behalf. It calls the screen's own
 * planAgeAssignment / applyAgeAssignment, so the two can never disagree:
 *
 *  - every profile written is PROVISIONAL ("Suggested · awaiting
 *    confirmation"), never a signed one — it does not satisfy the proposal
 *    suitability gate until the client confirms through their link;
 *  - a client who answered the questionnaire is never touched;
 *  - a client with no date of birth is skipped and counted, never guessed.
 *
 * Bands are "upTo:category" pairs, last one open-ended. The default makes
 * most of a typical book Aggressive while keeping the oldest clients lower:
 *     60:aggressive,70:moderate,conservative
 *
 * USAGE (dry run unless --apply):
 *   tsx scripts/bulk-risk-by-age.ts --arn ARN-90577
 *   tsx scripts/bulk-risk-by-age.ts --arn ARN-90577 --apply
 *   tsx scripts/bulk-risk-by-age.ts --arn ARN-90577 --bands "55:aggressive,conservative" --apply
 *   add --refresh to also re-derive clients who already carry a SUGGESTED profile
 */

import { sql } from "drizzle-orm";
import { withSystem, withTenant } from "../src/db/client";
import { AgeBandsSchema, CATEGORY_LABEL, bandLabel, type AgeBand } from "../src/lib/risk-profile/age-bands";
import { applyAgeAssignment, planAgeAssignment } from "../src/lib/risk-profile/bulk-age-assign";
import { RISK_CATEGORIES, type RiskCategory } from "../src/lib/risk-profile/apply";
import { recordAudit } from "../src/lib/audit";

const args = process.argv.slice(2);
const flag = (name: string) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] ?? null : null;
};
const APPLY = args.includes("--apply");
const REFRESH = args.includes("--refresh");
const ARN = flag("--arn");
const TENANT = flag("--tenant");
const BATCH = 500;

function parseBands(raw: string): AgeBand[] {
  const bands = raw.split(",").map((part) => {
    const [a, b] = part.trim().split(":");
    const category = (b ?? a).trim() as RiskCategory;
    if (!RISK_CATEGORIES.includes(category)) throw new Error(`Unknown category "${category}" (use ${RISK_CATEGORIES.join(", ")})`);
    return { upTo: b === undefined ? null : Number(a), category };
  });
  const parsed = AgeBandsSchema.safeParse(bands);
  if (!parsed.success) throw new Error(parsed.error.issues.map((i) => i.message).join("; "));
  return parsed.data;
}

async function main() {
  if (!ARN && !TENANT) throw new Error("Pass --arn <ARN> or --tenant <uuid>.");
  const bands = parseBands(flag("--bands") ?? "60:aggressive,70:moderate,conservative");

  const firm = await withSystem(async (tx) => {
    const r = await tx.execute(sql`
      SELECT t.id, COALESCE(t.display_name, t.legal_name) AS name, t.arn,
             (SELECT u.id FROM users u
               WHERE u.tenant_id = t.id AND 'owner' = ANY(u.roles)
               ORDER BY u.created_at LIMIT 1) AS owner_id
        FROM tenants t
       WHERE ${TENANT ? sql`t.id = ${TENANT}::uuid` : sql`upper(t.arn) = upper(${ARN})`}
    `);
    return (r.rows as any[])[0] ?? null;
  });
  if (!firm) throw new Error(`No firm found for ${TENANT ?? ARN}.`);
  if (!firm.owner_id) throw new Error(`${firm.name} has no owner user to record the change against.`);

  console.log(`\nFirm: ${firm.name} (${firm.arn ?? "no ARN"})  ${firm.id}`);
  console.log("Bands:");
  bands.forEach((b, i) => console.log(`  ${bandLabel(bands, i).padEnd(8)} → ${CATEGORY_LABEL[b.category]}`));

  const plan = await withTenant(firm.id, (tx) =>
    planAgeAssignment(tx, { tenantId: firm.id, bands, refreshProvisional: REFRESH })
  );
  const c = plan.counts;
  console.log(`\nActive clients:                        ${c.active}`);
  console.log(`  already have a client-answered profile ${c.already_profiled}  (never touched)`);
  console.log(`  no date of birth                       ${c.no_dob}  (skipped)`);
  console.log(`  already at the suggested category      ${c.unchanged}`);
  console.log(`  WILL be given a suggested profile      ${c.assign}`);
  for (const cat of RISK_CATEGORIES) {
    if (plan.byCategory[cat]) console.log(`    ${CATEGORY_LABEL[cat].padEnd(16)} ${plan.byCategory[cat]}`);
  }
  if (c.active > 0) {
    const pct = Math.round(((plan.byCategory.aggressive ?? 0) / c.active) * 100);
    console.log(`  → ${pct}% of all active clients would be suggested Aggressive by this run`);
  }

  if (!APPLY) {
    console.log("\nDry run — nothing written. Re-run with --apply to write.\n");
    return;
  }

  let assigned = 0;
  let failed = 0;
  for (let i = 0; i < plan.assign.length; i += BATCH) {
    const slice = { ...plan, assign: plan.assign.slice(i, i + BATCH) };
    const r = await withTenant(
      firm.id,
      (tx) => applyAgeAssignment(tx, { tenantId: firm.id, plan: slice, userId: firm.owner_id }),
      { userId: firm.owner_id, roles: ["owner"] }
    );
    assigned += r.assigned.length;
    failed += r.failed.length;
    r.failed.slice(0, 5).forEach((f) => console.log(`  failed ${f.investorId}: ${f.error}`));
    console.log(`  ${Math.min(i + BATCH, plan.assign.length)} / ${plan.assign.length}`);
  }

  await withTenant(firm.id, (tx) =>
    recordAudit(tx, {
      tenantId: firm.id,
      actorUserId: firm.owner_id,
      action: "risk_profile.bulk_assign_by_age",
      entityType: "investor",
      entityId: null,
      after: { bands, assigned, failed, skipped: c, provisional: true, via: "scripts/bulk-risk-by-age.ts" } as any,
    })
  );

  console.log(`\nDone: ${assigned} suggested profiles written, ${failed} failed.`);
  console.log("They show as \"Suggested · awaiting confirmation\" until each client confirms.\n");
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(`\n${e?.message ?? e}\n`);
    process.exit(1);
  });
