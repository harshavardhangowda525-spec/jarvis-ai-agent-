import { z } from "zod";
import { ok } from "@/lib/api";
import { robinApi } from "@/lib/robin/http";
import { commitImport, previewImport } from "@/lib/crm/import";
import { CRM_STATUSES, type CrmStatus } from "@/lib/crm/status";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const STATUS = z.enum(CRM_STATUSES.map((s) => s.id) as [CrmStatus, ...CrmStatus[]]);
const schema = z.object({
  action: z.enum(["preview", "import"]),
  csv: z.string().min(1).max(5_000_000),
  mapping: z.record(z.number().int().min(0)).optional(),
  statusMap: z.record(STATUS).optional(),
  defaultStatus: STATUS.optional(),
  sourceLabel: z.string().max(40).optional(),
  /** import only the first N new rows (the sample test) */
  limit: z.number().int().min(1).max(5000).optional(),
});

/** Import leads from a CSV export (Lovable/Supabase, Sheets, Excel): preview first, then a sample, then the rest. */
export async function POST(req: Request) {
  return robinApi(req, "crm-import", async (user) => {
    const b = schema.parse(await req.json());
    const o = { mapping: b.mapping, statusMap: b.statusMap, defaultStatus: b.defaultStatus, sourceLabel: b.sourceLabel };
    return ok(b.action === "preview" ? await previewImport(user.id, b.csv, o) : await commitImport(user.id, b.csv, { ...o, limit: b.limit }));
  }, 12);
}
