import { requireOwner } from "@/lib/aston/auth";
import { getSite, siteHtml } from "@/lib/aston/site/builder";
import { astonError } from "@/lib/aston/ingest";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The website as one HTML file — opened full-screen (?download=0) or saved
 * (?download=1). Served under a CSP sandbox so the generated page runs in its
 * own opaque origin and can never touch JARVIS (cookies, APIs).
 */
export async function GET(req: Request, { params }: { params: { id: string } }) {
  try {
    const user = await requireOwner();
    const row = await getSite(user.id, params.id);
    const download = new URL(req.url).searchParams.get("download") === "1";
    const name = (row.title || "website").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 50) || "website";
    return new Response(siteHtml(row), {
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Content-Security-Policy": "sandbox allow-scripts allow-forms allow-popups",
        "X-Content-Type-Options": "nosniff",
        "Cache-Control": "no-store",
        ...(download ? { "Content-Disposition": `attachment; filename="${name}.html"` } : {}),
      },
    });
  } catch (err) {
    return astonError(err);
  }
}
