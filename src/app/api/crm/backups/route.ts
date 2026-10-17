import { ok } from "@/lib/api";
import { robinApi } from "@/lib/robin/http";
import { createBackup, listBackups } from "@/lib/crm/backup";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Your CRM backups (newest first; the 20 newest are kept). */
export async function GET(req: Request) {
  return robinApi(req, "crm-backup", async (user) => ok({ backups: await listBackups(user.id) }));
}

/** Back up the CRM and DARWIN's leads now. */
export async function POST(req: Request) {
  return robinApi(req, "crm-backup", async (user) => ok({ backup: await createBackup(user.id, "manual") }), 6);
}
