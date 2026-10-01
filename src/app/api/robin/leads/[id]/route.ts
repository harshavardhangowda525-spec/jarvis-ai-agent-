import { z } from "zod";
import { ok } from "@/lib/api";
import { robinApi } from "@/lib/robin/http";
import { moveStage, requalify, setPriority, updateLead } from "@/lib/robin/crm";
import { leadWorkspace } from "@/lib/robin/workspace";
import { STAGES, PRIORITIES } from "@/lib/robin/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request, { params }: { params: { id: string } }) {
  return robinApi(req, "lead", async (user) => ok(await leadWorkspace(user.id, params.id)));
}

const patchSchema = z.object({
  stage: z.enum(STAGES).optional(),
  confirm: z.boolean().optional(),
  note: z.string().max(300).optional().nullable(),
  source: z.enum(["user", "voice"]).optional(),
  priority: z.enum(PRIORITIES).nullable().optional(),
  requalify: z.boolean().optional(),
  fields: z.object({
    businessName: z.string().trim().min(1).max(160).optional(),
    category: z.string().trim().max(80).nullable().optional(),
    phone: z.string().trim().max(40).nullable().optional(),
    whatsapp: z.string().trim().max(40).nullable().optional(),
    email: z.string().trim().max(160).nullable().optional(),
    website: z.string().trim().max(300).nullable().optional(),
    instagram: z.string().trim().max(200).nullable().optional(),
    address: z.string().trim().max(300).nullable().optional(),
    city: z.string().trim().max(120).nullable().optional(),
    mapsUrl: z.string().trim().max(500).nullable().optional(),
    websiteStatus: z.enum(["no_website", "has_website", "outdated", "poor", "unknown"]).nullable().optional(),
    websiteQuality: z.string().max(200).nullable().optional(),
    potentialValue: z.number().min(0).max(1e9).nullable().optional(),
    serviceInterest: z.string().max(120).nullable().optional(),
    assignedTo: z.string().max(80).nullable().optional(),
    notes: z.string().max(8000).nullable().optional(),
  }).optional(),
});

/** Move stage (decisions need confirm), override priority, edit details. */
export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  return robinApi(req, "lead-patch", async (user) => {
    const b = patchSchema.parse(await req.json());
    const source = b.source ?? "user";
    if (b.fields) await updateLead(user.id, params.id, b.fields, source);
    if (b.priority !== undefined) await setPriority(user.id, params.id, b.priority, source);
    if (b.requalify) await requalify(user.id, params.id, source);
    let moved: { changed: boolean; from: string } | null = null;
    if (b.stage) { const r = await moveStage(user.id, params.id, b.stage, { source, note: b.note, confirm: b.confirm }); moved = { changed: r.changed, from: r.from }; }
    return ok({ ...(await leadWorkspace(user.id, params.id)), moved });
  });
}
