/**
 * The "summary of personal data" a person may ask for (DPDP Act s.11): what
 * the firm holds about them, the records behind it, their consents, and who
 * it is shared with. Read-only; rendered by
 * /dashboard/privacy-requests/[id]/summary for staff to check and send.
 *
 * The PAN is masked and a bank account shows only what is already masked —
 * the summary is printed and emailed, and a misdirected copy must not carry
 * a full identifier. Each count is in its own savepoint, so a table a firm
 * has never used (or an older database) leaves a gap, not a failed page.
 */

import { sql } from "drizzle-orm";
import type { Tx } from "@/db/client";
import { formatDate, formatMoney, humanise } from "@/lib/format";
import type { Subject } from "./requests";

export type SummaryRow = { label: string; value: string };
export type SummarySection = { heading: string; rows: SummaryRow[]; note?: string };
export type DataSummary = { name: string; kind: "Client" | "Lead"; sections: SummarySection[] } | null;

const maskPan = (pan: string | null | undefined) =>
  pan && /^[A-Z]{5}\d{4}[A-Z]$/i.test(pan) ? `${pan.slice(0, 2)}XXXXX${pan.slice(7)}`.toUpperCase() : null;

function addr(a: unknown): string | null {
  if (!a || typeof a !== "object") return null;
  const o = a as Record<string, unknown>;
  const s = [o.line1, o.line2, o.city, o.state, o.pincode, o.country].filter((x) => typeof x === "string" && x.trim()).join(", ");
  return s || null;
}

function rows(pairs: Array<[string, unknown]>): SummaryRow[] {
  return pairs
    .map(([label, v]) => [label, v instanceof Date ? formatDate(v) : v] as const)
    .filter(([, v]) => v !== null && v !== undefined && String(v).trim() !== "")
    .map(([label, v]) => ({ label, value: String(v) }));
}

async function one<T>(tx: Tx, q: ReturnType<typeof sql>): Promise<T | null> {
  try {
    return await tx.transaction(async (sp) => ((await sp.execute(q)).rows[0] as T) ?? null);
  } catch {
    return null;
  }
}

async function all<T>(tx: Tx, q: ReturnType<typeof sql>): Promise<T[]> {
  try {
    return await tx.transaction(async (sp) => (await sp.execute(q)).rows as T[]);
  } catch {
    return [];
  }
}

export async function loadDataSummary(tx: Tx, tenantId: string, subject: Subject): Promise<DataSummary> {
  return subject.type === "investor" ? clientSummary(tx, tenantId, subject.id) : leadSummary(tx, tenantId, subject.id);
}

async function clientSummary(tx: Tx, tenantId: string, id: string): Promise<DataSummary> {
  const i = await one<Record<string, any>>(tx, sql`
    SELECT i.*, u.name AS rm_name, f.name AS family_name
      FROM investors i
      LEFT JOIN users u ON u.id = i.rm_id
      LEFT JOIN families f ON f.id = i.family_id
     WHERE i.tenant_id = ${tenantId}::uuid AND i.id = ${id}::uuid`);
  if (!i) return null;

  const nominees = Array.isArray(i.nominees) ? (i.nominees as Array<Record<string, unknown>>) : [];
  const banks = Array.isArray(i.bank_accounts) ? (i.bank_accounts as Array<Record<string, unknown>>) : [];

  // One after another: each is a savepoint on the same connection.
  const txn = await one<{ n: number; first: string | null; last: string | null }>(tx, sql`
      SELECT count(*)::int AS n, min(coalesce(order_date, created_at::date))::text AS first, max(coalesce(order_date, created_at::date))::text AS last
        FROM transactions WHERE tenant_id = ${tenantId}::uuid AND investor_id = ${id}::uuid`);
  const docs = await all<{ title: string }>(tx, sql`
      SELECT title FROM compliance_documents
       WHERE tenant_id = ${tenantId}::uuid AND related_entity_type = 'investor' AND related_entity_id = ${id}::uuid AND deleted_at IS NULL
       ORDER BY created_at DESC LIMIT 50`);
  const comms = await all<{ channel: string; n: number; last: string }>(tx, sql`
      SELECT channel, count(*)::int AS n, max(created_at)::text AS last FROM communications
       WHERE tenant_id = ${tenantId}::uuid AND investor_id = ${id}::uuid GROUP BY channel ORDER BY channel`);
  const meet = await one<{ n: number }>(tx, sql`SELECT count(*)::int AS n FROM review_meetings WHERE tenant_id = ${tenantId}::uuid AND investor_id = ${id}::uuid`);
  const sr = await one<{ n: number }>(tx, sql`SELECT count(*)::int AS n FROM service_requests WHERE tenant_id = ${tenantId}::uuid AND investor_id = ${id}::uuid`);
  const sips = await one<{ n: number; folios: number }>(tx, sql`
      SELECT (SELECT count(*)::int FROM sips WHERE tenant_id = ${tenantId}::uuid AND investor_id = ${id}::uuid AND status = 'active') AS n,
             (SELECT count(*)::int FROM folios WHERE tenant_id = ${tenantId}::uuid AND investor_id = ${id}::uuid) AS folios`);
  const consentRows = await consentsFor(tx, tenantId, "investor", id);

  return {
    name: i.name,
    kind: "Client",
    sections: [
      {
        heading: "Identity and contact",
        rows: rows([
          ["Name", i.name],
          ["Name as per PAN", i.name_as_per_pan],
          ["PAN", maskPan(i.pan)],
          ["Date of birth", i.dob ? formatDate(i.dob) : null],
          ["Gender", i.gender],
          ["Email", i.email],
          ["Mobile", i.phone],
          ["Alternate phone", i.alternate_phone],
          ["WhatsApp", i.whatsapp_phone],
          ["Address", addr(i.address)],
          ["Place of birth", i.birth_place],
          ["Mother's name", i.mother_name],
          ["Marital status", i.marital_status],
          ["Anniversary", i.anniversary_date ? formatDate(i.anniversary_date) : null],
          ["Occupation", i.occupation],
          ["Employer", i.employer_name],
          ["Income range", i.income_range],
          ["Second holder", [i.second_holder_first_name, i.second_holder_last_name].filter(Boolean).join(" ")],
        ]),
      },
      {
        heading: "KYC and account details",
        rows: rows([
          ["Client type", i.investor_category],
          ["Tax status", i.tax_status],
          ["Residency", i.residency_status],
          ["KYC status", i.kyc_status],
          ["KYC registration agency", i.kra_name],
          ["Aadhaar (last 4 digits)", i.aadhaar_last4],
          ["Mode of holding", i.mode_of_holding],
          ["Bank account", i.bank_account_number_masked ? `${i.bank_name ?? ""} ${i.bank_account_number_masked}`.trim() : null],
          ...banks.map((b, n) => [`Bank account ${n + 1}`, [b.bankName ?? b.bank_name, b.accountNumberMasked ?? b.masked].filter(Boolean).join(" ")] as [string, unknown]),
          ["Risk profile", i.risk_profile ? `${i.risk_profile}${i.risk_profile_signed_at ? ` (signed ${formatDate(i.risk_profile_signed_at)})` : ""}` : null],
        ]),
      },
      {
        heading: "Family and nominees",
        rows: rows([
          ["Family", i.family_name],
          ["Nominee", i.nominee_name ? `${i.nominee_name}${i.nominee_relation ? ` (${i.nominee_relation})` : ""}` : null],
          ...nominees.map((nm, n) => [`Nominee ${n + 1}`, [nm.name, nm.relation ? `(${nm.relation})` : null].filter(Boolean).join(" ")] as [string, unknown]),
        ]),
      },
      {
        heading: "Records we hold",
        rows: rows([
          ["Relationship manager", i.rm_name],
          ["Client since", i.onboarded_at ? formatDate(i.onboarded_at) : null],
          ["Folios", sips ? String(sips.folios) : null],
          ["Current value", Number(i.aum) > 0 ? formatMoney(Number(i.aum)) : null],
          ["Active SIPs", sips ? String(sips.n) : null],
          ["Transactions", txn && txn.n ? `${txn.n} (${txn.first ? formatDate(txn.first) : "—"} to ${txn.last ? formatDate(txn.last) : "—"})` : null],
          ["Meetings", meet?.n ? String(meet.n) : null],
          ["Service requests", sr?.n ? String(sr.n) : null],
          ["Messages", comms.length ? comms.map((c) => `${c.n} ${c.channel}`).join(", ") : null],
          ["Documents", docs.length ? docs.map((d) => d.title).join(", ") : null],
        ]),
      },
      { heading: "Consents", rows: consentRows, note: consentRows.length ? undefined : "No consent recorded." },
    ],
  };
}

async function leadSummary(tx: Tx, tenantId: string, id: string): Promise<DataSummary> {
  const l = await one<Record<string, any>>(tx, sql`
    SELECT l.*, u.name AS owner_name FROM leads l LEFT JOIN users u ON u.id = l.owner_id
     WHERE l.tenant_id = ${tenantId}::uuid AND l.id = ${id}::uuid`);
  if (!l) return null;
  const comms = await all<{ channel: string; n: number }>(tx, sql`
    SELECT channel, count(*)::int AS n FROM communications
     WHERE tenant_id = ${tenantId}::uuid AND lead_id = ${id}::uuid GROUP BY channel ORDER BY channel`);
  const consentRows = await consentsFor(tx, tenantId, "lead", id);
  return {
    name: l.name,
    kind: "Lead",
    sections: [
      {
        heading: "Identity and contact",
        rows: rows([
          ["Name", l.name],
          ["Email", l.email],
          ["Mobile", l.phone],
          ["Alternate phone", l.alt_phone],
          ["Alternate email", l.alt_email],
          ["PAN", maskPan(l.pan)],
          ["City", l.city],
          ["Pincode", l.pincode],
        ]),
      },
      {
        heading: "Records we hold",
        rows: rows([
          ["How we met", l.source ? humanise(l.source) : null],
          ["Referred by", l.referred_by_name],
          ["Looked after by", l.owner_name],
          ["First recorded", l.created_at ? formatDate(l.created_at) : null],
          ["Notes about the enquiry", l.notes || l.follow_up_notes ? "Yes — kept with the enquiry" : null],
          ["Messages", comms.length ? comms.map((c) => `${c.n} ${c.channel}`).join(", ") : null],
        ]),
      },
      { heading: "Consents", rows: consentRows, note: consentRows.length ? undefined : "No consent recorded." },
    ],
  };
}

const SOURCE_LABEL: Record<string, string> = {
  lead_form: "Website enquiry form",
  docs_form: "Document upload form",
  discovery_form: "Financial health check form",
  email_notice: "Privacy notice sent by email",
};

async function consentsFor(tx: Tx, tenantId: string, type: "investor" | "lead", id: string): Promise<SummaryRow[]> {
  const privacy = await all<{ kind: string; source: string; notice_version: number; created_at: string; withdrawn_at: string | null }>(tx, sql`
    SELECT kind, source, notice_version, created_at::text, withdrawn_at::text FROM privacy_consents
     WHERE tenant_id = ${tenantId}::uuid AND subject_type = ${type} AND subject_id = ${id}::uuid ORDER BY created_at`);
  const out: SummaryRow[] = privacy.map((p) => ({
    label: SOURCE_LABEL[p.source] ?? p.source,
    value: `${p.kind === "consent" ? "Agreed" : "Sent"} ${formatDate(p.created_at)} · notice version ${p.notice_version}${p.withdrawn_at ? ` · withdrawn ${formatDate(p.withdrawn_at)}` : ""}`,
  }));
  if (type === "investor") {
    const comms = await all<{ channel: string; scope: string; status: string; updated_at: string }>(tx, sql`
      SELECT channel, scope, status, updated_at::text FROM consents
       WHERE tenant_id = ${tenantId}::uuid AND investor_id = ${id}::uuid ORDER BY channel, scope`);
    for (const c of comms) {
      out.push({ label: `${c.channel} — ${c.scope} messages`, value: `${c.status} (${formatDate(c.updated_at)})` });
    }
  }
  return out;
}
