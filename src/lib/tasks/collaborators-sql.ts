/** The SQL twin of `collaborators.ts`. */

import { sql, type SQL } from "drizzle-orm";

const column = (alias: string, name: string) => sql.raw(alias ? `${alias}.${name}` : name);

/** Shared with this person. `alias` names the tasks table; "" = bare columns. */
export function collaboratorSql(userId: string, alias = "tasks"): SQL {
  return sql`${column(alias, "collaborator_ids")} ? ${userId}`;
}

/** Assigned to this person, or shared with them. */
export function worksOnSql(userId: string, alias = "tasks"): SQL {
  return sql`(${column(alias, "assignee_id")} = ${userId}::uuid OR ${collaboratorSql(userId, alias)})`;
}
