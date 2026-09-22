import "server-only";
import { env } from "@/lib/env";

/**
 * Magic Hour AI client — image + video generation for EV. Jobs are async:
 * create returns a project id, then GET the matching project until it's
 * complete and read the download URL. Nothing here waits longer than the
 * caller's budget, so it stays inside serverless limits (the tool re-checks).
 */

export class MagicHourError extends Error {
  constructor(message: string, public status?: number) {
    super(message);
    this.name = "MagicHourError";
  }
}

function assertConfigured(): { base: string; key: string } {
  const key = env.magicHourApiKey;
  const base = env.magicHourBaseUrl.replace(/\/$/, "");
  if (!key) {
    throw new MagicHourError(
      "Magic Hour isn't connected. Add MAGICHOUR_API_KEY (from magichour.ai → Developer/API) so EV can generate images and video.",
    );
  }
  return { base, key };
}

function headers(key: string): Record<string, string> {
  return { Authorization: `Bearer ${key}`, "Content-Type": "application/json" };
}

async function post(path: string, body: unknown): Promise<any> {
  const { base, key } = assertConfigured();
  const res = await fetch(`${base}${path}`, {
    method: "POST",
    headers: headers(key),
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(30_000),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = json?.message || json?.error || `Magic Hour API error (HTTP ${res.status}).`;
    if (res.status === 401 || res.status === 403) throw new MagicHourError("Magic Hour rejected the API key.", res.status);
    if (res.status === 402) throw new MagicHourError("Magic Hour: not enough credits for this generation.", res.status);
    throw new MagicHourError(msg, res.status);
  }
  return json;
}

async function getProject(kind: "image" | "video", id: string): Promise<any> {
  const { base, key } = assertConfigured();
  const path = kind === "image" ? `/v1/image-projects/${id}` : `/v1/video-projects/${id}`;
  const res = await fetch(`${base}${path}`, { headers: headers(key), signal: AbortSignal.timeout(20_000) });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new MagicHourError(json?.message || `Couldn't read Magic Hour ${kind} project.`, res.status);
  return json;
}

export interface MagicHourResult {
  status: string; // complete | error | canceled | queued | rendering | draft | ...
  done: boolean;
  ok: boolean;
  url: string | null;
  projectId: string;
  kind: "image" | "video";
}

function extractUrl(project: any): string | null {
  const dl = project?.downloads;
  if (Array.isArray(dl) && dl.length) return dl[0]?.url ?? null;
  if (Array.isArray(project?.exact_download_urls) && project.exact_download_urls.length) return project.exact_download_urls[0]?.url ?? project.exact_download_urls[0] ?? null;
  return null;
}

/** Poll a project until it finishes or the time budget runs out. */
export async function waitProject(kind: "image" | "video", id: string, budgetMs: number): Promise<MagicHourResult> {
  const deadline = Date.now() + budgetMs;
  let project = await getProject(kind, id);
  while (true) {
    const status = String(project?.status ?? "").toLowerCase();
    const done = ["complete", "completed", "error", "errored", "canceled", "cancelled"].includes(status);
    if (done) {
      const ok = status.startsWith("complete");
      return { status, done: true, ok, url: ok ? extractUrl(project) : null, projectId: id, kind };
    }
    if (Date.now() + 4000 >= deadline) {
      return { status: status || "rendering", done: false, ok: false, url: null, projectId: id, kind };
    }
    await new Promise((r) => setTimeout(r, 4000));
    project = await getProject(kind, id);
  }
}

export function isConfigured(): boolean {
  return env.magicHourApiKey.length > 0;
}

/** aspect → Magic Hour orientation. */
function orientation(aspect: "square" | "portrait" | "landscape"): string {
  return aspect === "portrait" ? "portrait" : aspect === "landscape" ? "landscape" : "square";
}

/** Start an AI image generation. Returns the project id. */
export async function createImage(prompt: string, aspect: "square" | "portrait" | "landscape" = "square"): Promise<string> {
  const json = await post("/v1/ai-image-generator", {
    name: "EV image",
    image_count: 1,
    orientation: orientation(aspect),
    style: { prompt },
  });
  const id = json?.id;
  if (!id) throw new MagicHourError("Magic Hour did not return a project id for the image.");
  return id;
}

/**
 * Start a video generation. With an image URL → image-to-video; otherwise
 * text-to-video. Returns the project id.
 */
export async function createVideo(opts: {
  prompt: string;
  imageUrl?: string;
  seconds?: number;
  aspect?: "square" | "portrait" | "landscape";
}): Promise<string> {
  const end_seconds = Math.min(Math.max(opts.seconds ?? 5, 3), 20);
  const model = env.magicHourVideoModel || undefined;
  let json: any;
  if (opts.imageUrl) {
    json = await post("/v1/image-to-video", {
      name: "EV video",
      end_seconds,
      assets: { image_file_path: opts.imageUrl },
      style: { prompt: opts.prompt },
      ...(model ? { model } : {}),
    });
  } else {
    json = await post("/v1/text-to-video", {
      name: "EV video",
      end_seconds,
      orientation: orientation(opts.aspect ?? "landscape"),
      style: { prompt: opts.prompt },
      ...(model ? { model } : {}),
    });
  }
  const id = json?.id;
  if (!id) throw new MagicHourError("Magic Hour did not return a project id for the video.");
  return id;
}
