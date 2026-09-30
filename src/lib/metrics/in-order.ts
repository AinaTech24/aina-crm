/**
 * Run queries that share ONE transaction one after another.
 *
 * A transaction is one connection: `Promise.all` over it is not parallel (the
 * queries queue on the client anyway), node-postgres warns that overlapping
 * `client.query()` calls are deprecated, and pg@9 rejects them outright. Use
 * this wherever several metric calls take the same `tx`:
 *
 *   const [aum, sip] = await inOrder(() => getAUM(tx, s), () => getSipBook(tx, s));
 *
 * Work that runs in SEPARATE transactions (one per dashboard card) is still
 * `Promise.all` behind `runLimit`.
 */

export async function inOrder<T extends readonly (() => Promise<unknown>)[]>(
  ...thunks: T
): Promise<{ -readonly [K in keyof T]: Awaited<ReturnType<T[K]>> }> {
  const out: unknown[] = [];
  for (const t of thunks) out.push(await t());
  return out as { -readonly [K in keyof T]: Awaited<ReturnType<T[K]>> };
}
