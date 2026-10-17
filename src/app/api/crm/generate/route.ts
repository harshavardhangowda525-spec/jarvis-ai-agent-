import { ok } from "@/lib/api";
import { robinApi } from "@/lib/robin/http";
import { crmGenerate, crmGenerateOptions } from "@/lib/crm/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** The niches DARWIN may search, and whether a discovery source is set. */
export async function GET(req: Request) {
  return robinApi(req, "crm-generate", async () => ok(await crmGenerateOptions()));
}

/** Generate leads: a real DARWIN search, saved straight into the CRM, with the run report. */
export async function POST(req: Request) {
  return robinApi(req, "crm-generate", async (user) => ok(await crmGenerate(user.id, await req.json())), 10);
}
