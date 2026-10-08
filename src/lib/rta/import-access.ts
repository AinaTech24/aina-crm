/**
 * Who may see and run RTA imports — one rule for every import screen and API.
 *
 * An RTA import batch is FIRM-WIDE by construction: a registrar feed or master
 * carries every client of the ARN, and its row errors name them ("PAN … not in
 * client master", folio numbers, scheme rows). So viewing the batches and their
 * errors is not a per-client permission, it is the import capability itself:
 *
 *   1. the caller holds `transactions.execute` — the capability the upload route
 *      has always required (owner implicitly; ops / back_office / rm by role, or
 *      a custom grant), AND
 *   2. the caller's client book is NOT narrowed to their own clients / branch
 *      (`clientScopeNarrows`, the same rule every client list uses). A staff
 *      member walled to their own book must not read the whole firm's import
 *      errors — or upload a firm-wide file and read its outcome back.
 *
 * An owner always passes (can() + clientScopeNarrows both short-circuit).
 *
 * Every error/remark text that leaves the server goes through `maskImportText`
 * ON READ, so rows written before PANs were masked on write are masked too.
 */
import { withTenant } from "@/db/client";
import type { SessionUser } from "@/lib/auth/session";
import { can } from "@/lib/auth/rbac";
import { clientScopeNarrows } from "@/lib/investors/access";
import { maskPansInText } from "@/lib/rta/values";

export const RTA_IMPORT_CAPABILITY = "transactions.execute" as const;

export type RtaImportDenial = { status: 403; message: string };

/** Message shown when the capability is missing. */
export const NO_IMPORT_CAP_MESSAGE =
  "You need RTA import access to view or run RTA file imports. Ask the firm owner to grant it.";
/** Message shown when the caller is limited to their own clients. */
export const OWN_BOOK_MESSAGE =
  "RTA import batches cover the whole firm's client book, and your access is limited to your own clients. Ask the firm owner or operations team.";

/**
 * Decide access inside the caller's existing tenant transaction (the narrowing
 * check reads the firm's data-wall switch). Returns null when allowed.
 */
export async function rtaImportDenial(tx: any, session: SessionUser): Promise<RtaImportDenial | null> {
  if (!can(session.roles, RTA_IMPORT_CAPABILITY, session.permissions)) {
    return { status: 403, message: NO_IMPORT_CAP_MESSAGE };
  }
  if (await clientScopeNarrows(tx, session)) {
    return { status: 403, message: OWN_BOOK_MESSAGE };
  }
  return null;
}

/** Throwing form for API routes — the 403 is turned into JSON by handleApiError. */
export async function assertRtaImportAccess(tx: any, session: SessionUser): Promise<void> {
  const denial = await rtaImportDenial(tx, session);
  if (denial) throw Object.assign(new Error(denial.message), { status: denial.status });
}

/** Same check in its own tenant transaction (routes / pages with no open tx). */
export async function requireRtaImportAccess(session: SessionUser): Promise<void> {
  // Cheap capability check first — no DB round-trip for the common refusal.
  if (!can(session.roles, RTA_IMPORT_CAPABILITY, session.permissions)) {
    throw Object.assign(new Error(NO_IMPORT_CAP_MESSAGE), { status: 403 });
  }
  await withTenant(session.tenantId, (tx) => assertRtaImportAccess(tx, session), {
    userId: session.userId,
    branchId: session.branchId,
    roles: session.roles,
  });
}

/** Page form: null when allowed, else the denial to render. */
export async function rtaImportPageDenial(session: SessionUser): Promise<RtaImportDenial | null> {
  if (!can(session.roles, RTA_IMPORT_CAPABILITY, session.permissions)) {
    return { status: 403, message: NO_IMPORT_CAP_MESSAGE };
  }
  return withTenant(session.tenantId, (tx) => rtaImportDenial(tx, session), {
    userId: session.userId,
    branchId: session.branchId,
    roles: session.roles,
  });
}

// ── PAN masking on read ─────────────────────────────────────────────────────

/** Mask every PAN-shaped token in a stored error / remark text. Null-safe. */
export function maskImportText<T extends string | null | undefined>(text: T): T {
  if (typeof text !== "string" || !text) return text;
  return maskPansInText(text) as T;
}

type ImportError = { row?: unknown; reason?: unknown };

/** Mask the `reason` of every stored row error. Non-array input → []. */
export function maskImportErrors(errors: unknown): { row: number; reason: string }[] {
  if (!Array.isArray(errors)) return [];
  return (errors as ImportError[]).map((e) => ({
    row: Number(e?.row ?? 0),
    reason: maskPansInText(String(e?.reason ?? "")),
  }));
}

/** Mask the error-bearing fields of an rta_file_imports row (any subset). */
export function maskImportRow<R extends Record<string, any>>(row: R): R {
  const out: Record<string, any> = { ...row };
  if ("errors" in out) out.errors = out.errors == null ? out.errors : maskImportErrors(out.errors);
  if ("remarks" in out) out.remarks = maskImportText(out.remarks);
  return out as R;
}

/** A syntactically valid UUID — anything else is a 404, not a Postgres cast error (500). */
export function isUuid(v: string | null | undefined): v is string {
  return !!v && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
}
