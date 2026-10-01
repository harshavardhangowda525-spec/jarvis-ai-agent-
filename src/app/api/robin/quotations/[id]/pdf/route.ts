import { robinApi } from "@/lib/robin/http";
import { renderQuotationPdf } from "@/lib/robin/quotes";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

/** The quotation as a PDF (download, or ?inline=1 to view). */
export async function GET(req: Request, { params }: { params: { id: string } }) {
  return robinApi(req, "quotation-pdf", async (user) => {
    const { bytes, filename } = await renderQuotationPdf(user.id, params.id);
    const inline = new URL(req.url).searchParams.get("inline") === "1";
    return new Response(Buffer.from(bytes), { headers: { "Content-Type": "application/pdf", "Content-Disposition": `${inline ? "inline" : "attachment"}; filename="${filename}"`, "Cache-Control": "private, no-store" } });
  }, 30);
}
