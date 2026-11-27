/**
 * Couriers — the Excel / CSV import. Columns are specs/couriers.ts. A row is held
 * to the same rules as the Add courier form (lib/couriers/entry.ts), except that
 * a detail belonging to the other type is refused rather than silently dropped.
 * The route checks the firm's `courierRegister` switch before anything here runs.
 */
import { courierEntries } from "@/db/schema";
import type { Tx } from "@/db/client";
import type { SessionUser } from "@/lib/auth/session";
import { requireAny } from "@/lib/auth/rbac";
import { COURIER_WRITE_CAPS } from "@/lib/couriers/access";
import { COURIER_LABELS, CourierBody, otherSideFields, type CourierInput, type CourierType } from "@/lib/couriers/entry";
import type { ImportModule, Problem } from "./run";
import { EXAMPLE_TRACKING_NUMBERS, couriersSpec } from "./specs/couriers";
import { parseDay, parseEnum } from "./values";

const EXAMPLES = new Set<string>(EXAMPLE_TRACKING_NUMBERS.map((t) => t.toLowerCase()));

export const couriersImport: ImportModule<null, CourierInput> = {
  spec: couriersSpec,

  // Whoever may add one courier may add many.
  authorize(session) {
    requireAny(session.roles, COURIER_WRITE_CAPS, session.permissions);
  },

  async prepare() {
    return null;
  },

  parse(row) {
    if (EXAMPLES.has(row.get("trackingNumber").trim().toLowerCase())) {
      row.fail("trackingNumber", "This is an example row from the sample file — delete it");
      return null;
    }

    // Choices accept their label ("KYC Documents"); dates are day first.
    const values: Record<string, string> = {};
    for (const c of couriersSpec.columns) {
      const raw = row.get(c.key).trim();
      if (!raw) {
        if (c.required) row.fail(c.key, "Required");
        continue;
      }
      if (c.kind === "enum" || c.kind === "date") {
        const p = c.kind === "date" ? parseDay(raw) : parseEnum(raw, c.options!);
        if (p.ok) values[c.key] = p.value;
        else row.fail(c.key, p.error);
      } else {
        values[c.key] = row.get(c.key);
      }
    }

    const type = values.courierType as CourierType | undefined;
    if (!type) return null; // which details apply is not known

    for (const field of otherSideFields(type)) {
      if (row.get(field).trim()) {
        const only = type === "inward" ? "Outward" : "Inward";
        row.fail(field, `${COURIER_LABELS[field]} is only for ${only} couriers — leave it blank`);
        delete values[field];
      }
    }
    if (values.categoryOther && values.category !== "other") {
      row.fail("categoryOther", "Only used when Courier Category is Other — leave it blank");
    }

    const parsed = CourierBody.safeParse({
      ...values,
      // Stand-ins for a required cell already reported, so the other cells are still checked.
      courierDate: values.courierDate ?? "2000-01-01",
      status: values.status ?? "returned",
    });
    if (!parsed.success) {
      for (const issue of parsed.error.issues) row.fail(String(issue.path[0]), issue.message);
      return null;
    }
    return row.failed ? null : parsed.data;
  },

  async commit(tx: Tx, session: SessionUser, items) {
    const failed: Problem[] = [];
    let saved = 0;
    for (const { n, item } of items) {
      try {
        await tx.transaction(async (sp) => {
          await sp.insert(courierEntries).values({ ...item, tenantId: session.tenantId, createdBy: session.userId });
        });
        saved++;
      } catch (e) {
        failed.push({ row: n, column: "—", message: `Could not be saved: ${(e as Error).message?.slice(0, 160) ?? "database error"}` });
      }
    }
    return { saved, failed };
  },
};
