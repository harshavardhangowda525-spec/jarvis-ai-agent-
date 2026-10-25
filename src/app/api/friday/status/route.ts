import { spawnSync } from "node:child_process";
import { requireUser } from "@/lib/auth/session";
import { ok, handleError } from "@/lib/api";
import { findBlender, installHint } from "@/lib/friday/blender";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

let cached: { path: string; version: string | null } | null = null;

/** Whether Blender is on this computer (and which version — read from Blender itself). */
export async function GET() {
  try {
    await requireUser();
    const path = findBlender();
    if (!path) return ok({ blender: null, hint: installHint() });
    if (cached?.path !== path) {
      const r = spawnSync(path, ["-b", "--factory-startup", "--version"], { encoding: "utf8", timeout: 30_000, windowsHide: true });
      cached = { path, version: /Blender\s+(\d+\.\d+(?:\.\d+)?)/.exec(r.stdout ?? "")?.[1] ?? null };
    }
    return ok({ blender: { version: cached.version } });
  } catch (e) {
    return handleError(e);
  }
}
