import { z } from "zod";
import { ok } from "@/lib/api";
import { robinApi } from "@/lib/robin/http";
import { backupFile, restoreBackup } from "@/lib/crm/backup";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Download a backup as a JSON file. */
export async function GET(req: Request, { params }: { params: { id: string } }) {
  return robinApi(req, "crm-backup", async (user) => {
    const f = await backupFile(user.id, params.id);
    return new Response(f.json, { headers: { "Content-Type": "application/json", "Content-Disposition": `attachment; filename="${f.name}"`, "Cache-Control": "no-store" } });
  });
}

/** Restore: re-creates records that are missing; never overwrites existing ones. Takes a safety backup first. */
export async function POST(req: Request, { params }: { params: { id: string } }) {
  return robinApi(req, "crm-backup", async (user) => {
    z.object({ confirm: z.literal(true) }).parse(await req.json());
    return ok(await restoreBackup(user.id, params.id));
  }, 4);
}
