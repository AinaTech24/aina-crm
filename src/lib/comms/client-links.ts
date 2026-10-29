/**
 * Per-recipient merge tokens for client-facing action emails: the client's risk
 * profile result (`risk.*`), their portfolio-vs-profile suitability
 * (`suitability.*`), and login-free action links (`link.*`).
 *
 * Why this exists: every client-facing starter template used to point its CTA at
 * `{{system.dashboard_url}}`, which is the MFD's OWN login page. A client who
 * clicked it hit an auth wall — the email asked them to do something they could
 * not do. These tokens resolve to real `/r/<token>` and `/f/<token>` links the
 * recipient can actually open.
 *
 * Tokens are minted lazily and ONLY when the template body references them (the
 * pipeline checks the body string first), so an ordinary send never creates a
 * share token. An unexpired, unused token for the same (subject, kind) is
 * REUSED rather than re-minted, so re-sending the same email twice doesn't
 * invalidate the link already sitting in the client's inbox.
 *
 * Everything here is best-effort: a failure returns fewer tokens, never throws.
 * An unresolved token renders blank rather than blocking the send.
 */

import { and, desc, eq, gt, isNull, sql } from "drizzle-orm";
import type { Tx } from "@/db/client";
import { shareTokens } from "@/db/schema";
import { createShareToken, type ShareTokenKind } from "@/lib/share-tokens";
import { assetClassOf } from "@/lib/investors/asset-class";

/** Merge-token namespaces this module can fill. */
export const CLIENT_LINK_NAMESPACES = ["risk.", "suitability.", "link."] as const;

/**
 * The schemes that carry value but are neither equity, hybrid nor debt as far as
 * the CRM can tell — named, with the category each has (or none), so the RM
 * knows which fund to look at. A folio whose schemes have no value of their own
 * shares its AUM between them, exactly as `assetClassExposure` does, so those
 * count too. Null when there is nothing to name.
 */
export function unclassifiedSchemes(
  folios: Array<{
    aum?: string | number | null;
    schemes?: Array<{ schemeName?: string | null; category?: string | null; value?: number | null }> | null;
  }>
): string | null {
  const found = new Map<string, string>();
  for (const f of folios) {
    const schemes = f.schemes ?? [];
    const haveValues = schemes.some((sc) => Number(sc.value ?? 0) > 0);
    const share = schemes.length ? Number(f.aum ?? 0) / schemes.length : 0;
    for (const sc of schemes) {
      if (assetClassOf(sc.category ?? undefined) !== "other") continue;
      const worth = haveValues ? Number(sc.value ?? 0) : share;
      if (!(worth > 0)) continue;
      const name = String(sc.schemeName ?? "").trim() || "an unnamed scheme";
      const cat = String(sc.category ?? "").trim();
      found.set(name, cat ? `${name} (category: ${cat})` : `${name} (no category)`);
    }
  }
  if (!found.size) return null;
  const list = [...found.values()];
  const shown = list.slice(0, 4).join("; ");
  return `Could not tell equity from debt for: ${shown}${list.length > 4 ? ` and ${list.length - 4} more` : ""}. Set a category on a scheme that has none, or send a different note - a gold or fund-of-funds category cannot be counted as equity or debt.`;
}

/** Does this template body reference anything we can fill? */
export function wantsClientLinkTokens(bodyStr: string): {
  risk: boolean;
  suitability: boolean;
  riskLink: boolean;
  feedbackLink: boolean;
} {
  return {
    risk: bodyStr.includes("risk."),
    suitability: bodyStr.includes("suitability."),
    riskLink: bodyStr.includes("link.risk_profile"),
    feedbackLink: bodyStr.includes("link.feedback"),
  };
}

/** How long a link emailed to a client stays valid. */
const LINK_DAYS = { risk_profile: 21, feedback: 30 } as const;

function fmtDate(d: unknown): string {
  if (!d) return "";
  const dd = d instanceof Date ? d : new Date(`${String(d)}${String(d).length === 10 ? "T00:00:00" : ""}`);
  return isNaN(dd.getTime())
    ? ""
    : dd.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}

function titleCase(s: string): string {
  return String(s ?? "").replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

/**
 * Reuse a live token for this subject+kind, or mint a new one. Reuse matters:
 * without it a reminder email would silently kill the link in the first email.
 */
async function liveLink(
  tx: Tx,
  opts: {
    tenantId: string;
    kind: Extract<ShareTokenKind, "risk_profile" | "feedback">;
    subjectType: "investor" | "lead";
    subjectId: string;
    createdBy?: string;
  }
): Promise<string> {
  // A token's plaintext is only known at mint time (the row stores a SHA-256
  // hash), so a reusable row must carry its URL in the payload. Rows minted
  // before this module existed have no payload.url and are simply skipped.
  const [existing] = await tx
    .select({ payload: shareTokens.payload })
    .from(shareTokens)
    .where(
      and(
        eq(shareTokens.tenantId, opts.tenantId),
        eq(shareTokens.kind, opts.kind),
        eq(shareTokens.subjectType, opts.subjectType),
        eq(shareTokens.subjectId, opts.subjectId),
        isNull(shareTokens.usedAt),
        isNull(shareTokens.revokedAt),
        // Leave a day's headroom: a link that expires tomorrow is no use in an
        // email the client may open this evening.
        gt(shareTokens.expiresAt, sql`now() + interval '1 day'`)
      )
    )
    .orderBy(desc(shareTokens.expiresAt))
    .limit(1);

  const reusable = (existing?.payload as { url?: string } | null)?.url;
  if (reusable) return reusable;

  const minted = await createShareToken({
    tenantId: opts.tenantId,
    kind: opts.kind,
    subjectType: opts.subjectType,
    subjectId: opts.subjectId,
    expiresInDays: LINK_DAYS[opts.kind],
    createdBy: opts.createdBy,
    payload: { source: "email_merge_field" },
  });

  // Store the URL so the next send reuses this same link.
  await tx
    .update(shareTokens)
    .set({ payload: { source: "email_merge_field", url: minted.url } as any })
    .where(eq(shareTokens.id, minted.id));

  return minted.url;
}

/**
 * Build the `risk.*` / `suitability.* `/ `link.*` tokens for one recipient.
 * Returns dotted keys ready to drop into the renderer's token map.
 */
export async function loadClientLinkTokens(
  tx: Tx,
  input: {
    tenantId: string;
    subjectType: "investor" | "lead";
    subjectId: string;
    want: ReturnType<typeof wantsClientLinkTokens>;
    createdBy?: string;
  }
): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  const { tenantId, subjectType, subjectId, want } = input;

  // ── Risk profile result + the band's meaning ────────────────────────────
  if (want.risk || want.suitability) {
    try {
      const r = await tx.execute(sql`
        SELECT final_category, total_score, profile_date, next_review_at, signed_at
        FROM risk_profile_responses
        WHERE tenant_id = ${tenantId}::uuid AND investor_id = ${subjectId}::uuid
        ORDER BY COALESCE(signed_at, created_at) DESC
        LIMIT 1
      `);
      let row = (r.rows?.[0] ?? null) as
        | {
            final_category: string | null;
            total_score: number | string | null;
            profile_date: string | null;
            next_review_at: string | null;
            signed_at: string | null;
          }
        | null;

      // No response row (or one with no category)? Fall back to the CANONICAL
      // profile cached on the investor.
      //
      // The two can legitimately disagree. `investors.risk_profile` is what the
      // rest of the app treats as the client's profile — suitability keys off
      // it, the client 360 displays it — and it survives merges and re-imports
      // that a child `risk_profile_responses` row may not. Reading only the
      // response table meant a client with a perfectly good profile resolved to
      // an empty `risk.category`, which the required-variable gate turned into
      // a hard "Email blocked" the user had no way to diagnose.
      if (!row?.final_category && subjectType === "investor") {
        const cached = await resolveCanonicalProfile(tx, tenantId, subjectId);
        if (cached.category) {
          row = {
            final_category: cached.category,
            total_score: cached.score,
            profile_date: null,
            next_review_at: null,
            signed_at: cached.signedAt,
          };
        }
      }

      // No category anywhere = genuinely unprofiled. Leave the risk.* tokens
      // UNSET rather than writing empty strings, so a template that declares
      // its own `fallback` for them can still use it.
      if (row?.final_category) {
        // The band label / max score / description live on the tenant's active
        // questionnaire template, not on the response row.
        let bandLabel = row.final_category ? titleCase(row.final_category) : "";
        let bandDescription = "";
        let maxScore: number | null = null;
        try {
          const { loadActiveTemplate } = await import("@/lib/risk-profile/template");
          const tpl = await loadActiveTemplate(tx, tenantId);
          if (tpl) {
            maxScore = tpl.questions.reduce((s, q) => s + Math.max(...q.options.map((o) => o.score)), 0);
            const score = row.total_score != null ? Number(row.total_score) : null;
            // Match on the CATEGORY first, score only as a fallback. A category
            // set directly (applyRiskCategory — bulk age assignment, RM entry,
            // spreadsheet) stores a SYNTHETIC score from SCORE_BY_CATEGORY, not
            // a questionnaire total, so the score ranges can disagree with the
            // category the client was actually given. Worst case: a client
            // assigned `very_aggressive` (score 40) matched the default
            // template's `aggressive` band (30-40) — because the stock template
            // ships only three bands and has no very_aggressive — and the
            // result email told them the wrong risk category.
            // For a real questionnaire the two agree, because final_category
            // was itself derived from that score.
            const band =
              tpl.bands.find((b) => b.id === row.final_category) ??
              (score != null ? tpl.bands.find((b) => score >= b.minScore && score <= b.maxScore) : null);
            if (band) {
              // Never let a blank band label erase the fallback: `bands` is read
              // back as raw jsonb and is NOT re-validated, so a hand-edited
              // template can carry a label BandSchema would have rejected.
              // Blanking it here made `risk.category` empty, which the required-
              // variable gate turned into a hard "Email blocked" at send time.
              bandLabel = (band.label ?? "").trim() || bandLabel;
              bandDescription = band.description ?? "";
            }
          }
        } catch {
          /* template unreadable — fall back to the canonical category */
        }

        const score = row.total_score != null ? Number(row.total_score) : null;
        // Last guard. A client who HAS a category must never be blocked from
        // receiving their own result because the tenant's questionnaire
        // template is missing, unreadable or mis-banded.
        out["risk.category"] = bandLabel || titleCase(row.final_category ?? "");
        out["risk.score"] = score != null ? String(score) : "";
        out["risk.max_score"] = maxScore != null ? String(maxScore) : "";
        out["risk.score_display"] = score != null ? (maxScore ? `${score} / ${maxScore}` : String(score)) : "";
        out["risk.meaning"] = bandDescription;
        out["risk.profiled_on"] = fmtDate(row.profile_date ?? row.signed_at);
        out["risk.review_due"] = fmtDate(row.next_review_at);
      }
    } catch (e) {
      console.warn("[comms] risk token load skipped:", (e as Error)?.message);
    }
  }

  // ── Portfolio vs profile: the mismatch template's subject matter ────────
  if (want.suitability && subjectType === "investor") {
    try {
      const [{ assessSuitability }, { assetClassExposure }] = await Promise.all([
        import("@/lib/investors/suitability"),
        import("@/lib/investors/asset-class"),
      ]);
      // The same holdings the client page shows: the live valuation (which
      // covers a client whose holdings come only from transactions), else the
      // stored folios — each with AMFI categories filled in.
      const { loadExposureBook } = await import("@/lib/investors/exposure-book");
      const folioRows = await loadExposureBook(tx, tenantId, subjectId);

      const exposure = assetClassExposure(folioRows as any);
      // assessSuitability keys off the canonical `investors.risk_profile` enum,
      // not the (firm-customisable) band label shown to the client.
      const { category: riskProfile } = await resolveCanonicalProfile(tx, tenantId, subjectId);
      let s = assessSuitability(riskProfile, exposure.equityPct, exposure.classifiedPct);
      // Name the actual gap — the RM's popup shows this when the send is refused.
      if (s.severity === "unknown" && s.profile) {
        const legs = folioRows.reduce((n, f) => n + (f.schemes?.length ?? 0), 0);
        const detail = folioRows.length === 0
          ? "No folio found for this client - no mutual fund holdings are on file."
          : legs === 0
            ? "This client's folios have no schemes (no mutual fund holdings or values) on file."
            : exposure.total === 0
              ? "This client's folios have no value on record - no balance or valuation has been imported for them - so there is no equity share to state."
              : unclassifiedSchemes(folioRows);
        if (detail) s = { ...s, message: detail };
      }

      out["suitability.status"] = s.severity;
      out["suitability.summary"] = s.message;
      out["suitability.equity_pct"] = exposure.equityPct != null ? String(Math.round(exposure.equityPct)) : "";
      out["suitability.band"] = s.band ? `${s.band.floor}-${s.band.ceiling}%` : "";

      // The schemes driving an over-exposure, largest first — so the email can
      // name what it is talking about instead of gesturing at "your portfolio".
      // Only meaningful when equity is ABOVE the profile's ceiling; an
      // under-invested client has no offending scheme to list.
      if (s.severity !== "ok" && s.severity !== "unknown" && s.band && (exposure.equityPct ?? 0) > s.band.ceiling) {
        const { equityScheme } = await import("@/lib/investors/asset-class");
        const rows: Array<{ name: string; value: number }> = [];
        for (const f of folioRows as any[]) {
          for (const sc of (f.schemes ?? []) as any[]) {
            if (!sc?.schemeName || !equityScheme(sc.category)) continue;
            rows.push({ name: String(sc.schemeName), value: Number(sc.value ?? 0) });
          }
        }
        // One folio's scheme can arrive as several per-ARN legs; sum by name.
        const byName = new Map<string, number>();
        for (const r of rows) byName.set(r.name, (byName.get(r.name) ?? 0) + r.value);
        const top = [...byName.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);
        // Plain text only. The email renderer HTML-escapes every merge value,
        // so a token carrying markup would render its own tags to the client.
        out["suitability.scheme_list"] = top.map(([n]) => n).join(", ");
      }
      // Never a blank under "The schemes this relates to": say why there is
      // no list. (Under the band, no single scheme is the cause; within it,
      // nothing is out of line.)
      if (!out["suitability.scheme_list"] && s.band && s.severity !== "unknown") {
        const e = exposure.equityPct ?? 0;
        out["suitability.scheme_list"] =
          e > s.band.ceiling
            ? "Your equity share comes from several holdings together rather than any single scheme."
            : e < s.band.floor
              ? "No single scheme — your equity share is below the usual range for this profile, not above it."
              : "None — your holdings sit within the usual range for this profile.";
      }
    } catch (e) {
      console.warn("[comms] suitability token load skipped:", (e as Error)?.message);
    }
  }

  // ── Login-free action links ─────────────────────────────────────────────
  if (want.riskLink) {
    try {
      out["link.risk_profile"] = await liveLink(tx, {
        tenantId,
        kind: "risk_profile",
        subjectType,
        subjectId,
        createdBy: input.createdBy,
      });
    } catch (e) {
      console.warn("[comms] risk-profile link mint skipped:", (e as Error)?.message);
    }
  }
  if (want.feedbackLink) {
    try {
      out["link.feedback"] = await liveLink(tx, {
        tenantId,
        kind: "feedback",
        subjectType,
        subjectId,
        createdBy: input.createdBy,
      });
    } catch (e) {
      console.warn("[comms] feedback link mint skipped:", (e as Error)?.message);
    }
  }

  return out;
}

/**
 * The canonical risk profile cached on `investors` — the enum the bands key
 * off, plus the score and signing date that sit beside it. This row is what the
 * rest of the app shows as the client's profile, so it is also the fallback
 * when no `risk_profile_responses` row survives.
 */
async function resolveCanonicalProfile(
  tx: Tx,
  tenantId: string,
  investorId: string
): Promise<{ category: string | null; score: number | null; signedAt: string | null }> {
  const r = await tx.execute(sql`
    SELECT risk_profile, risk_profile_score, risk_profile_signed_at
    FROM investors
    WHERE id = ${investorId}::uuid AND tenant_id = ${tenantId}::uuid LIMIT 1
  `);
  const row = r.rows?.[0] as
    | {
        risk_profile?: string | null;
        risk_profile_score?: number | null;
        risk_profile_signed_at?: string | Date | null;
      }
    | undefined;
  const signedAt = row?.risk_profile_signed_at;
  return {
    category: row?.risk_profile ?? null,
    score: row?.risk_profile_score ?? null,
    signedAt: signedAt ? new Date(signedAt).toISOString() : null,
  };
}
