import { handleApiError } from "@/lib/api/error-handler";
/**
 * POST /api/investors/import/commit
 * Body: { mapping: Record<sourceHeader, ourField>, rows: object[] }
 *
 * Inserts the parsed rows as investors, deduping by (tenant_id, PAN).
 * Returns counts: inserted / skipped / errored, with per-row errors.
 */

import { NextRequest, NextResponse } from "next/server";
import { v4 as uuid } from "uuid";
import { sql } from "drizzle-orm";
import { z } from "zod";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { require as requireCap } from "@/lib/auth/rbac";
import { assertActiveLicense, loadTenantLicense } from "@/lib/auth/license";
import { recordAudit, clientMetaFromHeaders } from "@/lib/audit";
import { healthFields } from "@/lib/investors/health";
import { investors } from "@/db/schema";

export const dynamic = "force-dynamic";

const Body = z.object({
  mapping: z.record(z.string(), z.string()),
  // Cap the payload: the whole import runs in one transaction inserting row by
  // row, so an unbounded array would hold a write lock + memory for minutes.
  // 10k/upload is comfortably above a normal MFD book migration; larger books
  // should be split (a background-job importer is the longer-term fix).
  rows: z.array(z.record(z.string(), z.any())).max(10000),
});

export async function POST(req: NextRequest) {
  try {
    const session = await requireSession();
    requireCap(session.roles, "investor.edit.all");
    await assertActiveLicense(session.tenantId, session.roles);

    const parse = Body.safeParse(await req.json().catch(() => ({})));
    if (!parse.success) return NextResponse.json({ error: "invalid body" }, { status: 400 });
    const clientMeta = clientMetaFromHeaders(req.headers);

    const { mapping, rows } = parse.data;

    // Build the reverse map: ourField -> sourceHeader
    const reverse: Record<string, string> = {};
    for (const [src, our] of Object.entries(mapping)) {
      if (our) reverse[our] = src;
    }
    // Permissive import: a client row only needs ONE identifying field mapped.
    // PAN is frequently absent in a freshly-migrated book, so we no longer force
    // it — rows without a PAN get a clearly-marked placeholder (filled in later).
    if (!reverse.name && !reverse.pan && !reverse.email && !reverse.phone) {
      return NextResponse.json(
        { error: "map at least one identifying column: Name, PAN, Email or Mobile" },
        { status: 400 }
      );
    }

    let inserted = 0;
    let skipped = 0;
    let quotaSkipped = 0;
    const errors: Array<{ rowIndex: number; error: string }> = [];

    // Plan client-count gate. Rather than reject the whole import, fill up to
    // the plan cap and report the overflow as quota-skipped so a partial
    // import still lands. `room` is remaining capacity (Infinity if unlimited).
    const license = await loadTenantLicense(session.tenantId, session.roles);
    const cap = license.maxInvestors;
    let room = Infinity;
    if (cap && cap < 1e9) {
      const current = await withTenant(session.tenantId, async (tx) => {
        const r = (await tx.execute(
          sql`SELECT count(*)::int c FROM investors WHERE tenant_id = ${session.tenantId}::uuid AND status <> 'closed'`
        )).rows[0] as { c?: number } | undefined;
        return Number(r?.c ?? 0);
      });
      room = Math.max(0, cap - current);
    }

    await withTenant(session.tenantId, async (tx) => {
      for (let i = 0; i < rows.length; i++) {
        if (inserted >= room) {
          quotaSkipped++;
          continue;
        }
        const row = rows[i];
        const p = (f: string) => pick(row, reverse[f]) || null; // "" → null

        // Permissive import — clients may arrive with partial data. We don't
        // reject rows for missing/invalid PAN any more; the only thing that
        // disqualifies a row is having NOTHING usable at all.
        const rawName = String(row[reverse.name] ?? "").trim();
        const rawPan = String(row[reverse.pan] ?? "").trim().toUpperCase();
        const emailEarly = p("email");
        const phoneEarly = p("phone");

        // `name` is NOT NULL — fall back to whatever identifier exists.
        const name = rawName || emailEarly || phoneEarly || rawPan || "";
        if (!name) {
          errors.push({ rowIndex: i, error: "empty row — no name, PAN, email or mobile" });
          continue;
        }
        // `pan` is NOT NULL + unique. Keep the real (even if oddly-formatted)
        // PAN when present; otherwise mint a unique placeholder the RM can
        // replace later (it won't dedup, which is the desired behaviour).
        const pan = rawPan || `NOPAN-${uuid().slice(0, 8).toUpperCase()}`;

        const toDate = (f: string) => {
          const v = pick(row, reverse[f]);
          if (!v) return null;
          const d = new Date(v);
          return isNaN(d.getTime()) ? null : d;
        };
        const phone = p("phone");
        const whatsapp = p("whatsappPhone") ?? phone;
        const kycStatus = pick(row, reverse.kycStatus) || "pending";
        const nomineeName = p("nomineeName");
        const aadhaar = pick(row, reverse.aadhaarLast4).replace(/\D/g, "").slice(-4) || null;

        const h = healthFields({ status: "active", kycStatus: "pending" });

        try {
          const r = await tx
            .insert(investors)
            .values({
              id: uuid(),
              tenantId: session.tenantId,
              branchId: session.branchId ?? null,
              name,
              pan,
              nameAsPerPan: p("nameAsPerPan"),
              email: p("email"),
              emailRelation: p("emailRelation"),
              phone,
              mobileRelation: p("mobileRelation"),
              whatsappPhone: whatsapp,
              dob: p("dob"),
              gender: p("gender") as any,
              birthPlace: p("birthPlace"),
              motherName: p("motherName"),
              maritalStatus: p("maritalStatus"),
              occupation: p("occupation"),
              employerName: p("employerName"),
              aadhaarLast4: aadhaar,
              address: {
                line1: pick(row, reverse.addressLine1),
                city: pick(row, reverse.city),
                state: pick(row, reverse.state),
                pincode: pick(row, reverse.pincode),
                country: pick(row, reverse.country) || "India",
              },
              investorCategory: (p("investorCategory") ?? "individual") as any,
              segmentTag: p("segmentTag") as any,
              clientCategory: p("clientCategory") as any,
              householdType: p("householdType"),
              familyOwnerName: p("familyOwnerName"),
              referralClientName: p("referralClientName"),
              modeOfHolding: p("modeOfHolding"),
              bseUccCode: p("bseUccCode"),
              nseCanCode: p("nseCanCode"),
              taxStatus: p("taxStatus"),
              residencyStatus: p("residencyStatus") as any,
              kycStatus: kycStatus as any,
              secondHolderFirstName: p("secondHolderFirstName"),
              secondHolderLastName: p("secondHolderLastName"),
              secondHolderOccupation: p("secondHolderOccupation"),
              secondHolderCompanyName: p("secondHolderCompanyName"),
              secondHolderBirthPlace: p("secondHolderBirthPlace"),
              secondHolderMotherName: p("secondHolderMotherName"),
              secondHolderMaritalStatus: p("secondHolderMaritalStatus"),
              onboardedAt: toDate("onboardedAt") ?? new Date(),
              anniversaryDate: p("anniversaryDate"),
              lastReviewAt: toDate("lastReviewAt"),
              nextReviewAt: toDate("nextReviewAt"),
              reviewFrequency: p("reviewFrequency") as any,
              nomineeName,
              nomineeRelation: p("nomineeRelation"),
              nomineeDob: p("nomineeDob"),
              nominees: nomineeName
                ? [{ name: nomineeName, relation: pick(row, reverse.nomineeRelation) || undefined, dob: pick(row, reverse.nomineeDob) || undefined }]
                : [],
              bankName: p("bankName"),
              bankAccountNumberMasked: p("bankAccountNumberMasked"),
              bankIfsc: p("bankIfsc"),
              notes: p("notes"),
              rmId: session.userId,
              status: "active",
              ...h,
            } as any)
            .onConflictDoNothing({ target: [investors.tenantId, investors.pan] })
            .returning({ id: investors.id });
          if (r.length > 0) inserted++;
          else skipped++;
        } catch (err: any) {
          errors.push({ rowIndex: i, error: String(err.message ?? "insert failed") });
        }
      }

      await recordAudit(tx, {
        tenantId: session.tenantId,
        actorUserId: session.userId,
        action: "investor.bulk_import",
        entityType: "investor",
        entityId: null,
        meta: { inserted, skipped, quotaSkipped, errored: errors.length, totalRows: rows.length },
        ...clientMeta,
      });
    });

    return NextResponse.json({
      inserted,
      skipped,
      quotaSkipped,
      errored: errors.length,
      errors: errors.slice(0, 50),
      ...(quotaSkipped > 0
        ? { quotaMessage: `${quotaSkipped} client(s) were not imported because your plan's client limit (${cap}) was reached. Upgrade to add more.` }
        : {}),
    });
  } catch (err: any) {
    return handleApiError(err);
  }
}

function pick(row: Record<string, any>, header: string | undefined): string {
  if (!header) return "";
  const v = row[header];
  if (v === null || v === undefined) return "";
  return String(v).trim();
}
