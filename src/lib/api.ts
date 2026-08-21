/**
 * Shared route-handler helpers: consistent JSON envelopes, safe error mapping
 * (never leak stack traces), and a lightweight in-memory rate limiter.
 */
import "server-only";
import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { DbNotConfiguredError } from "@/lib/db";
import { UnauthorizedError } from "@/lib/auth/session";

export function ok<T>(data: T, init?: ResponseInit) {
  return NextResponse.json({ ok: true, data }, init);
}

export function fail(message: string, status = 400, extra?: unknown) {
  return NextResponse.json(
    { ok: false, error: message, ...(extra ? { details: extra } : {}) },
    { status },
  );
}

/** Map thrown errors to safe responses. Use in every route's catch block. */
export function handleError(err: unknown) {
  if (err instanceof UnauthorizedError) {
    return fail("Authentication required.", 401);
  }
  if (err instanceof DbNotConfiguredError) {
    return fail("Database is not configured.", 503);
  }
  if (err instanceof ZodError) {
    return fail("Invalid request.", 422, err.flatten());
  }
  // Log server-side, return a generic message to the client.
  console.error("[api] unhandled error:", err);
  return fail("Something went wrong.", 500);
}

// --- Rate limiting -------------------------------------------------------
// Simple sliding-window limiter keyed by identifier. Suitable for a single
// instance; swap for Redis/Upstash in a multi-instance deployment.
const buckets = new Map<string, { count: number; resetAt: number }>();

export function rateLimit(
  key: string,
  limit = 30,
  windowMs = 60_000,
): { allowed: boolean; remaining: number; retryAfter: number } {
  const now = Date.now();
  const bucket = buckets.get(key);
  if (!bucket || bucket.resetAt < now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return { allowed: true, remaining: limit - 1, retryAfter: 0 };
  }
  if (bucket.count >= limit) {
    return {
      allowed: false,
      remaining: 0,
      retryAfter: Math.ceil((bucket.resetAt - now) / 1000),
    };
  }
  bucket.count += 1;
  return { allowed: true, remaining: limit - bucket.count, retryAfter: 0 };
}

/** Best-effort client identifier for rate limiting. */
export function clientIp(req: Request): string {
  const fwd = req.headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0].trim();
  return req.headers.get("x-real-ip") ?? "unknown";
}
