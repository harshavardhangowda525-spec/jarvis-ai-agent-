import { ok } from "@/lib/api";
import { robinApi } from "@/lib/robin/http";
import { crmCreate, crmList } from "@/lib/crm/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** DARWIN's CRM: leads with search + filters (?q ?status ?niche ?location ?website ?followUp ?source ?sort) and the filter counts. */
export async function GET(req: Request) {
  return robinApi(req, "crm", async (user) => ok(await crmList(user.id, new URL(req.url).searchParams)));
}

/** Add a lead by hand. */
export async function POST(req: Request) {
  return robinApi(req, "crm", async (user) => ok(await crmCreate(user.id, await req.json())), 30);
}
