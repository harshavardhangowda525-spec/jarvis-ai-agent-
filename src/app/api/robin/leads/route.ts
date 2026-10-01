import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { ok } from "@/lib/api";
import { getDb } from "@/lib/db";
import { robinApi } from "@/lib/robin/http";
import { createLead, findLeadsByName } from "@/lib/robin/crm";
import { attention } from "@/lib/robin/qualify";
import { STAGES, PRIORITIES } from "@/lib/robin/types";
import { nodeOf, NODES, type NodeId } from "@/lib/robin/types";
import { activeConversationIds, nodeCards } from "@/lib/robin/overview";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Leads, filtered: ?stage= ?node= ?priority= ?q= ?uncontacted=1 ?active=1 (in conversation) */
export async function GET(req: Request) {
  return robinApi(req, "leads", async (user) => {
    const u = new URL(req.url).searchParams;
    // voice: "open ABC Cafe" → the closest matches by name (one = that lead; several = ask which)
    // every lead in one chart stage, as cards ("show all qualified leads")
    const cardsOf = u.get("cards");
    if (cardsOf && (NODES as readonly { id: string }[]).some((n) => n.id === cardsOf)) return ok({ cards: await nodeCards(user.id, cardsOf as NodeId) });
    const resolve = u.get("resolve")?.trim();
    if (resolve) return ok({ leads: await findLeadsByName(user.id, resolve) });
    const where: Prisma.RobinLeadWhereInput = { userId: user.id };
    const stage = u.get("stage");
    if (stage && (STAGES as readonly string[]).includes(stage)) where.stage = stage;
    const priority = u.get("priority");
    if (priority && (PRIORITIES as readonly string[]).includes(priority)) where.priority = priority;
    if (u.get("active") === "1") where.id = { in: await activeConversationIds(user.id) };
    if (u.get("uncontacted") === "1") { where.lastContactAt = null; where.stage = { in: ["new", "qualified"] }; }
    const q = u.get("q")?.trim();
    if (q) where.OR = [{ businessName: { contains: q, mode: "insensitive" } }, { category: { contains: q, mode: "insensitive" } }, { city: { contains: q, mode: "insensitive" } }];
    let leads = await getDb().robinLead.findMany({ where, orderBy: [{ score: "desc" }, { createdAt: "desc" }], take: Math.min(Number(u.get("limit")) || 2000, 5000) });
    const node = u.get("node");
    if (node) leads = leads.filter((l) => nodeOf(l.stage) === node);
    // "hottest": the open leads that need you most right now (workflow order, not a prediction)
    if (u.get("hot") === "1") {
      const now = new Date();
      leads = leads.filter((l) => !["won", "lost", "not_interested", "do_not_contact"].includes(l.stage)).sort((a, b) => attention(b, now) - attention(a, now));
    }
    return ok({ leads });
  });
}

const createSchema = z.object({
  businessName: z.string().trim().min(1).max(160),
  category: z.string().trim().max(80).optional().nullable(),
  phone: z.string().trim().max(40).optional().nullable(),
  whatsapp: z.string().trim().max(40).optional().nullable(),
  email: z.string().trim().email().max(160).optional().nullable().or(z.literal("")),
  website: z.string().trim().max(300).optional().nullable(),
  instagram: z.string().trim().max(200).optional().nullable(),
  address: z.string().trim().max(300).optional().nullable(),
  city: z.string().trim().max(120).optional().nullable(),
  websiteStatus: z.enum(["no_website", "has_website", "outdated", "poor", "unknown"]).optional(),
  potentialValue: z.number().min(0).max(1e9).optional().nullable(),
  notes: z.string().max(4000).optional().nullable(),
});

/** Add a lead by hand (Robin still checks for duplicates and qualifies it). */
export async function POST(req: Request) {
  return robinApi(req, "lead-create", async (user) => {
    const body = createSchema.parse(await req.json());
    const r = await createLead(user.id, { ...body, email: body.email || null, source: "manual" }, "user");
    return ok(r);
  }, 30);
}
