import { requireUser } from "@/lib/auth/session";
import { getDb } from "@/lib/db";
import { DISPLAY_INTEGRATIONS, isProviderConfigured, isKeyIntegrationConfigured } from "@/lib/integrations/providers";
import { ok, handleError } from "@/lib/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** List integrations with their availability + connection status for this user. */
export async function GET() {
  try {
    const user = await requireUser();
    const rows = await getDb().integration.findMany({
      where: { userId: user.id },
      select: { provider: true, status: true, updatedAt: true },
    });
    const byProvider = new Map(rows.map((r) => [r.provider, r]));

    const integrations = DISPLAY_INTEGRATIONS.map((d) => {
      const row = byProvider.get(d.id);
      if (d.kind === "key") {
        // Key-based: "connected" simply means the API key is set in env.
        const configured = isKeyIntegrationConfigured(d.id);
        return {
          id: d.id,
          label: d.label,
          kind: d.kind,
          available: configured,
          status: configured ? "connected" : "disconnected",
          connectedAt: null,
        };
      }
      const configured = isProviderConfigured(d.id);
      return {
        id: d.id,
        label: d.label,
        kind: d.kind,
        available: configured, // OAuth credentials present in env
        status: row?.status ?? "disconnected",
        connectedAt: row?.status === "connected" ? row.updatedAt : null,
      };
    });
    return ok({ integrations });
  } catch (err) {
    return handleError(err);
  }
}
