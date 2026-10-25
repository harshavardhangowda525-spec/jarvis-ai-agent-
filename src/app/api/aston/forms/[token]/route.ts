import { rateLimit } from "@/lib/api";
import { FormError, submitForm } from "@/lib/aston/studio/forms";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The form handler for ASTON's websites (previews and deployed sites post
 * here). Public by design — a site's visitors aren't JARVIS users — so it's
 * rate-limited, validates everything, and never reveals anything but the
 * answer for that one form.
 */
const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "POST, OPTIONS", "Access-Control-Allow-Headers": "Content-Type", "Access-Control-Max-Age": "86400" };
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store", ...CORS } });

export function OPTIONS() { return new Response(null, { status: 204, headers: CORS }); }

export async function POST(req: Request, { params }: { params: { token: string } }) {
  if (!/^[A-Za-z0-9_-]{16,64}$/.test(params.token)) return json(404, { ok: false, error: "This form isn't connected to a site." });
  const ip = (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() || "local";
  if (!rateLimit(`astonform:${params.token}:${ip}`, 12, 60_000).allowed) return json(429, { ok: false, error: "Too many submissions — please wait a minute." });
  const text = await req.text();
  if (text.length > 20_000) return json(413, { ok: false, error: "That's too much to send." });
  let body: unknown;
  try { body = JSON.parse(text); } catch { return json(400, { ok: false, error: "That couldn't be read." }); }
  try {
    return json(200, await submitForm(params.token, body));
  } catch (e) {
    if (e instanceof FormError) return json(e.status, { ok: false, error: e.message });
    console.error("[aston forms]", (e as Error)?.message);
    return json(500, { ok: false, error: "Sorry, it couldn't be sent. Please try again." });
  }
}
