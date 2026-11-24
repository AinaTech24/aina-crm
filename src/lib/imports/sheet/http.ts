/**
 * The two HTTP handlers every module's import shares: the import itself (check or
 * save) and the sample workbook download. Each module route file names its own capability and calls these.
 */
import { NextResponse } from "next/server";
import { requireSession, type SessionUser } from "@/lib/auth/session";
import { handleApiError } from "@/lib/api/error-handler";
import { runSheetImport, type ImportModule } from "./run";
import { buildSampleWorkbook, sampleFileName } from "./write";

/**
 * Run the import for a session the ROUTE has already checked (each route file names its own
 * capability, which is what `npm run check:rbac` looks for). `mod.authorize` repeats it as a backstop.
 */
export async function importResponse<P, I>(req: Request, session: SessionUser, mod: ImportModule<P, I>): Promise<Response> {
  const mode = new URL(req.url).searchParams.get("mode") === "import" ? "import" : "check";
  return NextResponse.json(await runSheetImport(req, session, mod, mode));
}

/** The sample workbook download. */
export async function sampleResponse<P, I>(mod: ImportModule<P, I>): Promise<Response> {
  try {
    const session = await requireSession();
    mod.authorize(session);
    return new NextResponse(new Uint8Array(buildSampleWorkbook(mod.spec)), {
      headers: {
        "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "content-disposition": `attachment; filename="${sampleFileName(mod.spec)}"`,
        "cache-control": "no-store",
      },
    });
  } catch (err) {
    return handleApiError(err);
  }
}
