import "server-only";
import { NextResponse } from "next/server";
import { requireUser, type AuthUser } from "@/lib/auth/session";
import { fail, handleError, rateLimit } from "@/lib/api";
import { RobinError } from "./crm";

/**
 * Every ROBIN API: signed-in user only (each query is scoped to that user),
 * rate-limited, validated with zod, and errors mapped to plain answers.
 * `needs_confirmation` comes back as HTTP 409 with `code` so the UI (or voice)
 * asks you before trying again with `confirm: true`.
 */
export async function robinApi(req: Request, name: string, fn: (user: AuthUser) => Promise<Response>, limit = 60): Promise<Response> {
  try {
    const user = await requireUser();
    const rl = rateLimit(`robin:${name}:${req.method}:${user.id}`, req.method === "GET" ? limit * 2 : limit, 60_000);
    if (!rl.allowed) return fail("Too many requests — wait a moment.", 429);
    return await fn(user);
  } catch (err) {
    if (err instanceof RobinError) return NextResponse.json({ ok: false, error: err.message, code: err.code ?? null }, { status: err.status });
    return handleError(err);
  }
}

/** "2026-10-02T16:00" / ISO / epoch → Date (zod-friendly). */
export const toDate = (v: unknown) => (v == null || v === "" ? undefined : new Date(v as string));
