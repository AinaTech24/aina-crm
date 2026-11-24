/**
 * Who a row's "Assigned To", "Client" or "Lead" cell means — looked up ONCE for the
 * whole file, never row by row. Each lookup answers with a person or with the
 * sentence that goes in the problems list ("2 clients are named …").
 *
 * Clients and leads are found only among those the importing person may see
 * (investorScopeSql / leadScopeSql): an import cannot link a record the person could
 * not open, which is the rule every other create path keeps.
 */
import { sql } from "drizzle-orm";
import type { Tx } from "@/db/client";
import type { SessionUser } from "@/lib/auth/session";
import { investorScopeSql } from "@/lib/investors/access";
import { leadScopeSql } from "@/lib/leads/access";
import { phoneKey } from "./values";

export type Found<T> = { ok: true; value: T } | { ok: false; error: string };
const found = <T>(value: T): Found<T> => ({ ok: true, value });
const miss = <T = never>(error: string): Found<T> => ({ ok: false, error });

const nameKey = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();
const list = (xs: string[]) => sql.join(xs.map((x) => sql`${x}`), sql`, `);

/* ── Team members ───────────────────────────────────────────────────────── */

export type UserRef = { id: string; name: string; email: string | null; department: string | null; branchId: string | null; roles: string[] };

export class UserLookup {
  private byEmail = new Map<string, UserRef>();
  private byName = new Map<string, UserRef[]>();
  constructor(public readonly all: UserRef[]) {
    for (const u of all) {
      if (u.email) this.byEmail.set(u.email.toLowerCase(), u);
      const k = nameKey(u.name);
      this.byName.set(k, [...(this.byName.get(k) ?? []), u]);
    }
  }
  /** A team member by email (exact) or full name (must be unique). */
  find(text: string): Found<UserRef> {
    const t = text.trim();
    const byMail = this.byEmail.get(t.toLowerCase());
    if (byMail) return found(byMail);
    const named = this.byName.get(nameKey(t)) ?? [];
    if (named.length === 1) return found(named[0]);
    if (named.length > 1) return miss(`${named.length} team members are called “${t}” — use the email`);
    return miss(`“${t}” is not an active team member — use their email or full name as in Team`);
  }
}

export async function loadUsers(tx: Tx, tenantId: string): Promise<UserLookup> {
  const r = await tx.execute(sql`
    SELECT id::text AS id, name, email, department, branch_id::text AS "branchId", roles
      FROM users WHERE tenant_id = ${tenantId}::uuid AND status = 'active'
  `);
  return new UserLookup((r.rows as unknown as UserRef[]).map((u) => ({ ...u, name: u.name ?? "", roles: u.roles ?? [] })));
}

/* ── Clients ────────────────────────────────────────────────────────────── */

export type ClientRef = { id: string; name: string; pan: string | null; rmId: string | null; branchId: string | null };
export type ClientAsk = { pan?: string; name?: string };

export class ClientLookup {
  private byPan = new Map<string, ClientRef[]>();
  private byName = new Map<string, ClientRef[]>();
  constructor(rows: ClientRef[]) {
    for (const c of rows) {
      if (c.pan) this.byPan.set(c.pan.toUpperCase(), [...(this.byPan.get(c.pan.toUpperCase()) ?? []), c]);
      const k = nameKey(c.name);
      this.byName.set(k, [...(this.byName.get(k) ?? []), c]);
    }
  }
  /** By PAN when one is given (a PAN that matches nobody is an error, never a fall-back to the name), else by exact name. */
  find({ pan, name }: ClientAsk): Found<ClientRef | null> {
    const p = pan?.trim().toUpperCase();
    if (p) {
      const hit = this.byPan.get(p) ?? [];
      if (hit.length === 1) return found(hit[0]);
      if (hit.length > 1) return miss(`${hit.length} clients share the PAN ${p}`);
      return miss(`No client with PAN ${p} that you can see`);
    }
    const n = name?.trim();
    if (n) {
      const hit = this.byName.get(nameKey(n)) ?? [];
      if (hit.length === 1) return found(hit[0]);
      if (hit.length > 1) return miss(`${hit.length} clients are named “${n}” — add the PAN`);
      return miss(`No client named “${n}” that you can see — check the spelling or add the PAN`);
    }
    return found(null);
  }
}

export async function loadClients(tx: Tx, session: SessionUser, asks: ClientAsk[]): Promise<ClientLookup> {
  const pans = [...new Set(asks.map((a) => a.pan?.trim().toUpperCase()).filter((x): x is string => !!x))];
  const names = [...new Set(asks.map((a) => (a.name ? nameKey(a.name) : "")).filter(Boolean))];
  if (!pans.length && !names.length) return new ClientLookup([]);
  const scope = await investorScopeSql(tx, session, "investors");
  const match = [pans.length ? sql`upper(pan) IN (${list(pans)})` : null, names.length ? sql`lower(regexp_replace(trim(name), '\\s+', ' ', 'g')) IN (${list(names)})` : null]
    .filter((x): x is NonNullable<typeof x> => !!x);
  const r = await tx.execute(sql`
    SELECT id::text AS id, name, pan, rm_id::text AS "rmId", branch_id::text AS "branchId"
      FROM investors
     WHERE tenant_id = ${session.tenantId}::uuid AND deleted_at IS NULL AND merged_into_id IS NULL
       AND ${scope} AND (${sql.join(match, sql` OR `)})
  `);
  return new ClientLookup(r.rows as unknown as ClientRef[]);
}

/* ── Leads ──────────────────────────────────────────────────────────────── */

export type LeadRef = { id: string; name: string; ownerId: string | null };
export type LeadAsk = { mobile?: string; name?: string };

export class LeadLookup {
  private byPhone = new Map<string, LeadRef[]>();
  private byName = new Map<string, LeadRef[]>();
  constructor(rows: Array<LeadRef & { phone: string | null }>) {
    for (const l of rows) {
      const p = l.phone ? phoneKey(l.phone) : "";
      if (p.length === 10) this.byPhone.set(p, [...(this.byPhone.get(p) ?? []), l]);
      const k = nameKey(l.name);
      this.byName.set(k, [...(this.byName.get(k) ?? []), l]);
    }
  }
  find({ mobile, name }: LeadAsk): Found<LeadRef | null> {
    const m = mobile ? phoneKey(mobile) : "";
    if (mobile?.trim()) {
      if (m.length !== 10) return miss(`“${mobile.trim()}” is not a 10-digit mobile number`);
      const hit = this.byPhone.get(m) ?? [];
      if (hit.length === 1) return found(hit[0]);
      if (hit.length > 1) return miss(`${hit.length} leads have the mobile ${m}`);
      return miss(`No lead with mobile ${m} that you can see`);
    }
    const n = name?.trim();
    if (n) {
      const hit = this.byName.get(nameKey(n)) ?? [];
      if (hit.length === 1) return found(hit[0]);
      if (hit.length > 1) return miss(`${hit.length} leads are named “${n}” — add the mobile number`);
      return miss(`No lead named “${n}” that you can see — check the spelling or add the mobile number`);
    }
    return found(null);
  }
}

export async function loadLeads(tx: Tx, session: SessionUser, asks: LeadAsk[]): Promise<LeadLookup> {
  const phones = [...new Set(asks.map((a) => (a.mobile ? phoneKey(a.mobile) : "")).filter((p) => p.length === 10))];
  const names = [...new Set(asks.map((a) => (a.name ? nameKey(a.name) : "")).filter(Boolean))];
  if (!phones.length && !names.length) return new LeadLookup([]);
  const scope = leadScopeSql(session, "leads");
  const match = [
    phones.length ? sql`right(regexp_replace(coalesce(phone, ''), '\\D', '', 'g'), 10) IN (${list(phones)})` : null,
    names.length ? sql`lower(regexp_replace(trim(name), '\\s+', ' ', 'g')) IN (${list(names)})` : null,
  ].filter((x): x is NonNullable<typeof x> => !!x);
  const r = await tx.execute(sql`
    SELECT id::text AS id, name, phone, owner_id::text AS "ownerId"
      FROM leads
     WHERE tenant_id = ${session.tenantId}::uuid AND ${scope} AND (${sql.join(match, sql` OR `)})
  `);
  return new LeadLookup(r.rows as unknown as Array<LeadRef & { phone: string | null }>);
}
