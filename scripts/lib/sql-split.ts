/**
 * Split a migration into top-level statements.
 *
 * Lives in its own module so it can be tested without importing
 * `migrate-all.ts`, which runs the migration on import.
 *
 * Only the `migrate:no-transaction` path needs this. A multi-statement SIMPLE
 * query is executed by Postgres as ONE implicit transaction, so a file
 * containing `CREATE INDEX CONCURRENTLY` fails with "cannot run inside a
 * transaction block" even though the runner sent no BEGIN. Sending each
 * statement as its own query is what psql does, and is the only way those
 * statements can run.
 *
 * Aware of line and block comments, single-quoted literals and dollar-quoted
 * bodies (`$$ … $$`, `$tag$ … $tag$`), so a `;` inside a DO block is not
 * mistaken for a statement boundary.
 */
export function splitStatements(sqlText: string): string[] {
  const out: string[] = [];
  let buf = "";
  let i = 0;
  while (i < sqlText.length) {
    const ch = sqlText[i];
    const two = sqlText.slice(i, i + 2);

    if (two === "--") {
      const nl = sqlText.indexOf("\n", i);
      const end = nl === -1 ? sqlText.length : nl;
      buf += sqlText.slice(i, end);
      i = end;
      continue;
    }
    if (two === "/*") {
      const end = sqlText.indexOf("*/", i + 2);
      const stop = end === -1 ? sqlText.length : end + 2;
      buf += sqlText.slice(i, stop);
      i = stop;
      continue;
    }
    if (ch === "'") {
      let j = i + 1;
      while (j < sqlText.length) {
        if (sqlText[j] === "'" && sqlText[j + 1] === "'") j += 2;
        else if (sqlText[j] === "'") break;
        else j++;
      }
      buf += sqlText.slice(i, j + 1);
      i = j + 1;
      continue;
    }
    if (ch === "$") {
      const tag = /^\$[A-Za-z_]?[A-Za-z0-9_]*\$/.exec(sqlText.slice(i));
      if (tag) {
        const close = sqlText.indexOf(tag[0], i + tag[0].length);
        const stop = close === -1 ? sqlText.length : close + tag[0].length;
        buf += sqlText.slice(i, stop);
        i = stop;
        continue;
      }
    }
    if (ch === ";") {
      if (buf.trim()) out.push(buf.trim());
      buf = "";
      i++;
      continue;
    }
    buf += ch;
    i++;
  }
  if (buf.trim()) out.push(buf.trim());
  // A trailing comment-only fragment is not a statement.
  return out.filter((st) => st.split("\n").some((l) => l.trim() && !l.trim().startsWith("--")));
}
