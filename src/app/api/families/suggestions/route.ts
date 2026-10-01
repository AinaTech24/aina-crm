/**
 * GET /api/families/suggestions — clients not in any family who look like they
 * belong to one.
 *
 *   add_to_family  — shares a mobile, email or home address with a member of a
 *                    family, or their RTA record names that family's head;
 *   create_family  — two or more unmapped clients who share one of those, or
 *                    whose RTA records name the same family head.
 *
 * What changed, and why:
 *  · Only clients THIS person can see (lib/investors/access) and families they
 *    can see (lib/families/access). It used to scan the whole firm and put
 *    other RMs' clients' mobile numbers and emails in its reasons.
 *  · Live clients only — no merged-away duplicates, no closed accounts.
 *  · No masked bank number matching: "XXXX1234" is shared by strangers, and it
 *    was labelled a HIGH-confidence match.
 *  · A contact detail shared by more than six clients (an RM's own mobile typed
 *    in for everyone, an office address) is noise, not a family, and is skipped.
 *  · Indexed lookups instead of two nested loops over the whole book.
 *  · New: the family head named on the client's RTA record (`family_owner_name`).
 */

import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { handleApiError } from "@/lib/api/error-handler";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { investorScopeSql, requireInvestorView } from "@/lib/investors/access";
import { familyScopeSql } from "@/lib/families/access";
import { aliveClient } from "@/lib/metrics/scope";

export const dynamic = "force-dynamic";

type Row = {
  id: string;
  name: string;
  pan: string | null;
  phone: string | null;
  email: string | null;
  address: any;
  family_owner_name: string | null;
  family_id: string | null;
  family_name: string | null;
  aum: string | null;
  active_sip_amount: string | null;
};

const MAX_SHARED = 6;
const MAX_RESULTS = 200;

const phoneKey = (p: string | null) => {
  const d = (p ?? "").replace(/\D/g, "");
  return d.length >= 10 ? d.slice(-10) : "";
};
const emailKey = (e: string | null) => (e ?? "").trim().toLowerCase();
const addrKey = (a: any) => {
  if (!a || typeof a !== "object") return "";
  const l1 = String(a.line1 ?? "").trim().toLowerCase().replace(/\s+/g, " ");
  const city = String(a.city ?? "").trim().toLowerCase();
  return l1 && city ? `${l1}|${city}` : "";
};
const nameKey = (n: string | null) => (n ?? "").trim().toLowerCase().replace(/\s+/g, " ");

export async function GET() {
  try {
    const session = await requireSession();
    requireInvestorView(session);

    const suggestions = await withTenant(session.tenantId, async (tx) => {
      const clientScope = await investorScopeSql(tx, session, "i");
      const famScope = await familyScopeSql(tx, session, "f");
      const rows = (await tx.execute(sql`
        SELECT i.id, i.name, i.pan, i.phone, i.email, i.address, i.family_owner_name,
               f.id AS family_id, COALESCE(f.family_name, f.head_name) AS family_name,
               i.aum, i.active_sip_amount
          FROM investors i
          LEFT JOIN families f ON f.id = i.family_id AND ${famScope}
         WHERE i.tenant_id = ${session.tenantId}::uuid AND ${aliveClient("i")} AND ${clientScope}
      `)).rows as Row[];

      const unlinked = rows.filter((r) => !r.family_id);
      const linked = rows.filter((r) => r.family_id);

      // How many clients carry each key — a key on more than MAX_SHARED is noise.
      const freq = new Map<string, number>();
      const bump = (k: string) => k && freq.set(k, (freq.get(k) ?? 0) + 1);
      for (const r of rows) {
        bump(`p:${phoneKey(r.phone)}`);
        bump(`e:${emailKey(r.email)}`);
        bump(`a:${addrKey(r.address)}`);
      }
      const usable = (k: string) => !k.endsWith(":") && (freq.get(k) ?? 0) <= MAX_SHARED;

      // Linked members by key, and families by their head's / members' names.
      const linkedBy = new Map<string, Row>();
      const familyByMemberName = new Map<string, Row>();
      for (const l of linked) {
        for (const k of [`p:${phoneKey(l.phone)}`, `e:${emailKey(l.email)}`, `a:${addrKey(l.address)}`]) {
          if (usable(k) && !linkedBy.has(k)) linkedBy.set(k, l);
        }
        const nk = nameKey(l.name);
        if (nk && !familyByMemberName.has(nk)) familyByMemberName.set(nk, l);
      }

      const brief = (r: Row) => ({
        id: r.id,
        name: r.name,
        pan: r.pan ?? "",
        aum: Number(r.aum ?? 0),
        activeSipAmount: Number(r.active_sip_amount ?? 0),
      });

      const results: any[] = [];
      const used = new Set<string>();

      // A. Into an existing family.
      for (const inv of unlinked) {
        const checks: Array<[string, string, "high" | "medium"]> = [
          [`p:${phoneKey(inv.phone)}`, "the same mobile number as", "high"],
          [`e:${emailKey(inv.email)}`, "the same email as", "high"],
          [`a:${addrKey(inv.address)}`, "the same home address as", "medium"],
        ];
        let hit: { member: Row; reason: string; confidence: "high" | "medium" } | null = null;
        for (const [k, phrase, conf] of checks) {
          const m = usable(k) ? linkedBy.get(k) : undefined;
          if (m) { hit = { member: m, reason: `Has ${phrase} ${m.name}, who is in this family`, confidence: conf }; break; }
        }
        if (!hit) {
          const owner = nameKey(inv.family_owner_name);
          const m = owner && owner !== nameKey(inv.name) ? familyByMemberName.get(owner) : undefined;
          if (m) hit = { member: m, reason: `Their RTA record names ${m.name} as the family head`, confidence: "high" };
        }
        if (hit && hit.member.family_id) {
          results.push({
            type: "add_to_family",
            investor: brief(inv),
            targetFamily: { id: hit.member.family_id, name: hit.member.family_name ?? "Family" },
            reason: hit.reason,
            confidence: hit.confidence,
          });
          used.add(inv.id);
        }
      }

      // B. A new family from unmapped clients that belong together.
      const groups = new Map<string, { rows: Row[]; reason: string; confidence: "high" | "medium" }>();
      const addTo = (key: string, r: Row, reason: string, confidence: "high" | "medium") => {
        const g = groups.get(key) ?? { rows: [], reason, confidence };
        g.rows.push(r);
        groups.set(key, g);
      };
      for (const inv of unlinked) {
        if (used.has(inv.id)) continue;
        const owner = nameKey(inv.family_owner_name);
        if (owner) addTo(`o:${owner}`, inv, `Their RTA records name the same family head (${inv.family_owner_name})`, "high");
        const p = `p:${phoneKey(inv.phone)}`;
        if (usable(p)) addTo(p, inv, "They share a mobile number", "high");
        const e = `e:${emailKey(inv.email)}`;
        if (usable(e)) addTo(e, inv, "They share an email address", "high");
        const a = `a:${addrKey(inv.address)}`;
        if (usable(a)) addTo(a, inv, "They share a home address", "medium");
      }
      // Strongest signals first: RTA head, then mobile/email, then address.
      const order = (k: string) => (k.startsWith("o:") ? 0 : k.startsWith("a:") ? 2 : 1);
      for (const [key, g] of [...groups.entries()].sort((x, y) => order(x[0]) - order(y[0]))) {
        const members = g.rows.filter((r) => !used.has(r.id));
        if (members.length < 2) continue;
        // The head: the person the RTA names, else the largest book.
        const ownerName = key.startsWith("o:") ? key.slice(2) : "";
        const head =
          members.find((m) => ownerName && nameKey(m.name) === ownerName) ??
          [...members].sort((x, y) => Number(y.aum ?? 0) - Number(x.aum ?? 0))[0];
        const partners = members.filter((m) => m.id !== head.id);
        results.push({
          type: "create_family",
          investor: brief(head),
          potentialPartners: partners.map(brief),
          reason: g.reason,
          confidence: g.confidence,
        });
        for (const m of members) used.add(m.id);
        if (results.length >= MAX_RESULTS) break;
      }

      return results.slice(0, MAX_RESULTS);
    });

    return NextResponse.json({ suggestions });
  } catch (err: any) {
    return handleApiError(err);
  }
}
