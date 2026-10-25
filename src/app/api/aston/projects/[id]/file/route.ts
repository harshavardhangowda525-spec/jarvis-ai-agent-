import path from "node:path";
import { requireUser } from "@/lib/auth/session";
import { fail, handleError } from "@/lib/api";
import { studioFile } from "@/lib/aston/studio/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TYPES: Record<string, string> = { ".png": "image/png", ".json": "application/json", ".html": "text/plain; charset=utf-8", ".css": "text/plain; charset=utf-8", ".js": "text/plain; charset=utf-8", ".svg": "text/plain; charset=utf-8", ".txt": "text/plain; charset=utf-8", ".xml": "text/plain; charset=utf-8" };

/** ?v=3&path=site/index.html (the code, as text) or tests/index-mobile.png (a screenshot). Owner only. */
export async function GET(req: Request, { params }: { params: { id: string } }) {
  try {
    const user = await requireUser();
    const u = new URL(req.url);
    const n = Number(u.searchParams.get("v"));
    const rel = u.searchParams.get("path") ?? "";
    if (!Number.isInteger(n) || n < 1 || !rel) return fail("Not found.", 404);
    const f = await studioFile(user.id, params.id, n, rel);
    const type = f ? TYPES[path.extname(f.full).toLowerCase()] : null;
    if (!f || !type) return fail("Not found.", 404);
    return new Response(new Uint8Array(f.body), { headers: { "Content-Type": type, "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" } });
  } catch (e) {
    return handleError(e);
  }
}
