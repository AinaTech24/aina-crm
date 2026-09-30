/**
 * A user-facing message from anything that was thrown. `catch (e: any)` +
 * `e.message` showed a BLANK error whenever the thrown value wasn't an Error
 * (a string, a rejected fetch body, undefined); this always returns text.
 */
export function errorMessage(e: unknown, fallback = "Something went wrong. Please try again."): string {
  if (e instanceof Error && e.message) return e.message;
  if (typeof e === "string" && e.trim()) return e;
  if (e && typeof e === "object" && typeof (e as { message?: unknown }).message === "string" && (e as { message: string }).message) {
    return (e as { message: string }).message;
  }
  return fallback;
}
