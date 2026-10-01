import { z } from "zod";
import { ok } from "@/lib/api";
import { getDb } from "@/lib/db";
import { robinApi } from "@/lib/robin/http";
import { audit, listServices, loadSettings, saveSettings } from "@/lib/robin/crm";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  return robinApi(req, "settings", async (user) => ok({ settings: await loadSettings(user.id), services: await listServices(user.id) }));
}

const schema = z.object({
  settings: z.object({
    autoImport: z.boolean().optional(), currency: z.string().trim().length(3).toUpperCase().optional(), taxPct: z.number().min(0).max(100).optional(),
    quoteValidityDays: z.number().int().min(1).max(365).optional(), paymentTerms: z.string().max(2000).optional(),
    companyName: z.string().max(120).optional(), companyPhone: z.string().max(40).optional(), companyEmail: z.string().max(160).optional(),
    companyAddress: z.string().max(300).optional(), morningReport: z.boolean().optional(),
  }).optional(),
  // your services and prices (null price = not set; Robin won't quote it until you set one)
  services: z.array(z.object({ id: z.string().optional(), name: z.string().trim().min(1).max(120), description: z.string().max(1000).nullable().optional(), price: z.number().min(0).max(1e9).nullable().optional(), unit: z.string().max(40).nullable().optional(), active: z.boolean().optional() })).max(60).optional(),
  removeServices: z.array(z.string()).max(60).optional(),
});
export async function PATCH(req: Request) {
  return robinApi(req, "settings-patch", async (user) => {
    const b = schema.parse(await req.json());
    if (b.settings) await saveSettings(user.id, b.settings, "user");
    const db = getDb();
    if (b.services) {
      for (const [position, s] of b.services.entries()) {
        const data = { name: s.name, description: s.description ?? null, price: s.price ?? null, unit: s.unit ?? null, active: s.active ?? true, position };
        if (s.id) await db.robinService.updateMany({ where: { id: s.id, userId: user.id }, data });
        else await db.robinService.upsert({ where: { userId_name: { userId: user.id, name: s.name } }, create: { userId: user.id, ...data }, update: data });
      }
      await audit(user.id, "services_changed", "service", null, "user", { count: b.services.length, prices: b.services.map((s) => [s.name, s.price ?? null]) });
    }
    if (b.removeServices?.length) await db.robinService.deleteMany({ where: { userId: user.id, id: { in: b.removeServices } } });
    return ok({ settings: await loadSettings(user.id), services: await listServices(user.id) });
  }, 30);
}
