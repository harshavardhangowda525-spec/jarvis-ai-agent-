import "server-only";
import { z } from "zod";
import { RobinError } from "@/lib/robin/crm";
import { createLead, facets, leadDetail, listLeads, setStatus, updateLead, type LeadPatch } from "./service";
import { CRM_STATUSES, type CrmStatus } from "./status";

/**
 * The CRM's request contract, shared by JARVIS's /api/crm routes and RUBEN's
 * own server — both answer exactly the same, from the same database.
 */

const STATUS_IDS = CRM_STATUSES.map((s) => s.id) as [CrmStatus, ...CrmStatus[]];

const listSchema = z.object({
  q: z.string().max(120).optional(),
  status: z.enum([...STATUS_IDS, "open", "all"]).optional(),
  niche: z.string().max(80).optional(),
  location: z.string().max(80).optional(),
  website: z.enum(["has", "none", "unknown"]).optional(),
  followUp: z.enum(["overdue", "today", "due", "week", "none", "any"]).optional(),
  ids: z.string().max(4000).transform((s) => s.split(",").filter(Boolean).slice(0, 200)).optional(),
  source: z.string().max(40).optional(),
  sort: z.enum(["recent", "followup", "name"]).optional(),
  limit: z.coerce.number().int().min(1).max(500).optional(),
  offset: z.coerce.number().int().min(0).optional(),
});

export async function crmList(userId: string, params: URLSearchParams) {
  const raw = Object.fromEntries([...params.entries()].filter(([, v]) => v !== ""));
  const f = listSchema.parse(raw);
  const [list, f2] = await Promise.all([listLeads(userId, f), params.get("facets") === "0" ? null : facets(userId)]);
  return { ...list, facets: f2 };
}

const createSchema = z.object({
  businessName: z.string().trim().min(1).max(160),
  category: z.string().trim().max(80).nullish(),
  phone: z.string().trim().max(40).nullish(),
  whatsapp: z.string().trim().max(40).nullish(),
  email: z.string().trim().max(160).email().nullish().or(z.literal("")),
  website: z.string().trim().max(300).nullish(),
  instagram: z.string().trim().max(160).nullish(),
  address: z.string().trim().max(300).nullish(),
  city: z.string().trim().max(80).nullish(),
  notes: z.string().trim().max(4000).nullish(),
});

/** Add a lead by hand. An existing business is completed, never duplicated. */
export async function crmCreate(userId: string, body: unknown) {
  const b = createSchema.parse(body);
  const { lead, duplicate } = await createLead(userId, { ...b, email: b.email || null, source: "manual" }, "user");
  return { id: lead.id, duplicate, name: lead.businessName };
}

export async function crmLead(userId: string, id: string) {
  return { lead: await leadDetail(userId, id) };
}

const patchSchema = z.object({
  status: z.enum(STATUS_IDS).optional(),
  confirm: z.boolean().optional(),
  note: z.string().max(500).nullish(),
  fields: createSchema.partial().extend({ serviceInterest: z.string().max(160).nullish(), potentialValue: z.number().min(0).max(1e9).nullish() }).optional(),
});

/** Edit details and/or change status; answers what was actually saved. */
export async function crmPatch(userId: string, id: string, body: unknown, source: "user" | "voice" = "user") {
  const b = patchSchema.parse(body);
  if (!b.status && !b.fields) throw new RobinError("Nothing to change.", 422, "invalid");
  let changed: string[] = [];
  if (b.fields && Object.keys(b.fields).length) {
    await updateLead(userId, id, b.fields as LeadPatch, source);
    changed = Object.keys(b.fields);
  }
  let moved: { changed: boolean; from: string; to: string } | null = null;
  if (b.status) {
    const r = await setStatus(userId, id, b.status, { source, confirm: b.confirm, note: b.note });
    moved = { changed: r.changed, from: r.from, to: r.lead.stage };
  }
  return { changed, moved, lead: (await leadDetail(userId, id)) };
}

// ---------------- Generate leads (DARWIN discovery → straight into this CRM) ----------------

const genSchema = z.object({
  category: z.string().trim().min(2).max(80),
  location: z.string().trim().min(2).max(120),
  count: z.number().int().min(1).max(50).default(20),
  filter: z.enum(["all", "no_website", "no_website_phone", "has_website", "phone", "no_phone"]).default("all"),
});

/** What the Generate Leads form may ask for (the niches DARWIN is allowed to search). */
export async function crmGenerateOptions() {
  const { env } = await import("@/lib/env");
  const { allowedList } = await import("@/lib/darwin/categories");
  return { niches: allowedList(env.darwinOnlyCategories), configured: env.geoapifyApiKey.length > 0 };
}

/**
 * One real discovery run: DISCOVER → NORMALIZE → DEDUPLICATE → SAVE → into the
 * CRM, with the run's own report. Provider failures come back as the real
 * provider state, never as an empty "success".
 */
export async function crmGenerate(userId: string, body: unknown) {
  const b = genSchema.parse(body);
  const { findNewLeads } = await import("@/lib/darwin/discovery");
  const { GeoapifyError } = await import("@/lib/darwin/geoapify");
  const { syncFromDarwin } = await import("@/lib/robin/darwin-sync");
  try {
    const r = await findNewLeads({ userId, category: b.category, location: b.location, limit: b.count, filter: b.filter });
    const sync = r.leads.length ? await syncFromDarwin(userId, { ids: r.leads.map((l) => l.id), source: "darwin" }) : { imported: 0, duplicates: 0 };
    return {
      ok: true as const,
      report: {
        discovered: r.discovered, saved: r.newCount, addedToCrm: sync.imported, alreadyInCrm: sync.duplicates,
        duplicatesSkipped: r.skippedDuplicates, filteredOut: r.filteredOut, providerErrors: r.providerErrors,
        runtimeMs: r.runtimeMs, requests: r.requests, stoppedReason: r.stoppedReason, area: r.center.label, message: r.message,
      },
      names: r.leads.slice(0, 10).map((l) => l.businessName),
    };
  } catch (e) {
    if (e instanceof GeoapifyError) return { ok: false as const, error: e.message, state: e.state };
    throw e;
  }
}
