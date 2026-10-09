/**
 * A Postgres array literal whose ELEMENTS ARE BOUND PARAMETERS:
 *   boundUuidArray(ids)  →  ARRAY[$1, $2, …]::uuid[]
 *
 * Use it instead of building `ARRAY['…','…']` text with sql.raw — a value in
 * the SQL text can be injected, and it lands in the slow-query log, where a
 * bound parameter does not (log_parameter_max_length = 0). An empty list gives
 * `ARRAY[]::uuid[]`, which Postgres accepts and matches nothing.
 */
import { sql, type SQL } from "drizzle-orm";

function boundArray(values: readonly string[], pgType: "uuid" | "text"): SQL {
  return sql`ARRAY[${sql.join(values.map((v) => sql`${v}`), sql`, `)}]::${sql.raw(pgType)}[]`;
}

export const boundUuidArray = (ids: readonly string[]): SQL => boundArray(ids, "uuid");
export const boundTextArray = (values: readonly string[]): SQL => boundArray(values, "text");
