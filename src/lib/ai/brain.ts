import "server-only";
import { getDb } from "@/lib/db";
import type { BrainEndpoint } from "@/lib/env";

/**
 * The Ollama "brain" on the user's PC. Vercel can't reach localhost, so the
 * brain gateway (`npm run brain` in edith/) opens a tunnel and registers its
 * current public URL here every couple of minutes. We treat a registration as
 * live only while those heartbeats keep arriving — a PC that's off or asleep is
 * skipped instantly (cloud providers take over) instead of timing out.
 */
export const BRAIN_PROVIDER = "ollama";
/** The Claude bridge (`npm run claude`): Claude Code on the PC, signed in with your Claude plan. */
export const CLAUDE_BRIDGE_PROVIDER = "claude_bridge";
const STALE_MS = 5 * 60_000; // heartbeat every 2 min → stale after 5

interface BrainMeta { baseUrl?: string; model?: string; lastSeen?: string }

const live = (row: { status: string; metadata: unknown } | undefined): BrainMeta | null => {
  const meta = (row?.metadata ?? {}) as BrainMeta;
  if (row?.status !== "connected" || !meta.baseUrl || !meta.lastSeen) return null;
  return Date.now() - new Date(meta.lastSeen).getTime() > STALE_MS ? null : meta;
};

/** The PC's live brains for this user (Ollama and/or the Claude bridge), or null when neither is online. */
export async function getLiveBrain(userId: string): Promise<BrainEndpoint | null> {
  const rows = await getDb().integration.findMany({
    where: { userId, provider: { in: [BRAIN_PROVIDER, CLAUDE_BRIDGE_PROVIDER] } },
    select: { provider: true, status: true, metadata: true },
  });
  const ollama = live(rows.find((r) => r.provider === BRAIN_PROVIDER));
  const claude = live(rows.find((r) => r.provider === CLAUDE_BRIDGE_PROVIDER));
  if (!ollama && !claude) return null;
  return {
    ...(ollama ? { baseUrl: ollama.baseUrl, model: ollama.model } : {}),
    ...(claude ? { claudeUrl: claude.baseUrl, claudeModel: claude.model } : {}),
  };
}

/**
 * Record (or clear) the gateway's URL. JARVIS is a personal, single-owner app,
 * so the brain is attached to every account on this deployment.
 */
export async function registerBrain(input: { url: string | null; model?: string }, kind: "ollama" | "claude" = "ollama"): Promise<number> {
  const provider = kind === "claude" ? CLAUDE_BRIDGE_PROVIDER : BRAIN_PROVIDER;
  const db = getDb();
  const users = await db.user.findMany({ select: { id: true } });
  const online = !!input.url;
  const metadata = online
    ? { baseUrl: input.url, model: input.model ?? null, lastSeen: new Date().toISOString() }
    : { lastSeen: new Date().toISOString() };
  for (const u of users) {
    await db.integration.upsert({
      where: { userId_provider: { userId: u.id, provider } },
      create: { userId: u.id, provider, status: online ? "connected" : "disconnected", metadata },
      update: { status: online ? "connected" : "disconnected", metadata },
    });
  }
  return users.length;
}
