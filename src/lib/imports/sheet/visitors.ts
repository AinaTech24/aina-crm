/**
 * Visitor Register — the Excel / CSV import. Columns are specs/visitors.ts. A row
 * is held to the same rules as the Add visitor form (lib/visitors/entry.ts). The
 * route checks the firm's `visitorRegister` switch before anything here runs.
 */
import { visitorEntries } from "@/db/schema";
import type { Tx } from "@/db/client";
import type { SessionUser } from "@/lib/auth/session";
import { requireAny } from "@/lib/auth/rbac";
import { VISITOR_WRITE_CAPS } from "@/lib/visitors/access";
import { EXIT_BEFORE_ENTRY, VisitorCreateBody, exitBeforeEntry, type VisitorInput } from "@/lib/visitors/entry";
import { loadUsers, type UserLookup } from "./lookups";
import type { ImportModule, Problem } from "./run";
import { visitorsSpec } from "./specs/visitors";
import { parseDay, parseTime } from "./values";

type Prep = { users: UserLookup };

const EXAMPLE_NAMES = new Set(visitorsSpec.examples.map((e) => e.visitorName.toLowerCase()));

export const visitorsImport: ImportModule<Prep, VisitorInput> = {
  spec: visitorsSpec,

  // Whoever may add one visit may add many.
  authorize(session) {
    requireAny(session.roles, VISITOR_WRITE_CAPS, session.permissions);
  },

  async prepare(tx, session) {
    return { users: await loadUsers(tx, session.tenantId) };
  },

  parse(row, prep) {
    if (EXAMPLE_NAMES.has(row.get("visitorName").trim().toLowerCase())) {
      row.fail("visitorName", "This is an example row from the sample file — delete it");
      return null;
    }

    // Dates are day first and times may be "3:00 pm"; the form's rules then apply to the tidy values.
    const read = (key: "visitDate" | "entryTime" | "exitTime", parse: typeof parseDay) => {
      const raw = row.get(key);
      if (!raw) {
        if (key === "visitDate") row.fail(key, "Required");
        return null;
      }
      const p = parse(raw);
      if (p.ok) return p.value;
      row.fail(key, p.error);
      return null;
    };
    const visitDate = read("visitDate", parseDay);
    const entryTime = read("entryTime", parseTime);
    const exitTime = read("exitTime", parseTime);
    if (exitBeforeEntry(entryTime, exitTime)) row.fail("exitTime", EXIT_BEFORE_ENTRY);

    let meetingWithUserId: string | null = null;
    if (row.get("meetingWithUserId")) {
      const found = prep.users.find(row.get("meetingWithUserId"));
      if (found.ok) meetingWithUserId = found.value.id;
      else row.fail("meetingWithUserId", found.error);
    }

    if (!row.get("visitorName").trim()) row.fail("visitorName", "Required");
    const parsed = VisitorCreateBody.safeParse({
      // Stand-ins for a required cell already reported, so the other cells are still checked.
      visitorName: row.get("visitorName").trim() || "—",
      visitDate: visitDate ?? "2000-01-01",
      email: row.get("email"),
      mobile: row.get("mobile"),
      companyName: row.get("companyName"),
      entryTime,
      exitTime,
      purpose: row.get("purpose"),
      meetingWithUserId,
      remarks: row.get("remarks"),
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
          await sp.insert(visitorEntries).values({ ...item, tenantId: session.tenantId, createdBy: session.userId });
        });
        saved++;
      } catch (e) {
        failed.push({ row: n, column: "—", message: `Could not be saved: ${(e as Error).message?.slice(0, 160) ?? "database error"}` });
      }
    }
    return { saved, failed };
  },
};
