import { ok } from "@/lib/api";
import { robinApi } from "@/lib/robin/http";
import { sendDueReminders } from "@/lib/robin/reminders";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** While JARVIS is open: email your own reminders that are due (once each). */
export async function POST(req: Request) {
  return robinApi(req, "reminders", async (user) => ok(await sendDueReminders(user.id)), 20);
}
