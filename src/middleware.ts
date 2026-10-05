/**
 * Edge middleware: gate the dashboard behind a valid session JWT AND the
 * biometric gate, and bounce authenticated users away from the auth pages.
 * Full session validation (DB revocation check) happens in the API routes via
 * getCurrentUser().
 *
 * - Signed out → /login (or the face sign-in gate, when a face is enrolled on
 *   this device).
 * - Signed in but this browser session hasn't passed the gate → /unlock.
 *   API calls get 423 Locked (except signing in/out, the gate itself, health
 *   checks and the secret-protected crons) — the UI isn't the only lock.
 */
import { NextRequest, NextResponse } from "next/server";
import { verifySession, SESSION_COOKIE } from "@/lib/auth/jwt";
import { GATE_COOKIE, GATE_DEVICE_COOKIE, apiOpenWhileLocked, verifyGate } from "@/lib/gate/token";

const PROTECTED_PREFIXES = ["/dashboard"];
const AUTH_PAGES = ["/login", "/signup"];

/** Only same-site paths are allowed as a return address. */
function safeNext(raw: string | null): string {
  return raw && raw.startsWith("/") && !raw.startsWith("//") && !raw.startsWith("/\\") ? raw : "/dashboard";
}

export async function middleware(req: NextRequest) {
  const { pathname, search } = req.nextUrl;
  const token = req.cookies.get(SESSION_COOKIE)?.value;
  const claims = token ? await verifySession(token) : null;
  const unlocked = claims ? !!(await verifyGate(req.cookies.get(GATE_COOKIE)?.value, { sub: claims.sub, jti: claims.jti })) : false;
  const faceOnDevice = !!req.cookies.get(GATE_DEVICE_COOKIE)?.value;

  const go = (path: string, next?: string) => {
    const url = req.nextUrl.clone();
    url.pathname = path;
    url.search = "";
    if (next) url.searchParams.set("next", next);
    return NextResponse.redirect(url);
  };

  if (pathname.startsWith("/api/")) {
    if (claims && !unlocked && !apiOpenWhileLocked(pathname)) {
      return NextResponse.json({ ok: false, error: "JARVIS is locked.", locked: true }, { status: 423, headers: { "x-jarvis-locked": "1" } });
    }
    return NextResponse.next();
  }

  const isProtected = PROTECTED_PREFIXES.some((p) => pathname.startsWith(p));
  const isAuthPage = AUTH_PAGES.some((p) => pathname.startsWith(p));

  if (isProtected) {
    if (!claims) return go(faceOnDevice ? "/unlock" : "/login", pathname + search);
    if (!unlocked) return go("/unlock", pathname + search);
    return NextResponse.next();
  }

  if (pathname === "/unlock") {
    if (claims && unlocked) return go(safeNext(req.nextUrl.searchParams.get("next")));
    return NextResponse.next();
  }

  if (isAuthPage && claims) {
    return unlocked ? go("/dashboard") : go("/unlock", req.nextUrl.searchParams.get("next") ?? undefined);
  }

  // launching JARVIS signed out on a device with face unlock → the gate first
  if (pathname === "/" && !claims && faceOnDevice) return go("/unlock");

  return NextResponse.next();
}

export const config = {
  matcher: ["/", "/dashboard/:path*", "/login", "/signup", "/unlock", "/api/:path*"],
};
