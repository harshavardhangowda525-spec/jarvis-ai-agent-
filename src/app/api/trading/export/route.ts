import { requireUser } from "@/lib/auth/session";
import { fail, handleError } from "@/lib/api";
import { getReport } from "@/lib/trading/reports";
import { reportCsv, reportPdf } from "@/lib/trading/export";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** ?week=YYYY-MM-DD&revision=n&format=csv|pdf */
export async function GET(req: Request) {
  try {
    const user = await requireUser();
    const u = new URL(req.url);
    const r = await getReport(user.id, u.searchParams.get("week") ?? undefined, Number(u.searchParams.get("revision")) || undefined);
    if (!r || r.status !== "ready" && !r.viewingOld) return fail("There's no finished report for that week.", 404);
    const name = `mike-weekly-review-${r.weekStart}-r${r.revision}`;
    if (u.searchParams.get("format") === "pdf") {
      const bytes = await reportPdf(r);
      return new Response(Buffer.from(bytes), { headers: { "Content-Type": "application/pdf", "Content-Disposition": `attachment; filename="${name}.pdf"` } });
    }
    return new Response("﻿" + reportCsv(r), { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${name}.csv"` } });
  } catch (e) {
    return handleError(e);
  }
}
