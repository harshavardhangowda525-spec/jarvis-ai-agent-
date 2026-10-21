import { NextRequest } from "next/server";
import { getDb } from "@/lib/db";
import { WALK_HELPER } from "@/lib/aston/walk-helper";

export const dynamic = "force-dynamic";

/**
 * ASTON's preview pages: /p/<token> (latest version) or /p/<token>?v=2.
 * The link is unguessable and can be revoked (a new token). The page runs
 * sandboxed — its own opaque origin, so its scripts can't reach JARVIS, your
 * session or any API — and can't connect anywhere or submit forms.
 */
const CSP = [
  "sandbox allow-scripts allow-forms allow-popups allow-popups-to-escape-sandbox",
  "default-src 'none'",
  "style-src 'unsafe-inline' https://fonts.googleapis.com",
  "font-src https://fonts.gstatic.com",
  "img-src data: https:",
  "script-src 'unsafe-inline'",
  "connect-src 'none'",
  "form-action 'none'",
  "base-uri 'none'",
  "frame-ancestors 'self'",
].join("; ");

function page(status: number, title: string, body: string) {
  return new Response(
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title><meta name="robots" content="noindex"></head><body style="font:16px/1.6 system-ui,sans-serif;background:#0b1020;color:#e5e7eb;display:grid;place-items:center;min-height:100vh;margin:0;padding:24px;text-align:center"><div><h1 style="font-size:1.4rem">${title}</h1><p style="color:#9ca3af">${body}</p></div></body></html>`,
    { status, headers: { "Content-Type": "text/html; charset=utf-8", "Content-Security-Policy": CSP, "Cache-Control": "no-store", "X-Robots-Tag": "noindex" } },
  );
}

export async function GET(req: NextRequest, { params }: { params: { token: string } }) {
  if (!/^[A-Za-z0-9_-]{16,64}$/.test(params.token)) return page(404, "Preview not found", "This preview link isn't valid.");
  const site = await getDb().astonSite.findUnique({ where: { previewToken: params.token }, select: { id: true, currentVersion: true } });
  if (!site) return page(404, "Preview not found", "This preview link was replaced or never existed.");
  const v = Number(req.nextUrl.searchParams.get("v")) || site.currentVersion;
  const version = await getDb().astonVersion.findUnique({ where: { siteId_n: { siteId: site.id, n: v } }, select: { html: true, status: true } });
  if (!version || version.status !== "ready") return page(404, "Version not available", `Version ${v} of this demo isn't a finished, checked build.`);
  // ?download=1 → the site's code as a file (index.html: complete, self-contained HTML/CSS/JS)
  if (req.nextUrl.searchParams.get("download") === "1") {
    const site = await getDb().astonSite.findUnique({ where: { previewToken: params.token }, select: { name: true } });
    const slug = (site?.name ?? "site").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 50) || "site";
    return new Response(version.html, {
      headers: {
        "Content-Type": "text/html; charset=utf-8", "Content-Disposition": `attachment; filename="${slug}-v${v}-index.html"`,
        "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", "Content-Security-Policy": CSP,
      },
    });
  }
  // the walkthrough frame gets a tiny helper that reports the real sections and scrolls to them
  const html = req.nextUrl.searchParams.get("walk") === "1" ? version.html.replace("</head>", `<script>${WALK_HELPER}</script></head>`) : version.html;
  return new Response(html, {
    headers: {
      "Content-Type": "text/html; charset=utf-8", "Content-Security-Policy": CSP, "Cache-Control": "no-store",
      "X-Robots-Tag": "noindex", "Referrer-Policy": "no-referrer", "X-Content-Type-Options": "nosniff",
    },
  });
}
