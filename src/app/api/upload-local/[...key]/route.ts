import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import { requireSession } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

const ROOT = path.join(process.cwd(), "node-local", "uploads");

/** Resolve the key under ROOT, rejecting path-traversal (`../`) escapes. */
function safePath(key: string[]): string | null {
  const full = path.resolve(ROOT, key.join("/"));
  if (full !== ROOT && !full.startsWith(ROOT + path.sep)) return null;
  return full;
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ key: string[] }> }) {
  try {
    await requireSession(); // must be signed in to store a file
    const { key } = await params;
    const filePath = safePath(key);
    if (!filePath) return NextResponse.json({ error: "bad key" }, { status: 400 });

    const buffer = Buffer.from(await req.arrayBuffer());
    if (buffer.length === 0) return NextResponse.json({ error: "empty body" }, { status: 400 });
    if (buffer.length > 15 * 1024 * 1024) {
      return NextResponse.json({ error: "file too large (max 15MB)" }, { status: 413 });
    }

    await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
    await fs.promises.writeFile(filePath, buffer);
    return NextResponse.json({ success: true });
  } catch (err: any) {
    const status = typeof err?.status === "number" ? err.status : 500;
    return NextResponse.json({ error: status === 401 ? "unauthorized" : "upload failed" }, { status });
  }
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ key: string[] }> }) {
  try {
    const { key } = await params;
    const filePath = safePath(key);
    if (!filePath || !fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
      return NextResponse.json({ error: "File not found" }, { status: 404 });
    }

    const data = await fs.promises.readFile(filePath);

    // Map file extension to standard MIME types
    const ext = path.extname(filePath).toLowerCase();
    let contentType = "application/octet-stream";
    if (ext === ".png") contentType = "image/png";
    else if (ext === ".jpg" || ext === ".jpeg") contentType = "image/jpeg";
    else if (ext === ".gif") contentType = "image/gif";
    else if (ext === ".svg") contentType = "image/svg+xml";
    else if (ext === ".pdf") contentType = "application/pdf";
    else if (ext === ".ico") contentType = "image/x-icon";
    else if (ext === ".webp") contentType = "image/webp";

    return new NextResponse(data, {
      headers: {
        "Content-Type": contentType,
        "Cache-Control": "public, max-age=31536000, immutable",
      },
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
