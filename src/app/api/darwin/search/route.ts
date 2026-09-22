import { NextRequest } from "next/server";
import { z } from "zod";
import { requireUser } from "@/lib/auth/session";
import { ok, fail, handleError, rateLimit } from "@/lib/api";
import { discoverLeads, LeadSourceError } from "@/lib/darwin/sources";
import { upsertLeads } from "@/lib/darwin/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const schema = z.object({
  category: z.string().trim().max(80).optional(),
  location: z.string().trim().min(1).max(120),
  radiusKm: z.number().min(1).max(50).optional(),
  limit: z.number().int().min(1).max(60).optional(),
  hasWebsite: z.boolean().optional(),
  noWebsite: z.boolean().optional(),
  needsPhone: z.boolean().optional(),
  needsEmail: z.boolean().optional(),
});

/**
 * Drives the Lead Discovery panel: composes a real search from the form, pulls
 * REAL businesses from a connected source, applies the has/no-website + contact
 * filters, dedupes and stores them. Returns real counts — never fabricates.
 */
export async function POST(req: NextRequest) {
  try {
    const user = await requireUser();
    const rl = rateLimit(`darwin-search:${user.id}`, 12, 60_000);
    if (!rl.allowed) return fail("Too many searches — wait a moment.", 429);

    const body = schema.parse(await req.json());
    const query = [body.category || "businesses", "in", body.location].join(" ");

    let raws;
    try {
      raws = await discoverLeads({ query, limit: body.limit ?? 50 });
    } catch (err) {
      if (err instanceof LeadSourceError) return fail(err.message, 409);
      throw err;
    }

    // Apply the form's real filters against what the source actually returned.
    let filtered = raws;
    if (body.hasWebsite && !body.noWebsite) filtered = filtered.filter((r) => !!r.website);
    if (body.noWebsite && !body.hasWebsite) filtered = filtered.filter((r) => !r.website);
    if (body.needsPhone) filtered = filtered.filter((r) => !!r.phone);
    if (body.needsEmail) filtered = filtered.filter((r) => !!r.email);

    const res = await upsertLeads(user.id, filtered);

    // Return the REAL businesses found so the UI can line them up in the popup.
    const leads = filtered.slice(0, 30).map((r) => ({
      businessName: r.businessName,
      category: r.category ?? null,
      location: r.location ?? null,
      website: r.website ?? null,
      phone: r.phone ?? null,
      instagram: r.instagram ?? null,
      source: r.source,
    }));

    return ok({
      query,
      found: raws.length,
      matchedFilters: filtered.length,
      created: res.created,
      duplicates: res.duplicates,
      source: raws[0]?.source ?? null,
      leads,
    });
  } catch (err) {
    return handleError(err);
  }
}
