import { NextResponse } from "next/server";
import { v4 as uuid } from "uuid";

/**
 * Global API error handling helper.
 *
 * Masks internal database and execution errors, while safely passing
 * user-facing validation (400), auth (401), license (402), or permission (403) errors.
 * Generates a unique reference ID for any masked internal error so developers
 * can search server logs.
 */
export function handleApiError(err: unknown): NextResponse {
  const errorId = uuid();

  // Extract HTTP status if present on the error object
  const status =
    err && typeof err === "object" && "status" in err && typeof err.status === "number"
      ? err.status
      : 500;

  const originalMessage = err instanceof Error ? err.message : String(err);
  const stack = err instanceof Error ? err.stack : undefined;

  // Log on the server console with the unique reference ID
  console.error(`[API Error ${errorId}] status=${status} message="${originalMessage}"`, stack ?? err);

  // User-facing HTTP errors (4xx) are safe to return, but we mask obvious database keywords.
  if (status >= 400 && status < 500) {
    const isPgLeak =
      originalMessage.includes("relation") ||
      originalMessage.includes("duplicate key") ||
      originalMessage.includes("violates unique constraint") ||
      originalMessage.includes("syntax error at or near") ||
      originalMessage.includes("database");
    
    const safeMsg = isPgLeak ? "invalid request" : originalMessage;
    return NextResponse.json({ error: safeMsg }, { status });
  }

  // Internal/DB errors (500) return a generic message + tracking ID
  return NextResponse.json(
    { error: "internal", referenceId: errorId },
    { status: 500 }
  );
}
