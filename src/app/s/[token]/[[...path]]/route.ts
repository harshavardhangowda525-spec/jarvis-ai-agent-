import { promises as fs } from "node:fs";
import path from "node:path";
import { NextRequest } from "next/server";
import { getDb } from "@/lib/db";
import { siteFile } from "@/lib/aston/studio/store";
import { formsRuntime } from "@/lib/aston/studio/forms-runtime";
import { SITE_CSP } from "@/lib/aston/studio/csp";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * ASTON's website previews: /s/<token>/ (the current version), /s/<token>/v3/…
 * (a particular version — also one still being built, so you can watch it).
 * Sandboxed like the demo previews: the site's scripts get their own opaque
 * origin and can't reach JARVIS or your session; only its own files, Google
 * Fonts, https images, and its form handler.
 */
const CSP = SITE_CSP;

const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".svg": "image/svg+xml",
  ".json": "application/json", ".txt": "text/plain; charset=utf-8", ".xml": "application/xml", ".webmanifest": "application/manifest+json",
  ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp", ".ico": "image/x-icon", ".woff2": "font/woff2",
};

const notFound = (msg: string) => new Response(`<!doctype html><meta charset="utf-8"><title>Not found</title><body style="font:16px system-ui;padding:40px;background:#0b1020;color:#e5e7eb">${msg}</body>`, { status: 404, headers: { "Content-Type": "text/html; charset=utf-8", "Content-Security-Policy": CSP, "Cache-Control": "no-store" } });

export async function GET(req: NextRequest, { params }: { params: { token: string; path?: string[] } }) {
  if (!/^[A-Za-z0-9_-]{16,64}$/.test(params.token)) return notFound("This preview link isn't valid.");
  const p = await getDb().astonProject.findUnique({ where: { previewToken: params.token }, select: { id: true, dir: true, currentVersion: true } });
  if (!p) return notFound("This preview link was replaced or never existed.");
  let parts = (params.path ?? []).map(decodeURIComponent);
  let n = p.currentVersion;
  const vm = /^v(\d{1,4})$/.exec(parts[0] ?? "");
  if (vm) { n = Number(vm[1]); parts = parts.slice(1); }
  if (!n) { // first build still running: show the newest version folder
    const v = await getDb().astonProjectVersion.findFirst({ where: { projectId: p.id }, orderBy: { n: "desc" }, select: { n: true } });
    n = v?.n ?? 0;
  }
  if (!n) return notFound("Nothing has been built yet.");
  const rel = parts.join("/");
  if (rel === "_aston/forms.js") {
    return new Response(formsRuntime(`${req.nextUrl.origin}/api/aston/forms/${params.token}`), { headers: { "Content-Type": "text/javascript; charset=utf-8", "Cache-Control": "no-store" } });
  }
  // folder links ("/", "story/") → index.html
  const file = siteFile(p, n, rel === "" || rel.endsWith("/") ? `${rel}index.html` : rel);
  const ext = file ? path.extname(file).toLowerCase() : "";
  const body = file && TYPES[ext] ? await fs.readFile(file).catch(() => null) : null;
  if (!body) return notFound(`No file called “${rel || "index.html"}” in version ${n}.`);
  return new Response(new Uint8Array(body), {
    headers: {
      "Content-Type": TYPES[ext], "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", "X-Robots-Tag": "noindex",
      ...(ext === ".html" ? { "Content-Security-Policy": CSP, "Referrer-Policy": "no-referrer" } : {}),
    },
  });
}
