/**
 * Plan and coarse category for a scheme, derived from what AMFI publishes.
 *
 * Both are SQL fragments rather than JS so the sync (which stores them) and
 * the Scheme Master page (which fills the gaps a stored row still has) read
 * the same rules and cannot drift.
 *
 * Why the page needs them at all: about 40% of the AMFI feed carries no plan
 * (closed FMPs, ETFs and pre-2013 plans that name neither "Direct" nor
 * "Regular"), and the category headers for legacy and fund-of-fund schemes
 * ("Income", "Growth", "Other Scheme - FoF Overseas", …) matched none of the
 * old keywords, so ~6,000 schemes sat under "Other".
 *
 * Regex note: in a drizzle sql`` template a backslash must be doubled to
 * reach Postgres (`\\m` → `\m`, the start-of-word anchor).
 */

import { sql, type SQL } from "drizzle-orm";

/**
 * "direct" | "regular" | NULL.
 *
 * Every Direct plan says so in its name (SEBI has required a separately named
 * Direct plan since 2013). A scheme that names no plan is the distributor
 * plan — or, for an ETF, no plan at all, since an ETF is bought on the
 * exchange: that stays NULL.
 */
export function planSql(name: SQL, category: SQL): SQL {
  return sql`CASE
    WHEN ${name} ~* '\\m(direct|dir)\\M' THEN 'direct'
    WHEN ${name} ~* '\\mregular\\M' THEN 'regular'
    WHEN ${name} ~* '\\metf\\M' OR ${category} ~* '\\metfs?\\M' THEN NULL
    ELSE 'regular'
  END`;
}

/**
 * Coarse bucket: equity | hybrid | debt | liquid | commodity | international
 * | other. The AMFI category decides where it is specific; where it is not
 * (legacy "Income" / "Growth", funds of funds, "Other ETFs", solution-oriented
 * funds) the scheme name decides. Only what neither can place stays "other".
 */
export function coarseSql(category: SQL, name: SQL): SQL {
  const c = category;
  const n = name;
  return sql`CASE
    WHEN ${c} ~* '(liquid|overnight|money market)' THEN 'liquid'
    WHEN ${c} ~* '(overseas|international|global)'
      OR (${c} ~* '(fof|fund of funds|etf|other scheme)'
          AND ${n} ~* '(overseas|nasdaq|s&p 500|hang seng|nyse|fang|global|world|international|us equity|us bluechip|greater china|japan|taiwan|emerging market|europe)') THEN 'international'
    WHEN ${c} ~* '(hybrid|balanced|arbitrage|asset allocation|multi asset|equity savings)' THEN 'hybrid'
    WHEN ${c} ~* '(gold|silver|commodit)' OR ${n} ~* '\\m(gold|silver)\\M' THEN 'commodity'
    WHEN ${c} ~* '(debt|bond|gilt|duration|credit risk|floater|banking and psu|corporate|fmp|fixed maturity)' THEN 'debt'
    WHEN ${c} ~* '(index|etf|fof|fund of funds|other scheme)'
         AND ${n} ~* '(bond|gilt|g-sec|gsec|\\msdl\\M|t-bill|treasury|money market|liquid|debt|crisil ibx|target maturity|overnight)' THEN 'debt'
    WHEN ${c} ~* '(index|etf|fof|fund of funds|other scheme)'
         AND ${n} ~* '(hybrid|balanced|arbitrage|asset allocat|multi.?asset|dynamic|conservative|aggressive)' THEN 'hybrid'
    WHEN ${c} ~* '(equity|elss|index|etf)' THEN 'equity'
    WHEN ${c} ~* '(fof|fund of funds|other scheme)' AND ${n} ~* '(equity|nifty|sensex|\\mbse\\M|flexi|large|mid|small|value|momentum|quality|alpha|bharat 22|sector|defence)' THEN 'equity'
    -- Legacy AMFI headings: "Income" was the old name for debt schemes and
    -- "Growth" for equity schemes.
    WHEN ${c} ~* '^\\s*income' THEN 'debt'
    WHEN ${c} ~* '^\\s*growth' THEN 'equity'
    -- Retirement, children's and life-cycle funds: the name usually says
    -- which (HDFC Retirement Savings Fund - Hybrid Debt Plan); otherwise they
    -- are multi-asset by design.
    WHEN ${c} ~* '(solution oriented|retirement|children|life cycle)' AND ${n} ~* '(debt|conservative|income)' THEN 'debt'
    WHEN ${c} ~* '(solution oriented|retirement|children|life cycle)' AND ${n} ~* '(equity|aggressive)' AND ${n} !~* 'hybrid' THEN 'equity'
    WHEN ${c} ~* '(solution oriented|retirement|children|life cycle)' THEN 'hybrid'
    ELSE 'other'
  END`;
}
