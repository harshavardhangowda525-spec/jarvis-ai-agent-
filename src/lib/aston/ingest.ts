import "server-only";
import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { env } from "@/lib/env";
import { fail, handleError } from "@/lib/api";
import { raiseIncident, resolveBySignal } from "./incidents";
import { dispatch, type NotifyDeps } from "./notify";
import { AstonForbidden } from "./auth";
import { DecisionError } from "./decisions";
import { SiteError } from "./site/builder";
import { ScriptError } from "./scripts/service";
import type { Parsed } from "./events";

/** Which user an inbound event belongs to: the owner, or (no owner set) the named account. */
export async function eventUser(userEmail?: string): Promise<{ id: string } | { error: string; status: number }> {
  const want = env.astonOwnerEmail || userEmail?.toLowerCase();
  if (!want) return { error: "Set ASTON_OWNER_EMAIL (or send userEmail).", status: 400 };
  if (env.astonOwnerEmail && userEmail && userEmail.toLowerCase() !== env.astonOwnerEmail) return { error: "Events can only be sent for the ASTON owner.", status: 403 };
  const u = await getDb().user.findUnique({ where: { email: want }, select: { id: true } });
  return u ? { id: u.id } : { error: "Unknown user.", status: 404 };
}

/** Store the signal, then alert right away (verification + dedup happen inside dispatch). */
export async function ingest(userId: string, p: Parsed, deps?: Partial<NotifyDeps>) {
  if (p.action === "ignore") return { ignored: p.reason };
  if (p.action === "resolve") {
    const r = await resolveBySignal(userId, p.signal, p.resolution);
    return { resolved: !!r, incidentId: r?.id ?? null };
  }
  const { incident, created } = await raiseIncident(userId, p.signal);
  const d = await dispatch(userId, deps);
  return { incidentId: incident.id, created, duplicate: !created, occurrences: incident.occurrences, ...d };
}

/** Error mapping shared by the ASTON routes. */
export function astonError(err: unknown): NextResponse {
  if (err instanceof AstonForbidden) return fail(err.message, 403);
  if (err instanceof DecisionError) return fail(err.message, err.status);
  if (err instanceof SiteError) return fail(err.message, err.status);
  if (err instanceof ScriptError) return fail(err.message, err.status);
  if (err instanceof SyntaxError) return fail("Invalid JSON.", 400);
  return handleError(err);
}
